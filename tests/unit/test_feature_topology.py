from __future__ import annotations

import pytest

from vibecheck.runtime.feature_state import (
    FeatureState,
    IntegrationState,
    initial_features_for_mode,
)
from vibecheck.runtime.topology import required_roles


@pytest.mark.parametrize(
    ("notch", "codex", "components", "paused", "expected"),
    [
        (False, False, False, False, set()),
        (True, False, False, False, {"notch", "inference"}),
        (False, True, False, False, {"interruption", "inference"}),
        (False, False, True, False, {"interruption"}),
        (True, False, True, False, {"notch", "interruption", "inference"}),
        (False, True, True, False, {"interruption", "inference"}),
        (True, True, True, False, {"notch", "interruption", "inference"}),
        (False, False, False, True, set()),
        (True, False, False, True, set()),
        (False, True, False, True, set()),
        (False, False, True, True, set()),
        (True, True, True, True, set()),
    ],
)
def test_complete_topology_matrix(
    notch: bool,
    codex: bool,
    components: bool,
    paused: bool,
    expected: set[str],
) -> None:
    state = FeatureState(
        notch_enabled=notch,
        component_reactions_enabled=components,
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
            "component_reactions_enabled": False,
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
                "component_reactions_enabled": False,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
            revision=3,
        )


def test_component_feature_is_required_and_boolean() -> None:
    with pytest.raises(ValueError):
        FeatureState.from_features(
            {
                "notch_enabled": False,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
            revision=1,
        )
    with pytest.raises(ValueError):
        FeatureState.from_features(
            {
                "notch_enabled": False,
                "component_reactions_enabled": 1,
                "integrations": {"codex_enabled": False},
                "paused": False,
            },
            revision=1,
        )
