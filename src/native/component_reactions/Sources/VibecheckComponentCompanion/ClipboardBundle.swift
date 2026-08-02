import AppKit
import Foundation

let bundlePasteboardType = NSPasteboard.PasteboardType(
    "com.rithvikprakki.vibecheck.component-reactions.bundle.v1"
)
let markerPasteboardType = NSPasteboard.PasteboardType(
    "com.rithvikprakki.vibecheck.component-reactions.marker"
)

struct ClipboardEntry: Codable, Equatable {
    let text: String
    let png: Data
}

struct ClipboardBundle: Codable, Equatable {
    let version: Int
    var entries: [ClipboardEntry]

    init(entries: [ClipboardEntry]) {
        version = 1
        self.entries = entries
    }

    init(version: Int, entries: [ClipboardEntry]) {
        self.version = version
        self.entries = entries
    }
}

enum ClipboardBundleCodec {
    static func read(from pasteboard: NSPasteboard = .general) -> ClipboardBundle? {
        guard pasteboard.data(forType: markerPasteboardType) == Data([1]),
              let data = pasteboard.data(forType: bundlePasteboardType),
              let bundle = try? PropertyListDecoder().decode(ClipboardBundle.self, from: data),
              bundle.version == 1
        else {
            return nil
        }
        return bundle
    }

    @discardableResult
    static func replace(
        text: String,
        png: Data,
        to pasteboard: NSPasteboard = .general
    ) throws -> ClipboardBundle {
        try validateEntry(text: text, png: png)
        let bundle = ClipboardBundle(entries: [ClipboardEntry(text: text, png: png)])
        try write(bundle, to: pasteboard)
        return bundle
    }

    @discardableResult
    static func append(
        text: String,
        png: Data,
        to pasteboard: NSPasteboard = .general
    ) throws -> ClipboardBundle {
        try validateEntry(text: text, png: png)
        var bundle = read(from: pasteboard) ?? ClipboardBundle(entries: [])
        bundle.entries.append(ClipboardEntry(text: text, png: png))
        try write(bundle, to: pasteboard)
        return bundle
    }

    private static func validateEntry(text: String, png: Data) throws {
        guard text.utf8.count <= maximumTextBytes,
              !png.isEmpty,
              png.count <= maximumPNGBytes,
              png.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        else {
            throw CompanionError.invalid("clipboard entry is invalid")
        }
    }

    static func write(
        _ bundle: ClipboardBundle,
        to pasteboard: NSPasteboard = .general
    ) throws {
        let encoded: Data
        do {
            encoded = try PropertyListEncoder().encode(bundle)
        } catch {
            throw CompanionError.operation("could not encode clipboard bundle")
        }
        let item = NSPasteboardItem()
        item.setData(Data([1]), forType: markerPasteboardType)
        item.setData(encoded, forType: bundlePasteboardType)
        item.setString(bundle.entries.map(\.text).joined(separator: "\n\n"), forType: .string)
        if let last = bundle.entries.last {
            item.setData(last.png, forType: .png)
        }
        pasteboard.clearContents()
        guard pasteboard.writeObjects([item]) else {
            throw CompanionError.operation("pasteboard rejected the bundle")
        }
    }

    static func writeText(_ text: String, to pasteboard: NSPasteboard = .general) {
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    static func writePNG(_ png: Data, to pasteboard: NSPasteboard = .general) {
        pasteboard.clearContents()
        pasteboard.setData(png, forType: .png)
    }
}
