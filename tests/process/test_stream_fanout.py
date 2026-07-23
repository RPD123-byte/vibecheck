from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

import pytest

from vibecheck.stream.protocol import EventEnvelope, monotonic_ms
from vibecheck.stream.publisher import SnapshotPublisher
from vibecheck.stream.subscriber import SnapshotSubscriber


@pytest.fixture
def socket_dir() -> Path:
    path = Path(tempfile.mkdtemp(prefix="vc-test-", dir="/tmp"))
    os.chmod(path, 0o700)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def event(runtime: str, sequence: int) -> EventEnvelope:
    now = monotonic_ms()
    return EventEnvelope(
        "producer_state", runtime, sequence, now, now, {"state": f"s{sequence}"}
    )


@pytest.mark.asyncio
async def test_real_unix_server_fans_out_to_two_independent_consumers(
    socket_dir: Path,
) -> None:
    socket = socket_dir / "emotion.sock"
    publisher = SnapshotPublisher(socket)
    await publisher.start()
    left = SnapshotSubscriber(socket)
    right = SnapshotSubscriber(socket)
    left_iter = left.events()
    right_iter = right.events()
    left_next = asyncio.create_task(anext(left_iter))
    right_next = asyncio.create_task(anext(right_iter))
    while publisher.subscriber_count < 2:
        await asyncio.sleep(0.01)
    await publisher.publish(event("runtime", 0))
    assert (await asyncio.wait_for(left_next, 1)).event.sequence == 0
    assert (await asyncio.wait_for(right_next, 1)).event.sequence == 0
    left.close()
    right.close()
    await left_iter.aclose()
    await right_iter.aclose()
    await publisher.close()


@pytest.mark.asyncio
async def test_slow_consumer_retains_only_newest_snapshot(socket_dir: Path) -> None:
    publisher = SnapshotPublisher(socket_dir / "emotion.sock")
    await publisher.start()
    subscriber = SnapshotSubscriber(socket_dir / "emotion.sock")
    iterator = subscriber.events()
    first = asyncio.create_task(anext(iterator))
    while publisher.subscriber_count < 1:
        await asyncio.sleep(0.01)
    for sequence in range(20):
        await publisher.publish(event("runtime", sequence))
    received = await asyncio.wait_for(first, 1)
    assert received.event.sequence == 19
    subscriber.close()
    await iterator.aclose()
    await publisher.close()


@pytest.mark.asyncio
async def test_second_publisher_never_unlinks_a_live_socket(socket_dir: Path) -> None:
    socket = socket_dir / "emotion.sock"
    owner = SnapshotPublisher(socket)
    contender = SnapshotPublisher(socket)
    await owner.start()
    with pytest.raises(RuntimeError, match="live owner"):
        await contender.start()
    assert socket.exists()
    await owner.close()


@pytest.mark.asyncio
async def test_subscriber_distinguishes_sequence_gap_from_runtime_restart(
    socket_dir: Path,
) -> None:
    socket = socket_dir / "emotion.sock"
    publisher = SnapshotPublisher(socket)
    await publisher.start()
    subscriber = SnapshotSubscriber(socket)
    iterator = subscriber.events()
    try:
        first = asyncio.create_task(anext(iterator))
        while publisher.subscriber_count < 1:
            await asyncio.sleep(0.01)
        await publisher.publish(event("runtime-a", 0))
        assert not (await asyncio.wait_for(first, 1)).discontinuity

        gap = asyncio.create_task(anext(iterator))
        await publisher.publish(event("runtime-a", 2))
        gap_item = await asyncio.wait_for(gap, 1)
        assert gap_item.sequence_gap
        assert not gap_item.runtime_changed

        restarted = asyncio.create_task(anext(iterator))
        await publisher.publish(event("runtime-b", 0))
        restarted_item = await asyncio.wait_for(restarted, 1)
        assert restarted_item.runtime_changed
    finally:
        subscriber.close()
        await iterator.aclose()
        await publisher.close()
