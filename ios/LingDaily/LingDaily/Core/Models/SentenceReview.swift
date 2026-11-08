import Foundation

/// Kept separately from in-call corrections: the original transcript is never replaced.
struct SentenceReviewRecord: Codable, Equatable, Identifiable {
    let id: UUID
    let original: String
    let revised: String
    let meaning: String
    let note: String
}

struct SentenceReviewRequest: Encodable {
    struct Message: Encodable {
        let messageId: UUID
        let text: String
        let precedingPartner: String
    }
    let requestId: UUID
    let sessionId: UUID
    let scenario: AIPracticeRequest.Scenario
    let messages: [Message]
    var model: String? = nil
}

struct SentenceReviewResponse: Decodable {
    struct Item: Decodable {
        let messageId: UUID
        let revised: String
        let meaning: String
        let note: String
    }
    let requestId: UUID
    let items: [Item]

    func records(for request: SentenceReviewRequest) -> [SentenceReviewRecord]? {
        guard requestId == request.requestId, items.count == request.messages.count,
              Set(items.map(\.messageId)).count == items.count else { return nil }
        var records: [SentenceReviewRecord] = []
        for message in request.messages {
            guard let item = items.first(where: { $0.messageId == message.messageId }),
                  item.revised.count <= 8000, item.meaning.count <= 16000, item.note.count <= 500,
                  item.revised.isEmpty ? (item.meaning.isEmpty && item.note.isEmpty)
                    : (!item.revised.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !item.meaning.isEmpty && !item.note.isEmpty)
            else { return nil }
            records.append(.init(id: message.messageId, original: message.text, revised: item.revised, meaning: item.meaning, note: item.note))
        }
        return records
    }
}

extension PracticeSession {
    var learnerMessages: [PracticeMessage] {
        messages.filter { $0.role == .user && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    func sentenceReview(for message: PracticeMessage) -> SentenceReviewRecord? {
        sentenceReviews?.first { $0.id == message.id && $0.original == message.text }
    }

    /// Bounded batches cover every turn over successive calls, including retries and short replies.
    var nextSentenceReview: SentenceReviewRequest? {
        guard isAI, phase == .completed else { return nil }
        var batch: [SentenceReviewRequest.Message] = []
        var length = 0
        var partner = ""
        for message in messages {
            if message.role == .partner { partner = String(message.text.prefix(800)); continue }
            guard !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  sentenceReview(for: message) == nil else { continue }
            let count = message.text.utf16.count
            if !batch.isEmpty && (batch.count == 4 || length + count > 16000) { break }
            batch.append(.init(messageId: message.id, text: message.text, precedingPartner: partner))
            length += count
        }
        guard !batch.isEmpty else { return nil }
        return .init(requestId: UUID(), sessionId: id,
                     scenario: .init(title: scenario.title, partner: scenario.partner, partnerRole: scenario.partnerRole,
                                     setting: scenario.setting, goals: scenario.steps.map(\.goal)), messages: batch)
    }
}
