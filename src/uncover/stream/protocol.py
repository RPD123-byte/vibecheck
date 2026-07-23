"""Protocol-v1 JSON Lines envelopes shared by local workers."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite
from typing import Any

SCHEMA_VERSION = 1
MAX_EVENT_BYTES = 64 * 1024
EVENT_KINDS = frozenset({"reading", "producer_state", "interruption_status"})


class ProtocolError(ValueError):
    """A local message violated the protocol contract."""


@dataclass(frozen=True, slots=True)
class EventEnvelope:
    kind: str
    runtime_id: str
    sequence: int
    captured_at_ms: int
    published_at_ms: int
    payload: Mapping[str, Any]
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ProtocolError(f"unsupported schema version {self.schema_version}")
        if self.kind not in EVENT_KINDS:
            raise ProtocolError(f"unsupported event kind {self.kind!r}")
        if not self.runtime_id:
            raise ProtocolError("runtime_id is required")
        if self.sequence < 0:
            raise ProtocolError("sequence must be non-negative")
        if self.captured_at_ms < 0 or self.published_at_ms < 0:
            raise ProtocolError("timestamps must be non-negative")
        if self.published_at_ms < self.captured_at_ms:
            raise ProtocolError("published_at_ms cannot precede captured_at_ms")
        if not isinstance(self.payload, Mapping):
            raise ProtocolError("payload must be an object")

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "kind": self.kind,
            "runtime_id": self.runtime_id,
            "sequence": self.sequence,
            "captured_at_ms": self.captured_at_ms,
            "published_at_ms": self.published_at_ms,
            "payload": dict(self.payload),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> EventEnvelope:
        try:
            return cls(
                schema_version=int(value["schema_version"]),
                kind=str(value["kind"]),
                runtime_id=str(value["runtime_id"]),
                sequence=int(value["sequence"]),
                captured_at_ms=int(value["captured_at_ms"]),
                published_at_ms=int(value["published_at_ms"]),
                payload=dict(value["payload"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ProtocolError(f"invalid event envelope: {exc}") from exc


def encode_event(
    event: EventEnvelope, *, maximum_bytes: int = MAX_EVENT_BYTES
) -> bytes:
    try:
        data = (
            json.dumps(event.to_dict(), separators=(",", ":"), allow_nan=False).encode(
                "utf-8"
            )
            + b"\n"
        )
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"event is not valid finite JSON: {exc}") from exc
    if len(data) > maximum_bytes:
        raise ProtocolError(f"event exceeds {maximum_bytes} bytes")
    return data


def decode_event(data: bytes, *, maximum_bytes: int = MAX_EVENT_BYTES) -> EventEnvelope:
    if len(data) > maximum_bytes:
        raise ProtocolError(f"event exceeds {maximum_bytes} bytes")
    try:
        value = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError(f"invalid JSON event: {exc}") from exc
    if not isinstance(value, dict):
        raise ProtocolError("event must be a JSON object")
    _reject_non_finite(value)
    return EventEnvelope.from_dict(value)


def _reject_non_finite(value: Any) -> None:
    if isinstance(value, float) and not isfinite(value):
        raise ProtocolError("event contains a non-finite number")
    if isinstance(value, dict):
        for item in value.values():
            _reject_non_finite(item)
    elif isinstance(value, list):
        for item in value:
            _reject_non_finite(item)
