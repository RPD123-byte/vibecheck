from __future__ import annotations

import asyncio
import json
import os
import signal
import stat
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest


async def _response(
    reader: asyncio.StreamReader,
    request_id: str,
    *,
    timeout: float = 30,
) -> dict[str, Any]:
    async def read() -> dict[str, Any]:
        while line := await reader.readline():
            message = json.loads(line)
            if message.get("id") == request_id:
                return message
        raise AssertionError("control socket closed before response")

    return await asyncio.wait_for(read(), timeout)


async def _response_with_states(
    reader: asyncio.StreamReader,
    request_id: str,
    *,
    timeout: float = 30,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    states: list[dict[str, Any]] = []

    async def read() -> dict[str, Any]:
        while line := await reader.readline():
            message = json.loads(line)
            if isinstance(message.get("state"), dict):
                states.append(message["state"])
            if message.get("id") == request_id:
                return message
        raise AssertionError("control socket closed before response")

    return await asyncio.wait_for(read(), timeout), states


async def _state(
    reader: asyncio.StreamReader,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout: float = 30,
) -> dict[str, Any]:
    def matches(value: dict[str, Any]) -> bool:
        return predicate(value)

    async def read() -> dict[str, Any]:
        while line := await reader.readline():
            message = json.loads(line)
            state = message.get("state")
            if isinstance(state, dict) and matches(state):
                return state
        raise AssertionError("control socket closed before expected state")

    return await asyncio.wait_for(read(), timeout)


@pytest.mark.asyncio
async def test_real_controller_reconciles_minimal_topology_and_cleans_up() -> None:
    root = Path(__file__).resolve().parents[2]
    environment = dict(os.environ)
    environment["TMPDIR"] = "/tmp"
    before = set(Path("/tmp").glob(f"vibecheck-{os.getuid()}-*"))
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "vibecheck.runtime.cli",
        "--controller",
        "--mode",
        "demo",
        "--headless-notch",
        "--no-manage-codex-gui",
        cwd=root,
        env=environment,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    writer: asyncio.StreamWriter | None = None
    try:
        assert process.stdout is not None
        bootstrap = json.loads(await asyncio.wait_for(process.stdout.readline(), 20))
        assert bootstrap["type"] == "bootstrap"
        socket = Path(bootstrap["control_socket"])
        assert stat.S_IMODE(socket.stat().st_mode) == 0o600
        reader, writer = await asyncio.open_unix_connection(socket)
        initial = json.loads(await reader.readline())["state"]
        assert initial["aggregate"] == "off"
        assert initial["effective_roles"] == []
        writer.close()
        await writer.wait_closed()
        await asyncio.sleep(0.05)
        reader, writer = await asyncio.open_unix_connection(socket)
        reconnected = json.loads(await reader.readline())["state"]
        assert reconnected["aggregate"] == "off"

        revision = reconnected["features"]["revision"]
        notch_request = {
            "version": 1,
            "id": "notch-on",
            "token": bootstrap["controller_token"],
            "type": "set_features",
            "expected_revision": revision,
            "features": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
        }
        writer.write(json.dumps(notch_request).encode() + b"\n")
        await writer.drain()
        notch_ack = await _response(reader, "notch-on")
        assert notch_ack["type"] == "ack"
        notch_active = await _state(
            reader,
            lambda value: value["aggregate"] == "active",
            timeout=60,
        )
        notch_pid = notch_active["workers"]["notch"]["pid"]
        inference_pid = notch_active["workers"]["inference"]["pid"]

        both_request = {
            **notch_request,
            "id": "codex-on",
            "expected_revision": notch_ack["state"]["features"]["revision"],
            "features": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": True},
                "paused": False,
            },
        }
        writer.write(json.dumps(both_request).encode() + b"\n")
        await writer.drain()
        both_ack = await _response(reader, "codex-on")
        both_active = await _state(
            reader,
            lambda value: value["aggregate"] == "active",
            timeout=60,
        )
        assert both_active["workers"]["notch"]["pid"] == notch_pid
        assert both_active["workers"]["inference"]["pid"] == inference_pid
        assert both_active["workers"]["interruption"]["pid"]

        codex_off_request = {
            **notch_request,
            "id": "codex-off",
            "expected_revision": both_ack["state"]["features"]["revision"],
            "features": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
        }
        writer.write(json.dumps(codex_off_request).encode() + b"\n")
        await writer.drain()
        codex_off_ack, drain_states = await _response_with_states(reader, "codex-off")
        assert any(
            state["workers"]["interruption"]["lifecycle"] == "stopping"
            for state in drain_states
        )
        assert codex_off_ack["state"]["workers"]["interruption"]["lifecycle"] == (
            "disabled"
        )
        assert codex_off_ack["state"]["workers"]["notch"]["pid"] == notch_pid
        assert codex_off_ack["state"]["workers"]["inference"]["pid"] == inference_pid

        codex_on_again = {
            **notch_request,
            "id": "codex-on-again",
            "expected_revision": codex_off_ack["state"]["features"]["revision"],
            "features": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": True},
                "paused": False,
            },
        }
        writer.write(json.dumps(codex_on_again).encode() + b"\n")
        await writer.drain()
        codex_on_ack = await _response(reader, "codex-on-again")

        pause_request = {
            **notch_request,
            "id": "pause",
            "expected_revision": codex_on_ack["state"]["features"]["revision"],
            "features": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": True},
                "paused": True,
            },
        }
        writer.write(json.dumps(pause_request).encode() + b"\n")
        await writer.drain()
        pause_ack = await _response(reader, "pause")
        assert pause_ack["state"]["aggregate"] == "paused"
        assert pause_ack["state"]["effective_roles"] == []
        assert all(
            worker["restart_count"] == 0
            for worker in pause_ack["state"]["workers"].values()
        )

        resume_request = {
            **notch_request,
            "id": "resume",
            "expected_revision": pause_ack["state"]["features"]["revision"],
            "features": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": True},
                "paused": False,
            },
        }
        writer.write(json.dumps(resume_request).encode() + b"\n")
        await writer.drain()
        resume_ack = await _response(reader, "resume")
        assert set(resume_ack["state"]["effective_roles"]) == {
            "notch",
            "interruption",
            "inference",
        }

        interruption_only = {
            **notch_request,
            "id": "interruption-only",
            "expected_revision": resume_ack["state"]["features"]["revision"],
            "features": {
                "notch_enabled": False,
                "integrations": {"codex_enabled": True},
                "paused": False,
            },
        }
        writer.write(json.dumps(interruption_only).encode() + b"\n")
        await writer.drain()
        interruption_ack = await _response(reader, "interruption-only")
        assert set(interruption_ack["state"]["effective_roles"]) == {
            "interruption",
            "inference",
        }
        interruption_pid = interruption_ack["state"]["workers"]["interruption"]["pid"]
        current_inference_pid = interruption_ack["state"]["workers"]["inference"]["pid"]

        off = {
            **notch_request,
            "id": "off",
            "expected_revision": interruption_ack["state"]["features"]["revision"],
            "features": {
                "notch_enabled": False,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
        }
        writer.write(json.dumps(off).encode() + b"\n")
        await writer.drain()
        off_ack = await _response(reader, "off")
        assert off_ack["state"]["effective_roles"] == []
        assert off_ack["state"]["workers"]["interruption"]["restart_count"] == 0
        assert off_ack["state"]["workers"]["inference"]["restart_count"] == 0
        assert interruption_pid is not None
        assert current_inference_pid is not None

        states = {
            "off": {
                "notch_enabled": False,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
            "notch": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
            "interruption": {
                "notch_enabled": False,
                "integrations": {"codex_enabled": True},
                "paused": False,
            },
            "combined": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": True},
                "paused": False,
            },
            "paused": {
                "notch_enabled": True,
                "integrations": {"codex_enabled": True},
                "paused": True,
            },
        }
        expected_roles = {
            "off": set(),
            "notch": {"notch", "inference"},
            "interruption": {"interruption", "inference"},
            "combined": {"notch", "interruption", "inference"},
            "paused": set(),
        }

        adjacency = {
            source: [target for target in states if target != source]
            for source in states
        }
        stack = ["off"]
        reversed_cycle: list[str] = []
        while stack:
            source = stack[-1]
            if adjacency[source]:
                stack.append(adjacency[source].pop())
            else:
                reversed_cycle.append(stack.pop())
        cycle = list(reversed(reversed_cycle))
        assert len(cycle) == 21
        assert {
            (source, target)
            for source, target in zip(cycle[:-1], cycle[1:], strict=True)
        } == {
            (source, target)
            for source in states
            for target in states
            if source != target
        }

        previous = off_ack["state"]
        revision = previous["features"]["revision"]
        for index, target in enumerate(cycle[1:]):
            request = {
                "version": 1,
                "id": f"edge-{index}-{target}",
                "token": bootstrap["controller_token"],
                "type": "set_features",
                "expected_revision": revision,
                "features": states[target],
            }
            writer.write(json.dumps(request).encode() + b"\n")
            await writer.drain()
            response = await _response(reader, request["id"])
            assert response["type"] == "ack"
            current = response["state"]
            assert set(current["effective_roles"]) == expected_roles[target]
            common_roles = set(previous["effective_roles"]) & expected_roles[target]
            for role in common_roles:
                assert (
                    current["workers"][role]["pid"] == previous["workers"][role]["pid"]
                )
            revision = current["features"]["revision"]
            previous = current

        backoff_on = {
            "version": 1,
            "id": "backoff-on",
            "token": bootstrap["controller_token"],
            "type": "set_features",
            "expected_revision": revision,
            "features": states["notch"],
        }
        writer.write(json.dumps(backoff_on).encode() + b"\n")
        await writer.drain()
        backoff_on_ack = await _response(reader, "backoff-on")
        crashed_notch_pid = backoff_on_ack["state"]["workers"]["notch"]["pid"]
        assert crashed_notch_pid is not None
        os.killpg(crashed_notch_pid, signal.SIGKILL)
        await _state(
            reader,
            lambda value: (
                value["workers"]["notch"]["restart_count"] == 1
                and value["workers"]["notch"]["lifecycle"] == "exited"
            ),
        )
        disable_during_backoff = {
            **backoff_on,
            "id": "disable-during-backoff",
            "expected_revision": backoff_on_ack["state"]["features"]["revision"],
            "features": states["off"],
        }
        writer.write(json.dumps(disable_during_backoff).encode() + b"\n")
        await writer.drain()
        disabled = await _response(reader, "disable-during-backoff")
        assert disabled["state"]["workers"]["notch"]["lifecycle"] == "disabled"
        await asyncio.sleep(0.4)
        get_after_backoff = {
            "version": 1,
            "id": "after-backoff",
            "token": bootstrap["controller_token"],
            "type": "get_state",
        }
        writer.write(json.dumps(get_after_backoff).encode() + b"\n")
        await writer.drain()
        after_backoff = await _response(reader, "after-backoff")
        assert after_backoff["state"]["workers"]["notch"]["pid"] is None
        assert after_backoff["state"]["workers"]["notch"]["restart_count"] == 1

        shutdown = {
            "version": 1,
            "id": "shutdown",
            "token": bootstrap["controller_token"],
            "type": "shutdown",
        }
        writer.write(json.dumps(shutdown).encode() + b"\n")
        await writer.drain()
        assert (await _response(reader, "shutdown"))["type"] == "ack"
        assert await asyncio.wait_for(process.wait(), 15) == 0
    finally:
        if writer is not None:
            writer.close()
            await writer.wait_closed()
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
            await process.wait()
    after = set(Path("/tmp").glob(f"vibecheck-{os.getuid()}-*"))
    assert after - before == set()


@pytest.mark.asyncio
async def test_controller_loss_grace_exits_without_orphans() -> None:
    root = Path(__file__).resolve().parents[2]
    environment = dict(os.environ)
    environment["TMPDIR"] = "/tmp"
    before = set(Path("/tmp").glob(f"vibecheck-{os.getuid()}-*"))
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "vibecheck.runtime.cli",
        "--controller",
        "--mode",
        "demo",
        "--headless-notch",
        "--no-manage-codex-gui",
        cwd=root,
        env=environment,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        assert process.stdout is not None
        bootstrap = json.loads(await asyncio.wait_for(process.stdout.readline(), 10))
        reader, writer = await asyncio.open_unix_connection(bootstrap["control_socket"])
        await reader.readline()
        writer.close()
        await writer.wait_closed()
        assert await asyncio.wait_for(process.wait(), 10) == 0
    finally:
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
            await process.wait()
    after = set(Path("/tmp").glob(f"vibecheck-{os.getuid()}-*"))
    assert after - before == set()
