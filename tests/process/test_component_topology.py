from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest


@pytest.mark.asyncio
async def test_component_only_topology_never_starts_inference() -> None:
    root = Path(__file__).resolve().parents[2]
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(root / "src")
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
    assert process.stdout is not None
    bootstrap = json.loads(await asyncio.wait_for(process.stdout.readline(), 10))
    reader, writer = await asyncio.open_unix_connection(bootstrap["control_socket"])
    try:

        async def response(request_id: str) -> dict:
            while line := await reader.readline():
                message = json.loads(line)
                if message.get("id") == request_id:
                    return message
            raise AssertionError("control connection closed before response")

        await asyncio.wait_for(reader.readline(), 5)
        request = {
            "version": 1,
            "id": "component-on",
            "token": bootstrap["controller_token"],
            "type": "set_features",
            "expected_revision": 0,
            "features": {
                "notch_enabled": False,
                "component_reactions_enabled": True,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
        }
        writer.write(json.dumps(request).encode() + b"\n")
        await writer.drain()

        async def wait_for_component_ready() -> dict:
            while line := await reader.readline():
                event = json.loads(line)
                state = event.get("state", {})
                component = state.get("component_reactions", {})
                if (
                    state.get("features", {}).get("component_reactions_enabled")
                    and component.get("reaction_socket")
                    and state.get("workers", {}).get("interruption", {}).get("ready")
                ):
                    return state
            raise AssertionError("control connection closed before component readiness")

        state = await asyncio.wait_for(wait_for_component_ready(), 90)
        interruption_pid = state["workers"]["interruption"]["pid"]
        assert state["desired_roles"] == ["interruption"]
        assert state["effective_roles"] == ["interruption"]
        assert state["workers"]["inference"]["pid"] is None
        assert state["workers"]["inference"]["lifecycle"] == "disabled"
        reaction_socket = Path(state["component_reactions"]["reaction_socket"])
        runtime_dir = reaction_socket.parent
        assert not (runtime_dir / "emotion.sock").exists()

        screenshot = runtime_dir / "fixture-event.png"
        screenshot.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        reaction_reader, reaction_writer = await asyncio.open_unix_connection(
            reaction_socket
        )
        reaction_writer.write(
            json.dumps(
                {
                    "schema_version": 1,
                    "event_id": "fixture-event",
                    "captured_at_ms": 1,
                    "source_application_name": "Fixture",
                    "source_bundle_id": "com.example.fixture",
                    "reaction_emoji": "🎯",
                    "reaction_label": "Target",
                    "copy_text": "Save changes",
                    "screenshot_path": str(screenshot),
                }
            ).encode()
            + b"\n"
        )
        await reaction_writer.drain()
        reaction_result = json.loads(
            await asyncio.wait_for(reaction_reader.readline(), 5)
        )
        assert reaction_result == {
            "schema_version": 1,
            "event_id": "fixture-event",
            "outcome": "would_send",
        }
        reaction_writer.close()
        await reaction_writer.wait_closed()
        screenshot.unlink()

        writer.write(
            json.dumps(
                {
                    **request,
                    "id": "codex-on",
                    "expected_revision": 1,
                    "features": {
                        "notch_enabled": False,
                        "component_reactions_enabled": True,
                        "integrations": {"codex_enabled": True},
                        "paused": False,
                    },
                }
            ).encode()
            + b"\n"
        )
        await writer.drain()
        codex_on = await asyncio.wait_for(response("codex-on"), 30)
        assert codex_on["state"]["workers"]["interruption"]["pid"] == interruption_pid
        assert (runtime_dir / "component-reactions.enabled").is_file()

        writer.write(
            json.dumps(
                {
                    **request,
                    "id": "component-off",
                    "expected_revision": 2,
                    "features": {
                        "notch_enabled": False,
                        "component_reactions_enabled": False,
                        "integrations": {"codex_enabled": True},
                        "paused": False,
                    },
                }
            ).encode()
            + b"\n"
        )
        await writer.drain()
        component_off = await asyncio.wait_for(response("component-off"), 30)
        assert (
            component_off["state"]["workers"]["interruption"]["pid"] == interruption_pid
        )
        assert component_off["state"]["component_reactions"]["reaction_socket"] is None
        assert not (runtime_dir / "component-reactions.enabled").exists()

        disabled_screenshot = runtime_dir / "disabled-event.png"
        disabled_screenshot.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        disabled_reader, disabled_writer = await asyncio.open_unix_connection(
            reaction_socket
        )
        disabled_writer.write(
            json.dumps(
                {
                    "schema_version": 1,
                    "event_id": "disabled-event",
                    "captured_at_ms": 2,
                    "source_application_name": "Fixture",
                    "source_bundle_id": "com.example.fixture",
                    "reaction_emoji": "✅",
                    "reaction_label": "Done",
                    "copy_text": "Disabled",
                    "screenshot_path": str(disabled_screenshot),
                }
            ).encode()
            + b"\n"
        )
        await disabled_writer.drain()
        disabled_result = json.loads(
            await asyncio.wait_for(disabled_reader.readline(), 5)
        )
        assert disabled_result["event_id"] == "disabled-event"
        assert disabled_result["outcome"] == "rejected"
        assert disabled_result["detail"] == "component input is disabled"
        disabled_writer.close()
        await disabled_writer.wait_closed()
        disabled_screenshot.unlink()

        writer.write(
            json.dumps(
                {
                    "version": 1,
                    "id": "shutdown",
                    "token": bootstrap["controller_token"],
                    "type": "shutdown",
                }
            ).encode()
            + b"\n"
        )
        await writer.drain()
        await asyncio.wait_for(process.wait(), 12)
        assert process.returncode == 0
    finally:
        writer.close()
        await writer.wait_closed()
        if process.returncode is None:
            process.terminate()
            await process.wait()
