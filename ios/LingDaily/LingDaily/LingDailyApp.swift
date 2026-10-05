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
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("appearance") private var appearance = "system"

    init() {
        let store = PracticeStore()
        let account = AccountStore()
        _store = StateObject(wrappedValue: store)
        _account = StateObject(wrappedValue: account)
        _sync = StateObject(wrappedValue: SyncEngine(store: store, account: account))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(account)
                .environmentObject(sync)
                .preferredColorScheme(appearance == "system" ? nil : (appearance == "dark" ? .dark : .light))
        }
        .onChange(of: scenePhase) { phase in
            // Pick up changes made on the web or another device when returning to the app.
            if phase == .active { Task { await sync.syncNow() } }
        }
    }
}
