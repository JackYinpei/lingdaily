import Foundation

/// How long the learner may pause in a call before the partner replies. The
/// server locks it into the Live token, so a change applies from the next call.
enum LivePause {
    static let key = "livePauseMs"
    static let options = [800, 1500, 2500, 4000]
    static let standard = 1500

    static func milliseconds(defaults: UserDefaults = .standard) -> Int {
        let value = defaults.integer(forKey: key)
        return options.contains(value) ? value : standard
    }

    static func label(_ milliseconds: Int) -> String {
        let seconds = Double(milliseconds) / 1000
        return seconds == seconds.rounded() ? "\(Int(seconds)) 秒" : "\(seconds) 秒"
    }
}
