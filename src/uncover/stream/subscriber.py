"""Cancellable, freshness-aware Unix-socket subscription."""

from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from uncover.stream.protocol import (
    MAX_EVENT_BYTES,
    EventEnvelope,
    ProtocolError,
    decode_event,
    monotonic_ms,
)


@dataclass(frozen=True, slots=True)
class StreamItem:
    event: EventEnvelope
    discontinuity: bool


class SnapshotSubscriber:
    def __init__(
        self,
        socket_path: Path,
        *,
        freshness_ms: int = 750,
        maximum_bytes: int = MAX_EVENT_BYTES,
        clock_ms: Callable[[], int] | None = None,
    ) -> None:
        self.socket_path = socket_path
        self.freshness_ms = freshness_ms
        self.maximum_bytes = maximum_bytes
        self.clock_ms = clock_ms or monotonic_ms
        self.connected = False
        self.stale = False
        self.protocol_errors: list[str] = []
        self._closed = asyncio.Event()
        self._runtime_id: str | None = None
        self._sequence: int | None = None

    def close(self) -> None:
        self._closed.set()

    async def events(self) -> AsyncIterator[StreamItem]:
        delay = 0.05
        while not self._closed.is_set():
            try:
                reader, writer = await asyncio.open_unix_connection(
                    str(self.socket_path), limit=self.maximum_bytes
                )
                self.connected = True
                self.stale = False
                delay = 0.05
                try:
                    while not self._closed.is_set():
                        try:
                            data = await asyncio.wait_for(
                                reader.readline(), timeout=self.freshness_ms / 1000
                            )
                        except TimeoutError as exc:
                            self.stale = True
                            self._runtime_id = None
                            self._sequence = None
                            raise ConnectionError(
                                "emotion stream became stale"
                            ) from exc
                        if not data:
                            raise ConnectionError("emotion stream disconnected")
                        if len(data) > self.maximum_bytes or not data.endswith(b"\n"):
                            self.protocol_errors.append("oversized event")
                            raise ProtocolError("oversized event")
                        try:
                            event = decode_event(data, maximum_bytes=self.maximum_bytes)
                        except ProtocolError as exc:
                            self.protocol_errors.append(str(exc))
                            continue
                        if self.clock_ms() - event.published_at_ms > self.freshness_ms:
                            self.stale = True
                            self._runtime_id = None
                            self._sequence = None
                            continue
                        if (
                            event.runtime_id == self._runtime_id
                            and self._sequence is not None
                        ):
                            if event.sequence <= self._sequence:
                                continue
                            discontinuity = event.sequence != self._sequence + 1
                        else:
                            discontinuity = self._runtime_id is not None
                        if event.runtime_id != self._runtime_id:
                            discontinuity = self._runtime_id is not None
                        self._runtime_id = event.runtime_id
                        self._sequence = event.sequence
                        self.stale = False
                        yield StreamItem(event, discontinuity)
                finally:
                    writer.close()
                    await writer.wait_closed()
            except (
                FileNotFoundError,
                ConnectionError,
                ConnectionRefusedError,
                OSError,
            ):
                self.connected = False
                self._runtime_id = None
                self._sequence = None
                if self._closed.is_set():
                    break
                jitter = random.uniform(0.8, 1.2)
                with suppress(TimeoutError):
                    await asyncio.wait_for(self._closed.wait(), timeout=delay * jitter)
                delay = min(delay * 2, 2.0)
