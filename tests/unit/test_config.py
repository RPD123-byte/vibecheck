from __future__ import annotations

import pytest

from vibecheck.runtime.cli import _config_from_args, _parser
from vibecheck.runtime.config import RuntimeConfig


def test_defaults_and_cross_process_serialization() -> None:
    config = RuntimeConfig()
    assert RuntimeConfig.from_json(config.to_json()) == config
    assert config.display_entry_threshold == config.interruption_threshold == 0.30
    assert config.display_exit_threshold == 0.25


def test_cli_threshold_preserves_five_point_hysteresis_gap() -> None:
    args = _parser().parse_args(["--threshold", "0.4"])
    config = _config_from_args(args)
    assert config.display_entry_threshold == config.interruption_threshold == 0.4
    assert config.display_exit_threshold == pytest.approx(0.35)


def test_invalid_threshold_and_freshness_combinations_fail() -> None:
    with pytest.raises(ValueError, match="exit"):
        RuntimeConfig(display_exit_threshold=0.6)
    with pytest.raises(ValueError, match="must match"):
        RuntimeConfig(interruption_threshold=0.9)
    with pytest.raises(ValueError, match="exceed"):
        RuntimeConfig(freshness_seconds=0.1)
