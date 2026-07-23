from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import signal
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

import pytest

from uncover.stream.subscriber import SnapshotSubscriber

pytestmark = [
    pytest.mark.model,
    pytest.mark.skipif(
        os.environ.get("UNCOVER_RUN_MODEL_TESTS") != "1",
        reason="set UNCOVER_RUN_MODEL_TESTS=1 to run licensed real-image tests",
    ),
]

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "tests/fixtures/faces/manifest.json").read_text())
RUST_MANIFEST = ROOT / "src/native/expression_interruption/Cargo.toml"


def fetch_fixture(name: str, cache_dir: Path) -> Path:
    metadata = MANIFEST[name]
    target = cache_dir / metadata["filename"]
    if target.exists() and _sha256(target) == metadata["sha256"]:
        return target
    request = urllib.request.Request(
        metadata["url"],
        headers={
            "User-Agent": "UncoverTests/0.1 (https://github.com/RPD123-byte/uncover)"
        },
    )
    target.write_bytes(urllib.request.urlopen(request, timeout=30).read())
    assert _sha256(target) == metadata["sha256"], "fixture checksum mismatch"
    return target


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def start_process(*command: str) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        *command,
        cwd=ROOT,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )


async def wait_for_state(
    process: asyncio.subprocess.Process,
    predicate: Any,
    *,
    timeout: float = 45,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    states: list[dict[str, Any]] = []

    async def read() -> dict[str, Any]:
        assert process.stdout is not None
        while line := await process.stdout.readline():
            state = json.loads(line)
            if state.get("type") == "worker_health":
                continue
            states.append(state)
            if predicate(state):
                return state
        stderr = (
            (await process.stderr.read()).decode(errors="replace")
            if process.stderr
            else ""
        )
        raise AssertionError(f"notch exited before expected state; stderr={stderr}")

    return await asyncio.wait_for(read(), timeout), states


async def stop_processes(processes: list[asyncio.subprocess.Process]) -> None:
    for process in reversed(processes):
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
    await asyncio.gather(
        *(asyncio.wait_for(process.wait(), 8) for process in processes),
        return_exceptions=True,
    )
    for process in processes:
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGKILL)
            await process.wait()


@pytest.mark.asyncio
async def test_disgust_image_drives_notch_and_dry_run_interruption(
    tmp_path: Path,
) -> None:
    image = fetch_fixture("disgust", tmp_path)
    runtime = Path(tempfile.mkdtemp(prefix="uc-model-", dir="/tmp"))
    os.chmod(runtime, 0o700)
    emotion_socket = runtime / "emotion.sock"
    status_socket = runtime / "status.sock"
    processes: list[asyncio.subprocess.Process] = []
    try:
        notch = await start_process(
            sys.executable,
            "-m",
            "uncover.notch.process",
            "--emotion-socket",
            str(emotion_socket),
            "--status-socket",
            str(status_socket),
            "--headless",
        )
        processes.append(notch)
        interruption = await start_process(
            "cargo",
            "run",
            "--quiet",
            "--manifest-path",
            str(RUST_MANIFEST),
            "--",
            "--emotion-socket",
            str(emotion_socket),
            "--status-socket",
            str(status_socket),
            "--runtime-id",
            "real-disgust-test",
            "--dry-run",
            "--no-manage-gui",
        )
        processes.append(interruption)
        inference = await start_process(
            sys.executable,
            "-m",
            "uncover.inference.process",
            "--socket",
            str(emotion_socket),
            "--image",
            str(image),
        )
        processes.append(inference)

        state, seen = await wait_for_state(
            notch,
            lambda value: (
                value["emotions"] == ["disgust"] and value["emphasis"] == "success"
            ),
        )
        assert state["icons"] == ["🤢"]
        assert state["scores"]["disgust"] > 0.5
        assert any(value["emotions"] == ["disgust"] for value in seen)
    finally:
        await stop_processes(processes)
        shutil.rmtree(runtime, ignore_errors=True)


@pytest.mark.asyncio
async def test_happy_image_shows_happiness_without_neutral_icon(tmp_path: Path) -> None:
    image = fetch_fixture("happiness", tmp_path)
    runtime = Path(tempfile.mkdtemp(prefix="uc-model-", dir="/tmp"))
    os.chmod(runtime, 0o700)
    emotion_socket = runtime / "emotion.sock"
    status_socket = runtime / "status.sock"
    processes: list[asyncio.subprocess.Process] = []
    subscriber = SnapshotSubscriber(status_socket, freshness_ms=10_000)
    statuses = subscriber.events()
    try:
        notch = await start_process(
            sys.executable,
            "-m",
            "uncover.notch.process",
            "--emotion-socket",
            str(emotion_socket),
            "--status-socket",
            str(status_socket),
            "--headless",
        )
        processes.append(notch)
        interruption = await start_process(
            "cargo",
            "run",
            "--quiet",
            "--manifest-path",
            str(RUST_MANIFEST),
            "--",
            "--emotion-socket",
            str(emotion_socket),
            "--status-socket",
            str(status_socket),
            "--runtime-id",
            "real-happiness-test",
            "--hold-ms",
            "500",
            "--dry-run",
            "--no-manage-gui",
        )
        processes.append(interruption)
        ready = await asyncio.wait_for(anext(statuses), 15)
        assert ready.event.payload["state"] == "dry_run_ready"
        inference = await start_process(
            sys.executable,
            "-m",
            "uncover.inference.process",
            "--socket",
            str(emotion_socket),
            "--image",
            str(image),
        )
        processes.append(inference)

        state, _ = await wait_for_state(
            notch, lambda value: value["emotions"] == ["happiness"]
        )
        assert state["icons"] == ["😊"]
        assert state["scores"]["happiness"] > 0.5
        assert "😐" not in state["icons"]
        assert state["emphasis"] is None
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(anext(statuses), 1.3)
    finally:
        subscriber.close()
        await statuses.aclose()
        await stop_processes(processes)
        shutil.rmtree(runtime, ignore_errors=True)
