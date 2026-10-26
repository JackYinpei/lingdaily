import Foundation

/// When the opt-in local reminders fire. Pure date math; scheduling lives in the app.
enum ReminderPlan {
    struct Event: Equatable {
        let date: Date
        /// true for the morning of the real conversation, false for the evening before.
        let isSameDay: Bool
    }

    /// The evening before (20:00) and the morning of (08:00) a real conversation, skipping times already past.
    static func event(on day: Date, now: Date = Date(), calendar: Calendar = .current) -> [Event] {
        let start = calendar.startOfDay(for: day)
        let times: [(Date?, Bool)] = [
            (calendar.date(byAdding: .day, value: -1, to: start).flatMap { calendar.date(bySettingHour: 20, minute: 0, second: 0, of: $0) }, false),
            (calendar.date(bySettingHour: 8, minute: 0, second: 0, of: start), true),
        ]
        return times.compactMap { date, sameDay in date.flatMap { $0 > now ? Event(date: $0, isSameDay: sameDay) : nil } }
    }

    /// Daily reminders for the next `days` days at the chosen time. Today is skipped once the
    /// learner has practised, so the reminder never nags someone who already showed up.
    static func daily(hour: Int, minute: Int, practicedToday: Bool, days: Int = 7, now: Date = Date(),
                      calendar: Calendar = .current) -> [Date] {
        let today = calendar.startOfDay(for: now)
        return (0..<days).compactMap { offset in
            guard offset > 0 || !practicedToday,
                  let day = calendar.date(byAdding: .day, value: offset, to: today),
                  let date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day), date > now else { return nil }
            return date
        }
    }
}
