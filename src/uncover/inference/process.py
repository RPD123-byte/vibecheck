"""One-camera, one-model inference worker and snapshot publisher."""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys
import time
import uuid
from collections.abc import Iterable
from contextlib import suppress
from pathlib import Path
from typing import Any, Protocol

from uncover.emotion.schema import CANONICAL_EMOTIONS, EmotionReading
from uncover.inference.adapters.base import EmotionAdapter
from uncover.inference.permission import CameraPermission, request_camera_permission
from uncover.inference.registry import create_adapter
from uncover.stream.protocol import EventEnvelope
from uncover.stream.publisher import SnapshotPublisher


class FrameSource(Protocol):
    def read(self) -> tuple[bool, Any]: ...

    def close(self) -> None: ...


class CameraFrameSource:
    def __init__(self, camera: int) -> None:
        import cv2

        backend = cv2.CAP_AVFOUNDATION if sys.platform == "darwin" else cv2.CAP_ANY
        self.capture = cv2.VideoCapture(camera, backend)

    @property
    def opened(self) -> bool:
        return bool(self.capture.isOpened())

    def read(self) -> tuple[bool, Any]:
        return self.capture.read()

    def close(self) -> None:
        self.capture.release()


class ImageSequenceFrameSource:
    def __init__(self, paths: Iterable[Path], *, repeat: bool = True) -> None:
        import cv2

        self.frames = [cv2.imread(str(path)) for path in paths]
        if not self.frames or any(frame is None for frame in self.frames):
            raise ValueError("every image-sequence path must decode successfully")
        self.repeat = repeat
        self.index = 0
        self.closed = False

    @property
    def opened(self) -> bool:
        return not self.closed

    def read(self) -> tuple[bool, Any]:
        if self.closed or (not self.repeat and self.index >= len(self.frames)):
            return False, None
        frame = self.frames[self.index % len(self.frames)]
        self.index += 1
        return True, frame.copy()

    def close(self) -> None:
        self.closed = True


class InferenceService:
    def __init__(
        self,
        *,
        publisher: SnapshotPublisher,
        adapter: EmotionAdapter,
        frames: FrameSource,
        runtime_id: str | None = None,
        interval_seconds: float = 0.16,
        no_face_timeout_seconds: float = 0.8,
    ) -> None:
        self.publisher = publisher
        self.adapter = adapter
        self.frames = frames
        self.runtime_id = runtime_id or str(uuid.uuid4())
        self.interval_seconds = interval_seconds
        self.no_face_timeout_seconds = no_face_timeout_seconds
        self.sequence = 0
        self._closed = False
        self._last_face_ms: int | None = None
        self._last_state: str | None = None

    def _now_ms(self) -> int:
        return int(time.monotonic() * 1000)

    async def publish_state(self, state: str, detail: str | None = None) -> None:
        if state == self._last_state and detail is None:
            return
        now_ms = self._now_ms()
        payload: dict[str, Any] = {"state": state}
        if detail:
            payload["detail"] = detail
        await self._publish("producer_state", payload, now_ms)
        self._last_state = state

    async def run(self, stop: asyncio.Event) -> None:
        await self.publisher.start()
        await self.publish_state("loading")
        try:
            while not stop.is_set():
                cycle_started = time.monotonic()
                ok, frame = await asyncio.to_thread(self.frames.read)
                if not ok:
                    await self.publish_state("camera-unavailable")
                    return
                captured_at_ms = self._now_ms()
                try:
                    reading = await asyncio.to_thread(self.adapter.analyze_frame, frame)
                except Exception as exc:
                    await self.publish_state(
                        "inference-error", f"{type(exc).__name__}: {exc}"
                    )
                    await _wait_or_stop(stop, self.interval_seconds)
                    continue
                if reading is None:
                    if self._last_face_ms is None:
                        self._last_face_ms = captured_at_ms
                    if captured_at_ms - self._last_face_ms >= int(
                        self.no_face_timeout_seconds * 1000
                    ):
                        await self.publish_state("no-face")
                else:
                    self._last_face_ms = captured_at_ms
                    self._last_state = "active"
                    await self._publish("reading", reading.to_payload(), captured_at_ms)
                elapsed = time.monotonic() - cycle_started
                await _wait_or_stop(stop, max(0.0, self.interval_seconds - elapsed))
        finally:
            await self.close()

    async def _publish(
        self, kind: str, payload: dict[str, Any], captured_at_ms: int
    ) -> None:
        event = EventEnvelope(
            kind=kind,
            runtime_id=self.runtime_id,
            sequence=self.sequence,
            captured_at_ms=captured_at_ms,
            published_at_ms=self._now_ms(),
            payload=payload,
        )
        self.sequence += 1
        await self.publisher.publish(event)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await asyncio.to_thread(self.frames.close)
        await asyncio.to_thread(self.adapter.close)
        await self.publisher.close()


class SyntheticAdapter(EmotionAdapter):
    name = "synthetic"

    def __init__(self, patterns: list[dict[str, float]]) -> None:
        self.patterns = patterns
        self.index = 0

    def analyze_frame(self, frame: Any) -> EmotionReading | None:
        del frame
        scores = {name: 0.0 for name in CANONICAL_EMOTIONS}
        scores.update(self.patterns[self.index % len(self.patterns)])
        self.index += 1
        dominant = max(CANONICAL_EMOTIONS, key=lambda name: scores[name])
        return EmotionReading("synthetic", dominant, scores, (0, 0, 100, 100), 0.0)


class SyntheticFrames:
    opened = True

    def read(self) -> tuple[bool, object]:
        return True, object()

    def close(self) -> None:
        pass


async def _wait_or_stop(stop: asyncio.Event, seconds: float) -> None:
    if seconds <= 0:
        return
    with suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=seconds)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--runtime-id")
    parser.add_argument("--adapter", default="emotiefflib")
    parser.add_argument("--model", default="enet_b0_8_best_afew")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--interval", type=float, default=0.16)
    parser.add_argument("--freshness", type=float, default=0.75)
    parser.add_argument("--face-threshold", type=float, default=0.90)
    parser.add_argument("--minimum-face-size", type=int, default=40)
    parser.add_argument("--no-face-timeout", type=float, default=0.8)
    parser.add_argument("--image", type=Path, action="append", default=[])
    parser.add_argument("--demo", action="store_true")
    return parser


async def _run_cli(args: argparse.Namespace) -> int:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(name, stop.set)

    publisher = SnapshotPublisher(
        args.socket, current_ttl_ms=round(args.freshness * 1000)
    )
    if args.demo:
        adapter: EmotionAdapter = SyntheticAdapter(
            [
                {"happiness": 0.75, "neutral": 0.15},
                {"anger": 0.92, "neutral": 0.04},
                {"neutral": 0.90},
            ]
        )
        frames: FrameSource = SyntheticFrames()
    else:
        if args.image:
            frames = ImageSequenceFrameSource(args.image)
        else:
            permission = await asyncio.to_thread(request_camera_permission)
            if permission is not CameraPermission.GRANTED:
                await publisher.start()
                now_ms = int(time.monotonic() * 1000)
                await publisher.publish(
                    EventEnvelope(
                        "producer_state",
                        args.runtime_id or str(uuid.uuid4()),
                        0,
                        now_ms,
                        now_ms,
                        {"state": permission.value},
                    )
                )
                await stop.wait()
                await publisher.close()
                return 2
            frames = CameraFrameSource(args.camera)
            if not frames.opened:
                await publisher.start()
                now_ms = int(time.monotonic() * 1000)
                await publisher.publish(
                    EventEnvelope(
                        "producer_state",
                        args.runtime_id or str(uuid.uuid4()),
                        0,
                        now_ms,
                        now_ms,
                        {"state": "camera-unavailable"},
                    )
                )
                await publisher.close()
                return 2
        adapter = create_adapter(
            args.adapter,
            model_name=args.model,
            face_threshold=args.face_threshold,
            minimum_face_size=args.minimum_face_size,
        )
    service = InferenceService(
        publisher=publisher,
        adapter=adapter,
        frames=frames,
        runtime_id=args.runtime_id,
        interval_seconds=args.interval,
        no_face_timeout_seconds=args.no_face_timeout,
    )
    await service.run(stop)
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(_run_cli(_parser().parse_args())))


if __name__ == "__main__":
    main()
