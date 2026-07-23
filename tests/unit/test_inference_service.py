from __future__ import annotations

import asyncio

import pytest

from vibecheck.inference.process import InferenceService, LatestFrameBuffer


class ClosingPublisher:
    def __init__(self) -> None:
        self.starts = 0
        self.closes = 0
        self.events: list[object] = []

    async def start(self) -> None:
        self.starts += 1

    async def publish(self, event: object) -> None:
        self.events.append(event)

    async def close(self) -> None:
        self.closes += 1


class ClosingResource:
    def __init__(self, *, readable: bool = True) -> None:
        self.readable = readable
        self.closes = 0

    def read(self) -> tuple[bool, object | None]:
        return self.readable, object() if self.readable else None

    def analyze_frame(self, frame: object) -> None:
        del frame
        return None

    def close(self) -> None:
        self.closes += 1


@pytest.mark.asyncio
async def test_shutdown_closes_every_resource_exactly_once() -> None:
    publisher = ClosingPublisher()
    adapter = ClosingResource()
    frames = ClosingResource()
    service = InferenceService(
        publisher=publisher,  # type: ignore[arg-type]
        adapter=adapter,  # type: ignore[arg-type]
        frames=frames,  # type: ignore[arg-type]
    )
    stop = asyncio.Event()
    stop.set()
    await service.run(stop)
    await service.close()
    assert publisher.starts == 1
    assert publisher.closes == 1
    assert adapter.closes == 1
    assert frames.closes == 1


@pytest.mark.asyncio
async def test_ordinary_camera_end_uses_the_same_cleanup_path() -> None:
    publisher = ClosingPublisher()
    adapter = ClosingResource()
    frames = ClosingResource(readable=False)
    service = InferenceService(
        publisher=publisher,  # type: ignore[arg-type]
        adapter=adapter,  # type: ignore[arg-type]
        frames=frames,  # type: ignore[arg-type]
    )
    await service.run(asyncio.Event())
    assert publisher.closes == adapter.closes == frames.closes == 1


def test_latest_frame_buffer_drops_older_unconsumed_frames() -> None:
    buffer = LatestFrameBuffer()
    buffer.put("frame-1")
    buffer.put("frame-2")
    buffer.put("frame-3")
    assert buffer.take_after(0, timeout_seconds=0.01) == (3, "frame-3")
    buffer.close()


@pytest.mark.asyncio
async def test_no_face_state_remains_fresh_with_repeated_heartbeats() -> None:
    publisher = ClosingPublisher()
    adapter = ClosingResource()
    frames = ClosingResource()
    service = InferenceService(
        publisher=publisher,  # type: ignore[arg-type]
        adapter=adapter,  # type: ignore[arg-type]
        frames=frames,  # type: ignore[arg-type]
        interval_seconds=0.02,
        no_face_timeout_seconds=0,
    )
    stop = asyncio.Event()
    asyncio.get_running_loop().call_later(0.09, stop.set)
    await service.run(stop)
    no_face_events = [
        event
        for event in publisher.events
        if getattr(event, "payload", {}).get("state") == "no-face"
    ]
    assert len(no_face_events) >= 3
