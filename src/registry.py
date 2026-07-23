"""Named emotion adapter registry."""

from collections.abc import Callable
from src.adapters.base import EmotionAdapter
from src.adapters.emotiefflib import EmotiEffLibAdapter

ADAPTERS: dict[str, Callable[[], EmotionAdapter]] = {
    "emotiefflib": EmotiEffLibAdapter,
}


def create_adapter(name: str) -> EmotionAdapter:
    try:
        return ADAPTERS[name.lower()]()
    except KeyError as exc:
        raise ValueError(
            f"Unknown emotion model {name!r}; choose from: {', '.join(sorted(ADAPTERS))}"
        ) from exc
