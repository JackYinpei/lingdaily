import Foundation
import XCTest
@testable import PracticeCore

final class CloudSyncTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_790_000_000)

    private func scenario(_ id: String = "custom-0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D") -> PracticeScenario {
        PracticeScenario(id: id, title: "退押金", subtitle: "确认时间", category: "日常", symbol: "text.bubble",
                         partner: "Morgan", partnerRole: "房东", setting: "你下周搬走。",
                         steps: (0..<3).map { index in
            PracticeStep(id: "step-\(index)", goal: "目标\(index)", prompt: "Prompt \(index)?", translation: "译文",
                         hint: "提示", keywords: "deposit", expression: "Example \(index)", meaning: "示例")
        })
    }

    private func session(answer: String = "I need two more days.", at offset: TimeInterval = 0) -> PracticeSession {
        var session = PracticeSession(scenario: scenario(), now: base)
        XCTAssertTrue(session.submit(answer, now: base.addingTimeInterval(offset)))
        return session
    }

    private func expression(_ text: String) -> SavedExpression {
        SavedExpression(id: SavedExpression.key(text), text: text, meaning: "意思", source: "退押金", createdAt: base, kind: "phrase")
    }

    private func snapshot(sessions: [PracticeSession] = [], expressions: [SavedExpression] = [],
                          scenarios: [PracticeScenario] = [], rejected: [String]? = nil) throws -> SyncSnapshot {
        // Decode through the real wire format so date coding is covered too.
        struct Wire: Encodable {
            struct Session: Encodable { let id: String; let session: PracticeSession }
            struct Expression: Encodable { let key, text, meaning, source: String; let createdAt: Date; let kind: String? }
            let sessions: [Session]; let expressions: [Expression]; let scenarios: [PracticeScenario]; let rejectedSessions: [String]?
        }
        let wire = Wire(sessions: sessions.map { .init(id: $0.id.uuidString.lowercased(), session: $0) },
                        expressions: expressions.map { .init(key: $0.id, text: $0.text, meaning: $0.meaning, source: $0.source, createdAt: $0.createdAt, kind: $0.kind) },
                        scenarios: scenarios, rejectedSessions: rejected)
        return try CloudSyncCoding.decoder.decode(SyncSnapshot.self, from: CloudSyncCoding.encoder.encode(wire))
    }

    func testFirstSyncUploadsEverythingAlreadyOnTheDevice() throws {
        var archive = PracticeArchive()
        archive.upsert(session())
        archive.expressions = [expression("on track")]
        archive.scenarios = [scenario()]
        var ledger = SyncLedger()
        ledger.adopt(owner: "user-a", archive: archive)
        let changes = ledger.changes(from: archive)
        XCTAssertEqual(changes.sessions.upsert.count, 1)
        XCTAssertEqual(changes.expressions.upsert.map(\.text), ["on track"])
        XCTAssertEqual(changes.scenarios.upsert.map(\.id), [scenario().id])

        ledger.merge(try snapshot(sessions: archive.sessions, expressions: archive.expressions, scenarios: archive.scenarios),
                     sent: changes, into: &archive, now: base)
        XCTAssertEqual(ledger.pendingCount, 0)
        XCTAssertEqual(ledger.synced.count, 3)
        XCTAssertEqual(ledger.lastSyncedAt, base)
        XCTAssertTrue(ledger.changes(from: archive).isEmpty)
    }

    func testEditDuringUploadStaysPendingAndIsNotOverwritten() throws {
        var archive = PracticeArchive()
        let original = session()
        archive.upsert(original)
        var ledger = SyncLedger()
        ledger.adopt(owner: "user-a", archive: archive)
        let changes = ledger.changes(from: archive)

        var edited = original
        edited.beginRetry(now: base.addingTimeInterval(30))
        archive.upsert(edited)
        ledger.sessionChanged(edited.id)

        ledger.merge(try snapshot(sessions: [original]), sent: changes, into: &archive)
        XCTAssertEqual(archive.sessions.first?.phase, .retry, "Local edit made while uploading must survive")
        XCTAssertEqual(ledger.dirty.sessions, [SyncLedger.sessionKey(original.id)])
    }

    func testDeletionsElsewhereApplyButPendingLocalDeletesAreNotResurrected() throws {
        var archive = PracticeArchive()
        let kept = session(answer: "Kept")
        archive.upsert(kept)
        archive.expressions = [expression("deadline"), expression("on track")]
        var ledger = SyncLedger()
        ledger.adopt(owner: "user-a", archive: archive)
        var sent = ledger.changes(from: archive)
        ledger.merge(try snapshot(sessions: [kept], expressions: archive.expressions), sent: sent, into: &archive)

        // The web deleted "deadline"; meanwhile this device deleted "on track" but has not uploaded it yet.
        archive.expressions.removeAll { $0.id == "on track" }
        ledger.expressionDeleted("on track")
        let stale = try snapshot(sessions: [kept], expressions: [expression("on track")])
        sent = SyncChanges()
        ledger.merge(stale, sent: sent, into: &archive)
        XCTAssertTrue(archive.expressions.isEmpty)
        XCTAssertEqual(ledger.changes(from: archive).expressions.delete, ["on track"])

        // Session removed on another device.
        ledger.merge(try snapshot(), sent: SyncChanges(), into: &archive)
        XCTAssertTrue(archive.sessions.isEmpty)
    }

    func testDownloadsNewCloudItemsWithoutMarkingThemForUpload() throws {
        var archive = PracticeArchive()
        var ledger = SyncLedger()
        ledger.adopt(owner: "user-a", archive: archive)
        let remote = session(answer: "From the web")
        ledger.merge(try snapshot(sessions: [remote], expressions: [expression("deadline")], scenarios: [scenario()]),
                     sent: SyncChanges(), into: &archive)
        XCTAssertEqual(archive.sessions.map(\.id), [remote.id])
        XCTAssertEqual(archive.sessions.first?.messages.last?.text, "From the web")
        XCTAssertEqual(archive.expressions.map(\.id), ["deadline"])
        XCTAssertEqual(archive.scenarios.map(\.id), [scenario().id])
        XCTAssertEqual(ledger.pendingCount, 0)
    }

    func testRejectedSessionIsKeptLocallyAndNotRetriedUntilEdited() throws {
        var archive = PracticeArchive()
        let local = session()
        archive.upsert(local)
        var ledger = SyncLedger()
        ledger.adopt(owner: "user-a", archive: archive)
        let sent = ledger.changes(from: archive)
        ledger.merge(try snapshot(rejected: [local.id.uuidString]), sent: sent, into: &archive)
        XCTAssertEqual(archive.sessions.count, 1)
        XCTAssertTrue(ledger.changes(from: archive).isEmpty)
        ledger.merge(try snapshot(), sent: SyncChanges(), into: &archive)
        XCTAssertEqual(archive.sessions.count, 1, "A rejected session is never treated as deleted remotely")
        ledger.sessionChanged(local.id)
        XCTAssertEqual(ledger.changes(from: archive).sessions.upsert.count, 1)
    }
}
