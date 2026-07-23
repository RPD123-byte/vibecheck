"""One-camera, one-model inference worker and snapshot publisher."""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import sys
import threading
import time
import uuid
from collections.abc import Iterable
from contextlib import suppress
from pathlib import Path
from typing import Any, Protocol

from vibecheck.emotion.schema import CANONICAL_EMOTIONS, EmotionReading
from vibecheck.inference.adapters.base import EmotionAdapter
from vibecheck.inference.permission import CameraPermission, request_camera_permission
from vibecheck.inference.registry import create_adapter
from vibecheck.stream.protocol import (
    DEFAULT_FRESHNESS_SECONDS,
    EventEnvelope,
    monotonic_ms,
)
from vibecheck.stream.publisher import SnapshotPublisher


class FrameSource(Protocol):
    def read(self) -> tuple[bool, Any]: ...

    def close(self) -> None: ...


class LatestFrameBuffer:
    """Thread-safe one-frame buffer that never queues stale camera frames."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._sequence = 0
        self._frame: Any | None = None
        self._closed = False

    def put(self, frame: Any) -> None:
        with self._condition:
            if self._closed:
                return
            self._sequence += 1
            self._frame = frame
            self._condition.notify_all()

    def take_after(
        self, sequence: int, *, timeout_seconds: float
    ) -> tuple[int, Any] | None:
        deadline = time.monotonic() + timeout_seconds
        with self._condition:
            while not self._closed and self._sequence <= sequence:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)
            if self._frame is None or self._sequence <= sequence:
                return None
            return self._sequence, self._frame

    def close(self) -> None:
        with self._condition:
            self._closed = True
            self._frame = None
            self._condition.notify_all()


class CameraFrameSource:
    def __init__(self, camera: int, *, capture: Any | None = None) -> None:
        import cv2

        if capture is None:
            backend = cv2.CAP_AVFOUNDATION if sys.platform == "darwin" else cv2.CAP_ANY
            capture = cv2.VideoCapture(camera, backend)
        self.capture = capture
        self._buffer = LatestFrameBuffer()
        self._last_sequence = 0
        self._stop = threading.Event()
        self._closed = False
        self._thread: threading.Thread | None = None
        if self.opened:
            self._thread = threading.Thread(
                target=self._capture_latest,
                name="vibecheck-camera-capture",
                daemon=True,
            )
            self._thread.start()

    @property
    def opened(self) -> bool:
        return bool(self.capture.isOpened())

    def read(self) -> tuple[bool, Any]:
        item = self._buffer.take_after(
            self._last_sequence,
            timeout_seconds=2.0,
        )
        if item is None:
            return False, None
        self._last_sequence, frame = item
        return True, frame.copy()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._stop.set()
        self.capture.release()
        self._buffer.close()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def _capture_latest(self) -> None:
        while not self._stop.is_set():
            ok, frame = self.capture.read()
            if not ok:
                self._buffer.close()
                return
            self._buffer.put(frame)


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


class InferenceEventStream:
    """Sequenced inference events with a freshness-preserving loading state."""

    def __init__(
        self,
        publisher: SnapshotPublisher,
        *,
        runtime_id: str | None = None,
        freshness_seconds: float = DEFAULT_FRESHNESS_SECONDS,
    ) -> None:
        self.publisher = publisher
        self.runtime_id = runtime_id or str(uuid.uuid4())
        self.freshness_seconds = freshness_seconds
        self.sequence = 0
        self._started = False
        self._closed = False
        self._loading_task: asyncio.Task[None] | None = None

    async def start_loading(self) -> None:
        if self._started:
            return
        await self.publisher.start()
        self._started = True
        await self._emit_state("loading")
        self._loading_task = asyncio.create_task(self._loading_heartbeat())

    async def publish(
        self,
        kind: str,
        payload: dict[str, Any],
        captured_at_ms: int,
    ) -> None:
        if kind != "producer_state" or payload.get("state") != "loading":
            await self.stop_loading()
        await self._emit(kind, payload, captured_at_ms)

    async def publish_state(
        self,
        state: str,
        detail: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {"state": state}
        if detail:
            payload["detail"] = detail
        await self.publish("producer_state", payload, monotonic_ms())

    async def stop_loading(self) -> None:
        task = self._loading_task
        self._loading_task = None
        if task is None:
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self.stop_loading()
        await self.publisher.close()

    async def _loading_heartbeat(self) -> None:
        interval = max(0.05, self.freshness_seconds / 2)
        while True:
            await asyncio.sleep(interval)
            await self._emit_state("loading")

    async def _emit_state(self, state: str) -> None:
        now_ms = monotonic_ms()
        await self._emit("producer_state", {"state": state}, now_ms)

    async def _emit(
        self,
        kind: str,
        payload: dict[str, Any],
        captured_at_ms: int,
    ) -> None:
        sequence = self.sequence
        self.sequence += 1
        await self.publisher.publish(
            EventEnvelope(
                kind=kind,
                runtime_id=self.runtime_id,
                sequence=sequence,
                captured_at_ms=captured_at_ms,
                published_at_ms=monotonic_ms(),
                payload=payload,
            )
        )


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
        freshness_seconds: float = DEFAULT_FRESHNESS_SECONDS,
        event_stream: InferenceEventStream | None = None,
    ) -> None:
        self.publisher = publisher
        self.adapter = adapter
        self.frames = frames
        self.event_stream = event_stream or InferenceEventStream(
            publisher,
            runtime_id=runtime_id,
            freshness_seconds=freshness_seconds,
        )
        self.interval_seconds = interval_seconds
        self.no_face_timeout_seconds = no_face_timeout_seconds
        self._closed = False
        self._last_face_ms: int | None = None
        self._last_state: str | None = None

    def _now_ms(self) -> int:
        return monotonic_ms()

    async def publish_state(
        self,
        state: str,
        detail: str | None = None,
        *,
        force: bool = False,
    ) -> None:
        if not force and state == self._last_state and detail is None:
            return
        now_ms = self._now_ms()
        payload: dict[str, Any] = {"state": state}
        if detail:
            payload["detail"] = detail
        await self.event_stream.publish("producer_state", payload, now_ms)
        self._last_state = state

    async def run(self, stop: asyncio.Event) -> None:
        await self.event_stream.start_loading()
        print(
            json.dumps(
                {
                    "type": "worker_health",
                    "role": "inference",
                    "ready": True,
                    "stream": "publishing",
                }
            ),
            flush=True,
        )
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
                        await self.publish_state("no-face", force=True)
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
        await self.event_stream.publish(kind, payload, captured_at_ms)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await asyncio.to_thread(self.frames.close)
        await asyncio.to_thread(self.adapter.close)
        await self.event_stream.close()


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


async def _publish_state_heartbeat(
    event_stream: InferenceEventStream,
    *,
    state: str,
    stop: asyncio.Event,
    freshness_seconds: float,
    detail: str | None = None,
) -> None:
    try:
        while not stop.is_set():
            await event_stream.publish_state(state, detail)
            await _wait_or_stop(stop, max(0.05, freshness_seconds / 2))
    finally:
        await event_stream.close()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--runtime-id")
    parser.add_argument("--adapter", default="emotiefflib")
    parser.add_argument("--model", default="enet_b0_8_best_afew")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--interval", type=float, default=0.16)
    parser.add_argument(
        "--freshness",
        type=float,
        default=DEFAULT_FRESHNESS_SECONDS,
    )
    parser.add_argument("--face-threshold", type=float, default=0.90)
    parser.add_argument("--minimum-face-size", type=int, default=40)
    parser.add_argument("--no-face-timeout", type=float, default=0.8)
    parser.add_argument("--image", type=Path, action="append", default=[])
    parser.add_argument("--demo", action="store_true")
    return parser


async def _run_worker(args: argparse.Namespace, stop: asyncio.Event) -> int:
    publisher = SnapshotPublisher(
        args.socket, current_ttl_ms=round(args.freshness * 1000)
    )
    event_stream = InferenceEventStream(
        publisher,
        runtime_id=args.runtime_id,
        freshness_seconds=args.freshness,
    )
    await event_stream.start_loading()
    print(
        json.dumps(
            {
                "type": "worker_health",
                "role": "inference",
                "ready": False,
                "stream": "loading",
            }
        ),
        flush=True,
    )
    frames: FrameSource | None = None
    adapter: EmotionAdapter | None = None
    try:
        if args.demo:
            patterns = [
                {"happiness": 0.75, "neutral": 0.15},
                {"anger": 0.92, "neutral": 0.04},
                {"neutral": 0.90},
            ]
            adapter = SyntheticAdapter(
                [pattern for pattern in patterns for _ in range(8)]
            )
            frames = SyntheticFrames()
        else:
            if args.image:
                frames = await asyncio.to_thread(ImageSequenceFrameSource, args.image)
            else:
                permission = await asyncio.to_thread(request_camera_permission)
                if permission is not CameraPermission.GRANTED:
                    await _publish_state_heartbeat(
                        event_stream,
                        state=permission.value,
                        stop=stop,
                        freshness_seconds=args.freshness,
                    )
                    return 2
                frames = await asyncio.to_thread(CameraFrameSource, args.camera)
                if not frames.opened:
                    try:
                        await _publish_state_heartbeat(
                            event_stream,
                            state="camera-unavailable",
                            stop=stop,
                            freshness_seconds=args.freshness,
                        )
                    finally:
                        await asyncio.to_thread(frames.close)
                    return 2
            adapter = await asyncio.to_thread(
                create_adapter,
                args.adapter,
                model_name=args.model,
                face_threshold=args.face_threshold,
                minimum_face_size=args.minimum_face_size,
            )
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        print(
            json.dumps(
                {
                    "type": "worker_health",
                    "role": "inference",
                    "ready": False,
                    "stream": "error",
                    "error": detail,
                }
            ),
            flush=True,
        )
        await event_stream.publish_state("inference-error", detail)
        await _wait_or_stop(stop, min(0.10, args.freshness / 2))
        if adapter is not None:
            await asyncio.to_thread(adapter.close)
        if frames is not None:
            await asyncio.to_thread(frames.close)
        await event_stream.close()
        return 2
    assert frames is not None
    assert adapter is not None
    service = InferenceService(
        publisher=publisher,
        adapter=adapter,
        frames=frames,
        runtime_id=args.runtime_id,
        interval_seconds=args.interval,
        no_face_timeout_seconds=args.no_face_timeout,
        freshness_seconds=args.freshness,
        event_stream=event_stream,
    )
    await service.run(stop)
    return 0


async def _run_cli(args: argparse.Namespace) -> int:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(name, stop.set)
    return await _run_worker(args, stop)


def main() -> None:
    raise SystemExit(asyncio.run(_run_cli(_parser().parse_args())))


if __name__ == "__main__":
    main()
