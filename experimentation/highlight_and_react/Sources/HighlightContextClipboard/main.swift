import AppKit
import Foundation

enum ClipboardWriterError: LocalizedError {
    case missingScreenshotPath
    case unreadableText
    case unreadableScreenshot(String)
    case writeFailed

    var errorDescription: String? {
        switch self {
        case .missingScreenshotPath:
            "usage: highlight-context-clipboard SCREENSHOT_PATH"
        case .unreadableText:
            "could not read context text from standard input"
        case let .unreadableScreenshot(path):
            "could not read PNG screenshot at \(path)"
        case .writeFailed:
            "macOS pasteboard rejected the context items"
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

    let textItem = NSPasteboardItem()
    textItem.setString(text, forType: .string)
    let richContext = NSMutableAttributedString(string: "\(text)\n\n")
    let attachment = NSTextAttachment(
        data: screenshot,
        ofType: NSPasteboard.PasteboardType.png.rawValue
    )
    richContext.append(NSAttributedString(attachment: attachment))
    let richData = try richContext.data(
        from: NSRange(location: 0, length: richContext.length),
        documentAttributes: [
            .documentType: NSAttributedString.DocumentType.rtfd,
        ]
    )
    textItem.setData(richData, forType: .rtfd)
    let screenshotItem = NSPasteboardItem()
    screenshotItem.setData(screenshot, forType: .png)

    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    guard pasteboard.writeObjects([textItem, screenshotItem]) else {
        throw ClipboardWriterError.writeFailed
    }
}

do {
    try writeContextClipboard(arguments: CommandLine.arguments)
} catch {
    FileHandle.standardError.write(
        Data("\(error.localizedDescription)\n".utf8)
    )
    exit(1)
}
