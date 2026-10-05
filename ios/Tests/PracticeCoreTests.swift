import Foundation
import XCTest
@testable import PracticeCore

final class PracticeCoreTests: XCTestCase {
    private var scenario: PracticeScenario {
        PracticeScenario(id: "test", title: "Test rehearsal", subtitle: "Test", category: "Test",
                         symbol: "waveform", partner: "Alex", partnerRole: "Colleague", setting: "Test",
                         steps: (0..<2).map { index in
            PracticeStep(id: "step-\(index)", goal: "Task \(index)", prompt: "Question \(index)?",
                         translation: "问题", hint: "提示", keywords: "word", expression: "Example \(index)", meaning: "示例")
        })
    }

    func testEmptyAndOversizedSubmissionsNeverCreateHistory() {
        var session = PracticeSession(scenario: scenario)
        XCTAssertFalse(session.submit(" \n "))
        XCTAssertFalse(session.submit(String(repeating: "a", count: 801)))
        session.advance()
        session.beginRetry()
        XCTAssertEqual(session.phase, .speaking)
        XCTAssertEqual(session.stepIndex, 0)
        var archive = PracticeArchive()
        archive.upsert(session)
        XCTAssertTrue(archive.sessions.isEmpty)
    }

    func testRetryPreservesOriginalAndDoesNotAdvanceTask() {
        var session = PracticeSession(scenario: scenario)
        XCTAssertTrue(session.submit("  Original answer  "))
        XCTAssertFalse(session.submit("Accidental double submit"))
        session.beginRetry()
        session.advance() // Can't skip while a retry is waiting for input.
        XCTAssertEqual(session.phase, .retry)
        XCTAssertTrue(session.submit("A second version"))
        session.beginRetry()
        XCTAssertTrue(session.submit("A third version"))
        XCTAssertEqual(session.originalAnswer, "Original answer")
        XCTAssertEqual(session.messages.filter { $0.role == .user }.map(\.text),
                       ["Original answer", "A second version", "A third version"])
        XCTAssertEqual(session.retryCount, 2)
        XCTAssertEqual(session.stepIndex, 0)
        session.advance()
        XCTAssertEqual(session.stepIndex, 1)
        XCTAssertEqual(session.messages.last?.text, "Question 1?")
        XCTAssertEqual(session.phase, .speaking)
    }

    func testCompletionRequiresEveryTaskAndIsTerminal() {
        var session = PracticeSession(scenario: scenario)
        session.submit("First")
        session.advance()
        session.advance()
        XCTAssertEqual(session.phase, .speaking)
        session.submit("Second")
        session.advance()
        XCTAssertEqual(session.phase, .completed)
        XCTAssertEqual(session.completedSteps, 2)
        let completed = session
        XCTAssertFalse(session.submit("Too late"))
        session.beginRetry()
        session.advance()
        XCTAssertEqual(session, completed)
    }

    func testCancelRetryKeepsOriginalWithoutInventingAnotherTurn() {
        var session = PracticeSession(scenario: scenario)
        session.submit("Keep this answer")
        session.beginRetry()
        session.cancelRetry()
        XCTAssertEqual(session.phase, .review)
        XCTAssertEqual(session.userTurns, 1)
        XCTAssertEqual(session.retryCount, 0)
        XCTAssertEqual(session.originalAnswer, "Keep this answer")
        session.advance()
        XCTAssertEqual(session.stepIndex, 1)
    }

    func testSavingUpdatesSameSessionButKeepsNewAttemptsSeparate() {
        var archive = PracticeArchive()
        var first = PracticeSession(scenario: scenario, goal: "  My goal  ")
        XCTAssertEqual(first.title, "My goal")
        first.submit("First")
        archive.upsert(first)
        first.beginRetry()
        first.submit("Again")
        archive.upsert(first)
        XCTAssertEqual(archive.sessions.count, 1)
        XCTAssertEqual(archive.sessions[0].retryCount, 1)
        var nextAttempt = PracticeSession(scenario: scenario)
        nextAttempt.submit("Another day", now: Date().addingTimeInterval(5))
        archive.upsert(nextAttempt)
        XCTAssertEqual(archive.sessions.count, 2)
        XCTAssertEqual(archive.sessions.first?.id, nextAttempt.id)
    }

    func testFavoritesNormalizeIdentityAndToggle() {
        var archive = PracticeArchive()
        archive.toggleExpression(text: "Could we try?", meaning: "试试？", source: "Test")
        archive.toggleExpression(text: " COULD WE TRY?  ", meaning: "试试？", source: "Test")
        XCTAssertTrue(archive.expressions.isEmpty)
        archive.toggleExpression(text: "Could we try?", meaning: "试试？", source: "Test")
        archive.toggleExpression(text: "  ", meaning: "", source: "")
        XCTAssertEqual(archive.expressions.count, 1)
    }

    func testArchiveRoundTripCanResumeRetryAndKeepsFavorites() throws {
        try withFile { file in
            XCTAssertEqual(try file.load(), PracticeArchive())
            var session = PracticeSession(scenario: scenario, goal: "Tomorrow", context: "Be polite")
            session.submit("First try")
            session.beginRetry()
            var archive = PracticeArchive()
            archive.upsert(session)
            archive.toggleExpression(text: "Useful phrase", meaning: "好用的表达", source: "Test")
            try file.save(archive)
            let loaded = try file.load()
            XCTAssertEqual(loaded, archive)
            var resumed = try XCTUnwrap(loaded.sessions.first)
            XCTAssertTrue(resumed.submit("Second try"))
            XCTAssertEqual(resumed.originalAnswer, "First try")
            XCTAssertEqual(resumed.retryCount, 1)
        }
    }

    func testCorruptAndFutureArchivesAreRejectedWithoutChangingBytes() throws {
        try withFile { file in
            try FileManager.default.createDirectory(at: file.url.deletingLastPathComponent(), withIntermediateDirectories: true)
            for bytes in [Data("broken JSON".utf8), Data("{\"schemaVersion\":3,\"sessions\":[],\"expressions\":[]}".utf8)] {
                try bytes.write(to: file.url)
                XCTAssertThrowsError(try file.load())
                XCTAssertEqual(try Data(contentsOf: file.url), bytes)
            }
        }
    }

    func testInvalidDecodedStepCannotReachUI() throws {
        try withFile { file in
            var session = PracticeSession(scenario: scenario)
            session.submit("Hello")
            var archive = PracticeArchive()
            archive.upsert(session)
            let data = try JSONEncoder().encode(archive)
            var json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            var sessions = try XCTUnwrap(json["sessions"] as? [[String: Any]])
            sessions[0]["stepIndex"] = -1
            json["sessions"] = sessions
            try FileManager.default.createDirectory(at: file.url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: json).write(to: file.url)
            XCTAssertThrowsError(try file.load())
        }
    }

    private func withFile(_ body: (ArchiveFile) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LingDailyTests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(ArchiveFile(url: directory.appendingPathComponent("nested/archive.json")))
    }
}
