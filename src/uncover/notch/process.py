"""Independent notch consumer with AppKit and headless test renderers."""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import sys
import threading
from contextlib import suppress
from pathlib import Path
from typing import TextIO

from uncover.notch.display_policy import DisplayPolicy
from uncover.notch.state import NotchProjection, RenderState
from uncover.stream.subscriber import SnapshotSubscriber


class SharedProjection:
    def __init__(self, projection: NotchProjection) -> None:
        self.projection = projection
        self._lock = threading.Lock()
        self._state = projection.render()

    def update(self, state: RenderState) -> None:
        with self._lock:
            self._state = state

    def get(self) -> RenderState:
        with self._lock:
            return self._state


async def consume_streams(
    *,
    emotion_socket: Path,
    status_socket: Path | None,
    shared: SharedProjection,
    stop: asyncio.Event,
    freshness_seconds: float,
    output: TextIO | None = None,
) -> None:
    last_json: str | None = None

    def publish(state: RenderState) -> None:
        nonlocal last_json
        shared.update(state)
        if output is None:
            return
        encoded = json.dumps(state.to_dict(), sort_keys=True)
        if encoded != last_json:
            print(encoded, file=output, flush=True)
            last_json = encoded

    async def emotions() -> None:
        subscriber = SnapshotSubscriber(
            emotion_socket, freshness_ms=round(freshness_seconds * 1000)
        )
        while not stop.is_set():
            try:
                async for item in subscriber.events():
                    publish(
                        shared.projection.apply_emotion(
                            item.event, discontinuity=item.discontinuity
                        )
                    )
                    if stop.is_set():
                        break
            finally:
                if not stop.is_set():
                    publish(shared.projection.stream_lost(stale=subscriber.stale))
                    await asyncio.sleep(0.05)
        subscriber.close()

    async def statuses() -> None:
        if status_socket is None:
            return
        subscriber = SnapshotSubscriber(status_socket, freshness_ms=10_000)
        async for item in subscriber.events():
            publish(shared.projection.apply_status(item.event))
            if stop.is_set():
                break
        subscriber.close()

    tasks = [asyncio.create_task(emotions())]
    if status_socket is not None:
        tasks.append(asyncio.create_task(statuses()))
    try:
        await stop.wait()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emotion-socket", type=Path, required=True)
    parser.add_argument("--status-socket", type=Path)
    parser.add_argument("--freshness", type=float, default=0.75)
    parser.add_argument("--entry-threshold", type=float, default=0.50)
    parser.add_argument("--exit-threshold", type=float, default=0.45)
    parser.add_argument("--confirmations", type=int, default=2)
    parser.add_argument("--camera-overlap", type=float, default=4.0)
    parser.add_argument("--headless", action="store_true")
    return parser


async def _headless(args: argparse.Namespace) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(name, stop.set)
    shared = SharedProjection(
        NotchProjection(
            DisplayPolicy(args.entry_threshold, args.exit_threshold, args.confirmations)
        )
    )
    await consume_streams(
        emotion_socket=args.emotion_socket,
        status_socket=args.status_socket,
        shared=shared,
        stop=stop,
        freshness_seconds=args.freshness,
        output=sys.stdout,
    )


def main() -> None:
    args = _parser().parse_args()
    if args.headless:
        asyncio.run(_headless(args))
        return
    if sys.platform != "darwin":
        raise SystemExit(
            "AppKit notch presentation requires macOS; use --headless in tests"
        )
    from uncover.notch.appkit import run_appkit

    run_appkit(args)


if __name__ == "__main__":
    main()
