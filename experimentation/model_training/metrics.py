"""Confidence-aware metrics for the personalized expression classifier."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from typing import Any

import numpy as np


def _as_numpy(value: Any) -> np.ndarray:
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    return np.asarray(value)


def probabilities_from_logits(logits: Any) -> np.ndarray:
    values = _as_numpy(logits).astype(np.float64, copy=False)
    if values.ndim != 2:
        raise ValueError(f"Expected [examples, classes] logits, got {values.shape}")
    shifted = values - values.max(axis=1, keepdims=True)
    exponentials = np.exp(shifted)
    return exponentials / exponentials.sum(axis=1, keepdims=True)


def binary_roc_auc(scores: Any, positives: Any) -> float | None:
    """Return pairwise ROC-AUC, with tied positive/negative scores worth one half."""
    score_values = _as_numpy(scores).astype(np.float64, copy=False)
    positive_mask = _as_numpy(positives).astype(bool, copy=False)
    positive_scores = score_values[positive_mask]
    negative_scores = score_values[~positive_mask]
    if not len(positive_scores) or not len(negative_scores):
        return None
    comparisons = positive_scores[:, None] - negative_scores[None, :]
    return float(
        (np.count_nonzero(comparisons > 0) + 0.5 * np.count_nonzero(comparisons == 0))
        / comparisons.size
    )


def _mean_or_none(values: np.ndarray) -> float | None:
    return float(values.mean()) if len(values) else None


def classification_metrics(
    logits: Any,
    labels: Any,
    class_names: Sequence[str],
    *,
    rows: Sequence[dict[str, Any]] | None = None,
    confidence_thresholds: Sequence[float] = (0.5, 0.7, 0.8, 0.9),
    calibration_bin_count: int = 10,
    max_error_records: int = 10,
) -> dict[str, Any]:
    """Measure correctness, confidence quality, ranking, and failure modes.

    ROC-AUC measures one-vs-rest ranking. Negative log-likelihood and Brier
    score measure probability quality. Confidence bins and error records make
    confidently wrong predictions directly inspectable.
    """
    probabilities = probabilities_from_logits(logits)
    expected = _as_numpy(labels).astype(np.int64, copy=False)
    if expected.ndim != 1:
        raise ValueError(f"Expected one-dimensional labels, got {expected.shape}")
    if len(expected) != len(probabilities):
        raise ValueError("Logit and label example counts do not match")
    if probabilities.shape[1] != len(class_names):
        raise ValueError("Class-name count does not match logit width")
    if rows is not None and len(rows) != len(expected):
        raise ValueError("Row and label example counts do not match")
    if not len(expected):
        raise ValueError("At least one example is required")

    predicted = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    true_probability = probabilities[np.arange(len(expected)), expected]
    correct = predicted == expected
    class_count = len(class_names)

    confusion = np.zeros((class_count, class_count), dtype=np.int64)
    np.add.at(confusion, (expected, predicted), 1)

    tiny = np.finfo(np.float64).tiny
    example_negative_log_likelihood = -np.log(np.maximum(true_probability, tiny))
    negative_log_likelihood = float(example_negative_log_likelihood.mean())
    targets = np.eye(class_count, dtype=np.float64)[expected]
    brier_score = float(np.square(probabilities - targets).sum(axis=1).mean())

    top_two = np.argpartition(probabilities, -2, axis=1)[:, -2:]
    top_2_accuracy = float(np.any(top_two == expected[:, None], axis=1).mean())

    confidence_bins: list[dict[str, Any]] = []
    expected_calibration_error = 0.0
    bin_edges = np.linspace(0.0, 1.0, calibration_bin_count + 1)
    for bin_index, (lower, upper) in enumerate(
        zip(bin_edges[:-1], bin_edges[1:], strict=True)
    ):
        if bin_index == calibration_bin_count - 1:
            in_bin = (confidence >= lower) & (confidence <= upper)
        else:
            in_bin = (confidence >= lower) & (confidence < upper)
        count = int(in_bin.sum())
        if not count:
            continue
        average_confidence = float(confidence[in_bin].mean())
        bin_accuracy = float(correct[in_bin].mean())
        gap = abs(average_confidence - bin_accuracy)
        expected_calibration_error += count / len(expected) * gap
        confidence_bins.append(
            {
                "lower": float(lower),
                "upper": float(upper),
                "count": count,
                "accuracy": bin_accuracy,
                "mean_confidence": average_confidence,
                "calibration_gap": gap,
            }
        )

    per_class: dict[str, dict[str, Any]] = {}
    auc_values: list[float] = []
    auc_weights: list[int] = []
    recalls: list[float] = []
    for class_index, class_name in enumerate(class_names):
        actual = expected == class_index
        chosen = predicted == class_index
        support = int(actual.sum())
        predicted_count = int(chosen.sum())
        true_positives = int((actual & chosen).sum())
        false_positives = int((~actual & chosen).sum())
        false_negatives = int((actual & ~chosen).sum())
        recall = true_positives / support if support else None
        precision = true_positives / predicted_count if predicted_count else None
        auc = binary_roc_auc(probabilities[:, class_index], actual)
        if recall is not None:
            recalls.append(recall)
        if auc is not None:
            auc_values.append(auc)
            auc_weights.append(support)
        per_class[class_name] = {
            "support": support,
            "predicted_count": predicted_count,
            "correct": true_positives,
            "false_positives": false_positives,
            "false_negatives": false_negatives,
            "precision": precision,
            "recall": recall,
            "one_vs_rest_roc_auc": auc,
            "mean_score_on_positive_images": _mean_or_none(
                probabilities[actual, class_index]
            ),
            "mean_score_on_negative_images": _mean_or_none(
                probabilities[~actual, class_index]
            ),
        }

    threshold_metrics: dict[str, dict[str, Any]] = {}
    incorrect_count = int((~correct).sum())
    for threshold in confidence_thresholds:
        selected = confidence >= threshold
        selected_count = int(selected.sum())
        confident_errors = selected & ~correct
        error_count = int(confident_errors.sum())
        threshold_metrics[f"{threshold:.2f}"] = {
            "predictions_at_or_above_threshold": selected_count,
            "coverage": selected_count / len(expected),
            "accuracy": float(correct[selected].mean()) if selected_count else None,
            "confident_error_count": error_count,
            "confident_error_fraction_of_all_examples": error_count / len(expected),
            "fraction_of_errors_at_or_above_threshold": (
                error_count / incorrect_count if incorrect_count else 0.0
            ),
        }

    pair_indices: dict[tuple[int, int], list[int]] = defaultdict(list)
    for example_index in np.flatnonzero(~correct):
        pair = (int(expected[example_index]), int(predicted[example_index]))
        pair_indices[pair].append(int(example_index))
    confusion_pairs = []
    for (expected_index, predicted_index), indices in pair_indices.items():
        selected = np.asarray(indices, dtype=np.int64)
        confusion_pairs.append(
            {
                "expected": class_names[expected_index],
                "predicted": class_names[predicted_index],
                "count": len(indices),
                "mean_predicted_confidence": float(confidence[selected].mean()),
                "max_predicted_confidence": float(confidence[selected].max()),
                "mean_true_class_probability": float(true_probability[selected].mean()),
            }
        )
    confusion_pairs.sort(
        key=lambda item: (item["count"], item["max_predicted_confidence"]),
        reverse=True,
    )

    highest_confidence_errors = []
    error_order = np.flatnonzero(~correct)
    error_order = error_order[np.argsort(confidence[error_order])[::-1]]
    for example_index in error_order[:max_error_records]:
        record = {
            "expected": class_names[int(expected[example_index])],
            "predicted": class_names[int(predicted[example_index])],
            "predicted_confidence": float(confidence[example_index]),
            "true_class_probability": float(true_probability[example_index]),
            "predicted_minus_true_probability": float(
                confidence[example_index] - true_probability[example_index]
            ),
            "probabilities": {
                class_name: float(probabilities[example_index, class_index])
                for class_index, class_name in enumerate(class_names)
            },
        }
        if rows is not None:
            record["image"] = rows[int(example_index)].get("image")
        highest_confidence_errors.append(record)

    weighted_auc = None
    if auc_values and sum(auc_weights):
        weighted_auc = float(np.average(auc_values, weights=auc_weights))

    return {
        "examples": len(expected),
        "accuracy": float(correct.mean()),
        "balanced_accuracy": float(np.mean(recalls)) if recalls else None,
        "top_2_accuracy": top_2_accuracy,
        "negative_log_likelihood": negative_log_likelihood,
        "median_negative_log_likelihood": float(
            np.median(example_negative_log_likelihood)
        ),
        "p90_negative_log_likelihood": float(
            np.quantile(example_negative_log_likelihood, 0.9)
        ),
        "max_negative_log_likelihood": float(example_negative_log_likelihood.max()),
        "brier_score": brier_score,
        "roc_auc_ovr_macro": float(np.mean(auc_values)) if auc_values else None,
        "roc_auc_ovr_weighted": weighted_auc,
        "mean_confidence": float(confidence.mean()),
        "mean_confidence_when_correct": _mean_or_none(confidence[correct]),
        "mean_confidence_when_incorrect": _mean_or_none(confidence[~correct]),
        "mean_true_class_probability": float(true_probability.mean()),
        "expected_calibration_error": float(expected_calibration_error),
        "confidence_thresholds": threshold_metrics,
        "per_class": per_class,
        "confusion_matrix_rows_expected_columns_predicted": confusion.tolist(),
        "confusion_pairs": confusion_pairs,
        "highest_confidence_errors": highest_confidence_errors,
        "confidence_bins": confidence_bins,
    }


def compact_metric_values(metrics: dict[str, Any]) -> dict[str, float]:
    """Return scalar metrics suitable for aggregating repeated training runs."""
    names = (
        "accuracy",
        "balanced_accuracy",
        "top_2_accuracy",
        "negative_log_likelihood",
        "median_negative_log_likelihood",
        "p90_negative_log_likelihood",
        "max_negative_log_likelihood",
        "brier_score",
        "roc_auc_ovr_macro",
        "roc_auc_ovr_weighted",
        "mean_confidence_when_correct",
        "mean_confidence_when_incorrect",
        "expected_calibration_error",
    )
    return {
        name: float(metrics[name])
        for name in names
        if metrics.get(name) is not None
    }
