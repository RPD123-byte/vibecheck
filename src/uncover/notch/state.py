"""Projection from inference/status events to notch render state."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from uncover.notch.display_policy import DisplayPolicy
from uncover.stream.protocol import EventEnvelope

ICONS = {
    "anger": "😠",
    "contempt": "😏",
    "disgust": "🤢",
    "fear": "😨",
    "happiness": "😊",
    "sadness": "😢",
    "surprise": "😮",
}

HEALTH_LABELS = {
    "loading": "Loading…",
    "permission-required": "Allow camera access",
    "permission-denied": "Camera denied",
    "camera-unavailable": "Camera unavailable",
    "inference-error": "Inference error",
    "no-face": None,
    "disconnected": "Disconnected",
    "stale": "Stale",
    "unsupported-display": "Display unsupported",
}


@dataclass(frozen=True, slots=True)
class RenderState:
    emotions: tuple[str, ...] = ()
    icons: tuple[str, ...] = ()
    scores: dict[str, float] = field(default_factory=dict)
    health: str | None = "Loading…"
    emphasis: str | None = None
    detail: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "emotions": list(self.emotions),
            "icons": list(self.icons),
            "scores": dict(self.scores),
            "health": self.health,
            "emphasis": self.emphasis,
            "detail": self.detail,
        }


class NotchProjection:
    def __init__(self, policy: DisplayPolicy | None = None) -> None:
        self.policy = policy or DisplayPolicy()
        self.scores: dict[str, float] = {}
        self.health: str | None = "Loading…"
        self.emphasis: str | None = None
        self.detail: str | None = None
        self._status_expires_at = 0.0

    def apply_emotion(
        self, event: EventEnvelope, *, discontinuity: bool = False
    ) -> RenderState:
        if discontinuity:
            self.policy.reset()
        if event.kind == "producer_state":
            state = str(event.payload.get("state", "inference-error"))
            self.health = HEALTH_LABELS.get(state, state.replace("-", " ").title())
            self.detail = (
                str(event.payload.get("detail"))
                if event.payload.get("detail")
                else None
            )
            if state in {
                "no-face",
                "permission-denied",
                "camera-unavailable",
                "inference-error",
            }:
                self.policy.reset()
                self.scores = {}
            return self.render()
        if event.kind != "reading":
            return self.render()
        self.scores = {
            str(name): float(score) for name, score in event.payload["scores"].items()
        }
        self.policy.observe(self.scores)
        self.health = None
        self.detail = None
        return self.render()

    def apply_status(self, event: EventEnvelope) -> RenderState:
        if event.kind != "interruption_status":
            return self.render()
        state = str(event.payload.get("state", ""))
        if state in {"interrupting", "restarting"}:
            self.emphasis = "in-progress"
            self._status_expires_at = float("inf")
        elif state in {"sent", "sent_outcome_unknown", "would_send"}:
            self.emphasis = "success"
            self._status_expires_at = time.monotonic() + 4.0
        elif state in {"interrupt_failed", "restart_failed"}:
            self.emphasis = "error"
            self._status_expires_at = float("inf")
        elif state in {"ready", "dry_run_ready", "connecting"}:
            self.emphasis = None
            self._status_expires_at = 0.0
        self.detail = (
            str(event.payload.get("detail"))
            if event.payload.get("detail")
            else self.detail
        )
        return self.render()

    def stream_lost(self, *, stale: bool) -> RenderState:
        self.policy.reset()
        self.scores = {}
        self.health = HEALTH_LABELS["stale" if stale else "disconnected"]
        return self.render()

    def render(self) -> RenderState:
        if self._status_expires_at and time.monotonic() >= self._status_expires_at:
            self.emphasis = None
            self._status_expires_at = 0.0
        emotions = self.policy.committed if self.health is None else ()
        return RenderState(
            emotions=emotions,
            icons=tuple(ICONS[name] for name in emotions),
            scores={name: self.scores.get(name, 0.0) for name in emotions},
            health=self.health,
            emphasis=self.emphasis,
            detail=self.detail,
        )
