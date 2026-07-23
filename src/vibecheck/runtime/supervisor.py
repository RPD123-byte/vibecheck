"""First application-level owner for expression worker processes."""

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

from vibecheck.runtime.config import RuntimeConfig
from vibecheck.runtime.health import WorkerHealth


@dataclass(slots=True)
class WorkerSpec:
    role: str
    command: list[str]
    recoverable: bool = True
    process: asyncio.subprocess.Process | None = None
    health: WorkerHealth = field(init=False)
    restarts: deque[float] = field(default_factory=deque)

    def __post_init__(self) -> None:
        self.health = WorkerHealth(self.role)


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
    ) -> None:
        self.config = config
        self.python = python
        self.project_root = project_root
        self.headless_notch = headless_notch
        self.image_paths = image_paths or []
        self.interruption_binary = interruption_binary
        self.runtime_id = str(uuid.uuid4())
        self.runtime_dir: Path | None = None
        self.workers: dict[str, WorkerSpec] = {}
        self.stop = asyncio.Event()
        self._monitor_tasks: list[asyncio.Task[None]] = []

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
        runtime_dir = self.runtime_dir or self.create_runtime_dir()
        emotion_socket = runtime_dir / "emotion.sock"
        status_socket = runtime_dir / "interruption-status.sock"
        inference = [
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
            inference.append("--demo")
        for path in self.image_paths:
            inference.extend(["--image", str(path)])

        notch = [
            self.python,
            "-m",
            "vibecheck.notch.process",
            "--emotion-socket",
            str(emotion_socket),
            "--freshness",
            str(self.config.freshness_seconds),
            "--entry-threshold",
            str(self.config.display_entry_threshold),
            "--exit-threshold",
            str(self.config.display_exit_threshold),
            "--confirmations",
            str(self.config.display_confirmations),
            "--camera-overlap",
            str(self.config.camera_overlap),
        ]
        if self.config.mode != "display-only":
            notch.extend(["--status-socket", str(status_socket)])
        if self.headless_notch:
            notch.append("--headless")

        self.workers = {
            "notch": WorkerSpec("notch", notch),
            "inference": WorkerSpec("inference", inference),
        }
        if self.config.mode != "display-only":
            rust_manifest = (
                self.project_root
                / "src"
                / "native"
                / "expression_interruption"
                / "Cargo.toml"
            )
            interruption = self._interruption_prefix(rust_manifest) + [
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
                interruption.append("--dry-run")
            if self.config.thread_id:
                interruption.extend(["--thread-id", self.config.thread_id])
            self.workers["interruption"] = WorkerSpec("interruption", interruption)
        return self.workers

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
        self.configure_workers()
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGINT, signal.SIGTERM):
            with suppress(NotImplementedError):
                loop.add_signal_handler(signum, self.stop.set)
        try:
            for role in ("notch", "interruption", "inference"):
                if role in self.workers:
                    await self._start(self.workers[role])
            self._emit_health()
            await self.stop.wait()
        finally:
            await self.shutdown()

    async def _start(self, worker: WorkerSpec) -> None:
        worker.health.lifecycle = "starting"
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
        self._monitor_tasks.append(asyncio.create_task(self._pipe(worker, False)))
        self._monitor_tasks.append(asyncio.create_task(self._pipe(worker, True)))
        self._monitor_tasks.append(asyncio.create_task(self._monitor(worker)))

    async def _pipe(self, worker: WorkerSpec, stderr: bool) -> None:
        process = worker.process
        if process is None:
            return
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
                    ):
                        worker.health.ready = bool(event.get("ready"))
                        worker.health.stream = str(event.get("stream", "unknown"))
                        error = event.get("error")
                        worker.health.last_error = str(error) if error else None
                        self._emit_health()
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

    async def _monitor(self, worker: WorkerSpec) -> None:
        process = worker.process
        if process is None:
            return
        code = await process.wait()
        if self.stop.is_set():
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
            self.stop.set()
            return
        worker.restarts.append(now)
        worker.health.restart_count += 1
        await asyncio.sleep(min(0.25 * (2 ** (worker.health.restart_count - 1)), 5.0))
        if not self.stop.is_set():
            if worker.role == "inference":
                new_runtime_id = str(uuid.uuid4())
                runtime_flag = worker.command.index("--runtime-id")
                worker.command[runtime_flag + 1] = new_runtime_id
            await self._start(worker)

    async def shutdown(self) -> None:
        self.stop.set()
        processes = [
            worker.process for worker in self.workers.values() if worker.process
        ]
        for process in processes:
            if process and process.returncode is None:
                os.killpg(process.pid, signal.SIGTERM)
        if processes:
            try:
                await asyncio.wait_for(
                    asyncio.gather(
                        *(process.wait() for process in processes if process)
                    ),
                    timeout=5.0,
                )
            except TimeoutError:
                for process in processes:
                    if process and process.returncode is None:
                        os.killpg(process.pid, signal.SIGKILL)
                await asyncio.gather(
                    *(process.wait() for process in processes if process),
                    return_exceptions=True,
                )
        for task in self._monitor_tasks:
            task.cancel()
        await asyncio.gather(*self._monitor_tasks, return_exceptions=True)
        if self.runtime_dir is not None and self.runtime_dir.exists():
            shutil.rmtree(self.runtime_dir)

    def _emit_health(self) -> None:
        print(
            json.dumps(
                {
                    "type": "runtime_health",
                    "runtime_id": self.runtime_id,
                    "workers": {
                        role: worker.health.to_dict()
                        for role, worker in self.workers.items()
                    },
                }
            ),
            flush=True,
        )
