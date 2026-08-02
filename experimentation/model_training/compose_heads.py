"""Compose independently selected expression and affect linear-head rows."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch


def compose(expression_path: Path, affect_path: Path, output_path: Path) -> None:
    """Keep expression rows from one checkpoint and V/A rows from another."""
    expression = torch.load(expression_path, map_location="cpu", weights_only=True)
    affect = torch.load(affect_path, map_location="cpu", weights_only=True)
    for key in ("base_model", "emotions", "affect_dimensions"):
        if expression.get(key) != affect.get(key):
            raise ValueError(f"Source checkpoints disagree on {key}")

    combined = dict(expression)
    combined["affect_weight"] = affect["affect_weight"]
    combined["affect_bias"] = affect["affect_bias"]
    combined["affect_validation_metrics"] = affect["affect_validation_metrics"]
    combined["affect_best_epoch"] = affect["best_epoch"]
    combined["selection"] = {
        "expression_checkpoint": expression_path.name,
        "affect_checkpoint": affect_path.name,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(combined, output_path)

    expression_report = json.loads(expression_path.with_suffix(".json").read_text())
    affect_report = json.loads(affect_path.with_suffix(".json").read_text())
    expression_predictions = expression_report["validation_predictions"]
    affect_predictions = affect_report["validation_predictions"]
    if [row["image"] for row in expression_predictions] != [
        row["image"] for row in affect_predictions
    ]:
        raise ValueError("Source reports use different validation images or order")

    report = dict(expression_report)
    report["personalized_affect_validation_metrics"] = affect_report[
        "personalized_affect_validation_metrics"
    ]
    report["affect_metrics_by_expression"] = affect_report[
        "affect_metrics_by_expression"
    ]
    report["validation_predictions"] = [
        {
            **expression_row,
            "predicted_valence": affect_row["predicted_valence"],
            "predicted_arousal": affect_row["predicted_arousal"],
        }
        for expression_row, affect_row in zip(
            expression_predictions, affect_predictions, strict=True
        )
    ]
    report["affect_best_epoch"] = affect["best_epoch"]
    report["selection"] = combined["selection"]
    report["notes"] = [
        "Expression and affect rows are independent outputs over one frozen embedding.",
        "Each output group uses its independently validation-selected checkpoint.",
    ]
    output_path.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expression", type=Path, required=True)
    parser.add_argument("--affect", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    compose(args.expression, args.affect, args.output)


if __name__ == "__main__":
    main()
