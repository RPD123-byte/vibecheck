from __future__ import annotations

import asyncio
import os
import shutil
import signal
import tempfile
from pathlib import Path

import pytest

from uncover.emotion.schema import CANONICAL_EMOTIONS
from uncover.stream.protocol import EventEnvelope, monotonic_ms
from uncover.stream.publisher import SnapshotPublisher
from uncover.stream.subscriber import SnapshotSubscriber


@pytest.mark.asyncio
async def test_rust_sidecar_consumes_real_socket_and_publishes_would_send() -> None:
    root = Path(__file__).resolve().parents[2]
    manifest = root / "src/native/expression_interruption/Cargo.toml"
    runtime_dir = Path(tempfile.mkdtemp(prefix="uc-rust-", dir="/tmp"))
    os.chmod(runtime_dir, 0o700)
    emotion_socket = runtime_dir / "emotion.sock"
    status_socket = runtime_dir / "status.sock"
    publisher = SnapshotPublisher(emotion_socket)
    await publisher.start()
    process = await asyncio.create_subprocess_exec(
        "cargo",
        "run",
        "--quiet",
        "--manifest-path",
        str(manifest),
        "--",
        "--emotion-socket",
        str(emotion_socket),
        "--status-socket",
        str(status_socket),
        "--runtime-id",
        "rust-process-test",
        "--hold-ms",
        "250",
        "--cooldown-ms",
        "0",
        "--freshness-ms",
        "750",
        "--no-manage-gui",
        "--dry-run",
        cwd=root,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    subscriber = SnapshotSubscriber(status_socket, freshness_ms=10_000)
    iterator = subscriber.events()
    try:
        ready = await asyncio.wait_for(anext(iterator), 15)
        assert ready.event.payload["state"] == "dry_run_ready"
        deadline = asyncio.get_running_loop().time() + 5
        while publisher.subscriber_count < 1:
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError("Rust sidecar did not connect to emotion socket")
            await asyncio.sleep(0.01)

        scores = {name: 0.0 for name in CANONICAL_EMOTIONS}
        scores.update({"disgust": 0.91, "neutral": 0.04})
        status_update = asyncio.create_task(anext(iterator))
        for sequence in range(5):
            now = monotonic_ms()
            await publisher.publish(
                EventEnvelope(
                    "reading",
                    "inference-runtime",
                    sequence,
                    now,
                    now,
                    {
                        "provider": "fixture",
                        "dominant_emotion": "disgust",
                        "scores": scores,
                        "face_box": [0, 0, 100, 100],
                        "inference_ms": 1.0,
                    },
                )
            )
            await asyncio.sleep(0.30)

        result = await asyncio.wait_for(status_update, 5)
        assert result.event.payload["state"] == "would_send"
        assert result.event.payload["emotions"][0]["name"] == "disgust"
        assert "disgusted" in result.event.payload["message"]
        assert "may be imperfect" in result.event.payload["message"]
    finally:
        subscriber.close()
        await iterator.aclose()
        await publisher.close()
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
        await asyncio.wait_for(process.wait(), 5)
        shutil.rmtree(runtime_dir, ignore_errors=True)
