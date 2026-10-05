import Foundation

/// A reply idea for a learner who is stuck during a Live call. Chinese first:
/// `hint` says what to talk about; `reply` is an optional English model answer.
struct LiveSuggestion: Codable, Equatable {
    let hint, keywords, reply, meaning: String
}

struct LiveSuggestionRequest: Encodable {
    let requestId: UUID
    let scenario: AIPracticeRequest.Scenario
    let goal, context: String
    let stepIndex: Int
    let messages: [LiveTokenRequest.Message]
    var model: String? = nil

    init?(session: PracticeSession) {
        let live = LiveTokenRequest(session: session)
        guard !live.messages.isEmpty else { return nil }
        requestId = UUID()
        scenario = live.scenario; goal = live.goal; context = live.context
        stepIndex = live.stepIndex; messages = live.messages
    }
}

/// When to offer help on its own: the partner has finished a line and the
/// learner has said nothing for a while. At most once per partner line.
enum LiveStuckPolicy {
    static let silence: TimeInterval = 8

    /// The partner line the learner should be answering, if the learner has not answered it yet.
    static func awaitedLine(in session: PracticeSession) -> UUID? {
        guard let last = session.messages.last(where: { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
              last.role == .partner else { return nil }
        return last.id
    }
}
