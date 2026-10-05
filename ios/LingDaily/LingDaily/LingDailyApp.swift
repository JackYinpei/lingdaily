//
//  LingDailyApp.swift
//  LingDaily
//
//  Created by qcy on 2026/9/29.
//

import SwiftUI

@main
struct LingDailyApp: App {
    @StateObject private var store = PracticeStore()
    @StateObject private var account = AccountStore()
    @AppStorage("appearance") private var appearance = "system"

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(account)
                .preferredColorScheme(appearance == "system" ? nil : (appearance == "dark" ? .dark : .light))
        }
    }
}
