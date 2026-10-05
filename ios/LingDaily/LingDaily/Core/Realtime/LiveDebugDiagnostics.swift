import Foundation

/// Explicit Debug opt-in, numeric counters/fixed event names only. Never pass
/// transcript text, errors, credentials or URLs to this boundary.
enum LiveDebugDiagnostics {
    #if DEBUG
    private static let lock = NSLock()
    private static var lines: [String] = []
    #endif
    static func record(_ message: String) {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["LINGDAILY_LIVE_DIAGNOSTICS"] == "1" else { return }
        lock.lock(); defer { lock.unlock() }
        lines.append(message)
        if lines.count > 160 { lines.removeFirst(lines.count - 160) }
        if let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
            try? FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
            try? (lines.joined(separator: "\n") + "\n").write(to: cache.appendingPathComponent("live-audio-diagnostics.txt"), atomically: true, encoding: .utf8)
        }
        print("LingDaily.Live \(message)")
        fflush(stdout)
        #endif
    }
}
