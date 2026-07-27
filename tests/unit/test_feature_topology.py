from __future__ import annotations

import pytest

from vibecheck.runtime.feature_state import (
    FeatureState,
    IntegrationState,
    initial_features_for_mode,
)
from vibecheck.runtime.topology import required_roles


@pytest.mark.parametrize(
    ("notch", "codex", "paused", "expected"),
    [
        (False, False, False, set()),
        (True, False, False, {"notch", "inference"}),
        (False, True, False, {"interruption", "inference"}),
        (True, True, False, {"notch", "interruption", "inference"}),
        (False, False, True, set()),
        (True, False, True, set()),
        (False, True, True, set()),
        (True, True, True, set()),
    ],
)
def test_complete_topology_matrix(
    notch: bool,
    codex: bool,
    paused: bool,
    expected: set[str],
) -> None:
    state = FeatureState(
        notch_enabled=notch,
        integrations=IntegrationState(codex_enabled=codex),
        paused=paused,
    )
    assert required_roles(state) == expected


def test_mode_compatibility() -> None:
    assert required_roles(initial_features_for_mode("normal")) == {
        "notch",
        "interruption",
        "inference",
    }
    assert required_roles(initial_features_for_mode("demo")) == {
        "notch",
        "interruption",
        "inference",
    }
    assert required_roles(initial_features_for_mode("dry-run")) == {
        "notch",
        "interruption",
        "inference",
    }
    assert required_roles(initial_features_for_mode("display-only")) == {
        "notch",
        "inference",
    }


def test_feature_input_is_exact_and_boolean() -> None:
    state = FeatureState.from_features(
        {
            "notch_enabled": True,
            "integrations": {"codex_enabled": False},
            "paused": False,
        },
        revision=2,
    )
    assert state.revision == 2
    with pytest.raises(ValueError):
        FeatureState.from_features(
            {
                "notch_enabled": 1,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
            revision=3,
        )
