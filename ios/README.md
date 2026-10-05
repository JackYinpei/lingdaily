# LingDaily iOS

当前是 **SwiftUI AI 体验版 0.3.0**，最低支持 **iOS 15.0**。工程入口是 [LingDaily.xcodeproj](LingDaily/LingDaily.xcodeproj)。用 **Sign in with Apple** 登录后，App 直接调用线上服务 `https://lingdaily.yasobi.xyz`，实时语音经东京中转 `lingdailyapi-jp.yasobi.xyz` 连接 Gemini；练习记录、词库和自建场景同步到与网页共用的 Supabase 表（见 10 的“云同步与删除账号”）。

已实现：Apple 登录、4 个场景与用户描述生成的新场景、自动收词到词库、目标/背景驱动的 AI 对话、动态提示、针对原句的 AI 反馈、一句话重来、设备端听写、AI 回复自动朗读、本机历史/续练/收藏、明暗主题、Gemini Live 实时语音。支持云同步与删除账号；尚未接入新闻或付费。

## 怎么试

```bash
open ios/LingDaily/LingDaily.xcodeproj
```

选择 iPhone 或模拟器（模拟器需在系统设置登录 Apple ID），按 `⌘R`。首页或「我的」点「通过 Apple 登录」，之后不需要 Mac 一直运行服务，手机也不需要和 Mac 在同一 Wi-Fi。

登录流程：App 生成随机 nonce → Apple 返回 identity token → `POST /api/ios/auth/apple` 校验签名/bundle ID/nonce 并按 Apple 验证邮箱找到或创建 Supabase 用户 → 返回 60 天 iOS 会话，存入本机 Keychain（ThisDeviceOnly）。会话失效时接口返回 401，App 自动退出登录并提示重新登录；在 Apple ID 设置里撤销授权后，下次启动也会退出。

**只在调试服务端改动时**才需要本机服务：`npm run ios:dev`（真机加 `-- --device`）运行期间，Debug 构建会打包本机配对文件并改连 Mac，且不需要登录；停止该进程会删除配对文件，再从 Xcode 构建一次即恢复连线上。

1. 在 Xcode 选择 `LingDaily / Debug` 和已安装的 iPhone 模拟器，按 `⌘R`。服务端使用 `.env` 中的 Gemini 密钥；密钥不进入 App。
2. 首页选一位对话对象（同事、酒店前台、面试官或咖啡师）的场景卡；或点右上「新场景」，用一句话描述你马上要面对的对话，生成专属场景。
3. 目标可选。准备页默认「语音通话」：点「进入语音通话」，在对话页点「开始通话」并允许麦克风后直接说英语，字幕自动进气泡。若选择「文字」，点「开始文字对话」，等对方开场后用英语打字回答。卡住时点底部「提示」的「意思 / 关键词 / 参考说法」。
4. 文字模式发送后，「更自然的说法」出现在你的句子下方，可收藏；你用中文代替或说错的词会自动加入「词库」。点「再说一次」换个说法，或点「下一步」。
5. 语音体验：准备页或对话页选「语音通话」→「开始通话」，允许麦克风后等对方开场；直接用英语说话，气泡显示实时字幕，批注对应你的原句，不会的词自动进入词库；完成当前任务由工具推进三步进度。静音只关闭麦克风，对方仍能说；「结束」保存已有内容。
6. 到「学习」回看原话、批注和词库。后台、音频中断或当前音频设备断开会断开并保存；断开后回来要点「重新连接」；插入耳机/连接蓝牙只更新音频格式，保留通话和静音状态，不会自行开麦；权限拒绝可切回「文字」。重新连接是带最近文字背景的新会话，尚无供应商sessionResumption。

语音通话使用系统麦克风权限，16kHz PCM直接发送Gemini，原始录音/token不保存；文字模式的听写仍在设备上完成，朗读使用系统TTS；实时通话直接接收并播放Gemini模型音频，字幕仅用于显示。文字听写保留跨停顿的语音段，停止/发送最多等1秒末句结果；单段800字或45秒上限仍保留，达到字数上限会提示先发送再继续。正式发布前需人工验证听感、来电/Siri与耳机/蓝牙。模拟器建议先打字。听写仅在设备支持离线英语识别、并授予语音识别与麦克风权限时可用；不支持时会显示原因，文字流程仍可使用。TestFlight/Release 还需要 HTTPS 服务与正式认证。

## 用自己的 iPhone 体验（Xcode Debug）

手机与 Mac 连接同一可信 Wi-Fi，停止原有的 `ios:dev` 进程，再运行：

```bash
npm run ios:dev -- --device
```

服务只绑定检测到的一个私有局域网 IPv4 地址，终端会显示地址；有多个网络接口时可用 `IOS_DEV_INTERFACE=en0` 指定。Xcode 选择自己的 iPhone、Debug 配置，按 `⌘R` **重新安装**。首次练习允许「本地网络」，语音通话另需允许麦克风。保持 Mac 与开发服务运行；Mac 的地址变化后重新启动服务并安装 App。已装旧版不会自动得到新配置。「我的 → 怎么连接」可查看打包的服务地址。

这是显式开启的本地 HTTP 开发配对：配对凭据经局域网传输，只适合自己的可信网络。`.ios-dev/device-connection.json` 权限为 0600，只在 Debug 真机打包，Gemini Key 永远留在 Mac。Release 不打包任何配对配置，生产接口只接受 Apple 登录会话。普通 `npm run ios:dev` 恢复回环监听并移除真机配对文件，进程退出时删除全部配对文件；模拟器工作流保持不变。真机模式只监听局域网地址，切回模拟器测试时需重启普通模式。

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
# 实际Live联调须显式开启，会消耗Gemini额度；先启动ios:dev：
LINGDAILY_LIVE_TEST=1 LINGDAILY_AI_TEST_CONFIG="$PWD/.ios-dev/connection.json" \
  swift test --package-path ios --filter LiveNetworkTests
LINGDAILY_LIVE_TEST=1 node scripts/ios-live-smoke.mjs
LINGDAILY_LIVE_TEST=1 node scripts/ios-live-smoke.mjs --tamper
```

你的目标、当前完成项、API/存储格式、真实模型测试与限制见 [AI 接入说明](../docs/ios/10-ai-integration.md)。[第一版原型记录](../docs/ios/09-prototype.md) 保留历史；[完整重构方案](../docs/ios/README.md) 中的正式认证与同步仍待实施。

开发token契约、锁定配置与完整验证记录见10。Debug模拟器打包本机配对文件，显式device模式另支持Debug真机，Release没有该文件；两者都没有Gemini Key。2026-10-02最终验证：JS30/30、Swift62项（59通过、3个网络测试默认跳过）、ESLint零warning；Debug/Release模拟器和签名Debug真机构建通过。文字听写按音频窗口累积整段，Live开场信号先于PCM上传，避免启动竞争。180秒真实网络合成PCM复测通过：上传8995帧、压力丢帧0、收到6段输入字幕与输入后的模型音频，并验证字幕归档回读。最终版本已安装并启动到iPhone；用户确认Alex开场且听到用户说话，完整3分钟/多句字幕/打断/静音/回看验收仍待现场反馈。真实Mac麦克风模式因OS权限跳过，Device Hub UI自动化超时，合成音频测试不替代完整真人体验验收。

3分钟合成语音PCM测试与真实麦克风测试命令见 [音频验证记录](../docs/ios/10-ai-integration.md)。真实麦克风测试另外要求 `LINGDAILY_LIVE_AUDIO_SOAK=1` 和 `LINGDAILY_LIVE_MIC_TEST=1`，以及macOS对测试宿主的麦克风授权；默认测试会跳过。

真机音频直接连接Google，Mac没有中转音频；手机网络也须能访问Google。用户已确认开启手机VPN后能连接。针对随后反馈的采集缺失/开场尾音，新增tap前显式重启音频图并保留开场队列，隔离文字TTS迟到回调；最新Swift64项（61通过、3跳过）与三种构建通过，具体真人效果仍待复测。可选Debug数字诊断记录在有上限的缓存，不保存语音或字幕，详见10。

现在支持受控WSS中转：在Mac的`.env`设置`GEMINI_LIVE_WS_BASE_URL=https://lingdailyapi-jp.yasobi.xyz`，重启`npm run ios:dev -- --device`，手机点重新连接。代理负责连接Google，Next仅签发token；App严格接受Google/JP/旧代理三个endpoint，API Key不经过语音中转。空配置仍直连；新白名单版本已安装后，切换地址不必再安装App。2026-10-05起JP中转`lingdailyapi-jp.yasobi.xyz`已在东京服务器可用（旧`lingdailyapi`子域仍NXDOMAIN），白名单从未解析的`lingdaily-jp`改为该域名后需重装一次App；JS33/33、Swift65项（3跳过）、ESLint与三种构建通过，JP真人音频尚未验收。


当前Key对旧文字模型返回404，ios:dev默认3.1-flash-lite（显式配置可覆盖），真实文字开场/回答均200。Live仍为与网页一致的3.1-flash-live-preview，没有为解决音频问题更换模型；共用Swift客户端此前已从私网配对入口完成Live两轮、音频/字幕/纠错/收词验证。生产/网页行为不变。
