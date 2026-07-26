// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "HighlightAndReact",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "highlight-and-react", targets: ["HighlightAndReact"]),
        .executable(
            name: "highlight-context-clipboard",
            targets: ["HighlightContextClipboard"]
        ),
        .library(name: "HighlightCore", targets: ["HighlightCore"]),
    ],
    targets: [
        .target(name: "HighlightCore"),
        .executableTarget(
            name: "HighlightAndReact",
            dependencies: ["HighlightCore"]
        ),
        .executableTarget(name: "HighlightContextClipboard"),
        .testTarget(
            name: "HighlightCoreTests",
            dependencies: ["HighlightCore"]
        ),
    ]
)
