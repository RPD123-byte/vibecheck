"""Extract EmotiEffLib embeddings and train a personalized linear head.

This is deliberately a small, inspectable baseline. It keeps the backbone
frozen, starts from the shipped classifier, uses session-aware validation when
possible, and reports learning-curve results rather than hiding data needs.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image

try:
    from .metrics import classification_metrics
except ImportError:
    from metrics import classification_metrics

EMOTIONS = (
    "anger",
    "contempt",
    "disgust",
    "fear",
    "happiness",
    "neutral",
    "sadness",
    "surprise",
)
INDEX = {name: i for i, name in enumerate(EMOTIONS)}
AFFECT_DIMENSIONS = ("valence", "arousal")
DEFAULT_MODEL = "enet_b0_8_va_mtl"


def print_metric_summary(name: str, metrics: dict) -> None:
    incorrect_confidence = metrics["mean_confidence_when_incorrect"]
    incorrect_text = (
        f"{incorrect_confidence:.3f}" if incorrect_confidence is not None else "n/a"
    )
    high_confidence_errors = metrics["confidence_thresholds"]["0.80"][
        "confident_error_count"
    ]
    print(
        f"{name} accuracy={metrics['accuracy']:.3f} "
        f"balanced_accuracy={metrics['balanced_accuracy']:.3f} "
        f"nll={metrics['negative_log_likelihood']:.3f} "
        f"brier={metrics['brier_score']:.3f} "
        f"roc_auc_macro={metrics['roc_auc_ovr_macro']:.3f} "
        f"ece={metrics['expected_calibration_error']:.3f} "
        f"correct_confidence={metrics['mean_confidence_when_correct']:.3f} "
        f"incorrect_confidence={incorrect_text} "
        f"errors_at_80pct={high_confidence_errors}"
    )


def regression_metrics(predicted: torch.Tensor, expected: torch.Tensor) -> dict:
    """Return interpretable V/A errors, ignoring dimensions with missing labels."""
    prediction = predicted.detach().cpu().numpy()
    target = expected.detach().cpu().numpy()
    result: dict[str, object] = {}
    all_absolute_errors: list[float] = []
    for index, dimension in enumerate(AFFECT_DIMENSIONS):
        mask = np.isfinite(target[:, index])
        if not mask.any():
            result[dimension] = {"count": 0, "mae": None, "rmse": None}
            continue
        errors = prediction[mask, index] - target[mask, index]
        absolute = np.abs(errors)
        actual = target[mask, index]
        estimate = prediction[mask, index]
        actual_centered = actual - actual.mean()
        estimate_centered = estimate - estimate.mean()
        covariance = float(np.mean(actual_centered * estimate_centered))
        denominator = float(
            actual.var() + estimate.var() + (actual.mean() - estimate.mean()) ** 2
        )
        concordance = (
            1.0
            if denominator == 0 and np.allclose(actual, estimate)
            else (2.0 * covariance / denominator if denominator > 0 else None)
        )
        correlation = (
            float(np.corrcoef(actual, estimate)[0, 1])
            if len(actual) >= 2 and actual.std() > 0 and estimate.std() > 0
            else None
        )
        all_absolute_errors.extend(absolute.tolist())
        result[dimension] = {
            "count": int(mask.sum()),
            "mae": float(absolute.mean()),
            "rmse": float(np.sqrt(np.square(errors).mean())),
            "mean_signed_error": float(errors.mean()),
            "pearson_correlation": correlation,
            "concordance_correlation_coefficient": concordance,
            "within_0.1": float((absolute <= 0.100001).mean()),
            "within_0.2": float((absolute <= 0.200001).mean()),
        }
    result["mean_mae"] = (
        float(np.mean(all_absolute_errors)) if all_absolute_errors else None
    )
    return result


def print_affect_summary(name: str, metrics: dict) -> None:
    values = []
    for dimension in AFFECT_DIMENSIONS:
        item = metrics[dimension]
        mae = item["mae"]
        values.append(
            f"{dimension}_mae={mae:.3f}" if mae is not None else f"{dimension}_mae=n/a"
        )
    print(f"{name} {' '.join(values)}")


def affect_from_payload(
    payload: np.lib.npyio.NpzFile, rows: list[dict]
) -> torch.Tensor:
    if all(name in payload.files for name in AFFECT_DIMENSIONS):
        values = np.column_stack([payload[name] for name in AFFECT_DIMENSIONS])
    else:
        values = np.asarray(
            [
                [
                    float(row.get("valence", np.nan)),
                    float(row.get("arousal", np.nan)),
                ]
                for row in rows
            ],
            dtype=np.float32,
        )
    return torch.from_numpy(values.astype(np.float32, copy=False))


def masked_affect_loss(predicted: torch.Tensor, expected: torch.Tensor) -> torch.Tensor:
    mask = torch.isfinite(expected)
    if not bool(mask.any()):
        return predicted.sum() * 0.0
    return torch.nn.functional.smooth_l1_loss(predicted[mask], expected[mask])


def records(data_dir: Path) -> list[dict]:
    manifest = data_dir / "manifest.jsonl"
    if not manifest.exists():
        raise FileNotFoundError(
            f"No manifest found at {manifest}; run capture.py first"
        )
    rows = [
        json.loads(line) for line in manifest.read_text().splitlines() if line.strip()
    ]
    for row in rows:
        row["path"] = str(data_dir / row["image"])
        if row["label"] not in INDEX:
            raise ValueError(f"Unknown label {row['label']!r}")
    return rows


def extract(data_dir: Path, cache: Path, model_name: str) -> None:
    from emotiefflib.facial_analysis import EmotiEffLibRecognizer
    from facenet_pytorch import MTCNN

    rows = records(data_dir)
    recognizer = EmotiEffLibRecognizer(
        engine="onnx", model_name=model_name, device="cpu"
    )
    detector = MTCNN(keep_all=True, post_process=False, min_face_size=40, device="cpu")
    features, kept = [], []
    for index, row in enumerate(rows, 1):
        image = np.asarray(Image.open(row["path"]).convert("RGB"))
        boxes, probabilities = detector.detect(image)
        candidates = [
            (box, float(prob))
            for box, prob in zip(
                boxes if boxes is not None else [],
                probabilities if probabilities is not None else [],
                strict=False,
            )
            if prob is not None and float(prob) >= 0.90
        ]
        if not candidates:
            print(f"skip {row['image']}: no face")
            continue
        box, _ = max(
            candidates,
            key=lambda item: (
                max(0, item[0][2] - item[0][0]) * max(0, item[0][3] - item[0][1])
            ),
        )
        x1, y1, x2, y2 = (max(0, int(value)) for value in box)
        face = image[y1:y2, x1:x2]
        if face.size == 0:
            continue
        features.append(recognizer.extract_features(face)[0])
        kept.append(row)
        if index % 10 == 0:
            print(f"processed {index}/{len(rows)}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache,
        features=np.asarray(features, dtype=np.float32),
        labels=np.asarray([INDEX[r["label"]] for r in kept], dtype=np.int64),
        valence=np.asarray(
            [float(r.get("valence", np.nan)) for r in kept], dtype=np.float32
        ),
        arousal=np.asarray(
            [float(r.get("arousal", np.nan)) for r in kept], dtype=np.float32
        ),
        model_name=np.asarray(model_name),
        rows=np.asarray([json.dumps(r) for r in kept]),
    )
    print(f"wrote {len(kept)} embeddings to {cache}")


def split(labels: np.ndarray, rows: list[dict], seed: int, val_fraction: float):
    declared = {str(row.get("split", "")) for row in rows} - {""}
    if declared:
        unknown = declared - {"train", "validation"}
        if unknown:
            raise ValueError(f"Unknown explicit data splits: {sorted(unknown)}")
        train = np.asarray(
            [index for index, row in enumerate(rows) if row.get("split") == "train"]
        )
        validation = np.asarray(
            [
                index
                for index, row in enumerate(rows)
                if row.get("split") == "validation"
            ]
        )
        if len(train) == 0 or len(validation) == 0:
            raise ValueError(
                "Explicit split requires both train and validation records"
            )
        return train, validation
    rng = random.Random(seed)
    sessions = sorted({row.get("session", "") for row in rows})
    if len(sessions) >= 2:
        val_session = sessions[-1]
        val = np.asarray([row.get("session", "") == val_session for row in rows])
        train_labels = set(labels[~val].tolist())
        val_labels = set(labels[val].tolist())
        all_labels = set(labels.tolist())
        # A session holdout is only meaningful if both sides cover every class.
        # Tiny setup/test sessions must not become the entire training fold.
        if train_labels == all_labels and val_labels == all_labels:
            return np.flatnonzero(~val), np.flatnonzero(val)
    # Fallback for a single collection session: deterministic per-class split.
    train, val = [], []
    for label in range(len(EMOTIONS)):
        indices = [i for i, value in enumerate(labels) if value == label]
        rng.shuffle(indices)
        n_val = (
            max(1, int(round(len(indices) * val_fraction))) if len(indices) > 1 else 0
        )
        val.extend(indices[:n_val])
        train.extend(indices[n_val:])
    return np.asarray(train), np.asarray(val)


def train(
    cache: Path,
    output: Path,
    epochs: int,
    seed: int,
    val_fraction: float,
    max_per_class: int | None = None,
    affect_loss_weight: float = 1.0,
    model_name: str = DEFAULT_MODEL,
    anchor_strength: float = 1e-3,
) -> None:
    torch.manual_seed(seed)
    payload = np.load(cache, allow_pickle=False)
    x = torch.from_numpy(payload["features"])
    y = torch.from_numpy(payload["labels"])
    rows = [json.loads(value) for value in payload["rows"]]
    affect_y = affect_from_payload(payload, rows)
    train_idx, val_idx = split(y.numpy(), rows, seed, val_fraction)
    if max_per_class is not None:
        selected = []
        rng = random.Random(seed)
        for label in range(len(EMOTIONS)):
            class_indices = [i for i in train_idx if int(y[i]) == label]
            rng.shuffle(class_indices)
            selected.extend(class_indices[:max_per_class])
        train_idx = np.asarray(selected, dtype=np.int64)
    if len(train_idx) == 0 or len(val_idx) == 0:
        raise ValueError(
            "Need both training and validation examples; collect more data or sessions"
        )
    from emotiefflib.facial_analysis import EmotiEffLibRecognizer

    cached_model = str(payload["model_name"]) if "model_name" in payload.files else None
    if cached_model is not None and cached_model != model_name:
        raise ValueError(
            f"Cache embeddings came from {cached_model!r}, not {model_name!r}"
        )
    recognizer = EmotiEffLibRecognizer(
        engine="onnx", model_name=model_name, device="cpu"
    )
    base_weight = torch.from_numpy(recognizer.classifier_weights.copy())
    base_bias = torch.from_numpy(recognizer.classifier_bias.copy())
    if base_weight.shape != (10, 1280) or base_bias.shape != (10,):
        raise ValueError(
            f"{model_name} must expose 8 expression plus 2 V/A outputs; "
            f"got {tuple(base_weight.shape)} and {tuple(base_bias.shape)}"
        )
    head = torch.nn.Linear(1280, 8)
    affect_head = torch.nn.Linear(1280, 2)
    with torch.no_grad():
        head.weight.copy_(base_weight[:8])
        head.bias.copy_(base_bias[:8])
        # EmotiEffLib trains the final two MTL outputs in valence, arousal order.
        affect_head.weight.copy_(base_weight[-2:])
        affect_head.bias.copy_(base_bias[-2:])
    base_w, base_b = head.weight.detach().clone(), head.bias.detach().clone()
    base_affect_w = affect_head.weight.detach().clone()
    base_affect_b = affect_head.bias.detach().clone()
    optimizer = torch.optim.AdamW(
        [*head.parameters(), *affect_head.parameters()],
        lr=2e-3,
        weight_decay=1e-4,
    )
    train_x, train_y = x[train_idx], y[train_idx]
    val_x, val_y = x[val_idx], y[val_idx]
    train_affect = affect_y[train_idx]
    val_affect = affect_y[val_idx]
    if not bool(torch.isfinite(train_affect).any()):
        raise ValueError(
            "No valence/arousal labels exist in the training fold. "
            "Label the v2 anchors before training the joint head."
        )
    validation_rows = [rows[int(i)] for i in val_idx]
    with torch.no_grad():
        base_train_accuracy = float((head(train_x).argmax(1) == train_y).float().mean())
        base_validation_metrics = classification_metrics(
            head(val_x),
            val_y,
            EMOTIONS,
            rows=validation_rows,
        )
        base_affect_metrics = regression_metrics(
            affect_head(val_x).clamp(-1.0, 1.0), val_affect
        )
    base_val_accuracy = base_validation_metrics["accuracy"]
    print(f"original_head train_accuracy={base_train_accuracy:.3f}")
    print_metric_summary(
        "original_head_validation",
        base_validation_metrics,
    )
    print_affect_summary("pretrained_affect_validation", base_affect_metrics)
    best_accuracy = -1.0
    best_objective = float("inf")
    best_state = None
    for epoch in range(1, epochs + 1):
        head.train()
        affect_head.train()
        logits = head(train_x)
        expression_loss = torch.nn.functional.cross_entropy(logits, train_y)
        affect_loss = masked_affect_loss(affect_head(train_x), train_affect)
        anchor = anchor_strength * (
            (head.weight - base_w).square().mean()
            + (head.bias - base_b).square().mean()
            + (affect_head.weight - base_affect_w).square().mean()
            + (affect_head.bias - base_affect_b).square().mean()
        )
        loss = expression_loss + affect_loss_weight * affect_loss + anchor
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
        head.eval()
        affect_head.eval()
        with torch.no_grad():
            val_logits = head(val_x)
            val_affect_prediction = affect_head(val_x)
            pred = val_logits.argmax(1)
            accuracy = float((pred == val_y).float().mean())
            validation_objective = float(
                torch.nn.functional.cross_entropy(val_logits, val_y)
                + affect_loss_weight
                * masked_affect_loss(val_affect_prediction, val_affect)
            )
        if validation_objective < best_objective:
            best_objective = validation_objective
            best_accuracy = accuracy
            best_state = {
                "weight": head.weight.detach().clone(),
                "bias": head.bias.detach().clone(),
                "affect_weight": affect_head.weight.detach().clone(),
                "affect_bias": affect_head.bias.detach().clone(),
                "epoch": epoch,
            }
        if epoch == 1 or epoch % 10 == 0 or epoch == epochs:
            print(
                f"epoch={epoch:03d} expression_loss={expression_loss.item():.4f} "
                f"affect_loss={affect_loss.item():.4f} "
                f"val_accuracy={accuracy:.3f} val_objective={validation_objective:.4f}"
            )
    assert best_state is not None
    with torch.no_grad():
        head.weight.copy_(best_state["weight"])
        head.bias.copy_(best_state["bias"])
        affect_head.weight.copy_(best_state["affect_weight"])
        affect_head.bias.copy_(best_state["affect_bias"])
        personalized_validation_metrics = classification_metrics(
            head(val_x),
            val_y,
            EMOTIONS,
            rows=validation_rows,
        )
        personalized_affect_predictions = affect_head(val_x).clamp(-1.0, 1.0)
        personalized_affect_metrics = regression_metrics(
            personalized_affect_predictions, val_affect
        )
        validation_logits = head(val_x)
        validation_probabilities = torch.softmax(validation_logits, dim=1)
        validation_predictions = validation_logits.argmax(1)
    print_metric_summary(
        "personalized_head_validation",
        personalized_validation_metrics,
    )
    print_affect_summary("personalized_affect_validation", personalized_affect_metrics)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "weight": head.weight.detach(),
            "bias": head.bias.detach(),
            "affect_weight": affect_head.weight.detach(),
            "affect_bias": affect_head.bias.detach(),
            "affect_dimensions": AFFECT_DIMENSIONS,
            "base_model": model_name,
            "emotions": EMOTIONS,
            "best_epoch": best_state["epoch"],
            "validation_accuracy": best_accuracy,
            "validation_metrics": personalized_validation_metrics,
            "affect_validation_metrics": personalized_affect_metrics,
        },
        output,
    )
    report = {
        "train_examples": len(train_idx),
        "validation_examples": len(val_idx),
        "max_per_class": max_per_class,
        "seed": seed,
        "validation_images": [row["image"] for row in validation_rows],
        "original_train_accuracy": base_train_accuracy,
        "original_validation_accuracy": base_val_accuracy,
        "personalized_validation_accuracy": best_accuracy,
        "best_epoch": best_state["epoch"],
        "best_validation_objective": best_objective,
        "affect_loss_weight": affect_loss_weight,
        "anchor_strength": anchor_strength,
        "base_model": model_name,
        "original_validation_metrics": base_validation_metrics,
        "personalized_validation_metrics": personalized_validation_metrics,
        "pretrained_affect_validation_metrics": base_affect_metrics,
        "personalized_affect_validation_metrics": personalized_affect_metrics,
        "affect_metrics_by_expression": {
            emotion: regression_metrics(
                personalized_affect_predictions[
                    torch.asarray([int(value) == index for value in val_y])
                ],
                val_affect[torch.asarray([int(value) == index for value in val_y])],
            )
            for index, emotion in enumerate(EMOTIONS)
        },
        "validation_predictions": [
            {
                "image": row["image"],
                "source_image": row.get("source_image"),
                "expected_expression": EMOTIONS[int(val_y[index])],
                "predicted_expression": EMOTIONS[int(validation_predictions[index])],
                "expression_confidence": float(
                    validation_probabilities[index, validation_predictions[index]]
                ),
                "expected_valence": float(val_affect[index, 0]),
                "predicted_valence": float(personalized_affect_predictions[index, 0]),
                "expected_arousal": float(val_affect[index, 1]),
                "predicted_arousal": float(personalized_affect_predictions[index, 1]),
            }
            for index, row in enumerate(validation_rows)
        ],
        "confusion_rows_expected_columns_predicted": (
            personalized_validation_metrics[
                "confusion_matrix_rows_expected_columns_predicted"
            ]
        ),
    }
    output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"saved {output}; train={len(train_idx)} val={len(val_idx)} "
        f"best_epoch={best_state['epoch']} best_val_accuracy={best_accuracy:.3f}"
    )


def evaluate(cache: Path, head_path: Path, split_name: str = "all") -> None:
    payload = np.load(cache, allow_pickle=False)
    x = torch.from_numpy(payload["features"])
    y = torch.from_numpy(payload["labels"])
    rows = [json.loads(value) for value in payload["rows"]]
    affect_y = affect_from_payload(payload, rows)
    if split_name != "all":
        indices = [
            index for index, row in enumerate(rows) if row.get("split") == split_name
        ]
        if not indices:
            raise ValueError(f"No records found for split {split_name!r}")
        x = x[indices]
        y = y[indices]
        affect_y = affect_y[indices]
        rows = [rows[index] for index in indices]
    checkpoint = torch.load(head_path, map_location="cpu", weights_only=True)
    head = torch.nn.Linear(x.shape[1], len(EMOTIONS))
    with torch.no_grad():
        head.weight.copy_(checkpoint["weight"])
        head.bias.copy_(checkpoint["bias"])
        metrics = classification_metrics(head(x), y, EMOTIONS, rows=rows)
        affect_metrics = None
        if "affect_weight" in checkpoint and "affect_bias" in checkpoint:
            affect_head = torch.nn.Linear(x.shape[1], 2)
            affect_head.weight.copy_(checkpoint["affect_weight"])
            affect_head.bias.copy_(checkpoint["affect_bias"])
            affect_metrics = regression_metrics(
                affect_head(x).clamp(-1.0, 1.0), affect_y
            )
    print_metric_summary("evaluation", metrics)
    if affect_metrics is not None:
        print_affect_summary("affect_evaluation", affect_metrics)
    confusion = metrics["confusion_matrix_rows_expected_columns_predicted"]
    for label, confusion_row in zip(EMOTIONS, confusion, strict=True):
        total = sum(confusion_row)
        correct = confusion_row[INDEX[label]]
        print(f"{label:10} {correct:3d}/{total:<3d} {confusion_row}")
    if metrics["highest_confidence_errors"]:
        print("highest-confidence errors:")
    for error in metrics["highest_confidence_errors"]:
        print(
            f"  {error.get('image', '<unknown>')}: "
            f"{error['expected']} -> {error['predicted']} "
            f"confidence={error['predicted_confidence']:.3f} "
            f"true_probability={error['true_class_probability']:.3f}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("extract", "train", "evaluate"))
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(__file__).parent / "human_data" / "rithvik_expressions_v2",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(__file__).parent / "artifacts" / "rithvik_v2_embeddings.npz",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "artifacts" / "rithvik_v2_multitask_head.pt",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--val-fraction", type=float, default=0.2)
    parser.add_argument(
        "--affect-loss-weight",
        type=float,
        default=1.0,
        help="Relative weight for the masked valence/arousal Smooth L1 loss",
    )
    parser.add_argument(
        "--anchor-strength",
        type=float,
        default=1e-3,
        help="L2-SP strength pulling all ten outputs toward pretrained MTL values",
    )
    parser.add_argument(
        "--eval-split",
        choices=("all", "train", "validation"),
        default="all",
    )
    parser.add_argument(
        "--max-per-class",
        type=int,
        default=None,
        help="Use at most this many training examples per class (learning curves)",
    )
    args = parser.parse_args()
    if args.command == "extract":
        extract(args.data, args.cache, args.model)
    elif args.command == "train":
        train(
            args.cache,
            args.output,
            args.epochs,
            args.seed,
            args.val_fraction,
            args.max_per_class,
            args.affect_loss_weight,
            args.model,
            args.anchor_strength,
        )
    else:
        evaluate(args.cache, args.output, args.eval_split)


if __name__ == "__main__":
    main()
