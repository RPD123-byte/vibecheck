import AppKit
import Foundation

public struct ClipboardContextEntry: Codable, Equatable {
    public let text: String
    public let png: Data

    public init(text: String, png: Data) {
        self.text = text
        self.png = png
    }
}

public struct ClipboardContextBundle: Codable, Equatable {
    public static let currentVersion = 1

    public var version: Int
    public var consumed: Bool
    public var entries: [ClipboardContextEntry]

    public init(
        version: Int = ClipboardContextBundle.currentVersion,
        consumed: Bool = false,
        entries: [ClipboardContextEntry]
    ) {
        self.version = version
        self.consumed = consumed
        self.entries = entries
    }

    public static func appending(
        _ entry: ClipboardContextEntry,
        to existing: ClipboardContextBundle?
    ) -> ClipboardContextBundle {
        guard var existing,
              existing.version == currentVersion,
              !existing.consumed,
              !existing.entries.isEmpty
        else {
            return ClipboardContextBundle(entries: [entry])
        }
        existing.entries.append(entry)
        return existing
    }

    public var aggregateText: String {
        entries.map(\.text).joined(separator: "\n\n---\n\n")
    }

    public func markingConsumed() -> ClipboardContextBundle {
        var copy = self
        copy.consumed = true
        return copy
    }
}

public enum ClipboardContextPasteboardError: LocalizedError {
    case emptyBundle
    case writeFailed

    public var errorDescription: String? {
        switch self {
        case .emptyBundle:
            "clipboard context bundle has no entries"
        case .writeFailed:
            "macOS pasteboard rejected the context bundle"
        }
    }
}

public enum ClipboardContextPasteboard {
    public static let markerType = NSPasteboard.PasteboardType(
        "com.vibecheck.highlight-and-react.context"
    )
    public static let bundleType = NSPasteboard.PasteboardType(
        "com.vibecheck.highlight-and-react.context-bundle"
    )
    public static let markerValue = "1"

    public static func isMarked(_ pasteboard: NSPasteboard = .general) -> Bool {
        pasteboard.string(forType: markerType) == markerValue
    }

    public static func read(
        from pasteboard: NSPasteboard = .general
    ) -> ClipboardContextBundle? {
        if let data = pasteboard.data(forType: bundleType),
           let bundle = try? JSONDecoder().decode(
               ClipboardContextBundle.self,
               from: data
           ),
           bundle.version == ClipboardContextBundle.currentVersion,
           !bundle.entries.isEmpty
        {
            return bundle
        }
        guard isMarked(pasteboard),
              let text = pasteboard.string(forType: .string),
              !text.isEmpty,
              let png = pasteboard.data(forType: .png),
              !png.isEmpty
        else {
            return nil
        }
        return ClipboardContextBundle(
            entries: [ClipboardContextEntry(text: text, png: png)]
        )
    }

    @discardableResult
    public static func append(
        _ entry: ClipboardContextEntry,
        to pasteboard: NSPasteboard = .general
    ) throws -> ClipboardContextBundle {
        let bundle = ClipboardContextBundle.appending(
            entry,
            to: read(from: pasteboard)
        )
        try write(bundle, to: pasteboard)
        return bundle
    }

    public static func write(
        _ bundle: ClipboardContextBundle,
        to pasteboard: NSPasteboard = .general
    ) throws {
        guard let latestPNG = bundle.entries.last?.png else {
            throw ClipboardContextPasteboardError.emptyBundle
        }
        let item = NSPasteboardItem()
        item.setString(bundle.aggregateText, forType: .string)
        item.setData(latestPNG, forType: .png)
        item.setString(markerValue, forType: markerType)
        item.setData(try JSONEncoder().encode(bundle), forType: bundleType)
        pasteboard.clearContents()
        guard pasteboard.writeObjects([item]) else {
            throw ClipboardContextPasteboardError.writeFailed
        }
    }
}
