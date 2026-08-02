from __future__ import annotations

import asyncio
import json
import stat
import tempfile
from pathlib import Path

import pytest

from vibecheck.runtime.control import MAX_CONTROL_BYTES, ControlServer


@pytest.mark.asyncio
async def test_control_socket_permissions_auth_and_idempotency() -> None:
    state = {
        "features": {
            "revision": 0,
            "notch_enabled": False,
            "component_reactions_enabled": False,
            "integrations": {"codex_enabled": False},
            "paused": False,
        }
    }
    mutations = 0

    async def mutate(features: dict[str, object], revision: int) -> dict[str, object]:
        nonlocal mutations, state
        assert revision == state["features"]["revision"]  # type: ignore[index]
        mutations += 1
        state = {
            "features": {
                "revision": revision + 1,
                **features,
            }
        }
        return state

    async def recover(_roles: tuple[str, ...]) -> dict[str, object]:
        return state

    socket_dir = Path(tempfile.mkdtemp(prefix="vc-control-", dir="/tmp"))
    server = ControlServer(
        socket_dir / "control.sock",
        runtime_id="runtime",
        snapshot=lambda: state,
        mutate=mutate,
        recover=recover,
        shutdown=lambda: None,
        connection_changed=lambda _connected: None,
    )
    await server.start()
    assert stat.S_IMODE(server.path.stat().st_mode) == 0o600
    reader, writer = await asyncio.open_unix_connection(server.path)
    await reader.readline()
    request = {
        "version": 1,
        "id": "same",
        "token": server.token,
        "type": "set_features",
        "expected_revision": 0,
        "features": {
            "notch_enabled": True,
            "component_reactions_enabled": False,
            "integrations": {"codex_enabled": False},
            "paused": False,
        },
    }
    encoded = json.dumps(request).encode() + b"\n"
    writer.write(encoded)
    await writer.drain()
    assert json.loads(await reader.readline())["type"] == "ack"
    writer.write(encoded)
    await writer.drain()
    assert json.loads(await reader.readline())["type"] == "ack"
    assert mutations == 1
    writer.close()
    await writer.wait_closed()
    await server.close()
    socket_dir.rmdir()


@pytest.mark.asyncio
async def test_control_rejects_bad_auth_and_oversized_frame() -> None:
    async def no_mutation(
        _features: dict[str, object],
        _revision: int,
    ) -> dict[str, object]:
        raise AssertionError

    async def no_recovery(_roles: tuple[str, ...]) -> dict[str, object]:
        raise AssertionError

    socket_dir = Path(tempfile.mkdtemp(prefix="vc-control-", dir="/tmp"))
    server = ControlServer(
        socket_dir / "control.sock",
        runtime_id="runtime",
        snapshot=lambda: {},
        mutate=no_mutation,
        recover=no_recovery,
        shutdown=lambda: None,
        connection_changed=lambda _connected: None,
    )
    await server.start()
    reader, writer = await asyncio.open_unix_connection(server.path)
    await reader.readline()
    writer.write(
        json.dumps(
            {
                "version": 1,
                "id": "bad",
                "token": "wrong",
                "type": "get_state",
            }
        ).encode()
        + b"\n"
    )
    await writer.drain()
    assert json.loads(await reader.readline())["error"]["code"] == "unauthorized"
    writer.write(b"x" * MAX_CONTROL_BYTES + b"\n")
    await writer.drain()
    assert json.loads(await reader.readline())["error"]["code"] == "frame_too_large"
    writer.close()
    await writer.wait_closed()
    await server.close()
    socket_dir.rmdir()


@pytest.mark.asyncio
async def test_control_serializes_concurrent_revisions_and_rejects_second_owner() -> (
    None
):
    revision = 0

    async def mutate(
        features: dict[str, object],
        expected: int,
    ) -> dict[str, object]:
        nonlocal revision
        if expected != revision:
            raise ValueError("stale revision")
        await asyncio.sleep(0)
        revision += 1
        return {"features": {"revision": revision, **features}}

    async def recover(_roles: tuple[str, ...]) -> dict[str, object]:
        return {"features": {"revision": revision}}

    socket_dir = Path(tempfile.mkdtemp(prefix="vc-control-", dir="/tmp"))
    server = ControlServer(
        socket_dir / "control.sock",
        runtime_id="runtime",
        snapshot=lambda: {"features": {"revision": revision}},
        mutate=mutate,
        recover=recover,
        shutdown=lambda: None,
        connection_changed=lambda _connected: None,
    )
    await server.start()
    reader, writer = await asyncio.open_unix_connection(server.path)
    await reader.readline()
    contender_reader, contender_writer = await asyncio.open_unix_connection(server.path)
    contender = json.loads(await contender_reader.readline())
    assert contender["error"]["code"] == "controller_owned"
    contender_writer.close()
    await contender_writer.wait_closed()

    base = {
        "version": 1,
        "token": server.token,
        "type": "set_features",
        "expected_revision": 0,
        "features": {
            "notch_enabled": True,
            "component_reactions_enabled": False,
            "integrations": {"codex_enabled": False},
            "paused": False,
        },
    }
    writer.write(
        json.dumps({**base, "id": "one"}).encode()
        + b"\n"
        + json.dumps({**base, "id": "two"}).encode()
        + b"\n"
    )
    await writer.drain()
    responses = [json.loads(await reader.readline()) for _ in range(2)]
    assert {item["type"] for item in responses} == {"ack", "error"}
    assert revision == 1
    writer.close()
    await writer.wait_closed()
    await server.close()
    socket_dir.rmdir()
