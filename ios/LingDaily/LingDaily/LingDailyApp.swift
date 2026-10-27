//
//  LingDailyApp.swift
//  LingDaily
//
//  Created by qcy on 2026/9/29.
//

import SwiftUI

@main
struct LingDailyApp: App {
    @StateObject private var store: PracticeStore
    @StateObject private var account: AccountStore
    @StateObject private var sync: SyncEngine
    @StateObject private var catalog = ScenarioCatalogStore()
    @StateObject private var today = TodayStore()
    @StateObject private var reminders = ReminderCenter.shared
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("appearance") private var appearance = "system"

    init() {
        let store = PracticeStore()
        let account = AccountStore()
        _store = StateObject(wrappedValue: store)
        _account = StateObject(wrappedValue: account)
        _sync = StateObject(wrappedValue: SyncEngine(store: store, account: account))
        // Before launch finishes, so a reminder that opened the app is still delivered.
        ReminderCenter.shared.install()
        TabBarStyle.apply()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(account)
                .environmentObject(sync)
                .environmentObject(catalog)
                .environmentObject(today)
                .environmentObject(reminders)
                .preferredColorScheme(appearance == "system" ? nil : (appearance == "dark" ? .dark : .light))
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            // Pick up changes made on the web or another device when returning to the app.
            Task { await sync.syncNow() }
            Task { await catalog.refresh() }
            if account.canPractice { Task { await today.refresh() } }
            reminders.rescheduleDaily(practicedToday: PracticeStats.spokeToday(store.archive.sessions))
        }
    }
}
