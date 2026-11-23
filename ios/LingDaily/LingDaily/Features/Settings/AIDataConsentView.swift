import SwiftUI

struct AIDataConsentView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    PageTitle(title: "开始前，了解数据去向")
                    Text("允许后，你输入的文字、练习内容和语音通话的麦克风音频会发送给 AI 服务，用于生成回复、转录、翻译和纠错。")
                    Text("我们不保存通话录音；练习记录、词库和自建场景会同步到你的账号。请勿输入敏感信息。")
                    Text("可在「我的 → AI 数据使用」撤回，撤回后 AI 练习不可用。").foregroundColor(Brand.secondary)
                    Link("阅读隐私政策", destination: LingDailyService.baseURL.appendingPathComponent("privacy"))
                        .foregroundColor(Brand.accent).frame(minHeight: 44)
                    Button("允许并继续") {
                        AIDataConsent.grant()
                        dismiss()
                    }
                    .buttonStyle(SolidButtonStyle())
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
