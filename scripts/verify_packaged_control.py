#!/usr/bin/env python3
"""Exercise dynamic control using only the frozen packaged runtime."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import signal
import stat
import tempfile
from pathlib import Path
from typing import Any


async def read_for(
    reader: asyncio.StreamReader,
    predicate: Any,
    *,
    timeout: float = 45,
) -> dict[str, Any]:
    async def read() -> dict[str, Any]:
        while line := await reader.readline():
            message = json.loads(line)
            assert "expression" not in json.dumps(message).lower()
            if predicate(message):
                return message
        raise AssertionError("control socket closed before the expected message")

    return await asyncio.wait_for(read(), timeout)


async def request(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    bootstrap: dict[str, Any],
    request_id: str,
    kind: str,
    **fields: Any,
) -> dict[str, Any]:
    writer.write(
        json.dumps(
            {
                "version": 1,
                "id": request_id,
                "token": bootstrap["controller_token"],
                "type": kind,
                **fields,
            }
        ).encode()
        + b"\n"
    )
    await writer.drain()
    return await read_for(reader, lambda value: value.get("id") == request_id)


async def set_features(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    bootstrap: dict[str, Any],
    state: dict[str, Any],
    request_id: str,
    *,
    notch: bool,
    codex: bool,
    paused: bool,
) -> dict[str, Any]:
    response = await request(
        reader,
        writer,
        bootstrap,
        request_id,
        "set_features",
        expected_revision=state["features"]["revision"],
        features={
            "notch_enabled": notch,
            "integrations": {"codex_enabled": codex},
            "paused": paused,
        },
    )
    assert response["type"] == "ack"
    return response["state"]


async def wait_for_state(
    reader: asyncio.StreamReader,
    state: dict[str, Any],
    predicate: Any,
) -> dict[str, Any]:
    if predicate(state):
        return state
    return (
        await read_for(
            reader,
            lambda value: (
                isinstance(value.get("state"), dict)
                and predicate(value["state"])
            ),
        )
    )["state"]


async def verify(runtime: Path) -> None:
    temporary_root = Path(
        tempfile.mkdtemp(prefix="vibecheck-packaged-control-", dir="/tmp")
    )
    environment = {
        **os.environ,
        "TMPDIR": str(temporary_root),
        "PYTHONPATH": "",
        "PYTHONHOME": "",
    }
    command = [
        str(runtime),
        "--controller",
        "--mode",
        "demo",
        "--headless-notch",
        "--no-manage-codex-gui",
    ]
    if shutil.which("sandbox-exec"):
        command = [
            "sandbox-exec",
            "-p",
            (
                "(version 1) (allow default) "
                "(deny network-outbound (remote ip)) "
                "(deny network-inbound (local ip))"
            ),
            *command,
        ]
    process = await asyncio.create_subprocess_exec(
        *command,
        env=environment,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    writer: asyncio.StreamWriter | None = None
    try:
        assert process.stdout is not None
        bootstrap_line = await asyncio.wait_for(process.stdout.readline(), 20)
        if not bootstrap_line:
            assert process.stderr is not None
            stderr = (await process.stderr.read()).decode(errors="replace")
            raise AssertionError(
                f"packaged runtime exited before bootstrap: {stderr.strip()}"
            )
        bootstrap = json.loads(bootstrap_line)
        socket_path = Path(bootstrap["control_socket"])
        assert stat.S_IMODE(socket_path.stat().st_mode) == 0o600
        reader, writer = await asyncio.open_unix_connection(socket_path)
        state = (await read_for(reader, lambda value: "state" in value))["state"]
        assert state["aggregate"] == "off"
        assert state["effective_roles"] == []

        state = await set_features(
            reader,
            writer,
            bootstrap,
            state,
            "notch-on",
            notch=True,
            codex=False,
            paused=False,
        )
        state = await wait_for_state(
            reader,
            state,
            lambda value: value["aggregate"] == "active",
        )
        assert set(state["effective_roles"]) == {"inference", "notch"}

        state = await set_features(
            reader,
            writer,
            bootstrap,
            state,
            "codex-on",
            notch=True,
            codex=True,
            paused=False,
        )
        state = await wait_for_state(
            reader,
            state,
            lambda value: (
                value["aggregate"] == "active"
                and set(value["effective_roles"])
                == {"inference", "interruption", "notch"}
            ),
        )

        state = await set_features(
            reader,
            writer,
            bootstrap,
            state,
            "pause",
            notch=True,
            codex=True,
            paused=True,
        )
        state = await wait_for_state(
            reader,
            state,
            lambda value: (
                value["aggregate"] == "paused" and value["effective_roles"] == []
            ),
        )

        state = await set_features(
            reader,
            writer,
            bootstrap,
            state,
            "resume",
            notch=True,
            codex=True,
            paused=False,
        )
        state = await wait_for_state(
            reader,
            state,
            lambda value: value["aggregate"] == "active",
        )

        await request(reader, writer, bootstrap, "shutdown", "shutdown")
        await asyncio.wait_for(process.wait(), 25)
        assert process.returncode == 0
        assert not socket_path.parent.exists()
    finally:
        if writer is not None:
            writer.close()
            await writer.wait_closed()
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), 10)
            except TimeoutError:
                os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
        shutil.rmtree(temporary_root, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "runtime",
        type=Path,
        nargs="?",
        default=Path("dist/runtime/vibecheck-runtime/vibecheck-runtime"),
    )
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if not runtime.is_file():
        raise SystemExit(f"packaged runtime not found: {runtime}")
    asyncio.run(verify(runtime))
    print("Packaged dynamic control verified.")


if __name__ == "__main__":
    main()
