"""Pixel-faithful active-left AppKit notch renderer."""

from __future__ import annotations

import asyncio
import threading
from functools import lru_cache
from typing import Any

from uncover.notch.layout import EMOJI_CELL_WIDTH, calculate_notch_layout
from uncover.notch.process import SharedProjection, consume_streams
from uncover.notch.state import ICONS, NotchProjection, RenderState

WING_WIDTH = 184.0
PANEL_WIDTH = 640.0
PANEL_HEIGHT = 210.0
SHAPE_TOP_RADIUS = 6.0
SHAPE_BOTTOM_RADIUS = 14.0
EMOJI_FONT_SIZE = 18.0
STATUS_FONT_SIZE = 11.0


@lru_cache(maxsize=1)
def notch_view_class() -> type[Any]:
    """Build the PyObjC view once so production and visual tests share it."""
    import objc
    from AppKit import (
        NSBezierPath,
        NSColor,
        NSFont,
        NSFontAttributeName,
        NSForegroundColorAttributeName,
        NSMakePoint,
        NSMakeRect,
        NSParagraphStyleAttributeName,
        NSString,
        NSTextAlignmentCenter,
        NSView,
    )

    class NotchView(NSView):
        shared = None
        wing_width = WING_WIDTH
        notch_width = 185.0
        notch_x = 0.0
        shape_height = 32.0
        camera_overlap = 4.0

        def isFlipped(self):
            return True

        def drawRect_(self, rect):
            del rect
            self._draw_notch()

        def _draw_notch(self):
            state: RenderState = self.shared.get()
            displayed_emotions = (
                state.emphasized_emotions
                if state.emphasis is not None and state.emphasized_emotions
                else state.emotions
            )
            active_emotions = list(displayed_emotions) if state.health is None else []
            status = state.health

            if status is not None:
                content_width = min(
                    self.wing_width,
                    max(96.0, len(status) * 6.5),
                )
                layout = calculate_notch_layout(
                    self.notch_x,
                    self.notch_width,
                    content_width,
                    content_overlap=0.0,
                )
                emotion_slots: list[tuple[str, float]] = []
            else:
                content_width = EMOJI_CELL_WIDTH * len(active_emotions)
                layout = calculate_notch_layout(
                    self.notch_x,
                    self.notch_width,
                    content_width,
                    content_overlap=self.camera_overlap,
                )
                emotion_slots = [
                    (emotion, layout.content_x + index * EMOJI_CELL_WIDTH)
                    for index, emotion in enumerate(active_emotions)
                ]

            shape_rect = NSMakeRect(
                layout.shape_x,
                0.0,
                layout.shape_width,
                self.shape_height,
            )
            NSColor.colorWithSRGBRed_green_blue_alpha_(0.015, 0.015, 0.02, 0.98).set()
            self._notch_path(
                shape_rect,
                top_radius=SHAPE_TOP_RADIUS,
                bottom_radius=SHAPE_BOTTOM_RADIUS,
            ).fill()

            if status is not None:
                self._draw_wing_status(
                    status,
                    layout.content_x,
                    layout.content_width,
                    error=status
                    in {
                        "Camera unavailable",
                        "Camera denied",
                        "Inference error",
                        "Display unsupported",
                    },
                )
                return

            dominant = state.emotions[0] if state.emotions else None
            for emotion, x in emotion_slots:
                score = state.emphasis_scores.get(
                    emotion, state.scores.get(emotion, 0.0)
                )
                is_dominant = emotion == dominant
                is_forwarded = (
                    state.emphasis is not None and emotion in state.emphasized_emotions
                )

                if is_forwarded or is_dominant:
                    color = {
                        "in-progress": (1.0, 0.58, 0.12, 0.52),
                        "error": (1.0, 0.20, 0.20, 0.48),
                        "success": (0.18, 0.82, 0.43, 0.48),
                    }.get(state.emphasis, (0.16, 0.54, 1.0, 0.34))
                    NSColor.colorWithSRGBRed_green_blue_alpha_(*color).set()
                    active_rect = NSMakeRect(
                        x + 5,
                        2,
                        EMOJI_CELL_WIDTH - 10,
                        28,
                    )
                    NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
                        active_rect, 9.0, 9.0
                    ).fill()

                alpha = (
                    1.0
                    if is_dominant or is_forwarded
                    else min(0.82, 0.30 + score * 1.25)
                )
                self._draw_text(
                    ICONS[emotion],
                    NSMakeRect(x, 3, EMOJI_CELL_WIDTH, 25),
                    EMOJI_FONT_SIZE,
                    alpha=alpha,
                )

        def _draw_wing_status(self, value, x, width, *, error=False):
            color = (
                NSColor.colorWithSRGBRed_green_blue_alpha_(1.0, 0.28, 0.28, 1.0)
                if error
                else NSColor.whiteColor()
            )
            self._draw_text(
                value,
                NSMakeRect(x, 7, width, 18),
                STATUS_FONT_SIZE,
                color=color,
                alpha=0.9,
            )

        def _notch_path(self, rect, *, top_radius, bottom_radius):
            """AppKit version of boring.notch's SwiftUI NotchShape."""
            min_x = rect.origin.x
            min_y = rect.origin.y
            max_x = min_x + rect.size.width
            max_y = min_y + rect.size.height
            path = NSBezierPath.bezierPath()
            path.moveToPoint_(NSMakePoint(min_x, min_y))
            self._quad_to(
                path,
                NSMakePoint(min_x + top_radius, min_y + top_radius),
                NSMakePoint(min_x + top_radius, min_y),
            )
            path.lineToPoint_(NSMakePoint(min_x + top_radius, max_y - bottom_radius))
            self._quad_to(
                path,
                NSMakePoint(min_x + top_radius + bottom_radius, max_y),
                NSMakePoint(min_x + top_radius, max_y),
            )
            path.lineToPoint_(NSMakePoint(max_x - top_radius - bottom_radius, max_y))
            self._quad_to(
                path,
                NSMakePoint(max_x - top_radius, max_y - bottom_radius),
                NSMakePoint(max_x - top_radius, max_y),
            )
            path.lineToPoint_(NSMakePoint(max_x - top_radius, min_y + top_radius))
            self._quad_to(
                path,
                NSMakePoint(max_x, min_y),
                NSMakePoint(max_x - top_radius, min_y),
            )
            path.closePath()
            return path

        def _quad_to(self, path, end, control):
            start = path.currentPoint()
            control1 = NSMakePoint(
                start.x + (2.0 / 3.0) * (control.x - start.x),
                start.y + (2.0 / 3.0) * (control.y - start.y),
            )
            control2 = NSMakePoint(
                end.x + (2.0 / 3.0) * (control.x - end.x),
                end.y + (2.0 / 3.0) * (control.y - end.y),
            )
            path.curveToPoint_controlPoint1_controlPoint2_(end, control1, control2)

        def _draw_text(self, value, rect, size, *, color=None, alpha=1.0):
            paragraph = objc.lookUpClass("NSMutableParagraphStyle").alloc().init()
            paragraph.setAlignment_(NSTextAlignmentCenter)
            base_color = color or NSColor.whiteColor()
            attributes = {
                NSFontAttributeName: NSFont.systemFontOfSize_(size),
                NSForegroundColorAttributeName: base_color.colorWithAlphaComponent_(
                    alpha
                ),
                NSParagraphStyleAttributeName: paragraph,
            }
            NSString.stringWithString_(value).drawInRect_withAttributes_(
                rect, attributes
            )

    return NotchView


def run_appkit(args: object) -> None:
    import objc
    from AppKit import (
        NSApplication,
        NSApplicationActivationPolicyAccessory,
        NSBackingStoreBuffered,
        NSColor,
        NSMainMenuWindowLevel,
        NSMakeRect,
        NSPanel,
        NSScreen,
        NSWindowCollectionBehaviorCanJoinAllSpaces,
        NSWindowCollectionBehaviorFullScreenAuxiliary,
        NSWindowCollectionBehaviorIgnoresCycle,
        NSWindowCollectionBehaviorStationary,
        NSWindowSharingReadWrite,
        NSWindowStyleMaskBorderless,
        NSWindowStyleMaskNonactivatingPanel,
    )
    from Foundation import NSObject, NSTimer

    shared = SharedProjection(NotchProjection())
    stop_flag = threading.Event()

    def consume() -> None:
        async def runner() -> None:
            stop = asyncio.Event()

            async def mirror_stop() -> None:
                while not stop_flag.is_set():
                    await asyncio.sleep(0.05)
                stop.set()

            mirror = asyncio.create_task(mirror_stop())
            try:
                await consume_streams(
                    emotion_socket=args.emotion_socket,
                    status_socket=args.status_socket,
                    shared=shared,
                    stop=stop,
                    freshness_seconds=args.freshness,
                )
            finally:
                mirror.cancel()

        asyncio.run(runner())

    thread = threading.Thread(target=consume, name="notch-subscriber", daemon=True)
    thread.start()

    class Delegate(NSObject):
        panel = None
        view = None
        timer = None

        @objc.IBAction
        def refresh_(self, timer):
            del timer
            if stop_flag.is_set():
                NSApplication.sharedApplication().terminate_(None)
                return
            if self.view is not None:
                self.view.setNeedsDisplay_(True)

        def applicationDidFinishLaunching_(self, notification):
            del notification
            screen = next(
                (item for item in NSScreen.screens() if item.safeAreaInsets().top > 0),
                None,
            )
            if screen is None:
                print('{"health":"Display unsupported"}', flush=True)
                NSApplication.sharedApplication().terminate_(None)
                return

            frame = screen.frame()
            left_area = screen.auxiliaryTopLeftArea()
            right_area = screen.auxiliaryTopRightArea()
            notch_left = left_area.origin.x + left_area.size.width
            notch_right = right_area.origin.x
            notch_width = max(0.0, notch_right - notch_left)
            wing_width = min(
                WING_WIDTH,
                float(left_area.size.width),
                float(right_area.size.width),
            )
            notch_span_width = wing_width * 2.0 + notch_width
            shape_height = min(
                float(left_area.size.height),
                float(right_area.size.height),
            )

            panel_width = max(PANEL_WIDTH, notch_span_width)
            x = frame.origin.x + (frame.size.width - panel_width) / 2.0
            y = frame.origin.y + frame.size.height - PANEL_HEIGHT
            self.panel = NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
                NSMakeRect(x, y, panel_width, PANEL_HEIGHT),
                NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel,
                NSBackingStoreBuffered,
                False,
            )
            self.panel.setOpaque_(False)
            self.panel.setBackgroundColor_(NSColor.clearColor())
            self.panel.setHasShadow_(False)
            self.panel.setFloatingPanel_(True)
            self.panel.setTitle_("Uncover Notch Expressions")
            self.panel.setHidesOnDeactivate_(False)
            self.panel.setReleasedWhenClosed_(False)
            self.panel.setLevel_(NSMainMenuWindowLevel + 3)
            self.panel.setSharingType_(NSWindowSharingReadWrite)
            self.panel.setIgnoresMouseEvents_(True)
            self.panel.setCollectionBehavior_(
                NSWindowCollectionBehaviorCanJoinAllSpaces
                | NSWindowCollectionBehaviorFullScreenAuxiliary
                | NSWindowCollectionBehaviorStationary
                | NSWindowCollectionBehaviorIgnoresCycle
            )

            view_class = notch_view_class()
            self.view = view_class.alloc().initWithFrame_(
                NSMakeRect(0, 0, panel_width, PANEL_HEIGHT)
            )
            self.view.shared = shared
            self.view.wing_width = wing_width
            self.view.notch_width = notch_width
            self.view.notch_x = (panel_width - notch_width) / 2.0
            self.view.shape_height = shape_height
            self.view.camera_overlap = args.camera_overlap
            self.panel.setContentView_(self.view)
            self.panel.orderFrontRegardless()
            schedule_timer = (
                NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_
            )
            self.timer = schedule_timer(0.10, self, "refresh:", None, True)

        def applicationWillTerminate_(self, notification):
            del notification
            stop_flag.set()
            if self.timer is not None:
                self.timer.invalidate()
            if self.panel is not None:
                self.panel.orderOut_(None)
            thread.join(timeout=2.0)

    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    delegate = Delegate.alloc().init()
    app.setDelegate_(delegate)
    app.run()
