import Foundation

/// Apple may return a cumulative hypothesis or only the latest audio window.
/// Audio timestamps distinguish new speech from revisions of the same words.
/// This reducer is used only by text-mode dictation, never by Gemini Live.
struct DictationTranscript {
    struct Word {
        let range: NSRange
        let timestamp: TimeInterval
        let duration: TimeInterval
    }
    private struct Part {
        var text: String
        let start: TimeInterval?
        let end: TimeInterval?
    }
    private var parts: [Part] = []
    private var latestSnapshot = ""
    private(set) var text = ""
    private(set) var reachedLimit = false
    let maxCharacters: Int

    init(maxCharacters: Int = 800) { self.maxCharacters = max(1, maxCharacters) }

    @discardableResult
    mutating func update(_ snapshot: String, words: [Word]) -> String {
        let incoming = snapshot.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !incoming.isEmpty, !reachedLimit else { return text }
        let candidate = timedParts(snapshot, words: words)
        if let first = candidate.first?.start, parts.contains(where: { $0.start != nil }) {
            // Keep everything before the new audio window, including complete
            // sentences omitted from Apple's latest formattedString.
            var prefix = parts.filter { part in
                guard let start = part.start, let end = part.end else {
                    return !incoming.hasPrefix(part.text.trimmingCharacters(in: .whitespacesAndNewlines))
                }
                return start < first - 0.1 && end <= first + 0.03
            }
            separate(&prefix, from: snapshot)
            parts = prefix + candidate
        } else {
            // Timing may be absent in interim results. Revise the active
            // hypothesis, while retaining completed earlier audio windows.
            var prefix = ""
            if isRevision(incoming, of: latestSnapshot) {
                if text.hasSuffix(latestSnapshot) { prefix = String(text.dropLast(latestSnapshot.count)) }
            } else if !incoming.hasPrefix(text), !text.isEmpty {
                prefix = text + " "
            }
            parts = prefix.isEmpty ? [] : [Part(text: prefix, start: nil, end: nil)]
            parts += candidate.isEmpty ? [Part(text: incoming, start: nil, end: nil)] : candidate
        }
        let merged = parts.map(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        reachedLimit = merged.count >= maxCharacters
        text = String(merged.prefix(maxCharacters))
        latestSnapshot = incoming
        return text
    }

    private func timedParts(_ snapshot: String, words: [Word]) -> [Part] {
        let source = snapshot as NSString
        guard !words.isEmpty, words.count <= 1600,
              words.contains(where: { $0.timestamp > 0 || $0.duration > 0 }),
              (words.count == 1 || words.first?.timestamp != words.last?.timestamp),
              words.allSatisfy({ $0.timestamp.isFinite && $0.duration.isFinite && $0.timestamp >= 0 && $0.duration >= 0
                  && $0.range.location >= 0 && $0.range.length > 0
                  && $0.range.location <= source.length && $0.range.length <= source.length - $0.range.location }) else { return [] }
        var result: [Part] = []
        for index in words.indices {
            let word = words[index]
            let start = index == 0 ? 0 : word.range.location
            let end = index + 1 < words.count ? words[index + 1].range.location : source.length
            guard end >= start, index == 0 || word.timestamp >= words[index - 1].timestamp,
                  index == 0 || word.range.location >= NSMaxRange(words[index - 1].range) else { return [] }
            result.append(Part(text: source.substring(with: NSRange(location: start, length: end - start)),
                               start: word.timestamp, end: word.timestamp + word.duration))
        }
        return result
    }

    private func separate(_ prefix: inout [Part], from snapshot: String) {
        guard let last = prefix.last?.text.last, !last.isWhitespace,
              let first = snapshot.first, !first.isWhitespace, !first.isPunctuation else { return }
        prefix[prefix.count - 1].text += " "
    }

    private func isRevision(_ incoming: String, of previous: String) -> Bool {
        guard !previous.isEmpty else { return false }
        if incoming.hasPrefix(previous) || previous.hasPrefix(incoming) { return true }
        let old = previous.lowercased().split(separator: " ")
        let new = incoming.lowercased().split(separator: " ")
        let common = zip(old, new).prefix(while: { $0 == $1 }).count
        return common >= 2 || (common == 1 && max(old.count, new.count) <= 2)
    }
}
