from __future__ import annotations

import json
from pathlib import Path

from uncover.notch.display_policy import DisplayPolicy
from uncover.notch.layout import calculate_notch_layout
from uncover.notch.state import NotchProjection
from uncover.stream.protocol import EventEnvelope


def test_show_and_switch_need_two_samples_but_clear_is_immediate() -> None:
    policy = DisplayPolicy()
    assert policy.observe({"anger": 0.8}) == ()
    assert policy.observe({"anger": 0.8}) == ("anger",)
    assert policy.observe({"disgust": 0.9}) == ("anger",)
    assert policy.observe({"anger": 0.8}) == ("anger",)
    assert policy.observe({"neutral": 1.0}) == ()


def test_hysteresis_and_neutral_suppression() -> None:
    policy = DisplayPolicy(confirmations=1)
    assert policy.observe({"anger": 0.30, "neutral": 0.99}) == ()
    assert policy.observe({"anger": 0.31, "neutral": 0.99}) == ("anger",)
    assert policy.observe({"anger": 0.27}) == ("anger",)
    assert policy.observe({"anger": 0.24}) == ()
    assert policy.observe({"neutral": 1.0}) == ()


def test_active_left_optical_edge_is_stable() -> None:
    one = calculate_notch_layout(500, 185, 32)
    two = calculate_notch_layout(500, 185, 64)
    assert one.content_x + one.content_width == two.content_x + two.content_width
    assert one.shape_width < two.shape_width


def test_active_left_layout_matches_frozen_visual_fixture() -> None:
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "notch"
        / "active_left_layout.json"
    )
    fixture = json.loads(fixture_path.read_text())
    for expected in fixture["states"].values():
        layout = calculate_notch_layout(
            fixture["notch_x"],
            fixture["notch_width"],
            expected["content_width"],
        )
        assert layout.shape_x == expected["shape_x"]
        assert layout.shape_width == expected["shape_width"]
        assert layout.content_x == expected["content_x"]


def test_display_smoothing_matches_frozen_scenario() -> None:
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "scenarios"
        / "display_smoothing.json"
    )
    fixture = json.loads(fixture_path.read_text())
    policy = DisplayPolicy(
        fixture["entry_threshold"],
        fixture["exit_threshold"],
        fixture["confirmations"],
    )
    assert [list(policy.observe(scores)) for scores in fixture["readings"]] == fixture[
        "expected"
    ]


def test_dropped_snapshot_preserves_committed_expression() -> None:
    scores = {"anger": 0.8}
    projection = NotchProjection()

    def reading(sequence: int, runtime_id: str = "runtime") -> EventEnvelope:
        return EventEnvelope(
            "reading",
            runtime_id,
            sequence,
            sequence * 160,
            sequence * 160,
            {"scores": scores},
        )

    assert projection.apply_emotion(reading(1)).emotions == ()
    assert projection.apply_emotion(reading(2)).emotions == ("anger",)
    assert projection.apply_emotion(
        reading(4), discontinuity=True, producer_restart=False
    ).emotions == ("anger",)
    assert (
        projection.apply_emotion(
            reading(0, "replacement"), discontinuity=True, producer_restart=True
        ).emotions
        == ()
    )
