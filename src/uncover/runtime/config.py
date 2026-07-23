"""Central validated expression-runtime configuration."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    camera: int = 0
    adapter: str = "emotiefflib"
    model: str = "enet_b0_8_best_afew"
    interval_seconds: float = 0.16
    face_threshold: float = 0.90
    minimum_face_size: int = 40
    no_face_timeout_seconds: float = 0.8
    freshness_seconds: float = 0.75
    display_entry_threshold: float = 0.30
    display_exit_threshold: float = 0.25
    display_confirmations: int = 2
    camera_overlap: float = 4.0
    interruption_threshold: float = 0.30
    interruption_hold_seconds: float = 1.0
    interruption_cooldown_seconds: float = 15.0
    thread_id: str | None = None
    manage_codex_gui: bool = True
    mode: str = "normal"
    maximum_event_bytes: int = 64 * 1024
    restart_limit: int = 5
    restart_window_seconds: float = 60.0

    def __post_init__(self) -> None:
        for name in (
            "face_threshold",
            "display_entry_threshold",
            "display_exit_threshold",
            "interruption_threshold",
        ):
            value = getattr(self, name)
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be from 0.0 through 1.0")
        if self.display_exit_threshold > self.display_entry_threshold:
            raise ValueError(
                "display_exit_threshold cannot exceed display_entry_threshold"
            )
        if self.display_entry_threshold != self.interruption_threshold:
            raise ValueError("display and interruption entry thresholds must match")
        if self.interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive")
        if self.freshness_seconds <= self.interval_seconds:
            raise ValueError("freshness_seconds must exceed interval_seconds")
        if self.no_face_timeout_seconds < 0 or self.interruption_hold_seconds <= 0:
            raise ValueError("face and interruption timing values are invalid")
        if self.interruption_cooldown_seconds < 0:
            raise ValueError("interruption_cooldown_seconds cannot be negative")
        if self.display_confirmations < 1:
            raise ValueError("display_confirmations must be at least one")
        if not 0.0 <= self.camera_overlap <= 8.0:
            raise ValueError("camera_overlap must be from zero through eight points")
        if self.minimum_face_size < 1 or self.maximum_event_bytes < 1024:
            raise ValueError("size limits are invalid")
        if self.mode not in {"normal", "demo", "dry-run", "display-only"}:
            raise ValueError(f"unsupported mode {self.mode!r}")

    def to_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))

    @classmethod
    def from_json(cls, value: str) -> RuntimeConfig:
        parsed: dict[str, Any] = json.loads(value)
        return cls(**parsed)

    @classmethod
    def from_file(cls, path: Path) -> RuntimeConfig:
        return cls.from_json(path.read_text())
