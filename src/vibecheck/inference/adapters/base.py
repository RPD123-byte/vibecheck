"""Inference adapter interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from vibecheck.emotion.schema import EmotionReading


class EmotionAdapter(ABC):
    name: str

    @abstractmethod
    def analyze_frame(self, frame: Any) -> EmotionReading | None:
        """Analyze one BGR frame and return the selected primary face."""

    def close(self) -> None:
        """Release provider resources."""
        return None
