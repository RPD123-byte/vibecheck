from __future__ import annotations

import json
import sys
import types

import numpy as np
import torch
from train_head import masked_affect_loss, regression_metrics, split, train


def test_regression_metrics_ignore_missing_labels() -> None:
    predicted = torch.tensor([[0.2, 0.4], [-0.8, -0.1], [0.5, 0.9]])
    expected = torch.tensor([[0.1, 0.5], [-0.6, float("nan")], [0.4, 0.7]])

    metrics = regression_metrics(predicted, expected)

    assert metrics["valence"]["count"] == 3
    assert np.isclose(metrics["valence"]["mae"], (0.1 + 0.2 + 0.1) / 3)
    assert metrics["arousal"]["count"] == 2
    assert np.isclose(metrics["arousal"]["mae"], 0.15)


def test_masked_affect_loss_does_not_propagate_nan() -> None:
    predicted = torch.tensor([[0.2, 0.4], [-0.8, -0.1]], requires_grad=True)
    expected = torch.tensor([[0.1, 0.5], [-0.6, float("nan")]])

    loss = masked_affect_loss(predicted, expected)
    loss.backward()

    assert torch.isfinite(loss)
    assert torch.isfinite(predicted.grad).all()
    assert predicted.grad[1, 1] == 0


def test_session_split_returns_integer_indices() -> None:
    labels = np.asarray([0, 1, 0, 1])
    rows = [
        {"session": "one"},
        {"session": "one"},
        {"session": "two"},
        {"session": "two"},
    ]

    train, validation = split(labels, rows, seed=7, val_fraction=0.2)

    assert train.tolist() == [0, 1]
    assert validation.tolist() == [2, 3]
    assert np.issubdtype(train.dtype, np.integer)


def test_explicit_split_keeps_copied_validation_out_of_training() -> None:
    labels = np.asarray([0, 1, 0, 1])
    rows = [
        {"split": "train"},
        {"split": "train"},
        {"split": "validation"},
        {"split": "validation"},
    ]

    train_indices, validation_indices = split(labels, rows, seed=7, val_fraction=0.2)

    assert train_indices.tolist() == [0, 1]
    assert validation_indices.tolist() == [2, 3]


def test_joint_training_writes_expression_and_affect_heads(
    tmp_path, monkeypatch
) -> None:
    rng = np.random.default_rng(7)
    labels = np.repeat(np.arange(8), 4)
    rows = np.asarray(
        [
            json.dumps(
                {
                    "image": f"{index}.jpg",
                    "label": str(label),
                    "session": "one",
                    "valence": -0.7 + 0.2 * (label % 8),
                    "arousal": -0.6 + 0.1 * (index % 4),
                }
            )
            for index, label in enumerate(labels)
        ]
    )
    cache = tmp_path / "embeddings.npz"
    np.savez_compressed(
        cache,
        features=rng.normal(size=(len(labels), 1280)).astype(np.float32),
        labels=labels.astype(np.int64),
        valence=np.asarray(
            [-0.7 + 0.2 * (label % 8) for label in labels], dtype=np.float32
        ),
        arousal=np.asarray(
            [-0.6 + 0.1 * (index % 4) for index in range(len(labels))],
            dtype=np.float32,
        ),
        rows=rows,
    )

    class FakeRecognizer:
        def __init__(self, **_kwargs) -> None:
            self.classifier_weights = np.zeros((10, 1280), dtype=np.float32)
            self.classifier_bias = np.zeros(10, dtype=np.float32)

    fake_module = types.ModuleType("emotiefflib.facial_analysis")
    fake_module.EmotiEffLibRecognizer = FakeRecognizer
    monkeypatch.setitem(sys.modules, "emotiefflib.facial_analysis", fake_module)
    output = tmp_path / "multitask.pt"

    train(
        cache,
        output,
        epochs=2,
        seed=7,
        val_fraction=0.25,
        affect_loss_weight=1.0,
    )

    saved = torch.load(output, map_location="cpu", weights_only=True)
    assert saved["weight"].shape == (8, 1280)
    assert saved["affect_weight"].shape == (2, 1280)
    assert saved["affect_dimensions"] == ("valence", "arousal")
    assert output.with_suffix(".json").is_file()
