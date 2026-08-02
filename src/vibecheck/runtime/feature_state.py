"""Validated mutable feature intent for the runtime owner."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class IntegrationState:
    codex_enabled: bool = False

    def to_dict(self) -> dict[str, bool]:
        return {"codex_enabled": self.codex_enabled}


@dataclass(frozen=True, slots=True)
class FeatureState:
    revision: int = 0
    notch_enabled: bool = False
    component_reactions_enabled: bool = False
    integrations: IntegrationState = IntegrationState()
    paused: bool = False

    def __post_init__(self) -> None:
        if isinstance(self.revision, bool) or self.revision < 0:
            raise ValueError("revision must be a non-negative integer")

    @property
    def codex_enabled(self) -> bool:
        return self.integrations.codex_enabled

    def to_dict(self) -> dict[str, Any]:
        return {
            "revision": self.revision,
            "notch_enabled": self.notch_enabled,
            "component_reactions_enabled": self.component_reactions_enabled,
            "integrations": self.integrations.to_dict(),
            "paused": self.paused,
        }

    def with_revision(self, revision: int) -> FeatureState:
        return FeatureState(
            revision=revision,
            notch_enabled=self.notch_enabled,
            component_reactions_enabled=self.component_reactions_enabled,
            integrations=self.integrations,
            paused=self.paused,
        )

    @classmethod
    def from_features(
        cls,
        value: object,
        *,
        revision: int,
    ) -> FeatureState:
        if not isinstance(value, dict):
            raise ValueError("features must be an object")
        if set(value) != {
            "notch_enabled",
            "component_reactions_enabled",
            "integrations",
            "paused",
        }:
            raise ValueError("features must contain only the supported fields")
        integrations = value["integrations"]
        if not isinstance(integrations, dict) or set(integrations) != {"codex_enabled"}:
            raise ValueError("integrations must contain only codex_enabled")
        notch_enabled = value["notch_enabled"]
        component_reactions_enabled = value["component_reactions_enabled"]
        codex_enabled = integrations["codex_enabled"]
        paused = value["paused"]
        if not all(
            isinstance(item, bool)
            for item in (
                notch_enabled,
                component_reactions_enabled,
                codex_enabled,
                paused,
            )
        ):
            raise ValueError("feature values must be booleans")
        return cls(
            revision=revision,
            notch_enabled=notch_enabled,
            component_reactions_enabled=component_reactions_enabled,
            integrations=IntegrationState(codex_enabled=codex_enabled),
            paused=paused,
        )


def initial_features_for_mode(mode: str) -> FeatureState:
    """Map compatibility CLI modes to their historical worker topology."""
    if mode == "display-only":
        return FeatureState(notch_enabled=True)
    if mode in {"normal", "demo", "dry-run"}:
        return FeatureState(
            notch_enabled=True,
            integrations=IntegrationState(codex_enabled=True),
        )
    raise ValueError(f"unsupported mode {mode!r}")
