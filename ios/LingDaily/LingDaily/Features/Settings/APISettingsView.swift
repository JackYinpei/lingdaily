import SwiftUI

/// BYOK provider configuration: the provider used for both text and voice, its API key, an
/// optional base URL and the models (prefilled with the newest ones). Nothing applies until 保存.
struct APISettingsView: View {
    @EnvironmentObject private var aiSettings: AISettingsStore
    @Environment(\.dismiss) private var dismiss

    @State private var draft = AISettings()
    @State private var revealsKey = false
    @State private var loaded = false
    @State private var confirmsLeaving = false
    @State private var savedMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case apiKey, baseURL, textModel, liveModel
    }

    /// What 保存 stores: trimmed fields, default models in empty slots, one provider for text and voice.
    private static func forSaving(_ settings: AISettings) -> AISettings {
        var next = settings.sanitized().withDefaultModels()
        next.voiceProvider = next.textProvider
        return next
    }

    private var provider: AIProviderKind { draft.provider }

    private var currentConfig: AIProviderConfiguration {
        draft.configuration(for: provider)
    }

    private var isDirty: Bool {
        loaded && !Self.forSaving(draft).hasSameContent(as: Self.forSaving(aiSettings.settings))
    }

    private var providerSelection: Binding<AIProviderKind> {
        Binding(get: { draft.textProvider }, set: { chosen in
            draft.textProvider = chosen
            draft.voiceProvider = chosen
            revealsKey = false
        })
    }

    var body: some View {
        ZStack(alignment: .top) {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("使用的服务商").font(.headline).foregroundColor(Brand.ink)
                        Picker("使用的服务商", selection: providerSelection) {
                            ForEach(AIProviderKind.allCases) { provider in
                                Text(provider.title).tag(provider)
                            }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("api-provider-Segment")
                        Text("文字对话和语音通话都使用这里选中的服务商。")
                            .font(.caption).foregroundColor(Brand.secondary)
                    }

                    providerConfigurationCard

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
            if let savedMessage {
                Label(savedMessage, systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(Brand.onInk)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Brand.ink))
                    .padding(.top, 12)
                    .padding(.horizontal, 20)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .accessibilityIdentifier("api-settings-saved")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                Button("保存") { save() }
                    .buttonStyle(SolidButtonStyle())
                    .disabled(savedMessage != nil)
                    .accessibilityIdentifier("save-api-settings")
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .readableColumn()
            .background(Brand.page)
        }
        .navigationBack(title: "接口设置", requiresConfirmation: isDirty) {
            focusedField = nil
            if isDirty { confirmsLeaving = true } else { dismiss() }
        }
        .alert("保存修改？", isPresented: $confirmsLeaving) {
            Button("保存") { save() }
            Button("不保存", role: .destructive) { dismiss() }
            Button("继续编辑", role: .cancel) {}
        } message: {
            Text("接口设置有未保存的修改。")
        }
        .onAppear {
            guard !loaded else { return }
            draft = Self.forSaving(aiSettings.settings)
            loaded = true
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
                        TextField("粘贴 \(provider.title) API Key", text: binding(\.apiKey, limit: 512))
                    } else {
                        SecureField("粘贴 \(provider.title) API Key", text: binding(\.apiKey, limit: 512))
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
                TextField("留空走默认的东京中转，也可填自己的地址", text: binding(\.baseURL, limit: 512))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .focused($focusedField, equals: .baseURL)
                    .inputSurface()
                    .accessibilityIdentifier("api-base-url-field")
            }

            Brand.line.frame(height: 1)

            modelField(title: "文字模型", keyPath: \.textModel, defaultModel: provider.defaultTextModel,
                       note: "用于文字练习、复盘、生成场景和翻译。", field: .textModel, identifier: "api-text-model-field")

            modelField(title: "实时语音模型", keyPath: \.liveModel, defaultModel: provider.defaultLiveModel,
                       note: "用于语音通话。", field: .liveModel, identifier: "api-live-model-field")
        }
        .surfaceCard()
    }

    private func modelField(title: String, keyPath: WritableKeyPath<AIProviderConfiguration, String>, defaultModel: String,
                            note: String, field: Field, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                Spacer()
                if currentConfig[keyPath: keyPath].trimmingCharacters(in: .whitespacesAndNewlines) != defaultModel {
                    Button("恢复默认") { updateCurrent { $0[keyPath: keyPath] = defaultModel } }
                        .font(.caption.weight(.medium))
                        .foregroundColor(Brand.accent)
                }
            }
            TextField(defaultModel, text: binding(keyPath, limit: 120))
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .focused($focusedField, equals: field)
                .inputSurface()
                .accessibilityIdentifier(identifier)
            Text("\(note)默认 \(defaultModel)（目前最新），一般不用改。")
                .font(.caption2).foregroundColor(Brand.secondary)
        }
    }

    private func binding(_ keyPath: WritableKeyPath<AIProviderConfiguration, String>, limit: Int) -> Binding<String> {
        Binding(
            get: { draft.configuration(for: provider)[keyPath: keyPath] },
            set: { newValue in
                let clipped = String(newValue.prefix(limit))
                updateCurrent { $0[keyPath: keyPath] = clipped }
            }
        )
    }

    private func updateCurrent(_ mutate: (inout AIProviderConfiguration) -> Void) {
        var config = draft.configuration(for: provider)
        mutate(&config)
        draft.setConfiguration(config, for: provider)
    }

    private func save() {
        focusedField = nil
        let next = Self.forSaving(draft)
        if !next.hasSameContent(as: Self.forSaving(aiSettings.settings)) {
            aiSettings.update(next)
        }
        draft = next
        withAnimation(.easeOut(duration: 0.2)) {
            savedMessage = next.configuration(for: next.provider).apiKey.isEmpty
                ? "已保存。填写 API Key 后才能使用 AI 功能"
                : "已保存，文字对话和语音通话都使用 \(next.provider.title)"
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { dismiss() }
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
