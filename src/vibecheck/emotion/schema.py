"""Provider-neutral, validated facial-expression readings."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite
from types import MappingProxyType
from typing import Any

CANONICAL_EMOTIONS = (
    "anger",
    "contempt",
    "disgust",
    "fear",
    "happiness",
    "neutral",
    "sadness",
    "surprise",
)


@dataclass(frozen=True, slots=True)
class EmotionReading:
    provider: str
    dominant_emotion: str
    scores: Mapping[str, float]
    face_box: tuple[int, int, int, int]
    inference_ms: float

    def __post_init__(self) -> None:
        if set(self.scores) != set(CANONICAL_EMOTIONS):
            missing = sorted(set(CANONICAL_EMOTIONS) - set(self.scores))
            extra = sorted(set(self.scores) - set(CANONICAL_EMOTIONS))
            raise ValueError(
                f"invalid canonical scores; missing={missing}, extra={extra}"
            )
        normalized = {name: float(self.scores[name]) for name in CANONICAL_EMOTIONS}
        if any(
            not isfinite(value) or not 0.0 <= value <= 1.0
            for value in normalized.values()
        ):
            raise ValueError(
                "emotion scores must be finite values from 0.0 through 1.0"
            )
        dominant = max(
            CANONICAL_EMOTIONS,
            key=lambda name: (normalized[name], -CANONICAL_EMOTIONS.index(name)),
        )
        if self.dominant_emotion != dominant:
            raise ValueError(f"dominant emotion must be {dominant!r}")
        if (
            len(self.face_box) != 4
            or self.face_box[2] <= self.face_box[0]
            or self.face_box[3] <= self.face_box[1]
        ):
            raise ValueError("face_box must be a non-empty x1,y1,x2,y2 rectangle")
        if not isfinite(self.inference_ms) or self.inference_ms < 0:
            raise ValueError("inference_ms must be finite and non-negative")
        object.__setattr__(self, "scores", MappingProxyType(normalized))

    @classmethod
    def from_provider(
        cls,
        *,
        provider: str,
        provider_scores: Mapping[str, float],
        face_box: tuple[int, int, int, int],
        inference_ms: float,
    ) -> EmotionReading:
        lowered = {
            str(name).lower(): float(value) for name, value in provider_scores.items()
        }
        scores = {name: lowered.get(name, 0.0) for name in CANONICAL_EMOTIONS}
        dominant = max(
            CANONICAL_EMOTIONS,
            key=lambda name: (scores[name], -CANONICAL_EMOTIONS.index(name)),
        )
        return cls(provider, dominant, scores, face_box, inference_ms)

    def to_payload(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "dominant_emotion": self.dominant_emotion,
            "scores": dict(self.scores),
            "face_box": list(self.face_box),
            "inference_ms": self.inference_ms,
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> EmotionReading:
        return cls(
            provider=str(payload["provider"]),
            dominant_emotion=str(payload["dominant_emotion"]),
            scores=dict(payload["scores"]),
            face_box=tuple(int(value) for value in payload["face_box"]),
            inference_ms=float(payload["inference_ms"]),
        )
