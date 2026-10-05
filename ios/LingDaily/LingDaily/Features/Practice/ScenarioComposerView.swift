import SwiftUI

/// Describe a real upcoming conversation; the server turns it into a three-step scenario saved on this device.
struct ScenarioComposerView: View {
    @EnvironmentObject private var store: PracticeStore
    @Environment(\.dismiss) private var dismiss
    @State private var description = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var task: Task<Void, Never>?
    @State private var examples = Self.starterExamples
    /// Every idea shown so far, so a new batch never repeats one.
    @State private var shownIdeas = Self.starterExamples
    @State private var refreshing = false
    @State private var refreshError: String?
    @FocusState private var focused: Bool
    let onCreated: (PracticeScenario) -> Void

    private static let starterExamples = [
        "周五要跟房东谈退押金，他说墙上有划痕要扣钱",
        "下周一第一次和海外客户开视频会，要做自我介绍",
        "在机场航班取消了，要去柜台改签到明天早上",
    ]
    private var trimmed: String { description.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("想练哪一场对话？").font(.title.bold()).foregroundColor(Brand.ink)
                        Text("说说对方是谁、什么时候、你想达成什么。会生成一个三步的专属场景。")
                            .font(.subheadline).foregroundColor(Brand.secondary).lineSpacing(3)
                    }
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $description)
                            .font(.body).foregroundColor(Brand.ink).focused($focused)
                            .frame(minHeight: 132).padding(12).clearEditorBackground()
                            .disabled(isLoading)
                            .accessibilityIdentifier("scenario-description")
                            .onChange(of: description) { description = String($0.prefix(300)) }
                        if description.isEmpty {
                            Text("比如：\(Self.starterExamples[0])").font(.body).foregroundColor(Brand.secondary)
                                .padding(.horizontal, 17).padding(.vertical, 20).allowsHitTesting(false)
                        }
                    }
                    .background(Brand.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Brand.line))
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("试试这些").font(.caption).foregroundColor(Brand.secondary)
                            Spacer()
                            Button(action: refreshIdeas) {
                                HStack(spacing: 4) {
                                    if refreshing { ProgressView().scaleEffect(0.7) }
                                    else { Image(systemName: "arrow.triangle.2.circlepath") }
                                    Text(refreshing ? "正在想…" : "换一批")
                                }
                            }
                            .font(.caption.weight(.medium)).foregroundColor(Brand.ink).frame(minHeight: 32)
                            .disabled(refreshing || isLoading)
                            .accessibilityIdentifier("refresh-ideas")
                        }
                        if let refreshError {
                            Text(refreshError).font(.caption).foregroundColor(Brand.secondary)
                        }
                        ForEach(examples, id: \.self) { example in
                            Button { description = example } label: {
                                Text(example).font(.subheadline).foregroundColor(Brand.ink)
                                    .multilineTextAlignment(.leading)
                                    .padding(.horizontal, 14).padding(.vertical, 10)
                                    .overlay(Capsule().stroke(Brand.line))
                            }.buttonStyle(.plain).disabled(isLoading)
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 64).padding(.bottom, 24)
                .readableColumn()
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.headline).foregroundColor(Brand.ink).frame(width: 44, height: 44)
            }.padding(.leading, 10).padding(.top, 8).accessibilityLabel("关闭")
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) {
                if let errorMessage {
                    Text(errorMessage).font(.footnote).foregroundColor(Brand.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(action: generate) {
                    HStack(spacing: 8) {
                        if isLoading { ProgressView().tint(Brand.onInk) }
                        Text(isLoading ? "正在布置场景…" : "生成场景")
                    }
                }
                .buttonStyle(SolidButtonStyle())
                .disabled(trimmed.isEmpty || isLoading)
                .accessibilityIdentifier("generate-scenario")
                Text("描述会发送给 Gemini 生成场景；场景会同步到你的账号。")
                    .font(.caption2).foregroundColor(Brand.secondary).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
            .readableColumn().background(Brand.page)
        }
        .interactiveDismissDisabled(isLoading)
        .onDisappear { task?.cancel() }
    }

    private func refreshIdeas() {
        guard !refreshing else { return }
        refreshing = true
        refreshError = nil
        let avoid = shownIdeas
        Task {
            defer { refreshing = false }
            do {
                let ideas = try await PracticeAPIClient().scenarioIdeas(avoiding: avoid)
                examples = ideas
                shownIdeas += ideas
            } catch {
                refreshError = error.localizedDescription
            }
        }
    }

    private func generate() {
        guard !trimmed.isEmpty, !isLoading else { return }
        focused = false
        errorMessage = nil
        isLoading = true
        let text = trimmed
        task = Task {
            do {
                let scenario = try await PracticeAPIClient().createScenario(from: text)
                guard !Task.isCancelled else { return }
                store.addScenario(scenario)
                onCreated(scenario)
                dismiss()
            } catch is CancellationError {
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }
}

private extension View {
    /// TextEditor draws an opaque system background; hide it so the card surface shows through.
    @ViewBuilder func clearEditorBackground() -> some View {
        if #available(iOS 16.0, *) { scrollContentBackground(.hidden) }
        else { onAppear { UITextView.appearance().backgroundColor = .clear } }
    }
}
