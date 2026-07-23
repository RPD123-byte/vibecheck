from __future__ import annotations

import pytest

from uncover.runtime.config import RuntimeConfig


def test_defaults_and_cross_process_serialization() -> None:
    config = RuntimeConfig()
    assert RuntimeConfig.from_json(config.to_json()) == config
    assert config.display_entry_threshold == config.interruption_threshold == 0.50


def test_invalid_threshold_and_freshness_combinations_fail() -> None:
    with pytest.raises(ValueError, match="exit"):
        RuntimeConfig(display_exit_threshold=0.6)
    with pytest.raises(ValueError, match="must match"):
        RuntimeConfig(interruption_threshold=0.9)
    with pytest.raises(ValueError, match="exceed"):
        RuntimeConfig(freshness_seconds=0.1)
