# LingDaily iOS

当前为 **SwiftUI 原生版 2.0（构建已上传，待送审）**，最低支持 **iOS 15.0**。工程入口是 [LingDaily.xcodeproj](LingDaily/LingDaily.xcodeproj)。**主分支已改为 BYOK（自带接口）工具版**：App 不内置任何模型、API Key 或服务端 AI 调用，开箱即可浏览全部内置场景和收听每日播客；用户在「我的 → 接口设置」填入 Google Gemini 和/或 OpenAI 的 API Key（可选 Base URL 与模型）后，文字练习、实时语音、复盘、新建场景、翻译和卡壳提示都由手机直连所配置的接口。Sign in with Apple 改为可选，只用于把练习记录、词库、自建场景和接口设置加密同步到账号（见 10 的“云同步与删除账号”）。

已实现：可选 Apple 登录、BYOK 接口设置（Gemini / OpenAI，文字与实时语音）、打包的 25 个内置场景（联网时从服务端刷新）与用户描述生成的新场景、独立「播客」Tab 里的每日播客与新闻练习、难度三档、每个角色独立音色、词库复习与“三个词回来找你”、可选的对话日期提醒与每日提醒、自动收词到词库、目标/背景驱动的 AI 对话、动态提示、针对原句的 AI 反馈、一句话重来、设备端听写、AI 回复自动朗读、本机历史/续练/收藏、明暗主题、Gemini Live 实时语音。支持云同步与删除账号；尚未接入付费。

App Store 版本 **2.0（构建 35）已于 2026-11-26 上传，尚待在 App Store Connect 选择构建并送审**（1.7、1.8 曾上传，1.9 构建 30 未送审，由 2.0 取代）；服务端已于同日部署。回执、审核链接与发布配置见 [发布记录](AppStore/SUBMISSION.md)。

## BYOK：接口设置

- **不填 Key 能用的**：全部 25 个内置场景（打包在 `LingDaily/Resources/ScenarioCatalog.json`，联网时从公开的 `GET /api/ios/scenarios` 刷新）、播客 Tab（公开的 `GET /api/ios/podcasts`）、学习记录与词库、提醒。需要模型的入口（开始练习、语音通话、新建场景、聊聊这期播客、复盘）在未配置时引导去「接口设置」。
- **接口设置**（`Features/Settings/APISettingsView.swift`）：顶部选「使用的服务商」（Gemini 或 OpenAI），文字对话和语音通话都用它，不再分开选、也不回退到另一家；下面是该服务商的 API Key、Base URL（留空=默认走东京中转，用户填了自己的地址才用他的）、文字模型、实时语音模型。模型预填目前最新的（Gemini `gemini-3.8-flash` / `gemini-3.8-live`，OpenAI `gpt-6.2-sol` / `gpt-realtime-2.1`，在 `AIProviderKind.defaultTextModel/defaultLiveModel`），所以只填 Key 就能用。改动点「保存」才生效，返回时有未保存的修改会先问。
- **请求去向**：Gemini 文字 `POST {base}/v1beta/models/{model}:generateContent`（Key 放 `x-goog-api-key` 头），Gemini Live `wss://{base}/ws/…BidiGenerateContent?key=`；OpenAI 文字 `POST {base}/v1/chat/completions`，实时语音 `wss://{base}/v1/realtime?model=`（GA 接口，`Authorization: Bearer`；旧的 `OpenAI-Beta: realtime=v1` 已于 2026-05-12 被 OpenAI 下线）。prompt、schema 和校验与服务端 `app/lib/ios/*.js` 一致（`Core/Network/DirectAIProvider.swift`）。
- **东京中转（默认）**：接口地址留空时，Gemini 走 `https://lingdailyapi-jp.yasobi.xyz`，OpenAI 走 `https://lingdailyapi-jp.yasobi.xyz/openai`（`AIEndpointNormalizer.defaultGeminiBase/defaultOpenAIBase`），因为国内手机网络连不上官方接口；用户填了自己的地址（官方或自己的中转）才用他的。中转配置见 `nginx/gemini-proxy.conf`。只接受 `https://`；`http://` 仅限本机和私有局域网地址。
- **存储**：本机 Keychain（`ThisDeviceOnly`）。登录后经 `/api/ios/sync` 同步到账号，服务端用按用户派生的密钥 AES-256-GCM 加密存入 `user_ai_settings`。退出登录、删除账号或换账号登录会清掉本机的接口设置。
- 文字模式的听写与朗读仍用系统的设备端语音识别和 TTS，不消耗接口额度。

## 怎么试

```bash
open ios/LingDaily/LingDaily.xcodeproj
```

选择 iPhone 或模拟器，按 `⌘R`。首页直接能看场景、播客 Tab 直接能听；到「我的 → 接口设置」选服务商、粘贴 Key（模型已预填），点「保存」后回到场景即可开始。手机网络需要能访问所填的接口地址。

登录（可选）：「我的」点「通过 Apple 登录」→ `POST /api/ios/auth/apple` 校验后返回 60 天 iOS 会话，存入 Keychain；会话失效时接口返回 401，App 自动退出登录。

## 验证命令

```bash
swift test --package-path ios
npx vitest run tests/ios
xcodebuild -project ios/LingDaily/LingDaily.xcodeproj \
  -scheme LingDaily -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/lingdaily-ios-live-debug CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/LingDaily/LingDaily.xcodeproj \
  -scheme LingDaily -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/lingdaily-ios-live-release CODE_SIGNING_ALLOWED=NO build
# 实际Live联调须显式开启，会消耗你自己的额度；配置文件是本机的 AISettings JSON（含 Key，勿提交）：
LINGDAILY_LIVE_TEST=1 LINGDAILY_AI_TEST_CONFIG="$HOME/lingdaily-ai-test.json" \
  swift test --package-path ios --filter LiveNetworkTests
LINGDAILY_LIVE_TEST=1 node scripts/ios-live-smoke.mjs
LINGDAILY_LIVE_TEST=1 node scripts/ios-live-smoke.mjs --tamper
```

> 以下“验证命令”之后的长段落是 BYOK 改造前（服务端代调 Gemini、`npm run ios:dev` 配对）的验证记录，仅作历史参考；配对入口已从 App 移除。

你的目标、当前完成项、API/存储格式、真实模型测试与限制见 [AI 接入说明](../docs/ios/10-ai-integration.md)。[第一版原型记录](../docs/ios/09-prototype.md) 保留历史；[完整重构方案](../docs/ios/README.md) 中的正式认证与同步仍待实施。

界面与通话约定（与 Android 一致）：准备页底部两个按钮直接开始「文字对话」或「语音通话」；对话开头显示「这次要说到」三点，通话顶部用三个圆点显示任务进度，三个任务都完成后不自动挂断，学习者自己挂断才进入总结；「轻松」难度下对方每句自动显示中文（语音模式在对方说完一句后翻译）。外放回声门在麦克风数据转换时判定（不是上传时），尾音 500ms；播放缓冲 2 分钟、上传积压 5 秒，不再提示「缓冲繁忙」。AI 授权页不提供方名称，也没有年龄开关。

开发token契约、锁定配置与完整验证记录见10。Debug模拟器打包本机配对文件，显式device模式另支持Debug真机，Release没有该文件；两者都没有Gemini Key。2026-10-02最终验证：JS30/30、Swift62项（59通过、3个网络测试默认跳过）、ESLint零warning；Debug/Release模拟器和签名Debug真机构建通过。文字听写按音频窗口累积整段，Live开场信号先于PCM上传，避免启动竞争。180秒真实网络合成PCM复测通过：上传8995帧、压力丢帧0、收到6段输入字幕与输入后的模型音频，并验证字幕归档回读。最终版本已安装并启动到iPhone；用户确认Alex开场且听到用户说话，完整3分钟/多句字幕/打断/静音/回看验收仍待现场反馈。真实Mac麦克风模式因OS权限跳过，Device Hub UI自动化超时，合成音频测试不替代完整真人体验验收。

3分钟合成语音PCM测试与真实麦克风测试命令见 [音频验证记录](../docs/ios/10-ai-integration.md)。真实麦克风测试另外要求 `LINGDAILY_LIVE_AUDIO_SOAK=1` 和 `LINGDAILY_LIVE_MIC_TEST=1`，以及macOS对测试宿主的麦克风授权；默认测试会跳过。

真机音频直接连接Google，Mac没有中转音频；手机网络也须能访问Google。用户已确认开启手机VPN后能连接。针对随后反馈的采集缺失/开场尾音，新增tap前显式重启音频图并保留开场队列，隔离文字TTS迟到回调；最新Swift64项（61通过、3跳过）与三种构建通过，具体真人效果仍待复测。可选Debug数字诊断记录在有上限的缓存，不保存语音或字幕，详见10。

现在支持受控WSS中转：在Mac的`.env`设置`GEMINI_LIVE_WS_BASE_URL=https://lingdailyapi-jp.yasobi.xyz`，重启`npm run ios:dev -- --device`，手机点重新连接。代理负责连接Google，Next仅签发token；App严格接受Google/JP/旧代理三个endpoint，API Key不经过语音中转。空配置仍直连；新白名单版本已安装后，切换地址不必再安装App。2026-10-05起JP中转`lingdailyapi-jp.yasobi.xyz`已在东京服务器可用（旧`lingdailyapi`子域仍NXDOMAIN），白名单从未解析的`lingdaily-jp`改为该域名后需重装一次App；JS33/33、Swift65项（3跳过）、ESLint与三种构建通过，JP真人音频尚未验收。


当前Key对旧文字模型返回404，ios:dev默认3.1-flash-lite（显式配置可覆盖），真实文字开场/回答均200。Live仍为与网页一致的3.1-flash-live-preview，没有为解决音频问题更换模型；共用Swift客户端此前已从私网配对入口完成Live两轮、音频/字幕/纠错/收词验证。生产/网页行为不变。
