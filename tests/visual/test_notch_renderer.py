from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import pytest

pytestmark = [
    pytest.mark.visual,
    pytest.mark.skipif(
        sys.platform != "darwin" or os.environ.get("UNCOVER_RUN_VISUAL_TESTS") != "1",
        reason="set UNCOVER_RUN_VISUAL_TESTS=1 on the target Mac",
    ),
]

EXPERIMENT_REFERENCES = {
    "active": "97fd39afd0fe922724e0c2a2d1a95eb6b2bdac4fd6e731ac6095a013847fffa6",
    "empty": "64c028269213e3097242648182e7d1598633979b9a60672794f908b83361f7b2",
    "loading": "8aee18e0793cee22724413ad728374fafcee270882b8223b4a1bbb31abab68f8",
    "success": "322f65c199f3ad1d587eca7e1bae4bd065f3696b7817dd7e6557fdf47bbd522f",
    "camera_error": (
        "40034dd1963efd57f9284bb8688179cb870827e0251200d4d9de1101687cb63e"
    ),
}


class StaticProjection:
    def __init__(self, state):
        self.state = state

    def get(self):
        return self.state


@pytest.mark.parametrize(
    ("name", "state_values"),
    [
        (
            "active",
            {
                "emotions": ("happiness",),
                "icons": ("😊",),
                "scores": {"happiness": 0.57},
                "health": None,
            },
        ),
        ("empty", {"health": None}),
        ("loading", {"health": "Loading…"}),
        (
            "success",
            {
                "emotions": ("happiness",),
                "icons": ("😊",),
                "scores": {"happiness": 0.57},
                "emphasized_emotions": ("happiness",),
                "emphasis_scores": {"happiness": 0.57},
                "health": None,
                "emphasis": "success",
            },
        ),
        ("camera_error", {"health": "Camera unavailable"}),
    ],
)
def test_active_left_renderer_matches_validated_experiment(
    tmp_path: Path,
    name: str,
    state_values: dict,
) -> None:
    from AppKit import NSApplication, NSBitmapImageFileTypePNG, NSMakeRect

    from uncover.notch.appkit import notch_view_class
    from uncover.notch.state import RenderState

    NSApplication.sharedApplication()
    view = notch_view_class().alloc().initWithFrame_(NSMakeRect(0, 0, 640, 210))
    view.shared = StaticProjection(RenderState(**state_values))
    view.notch_x = 227.5
    view.notch_width = 185.0
    view.wing_width = 184.0
    view.shape_height = 32.0
    view.camera_overlap = 4.0

    bounds = view.bounds()
    bitmap = view.bitmapImageRepForCachingDisplayInRect_(bounds)
    view.cacheDisplayInRect_toBitmapImageRep_(bounds, bitmap)
    data = bitmap.representationUsingType_properties_(NSBitmapImageFileTypePNG, {})
    output = tmp_path / f"notch-{name}.png"
    assert data.writeToFile_atomically_(str(output), True)
    assert (
        hashlib.sha256(output.read_bytes()).hexdigest() == EXPERIMENT_REFERENCES[name]
    )
