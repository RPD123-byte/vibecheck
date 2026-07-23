from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import threading
import time
from argparse import Namespace
from pathlib import Path

import pytest

from vibecheck.emotion.schema import CANONICAL_EMOTIONS, EmotionReading
from vibecheck.inference import process as inference_process
from vibecheck.stream.subscriber import SnapshotSubscriber


class StartupFrames:
    opened = True

    def __init__(self, finish: threading.Event) -> None:
        self.finish = finish
        self.reads = 0
        self.closes = 0

    def read(self) -> tuple[bool, object | None]:
        self.reads += 1
        if self.reads == 1:
            return True, object()
        self.finish.wait(timeout=5)
        return False, None

    def close(self) -> None:
        self.closes += 1


class StartupAdapter:
    def __init__(self, started: threading.Event, release: threading.Event) -> None:
        self.started = started
        self.release = release
        self.closes = 0

    def initialize(self) -> StartupAdapter:
        self.started.set()
        if not self.release.wait(timeout=5):
            raise TimeoutError("test did not release delayed adapter initialization")
        return self

    def analyze_frame(self, frame: object) -> EmotionReading:
        del frame
        scores = {name: 0.0 for name in CANONICAL_EMOTIONS}
        scores["happiness"] = 0.80
        scores["neutral"] = 0.20
        return EmotionReading(
            "startup-test",
            "happiness",
            scores,
            (0, 0, 100, 100),
            1.0,
        )

    def close(self) -> None:
        self.closes += 1


@pytest.mark.asyncio
async def test_loading_stays_fresh_through_delayed_adapter_initialization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = Path(tempfile.mkdtemp(prefix="vc-load-", dir="/tmp"))
    os.chmod(runtime, 0o700)
    emotion_socket = runtime / "emotion.sock"
    adapter_started = threading.Event()
    release_adapter = threading.Event()
    finish_frames = threading.Event()
    frames = StartupFrames(finish_frames)
    adapter = StartupAdapter(adapter_started, release_adapter)

    monkeypatch.setattr(
        inference_process,
        "ImageSequenceFrameSource",
        lambda paths: frames,
    )
    monkeypatch.setattr(
        inference_process,
        "create_adapter",
        lambda *args, **kwargs: adapter.initialize(),
    )
    args = Namespace(
        socket=emotion_socket,
        runtime_id="delayed-startup",
        adapter="emotiefflib",
        model="test-model",
        camera=0,
        interval=0.01,
        freshness=0.20,
        face_threshold=0.90,
        minimum_face_size=40,
        no_face_timeout=0.8,
        image=[Path("unused.jpg")],
        demo=False,
    )
    stop = asyncio.Event()
    worker = asyncio.create_task(inference_process._run_worker(args, stop))
    subscriber = SnapshotSubscriber(emotion_socket, freshness_ms=200)
    events = subscriber.events()

    try:
        assert await asyncio.to_thread(adapter_started.wait, 2)
        first = await asyncio.wait_for(anext(events), 1)
        assert first.event.kind == "producer_state"
        assert first.event.payload == {"state": "loading"}

        loading_events = [first.event]
        loading_deadline = time.monotonic() + 0.45
        while time.monotonic() < loading_deadline:
            item = await asyncio.wait_for(anext(events), 0.3)
            assert item.event.kind == "producer_state"
            assert item.event.payload == {"state": "loading"}
            loading_events.append(item.event)

        assert (
            loading_events[-1].published_at_ms - loading_events[0].published_at_ms
            >= 300
        )
        assert [event.sequence for event in loading_events] == sorted(
            event.sequence for event in loading_events
        )

        release_adapter.set()
        while True:
            item = await asyncio.wait_for(anext(events), 2)
            if item.event.kind == "reading":
                break
        assert item.event.payload["dominant_emotion"] == "happiness"
        assert item.event.sequence > loading_events[-1].sequence
        finish_frames.set()
        assert await asyncio.wait_for(worker, 2) == 0
        assert frames.closes == adapter.closes == 1
    finally:
        release_adapter.set()
        finish_frames.set()
        stop.set()
        subscriber.close()
        await events.aclose()
        if not worker.done():
            await asyncio.wait_for(worker, 2)
        shutil.rmtree(runtime, ignore_errors=True)
