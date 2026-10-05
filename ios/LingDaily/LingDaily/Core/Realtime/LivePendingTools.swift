import Foundation

/// Tool calls and input transcription have no guaranteed relative order.
/// Keep bounded, cancellable effects until their quoted/user sentence exists.
struct LivePendingTools {
    private var pending: [(id: String, action: LiveToolAction)] = []
    var count: Int { pending.count }

    mutating func apply(_ call: LiveToolCall, to session: inout PracticeSession) -> [AILearningItem] {
        guard let action = call.validated() else { return [] }
        if case .items(let items) = action { return items }
        if !Self.attempt(action, session: &session), pending.count < 20 {
            pending.append((call.id, action))
        }
        return []
    }
    mutating func flush(to session: inout PracticeSession) {
        pending.removeAll { Self.attempt($0.action, session: &session) }
    }
    mutating func cancel(_ ids: [String]) {
        let cancelled = Set(ids)
        pending.removeAll { cancelled.contains($0.id) }
    }
    mutating func reset() { pending.removeAll() }

    private static func attempt(_ action: LiveToolAction, session: inout PracticeSession) -> Bool {
        switch action {
        case .correction(let original, let feedback):
            return session.liveCorrection(original: original, feedback: feedback)
        case .complete(let index):
            // Invalid/future/obsolete requests are discarded, never queued to
            // advance a later task without a new model decision.
            guard session.phase != .completed, index == session.stepIndex else { return true }
            return session.liveComplete(taskIndex: index)
        case .items: return true
        }
    }
}
