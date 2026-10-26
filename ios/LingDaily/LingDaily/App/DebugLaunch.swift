#if DEBUG
import Foundation

/// Simulator QA and screenshot entry points, never compiled into Release:
/// `xcrun simctl launch booted com.qcy.LingDaily -LingDailyOpen review` opens 词库 review.
/// Routes: prep:<scenario id> · today-vocabulary · compose · vocabulary · review · session · summary.
enum DebugLaunch {
    private static var consumed = Set<String>()
    static let route = UserDefaults.standard.string(forKey: "LingDailyOpen") ?? ""

    /// True once for the launch route `name` (or its `name:` prefix); later appearances do nothing.
    static func take(_ name: String) -> Bool {
        guard route == name || route.hasPrefix(name + ":"), consumed.insert(name).inserted else { return false }
        return true
    }

    /// True the first time `key` is asked for in this launch.
    static func once(_ key: String) -> Bool { consumed.insert(key).inserted }

    static var argument: String { route.split(separator: ":", maxSplits: 1).dropFirst().first.map(String.init) ?? "" }
    static var opensLearning: Bool { ["vocabulary", "review", "session", "summary"].contains(route) }
}
#endif
