from __future__ import annotations

import sys
from types import SimpleNamespace

import numpy as np
import pytest

from vibecheck.inference.adapters.emotiefflib import (
    EmotiEffLibAdapter,
    normalize_low_light_frame,
    select_largest_face_box,
)
from vibecheck.inference.registry import create_adapter


def test_largest_face_is_clamped_filtered_and_selected() -> None:
    boxes = np.array([[-10, -4, 50, 50], [20, 20, 100, 100], [0, 0, 10, 10]])
    probabilities = np.array([0.95, 0.94, 0.99])
    assert select_largest_face_box(
        boxes,
        probabilities,
        width=90,
        height=80,
        confidence_threshold=0.90,
    ) == (20, 20, 90, 80)


def test_post_detection_crop_matches_experiment_without_second_size_filter() -> None:
    assert select_largest_face_box(
        np.array([[0, 0, 10, 10]]),
        np.array([0.99]),
        width=100,
        height=100,
        confidence_threshold=0.90,
    ) == (0, 0, 10, 10)


def test_low_light_normalization_is_bounded_to_underexposed_frames() -> None:
    normal = np.full((8, 8, 3), 96, dtype=np.uint8)
    flat_black = np.zeros((8, 8, 3), dtype=np.uint8)
    underexposed = np.arange(8 * 8 * 3, dtype=np.uint8).reshape(8, 8, 3) % 29

    assert normalize_low_light_frame(normal) is None
    assert normalize_low_light_frame(flat_black) is None
    normalized = normalize_low_light_frame(underexposed)
    assert normalized is not None
    assert normalized.dtype == np.uint8
    assert int(normalized.min()) == 0
    assert int(normalized.max()) == 255
    assert int(underexposed.max()) == 28


def test_adapter_retries_detection_with_normalized_low_light_frame(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Detector:
        maxima: list[int] = []

        def detect(self, image: np.ndarray) -> tuple[np.ndarray | None, np.ndarray]:
            maximum = int(image.max())
            self.maxima.append(maximum)
            if maximum < 200:
                return None, np.array([None], dtype=object)
            return np.array([[1, 1, 7, 7]]), np.array([0.95])

    class Recognizer:
        idx_to_emotion_class = {0: "neutral", 1: "happiness"}
        crop_maximum: int | None = None

        def predict_emotions(
            self, face: np.ndarray, *, logits: bool
        ) -> tuple[None, np.ndarray]:
            assert logits is False
            self.crop_maximum = int(face.max())
            return None, np.array([[0.1, 0.9]])

    fake_cv2 = SimpleNamespace(
        COLOR_BGR2RGB=1,
        cvtColor=lambda image, _conversion: image[..., ::-1],
    )
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    adapter = object.__new__(EmotiEffLibAdapter)
    adapter.face_threshold = 0.90
    adapter.detector = Detector()
    adapter.recognizer = Recognizer()
    frame = np.arange(8 * 8 * 3, dtype=np.uint8).reshape(8, 8, 3) % 29

    reading = adapter.analyze_frame(frame)

    assert reading is not None
    assert reading.dominant_emotion == "happiness"
    assert reading.face_box == (1, 1, 7, 7)
    assert adapter.detector.maxima == [28, 255]
    assert adapter.recognizer.crop_maximum == 255


def test_unknown_adapter_fails_without_importing_heavy_provider() -> None:
    sys.modules.pop("emotiefflib.facial_analysis", None)
    with pytest.raises(ValueError, match="valid adapters: emotiefflib"):
        create_adapter("deepface")
    assert "emotiefflib.facial_analysis" not in sys.modules
