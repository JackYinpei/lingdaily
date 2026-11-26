import SwiftUI

struct APISettingsView: View {
    @EnvironmentObject private var aiSettings: AISettingsStore
    @Environment(\.practiceService) private var api
    @Environment(\.dismiss) private var dismiss

    @State private var draft = AISettings()
    @State private var editingProvider: AIProviderKind = .gemini
    @State private var revealsKey = false
    @State private var fetchedModels: [AIProviderKind: [String]] = [:]
    @State private var fetchingModels = false
    @State private var fetchError: String?
    @State private var fetchTask: Task<Void, Never>?
    @State private var loaded = false
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case apiKey, baseURL, textModel, liveModel
    }

    private var currentConfig: AIProviderConfiguration {
        draft.configuration(for: editingProvider)
    }

    private var availableModels: [String] {
        fetchedModels[editingProvider] ?? []
    }

    private var sortedVoiceModels: [String] {
        let keywords = ["live", "realtime", "audio"]
        return availableModels.sorted { lhs, rhs in
            let lMatch = keywords.contains { lhs.lowercased().contains($0) }
            let rMatch = keywords.contains { rhs.lowercased().contains($0) }
            if lMatch != rMatch { return lMatch }
            return false
        }
    }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("配置服务商").font(.headline).foregroundColor(Brand.ink)
                        Picker("配置服务商", selection: $editingProvider) {
                            ForEach(AIProviderKind.allCases) { provider in
                                Text(provider.title).tag(provider)
                            }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("api-provider-Segment")
                    }

                    providerConfigurationCard

                    activeProvidersCard

                    Text("密钥仅加密保存在本机（登录账号后会加密同步到你的个人账号），对话直连你配置的模型接口。")
                        .font(.caption)
                        .foregroundColor(Brand.secondary)
                        .lineSpacing(3)
                        .padding(.horizontal, 4)
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 28)
                .readableColumn()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                Button("保存设置") {
                    focusedField = nil
                    saveIfChanged()
                    dismiss()
                }
                .buttonStyle(SolidButtonStyle())
                .accessibilityIdentifier("save-api-settings")
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .readableColumn()
            .background(Brand.page)
        }
        .navigationBack(title: "接口设置", onReturn: saveIfChanged) {
            focusedField = nil
            saveIfChanged()
            dismiss()
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            draft = aiSettings.settings
            if !draft.gemini.hasAnyValue && draft.openai.hasAnyValue {
                editingProvider = .openai
            } else {
                editingProvider = draft.textProvider
            }
        }
        .onChange(of: editingProvider) { _ in
            revealsKey = false
            fetchError = nil
        }
        .onDisappear {
            fetchTask?.cancel()
        }
    }

    private var providerConfigurationCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("API Key").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Spacer()
                    if !currentConfig.apiKey.isEmpty {
                        Button("清空") {
                            updateCurrent { $0.apiKey = "" }
                        }
                        .font(.caption)
                        .foregroundColor(Brand.secondary)
                        .padding(.trailing, 8)
                    }
                    Button(revealsKey ? "隐藏" : "显示") {
                        revealsKey.toggle()
                    }
                    .font(.caption.weight(.medium))
                    .foregroundColor(Brand.accent)
                }
                Group {
                    if revealsKey {
                        TextField("粘贴 \(editingProvider.title) API Key", text: binding(\.apiKey, limit: 512))
                    } else {
                        SecureField("粘贴 \(editingProvider.title) API Key", text: binding(\.apiKey, limit: 512))
                    }
                }
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .focused($focusedField, equals: .apiKey)
                .inputSurface()
                .accessibilityIdentifier("api-key-field")
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("接口地址").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Text("可选").font(.caption).foregroundColor(Brand.secondary)
                    Spacer()
                    if !currentConfig.baseURL.isEmpty {
                        Button("清空") { updateCurrent { $0.baseURL = "" } }
                            .font(.caption).foregroundColor(Brand.secondary)
                    }
                }
                TextField("留空使用官方地址，可填自定义反代", text: binding(\.baseURL, limit: 512))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .focused($focusedField, equals: .baseURL)
                    .inputSurface()
                    .accessibilityIdentifier("api-base-url-field")
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("文字模型").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Spacer()
                    if !availableModels.isEmpty {
                        modelPickerMenu(models: availableModels) { chosen in
                            updateCurrent { $0.textModel = chosen }
                        }
                    }
                }
                TextField(editingProvider == .gemini ? "例：gemini-2.5-flash" : "例：gpt-4o-mini",
                          text: binding(\.textModel, limit: 120))
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .focused($focusedField, equals: .textModel)
                    .inputSurface()
                    .accessibilityIdentifier("api-text-model-field")
                Text("用于逐句练习、生成场景、单句翻译与复盘建议。")
                    .font(.caption2).foregroundColor(Brand.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("实时语音模型").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Spacer()
                    if !sortedVoiceModels.isEmpty {
                        modelPickerMenu(models: sortedVoiceModels) { chosen in
                            updateCurrent { $0.liveModel = chosen }
                        }
                    }
                }
                TextField(editingProvider == .gemini ? "例：gemini-2.5-flash-native-audio-latest" : "例：gpt-4o-realtime-preview",
                          text: binding(\.liveModel, limit: 120))
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .focused($focusedField, equals: .liveModel)
                    .inputSurface()
                    .accessibilityIdentifier("api-live-model-field")
                Text("用于双向实时语音通话（WebSocket 直连）。")
                    .font(.caption2).foregroundColor(Brand.secondary)
            }

            Brand.line.frame(height: 1)

            VStack(alignment: .leading, spacing: 8) {
                Button(action: fetchModels) {
                    HStack(spacing: 8) {
                        if fetchingModels {
                            ProgressView().scaleEffect(0.85)
                        } else {
                            Image(systemName: "arrow.down.circle")
                        }
                        Text(fetchingModels ? "正在拉取模型列表…" : "从接口拉取模型列表")
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(Brand.ink)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .overlay(Capsule().stroke(Brand.line, lineWidth: 1.5))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(currentConfig.trimmed.apiKey.isEmpty || fetchingModels)
                .opacity(currentConfig.trimmed.apiKey.isEmpty ? 0.4 : 1)
                .accessibilityIdentifier("fetch-models-button")

                if let fetchError {
                    Text(fetchError).font(.caption).foregroundColor(Brand.accent).lineSpacing(2)
                } else if !availableModels.isEmpty {
                    Text("已获取 \(availableModels.count) 个模型，可点上方「从列表选择」快速填入，也可直接手动输入。")
                        .font(.caption).foregroundColor(Brand.secondary).lineSpacing(2)
                }
            }
        }
        .surfaceCard()
    }

    private var activeProvidersCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("当前启用服务商").font(.headline).foregroundColor(Brand.ink)
            VStack(alignment: .leading, spacing: 8) {
                Text("文字对话服务商").font(.subheadline).foregroundColor(Brand.ink)
                Picker("文字对话服务商", selection: $draft.textProvider) {
                    ForEach(AIProviderKind.allCases) { provider in
                        Text(provider.title).tag(provider)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("active-text-provider")
            }
            Brand.line.frame(height: 1)
            VStack(alignment: .leading, spacing: 8) {
                Text("语音通话服务商").font(.subheadline).foregroundColor(Brand.ink)
                Picker("语音通话服务商", selection: $draft.voiceProvider) {
                    ForEach(AIProviderKind.allCases) { provider in
                        Text(provider.title).tag(provider)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("active-voice-provider")
            }
        }
        .surfaceCard()
    }

    private func modelPickerMenu(models: [String], onSelect: @escaping (String) -> Void) -> some View {
        Menu {
            ForEach(models, id: \.self) { modelID in
                Button(modelID) { onSelect(modelID) }
            }
        } label: {
            HStack(spacing: 4) {
                Text("从列表选择")
                Image(systemName: "chevron.up.chevron.down").font(.caption2)
            }
            .font(.caption.weight(.medium))
            .foregroundColor(Brand.accent)
        }
    }

    private func binding(_ keyPath: WritableKeyPath<AIProviderConfiguration, String>, limit: Int) -> Binding<String> {
        Binding(
            get: { draft.configuration(for: editingProvider)[keyPath: keyPath] },
            set: { newValue in
                let clipped = String(newValue.prefix(limit))
                updateCurrent { $0[keyPath: keyPath] = clipped }
            }
        )
    }

    private func updateCurrent(_ mutate: (inout AIProviderConfiguration) -> Void) {
        var config = draft.configuration(for: editingProvider)
        mutate(&config)
        draft.setConfiguration(config, for: editingProvider)
    }

    private func fetchModels() {
        let provider = editingProvider
        let config = draft.configuration(for: provider).trimmed
        guard !config.apiKey.isEmpty, !fetchingModels else { return }
        focusedField = nil
        fetchingModels = true
        fetchError = nil
        fetchTask?.cancel()
        fetchTask = Task {
            defer { fetchingModels = false }
            do {
                let list = try await api.fetchAvailableModels(provider: provider, apiKey: config.apiKey, baseURL: config.baseURL)
                guard !Task.isCancelled else { return }
                fetchedModels[provider] = list
            } catch is CancellationError {
            } catch {
                guard !Task.isCancelled else { return }
                fetchError = error.localizedDescription
            }
        }
    }

    private func saveIfChanged() {
        var next = draft.sanitized()
        // If only one provider has a complete text/voice setup, align the active selector to it.
        if !next.configuration(for: next.textProvider).hasTextConfiguration {
            let other: AIProviderKind = next.textProvider == .gemini ? .openai : .gemini
            if next.configuration(for: other).hasTextConfiguration {
                next.textProvider = other
            }
        }
        if !next.configuration(for: next.voiceProvider).hasVoiceConfiguration {
            let other: AIProviderKind = next.voiceProvider == .gemini ? .openai : .gemini
            if next.configuration(for: other).hasVoiceConfiguration {
                next.voiceProvider = other
            }
        }
        guard !next.hasSameContent(as: aiSettings.settings) else { return }
        aiSettings.update(next)
    }
}

private extension View {
    func inputSurface() -> some View {
        self.font(.subheadline)
            .foregroundColor(Brand.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 46)
            .background(Brand.page)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Brand.line, lineWidth: 1))
    }
}
