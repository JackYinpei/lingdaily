import Foundation

/// Match quoted sentences inside a transcript, ignoring STT punctuation and
/// minor word differences. Never blindly attach an unrelated quote to a user.
enum LiveCorrectionMatcher {
    static func words(_ text: String) -> [String] {
        text.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
    }
    static func score(quote: String, transcript: String) -> Double {
        let left = words(quote), right = words(transcript)
        guard !left.isEmpty, !right.isEmpty else { return 0 }
        if left == right { return 1 }
        let a = left.joined(separator: " "), b = right.joined(separator: " ")
        if left.count >= 2 && (" \(b) ".contains(" \(a) ") || " \(a) ".contains(" \(b) ")) { return 0.95 }
        // Token overlap handles a sentence embedded in a longer transcription
        // and speech-to-text tense/contraction changes without quadratic strings.
        let shared = Set(left).intersection(Set(right)).count
        guard shared >= 2 else { return 0 }
        return Double(shared) / Double(min(Set(left).count, Set(right).count)) * 0.85
    }
}
