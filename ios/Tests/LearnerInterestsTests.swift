import Foundation
import XCTest
@testable import PracticeCore

final class LearnerInterestsTests: XCTestCase {
    private func scenario(_ id: String, partner: String = "Sam", persona: String? = "忙") -> PracticeScenario {
        PracticeScenario(id: id, title: "t", subtitle: "s", category: "日常", symbol: "house",
            partner: partner, partnerRole: "咖啡师", setting: "情境",
            steps: (0..<3).map { PracticeStep(id: "s\($0)", goal: "g", prompt: "p", translation: "t", hint: "h",
                                              keywords: "k", expression: "e", meaning: "m") },
            persona: persona)
    }

    func testStoredPicksKeepKnownIdsOnceInOrder() {
        XCTAssertEqual(LearnerInterests.picks(from: "work,unknown,pushback,work"), ["work", "pushback"])
        XCTAssertEqual(LearnerInterests.raw(from: ["travel", "nope", "travel", "fast"]), "travel,fast")
        XCTAssertEqual(LearnerInterests.picks(from: ""), [])
        let defaults = UserDefaults(suiteName: "LearnerInterestsTests")!
        defaults.removePersistentDomain(forName: "LearnerInterestsTests")
        XCTAssertFalse(defaults.bool(forKey: LearnerInterests.askedKey))
        LearnerInterests.save([], defaults: defaults)
        XCTAssertTrue(defaults.bool(forKey: LearnerInterests.askedKey), "skipping also counts as asked")
        LearnerInterests.save(["campus", "smalltalk"], defaults: defaults)
        XCTAssertEqual(LearnerInterests.picks(defaults: defaults), ["campus", "smalltalk"])
    }

    func testRanksMatchingScenariosFirstAndKeepsCatalogOrderOtherwise() {
        let all = ["coffee", "classmate", "deposit", "meeting", "blame"].map { scenario($0) }
        let extras: [String: ScenarioExtras] = [
            "coffee": .init(id: "coffee", tags: ["travel", "living", "fast"]),
            "classmate": .init(id: "classmate", tags: ["campus", "social"]),
            "deposit": .init(id: "deposit", tags: ["living", "pushback"]),
            "meeting": .init(id: "meeting", tags: ["work", "pushback"]),
        ]
        XCTAssertEqual(LearnerInterests.ranked(all, extras: extras, picks: []).map(\.id), all.map(\.id))
        XCTAssertEqual(LearnerInterests.ranked(all, extras: extras, picks: ["work", "pushback"]).map(\.id),
                       ["meeting", "deposit", "coffee", "classmate", "blame"])
        XCTAssertEqual(LearnerInterests.recommended(all, extras: extras, picks: ["work", "pushback"], limit: 1), ["meeting"])
        XCTAssertEqual(LearnerInterests.recommended(all, extras: extras, picks: ["interview"]), [])
    }

    func testCatalogExtrasDecodeBesideScenariosAndStayOutOfTheSnapshot() throws {
        let step = #"{"id":"a","goal":"g","prompt":"p","translation":"t","hint":"h","keywords":"k","expression":"e","meaning":"m"}"#
        let data = Data(#"""
        {"version":5,"scenarios":[
          {"id":"coffee","title":"t","subtitle":"s","category":"日常","symbol":"cup.and.saucer","partner":"Sam","partnerRole":"咖啡师",
           "persona":"忙","setting":"情境","steps":[\#(step),\#(step),\#(step)],"tags":["travel","fast"],
           "cast":[{"partner":"Sam","label":"忙碌的兼职生","persona":"忙"},{"partner":"Lou","label":"不耐烦的老店员","persona":"冷"},{"partner":"","label":"x","persona":"y"}]},
          {"id":"hotel","title":"t","subtitle":"s","category":"旅行","symbol":"suitcase","partner":"Jamie","partnerRole":"前台",
           "setting":"情境","steps":[\#(step),\#(step),\#(step)],"cast":[{"partner":"Jamie","label":"客气","persona":"客气"}]}
        ]}
        """#.utf8)
        let response = try JSONDecoder().decode(ScenarioCatalogResponse.self, from: data)
        let extras = response.validExtras
        XCTAssertEqual(extras["coffee"]?.tags, ["travel", "fast"])
        XCTAssertEqual(extras["coffee"]?.cast.map(\.partner), ["Sam", "Lou"], "an invalid person is dropped")
        XCTAssertEqual(extras["hotel"]?.cast, [], "one person is no choice")

        let coffee = try XCTUnwrap(response.validScenarios.first)
        let encoded = String(decoding: try JSONEncoder().encode(coffee), as: UTF8.self)
        XCTAssertFalse(encoded.contains("cast") || encoded.contains("tags"), "a rehearsal snapshot never carries catalog extras")

        let lou = try XCTUnwrap(extras["coffee"]?.cast.last)
        let played = coffee.played(by: lou)
        XCTAssertEqual(played.partner, "Lou")
        XCTAssertEqual(played.persona, "冷")
        XCTAssertEqual(played.id, coffee.id, "the same scenario, so progress and colours stay")
        XCTAssertEqual(coffee.partner, "Sam")
    }

    func testAnotherPersonIsNamedInTheSettingAndLines() {
        var meeting = scenario("meeting", partner: "Riley")
        meeting = PracticeScenario(id: meeting.id, title: "会上提出不同意见", subtitle: "s", category: "职场", symbol: "person.2",
            partner: "Riley", partnerRole: "产品经理", setting: "周一的例会上，Riley 提议直接全量上线。",
            steps: meeting.steps.map { PracticeStep(id: $0.id, goal: "g", prompt: "Riley here.", translation: "我是 Riley。", hint: "h",
                                                    keywords: "k", expression: "Thanks, Riley.", meaning: "谢谢 Riley。") },
            persona: "急")
        let played = meeting.played(by: PartnerCharacter(partner: "Brooke", label: "用数据压人", persona: "冷静但咄咄逼人"))
        XCTAssertEqual(played.setting, "周一的例会上，Brooke 提议直接全量上线。")
        XCTAssertEqual(played.steps[0].prompt, "Riley here.".replacingOccurrences(of: "Riley", with: "Brooke"))
        XCTAssertEqual(played.steps[0].meaning, "谢谢 Brooke。")
        XCTAssertEqual(meeting.played(by: PartnerCharacter(partner: "Riley", label: "急", persona: "急")), meeting)
    }

    func testOlderCatalogsWithoutExtrasStillDecode() throws {
        let step = #"{"id":"a","goal":"g","prompt":"p","translation":"t","hint":"h","keywords":"k","expression":"e","meaning":"m"}"#
        let data = Data(#"{"version":4,"scenarios":[{"id":"coffee","title":"t","subtitle":"s","category":"日常","symbol":"c","partner":"Sam","partnerRole":"r","setting":"x","steps":[\#(step),\#(step),\#(step)]}]}"#.utf8)
        let response = try JSONDecoder().decode(ScenarioCatalogResponse.self, from: data)
        XCTAssertEqual(response.validScenarios.map(\.id), ["coffee"])
        XCTAssertEqual(response.validExtras["coffee"], ScenarioExtras(id: "coffee"))
    }
}
