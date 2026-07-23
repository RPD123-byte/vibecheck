"""The single production active-left notch geometry."""

from __future__ import annotations

from dataclasses import dataclass

EMOJI_CELL_WIDTH = 32.0
EMOJI_GLYPH_WIDTH = 24.0
DEFAULT_CAMERA_OVERLAP = 4.0


@dataclass(frozen=True, slots=True)
class NotchLayout:
    shape_x: float
    shape_width: float
    content_x: float
    content_width: float


def calculate_notch_layout(
    notch_x: float,
    notch_width: float,
    content_width: float,
    *,
    content_padding: float = 6.0,
    corner_extension: float = 14.0,
    content_overlap: float = DEFAULT_CAMERA_OVERLAP,
) -> NotchLayout:
    content_width = max(0.0, content_width)
    content_overlap = min(
        max(0.0, content_overlap), min(8.0, content_padding + content_width)
    )
    content_x = notch_x - content_width + content_overlap
    shape_x = min(notch_x - corner_extension, content_x - content_padding)
    shape_right = notch_x + notch_width + corner_extension
    return NotchLayout(
        shape_x=shape_x,
        shape_width=shape_right - shape_x,
        content_x=content_x,
        content_width=content_width,
    )
