"""Explicit lazy adapter registry."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from vibecheck.inference.adapters.base import EmotionAdapter

AdapterFactory = Callable[..., EmotionAdapter]


def _emotiefflib_factory(**kwargs: Any) -> EmotionAdapter:
    from vibecheck.inference.adapters.emotiefflib import EmotiEffLibAdapter

    return EmotiEffLibAdapter(**kwargs)


ADAPTERS: dict[str, AdapterFactory] = {"emotiefflib": _emotiefflib_factory}


def create_adapter(name: str, **kwargs: Any) -> EmotionAdapter:
    normalized = name.lower()
    try:
        factory = ADAPTERS[normalized]
    except KeyError as exc:
        valid = ", ".join(sorted(ADAPTERS))
        raise ValueError(
            f"unknown emotion adapter {name!r}; valid adapters: {valid}"
        ) from exc
    return factory(**kwargs)
