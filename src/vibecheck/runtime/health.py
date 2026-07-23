"""Structured worker health used by the runtime owner."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(slots=True)
class WorkerHealth:
    role: str
    lifecycle: str = "created"
    ready: bool = False
    restart_count: int = 0
    pid: int | None = None
    stream: str = "unknown"
    last_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
