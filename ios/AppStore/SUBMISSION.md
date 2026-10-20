# LingDaily App Store 发布记录

更新：2026-10-20 12:56（Asia/Shanghai）。使用 Chrome 的 `yoasobi996@gmail.com` 配置文件。

**版本 1.0（构建 2）已正式送审，当前「等待审核」，通过后自动发布。** Apple 回执为「已提交 1 个项目」。

- 提交 ID：`8ab13458-5fcf-4dfa-b3d8-acec5973a3cd`。
- [审核详情](https://appstoreconnect.apple.com/apps/6824758752/distribution/reviewsubmissions/details/8ab13458-5fcf-4dfa-b3d8-acec5973a3cd)。
- 用户已在本会话确认沿用 DriveCinema 的审核联系人、发布隐私答复及必要内容使用权。私人联系人只在 Apple 后台读取和填写，未保存到仓库。

## 商店与构建

- 商店名：LingDaily - 英语口语练习。
- Apple ID：`6824758752`；[App Store Connect](https://appstoreconnect.apple.com/apps/6824758752/distribution)。
- Bundle ID / SKU：`com.qcy.LingDaily`；团队：`8AJ84729BZ`。
- 首发版本 `1.0`，构建 `2`，最低 iOS 15，支持 iPhone / iPad。
- Xcode 27.0 (27A266a)，Release 模拟器 build、真机 archive、分发签名和上传均成功。构建 2 于本机时间 11:12:36 上传完成；Apple 后台已处理完成，已在商店版本中选中构建 2 并正式送审。
- 构建 1 是中间构建；正式提交应选包含年龄确认的构建 2。
- Release 含 `PrivacyInfo.xcprivacy`，无 `AIConnection.json` 或本机 ATS 例外，`ITSAppUsesNonExemptEncryption=false`。
- 归档、IPA 和上传日志保留在 `/tmp/LingDaily-AppStore2.xcarchive`、`/tmp/lingdaily-appstore-upload2` 等临时路径，不进 Git。

## 发布准备

- 商店记录已创建；中文介绍、推广文本、关键词、支持 URL、版权、英文审核操作说明及完整审核联系人已保存，Apple 最终提交检查通过。
- 教育分类；18+ 分级已保存（韩国 19+；旧版 OS 按 Apple 地区规则显示 17+）。Gemini 年龄限制见 [官方条款](https://ai.google.dev/gemini-api/terms)。
- AI 授权说明 Google Gemini、发送内容、东京中转及 Supabase 同步，并要求确认 18 岁。可拒绝和撤回；未授权的六类 AI 内容请求在发送前被拦截。账号、同步、用量及模型目录无需 AI 授权。
- 「我的」提供 `/privacy`、`/support` 入口；公开联系邮箱沿用 `yoasobi996@gmail.com`。代码 `707f6c0` 已推送 main；[生产部署 39363579251](https://github.com/JackYinpei/lingdaily/actions/runs/39363579251) 的质量、镜像和部署三个 job 均成功。线上两页返回 200，已核对政策文本及成人说明。
- 隐私标签选择姓名、邮箱、用户 ID、其他用户内容、音频数据、产品交互六类，与 App 隐私清单一致；六类均已保存为 App 功能、关联身份、不追踪。用户确认后已点击最终「发布」，后台显示由当前账号发布的记录。
- `screenshots/` 为真实 Release 界面的原始 PNG：预设场景和准备页，无虚构 AI 消息、私人对话或账号资料。iPhone 1206×2622、iPad 2064×2752 各两张已上传，后台均显示 2/10；Apple 已提示将用于其他选定尺寸。尺寸与 SHA-256 见 `screenshots/manifest.json`。
- 免费价格已确认，175 个国家或地区为「App 发布时供应」。Mac 和 Vision Pro 分发关闭，仅准备 iPhone / iPad。

## 验证

- Swift：86 项，83 通过、3 项真实网络测试默认跳过。
- iOS API Vitest：62 项通过。
- `PATH="/opt/homebrew/bin:$PATH" npm run check`：通过（零 warning ESLint、115 项 JS 测试、全部隔离迁移测试、生产构建）。本机最初缺 Bash 4+ 且 Docker 未启动，修复环境后已完整重跑。
- iPad 模拟器：未确认成年时授权按钮不可用；勾选只启用按钮，拒绝可关闭弹窗。单测验证拒绝、撤回、旧授权版本与六类 AI 请求拦截。
- 本轮未调用真实模型；此前真人音频验收限制仍见 `docs/ios/10-ai-integration.md`。

## 最终提交核验

- 审核项目为 iOS App `1.0 (2)`；不是中间构建 1，也不是仅创建审核草稿。
- Apple 回执「已提交 1 个项目」；审核详情已显示「等待审核」，提交时间为 2026-10-20 12:56（Asia/Shanghai）。
- 姓名、邮箱、用户 ID、其他用户内容、音频和产品交互六类隐私答复均已发布，功能用途、关联身份、不追踪。
- 经用户确认，内容版权选择包含第三方内容并拥有必要权利；已完成并保存。
- 审核联系人经用户授权沿用 DriveCinema，仅填写 Apple 后台；没有编造测试账号。审核说明告知使用审核人员自己的 Apple ID 登录，AI 数据授权和麦克风权限独立。
- iPhone / iPad 各两张截图、构建 2、中文资料和免费定价均已保存；175 个国家或地区为 App 发布时供应。审核通过后自动发布。
- 未代为接受新的 Apple Developer Program 许可协议；本次送审没有因此被阻挡。

等待 Apple 审核不等于已经上架。若 Apple 要求补充资料、修改或拒绝，应以本提交 ID 的反馈为准继续处理，不能将成功上传当成审核通过。

## 另外两项上架任务

2026-10-20 在同一 Chrome / Apple 账号核实：

| 项目 | App / 版本 | 当前状态 |
| --- | --- | --- |
| `/Users/qcy/proj/maxuse` | [DriveCinema 1.0](https://appstoreconnect.apple.com/apps/6824460570/distribution) | 正在等待审核；构建 6，10 月 19 日 20:24 送审，通过后自动发布 |
| `/Users/qcy/proj/RabbitHole` | [守株待兔 - 奇妙发现 1.0.0](https://appstoreconnect.apple.com/apps/6824426925/distribution) | 正在等待审核；构建 3，10 月 19 日 16:54 送审，通过后自动发布 |
