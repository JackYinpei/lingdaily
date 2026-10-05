import Foundation
import XCTest
@testable import PracticeCore

final class LiveUsageTests: XCTestCase {
    func testParsesPerTurnUsageAndSumsAConnection() throws {
        // Captured shape from a real two-turn Gemini Live session.
        let first = #"{"usageMetadata":{"promptTokenCount":162,"responseTokenCount":42,"totalTokenCount":204,"promptTokensDetails":[{"modality":"TEXT","tokenCount":139}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":42}]}}"#
        let second = #"{"usageMetadata":{"promptTokenCount":235,"responseTokenCount":71,"totalTokenCount":306,"promptTokensDetails":[{"modality":"TEXT","tokenCount":154},{"modality":"AUDIO","tokenCount":42}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":71}]}}"#
        var total = LiveUsage()
        for raw in [first, second] {
            for event in try LiveCodec.parse(Data(raw.utf8)) {
                guard case .usage(let turn) = event else { return XCTFail("expected usage") }
                total = total + turn
            }
        }
        XCTAssertEqual(total, LiveUsage(input: 397, output: 113, inputAudio: 42, outputAudio: 113, total: 510))
        let report = try XCTUnwrap(LiveUsageReport(reportId: UUID(), model: "gemini-3.1-flash-live-preview", usage: total))
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(report)) as? [String: Any]
        XCTAssertEqual(Set(json?.keys.map { $0 } ?? []),
                       ["reportId", "model", "inputTokens", "outputTokens", "inputAudioTokens", "outputAudioTokens", "totalTokens"],
                       "Matches the server's strict schema")
    }

    func testNothingToReportForAnEmptyConnection() {
        XCTAssertNil(LiveUsageReport(reportId: UUID(), model: "m", usage: LiveUsage()))
        XCTAssertNil(LiveUsage(metadata: [:]))
    }
}
