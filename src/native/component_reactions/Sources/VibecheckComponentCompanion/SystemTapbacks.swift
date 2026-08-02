import AppKit
import Foundation

enum SystemTapbacks {
    static let frameworkPath = "/System/Library/PrivateFrameworks/IMSharedUI.framework"
    static let maximumPNGBytes = 6 * 1024
    static let maximumTotalPNGBytes = 36 * 1024

    static let resources: [(key: String, name: String)] = [
        ("heart", "AckFunction-Heart-Template"),
        ("thumbs-up", "AckFunction-ThumbsUp-Template"),
        ("thumbs-down", "AckFunction-ThumbsDown-Template"),
        ("haha", "AckFunction-HAHA-Template"),
        ("exclamation", "AckFunction-Exclamation-Template"),
        ("question", "AckFunction-QuestionMark-Template"),
    ]

    static func render(
        frameworkPath: String = frameworkPath,
        resources: [(key: String, name: String)] = resources
    ) -> [String: String] {
        guard let bundle = Bundle(path: frameworkPath) else {
            return [:]
        }

        var totalBytes = 0
        var assets: [String: String] = [:]
        for resource in resources {
            guard
                let image = bundle.image(forResource: NSImage.Name(resource.name)),
                let tiff = image.tiffRepresentation,
                let bitmap = NSBitmapImageRep(data: tiff),
                let png = bitmap.representation(using: .png, properties: [:]),
                png.count > 0,
                png.count <= maximumPNGBytes,
                totalBytes + png.count <= maximumTotalPNGBytes
            else {
                continue
            }
            totalBytes += png.count
            assets[resource.key] = "data:image/png;base64,\(png.base64EncodedString())"
        }
        return assets
    }
}
