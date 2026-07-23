from __future__ import annotations

import sys

import numpy as np
import pytest

from vibecheck.inference.adapters.emotiefflib import select_largest_face_box
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


def test_unknown_adapter_fails_without_importing_heavy_provider() -> None:
    sys.modules.pop("emotiefflib.facial_analysis", None)
    with pytest.raises(ValueError, match="valid adapters: emotiefflib"):
        create_adapter("deepface")
    assert "emotiefflib.facial_analysis" not in sys.modules
