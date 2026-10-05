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

    func testInterruptOpensTheMicrophoneUntilThePartnerRepliesAgain() {
        var gate = LiveEchoGate()
        XCTAssertTrue(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: true, now: 1))
        gate.learnerTookFloor()
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: true, now: 1.01),
                       "After 打断 the learner is heard immediately, even before queued audio drains")
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: false, speakerOutput: true, now: 1.2))
        gate.partnerStartedReply()
        XCTAssertTrue(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: true, now: 3))
    }

    func testHeadphonesKeepVoiceBargeIn() {
        var gate = LiveEchoGate()
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: false, now: 1))
        XCTAssertTrue(gate.suppressesMicrophone(partnerAudible: true, speakerOutput: true, now: 2))
        XCTAssertFalse(gate.suppressesMicrophone(partnerAudible: false, speakerOutput: false, now: 2.1), "No stale tail after unplugging")
    }
}
