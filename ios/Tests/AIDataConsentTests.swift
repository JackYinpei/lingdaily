import Foundation
import XCTest
@testable import PracticeCore

final class AIDataConsentTests: XCTestCase {
    func testPermissionRequiresCurrentVersionAndCanBeWithdrawn() throws {
        let name = "AIDataConsentTests.\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        XCTAssertFalse(AIDataConsent.isGranted(defaults: defaults))
        defaults.set("old-policy", forKey: AIDataConsent.key)
        XCTAssertFalse(AIDataConsent.isGranted(defaults: defaults))
        AIDataConsent.grant(defaults: defaults)
        XCTAssertTrue(AIDataConsent.isGranted(defaults: defaults))
        XCTAssertNotNil(defaults.object(forKey: AIDataConsent.dateKey) as? Date)
        AIDataConsent.revoke(defaults: defaults)
        XCTAssertFalse(AIDataConsent.isGranted(defaults: defaults))
        XCTAssertNil(defaults.object(forKey: AIDataConsent.dateKey))
    }

    func testAllAIContentRequestsStopBeforeNetworkWithoutPermission() async throws {
        let account = AccountSession(token: "header.payload.signature", userID: "synthetic",
                                     expiresAt: Date(timeIntervalSinceNow: 3600), email: "test@example.com",
                                     isPrivateEmail: false, appleUserID: "synthetic")
        let api = PracticeAPIClient(configuration: nil, accountSession: { account }, aiConsent: { false })
        let step = PracticeStep(id: "step", goal: "Order coffee", prompt: "Test", translation: "测试",
                                hint: "Test", keywords: "coffee", expression: "Coffee, please", meaning: "咖啡")
        let scenario = PracticeScenario(id: "test", title: "Test", subtitle: "Test", category: "Test", symbol: "cup.and.saucer",
                                        partner: "Alex", partnerRole: "Barista", setting: "A fictional cafe", steps: [step])
        let practice = PracticeSession(scenario: scenario, useAI: true)
        let withOpeningLine = PracticeSession(scenario: scenario)
        let calls: [() async throws -> Void] = [
            { _ = try await api.createScenario(from: "Synthetic cafe") },
            { _ = try await api.scenarioIdeas(avoiding: []) },
            { _ = try await api.translate("Hello") },
            { _ = try await api.liveToken(for: practice) },
            { _ = try await api.suggest(for: withOpeningLine) },
            { _ = try await api.respond(to: XCTUnwrap(practice.pendingAIRequest)) },
        ]
        for call in calls {
            do {
                try await call()
                XCTFail("Content must not leave the device before permission")
            } catch {
                XCTAssertEqual(error.localizedDescription, PracticeNetworkError.aiConsentRequired.localizedDescription)
            }
        }
    }
}
