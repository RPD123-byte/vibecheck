from __future__ import annotations

from uncover.notch.display_policy import DisplayPolicy
from uncover.notch.layout import calculate_notch_layout


def test_show_and_switch_need_two_samples_but_clear_is_immediate() -> None:
    policy = DisplayPolicy()
    assert policy.observe({"anger": 0.8}) == ()
    assert policy.observe({"anger": 0.8}) == ("anger",)
    assert policy.observe({"disgust": 0.9}) == ("anger",)
    assert policy.observe({"anger": 0.8}) == ("anger",)
    assert policy.observe({"neutral": 1.0}) == ()


def test_hysteresis_and_neutral_suppression() -> None:
    policy = DisplayPolicy(confirmations=1)
    assert policy.observe({"anger": 0.51, "neutral": 0.99}) == ("anger",)
    assert policy.observe({"anger": 0.47}) == ("anger",)
    assert policy.observe({"anger": 0.44}) == ()
    assert policy.observe({"neutral": 1.0}) == ()


def test_active_left_optical_edge_is_stable() -> None:
    one = calculate_notch_layout(500, 185, 32)
    two = calculate_notch_layout(500, 185, 64)
    assert one.content_x + one.content_width == two.content_x + two.content_width
    assert one.shape_width < two.shape_width
