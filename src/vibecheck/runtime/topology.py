"""Pure feature-state to process-topology mapping."""

from __future__ import annotations

from vibecheck.runtime.feature_state import FeatureState

CONSUMER_ROLES = ("notch", "interruption")
ALL_ROLES = (*CONSUMER_ROLES, "inference")


def required_roles(state: FeatureState) -> frozenset[str]:
    if state.paused:
        return frozenset()
    roles: set[str] = set()
    if state.notch_enabled:
        roles.add("notch")
    if state.codex_enabled:
        roles.add("interruption")
    if state.component_reactions_enabled:
        roles.add("interruption")
    if state.notch_enabled or state.codex_enabled:
        roles.add("inference")
    return frozenset(roles)


def start_order(roles: set[str] | frozenset[str]) -> tuple[str, ...]:
    """Consumers bind first so the first inference event is observable."""
    return tuple(role for role in ALL_ROLES if role in roles)


def stop_order(roles: set[str] | frozenset[str]) -> tuple[str, ...]:
    """Consumers drain before the last inference producer releases the camera."""
    return tuple(role for role in ALL_ROLES if role in roles)
