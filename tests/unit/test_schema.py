from __future__ import annotations

import math

import pytest

from uncover.emotion.schema import CANONICAL_EMOTIONS, EmotionReading


def scores(**overrides: float) -> dict[str, float]:
    values = {name: 0.0 for name in CANONICAL_EMOTIONS}
    values.update(overrides)
    return values


def test_reading_requires_complete_finite_canonical_distribution() -> None:
    reading = EmotionReading(
        "test", "disgust", scores(disgust=0.8, neutral=0.2), (1, 2, 30, 40), 4.2
    )
    assert reading.scores["disgust"] == 0.8
    with pytest.raises(ValueError, match="missing"):
        EmotionReading("test", "neutral", {"neutral": 1.0}, (0, 0, 2, 2), 1.0)
    with pytest.raises(ValueError, match="finite"):
        EmotionReading("test", "anger", scores(anger=math.nan), (0, 0, 2, 2), 1.0)


def test_provider_normalization_adds_contempt_and_recomputes_dominant() -> None:
    reading = EmotionReading.from_provider(
        provider="provider",
        provider_scores={"ANGER": 0.1, "contempt": 0.7},
        face_box=(0, 0, 20, 20),
        inference_ms=1.0,
    )
    assert tuple(reading.scores) == CANONICAL_EMOTIONS
    assert reading.dominant_emotion == "contempt"
