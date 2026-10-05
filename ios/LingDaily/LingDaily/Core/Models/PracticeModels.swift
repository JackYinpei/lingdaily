import Foundation

struct PracticeStep: Codable, Equatable, Identifiable {
    let id: String
    let goal: String
    let prompt: String
    let translation: String
    let hint: String
    let keywords: String
    let expression: String
    let meaning: String
}

struct PracticeScenario: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let category: String
    let symbol: String
    let partner: String
    let partnerRole: String
    let setting: String
    let steps: [PracticeStep]
}

struct PracticeMessage: Codable, Equatable, Identifiable {
    enum Role: String, Codable { case partner, user }
    enum Kind: String, Codable { case prompt, answer, retry, response }
    let id: UUID
    let role: Role
    let kind: Kind
    let text: String
    let stepIndex: Int
    let createdAt: Date
    var translation: String? = nil
}

struct PracticeSession: Codable, Equatable, Identifiable {
    enum Phase: String, Codable { case speaking, review, retry, completed }
    let id: UUID
    let scenario: PracticeScenario
    let personalGoal: String
    let context: String
    let createdAt: Date
    private(set) var updatedAt: Date
    private(set) var messages: [PracticeMessage]
    private(set) var stepIndex: Int
    private(set) var phase: Phase
    private(set) var ai: AIPracticeState?
    private(set) var live: LivePracticeState? = nil
    /// Unsent text in the composer, restored when the learner comes back. Optional so older archives still decode.
    private(set) var draft: String? = nil

    init(scenario: PracticeScenario, goal: String = "", context: String = "", useAI: Bool = false, now: Date = Date()) {
        precondition(!scenario.steps.isEmpty)
        id = UUID()
        self.scenario = scenario
        personalGoal = String(goal.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
        self.context = String(context.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        createdAt = now
        updatedAt = now
        stepIndex = 0
        phase = .speaking
        messages = useAI ? [] : [PracticeMessage(id: UUID(), role: .partner, kind: .prompt,
            text: scenario.steps[0].prompt, stepIndex: 0, createdAt: now)]
        ai = useAI ? AIPracticeState(pending: AIPendingRequest(id: UUID(), action: .start)) : nil
    }

    var title: String { personalGoal.isEmpty ? scenario.title : personalGoal }
    var step: PracticeStep { scenario.steps[min(stepIndex, scenario.steps.count - 1)] }
    var userTurns: Int { messages.filter { $0.role == .user }.count }
    var retryCount: Int { messages.filter { $0.kind == .retry }.count }
    var completedSteps: Int {
        phase == .completed ? scenario.steps.count : stepIndex + ((phase == .review || phase == .retry) ? 1 : 0)
    }
    var originalAnswer: String? {
        messages.last { $0.stepIndex == stepIndex && $0.kind == .answer }?.text
    }
    var isAI: Bool { ai != nil }
    var pendingAIRequest: AIPracticeRequest? {
        guard let pending = ai?.pending else { return nil }
        return AIPracticeRequest(requestId: pending.id, sessionId: id, action: pending.action,
            stepIndex: stepIndex, goal: personalGoal, context: context,
            scenario: .init(title: scenario.title, partner: scenario.partner,
                partnerRole: scenario.partnerRole, setting: scenario.setting, goals: scenario.steps.map(\.goal)),
            messages: messages.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.suffix(24).map { .init(role: $0.role, kind: $0.kind, text: live == nil ? $0.text : String($0.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1200)), stepIndex: $0.stepIndex) })
    }
    var currentFeedback: AIFeedback? {
        guard let user = messages.last(where: { $0.role == .user && $0.stepIndex == stepIndex }) else { return nil }
        return ai?.feedbacks.last { $0.id == user.id }?.feedback
    }
    func feedback(for messageID: UUID) -> AIFeedback? {
        ai?.feedbacks.first { $0.id == messageID }?.feedback
    }
    var suggestedStep: PracticeStep? {
        guard let turn = ai?.turn, ai?.pending == nil else { return nil }
        return PracticeStep(id: step.id, goal: step.goal, prompt: turn.reply, translation: turn.translation,
            hint: turn.hint, keywords: turn.keywords,
            expression: currentFeedback?.revised ?? turn.suggestedReply,
            meaning: currentFeedback?.meaning ?? turn.suggestedMeaning)
    }
    var takeaways: [PracticeStep] {
        guard let ai else { return scenario.steps }
        return scenario.steps.indices.compactMap { index in
            guard let item = ai.feedbacks.last(where: { $0.stepIndex == index }) else { return nil }
            let step = scenario.steps[index]
            return PracticeStep(id: step.id, goal: step.goal, prompt: "", translation: "", hint: "", keywords: "",
                expression: item.feedback.revised, meaning: item.feedback.meaning)
        }
    }

    @discardableResult
    mutating func submit(_ text: String, now: Date = Date()) -> Bool {
        guard (phase == .speaking || phase == .retry), ai?.pending == nil else { return false }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 800 else { return false }
        messages.append(PracticeMessage(id: UUID(), role: .user,
            kind: phase == .retry ? .retry : .answer, text: trimmed,
            stepIndex: stepIndex, createdAt: now))
        draft = nil
        phase = .review
        if isAI { ai?.pending = AIPendingRequest(id: UUID(), action: .answer) }
        updatedAt = now
        return true
    }

    mutating func beginRetry(now: Date = Date()) {
        guard phase == .review, ai?.pending == nil else { return }
        phase = .retry
        updatedAt = now
    }

    mutating func cancelRetry(now: Date = Date()) {
        guard phase == .retry else { return }
        phase = .review
        updatedAt = now
    }

    mutating func advance(now: Date = Date()) {
        guard phase == .review, ai?.pending == nil else { return }
        updatedAt = now
        if stepIndex + 1 == scenario.steps.count {
            phase = .completed
        } else {
            stepIndex += 1
            phase = .speaking
            if isAI { ai?.pending = AIPendingRequest(id: UUID(), action: .advance) }
            else {
                messages.append(PracticeMessage(id: UUID(), role: .partner, kind: .prompt,
                    text: step.prompt, stepIndex: stepIndex, createdAt: now))
            }
        }
    }

    @discardableResult
    mutating func applyAIResponse(_ response: AIPracticeResponse, now: Date = Date()) -> Bool {
        guard let pending = ai?.pending, pending.id == response.requestId,
              response.data.isValid(for: pending.action), !response.model.isEmpty else { return false }
        if let feedback = response.data.feedback {
            guard let user = messages.last, user.role == .user, user.stepIndex == stepIndex else { return false }
            ai?.feedbacks.append(AIFeedbackRecord(id: user.id, stepIndex: stepIndex, feedback: feedback))
        }
        messages.append(PracticeMessage(id: UUID(), role: .partner,
            kind: pending.action == .answer ? .response : .prompt,
            text: response.data.reply, stepIndex: stepIndex, createdAt: now, translation: response.data.translation))
        ai?.turn = response.data
        ai?.model = response.model
        ai?.pending = nil
        updatedAt = now
        return true
    }

    /// Live is a separate transition path. Existing HTTP submit/retry/advance
    /// contracts stay unchanged and still require their pending request rules.
    mutating func beginLive(model: String? = nil, now: Date = Date()) {
        guard phase != .completed else { return }
        if ai == nil { ai = AIPracticeState() }
        ai?.pending = nil
        live = live ?? LivePracticeState()
        if let model { live?.model = model }
        phase = .speaking
        updatedAt = now
    }
    mutating func prepareText(now: Date = Date()) {
        guard phase != .completed else { return }
        if ai == nil { ai = AIPracticeState() }
        // Repair whitespace-only subtitles written by older Live versions.
        let emptyIDs = Set(messages.filter { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map(\.id))
        messages.removeAll { emptyIDs.contains($0.id) }
        ai?.feedbacks.removeAll { emptyIDs.contains($0.id) }
        phase = .speaking
        ai?.pending = nil
        if messages.isEmpty, stepIndex == 0 { ai?.pending = .init(id: UUID(), action: .start) }
        else if let last = messages.last, last.stepIndex < stepIndex {
            // Live has already advanced the task. Do not re-send an old answer
            // as an answer for the new task (the server correctly rejects that).
            ai?.turn = nil
            ai?.pending = .init(id: UUID(), action: .advance)
        } else if messages.last?.role == .user {
            phase = .review; ai?.pending = .init(id: UUID(), action: .answer)
        }
        updatedAt = now
    }
    @discardableResult
    mutating func liveTranscript(id: UUID, role: PracticeMessage.Role, text: String, now: Date = Date()) -> Bool {
        guard live != nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.count <= 8000 else { return false }
        if let index = messages.firstIndex(where: { $0.id == id }) {
            let previous = messages[index]
            messages[index] = PracticeMessage(id: id, role: role, kind: previous.kind, text: text,
                stepIndex: previous.stepIndex, createdAt: previous.createdAt)
        } else {
            guard messages.count < 500 else { return false }
            messages.append(PracticeMessage(id: id, role: role, kind: role == .user ? .answer : .response,
                text: text, stepIndex: stepIndex, createdAt: now))
        }
        updatedAt = now
        return true
    }
    @discardableResult
    mutating func liveCorrection(original: String, feedback: AIFeedback, now: Date = Date()) -> Bool {
        guard live != nil else { return false }
        let candidates = messages.filter { $0.role == .user }.suffix(12).reversed()
        let ranked = candidates.map { ($0, LiveCorrectionMatcher.score(quote: original, transcript: $0.text)) }
        let bestMatch = ranked.reduce(nil as (PracticeMessage, Double)?) { best, candidate in
            guard let best else { return candidate }
            return candidate.1 > best.1 ? candidate : best
        }
        guard let best = bestMatch, best.1 >= 0.6 else { return false }
        let user = best.0
        ai?.feedbacks.removeAll { $0.id == user.id }
        ai?.feedbacks.append(.init(id: user.id, stepIndex: user.stepIndex, feedback: feedback))
        updatedAt = now
        return true
    }
    @discardableResult
    mutating func liveComplete(taskIndex: Int, now: Date = Date()) -> Bool {
        guard live != nil, phase != .completed, taskIndex == stepIndex,
              messages.contains(where: { $0.role == .user && $0.stepIndex == taskIndex }) else { return false }
        live?.completedTasks.append(taskIndex)
        ai?.turn = nil
        if stepIndex + 1 == scenario.steps.count { phase = .completed }
        else { stepIndex += 1; phase = .speaking }
        updatedAt = now
        return true
    }
    mutating func endLive(now: Date = Date()) { live?.endedAt = now; updatedAt = now }

    var isValid: Bool {
        !scenario.steps.isEmpty && stepIndex >= 0 && stepIndex < scenario.steps.count
            && messages.allSatisfy { $0.stepIndex >= 0 && $0.stepIndex < scenario.steps.count }
            && (ai?.feedbacks.allSatisfy { item in
                messages.contains { $0.id == item.id && $0.role == .user && $0.stepIndex == item.stepIndex }
            } ?? true)
    }
}

struct SavedExpression: Codable, Equatable, Identifiable {
    let id: String
    let text: String
    let meaning: String
    let source: String
    let createdAt: Date
    /// word | phrase | grammar when auto-collected from feedback; nil for a sentence saved by hand.
    var kind: String? = nil

    static func key(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

struct PracticeArchive: Codable, Equatable {
    var schemaVersion = 2
    var sessions: [PracticeSession] = []
    var expressions: [SavedExpression] = []
    /// Learner-created scenarios, newest first. Sessions embed their scenario, so deleting one keeps history intact.
    var scenarios: [PracticeScenario] = []

    /// Adds auto-collected items that are not already in 词库; never removes anything.
    mutating func collect(_ items: [AILearningItem], source: String, now: Date = Date()) {
        for item in items.reversed() {
            let key = SavedExpression.key(item.text)
            guard !key.isEmpty, !expressions.contains(where: { $0.id == key }) else { continue }
            expressions.insert(SavedExpression(id: key, text: item.text, meaning: item.meaning,
                source: source, createdAt: now, kind: item.type), at: 0)
        }
    }

    mutating func upsert(_ session: PracticeSession) {
        guard session.isValid, session.userTurns > 0 else { return }
        sessions.removeAll { $0.id == session.id }
        sessions.append(session)
        sessions.sort { $0.updatedAt > $1.updatedAt }
    }

    mutating func toggleExpression(text: String, meaning: String, source: String, now: Date = Date()) {
        let key = SavedExpression.key(text)
        guard !key.isEmpty else { return }
        if expressions.contains(where: { $0.id == key }) {
            expressions.removeAll { $0.id == key }
        } else {
            expressions.insert(SavedExpression(id: key, text: text, meaning: meaning,
                source: source, createdAt: now), at: 0)
        }
    }
}

extension PracticeArchive {
    private enum CodingKeys: String, CodingKey { case schemaVersion, sessions, expressions, scenarios }

    // Keys added after v2 are optional so older archives keep loading.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        sessions = try container.decode([PracticeSession].self, forKey: .sessions)
        expressions = try container.decode([SavedExpression].self, forKey: .expressions)
        scenarios = try container.decodeIfPresent([PracticeScenario].self, forKey: .scenarios) ?? []
    }
}

struct LivePracticeState: Codable, Equatable {
    var model: String? = nil
    var completedTasks: [Int] = []
    var endedAt: Date? = nil
}

extension PracticeSession {
    /// Stores an on-demand Chinese gloss for one partner line (Live transcripts have none).
    @discardableResult
    mutating func applyTranslation(_ translation: String, to messageID: UUID, now: Date = Date()) -> Bool {
        let text = translation.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 600,
              let index = messages.firstIndex(where: { $0.id == messageID && $0.role == .partner }) else { return false }
        messages[index].translation = text
        updatedAt = now
        return true
    }
}

extension PracticeSession {
    /// Keeps what the learner typed but has not sent, so leaving never loses it.
    mutating func keepDraft(_ text: String, now: Date = Date()) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : String(text.prefix(800))
        guard value != draft else { return }
        draft = value
        updatedAt = now
    }
}

