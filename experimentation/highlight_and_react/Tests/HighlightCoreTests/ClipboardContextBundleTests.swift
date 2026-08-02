import Foundation
import HighlightCore
import XCTest

final class ClipboardContextBundleTests: XCTestCase {
    private func entry(_ label: String) -> ClipboardContextEntry {
        ClipboardContextEntry(
            text: "context \(label)",
            png: Data("png \(label)".utf8)
        )
    }

    func testAppendsToUnconsumedBundleInReactionOrder() {
        let first = ClipboardContextBundle.appending(entry("one"), to: nil)
        let second = ClipboardContextBundle.appending(entry("two"), to: first)

        XCTAssertEqual(second.entries, [entry("one"), entry("two")])
        XCTAssertEqual(second.aggregateText, "context one\n\n---\n\ncontext two")
        XCTAssertFalse(second.consumed)
    }

    func testStartsFreshAfterPreviousBundleWasConsumed() {
        let consumed = ClipboardContextBundle(
            consumed: true,
            entries: [entry("old")]
        )
        let next = ClipboardContextBundle.appending(entry("new"), to: consumed)

        XCTAssertEqual(next.entries, [entry("new")])
        XCTAssertFalse(next.consumed)
    }

    func testStartsFreshForAnUnknownBundleVersion() {
        let unknown = ClipboardContextBundle(
            version: 999,
            entries: [entry("old")]
        )
        let next = ClipboardContextBundle.appending(entry("new"), to: unknown)

        XCTAssertEqual(next.version, ClipboardContextBundle.currentVersion)
        XCTAssertEqual(next.entries, [entry("new")])
    }

    func testBundleRoundTripsEveryTextAndImage() throws {
        let original = ClipboardContextBundle(
            entries: [entry("one"), entry("two")]
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(
            ClipboardContextBundle.self,
            from: encoded
        )

        XCTAssertEqual(decoded, original)
    }

    func testPasteboardAppendsEveryPairAndStartsFreshAfterConsumption() throws {
        let pasteboard = NSPasteboard(
            name: NSPasteboard.Name(
                "highlight-and-react-tests-\(UUID().uuidString)"
            )
        )
        defer { pasteboard.releaseGlobally() }

        try ClipboardContextPasteboard.append(entry("one"), to: pasteboard)
        try ClipboardContextPasteboard.append(entry("two"), to: pasteboard)

        let queued = try XCTUnwrap(
            ClipboardContextPasteboard.read(from: pasteboard)
        )
        XCTAssertEqual(queued.entries, [entry("one"), entry("two")])
        XCTAssertEqual(
            pasteboard.string(forType: .string),
            "context one\n\n---\n\ncontext two"
        )
        XCTAssertEqual(pasteboard.data(forType: .png), entry("two").png)
        XCTAssertTrue(ClipboardContextPasteboard.isMarked(pasteboard))

        try ClipboardContextPasteboard.write(
            queued.markingConsumed(),
            to: pasteboard
        )
        try ClipboardContextPasteboard.append(entry("three"), to: pasteboard)

        let fresh = try XCTUnwrap(
            ClipboardContextPasteboard.read(from: pasteboard)
        )
        XCTAssertEqual(fresh.entries, [entry("three")])
        XCTAssertFalse(fresh.consumed)
    }
}
