from __future__ import annotations

import numpy as np
from metrics import binary_roc_auc, classification_metrics

CLASSES = ("a", "b", "c")


def test_binary_roc_auc_uses_pairwise_ranking_and_half_credit_for_ties() -> None:
    scores = np.asarray([0.9, 0.5, 0.5, 0.1])
    positives = np.asarray([True, True, False, False])

    assert binary_roc_auc(scores, positives) == 0.875


def test_perfect_predictions_have_perfect_accuracy_and_auc() -> None:
    logits = np.asarray(
        [
            [8.0, 0.0, 0.0],
            [0.0, 8.0, 0.0],
            [0.0, 0.0, 8.0],
            [7.0, 1.0, 0.0],
            [0.0, 7.0, 1.0],
            [1.0, 0.0, 7.0],
        ]
    )
    labels = np.asarray([0, 1, 2, 0, 1, 2])

    metrics = classification_metrics(logits, labels, CLASSES)

    assert metrics["accuracy"] == 1.0
    assert metrics["balanced_accuracy"] == 1.0
    assert metrics["top_2_accuracy"] == 1.0
    assert metrics["roc_auc_ovr_macro"] == 1.0
    assert metrics["highest_confidence_errors"] == []
    assert metrics["negative_log_likelihood"] < 0.01
    assert metrics["brier_score"] < 0.001


def test_confidently_wrong_prediction_is_reported_and_penalized() -> None:
    labels = np.asarray([0, 1, 2])
    uncertain_logits = np.asarray(
        [
            [0.0, 0.1, -2.0],
            [-2.0, 3.0, -2.0],
            [-2.0, -2.0, 3.0],
        ]
    )
    confident_logits = uncertain_logits.copy()
    confident_logits[0] = [-5.0, 8.0, -5.0]

    uncertain = classification_metrics(uncertain_logits, labels, CLASSES)
    confident = classification_metrics(
        confident_logits,
        labels,
        CLASSES,
        rows=[{"image": "wrong.jpg"}, {}, {}],
    )

    assert uncertain["accuracy"] == confident["accuracy"] == 2 / 3
    assert confident["negative_log_likelihood"] > uncertain["negative_log_likelihood"]
    assert (
        confident["max_negative_log_likelihood"]
        > uncertain["max_negative_log_likelihood"]
    )
    assert confident["brier_score"] > uncertain["brier_score"]
    assert confident["mean_confidence_when_incorrect"] > 0.99
    assert confident["confidence_thresholds"]["0.90"]["confident_error_count"] == 1
    assert confident["highest_confidence_errors"][0]["image"] == "wrong.jpg"
    assert confident["highest_confidence_errors"][0]["expected"] == "a"
    assert confident["highest_confidence_errors"][0]["predicted"] == "b"
