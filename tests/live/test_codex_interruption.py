from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import tempfile
from pathlib import Path
from typing import Any

import pytest
import websockets

from uncover.emotion.schema import CANONICAL_EMOTIONS
from uncover.stream.protocol import EventEnvelope, monotonic_ms
from uncover.stream.publisher import SnapshotPublisher
from uncover.stream.subscriber import SnapshotSubscriber

pytestmark = [
    pytest.mark.live_codex,
    pytest.mark.skipif(
        os.environ.get("UNCOVER_RUN_LIVE_CODEX_TESTS") != "1",
        reason="set UNCOVER_RUN_LIVE_CODEX_TESTS=1 for isolated live mutation",
    ),
]

ROOT = Path(__file__).resolve().parents[2]
MANAGED_SOCKET = Path.home() / ".codex/app-server-control/app-server-control.sock"
RUST_MANIFEST = ROOT / "src/native/expression_interruption/Cargo.toml"


class RpcClient:
    def __init__(self, websocket: Any) -> None:
        self.websocket = websocket
        self.next_id = 1
        self.pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self.notifications: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.reader = asyncio.create_task(self._read())

    async def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self.next_id
        self.next_id += 1
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        await self.websocket.send(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": method,
                    "params": params,
                }
            )
        )
        return await future

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        await self.websocket.send(
            json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
        )

    async def close(self) -> None:
        self.reader.cancel()
        await asyncio.gather(self.reader, return_exceptions=True)

    async def _read(self) -> None:
        async for raw in self.websocket:
            message = json.loads(raw)
            request_id = message.get("id")
            if request_id in self.pending:
                future = self.pending.pop(request_id)
                if "error" in message:
                    future.set_exception(RuntimeError(json.dumps(message["error"])))
                else:
                    future.set_result(message.get("result", {}))
            elif message.get("method"):
                await self.notifications.put(message)


async def active_turn_id(rpc: RpcClient, thread_id: str) -> str | None:
    deadline = asyncio.get_running_loop().time() + 5
    while True:
        try:
            state = await rpc.request(
                "thread/read", {"threadId": thread_id, "includeTurns": True}
            )
        except RuntimeError as exc:
            if "rollout" not in str(exc) or "is empty" not in str(exc):
                raise
            if asyncio.get_running_loop().time() >= deadline:
                raise
            await asyncio.sleep(0.1)
            continue
        return next(
            (
                str(turn["id"])
                for turn in state.get("thread", {}).get("turns", [])
                if turn.get("status") == "inProgress"
            ),
            None,
        )


@pytest.mark.asyncio
async def test_real_turn_is_interrupted_and_restarted_with_expression_context() -> None:
    if not MANAGED_SOCKET.exists():
        pytest.skip(f"managed Codex socket is unavailable: {MANAGED_SOCKET}")
    runtime = Path(tempfile.mkdtemp(prefix="uc-live-", dir="/tmp"))
    os.chmod(runtime, 0o700)
    emotion_socket = runtime / "emotion.sock"
    status_socket = runtime / "status.sock"
    publisher = SnapshotPublisher(emotion_socket)
    await publisher.start()
    process: asyncio.subprocess.Process | None = None
    websocket: Any | None = None
    rpc: RpcClient | None = None
    thread_id: str | None = None
    turn_id: str | None = None
    subscriber = SnapshotSubscriber(status_socket, freshness_ms=10_000)
    status_events = subscriber.events()
    status_queue: asyncio.Queue[Any] = asyncio.Queue()

    async def collect_status() -> None:
        async for status in status_events:
            await status_queue.put(status)

    status_collector = asyncio.create_task(collect_status())
    try:
        websocket = await websockets.unix_connect(
            str(MANAGED_SOCKET), uri="ws://localhost/rpc", compression=None
        )
        if websocket is not None:
            rpc = RpcClient(websocket)
            await rpc.request(
                "initialize",
                {
                    "clientInfo": {
                        "name": "uncover-production-live-test",
                        "title": "Uncover production live fixture",
                        "version": "0.1.0",
                    }
                },
            )
            await rpc.notify("initialized", {})
            created = await rpc.request(
                "thread/start", {"cwd": str(ROOT), "ephemeral": False}
            )
            thread_id = str(created["thread"]["id"])
            process = await asyncio.create_subprocess_exec(
                "cargo",
                "run",
                "--quiet",
                "--manifest-path",
                str(RUST_MANIFEST),
                "--",
                "--emotion-socket",
                str(emotion_socket),
                "--status-socket",
                str(status_socket),
                "--runtime-id",
                "live-codex-test",
                "--hold-ms",
                "500",
                "--thread-id",
                thread_id,
                "--no-manage-gui",
                cwd=ROOT,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            ready = await asyncio.wait_for(status_queue.get(), 20)
            assert ready.event.payload["state"] in {"connecting", "ready"}
            if ready.event.payload["state"] != "ready":
                ready = await asyncio.wait_for(status_queue.get(), 20)
                assert ready.event.payload["state"] == "ready"
            fixture_prompt = (
                "Without tools, write a very detailed 4,000-word history of "
                "human-computer interaction. Continue until complete."
            )
            await rpc.request(
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": fixture_prompt}],
                },
            )
            deadline = asyncio.get_running_loop().time() + 15
            while turn_id is None:
                if asyncio.get_running_loop().time() >= deadline:
                    raise TimeoutError("fixture turn did not become active")
                turn_id = await active_turn_id(rpc, thread_id)
                await asyncio.sleep(0.1)
            while publisher.subscriber_count < 1:
                await asyncio.sleep(0.05)
            await asyncio.sleep(1.0)

            scores = {name: 0.0 for name in CANONICAL_EMOTIONS}
            scores["anger"] = 0.92
            result = None
            observed_states: list[str] = []
            for sequence in range(30):
                now = monotonic_ms()
                await publisher.publish(
                    EventEnvelope(
                        "reading",
                        "live-inference",
                        sequence,
                        now,
                        now,
                        {
                            "provider": "fixture",
                            "dominant_emotion": "anger",
                            "scores": scores,
                            "face_box": [0, 0, 100, 100],
                            "inference_ms": 1.0,
                        },
                    )
                )
                await asyncio.sleep(0.20)
                while not status_queue.empty():
                    status = status_queue.get_nowait()
                    observed_states.append(status.event.payload["state"])
                    if status.event.payload["state"] in {
                        "sent",
                        "sent_outcome_unknown",
                    }:
                        result = status.event
                        break
                if result is not None:
                    break
            if result is None:
                await asyncio.sleep(0.5)
                while not status_queue.empty():
                    status = status_queue.get_nowait()
                    observed_states.append(status.event.payload["state"])
                    if status.event.payload["state"] in {
                        "sent",
                        "sent_outcome_unknown",
                    }:
                        result = status.event
                        break
            process_detail = f"returncode={process.returncode}"
            assert result is not None, (
                f"dispatch states: {observed_states}; {process_detail}"
            )
            assert result.payload["thread_id"] == thread_id
            assert "angry" in result.payload["message"]
            assert "may be imperfect" in result.payload["message"]
            assert await active_turn_id(rpc, thread_id) != turn_id
    finally:
        if rpc is not None and thread_id is not None:
            active = await active_turn_id(rpc, thread_id)
            if active is not None:
                await rpc.request(
                    "turn/interrupt", {"threadId": thread_id, "turnId": active}
                )
            await rpc.request("thread/archive", {"threadId": thread_id})
            await rpc.close()
        if websocket is not None:
            await websocket.close()
        subscriber.close()
        status_collector.cancel()
        await asyncio.gather(status_collector, return_exceptions=True)
        await status_events.aclose()
        await publisher.close()
        if process is not None and process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
            await process.wait()
        shutil.rmtree(runtime, ignore_errors=True)
