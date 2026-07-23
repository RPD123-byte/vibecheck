"""Application-level owner and dynamic reconciler for expression workers."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import stat
import tempfile
import time
import uuid
from collections import deque
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from vibecheck.runtime.config import RuntimeConfig
from vibecheck.runtime.control import ControlServer
from vibecheck.runtime.feature_state import FeatureState, initial_features_for_mode
from vibecheck.runtime.health import WorkerHealth
from vibecheck.runtime.topology import (
    ALL_ROLES,
    required_roles,
    start_order,
    stop_order,
)


@dataclass(slots=True)
class WorkerSpec:
    role: str
    command: list[str]
    recoverable: bool = True
    process: asyncio.subprocess.Process | None = None
    health: WorkerHealth = field(init=False)
    restarts: deque[float] = field(default_factory=deque)
    desired: bool = False
    generation: int = 0
    intentional_stop_generation: int | None = None
    restart_task: asyncio.Task[None] | None = None

    def __post_init__(self) -> None:
        self.health = WorkerHealth(self.role)

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None


class RuntimeOwner:
    def __init__(
        self,
        config: RuntimeConfig,
        *,
        python: str,
        project_root: Path,
        headless_notch: bool = False,
        image_paths: list[Path] | None = None,
        interruption_binary: Path | None = None,
        controller_mode: bool = False,
        initial_features: FeatureState | None = None,
        controller_grace_seconds: float = 5.0,
    ) -> None:
        self.config = config
        self.python = python
        self.project_root = project_root
        self.headless_notch = headless_notch
        self.image_paths = image_paths or []
        self.interruption_binary = interruption_binary
        self.controller_mode = controller_mode
        self.controller_grace_seconds = controller_grace_seconds
        self.runtime_id = str(uuid.uuid4())
        self.runtime_dir: Path | None = None
        self.workers: dict[str, WorkerSpec] = {}
        self.features = initial_features or initial_features_for_mode(config.mode)
        self.stop = asyncio.Event()
        self._monitor_tasks: set[asyncio.Task[None]] = set()
        self._reconcile_lock = asyncio.Lock()
        self._control: ControlServer | None = None
        self._controller_seen = False
        self._disconnect_task: asyncio.Task[None] | None = None
        self._shutting_down = False

    def create_runtime_dir(self) -> Path:
        base = Path(os.environ.get("TMPDIR", tempfile.gettempdir()))
        path = Path(tempfile.mkdtemp(prefix=f"vibecheck-{os.getuid()}-", dir=str(base)))
        os.chmod(path, 0o700)
        info = path.stat()
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise PermissionError("failed to create an owner-only runtime directory")
        self.runtime_dir = path
        return path

    def configure_workers(self) -> dict[str, WorkerSpec]:
        """Build every allowed role once; topology decides which ones run."""
        self.workers = {
            role: self._build_worker(role)
            for role in ALL_ROLES
            if role != "interruption"
            or self.config.mode != "display-only"
            or self.controller_mode
        }
        return self.workers

    def _build_worker(self, role: str) -> WorkerSpec:
        runtime_dir = self.runtime_dir or self.create_runtime_dir()
        emotion_socket = runtime_dir / "emotion.sock"
        status_socket = runtime_dir / "interruption-status.sock"
        if role == "inference":
            command = [
                self.python,
                "-m",
                "vibecheck.inference.process",
                "--socket",
                str(emotion_socket),
                "--runtime-id",
                self.runtime_id,
                "--adapter",
                self.config.adapter,
                "--model",
                self.config.model,
                "--camera",
                str(self.config.camera),
                "--interval",
                str(self.config.interval_seconds),
                "--freshness",
                str(self.config.freshness_seconds),
                "--face-threshold",
                str(self.config.face_threshold),
                "--minimum-face-size",
                str(self.config.minimum_face_size),
                "--no-face-timeout",
                str(self.config.no_face_timeout_seconds),
            ]
            if self.config.mode == "demo":
                command.append("--demo")
            for path in self.image_paths:
                command.extend(["--image", str(path)])
            return WorkerSpec(role, command)
        if role == "notch":
            command = [
                self.python,
                "-m",
                "vibecheck.notch.process",
                "--emotion-socket",
                str(emotion_socket),
                "--status-socket",
                str(status_socket),
                "--freshness",
                str(self.config.freshness_seconds),
                "--entry-threshold",
                str(self.config.display_entry_threshold),
                "--exit-threshold",
                str(self.config.display_exit_threshold),
                "--surprise-entry-threshold",
                str(self.config.surprise_display_entry_threshold),
                "--surprise-exit-threshold",
                str(self.config.surprise_display_exit_threshold),
                "--confirmations",
                str(self.config.display_confirmations),
                "--camera-overlap",
                str(self.config.camera_overlap),
            ]
            if self.headless_notch:
                command.append("--headless")
            return WorkerSpec(role, command)
        if role != "interruption":
            raise ValueError(f"unsupported worker role {role!r}")
        rust_manifest = (
            self.project_root
            / "src"
            / "native"
            / "expression_interruption"
            / "Cargo.toml"
        )
        command = self._interruption_prefix(rust_manifest) + [
            "--emotion-socket",
            str(emotion_socket),
            "--status-socket",
            str(status_socket),
            "--runtime-id",
            self.runtime_id,
            "--threshold",
            str(self.config.interruption_threshold),
            "--hold-ms",
            str(round(self.config.interruption_hold_seconds * 1000)),
            "--cooldown-ms",
            str(round(self.config.interruption_cooldown_seconds * 1000)),
            "--freshness-ms",
            str(round(self.config.freshness_seconds * 1000)),
            "--manage-gui" if self.config.manage_codex_gui else "--no-manage-gui",
        ]
        if self.config.mode in {"demo", "dry-run"}:
            command.append("--dry-run")
        if self.config.thread_id:
            command.extend(["--thread-id", self.config.thread_id])
        return WorkerSpec(role, command)

    def _interruption_prefix(self, manifest: Path) -> list[str]:
        configured = self.interruption_binary
        environment = os.environ.get("VIBECHECK_INTERRUPTION_BINARY")
        if configured is None and environment:
            configured = Path(environment)
        candidates = [
            configured,
            manifest.parent
            / "target"
            / "release"
            / "vibecheck-expression-interruption",
            manifest.parent / "target" / "debug" / "vibecheck-expression-interruption",
        ]
        for candidate in candidates:
            if (
                candidate is not None
                and candidate.is_file()
                and os.access(candidate, os.X_OK)
            ):
                return [str(candidate.resolve())]
        if manifest.is_file():
            return [
                "cargo",
                "run",
                "--quiet",
                "--manifest-path",
                str(manifest),
                "--",
            ]
        raise FileNotFoundError(
            "expression interruption binary is unavailable; pass "
            "--interruption-binary or set VIBECHECK_INTERRUPTION_BINARY"
        )

    async def run(self) -> None:
        self.create_runtime_dir()
        self.configure_workers()
        if self.controller_mode:
            assert self.runtime_dir is not None
            self._control = ControlServer(
                self.runtime_dir / "control.sock",
                runtime_id=self.runtime_id,
                snapshot=self.snapshot,
                mutate=self.set_features,
                recover=self.restart_failed_roles,
                shutdown=self.stop.set,
                connection_changed=self._controller_connection_changed,
            )
            await self._control.start()
            print(json.dumps(self._control.bootstrap()), flush=True)
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGINT, signal.SIGTERM):
            with suppress(NotImplementedError):
                loop.add_signal_handler(signum, self.stop.set)
        try:
            await self.reconcile()
            self._emit_health()
            await self.stop.wait()
        finally:
            await self.shutdown()

    async def set_features(
        self,
        value: dict[str, Any],
        expected_revision: int,
    ) -> dict[str, Any]:
        async with self._reconcile_lock:
            if expected_revision != self.features.revision:
                current = self.features.revision
                raise ValueError(
                    f"stale revision {expected_revision}; current is {current}"
                )
            next_state = FeatureState.from_features(
                value,
                revision=self.features.revision + 1,
            )
            if (
                next_state.notch_enabled == self.features.notch_enabled
                and next_state.integrations == self.features.integrations
                and next_state.paused == self.features.paused
            ):
                next_state = next_state.with_revision(self.features.revision)
            self.features = next_state
            await self._reconcile_locked()
            snapshot = self.snapshot()
        await self._publish_state()
        return snapshot

    async def reconcile(self) -> None:
        async with self._reconcile_lock:
            await self._reconcile_locked()
        await self._publish_state()

    async def _reconcile_locked(self) -> None:
        required = required_roles(self.features)
        removed = {
            role
            for role, worker in self.workers.items()
            if worker.running and role not in required
        }
        for role in stop_order(removed):
            await self._stop_worker(self.workers[role])
        added = {
            role
            for role, worker in self.workers.items()
            if role in required and not worker.running
        }
        for role in start_order(added):
            await self._start(self.workers[role])
        for role, worker in self.workers.items():
            worker.desired = role in required
            if not worker.desired and not worker.running:
                worker.health.lifecycle = "disabled"
                worker.health.ready = False
                worker.health.pid = None
                worker.health.stream = "disconnected"
                worker.health.last_error = None

    async def _start(self, worker: WorkerSpec) -> None:
        if worker.running:
            return
        if (
            worker.restart_task is not None
            and worker.restart_task is not asyncio.current_task()
        ):
            worker.restart_task.cancel()
            worker.restart_task = None
        worker.desired = True
        worker.generation += 1
        generation = worker.generation
        worker.intentional_stop_generation = None
        worker.health.lifecycle = "starting"
        worker.health.last_error = None
        process = await asyncio.create_subprocess_exec(
            *worker.command,
            cwd=self.project_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        worker.process = process
        worker.health.pid = process.pid
        worker.health.lifecycle = "running"
        worker.health.ready = False
        worker.health.stream = "connecting"
        for coroutine in (
            self._pipe(worker, process, False),
            self._pipe(worker, process, True),
            self._monitor(worker, process, generation),
        ):
            task = asyncio.create_task(coroutine)
            self._monitor_tasks.add(task)
            task.add_done_callback(self._monitor_tasks.discard)

    async def _stop_worker(self, worker: WorkerSpec) -> None:
        worker.desired = False
        if worker.restart_task is not None:
            worker.restart_task.cancel()
            worker.restart_task = None
        process = worker.process
        if process is None or process.returncode is not None:
            worker.health.lifecycle = "disabled"
            worker.health.pid = None
            return
        worker.intentional_stop_generation = worker.generation
        worker.health.lifecycle = "stopping"
        self._emit_health()
        await self._publish_state()
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            await asyncio.wait_for(process.wait(), timeout=5.0)
        except TimeoutError:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
        if worker.process is process:
            worker.process = None
        worker.health.lifecycle = "disabled"
        worker.health.ready = False
        worker.health.pid = None
        worker.health.stream = "disconnected"
        worker.health.last_error = None

    async def _pipe(
        self,
        worker: WorkerSpec,
        process: asyncio.subprocess.Process,
        stderr: bool,
    ) -> None:
        stream = process.stderr if stderr else process.stdout
        if stream is None:
            return
        while line := await stream.readline():
            text = line.decode(errors="replace").rstrip()
            if not stderr:
                with suppress(json.JSONDecodeError):
                    event = json.loads(text)
                    if (
                        event.get("type") == "worker_health"
                        and event.get("role") == worker.role
                        and worker.process is process
                    ):
                        worker.health.ready = bool(event.get("ready"))
                        worker.health.stream = str(event.get("stream", "unknown"))
                        error = event.get("error")
                        worker.health.last_error = str(error) if error else None
                        self._emit_health()
                        await self._publish_state()
                        continue
            print(
                json.dumps(
                    {
                        "type": "worker_log",
                        "runtime_id": self.runtime_id,
                        "role": worker.role,
                        "stream": "stderr" if stderr else "stdout",
                        "message": text,
                    }
                ),
                flush=True,
            )

    async def _monitor(
        self,
        worker: WorkerSpec,
        process: asyncio.subprocess.Process,
        generation: int,
    ) -> None:
        code = await process.wait()
        if worker.process is process:
            worker.process = None
        intentional = (
            self._shutting_down
            or self.stop.is_set()
            or not worker.desired
            or worker.intentional_stop_generation == generation
            or generation != worker.generation
        )
        if intentional:
            return
        worker.health.ready = False
        worker.health.lifecycle = "exited"
        worker.health.stream = "disconnected"
        worker.health.last_error = f"exit status {code}"
        now = time.monotonic()
        window = self.config.restart_window_seconds
        while worker.restarts and now - worker.restarts[0] > window:
            worker.restarts.popleft()
        if not worker.recoverable or len(worker.restarts) >= self.config.restart_limit:
            worker.health.lifecycle = "failed"
            self._emit_health()
            await self._publish_state()
            return
        worker.restarts.append(now)
        worker.health.restart_count += 1
        self._emit_health()
        await self._publish_state()
        delay = min(0.25 * (2 ** (worker.health.restart_count - 1)), 5.0)
        worker.restart_task = asyncio.create_task(
            self._restart_after(worker, generation, delay)
        )

    async def _restart_after(
        self,
        worker: WorkerSpec,
        generation: int,
        delay: float,
    ) -> None:
        try:
            await asyncio.sleep(delay)
            async with self._reconcile_lock:
                if (
                    not self._shutting_down
                    and worker.desired
                    and worker.generation == generation
                    and worker.role in required_roles(self.features)
                ):
                    if worker.role == "inference":
                        runtime_flag = worker.command.index("--runtime-id")
                        worker.command[runtime_flag + 1] = str(uuid.uuid4())
                    await self._start(worker)
        except asyncio.CancelledError:
            pass
        finally:
            if worker.restart_task is asyncio.current_task():
                worker.restart_task = None

    async def restart_failed_roles(self, roles: tuple[str, ...]) -> dict[str, Any]:
        async with self._reconcile_lock:
            required = required_roles(self.features)
            for role in roles:
                worker = self.workers.get(role)
                if worker is None or role not in required:
                    continue
                if worker.health.lifecycle not in {"failed", "exited"}:
                    continue
                worker.restarts.clear()
                worker.health.restart_count = 0
                await self._start(worker)
            snapshot = self.snapshot()
        await self._publish_state()
        return snapshot

    async def shutdown(self) -> None:
        if self._shutting_down:
            return
        self._shutting_down = True
        self.stop.set()
        if self._disconnect_task is not None:
            self._disconnect_task.cancel()
        async with self._reconcile_lock:
            running = {role for role, worker in self.workers.items() if worker.running}
            for role in stop_order(running):
                await self._stop_worker(self.workers[role])
        if self._control is not None:
            await self._control.close()
        for worker in self.workers.values():
            if worker.restart_task is not None:
                worker.restart_task.cancel()
        for task in tuple(self._monitor_tasks):
            task.cancel()
        await asyncio.gather(*self._monitor_tasks, return_exceptions=True)
        if self.runtime_dir is not None and self.runtime_dir.exists():
            shutil.rmtree(self.runtime_dir)

    def snapshot(self) -> dict[str, Any]:
        desired = required_roles(self.features)
        effective = sorted(
            role for role, worker in self.workers.items() if worker.running
        )
        required_workers = [
            self.workers[role] for role in desired if role in self.workers
        ]
        errors = [
            {"role": worker.role, "message": worker.health.last_error}
            for worker in required_workers
            if worker.health.last_error
        ]
        if self.features.paused:
            aggregate = "paused"
        elif not desired:
            aggregate = "off"
        elif any(worker.health.lifecycle == "failed" for worker in required_workers):
            aggregate = "failed"
        elif any(
            worker.health.last_error
            and (
                "permission" in worker.health.last_error.lower()
                or "camera" in worker.health.last_error.lower()
            )
            for worker in required_workers
        ):
            aggregate = "needs_permission"
        elif any(
            not worker.running or not worker.health.ready for worker in required_workers
        ):
            aggregate = "starting"
        elif errors:
            aggregate = "degraded"
        else:
            aggregate = "active"
        return {
            "features": self.features.to_dict(),
            "desired_roles": sorted(desired),
            "effective_roles": effective,
            "aggregate": aggregate,
            "workers": {
                role: worker.health.to_dict() for role, worker in self.workers.items()
            },
            "errors": errors,
        }

    def _controller_connection_changed(self, connected: bool) -> None:
        if connected:
            self._controller_seen = True
            if self._disconnect_task is not None:
                self._disconnect_task.cancel()
                self._disconnect_task = None
            return
        if self._controller_seen and not self.stop.is_set():
            self._disconnect_task = asyncio.create_task(self._disconnect_grace())

    async def _disconnect_grace(self) -> None:
        try:
            await asyncio.sleep(self.controller_grace_seconds)
            self.stop.set()
        except asyncio.CancelledError:
            pass

    async def _publish_state(self) -> None:
        if self._control is not None:
            await self._control.publish()

    def _emit_health(self) -> None:
        print(
            json.dumps(
                {
                    "type": "runtime_health",
                    "runtime_id": self.runtime_id,
                    **self.snapshot(),
                }
            ),
            flush=True,
        )
