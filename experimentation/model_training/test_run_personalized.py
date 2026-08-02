from __future__ import annotations

import pytest
import torch
from run_personalized import load_head


def checkpoint() -> dict:
    return {
        "weight": torch.zeros(8, 1280),
        "bias": torch.zeros(8),
        "emotions": (
            "anger",
            "contempt",
            "disgust",
            "fear",
            "happiness",
            "neutral",
            "sadness",
            "surprise",
        ),
        "affect_weight": torch.zeros(2, 1280),
        "affect_bias": torch.zeros(2),
        "affect_dimensions": ("valence", "arousal"),
    }


def test_load_multitask_head(tmp_path) -> None:
    path = tmp_path / "head.pt"
    torch.save(checkpoint(), path)

    heads = load_head(path)

    assert heads.emotion_weight.shape == (8, 1280)
    assert heads.affect_weight is not None
    assert heads.affect_weight.shape == (2, 1280)
    assert heads.affect_bias is not None
    assert heads.affect_bias.shape == (2,)


def test_rejects_partial_affect_head(tmp_path) -> None:
    payload = checkpoint()
    del payload["affect_bias"]
    path = tmp_path / "head.pt"
    torch.save(payload, path)

    with pytest.raises(ValueError, match="both affect_weight and affect_bias"):
        load_head(path)
