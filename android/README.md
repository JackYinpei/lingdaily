# LingDaily Android

原生 Android 版，Kotlin + Jetpack Compose，最低支持 **Android 8.0（API 26）**。与 [iOS 版](../ios/README.md) 一样是 **BYOK（自带接口）口语练习工具**：App 不内置任何模型或 API Key，开箱可浏览全部内置场景、收听每日播客；在「我的 → 接口设置」填入 Google Gemini 和/或 OpenAI 的 Key（可选 Base URL、文字模型、实时语音模型）后，所有 AI 功能由手机直连所配置的接口。线上服务 `https://lingdaily.yasobi.xyz` 只提供公开的场景清单与播客、可选的账号与云同步（练习记录、词库、自建场景和加密的接口设置），同一账号在网页、iPhone 和 Android 看到同一份数据。

## 当前状态

已实现：场景首页（分类、继续练习）、独立的「播客」Tab（今日播客、生词、聊聊这条新闻、往期）、准备页（难度、对方脾气二维面板、目标/背景、词库带词）、文字逐轮练习（提示三级、更自然的说法、再说一次、听写、朗读）、Gemini Live 语音通话（字幕、纠错批注、自动收词、任务进度、打断、静音、卡住时的建议）、总结与逐句复盘、学习页（练习记录、词库、看中文说英文的复习）、新建场景、今日生词、每日/对话前提醒、接口设置（Gemini 或 OpenAI 二选一，模型预填最新，点保存生效）、可选登录与云同步、退出登录与删除账号。

Release 包和 Debug 包行为相同：场景与播客来自线上公开接口（场景另打包在 `res/raw/scenario_catalog.json`，离线首启也有全部 25 个），AI 请求只发往用户填写的接口。Android 没有原生 Apple 登录，账号用网页账号的邮箱或手机号和密码（见下文“账号”），登录是可选的。

尚未在真机上验证的部分（代码已完成，模拟器的 AOSP 镜像没有对应系统服务或无法验证）：

- Live 语音通话的真实收音、播放和回声处理（已验证到向服务端申请通话 token 为止）；
- 朗读和听写的真实效果（模拟器上只用假服务验证了录音上传和结果回填，没有调用真实模型）；
- 通话切后台后的持续收音、桌面小组件、分享文字生成场景；
- 播客后台播放、提醒通知的实际送达；
- 用真实账号登录后的云同步往返（同步逻辑与线上 JSON 格式有单元测试覆盖）。

## 运行

用 Android Studio 打开 `android/` 目录，或在命令行：

```bash
cd android
./gradlew :app:assembleDebug          # 构建
./gradlew :app:testDebugUnitTest      # 单元测试
./gradlew :app:installDebug           # 安装到已连接的设备或模拟器
./gradlew :app:connectedDebugAndroidTest   # 设备/模拟器上的通话音频测试（播放计时、打断、收音与静音），不联网
```

工具链：Gradle 9.6.1、Android Gradle Plugin 9.3.3（Android Studio 2026.1.1 能打开的最新一档，升级 AGP 时连同 IDE 一起升）、Kotlin 2.3.21、compileSdk 37、targetSdk 36、JDK 17。AGP 9 自带 Kotlin 编译，不再应用 `org.jetbrains.kotlin.android` 插件。版本集中在 `gradle/libs.versions.toml`。

### 接口设置（BYOK）

- 实现：`core/network/AISettings.kt`（数据与 Keystore 加密存储）、`core/network/DirectAI.kt`（prompt、schema、请求体、校验，与服务端 `app/lib/ios/*.js` 一致）、`ui/settings/APISettingsScreen.kt`。
- Gemini：文字 `POST {base}/v1beta/models/{model}:generateContent`（Key 在 `x-goog-api-key` 头），实时语音 `wss://{base}/ws/…BidiGenerateContent?key=`。OpenAI：文字 `POST {base}/v1/chat/completions`，实时语音 `wss://{base}/v1/realtime?model=`（GA 接口；`OpenAI-Beta: realtime=v1` 已于 2026-05-12 下线），音频重采样为 24 kHz。
- 默认走东京中转：接口地址留空时，Gemini 走 `https://lingdailyapi-jp.yasobi.xyz`，OpenAI 走 `https://lingdailyapi-jp.yasobi.xyz/openai`（`DirectAI.DEFAULT_GEMINI_BASE_URL/DEFAULT_OPENAI_BASE_URL`），因为国内手机网络连不上官方接口；用户填了自己的地址才用他的。只接受 `https://`，`http://` 仅限本机和私有局域网（模拟器访问电脑可用 `http://10.0.2.2:端口`）。
- 顶部选的服务商同时用于文字和语音，不回退到另一家；模型预填目前最新的（`AIProviderKind.defaultTextModel/defaultLiveModel`），只填 Key 即可。改动点「保存」才生效（有提示），返回时有未保存的修改会先问。Gemini 3 文字请求带 `thinkingLevel: low`（快约 3 倍），GPT-5 及以后的模型不发 `temperature`。登录后接口设置随 `/api/ios/sync` 加密同步；退出登录、删除账号或换账号时清除本机副本。

## 签名与分发

Release 包用自签名证书签名：密钥库 `android/lingdaily-release.jks` 和口令文件 `android/keystore.properties` 只在本机，已被 Git 忽略。没有这两个文件时 Release 仍能构建，只是不签名。

```bash
./gradlew :app:assembleRelease     # 产物：app/build/outputs/apk/release/app-release.apk
```

把这个 APK 发给测试者直接安装即可（需允许“安装未知来源应用”）。**请备份密钥库和口令文件**：丢失后新包无法覆盖安装旧包，测试者只能卸载重装。上架应用商店前换成正式密钥。

### 发布新版本给测试者

App 启动和每次回到前台时（最多每小时一次）读取 `https://deploy.shiying.sh.cn/lingdaily/latest.json`，版本号更大时弹窗提示一次（同一版本不重复弹），并在首页和「我的」保留下载入口；「我的」底部的「检查更新」可随时手动检查。发布步骤：

```bash
# 1. 改 app/build.gradle.kts 的 versionCode（+1）和 versionName
./gradlew :app:assembleRelease
python3 tools/upload_release_to_cos.py --changelog "这一版改了什么"
```

脚本把 APK 和 `latest.json` 传到腾讯云 COS 的 `lingdaily/` 前缀下；密钥默认读本机的 `tools/.env`（已忽略，0600），也可用环境变量或 `COS_ENV_FILE` 指定（`COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION`），不进 Git。凭据来源、核对方法和整套发版顺序见 [docs/release.md](../docs/release.md)。

## 账号

- 登录：`POST /api/android/auth/password`，用 Supabase 校验邮箱密码，签发与 iOS 相同的原生会话（60 天），之后所有 `/api/ios/*` 接口通用。
- 注册：`POST /api/android/auth/register`。Supabase 开启邮件确认时返回 `confirmationRequired`，App 提示先去邮箱确认再登录。
- 手机号注册/登录：`POST /api/android/auth/phone`（App 默认带 `autoRegister: true`：未注册的号码直接用这个密码注册并登录，界面上可取消勾选；已注册号码密码错误仍只提示密码不对），以及单独的 `POST /api/android/auth/phone/register`。**不发验证短信**（没有短信服务商），手机号只是登录名。服务端用 Supabase Admin API 建一个已确认的邮箱密码账号，地址由号码派生（`8613800138000@phone.lingdaily.yasobi.xyz`，见 `app/lib/phoneAccount.js`），号码记在 `user_metadata.phone`；因此之后的会话、同步、删除账号与邮箱账号完全一样，网页登录框也接受手机号。需要服务端配置 `SUPABASE_SERVICE_ROLE_KEY`。忘记密码目前无法自助找回。
- 删除账号：「我的 → 账号与数据 → 删除账号」，再次输入密码确认，`POST /api/android/account/delete`，网页和 iOS 的数据一并删除。
- 会话用 Android Keystore 里的密钥加密后存在本机，不参与系统备份和换机迁移。
- 限制：在 iPhone 上用 Apple 登录创建的账号没有密码，目前不能在 Android 登录；需要时可以再加 Google 登录或网页版 Apple 登录。

## 代码结构

```text
app/src/main/kotlin/com/qcy/lingdaily/
  core/model/        练习会话状态机、词库、复习、提醒时间计算（纯 Kotlin）
  core/persistence/  本机存档、同步账本与合并
  core/network/      HTTP 接口、会话加密存储、Live WebSocket
  core/realtime/     Live 协议编解码、字幕合并、播放/上传缓冲、回声门、工具调用
  core/audio/        Live 音频（AudioRecord/AudioTrack）、听写与朗读、播客
  app/               常驻对象：存档、账号、同步、提醒、设置
  ui/                设计系统（Brand.kt 是颜色唯一来源）与各页面
app/src/test/        单元测试；ios-sync-changes.json 是 iOS 编码器的真实输出
```

`core/model`、`core/persistence`、`core/realtime` 不依赖 Android，对应 iOS 的 `Core/`，测试也从 `ios/Tests` 移植。

## 与 iOS 保持一致的约定

- **同步 JSON 必须一致。** 练习会话整份存进云端，两个 App 互相读写。`CloudSyncTest.readsAndRewritesTheIOSWireFormatWithoutChangingIt` 用 iOS 自己的编码器输出做基准：Android 读入后再写出必须与原文等价。给会话加字段时两端和这份基准一起更新。
- UUID 写成大写、时间写成带毫秒的 ISO 8601 UTC，与 Swift 一致；缺省的可选字段不写出（服务端 schema 是 strict 的）。
- 视觉沿用 iOS 的纸墨配色与规则（`docs/ios/02-design-system.md`），场景色的散列算法相同，同一个人物在两端颜色一致。
- 通话只在前台进行：切到后台即挂断并保存；播客可以后台播放。
- 外放时对方说话期间麦克风上传静音（回声门）：每一帧在录下时就按扬声器的实际出声时间（`AudioTrack.getTimestamp`）加 500ms 尾音判定，排队上传不影响判定；想插话点「打断」，戴耳机可以直接说。对方的长回答整段缓存（2 分钟），麦克风积压最多 5 秒，都不再提示「缓冲繁忙」。

## 与 iOS 不同的地方

- 登录方式（见“账号”）。
- 文字模式朗读优先用手机自带的英文 TTS（免费、离线），没有英文 TTS 引擎时才用所配置的接口合成（OpenAI `tts-1` 等），听过的句子缓存在本机；听写在停止后把录音发给所配置的接口转成文字（Gemini 文字模型或 OpenAI `whisper-1`），不保存录音。
- 「轻松」难度下对方每句话自动在下面显示中文（文字模式用回复自带的翻译；语音模式在对方说完一句后用所配置的文字模型翻译，只翻本次进入后的新句子，手动收起的不再展开）；说中文词时对方会顺口给出英文说法。
- 语音通话顶部显示三个任务的进度（完成打勾）；三个任务都完成后不自动挂断，可以接着聊，学习者自己挂断后才进入总结（iOS 完成后自动结束）。
- 语音通话切到后台不挂断：通话期间有一条常驻通知（可点“结束通话”），划掉 App 才结束。拿不到后台麦克风权限时退回“切后台即挂断”。
- 每日播客是底部单独的「播客」Tab（练习 · 播客 · 学习 · 我的），不在首页：进度拖动、前后 15 秒、倍速、往期列表。
- 学习页有近 7 天的开口次数和连续天数；词库复习按间隔安排（答对后依次隔 1、3、7、14、30 天，答错下次优先），可导出为文本。
- 桌面小组件（继续上次对话）；从别的 App 分享文字可直接生成场景。
- 测试包自带更新提示（见“签名与分发”）。
- 删除场景/练习记录用长按菜单，没有左滑。
