import Foundation
import Security

/// The server-issued iOS session after Sign in with Apple. Only the token is a
/// credential; email is kept to show which account is signed in.
struct AccountSession: Codable, Equatable {
    let token: String
    let expiresAt: Date
    let email: String
    let isPrivateEmail: Bool
    /// Apple's stable user identifier, used only on device to check revocation.
    let appleUserID: String

    func isUsable(now: Date = Date()) -> Bool {
        !token.isEmpty && token.count <= 4096 && !token.contains(where: \.isWhitespace) && expiresAt > now
    }

    var displayEmail: String { isPrivateEmail ? "Apple 隐藏邮箱" : email }
}

extension Notification.Name {
    /// Posted (on any thread) when the server rejects the stored session.
    static let accountSessionRejected = Notification.Name("LingDaily.accountSessionRejected")
}

/// This-device-only Keychain item: not synced to iCloud Keychain or restored to another phone.
enum AccountKeychain {
    private static let service = "com.qcy.LingDaily.account"
    private static let account = "session"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func load() -> AccountSession? {
        var item: CFTypeRef?
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(AccountSession.self, from: data)
    }

    @discardableResult
    static func save(_ session: AccountSession) -> Bool {
        guard let data = try? JSONEncoder().encode(session) else { return false }
        delete()
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func delete() { SecItemDelete(query as CFDictionary) }
}
