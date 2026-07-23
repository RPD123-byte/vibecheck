"""Provider-neutral emotion result types."""

from dataclasses import dataclass, field
from typing import Mapping

COMMON_EMOTIONS = (
    "anger",
    "disgust",
    "fear",
    "happiness",
    "neutral",
    "sadness",
    "surprise",
)


@dataclass(frozen=True)
class EmotionReading:
    provider: str
    dominant_emotion: str
    common_scores: Mapping[str, float]
    provider_scores: Mapping[str, float] = field(default_factory=dict)
    face_box: tuple[int, int, int, int] | None = None

    @property
    def dominant_score(self) -> float:
        return float(self.common_scores.get(self.dominant_emotion, 0.0))
