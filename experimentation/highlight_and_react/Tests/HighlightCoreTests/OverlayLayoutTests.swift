import CoreGraphics
import HighlightCore
import XCTest

final class OverlayLayoutTests: XCTestCase {
    private let screen = CGRect(x: 0, y: 0, width: 1_000, height: 800)
    private let barSize = CGSize(width: 292, height: 48)

    func testPlacesBarAboveTargetWhenSpaceIsAvailable() {
        let target = CGRect(x: 300, y: 300, width: 400, height: 100)
        let frame = OverlayLayout.reactionBarFrame(
            target: target,
            visibleScreen: screen,
            barSize: barSize
        )

        XCTAssertEqual(frame.origin.x, 354)
        XCTAssertEqual(frame.origin.y, 410)
    }

    func testPlacesBarBelowTargetNearTopEdge() {
        let target = CGRect(x: 300, y: 740, width: 400, height: 50)
        let frame = OverlayLayout.reactionBarFrame(
            target: target,
            visibleScreen: screen,
            barSize: barSize
        )

        XCTAssertEqual(frame.origin.y, 682)
    }

    func testClampsBarToRightScreenEdge() {
        let target = CGRect(x: 950, y: 300, width: 40, height: 40)
        let frame = OverlayLayout.reactionBarFrame(
            target: target,
            visibleScreen: screen,
            barSize: barSize
        )

        XCTAssertEqual(frame.maxX, 992)
    }

    func testHighlightIsClippedToVisibleScreen() {
        let target = CGRect(x: -2, y: 20, width: 100, height: 50)
        let frame = OverlayLayout.highlightFrame(
            target: target,
            visibleScreen: screen
        )

        XCTAssertEqual(frame.minX, 0)
        XCTAssertEqual(frame.width, 102)
    }

    func testPointerOnSelectedTextKeepsOverlayVisible() {
        XCTAssertFalse(
            OverlayLayout.shouldDismiss(
                pointer: CGPoint(x: 300, y: 320),
                target: CGRect(x: 200, y: 300, width: 300, height: 30),
                reactionBar: CGRect(x: 204, y: 340, width: 292, height: 48)
            )
        )
    }

    func testPointerOnReactionBarKeepsOverlayVisible() {
        XCTAssertFalse(
            OverlayLayout.shouldDismiss(
                pointer: CGPoint(x: 250, y: 360),
                target: CGRect(x: 200, y: 300, width: 300, height: 30),
                reactionBar: CGRect(x: 204, y: 340, width: 292, height: 48)
            )
        )
    }

    func testPointerAwayFromSelectionAndBarDismissesOverlay() {
        XCTAssertTrue(
            OverlayLayout.shouldDismiss(
                pointer: CGPoint(x: 700, y: 600),
                target: CGRect(x: 200, y: 300, width: 300, height: 30),
                reactionBar: CGRect(x: 204, y: 340, width: 292, height: 48)
            )
        )
    }
}
