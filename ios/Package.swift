// swift-tools-version: 5.9
import PackageDescription

// The app uses these same files directly. This package tests the state machine and
// local archive without requiring a simulator, microphone, network or account.
let package = Package(
    name: "LingDailyPracticeCore",
    platforms: [.macOS(.v12), .iOS(.v15)],
    products: [.library(name: "PracticeCore", targets: ["PracticeCore"])],
    targets: [
        .target(name: "PracticeCore", path: "LingDaily/LingDaily/Core",
                exclude: ["Audio"], sources: ["Models", "Persistence", "Network", "Realtime"]),
        .testTarget(name: "PracticeCoreTests", dependencies: ["PracticeCore"], path: "Tests")
    ]
)
