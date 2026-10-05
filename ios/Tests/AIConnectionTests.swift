import Foundation
import XCTest
@testable import PracticeCore

final class AIConnectionTests: XCTestCase {
    private let credential = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()

    private func config(_ url: String, optedIn: Bool? = nil) -> AIConnectionConfiguration {
        AIConnectionConfiguration(baseURL: URL(string: url)!, accessToken: credential, allowsPhysicalDevice: optedIn)
    }

    func testOldSimulatorConfigurationStillDecodes() throws {
        struct Legacy: Encodable { let baseURL: URL; let accessToken: String }
        let data = try JSONEncoder().encode(Legacy(baseURL: URL(string: "http://localhost:8000")!, accessToken: credential))
        let decoded = try JSONDecoder().decode(AIConnectionConfiguration.self, from: data)
        XCTAssertTrue(decoded.isValidForDevelopment())
        XCTAssertNil(decoded.allowsPhysicalDevice)
        XCTAssertFalse(decoded.isValidForDevelopment(physicalDevice: true))
    }

    func testDeviceNeedsExplicitPrivatePairing() {
        for host in ["10.2.3.4", "172.16.1.2", "172.31.1.2", "192.168.31.16"] {
            XCTAssertFalse(config("http://\(host):8000").isValidForDevelopment(physicalDevice: true))
            XCTAssertTrue(config("http://\(host):8000", optedIn: true).isValidForDevelopment(physicalDevice: true))
        }
    }

    func testPairingCannotTargetPublicServersOrCredentialURLs() {
        for url in ["http://8.8.8.8:8000", "http://172.32.0.1:8000", "http://example.com:8000",
                    "https://192.168.31.16:8000", "http://192.168.31.16:80",
                    "http://user:password@192.168.31.16:8000", "http://192.168.31.16:8000/path",
                    "http://192.168.31.16:8000?redirect=1", "http://192.168.31.16:8000#fragment"] {
            XCTAssertFalse(config(url, optedIn: true).isValidForDevelopment(physicalDevice: true))
        }
        XCTAssertFalse(AIConnectionConfiguration(baseURL: URL(string: "http://localhost:8000")!, accessToken: String(repeating: "z", count: 64)).isValidForDevelopment())
    }

    func testProductionRequiresSignedInSession() async {
        let api = PracticeAPIClient(configuration: nil, accountSession: { nil })
        XCTAssertFalse(api.usesLocalDevelopment)
        do {
            _ = try await api.createScenario(from: "下周和房东谈退押金")
            XCTFail("Signed-out production calls must not reach the network")
        } catch {
            XCTAssertEqual(error.localizedDescription, PracticeNetworkError.signedOut.localizedDescription)
        }
        let expired = AccountSession(token: "header.payload.signature", userID: "u", expiresAt: Date(timeIntervalSinceNow: -60),
                                     email: "a@example.com", isPrivateEmail: false, appleUserID: "apple")
        do {
            _ = try await PracticeAPIClient(configuration: nil, accountSession: { expired }).createScenario(from: "点咖啡")
            XCTFail("Expired sessions must not be sent")
        } catch {
            XCTAssertEqual(error.localizedDescription, PracticeNetworkError.signedOut.localizedDescription)
        }
    }

    func testSignInResponseBecomesUsableSession() throws {
        let json = #"{"sessionToken":"header.payload.signature","expiresAt":"2099-01-01T00:00:00.000Z","account":{"id":"11111111-2222-4333-8444-555555555555","email":"x@privaterelay.appleid.com","isPrivateEmail":true}}"#
        let response = try JSONDecoder().decode(AccountSignInResponse.self, from: Data(json.utf8))
        let session = try XCTUnwrap(response.session(appleUserID: "001.apple"))
        XCTAssertTrue(session.isUsable())
        XCTAssertEqual(session.displayEmail, "Apple 隐藏邮箱")
        XCTAssertEqual(session.appleUserID, "001.apple")
        let bad = #"{"sessionToken":"has space","expiresAt":"2099-01-01T00:00:00.000Z","account":{"id":"u","email":"x@example.com","isPrivateEmail":false}}"#
        XCTAssertNil(try JSONDecoder().decode(AccountSignInResponse.self, from: Data(bad.utf8)).session(appleUserID: "a"))
    }
}
