"""EmotiEffLib adapter with bounded largest-face selection."""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np

from vibecheck.emotion.schema import EmotionReading
from vibecheck.inference.adapters.base import EmotionAdapter

LOW_LIGHT_P95_THRESHOLD = 64.0
LOW_LIGHT_MIN_RANGE = 8.0


def normalize_low_light_frame(frame: Any) -> np.ndarray | None:
    """Stretch a genuinely underexposed frame without changing normal frames."""
    values = np.asarray(frame)
    if values.ndim != 3 or values.shape[2] != 3 or values.size == 0:
        return None
    low = float(values.min())
    high = float(values.max())
    if (
        float(np.percentile(values, 95)) > LOW_LIGHT_P95_THRESHOLD
        or high - low < LOW_LIGHT_MIN_RANGE
    ):
        return None
    normalized = (values.astype(np.float32) - low) * (255.0 / (high - low))
    return np.rint(np.clip(normalized, 0.0, 255.0)).astype(np.uint8)


def bounded_face_boxes(
    boxes: Iterable[Any] | None,
    probabilities: Iterable[float | None] | None,
    *,
    width: int,
    height: int,
    confidence_threshold: float,
) -> list[tuple[int, int, int, int]]:
    if boxes is None or probabilities is None:
        return []
    candidates: list[tuple[int, int, int, int]] = []
    for box, probability in zip(boxes, probabilities, strict=False):
        if probability is None or float(probability) < confidence_threshold:
            continue
        x1, y1, x2, y2 = (int(value) for value in box)
        x1, x2 = sorted((max(0, min(width, x1)), max(0, min(width, x2))))
        y1, y2 = sorted((max(0, min(height, y1)), max(0, min(height, y2))))
        if x2 <= x1 or y2 <= y1:
            continue
        candidates.append((x1, y1, x2, y2))
    return candidates


def select_largest_face_box(
    boxes: Iterable[Any] | None,
    probabilities: Iterable[float | None] | None,
    *,
    width: int,
    height: int,
    confidence_threshold: float,
) -> tuple[int, int, int, int] | None:
    candidates = bounded_face_boxes(
        boxes,
        probabilities,
        width=width,
        height=height,
        confidence_threshold=confidence_threshold,
    )
    return max(
        candidates, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), default=None
    )


class EmotiEffLibAdapter(EmotionAdapter):
    name = "emotiefflib"

    def __init__(
        self,
        model_name: str = "enet_b0_8_best_afew",
        *,
        face_threshold: float = 0.90,
        minimum_face_size: int = 40,
    ) -> None:
        bundled_model = _bundled_model_path(model_name)
        if bundled_model is not None:
            import emotiefflib.utils

            original_model_path = emotiefflib.utils.get_model_path_onnx

            def packaged_model_path(requested_model: str) -> str:
                if requested_model == model_name:
                    return str(bundled_model)
                return original_model_path(requested_model)

            emotiefflib.utils.get_model_path_onnx = packaged_model_path
        from emotiefflib.facial_analysis import EmotiEffLibRecognizer
        from facenet_pytorch import MTCNN

        self.face_threshold = face_threshold
        self.minimum_face_size = minimum_face_size
        self.detector = MTCNN(
            keep_all=True,
            post_process=False,
            min_face_size=minimum_face_size,
            device="cpu",
        )
        self.recognizer = EmotiEffLibRecognizer(
            engine="onnx", model_name=model_name, device="cpu"
        )

    def analyze_frame(self, frame: Any) -> EmotionReading | None:
        import cv2

        started = time.perf_counter()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        boxes, probabilities = self.detector.detect(rgb)
        height, width = rgb.shape[:2]
        face_box = select_largest_face_box(
            boxes,
            probabilities,
            width=width,
            height=height,
            confidence_threshold=self.face_threshold,
        )
        if face_box is None:
            normalized = normalize_low_light_frame(frame)
            if normalized is not None:
                normalized_rgb = cv2.cvtColor(normalized, cv2.COLOR_BGR2RGB)
                boxes, probabilities = self.detector.detect(normalized_rgb)
                normalized_height, normalized_width = normalized_rgb.shape[:2]
                face_box = select_largest_face_box(
                    boxes,
                    probabilities,
                    width=normalized_width,
                    height=normalized_height,
                    confidence_threshold=self.face_threshold,
                )
                if face_box is not None:
                    rgb = normalized_rgb
        if face_box is None:
            return None
        x1, y1, x2, y2 = face_box
        face = rgb[y1:y2, x1:x2]
        _, raw_scores = self.recognizer.predict_emotions(face, logits=False)
        vector = np.asarray(raw_scores)[0]
        provider_scores = {
            str(name).lower(): float(vector[index])
            for index, name in self.recognizer.idx_to_emotion_class.items()
        }
        return EmotionReading.from_provider(
            provider=self.name,
            provider_scores=provider_scores,
            face_box=face_box,
            inference_ms=(time.perf_counter() - started) * 1000.0,
        )

    def close(self) -> None:
        self.detector = None
        self.recognizer = None


def _bundled_model_path(model_name: str) -> Path | None:
    configured = os.environ.get("VIBECHECK_MODEL_PATH")
    candidates = [
        Path(configured) if configured else None,
        Path(sys.executable).resolve().parent / "models" / f"{model_name}.onnx",
    ]
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate
    return None
