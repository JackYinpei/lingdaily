import Foundation
import XCTest
@testable import PracticeCore

final class LiveEchoGateTests: XCTestCase {
    /// One 20 ms frame at 16 kHz whose RMS equals `level` (full scale = 1).
    private func frame(_ level: Float, marker: Int16 = 0) -> Data {
        var samples = [Int16](repeating: Int16(level * 32767), count: 320)
        samples[0] = marker == 0 ? samples[0] : marker
        return samples.withUnsafeBufferPointer { Data(buffer: $0) }
    }
    private func isSilent(_ data: Data) -> Bool { data.allSatisfy { $0 == 0 } }

    func testEchoResidueIsSilencedWhileThePartnerPlaysOnTheSpeaker() {
        var gate = LiveEchoGate()
        for index in 0..<20 {
            let out = gate.filter(frame(0.008), partnerAudible: true, speakerOutput: true, now: Double(index) * 0.02)
            XCTAssertEqual(out.count, 1)
            XCTAssertTrue(isSilent(out[0]), "Quiet residue must never reach Gemini")
        }
        XCTAssertGreaterThan(gate.echoLevel, 0.005, "Threshold calibrates on the measured residue")
        // After the partner stops and the tail passes, the microphone is back to normal.
        let after = gate.filter(frame(0.008), partnerAudible: false, speakerOutput: true, now: 1 + LiveEchoGate.tail)
        XCTAssertFalse(isSilent(after[0]))
    }

    func testLearnerTalkingOverThePartnerStillGetsThrough() {
        var gate = LiveEchoGate()
        for index in 0..<10 { _ = gate.filter(frame(0.008), partnerAudible: true, speakerOutput: true, now: Double(index) * 0.02) }
        XCTAssertTrue(gate.filter(frame(0.2, marker: 1), partnerAudible: true, speakerOutput: true, now: 0.3).isEmpty)
        XCTAssertTrue(gate.filter(frame(0.2, marker: 2), partnerAudible: true, speakerOutput: true, now: 0.32).isEmpty)
        let released = gate.filter(frame(0.2, marker: 3), partnerAudible: true, speakerOutput: true, now: 0.34)
        XCTAssertEqual(released.map { Int16(littleEndian: $0.withUnsafeBytes { $0.load(as: Int16.self) }) }, [1, 2, 3],
                       "The start of the learner's words is released in order, not lost")
        // Quieter word endings keep flowing during the hangover instead of being clipped.
        let ending = gate.filter(frame(0.01), partnerAudible: true, speakerOutput: true, now: 0.36)
        XCTAssertFalse(isSilent(ending[0]))
    }

    func testShortLoudClickDoesNotOpenTheGate() {
        var gate = LiveEchoGate()
        XCTAssertTrue(gate.filter(frame(0.2), partnerAudible: true, speakerOutput: true, now: 0).isEmpty)
        let out = gate.filter(frame(0.005), partnerAudible: true, speakerOutput: true, now: 0.02)
        XCTAssertEqual(out.count, 2)
        XCTAssertTrue(out.allSatisfy(isSilent), "A held burst that is not sustained is replaced by silence")
    }

    func testHeadphonesPassEverything() {
        var gate = LiveEchoGate()
        let out = gate.filter(frame(0.008), partnerAudible: true, speakerOutput: false, now: 0)
        XCTAssertEqual(out.count, 1)
        XCTAssertFalse(isSilent(out[0]))
    }

    func testRMSOfFullScaleAndSilence() {
        XCTAssertEqual(LiveEchoGate.rms(frame(0)), 0)
        XCTAssertEqual(LiveEchoGate.rms(frame(0.5)), 0.5, accuracy: 0.001)
    }
}
