import SwiftUI

struct AIDataConsentView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var confirmedAdult = false

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    PageTitle(title: "开始前，了解数据去向")
                    Text("对话由 Google Gemini 生成。允许后，你输入的文字、场景描述、练习目标、相关对话上下文，以及语音通话中的麦克风音频，会发送给 Google，用于生成回复、转录、翻译、建议和纠错。")
                    Text("文字请求经过 LingDaily 服务；实时音频可能经过我们管理的东京中转。LingDaily 不保存原始通话录音；文字记录、词库和自建场景保存在本机并同步到 Supabase。Google 对数据的处理遵循其服务条款和隐私政策。请勿输入敏感信息。")
                    Text("你可以在「我的 → AI 数据使用」撤回。拒绝或撤回后仍可查看已有记录，AI 练习将不可用。麦克风和听写权限会单独询问。")
                    Link("阅读隐私政策", destination: LingDailyService.baseURL.appendingPathComponent("privacy"))
                        .foregroundColor(Brand.accent).frame(minHeight: 44)
                    Toggle("我已年满 18 周岁", isOn: $confirmedAdult)
                        .tint(Brand.accent)
                        .accessibilityIdentifier("confirm-adult")
                    Button("允许并继续") {
                        AIDataConsent.grant()
                        dismiss()
                    }
                    .buttonStyle(SolidButtonStyle())
                    .disabled(!confirmedAdult)
                    .accessibilityIdentifier("allow-ai-data")
                    Button("暂不使用 AI") { dismiss() }
                        .buttonStyle(SolidButtonStyle(secondary: true))
                        .accessibilityIdentifier("decline-ai-data")
                }
                .font(.subheadline).foregroundColor(Brand.ink).lineSpacing(5)
                .padding(24).readableColumn()
            }
        }
        .interactiveDismissDisabled()
    }
}
