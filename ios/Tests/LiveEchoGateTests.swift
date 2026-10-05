import Foundation
import XCTest
@testable import PracticeCore

final class LiveEchoGateTests: XCTestCase {
    func testSpeakerSilencesMicrophoneWhilePartnerPlaysAndForAShortTail() {
        var gate = LiveEchoGate()
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: false, speakerOutput: true, now: 10))
        XCTAssertTrue(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: true, now: 11))
        XCTAssertTrue(gate.suppressesMicrophone(partnerAudible: false, speakerOutput: true, now: 11 + LiveEchoGate.tail - 0.01))
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: false, speakerOutput: true, now: 11 + LiveEchoGate.tail + 0.01))
    }

    func testHeadphonesKeepBargeIn() {
        var gate = LiveEchoGate()
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: false, now: 1))
        // Switching to the speaker mid-reply starts suppressing; unplugging leaves no stale tail.
        XCTAssertTrue(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: true, now: 2))
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: false, speakerOutput: false, now: 2.1))
    }
}
