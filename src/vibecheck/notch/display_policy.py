"""Responsive threshold, hysteresis, and transition confirmation."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from vibecheck.emotion.schema import CANONICAL_EMOTIONS

DISPLAY_EMOTIONS = tuple(name for name in CANONICAL_EMOTIONS if name != "neutral")


def eligible_emotions(
    committed: tuple[str, ...],
    scores: Mapping[str, float],
    *,
    entry_threshold: float,
    exit_threshold: float,
    surprise_entry_threshold: float,
    surprise_exit_threshold: float,
) -> tuple[str, ...]:
    if exit_threshold > entry_threshold:
        raise ValueError("exit threshold cannot exceed entry threshold")
    if surprise_exit_threshold > surprise_entry_threshold:
        raise ValueError("surprise exit threshold cannot exceed entry threshold")

    def thresholds(name: str) -> tuple[float, float]:
        if name == "surprise":
            return surprise_entry_threshold, surprise_exit_threshold
        return entry_threshold, exit_threshold

    ranked = sorted(
        DISPLAY_EMOTIONS,
        key=lambda name: (-float(scores.get(name, 0.0)), name),
    )
    primary = ranked[0]
    primary_score = float(scores.get(primary, 0.0))
    primary_entry, _ = thresholds(primary)

    current = committed[0] if committed else None
    if current is None:
        return (primary,) if primary_score > primary_entry else ()

    if primary != current and primary_score > primary_entry:
        return (primary,)

    _, current_exit = thresholds(current)
    if float(scores.get(current, 0.0)) >= current_exit:
        return (current,)
    return ()


@dataclass(slots=True)
class DisplayPolicy:
    entry_threshold: float = 0.50
    exit_threshold: float = 0.45
    confirmations: int = 2
    surprise_entry_threshold: float = 0.30
    surprise_exit_threshold: float = 0.25
    committed: tuple[str, ...] = field(default=(), init=False)
    _candidate: tuple[str, ...] | None = field(default=None, init=False)
    _candidate_count: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        if self.confirmations < 1:
            raise ValueError("confirmations must be at least one")
        if not 0.0 <= self.exit_threshold <= self.entry_threshold <= 1.0:
            raise ValueError("display thresholds are invalid")
        if not (
            0.0 <= self.surprise_exit_threshold <= self.surprise_entry_threshold <= 1.0
        ):
            raise ValueError("surprise display thresholds are invalid")

    def observe(self, scores: Mapping[str, float]) -> tuple[str, ...]:
        candidate = eligible_emotions(
            self.committed,
            scores,
            entry_threshold=self.entry_threshold,
            exit_threshold=self.exit_threshold,
            surprise_entry_threshold=self.surprise_entry_threshold,
            surprise_exit_threshold=self.surprise_exit_threshold,
        )
        if not candidate:
            self.reset()
            return self.committed
        if candidate == self.committed:
            self._candidate = None
            self._candidate_count = 0
            return self.committed
        if candidate == self._candidate:
            self._candidate_count += 1
        else:
            self._candidate = candidate
            self._candidate_count = 1
        if self._candidate_count >= self.confirmations:
            self.committed = candidate
            self._candidate = None
            self._candidate_count = 0
        return self.committed

    def reset_pending(self) -> None:
        self._candidate = None
        self._candidate_count = 0

    def reset(self) -> None:
        self.committed = ()
        self.reset_pending()
