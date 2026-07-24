import AppKit
import Foundation

private let frameworkPath =
    "/System/Library/PrivateFrameworks/IMSharedUI.framework"

private let assetNames = [
    "heart": "AckFunction-Heart-Template",
    "thumbs-up": "AckFunction-ThumbsUp-Template",
    "thumbs-down": "AckFunction-ThumbsDown-Template",
    "haha": "AckFunction-HAHA-Template",
    "exclamation": "AckFunction-Exclamation-Template",
    "question": "AckFunction-QuestionMark-Template",
]

guard let bundle = Bundle(path: frameworkPath) else {
    fputs("Could not load \(frameworkPath)\n", stderr)
    exit(1)
}

var rendered: [String: String] = [:]
for (key, assetName) in assetNames {
    guard
        let image = bundle.image(forResource: NSImage.Name(assetName)),
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
    else {
        fputs("Could not render system asset \(assetName)\n", stderr)
        exit(1)
    }
    rendered[key] = "data:image/png;base64,\(png.base64EncodedString())"
}

let output = try JSONSerialization.data(withJSONObject: rendered, options: [.sortedKeys])
FileHandle.standardOutput.write(output)
