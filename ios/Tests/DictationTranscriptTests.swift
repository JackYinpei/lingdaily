import Foundation
import XCTest
@testable import PracticeCore

final class DictationTranscriptTests: XCTestCase {
    private func words(_ text: String, start: Double = 0) -> [DictationTranscript.Word] {
        let source = text as NSString
        var offset = 0
        return text.split(separator: " ").enumerated().map { index, word in
            let range = source.range(of: String(word), options: [], range: NSRange(location: offset, length: source.length - offset))
            offset = NSMaxRange(range)
            return .init(range: range, timestamp: start + Double(index) * 0.4, duration: 0.3)
        }
    }

    func testPartialCumulativeResultsReplaceOnlyTheSameAudio() {
        var transcript = DictationTranscript()
        transcript.update("I need", words: words("I need"))
        transcript.update("I need more time.", words: words("I need more time."))
        XCTAssertEqual(transcript.text, "I need more time.")
        transcript.update("I need some time.", words: words("I need some time."))
        XCTAssertEqual(transcript.text, "I need some time.")
    }

    func testNewSentenceAfterPauseDoesNotEraseTheEarlierSentences() {
        var transcript = DictationTranscript()
        transcript.update("The supplier is late.", words: words("The supplier is late."))
        transcript.update("I am", words: words("I am", start: 6))
        transcript.update("I am still working on it.", words: words("I am still working on it.", start: 6))
        transcript.update("Could we move it to Thursday?", words: words("Could we move it to Thursday?", start: 12))
        XCTAssertEqual(transcript.text, "The supplier is late. I am still working on it. Could we move it to Thursday?")
    }

    func testAWindowOverlappingTheLastWordsRevisesWithoutDuplication() {
        var transcript = DictationTranscript()
        transcript.update("I need two days.", words: words("I need two days."))
        transcript.update("three days.", words: words("three days.", start: 0.8))
        XCTAssertEqual(transcript.text, "I need three days.")
        let full = "I need three days. Thursday would work."
        transcript.update(full, words: words(full))
        XCTAssertEqual(transcript.text, full)
    }

    func testRepeatedWordsAreDistinguishedByAudioTime() {
        var transcript = DictationTranscript()
        transcript.update("very", words: words("very"))
        transcript.update("very important", words: words("very important", start: 0.4))
        XCTAssertEqual(transcript.text, "very very important")
    }

    func testInterimResultsWithoutTimingRetainEarlierWindowsAndIgnoreEmptyResults() {
        var transcript = DictationTranscript()
        transcript.update("The supplier is", words: [])
        transcript.update("The supplier is late.", words: [])
        transcript.update("I am working", words: [])
        transcript.update("I am still working.", words: [])
        transcript.update(" ", words: [])
        XCTAssertEqual(transcript.text, "The supplier is late. I am still working.")
    }

    func testUTF16RangesPreservePunctuationAndContractions() {
        var transcript = DictationTranscript()
        let first = "I'm working on café invoices."
        transcript.update(first, words: words(first))
        transcript.update("Very, very slowly.", words: words("Very, very slowly.", start: 8))
        XCTAssertEqual(transcript.text, first + " Very, very slowly.")
        let invalid = DictationTranscript.Word(range: NSRange(location: 999, length: 2), timestamp: 10, duration: 1)
        transcript.update("Please wait.", words: [invalid])
        XCTAssertTrue(transcript.text.hasSuffix("Please wait."))
    }

    func testZeroedInterimTimestampsAreNotMistakenForTheSameAudioWindow() {
        var transcript = DictationTranscript()
        func zeroed(_ text: String) -> [DictationTranscript.Word] {
            words(text).map { .init(range: $0.range, timestamp: 0, duration: 0.3) }
        }
        transcript.update("The supplier is late.", words: zeroed("The supplier is late."))
        transcript.update("I am still working.", words: zeroed("I am still working."))
        XCTAssertEqual(transcript.text, "The supplier is late. I am still working.")
    }

    func testLimitIsVisibleAndASecondRecordingStartsFresh() {
        var transcript = DictationTranscript(maxCharacters: 12)
        transcript.update("One sentence that is too long.", words: [])
        XCTAssertEqual(transcript.text.count, 12)
        XCTAssertTrue(transcript.reachedLimit)
        transcript.update("More words", words: [])
        XCTAssertEqual(transcript.text, "One sentence")
        transcript = DictationTranscript()
        transcript.update("New answer", words: [])
        XCTAssertEqual(transcript.text, "New answer")
        XCTAssertFalse(transcript.reachedLimit)
    }
}
