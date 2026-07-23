from __future__ import annotations

import asyncio

import pytest

from uncover.inference.process import InferenceService


class ClosingPublisher:
    def __init__(self) -> None:
        self.starts = 0
        self.closes = 0

    async def start(self) -> None:
        self.starts += 1

    async def publish(self, event: object) -> None:
        del event

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
