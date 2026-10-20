# LingDaily App Store 发布记录

更新：2026-10-20。使用 Chrome 的 `yoasobi996@gmail.com` 配置文件。

## 商店与构建

- 商店名：LingDaily - 英语口语练习。
- Apple ID：`6824758752`；[App Store Connect](https://appstoreconnect.apple.com/apps/6824758752/distribution)。
- Bundle ID / SKU：`com.qcy.LingDaily`；团队：`8AJ84729BZ`。
- 首发版本 `1.0`，构建 `2`，最低 iOS 15，支持 iPhone / iPad。
- Xcode 27.0 (27A266a)，Release 模拟器 build、真机 archive、分发签名和上传均成功。构建 2 于本机时间 11:12:36 上传完成；Apple 后台处理状态仍需核实。
- 构建 1 是中间构建；正式提交应选包含年龄确认的构建 2。
- Release 含 `PrivacyInfo.xcprivacy`，无 `AIConnection.json` 或本机 ATS 例外，`ITSAppUsesNonExemptEncryption=false`。
- 归档、IPA 和上传日志保留在 `/tmp/LingDaily-AppStore2.xcarchive`、`/tmp/lingdaily-appstore-upload2` 等临时路径，不进 Git。

## 发布准备

- 商店记录已创建；中文介绍、推广文本、关键词、支持 URL、版权与英文审核操作说明已保存。
- 教育分类；18+ 分级已保存（韩国 19+；旧版 OS 按 Apple 地区规则显示 17+）。Gemini 年龄限制见 [官方条款](https://ai.google.dev/gemini-api/terms)。
- AI 授权说明 Google Gemini、发送内容、东京中转及 Supabase 同步，并要求确认 18 岁。可拒绝和撤回；未授权的六类 AI 内容请求在发送前被拦截。账号、同步、用量及模型目录无需 AI 授权。
- 「我的」提供 `/privacy`、`/support` 入口；公开联系邮箱沿用 `yoasobi996@gmail.com`。网站发布状态须在部署后检查。
- 隐私标签选择姓名、邮箱、用户 ID、其他用户内容、音频数据、产品交互六类，与 App 隐私清单一致；逐项填写 App 功能、关联身份、不追踪，最终发布回执需检查。
- `screenshots/` 为真实 Release 界面的原始 PNG：预设场景和准备页，无虚构 AI 消息、私人对话或账号资料。

## 验证

- Swift：86 项，83 通过、3 项真实网络测试默认跳过。
- iOS API Vitest：62 项通过。
- `PATH="/opt/homebrew/bin:$PATH" npm run check`：通过（零 warning ESLint、115 项 JS 测试、全部隔离迁移测试、生产构建）。本机最初缺 Bash 4+ 且 Docker 未启动，修复环境后已完整重跑。
- iPad 模拟器：未确认成年时授权按钮不可用；勾选只启用按钮，拒绝可关闭弹窗。单测验证拒绝、撤回、旧授权版本与六类 AI 请求拦截。
- 本轮未调用真实模型；此前真人音频验收限制仍见 `docs/ios/10-ai-integration.md`。

## 提交前必须核对

1. 构建 2 处理完成并选入商店版本。
2. iPhone/iPad 截图、免费定价与销售范围保存。
3. 线上隐私政策和帮助链接返回 200，内容与 App 一致。
4. 六类隐私标签全部完成并发布；内容版权、审核联系人及最终提交验证通过。私人审核联系人仅填 Apple 后台，不进仓库。
5. Apple 登录与正式后端可用；不用开发配对或伪造登录替代。审核说明注明 Apple-only 登录，不编造测试账号。
6. 如 Apple 要求接受更新的开发者协议，由账户持有人查阅并确认；不得未经确认代为接受法律协议。

创建记录和上传成功不表示已送审或上架，最终状态以后台为准。

## 另外两项上架任务

2026-10-20 在同一 Chrome / Apple 账号核实：

| 项目 | App / 版本 | 当前状态 |
| --- | --- | --- |
| `/Users/qcy/proj/maxuse` | [DriveCinema 1.0](https://appstoreconnect.apple.com/apps/6824460570/distribution) | 正在等待审核；构建 6，10 月 19 日 20:24 送审，通过后自动发布 |
| `/Users/qcy/proj/RabbitHole` | [守株待兔 - 奇妙发现 1.0.0](https://appstoreconnect.apple.com/apps/6824426925/distribution) | 正在等待审核；构建 3，10 月 19 日 16:54 送审，通过后自动发布 |
