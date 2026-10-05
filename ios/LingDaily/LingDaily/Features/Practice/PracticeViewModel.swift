import Foundation
import Combine

@MainActor
final class PracticeViewModel: ObservableObject {
    @Published private(set) var session: PracticeSession
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    private let api: any PracticeServing
    private var task: Task<Void, Never>?
    private var generation = UUID()

    init(session: PracticeSession, api: any PracticeServing = PracticeAPIClient()) {
        self.session = session
        self.api = api
    }

    func send(_ text: String, store: PracticeStore) -> Bool {
        guard session.submit(text) else { return false }
        store.save(session)
        requestPending(store: store)
        return true
    }

    func beginRetry(store: PracticeStore) { session.beginRetry(); store.save(session) }
    func cancelRetry(store: PracticeStore) { session.cancelRetry(); store.save(session) }
    func advance(store: PracticeStore) {
        session.advance()
        store.save(session)
        requestPending(store: store)
    }

    func requestPending(store: PracticeStore) {
        guard !isLoading, let request = session.pendingAIRequest else { return }
        errorMessage = nil
        isLoading = true
        let current = UUID()
        generation = current
        task = Task { [weak self, api] in
            do {
                let response = try await api.respond(to: request)
                guard let self, !Task.isCancelled, self.generation == current else { return }
                guard self.session.applyAIResponse(response) else { throw PracticeNetworkError.invalidReply }
                store.save(self.session, collecting: response.data.feedback?.items ?? [])
                self.isLoading = false
            } catch {
                guard let self, !Task.isCancelled, self.generation == current else { return }
                self.isLoading = false
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func enterLive() { pause(); session.beginLive() }
    func enterText(store: PracticeStore) { session.prepareText(); requestPending(store: store) }
    func updateLive(_ changed: PracticeSession) { session = changed }

    func pause() {
        generation = UUID()
        task?.cancel()
        task = nil
        isLoading = false
        if session.pendingAIRequest != nil { errorMessage = "AI 请求已暂停，点击重试继续。已发送的回答会保留。" }
    }
}
