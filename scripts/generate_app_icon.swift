#!/usr/bin/env swift

import AppKit
import Foundation

let canvasSize = 1024
let outputPath = CommandLine.arguments.dropFirst().first
    ?? "src/electron/resources/app-icon-1024.png"

guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: canvasSize,
    pixelsHigh: canvasSize,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fatalError("Could not create the app-icon bitmap")
}

bitmap.size = NSSize(width: canvasSize, height: canvasSize)

guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Could not create the app-icon drawing context")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: canvasSize, height: canvasSize).fill()

guard let emojiFont = NSFont(name: "Apple Color Emoji", size: 760) else {
    fatalError("Apple Color Emoji is unavailable")
}

let emoji = NSAttributedString(
    string: "😠",
    attributes: [.font: emojiFont]
)
let bounds = emoji.boundingRect(
    with: NSSize(width: canvasSize, height: canvasSize),
    options: [.usesLineFragmentOrigin, .usesFontLeading]
)
let origin = NSPoint(
    x: (CGFloat(canvasSize) - bounds.width) / 2 - bounds.minX,
    y: (CGFloat(canvasSize) - bounds.height) / 2 - bounds.minY
)
NSBezierPath(
    rect: NSRect(x: 150, y: 0, width: 724, height: canvasSize)
).addClip()
emoji.draw(at: origin)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode the app icon as PNG")
}

let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try png.write(to: outputURL, options: .atomic)
