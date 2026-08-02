import AppKit
import Foundation
import HighlightCore

enum ClipboardWriterError: LocalizedError {
    case missingScreenshotPath
    case unreadableText
    case unreadableScreenshot(String)

    var errorDescription: String? {
        switch self {
        case .missingScreenshotPath:
            "usage: highlight-context-clipboard SCREENSHOT_PATH"
        case .unreadableText:
            "could not read context text from standard input"
        case let .unreadableScreenshot(path):
            "could not read PNG screenshot at \(path)"
        }
    }
}

func writeContextClipboard(arguments: [String]) throws {
    guard arguments.count == 2 else {
        throw ClipboardWriterError.missingScreenshotPath
    }
    let screenshotPath = arguments[1]
    let textData = FileHandle.standardInput.readDataToEndOfFile()
    guard let text = String(data: textData, encoding: .utf8) else {
        throw ClipboardWriterError.unreadableText
    }
    guard let screenshot = try? Data(contentsOf: URL(fileURLWithPath: screenshotPath)),
          !screenshot.isEmpty
    else {
        throw ClipboardWriterError.unreadableScreenshot(screenshotPath)
    }

    let newEntry = ClipboardContextEntry(text: text, png: screenshot)
    try ClipboardContextPasteboard.append(newEntry)
}

do {
    try writeContextClipboard(arguments: CommandLine.arguments)
} catch {
    FileHandle.standardError.write(
        Data("\(error.localizedDescription)\n".utf8)
    )
    exit(1)
}
