import Foundation

/// What the app says to the model right after a Live session is set up.
/// A fresh rehearsal asks the partner to open, naming who the model plays:
/// the setting is written to the learner as 你, and without this the model
/// sometimes opened with the learner's own lines. When resuming (switching
/// from text, or reconnecting) a fixed "please begin" made the model repeat
/// its last question, so the cue depends on who spoke last.
enum LiveKickoff {
    static func fresh(_ scenario: PracticeScenario) -> String {
        "You are \(scenario.partner) (\(scenario.partnerRole)); I am the learner. Open the conversation in character as \(scenario.partner): greet me and ask your first question for the current task. Never say my lines."
    }

    static func replyToLearner(_ scenario: PracticeScenario) -> String {
        "You are \(scenario.partner). We were cut off. Reply in character to my last message above. Do not greet me again or repeat anything you already said."
    }

    /// nil means send nothing: the partner's last line is still waiting for the learner's answer.
    static func text(for session: PracticeSession) -> String? {
        let spoken = session.messages.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard let last = spoken.last else { return fresh(session.scenario) }
        return last.role == .user ? replyToLearner(session.scenario) : nil
    }
}
