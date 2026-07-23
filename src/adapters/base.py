"""Adapter interface for live emotion providers."""

from abc import ABC, abstractmethod
from typing import Any
from src.schema import EmotionReading


class EmotionAdapter(ABC):
    name: str

    @abstractmethod
    def analyze_frame(self, frame: Any) -> list[EmotionReading]:
        """Analyze a BGR OpenCV frame and return one reading per detected face."""
        raise NotImplementedError

    def close(self) -> None:
        """Release provider resources, if any."""
