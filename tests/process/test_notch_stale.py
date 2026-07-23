from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import sys
import tempfile
from pathlib import Path

import pytest

from vibecheck.emotion.schema import CANONICAL_EMOTIONS
from vibecheck.stream.protocol import EventEnvelope, monotonic_ms
from vibecheck.stream.publisher import SnapshotPublisher


@pytest.mark.asyncio
async def test_headless_notch_clears_icons_when_real_stream_stalls() -> None:
    runtime = Path(tempfile.mkdtemp(prefix="vc-stale-", dir="/tmp"))
    os.chmod(runtime, 0o700)
    socket = runtime / "emotion.sock"
    publisher = SnapshotPublisher(socket, current_ttl_ms=200)
    await publisher.start()
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "vibecheck.notch.process",
        "--emotion-socket",
        str(socket),
        "--freshness",
        "0.2",
        "--headless",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        deadline = asyncio.get_running_loop().time() + 3
        while publisher.subscriber_count < 1:
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError("notch did not connect")
            await asyncio.sleep(0.01)
        scores = {name: 0.0 for name in CANONICAL_EMOTIONS}
        scores["anger"] = 0.9
        for sequence in range(2):
            now = monotonic_ms()
            await publisher.publish(
                EventEnvelope(
                    "reading",
                    "stale-test",
                    sequence,
                    now,
                    now,
                    {
                        "provider": "fixture",
                        "dominant_emotion": "anger",
                        "scores": scores,
                        "face_box": [0, 0, 100, 100],
                        "inference_ms": 1.0,
                    },
                )
            )
            await asyncio.sleep(0.05)

        assert process.stdout is not None
        states = []
        while True:
            line = await asyncio.wait_for(process.stdout.readline(), 2)
            state = json.loads(line)
            if state.get("type") == "worker_health":
                continue
            states.append(state)
            if state["health"] == "Stale":
                assert state["emotions"] == []
                assert any(item["emotions"] == ["anger"] for item in states)
                break
    finally:
        await publisher.close()
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
        await process.wait()
        shutil.rmtree(runtime, ignore_errors=True)
