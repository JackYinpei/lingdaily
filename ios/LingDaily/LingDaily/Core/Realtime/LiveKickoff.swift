import Foundation

/// What the app says to the model right after a Live session is set up.
/// A fresh rehearsal asks the partner to open. When resuming (switching from
/// text, or reconnecting) a fixed "please begin" made the model repeat its
/// last question, so the cue now depends on who spoke last.
enum LiveKickoff {
    static let fresh = "Please begin our rehearsal at the current task."
    static let replyToLearner = "We were cut off. Reply naturally to my last message above. Do not greet me again or repeat anything you already said."

    /// nil means send nothing: the partner's last line is still waiting for the learner's answer.
    static func text(for session: PracticeSession) -> String? {
        let spoken = session.messages.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard let last = spoken.last else { return fresh }
        return last.role == .user ? replyToLearner : nil
    }
}
