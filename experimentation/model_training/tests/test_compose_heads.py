import json

import torch

from experimentation.model_training.compose_heads import compose


def _write_checkpoint(path, *, expression_value, affect_value):
    torch.save(
        {
            "weight": torch.full((8, 1280), expression_value),
            "bias": torch.full((8,), expression_value),
            "affect_weight": torch.full((2, 1280), affect_value),
            "affect_bias": torch.full((2,), affect_value),
            "affect_dimensions": ("valence", "arousal"),
            "base_model": "enet_b0_8_va_mtl",
            "emotions": ("anger", "contempt"),
            "best_epoch": int(expression_value),
            "affect_validation_metrics": {"mean_mae": affect_value},
        },
        path,
    )
    path.with_suffix(".json").write_text(
        json.dumps(
            {
                "personalized_affect_validation_metrics": {"mean_mae": affect_value},
                "affect_metrics_by_expression": {"anger": affect_value},
                "validation_predictions": [
                    {
                        "image": "face.jpg",
                        "predicted_expression": "anger",
                        "predicted_valence": affect_value,
                        "predicted_arousal": affect_value,
                    }
                ],
            }
        )
    )


def test_compose_uses_expression_and_affect_from_separate_sources(tmp_path):
    expression_path = tmp_path / "expression.pt"
    affect_path = tmp_path / "affect.pt"
    output_path = tmp_path / "combined.pt"
    _write_checkpoint(expression_path, expression_value=3, affect_value=30)
    _write_checkpoint(affect_path, expression_value=7, affect_value=70)

    compose(expression_path, affect_path, output_path)

    checkpoint = torch.load(output_path, map_location="cpu", weights_only=True)
    report = json.loads(output_path.with_suffix(".json").read_text())
    assert torch.all(checkpoint["weight"] == 3)
    assert torch.all(checkpoint["affect_weight"] == 70)
    assert checkpoint["best_epoch"] == 3
    assert checkpoint["affect_best_epoch"] == 7
    assert report["validation_predictions"][0]["predicted_valence"] == 70
