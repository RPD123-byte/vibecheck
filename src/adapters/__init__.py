"""Emotion provider adapters."""

from .base import EmotionAdapter
from .emotiefflib import EmotiEffLibAdapter

__all__ = ["EmotionAdapter", "EmotiEffLibAdapter"]
