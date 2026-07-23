"""Private versioned JSONL control server for the Electron main process."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
from collections.abc import Awaitable, Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1
MAX_CONTROL_BYTES = 64 * 1024
SUPPORTED_ROLES = frozenset({"inference", "notch", "interruption"})

Snapshot = dict[str, Any]
Mutation = Callable[[dict[str, Any], int], Awaitable[Snapshot]]
Recovery = Callable[[tuple[str, ...]], Awaitable[Snapshot]]
SnapshotGetter = Callable[[], Snapshot]
Shutdown = Callable[[], None]
ConnectionChange = Callable[[bool], None]


class ProtocolError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ControlServer:
    def __init__(
        self,
        path: Path,
        *,
        runtime_id: str,
        snapshot: SnapshotGetter,
        mutate: Mutation,
        recover: Recovery,
        shutdown: Shutdown,
        connection_changed: ConnectionChange,
    ) -> None:
        self.path = path
        self.runtime_id = runtime_id
        self.token = secrets.token_urlsafe(32)
        self._snapshot = snapshot
        self._mutate = mutate
        self._recover = recover
        self._shutdown = shutdown
        self._connection_changed = connection_changed
        self._server: asyncio.AbstractServer | None = None
        self._clients: set[asyncio.StreamWriter] = set()
        self._mutation_lock = asyncio.Lock()
        self._responses: dict[str, tuple[str, Snapshot]] = {}

    async def start(self) -> None:
        with suppress(FileNotFoundError):
            self.path.unlink()
        self._server = await asyncio.start_unix_server(
            self._handle_client,
            path=self.path,
            limit=MAX_CONTROL_BYTES + 1,
        )
        os.chmod(self.path, 0o600)

    def bootstrap(self) -> dict[str, Any]:
        return {
            "version": PROTOCOL_VERSION,
            "type": "bootstrap",
            "runtime_id": self.runtime_id,
            "control_socket": str(self.path),
            "controller_token": self.token,
        }

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        clients = tuple(self._clients)
        for writer in clients:
            writer.close()
        await asyncio.gather(
            *(writer.wait_closed() for writer in clients),
            return_exceptions=True,
        )
        self._clients.clear()
        with suppress(FileNotFoundError):
            self.path.unlink()

    async def publish(self) -> None:
        await self._broadcast(
            {
                "version": PROTOCOL_VERSION,
                "type": "state_update",
                "runtime_id": self.runtime_id,
                "state": self._snapshot(),
            }
        )

    async def _handle_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        if self._clients:
            await self._write_error(
                writer,
                None,
                "controller_owned",
                "another controller already owns this runtime",
            )
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()
            return
        self._clients.add(writer)
        self._connection_changed(True)
        try:
            await self._write(
                writer,
                {
                    "version": PROTOCOL_VERSION,
                    "type": "state_update",
                    "runtime_id": self.runtime_id,
                    "state": self._snapshot(),
                },
            )
            while True:
                try:
                    line = await reader.readuntil(b"\n")
                except (asyncio.IncompleteReadError, asyncio.LimitOverrunError):
                    break
                if len(line) > MAX_CONTROL_BYTES:
                    await self._write_error(
                        writer, None, "frame_too_large", "frame exceeds limit"
                    )
                    break
                try:
                    message = json.loads(line)
                    response = await self._dispatch(message)
                except json.JSONDecodeError:
                    response = self._error(
                        None, "invalid_json", "message is not valid JSON"
                    )
                except ProtocolError as error:
                    request_id = (
                        message.get("id") if isinstance(message, dict) else None
                    )
                    response = self._error(request_id, error.code, str(error))
                await self._write(writer, response)
        finally:
            self._clients.discard(writer)
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()
            if not self._clients:
                self._connection_changed(False)

    async def _dispatch(self, message: object) -> dict[str, Any]:
        if not isinstance(message, dict):
            raise ProtocolError("invalid_message", "message must be an object")
        request_id = message.get("id")
        if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
            raise ProtocolError("invalid_id", "id must be a non-empty bounded string")
        if message.get("version") != PROTOCOL_VERSION:
            raise ProtocolError("unsupported_version", "unsupported protocol version")
        if not secrets.compare_digest(str(message.get("token", "")), self.token):
            raise ProtocolError("unauthorized", "invalid controller token")
        kind = message.get("type")
        allowed = {
            "get_state": {"version", "id", "token", "type"},
            "set_features": {
                "version",
                "id",
                "token",
                "type",
                "expected_revision",
                "features",
            },
            "restart_failed_roles": {
                "version",
                "id",
                "token",
                "type",
                "roles",
            },
            "shutdown": {"version", "id", "token", "type"},
        }
        if kind not in allowed:
            raise ProtocolError("unsupported_type", "unsupported message type")
        if set(message) != allowed[kind]:
            raise ProtocolError(
                "invalid_fields", "message contains missing or unknown fields"
            )
        if kind == "get_state":
            snapshot = self._snapshot()
        elif kind == "set_features":
            expected = message["expected_revision"]
            if (
                isinstance(expected, bool)
                or not isinstance(expected, int)
                or expected < 0
            ):
                raise ProtocolError(
                    "invalid_revision", "expected_revision must be non-negative"
                )
            fingerprint = json.dumps(message, sort_keys=True, separators=(",", ":"))
            previous = self._responses.get(request_id)
            if previous is not None:
                if previous[0] != fingerprint:
                    raise ProtocolError(
                        "id_conflict", "id was already used for another request"
                    )
                snapshot = previous[1]
            else:
                async with self._mutation_lock:
                    try:
                        snapshot = await self._mutate(message["features"], expected)
                    except ValueError as error:
                        code = (
                            "stale_revision"
                            if "stale" in str(error)
                            else "invalid_features"
                        )
                        raise ProtocolError(code, str(error)) from error
                self._responses[request_id] = (fingerprint, snapshot)
                if len(self._responses) > 256:
                    self._responses.pop(next(iter(self._responses)))
        elif kind == "restart_failed_roles":
            roles = message["roles"]
            if (
                not isinstance(roles, list)
                or not roles
                or any(not isinstance(role, str) for role in roles)
                or not set(roles) <= SUPPORTED_ROLES
            ):
                raise ProtocolError(
                    "invalid_roles", "roles must name supported workers"
                )
            snapshot = await self._recover(tuple(dict.fromkeys(roles)))
        else:
            snapshot = self._snapshot()
            self._shutdown()
        return {
            "version": PROTOCOL_VERSION,
            "type": "ack",
            "id": request_id,
            "runtime_id": self.runtime_id,
            "state": snapshot,
        }

    async def _broadcast(self, message: dict[str, Any]) -> None:
        for writer in tuple(self._clients):
            try:
                await self._write(writer, message)
            except (ConnectionError, RuntimeError):
                self._clients.discard(writer)

    @staticmethod
    async def _write(writer: asyncio.StreamWriter, message: dict[str, Any]) -> None:
        encoded = json.dumps(message, separators=(",", ":")).encode() + b"\n"
        if len(encoded) > MAX_CONTROL_BYTES:
            raise RuntimeError("outbound control frame exceeds limit")
        writer.write(encoded)
        await writer.drain()

    async def _write_error(
        self,
        writer: asyncio.StreamWriter,
        request_id: str | None,
        code: str,
        message: str,
    ) -> None:
        await self._write(writer, self._error(request_id, code, message))

    def _error(
        self,
        request_id: object,
        code: str,
        message: str,
    ) -> dict[str, Any]:
        return {
            "version": PROTOCOL_VERSION,
            "type": "error",
            "id": request_id if isinstance(request_id, str) else None,
            "runtime_id": self.runtime_id,
            "error": {"code": code, "message": message},
            "state": self._snapshot(),
        }
