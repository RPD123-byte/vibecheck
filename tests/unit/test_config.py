from __future__ import annotations

import pytest

from vibecheck.runtime.cli import _config_from_args, _parser
from vibecheck.runtime.config import RuntimeConfig


def test_defaults_and_cross_process_serialization() -> None:
    config = RuntimeConfig()
    assert RuntimeConfig.from_json(config.to_json()) == config
    assert config.display_entry_threshold == 0.50
    assert config.display_exit_threshold == 0.45
    assert config.surprise_display_entry_threshold == 0.30
    assert config.surprise_display_exit_threshold == 0.25
    assert config.interruption_threshold == 0.30
    assert config.freshness_seconds == 1.5


def test_cli_thresholds_preserve_independent_five_point_hysteresis_gaps() -> None:
    args = _parser().parse_args(
        [
            "--threshold",
            "0.6",
            "--surprise-threshold",
            "0.4",
            "--interruption-threshold",
            "0.7",
        ]
    )
    config = _config_from_args(args)
    assert config.display_entry_threshold == 0.6
    assert config.display_exit_threshold == pytest.approx(0.55)
    assert config.surprise_display_entry_threshold == 0.4
    assert config.surprise_display_exit_threshold == pytest.approx(0.35)
    assert config.interruption_threshold == 0.7


def test_invalid_threshold_and_freshness_combinations_fail() -> None:
    with pytest.raises(ValueError, match="exit"):
        RuntimeConfig(display_exit_threshold=0.6)
    with pytest.raises(ValueError, match="surprise_display_exit_threshold"):
        RuntimeConfig(surprise_display_exit_threshold=0.6)
    with pytest.raises(ValueError, match="exceed"):
        RuntimeConfig(freshness_seconds=0.1)
