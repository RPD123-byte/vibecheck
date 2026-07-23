"""Non-activating active-left AppKit notch renderer."""

from __future__ import annotations

import asyncio
import threading

from uncover.notch.layout import EMOJI_CELL_WIDTH, calculate_notch_layout
from uncover.notch.process import SharedProjection, consume_streams
from uncover.notch.state import NotchProjection


def run_appkit(args: object) -> None:
    import objc
    from AppKit import (
        NSApplication,
        NSApplicationActivationPolicyAccessory,
        NSBackingStoreBuffered,
        NSColor,
        NSFont,
        NSFontAttributeName,
        NSForegroundColorAttributeName,
        NSMainMenuWindowLevel,
        NSMakeRect,
        NSPanel,
        NSScreen,
        NSString,
        NSView,
        NSWindowCollectionBehaviorCanJoinAllSpaces,
        NSWindowCollectionBehaviorFullScreenAuxiliary,
        NSWindowCollectionBehaviorIgnoresCycle,
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

    class NotchView(NSView):
        notch_x = 0.0
        notch_width = 185.0

        def isFlipped(self):
            return True

        def drawRect_(self, rect):
            del rect
            state = shared.get()
            content = state.icons if state.health is None else (state.health or "",)
            width = max(0.0, EMOJI_CELL_WIDTH * len(content))
            if state.health:
                width = max(96.0, min(184.0, len(state.health) * 7.0))
            layout = calculate_notch_layout(
                self.notch_x,
                self.notch_width,
                width,
                content_overlap=0.0 if state.health else args.camera_overlap,
            )
            NSColor.colorWithSRGBRed_green_blue_alpha_(0.015, 0.015, 0.02, 0.98).set()
            NSColor.blackColor().setFill()
            from AppKit import NSBezierPath

            NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
                NSMakeRect(layout.shape_x, 0, layout.shape_width, 32), 8, 8
            ).fill()
            for index, value in enumerate(content):
                size = 12 if state.health else 24
                attributes = {
                    NSFontAttributeName: NSFont.systemFontOfSize_(size),
                    NSForegroundColorAttributeName: NSColor.whiteColor(),
                }
                NSString.stringWithString_(value).drawInRect_withAttributes_(
                    NSMakeRect(
                        layout.content_x + index * EMOJI_CELL_WIDTH,
                        3,
                        width if state.health else EMOJI_CELL_WIDTH,
                        28,
                    ),
                    attributes,
                )

    class Delegate(NSObject):
        panel = None
        timer = None

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
            left = screen.auxiliaryTopLeftArea()
            right = screen.auxiliaryTopRightArea()
            notch_x = left.origin.x + left.size.width - frame.origin.x
            notch_width = max(0.0, right.origin.x - (left.origin.x + left.size.width))
            self.panel = NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
                NSMakeRect(
                    frame.origin.x,
                    frame.origin.y + frame.size.height - 36,
                    frame.size.width,
                    36,
                ),
                NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel,
                NSBackingStoreBuffered,
                False,
            )
            self.panel.setOpaque_(False)
            self.panel.setBackgroundColor_(NSColor.clearColor())
            self.panel.setLevel_(NSMainMenuWindowLevel + 2)
            self.panel.setIgnoresMouseEvents_(True)
            self.panel.setCollectionBehavior_(
                NSWindowCollectionBehaviorCanJoinAllSpaces
                | NSWindowCollectionBehaviorFullScreenAuxiliary
                | NSWindowCollectionBehaviorIgnoresCycle
            )
            view = NotchView.alloc().initWithFrame_(
                NSMakeRect(0, 0, frame.size.width, 36)
            )
            view.notch_x = notch_x
            view.notch_width = notch_width
            self.panel.setContentView_(view)
            self.panel.orderFrontRegardless()
            schedule_timer = (  # noqa: E501
                NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_
            )
            self.timer = schedule_timer(
                0.1,
                view,
                objc.selector(view.setNeedsDisplay_, signature=b"v@:B"),
                True,
                True,
            )

        def applicationWillTerminate_(self, notification):
            del notification
            stop_flag.set()
            if self.timer is not None:
                self.timer.invalidate()
            if self.panel is not None:
                self.panel.orderOut_(None)

    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    delegate = Delegate.alloc().init()
    app.setDelegate_(delegate)
    app.run()
