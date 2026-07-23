from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from pathlib import Path

import pytest


@pytest.mark.asyncio
async def test_runtime_starts_three_workers_and_ctrl_c_stops_only_owned_workers() -> (
    None
):
    root = Path(__file__).resolve().parents[2]
    before = set(Path("/tmp").glob(f"uncover-{os.getuid()}-*"))
    environment = dict(os.environ)
    environment["TMPDIR"] = "/tmp"
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "uncover.runtime.cli",
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
    health: dict | None = None
    observed_emotion = False
    try:

        async def wait_until_running() -> None:
            nonlocal health, observed_emotion
            assert process.stdout is not None
            while line := await process.stdout.readline():
                event = json.loads(line)
                if event.get("type") == "runtime_health":
                    health = event
                if event.get(
                    "role"
                ) == "notch" and '"emotions": ["anger"]' in event.get("message", ""):
                    observed_emotion = True
                if health and observed_emotion:
                    return
            stderr = (
                (await process.stderr.read()).decode(errors="replace")
                if process.stderr
                else ""
            )
            raise AssertionError(f"runtime exited unexpectedly: {stderr}")

        await asyncio.wait_for(wait_until_running(), 30)
        assert health is not None
        assert set(health["workers"]) == {"inference", "notch", "interruption"}
        assert all(worker["ready"] for worker in health["workers"].values())
        original_pids = {
            role: worker["pid"] for role, worker in health["workers"].items()
        }
        os.killpg(original_pids["notch"], signal.SIGKILL)

        async def wait_for_notch_restart() -> dict:
            assert process.stdout is not None
            while line := await process.stdout.readline():
                event = json.loads(line)
                if event.get("type") != "runtime_health":
                    continue
                workers = event["workers"]
                if (
                    workers["notch"]["ready"]
                    and workers["notch"]["restart_count"] == 1
                    and workers["notch"]["pid"] != original_pids["notch"]
                ):
                    return workers
            raise AssertionError("runtime exited before restarting the notch")

        restarted = await asyncio.wait_for(wait_for_notch_restart(), 15)
        assert restarted["inference"]["pid"] == original_pids["inference"]
        assert restarted["interruption"]["pid"] == original_pids["interruption"]
        os.killpg(process.pid, signal.SIGINT)
        assert await asyncio.wait_for(process.wait(), 12) == 0
    finally:
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
            await process.wait()
    after = set(Path("/tmp").glob(f"uncover-{os.getuid()}-*"))
    assert after - before == set(), "runtime must remove its transient directory"
