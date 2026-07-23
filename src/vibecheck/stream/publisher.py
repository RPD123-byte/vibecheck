"""Non-durable Unix-socket latest-snapshot fan-out."""

from __future__ import annotations

import asyncio
import os
import stat
from contextlib import suppress
from pathlib import Path

from vibecheck.stream.protocol import (
    DEFAULT_FRESHNESS_MS,
    EventEnvelope,
    encode_event,
    monotonic_ms,
)


class SnapshotPublisher:
    def __init__(
        self,
        socket_path: Path,
        *,
        current_ttl_ms: int = DEFAULT_FRESHNESS_MS,
    ) -> None:
        self.socket_path = socket_path
        self.current_ttl_ms = current_ttl_ms
        self._server: asyncio.AbstractServer | None = None
        self._subscribers: set[asyncio.Queue[bytes]] = set()
        self._current: tuple[int, bytes] | None = None
        self._tasks: set[asyncio.Task[None]] = set()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def start(self) -> None:
        path_bytes = len(os.fsencode(self.socket_path))
        if path_bytes >= 104:
            raise ValueError(
                f"Unix socket path is too long ({path_bytes} bytes): {self.socket_path}"
            )
        self.socket_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent_mode = stat.S_IMODE(self.socket_path.parent.stat().st_mode)
        if self.socket_path.parent.stat().st_uid != os.getuid() or parent_mode & 0o077:
            raise PermissionError(
                "runtime directory must be owned by this user with mode 0700"
            )
        if self.socket_path.exists():
            try:
                reader, writer = await asyncio.open_unix_connection(
                    str(self.socket_path)
                )
            except (ConnectionError, ConnectionRefusedError, OSError):
                self.socket_path.unlink()
            else:
                del reader
                writer.close()
                await writer.wait_closed()
                raise RuntimeError(
                    f"socket already has a live owner: {self.socket_path}"
                )
        self._server = await asyncio.start_unix_server(
            self._accept, path=str(self.socket_path), limit=64 * 1024
        )
        os.chmod(self.socket_path, 0o600)

    async def publish(self, event: EventEnvelope) -> None:
        data = encode_event(event)
        self._current = (event.published_at_ms, data)
        for queue in tuple(self._subscribers):
            if queue.full():
                with suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            with suppress(asyncio.QueueFull):
                queue.put_nowait(data)

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        for task in tuple(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._subscribers.clear()
        if self.socket_path.exists():
            self.socket_path.unlink()

    async def _accept(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        del reader
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=1)
        self._subscribers.add(queue)
        if self._current is not None:
            published_at_ms, data = self._current
            now_ms = monotonic_ms()
            if now_ms - published_at_ms <= self.current_ttl_ms:
                queue.put_nowait(data)
        task = asyncio.current_task()
        if task is not None:
            self._tasks.add(task)
        try:
            while True:
                writer.write(await queue.get())
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            self._subscribers.discard(queue)
            writer.close()
            with suppress(ConnectionError, OSError):
                await writer.wait_closed()
            if task is not None:
                self._tasks.discard(task)

    async def __aenter__(self) -> SnapshotPublisher:
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()
