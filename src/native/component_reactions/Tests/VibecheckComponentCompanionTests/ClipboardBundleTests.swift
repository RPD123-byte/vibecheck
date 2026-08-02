import AppKit
import ApplicationServices
import XCTest
@testable import VibecheckComponentCompanion

final class ClipboardBundleTests: XCTestCase {
    func testLifecycleOwnedApplicationsAreNotGenericTargets() {
        XCTAssertTrue(TargetApplications.isExcluded("com.rithvikprakki.vibecheck"))
        XCTAssertFalse(TargetApplications.isExcluded("com.openai.codex"))
        XCTAssertTrue(TargetApplications.isExcluded("com.google.Chrome"))
        XCTAssertFalse(TargetApplications.isExcluded("com.example.fixture"))
    }

    func testManagedLaunchMetadataRequiresLoopbackPortAndOwnedMarker() {
        let marker = String(repeating: "a", count: 32)
        XCTAssertEqual(
            TargetApplications.managedLaunchMetadata(arguments: [
                "Fixture",
                "--remote-debugging-address=127.0.0.1",
                "--remote-debugging-port=43004",
                "--vibecheck-owned-launch=\(marker)",
            ]),
            ManagedLaunchMetadata(debugPort: 43_004, ownershipMarker: marker)
        )
        XCTAssertNil(
            TargetApplications.managedLaunchMetadata(arguments: [
                "Fixture",
                "--remote-debugging-address=0.0.0.0",
                "--remote-debugging-port=43004",
                "--vibecheck-owned-launch=\(marker)",
            ])
        )
        XCTAssertNil(
            TargetApplications.managedLaunchMetadata(arguments: [
                "Fixture",
                "--remote-debugging-address=127.0.0.1",
                "--remote-debugging-port=43004",
                "--vibecheck-owned-launch=not-vibecheck",
            ])
        )
    }

    func testOnlyUnmodifiedPhysicalCommandVQualifiesForExpansion() throws {
        let source = try XCTUnwrap(CGEventSource(stateID: .combinedSessionState))
        let event = try XCTUnwrap(
            CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true)
        )
        event.flags = .maskCommand
        XCTAssertTrue(isPhysicalCommandV(event))
        event.flags = [.maskCommand, .maskShift]
        XCTAssertFalse(isPhysicalCommandV(event))
        event.flags = [.maskCommand, .maskAlternate]
        XCTAssertFalse(isPhysicalCommandV(event))
    }

    func testBundleRoundTripPreservesUnlimitedOrderedEntries() throws {
        let pasteboard = NSPasteboard(name: .init("vibecheck.fixture.\(UUID())"))
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        try ClipboardBundleCodec.append(text: "one", png: png, to: pasteboard)
        try ClipboardBundleCodec.append(text: "two", png: png, to: pasteboard)
        XCTAssertEqual(
            ClipboardBundleCodec.read(from: pasteboard)?.entries.map(\.text),
            ["one", "two"]
        )
    }

    func testOrdinaryCopyClearsBundleIdentity() throws {
        let pasteboard = NSPasteboard(name: .init("vibecheck.fixture.\(UUID())"))
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        try ClipboardBundleCodec.append(text: "one", png: png, to: pasteboard)
        ClipboardBundleCodec.writeText("ordinary", to: pasteboard)
        XCTAssertNil(ClipboardBundleCodec.read(from: pasteboard))
    }

    func testReplaceAtomicallyStartsANewBundle() throws {
        let pasteboard = NSPasteboard(name: .init("vibecheck.fixture.\(UUID())"))
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        try ClipboardBundleCodec.append(text: "old one", png: png, to: pasteboard)
        try ClipboardBundleCodec.append(text: "old two", png: png, to: pasteboard)

        let bundle = try ClipboardBundleCodec.replace(
            text: "new one",
            png: png,
            to: pasteboard
        )

        XCTAssertEqual(bundle.entries.map(\.text), ["new one"])
        XCTAssertEqual(
            ClipboardBundleCodec.read(from: pasteboard)?.entries.map(\.text),
            ["new one"]
        )
    }

    func testUnknownBundleVersionStartsFresh() throws {
        let pasteboard = NSPasteboard(name: .init("vibecheck.fixture.\(UUID())"))
        let unknown = ClipboardBundle(version: 1, entries: [])
        var encoded = try PropertyListEncoder().encode(unknown)
        encoded[encoded.index(encoded.startIndex, offsetBy: 8)] ^= 0xff
        pasteboard.clearContents()
        pasteboard.setData(Data([1]), forType: markerPasteboardType)
        pasteboard.setData(encoded, forType: bundlePasteboardType)
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        let bundle = try ClipboardBundleCodec.append(text: "fresh", png: png, to: pasteboard)
        XCTAssertEqual(bundle.entries.map(\.text), ["fresh"])
    }

    func testBundlePublishesUsefulOrdinaryFallbackFlavors() throws {
        let pasteboard = NSPasteboard(name: .init("vibecheck.fixture.\(UUID())"))
        let firstPNG = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        let secondPNG = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2])
        try ClipboardBundleCodec.append(text: "one", png: firstPNG, to: pasteboard)
        let bundle = try ClipboardBundleCodec.append(
            text: "two",
            png: secondPNG,
            to: pasteboard
        )

        XCTAssertEqual(pasteboard.string(forType: .string), "one\n\ntwo")
        XCTAssertEqual(pasteboard.data(forType: .png), secondPNG)
        try ClipboardBundleCodec.write(bundle, to: pasteboard)
        XCTAssertEqual(ClipboardBundleCodec.read(from: pasteboard), bundle)
    }

    func testClipboardEntryBoundsRejectMalformedData() {
        let pasteboard = NSPasteboard(name: .init("vibecheck.fixture.\(UUID())"))
        XCTAssertThrowsError(
            try ClipboardBundleCodec.append(
                text: "invalid",
                png: Data([1, 2, 3]),
                to: pasteboard
            )
        )
        XCTAssertThrowsError(
            try ClipboardBundleCodec.append(
                text: String(repeating: "x", count: maximumTextBytes + 1),
                png: Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                to: pasteboard
            )
        )
    }

    func testManagedCodexLaunchProfileIsBoundedAndTyped() throws {
        let encoded = """
            {
              "version": 1,
              "id": "fixture",
              "type": "relaunch_target",
              "bundle_path": "/Applications/ChatGPT.app",
              "debug_port": 43000,
              "ownership_marker": "owned",
              "launch_profile": "managed_codex"
            }
            """.data(using: .utf8)!
        let command = try JSONDecoder().decode(CompanionCommand.self, from: encoded)

        try command.validate()
        XCTAssertEqual(command.launchProfile, .managedCodex)
    }

    func testReplaceBundleCommandIsTypedAndBounded() throws {
        let encoded = """
            {
              "version": 1,
              "id": "fixture",
              "type": "replace_bundle",
              "text": "Save changes",
              "png_path": "/private/tmp/vibecheck-runtime/fixture.png"
            }
            """.data(using: .utf8)!
        let command = try JSONDecoder().decode(CompanionCommand.self, from: encoded)

        try command.validate()
        XCTAssertEqual(command.type, .replaceBundle)
    }

    func testSafariSetupCommandAndExtensionIdentityAreFixed() throws {
        let encoded = """
            {
              "version": 1,
              "id": "fixture",
              "type": "open_safari_extension_preferences"
            }
            """.data(using: .utf8)!
        let command = try JSONDecoder().decode(CompanionCommand.self, from: encoded)

        try command.validate()
        XCTAssertEqual(command.type, .openSafariExtensionPreferences)
        XCTAssertEqual(
            BrowserSetup.safariExtensionIdentifier,
            "com.rithvikprakki.vibecheck.browser.Extension"
        )
    }

    func testTapbackAssetCommandIsTypedAndRequiresNoPayload() throws {
        let encoded = """
            {
              "version": 1,
              "id": "fixture",
              "type": "tapback_assets"
            }
            """.data(using: .utf8)!
        let command = try JSONDecoder().decode(CompanionCommand.self, from: encoded)

        try command.validate()
        XCTAssertEqual(command.type, .tapbackAssets)
    }

    func testInstalledTapbackAssetsAreAllowlistedBoundedPNGs() throws {
        let expected = Set([
            "heart",
            "thumbs-up",
            "thumbs-down",
            "haha",
            "exclamation",
            "question",
        ])
        let assets = SystemTapbacks.render()

        XCTAssertEqual(Set(assets.keys), expected)
        for value in assets.values {
            XCTAssertTrue(value.hasPrefix("data:image/png;base64,"))
            let encoded = String(value.dropFirst("data:image/png;base64,".count))
            let png = try XCTUnwrap(Data(base64Encoded: encoded))
            XCTAssertLessThanOrEqual(png.count, SystemTapbacks.maximumPNGBytes)
            XCTAssertEqual(
                Array(png.prefix(8)),
                [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
            )
        }
    }

    func testMissingTapbackFrameworkFallsBackWithoutFailure() {
        XCTAssertEqual(
            SystemTapbacks.render(frameworkPath: "/nonexistent/Vibecheck.framework"),
            [:]
        )
    }

    func testMissingTapbackTemplateFallsBackIndependently() {
        let assets = SystemTapbacks.render(resources: [
            ("heart", "Vibecheck-Missing-Tapback-Template"),
            ("question", "AckFunction-QuestionMark-Template"),
        ])

        XCTAssertNil(assets["heart"])
        XCTAssertNotNil(assets["question"])
    }
}
