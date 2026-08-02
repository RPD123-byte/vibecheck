// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "VibecheckComponentCompanion",
    platforms: [.macOS(.v13)],
    products: [
        .executable(
            name: "vibecheck-component-companion",
            targets: ["VibecheckComponentCompanion"]
        )
    ],
    targets: [
        .executableTarget(
            name: "VibecheckComponentCompanion",
            path: "Sources/VibecheckComponentCompanion"
        ),
        .testTarget(
            name: "VibecheckComponentCompanionTests",
            dependencies: ["VibecheckComponentCompanion"],
            path: "Tests/VibecheckComponentCompanionTests"
        ),
    ]
)
