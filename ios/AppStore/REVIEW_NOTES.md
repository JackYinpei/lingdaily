# App Review notes (2.0)

Paste the English block into App Store Connect → App Review Information → Notes (limit 4000
characters). Replace `<TEST KEY>` with a dedicated, quota-limited Gemini key before submitting,
and revoke it after review. Never commit a real key here.

## English (paste this)

LingDaily 2.0 is an English speaking-practice tool. The app does not provide or host any AI model and ships with no API key ("bring your own key"). Learners enter their own Google Gemini and/or OpenAI API key, and every AI request goes directly from the device to that provider. No AI request passes through our server.

No sign-in is required.
- Without a key you can browse all 25 built-in practice scenarios (练习 tab), listen to the daily bilingual news podcast (播客 tab), and use history, vocabulary (学习 tab) and reminders.
- The AI features (text role-play, real-time voice call, sentence review, creating a scenario, translations and hints) work only after a key is entered. Until then their buttons open the API settings page.

To test the AI features with the key we provide for App Review (limited quota):
1. Open 我的 (Me) → 接口设置 (API settings).
2. Select "Google Gemini". Paste the key into "API Key". Leave 接口地址 (base URL) empty to use Google's official endpoint.
3. 文字模型 (text model): gemini-3.1-flash-lite
   实时语音模型 (real-time voice model): gemini-3.1-flash-live-preview
   (Or tap 从接口拉取模型列表 to choose from the list.)
4. Tap 保存设置 (Save).
5. Go to 练习, open any scenario (for example 航班取消了 "Flight cancelled") and tap 文字对话 (text chat) or 语音通话 (voice call). The voice call asks for microphone permission; then speak English with the role-play partner.

Test Gemini API key: <TEST KEY>

Sign in with Apple (我的) is optional and is used only to sync practice records, vocabulary, own scenarios and the API settings across the user's devices. API settings are stored on the device in the Keychain and, when signed in, encrypted on our server. Account deletion: 我的 → 账号与数据 → 删除账号.

The microphone is used only for dictation and the voice call. Voice audio is sent to the provider the user configured and is not stored by us.

Privacy policy: https://lingdaily.yasobi.xyz/privacy

## 中文（自己核对用）

LingDaily 2.0 是英语口语练习工具。App 不提供、也不托管任何 AI 模型，不内置 API Key（自带接口）。用户填入自己的 Google Gemini 和/或 OpenAI API Key 后，所有 AI 请求都由设备直接发给该服务商，不经过我们的服务器。

无需登录。
- 不填 Key 也可以浏览全部 25 个内置场景（练习），收听每日双语新闻播客（播客），使用历史、词库（学习）和提醒。
- AI 功能（文字角色扮演、实时语音通话、逐句复盘、新建场景、翻译与提示）只有填入 Key 后才能用，之前这些按钮会打开接口设置页。

用审核专用 Key（有额度限制）体验 AI 功能：
1. 打开「我的 → 接口设置」。
2. 选「Google Gemini」，把 Key 粘贴到「API Key」，接口地址留空（直连 Google 官方）。
3. 文字模型：gemini-3.1-flash-lite；实时语音模型：gemini-3.1-flash-live-preview（也可点「从接口拉取模型列表」选择）。
4. 点「保存设置」。
5. 回到「练习」，打开任一场景（如「航班取消了」），点「文字对话」或「语音通话」。语音通话会请求麦克风权限，之后用英语和对方对话。

审核用 Gemini Key：<TEST KEY>

「我的」里的 Apple 登录是可选的，只用于在用户自己的设备间同步练习记录、词库、自建场景和接口设置；接口设置保存在本机 Keychain，登录后在我们的服务器上加密保存。删除账号：我的 → 账号与数据 → 删除账号。

麦克风只用于听写和语音通话，语音发给用户配置的服务商，我们不保存。

隐私政策：https://lingdaily.yasobi.xyz/privacy
