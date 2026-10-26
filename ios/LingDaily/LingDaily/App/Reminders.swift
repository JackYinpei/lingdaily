import Combine
import Foundation
import UIKit
import UserNotifications

/// Opt-in local reminders: one before a real conversation the learner told us about, and
/// an optional daily nudge that skips days already practised. Nothing is sent to a server.
@MainActor
final class ReminderCenter: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderCenter()
    static let dailyEnabledKey = "dailyReminderEnabled"
    static let dailyHourKey = "dailyReminderHour"
    static let dailyMinuteKey = "dailyReminderMinute"
    private static let eventsKey = "scenarioEventDates"
    private static let dailyPrefix = "daily-"

    /// A reminder for this scenario was tapped; the practice page opens it.
    @Published var pendingScenarioID: String?
    /// Custom scenario id → day of the real conversation (yyyy-MM-dd).
    @Published private(set) var eventDays: [String: String] = UserDefaults.standard.dictionary(forKey: eventsKey) as? [String: String] ?? [:]
    private let center = UNUserNotificationCenter.current()

    func install() { center.delegate = self }

    /// Asks only when the learner turns a reminder on.
    func requestPermission() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    }

    // MARK: Before a real conversation

    func eventDay(for scenarioID: String) -> Date? { eventDays[scenarioID].flatMap(Self.dayFormatter.date) }

    func scheduleEvent(for scenario: PracticeScenario, on day: Date) {
        cancelEvent(for: scenario.id)
        eventDays[scenario.id] = Self.dayFormatter.string(from: day)
        saveEvents()
        for event in ReminderPlan.event(on: day) {
            let content = UNMutableNotificationContent()
            content.title = event.isSameDay
                ? "今天就要和 \(scenario.partner) 聊「\(scenario.title)」"
                : "明天要和 \(scenario.partner) 聊「\(scenario.title)」"
            content.body = event.isSameDay ? "出门前再过一遍那三句话？" : "睡前再过一遍那三句话？"
            content.sound = .default
            content.userInfo = ["scenarioID": scenario.id]
            add(id: "event-\(scenario.id)-\(event.isSameDay ? "day" : "eve")", content: content, at: event.date)
        }
    }

    func cancelEvent(for scenarioID: String) {
        center.removePendingNotificationRequests(withIdentifiers: ["event-\(scenarioID)-day", "event-\(scenarioID)-eve"])
        guard eventDays.removeValue(forKey: scenarioID) != nil else { return }
        saveEvents()
    }

    // MARK: Daily

    /// Re-plans the next seven days. Called on return to the app and after practising.
    func rescheduleDaily(practicedToday: Bool) {
        let defaults = UserDefaults.standard
        let hour = defaults.object(forKey: Self.dailyHourKey) as? Int ?? 21
        let minute = defaults.object(forKey: Self.dailyMinuteKey) as? Int ?? 0
        let dates = defaults.bool(forKey: Self.dailyEnabledKey)
            ? ReminderPlan.daily(hour: hour, minute: minute, practicedToday: practicedToday) : []
        let prefix = Self.dailyPrefix
        let wanted = Dictionary(dates.map { (prefix + Self.dayFormatter.string(from: $0), $0) }) { first, _ in first }
        // Same identifiers replace their old trigger, so only days no longer wanted are removed.
        center.getPendingNotificationRequests { requests in
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: requests.map(\.identifier)
                .filter { $0.hasPrefix(prefix) && wanted[$0] == nil })
        }
        for (id, date) in wanted {
            let content = UNMutableNotificationContent()
            content.title = "今天想练哪一场对话？"
            content.body = "五分钟就够，开口说几句。"
            content.sound = .default
            add(id: id, content: content, at: date)
        }
    }

    /// Sign-out or account deletion: this account's reminders leave the device with its data.
    func clearAll() {
        center.removeAllPendingNotificationRequests()
        eventDays = [:]
        saveEvents()
        UserDefaults.standard.set(false, forKey: Self.dailyEnabledKey)
    }

    private func add(id: String, content: UNNotificationContent, at date: Date) {
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        center.add(UNNotificationRequest(identifier: id, content: content,
                                         trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
    }

    private func saveEvents() { UserDefaults.standard.set(eventDays, forKey: Self.eventsKey) }

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    // MARK: UNUserNotificationCenterDelegate

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let scenarioID = response.notification.request.content.userInfo["scenarioID"] as? String
        Task { @MainActor in
            // Never jump away from a page the learner is on (a call may be mid-sentence).
            if let scenarioID, Self.navigationIsAtRoot() { self.pendingScenarioID = scenarioID }
            completionHandler()
        }
    }

    /// True when nothing is pushed over the tabs or presented on top.
    static func navigationIsAtRoot() -> Bool {
        let root = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first { $0.isKeyWindow }?.rootViewController
        guard root?.presentedViewController == nil else { return false }
        func navigation(in controller: UIViewController?) -> UINavigationController? {
            guard let controller else { return nil }
            if let navigation = controller as? UINavigationController { return navigation }
            return controller.children.lazy.compactMap { navigation(in: $0) }.first
        }
        return (navigation(in: root)?.viewControllers.count ?? 1) <= 1
    }
}
