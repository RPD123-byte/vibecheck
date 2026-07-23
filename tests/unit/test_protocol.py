from __future__ import annotations

from pathlib import Path

import pytest

from uncover.stream.protocol import (
    EventEnvelope,
    ProtocolError,
    decode_event,
    encode_event,
)


def event(sequence: int = 1) -> EventEnvelope:
    return EventEnvelope(
        "producer_state", "runtime", sequence, 100, 101, {"state": "loading"}
    )


def test_protocol_round_trip() -> None:
    assert decode_event(encode_event(event())) == event()


def test_protocol_rejects_version_malformed_and_oversized() -> None:
    with pytest.raises(ProtocolError, match="unsupported schema"):
        EventEnvelope("producer_state", "runtime", 1, 1, 1, {}, schema_version=2)
    with pytest.raises(ProtocolError, match="invalid JSON"):
        decode_event(b"{nope}\n")
    with pytest.raises(ProtocolError, match="exceeds"):
        decode_event(b"x" * 10, maximum_bytes=4)


def test_frozen_protocol_v1_fixture_is_valid() -> None:
    fixture = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "protocol"
        / "reading_v1.json"
    )
    event = decode_event(fixture.read_bytes() + b"\n")
    assert event.kind == "reading"
    assert event.payload["scores"]["disgust"] == 0.91
