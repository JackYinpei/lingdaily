import AuthenticationServices
import Combine
import CryptoKit
import SwiftUI

/// Signed-in state for the production service. The session token lives in the
/// Keychain; practice data syncs to this account through `SyncEngine`.
@MainActor
final class AccountStore: ObservableObject {
    @Published private(set) var session: AccountSession?
    @Published private(set) var isSigningIn = false
    @Published var errorMessage: String?
    /// Debug builds paired with `npm run ios:dev` need no account.
    let usesLocalDevelopment = AIConnectionConfiguration.bundled() != nil
    private var pendingNonce: String?
    private var rejected: NSObjectProtocol?

    init() {
        session = AccountKeychain.load().flatMap { $0.isUsable() ? $0 : nil }
        rejected = NotificationCenter.default.addObserver(forName: .accountSessionRejected, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.session = nil }
        }
        verifyAppleCredential()
    }

    deinit { if let rejected { NotificationCenter.default.removeObserver(rejected) } }

    var canPractice: Bool { usesLocalDevelopment || session != nil }

    /// Configures the Apple request with a fresh single-use nonce.
    func prepare(_ request: ASAuthorizationAppleIDRequest) {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return }
        let nonce = bytes.map { String(format: "%02x", $0) }.joined()
        pendingNonce = nonce
        errorMessage = nil
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func complete(_ result: Result<ASAuthorization, Error>) {
        let nonce = pendingNonce
        pendingNonce = nil
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code != .canceled { errorMessage = "Apple 登录没有完成，请重试。" }
        case .success(let authorization):
            guard let nonce, let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken, let identityToken = String(data: tokenData, encoding: .utf8) else {
                errorMessage = "Apple 登录没有返回凭证，请重试。"
                return
            }
            let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
            isSigningIn = true
            Task {
                defer { isSigningIn = false }
                do {
                    let response = try await PracticeAPIClient(configuration: nil).signIn(AccountSignInRequest(
                        identityToken: identityToken, nonce: nonce,
                        fullName: name.flatMap { $0.isEmpty ? nil : String($0.prefix(100)) }))
                    guard let session = response.session(appleUserID: credential.user), AccountKeychain.save(session) else {
                        errorMessage = "登录信息保存失败，请重试。"
                        return
                    }
                    self.session = session
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    func signOut() {
        AccountKeychain.delete()
        session = nil
    }

    /// Permanently deletes the account after a fresh Apple confirmation of the same Apple ID.
    func confirmDeletion(_ result: Result<ASAuthorization, Error>) async throws {
        let nonce = pendingNonce
        pendingNonce = nil
        let authorization: ASAuthorization
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code == .canceled { throw CancellationError() }
            throw PracticeNetworkError.server("Apple 确认没有完成，请重试。")
        case .success(let value): authorization = value
        }
        guard let nonce, let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken, let identityToken = String(data: tokenData, encoding: .utf8) else {
            throw PracticeNetworkError.server("Apple 确认没有返回凭证，请重试。")
        }
        let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        try await PracticeAPIClient(configuration: nil).deleteAccount(
            AccountDeletionRequest(identityToken: identityToken, nonce: nonce, authorizationCode: code))
        signOut()
    }

    /// Signs out locally if the user revoked LingDaily in Apple ID settings.
    func verifyAppleCredential() {
        guard let appleUserID = session?.appleUserID else { return }
        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: appleUserID) { [weak self] state, _ in
            guard state == .revoked || state == .notFound, let self else { return }
            Task { @MainActor in self.signOut() }
        }
    }
}

/// The one account entry point, shared by the practice home and the profile page.
struct AppleSignInButton: View {
    @EnvironmentObject private var account: AccountStore
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 10) {
            SignInWithAppleButton(.signIn) { account.prepare($0) } onCompletion: { account.complete($0) }
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(height: 50).clipShape(Capsule())
                .disabled(account.isSigningIn)
                .opacity(account.isSigningIn ? 0.6 : 1)
                .accessibilityIdentifier("sign-in-apple")
            if let message = account.errorMessage {
                Text(message).font(.caption).foregroundColor(Brand.accent).multilineTextAlignment(.center)
            }
        }
    }
}
