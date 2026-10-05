# 调研来源与证据边界

核查日期：2026-09-29。外部资料使用官方文档、官方代码或产品官方说明。页面和主分支可能更新，实施与提交 App Store 前要重新核对对应版本。

## 工程资料

| 来源 | 本次用于判断什么 | 边界 |
| --- | --- | --- |
| [Apple：导航迁移](https://developer.apple.com/documentation/swiftui/migrating-to-new-navigation-types) | NavigationStack 的 iOS 16 基线 | iOS 15 使用兼容导航 |
| [Apple：观察模型](https://developer.apple.com/documentation/swiftui/monitoring-model-data-changes-in-your-app) | iOS 17 之前的 ObservableObject 方案 | 不将 Observation 当 iOS 15 基础能力 |
| [Apple：SwiftData](https://developer.apple.com/videos/play/wwdc2024/10137/) | SwiftData 自 iOS 17 引入 | 本地存储先选兼容方案 |
| [Supabase Swift Package.swift](https://raw.githubusercontent.com/supabase/supabase-swift/main/Package.swift) | 本次 main 声明 iOS 16 | 没有据此判断所有发布 tag；实现前锁版本 |
| [Supabase：JWT](https://supabase.com/docs/guides/auth/jwts) | 验证身份而非只解码 Token | 生产签名方式尚未检查 |
| [Supabase：getUser](https://supabase.com/docs/reference/javascript/auth-getuser) | 向 Auth 服务验证用户的路径 | 待服务端接入和测试 |
| [Supabase：PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) | OAuth 授权流程 | 旧账号绑定仍需本项目审计 |
| [Supabase：原生 ID Token 登录](https://supabase.com/docs/reference/swift/auth-signinwithidtoken) | 原生登录与 Supabase 会话衔接 | 不等于现有 OAuth 账号已经迁移 |
| [Google：临时 Token](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) | 本次文档为 v1beta，可约束会话配置 | 与仓库 v1alpha 存在差异，必须端到端验证 |
| [Google：Live 能力](https://ai.google.dev/gemini-api/docs/live-api/capabilities) | PCM 格式与输入输出采样率 | 不证明当前模型在所有地区可用 |
| [Google：Live 会话管理](https://ai.google.dev/gemini-api/docs/live-api/session-management) | 中断、会话限制和恢复 | 与一次性凭据策略一起验证 |
| [W3C：文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | 设计规范的对比度阈值与计算基础 | 本次做色值计算，没有完成实际界面无障碍验收 |
| [Apple：App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | 账号删除、登录、AI 数据、用户内容和支付待办 | 不代表已完成发布审核或各市场法律核查 |

Apple 的部分文档页面对自动读取只返回 JavaScript 提示；本次可用的导航和观察模型内容同时通过 Apple 官方搜索摘要核对。AVAudioSession 的具体 API 配置和权限版本需要在实现时以本机 SDK 与实际设备验证，没有将抓取失败的页面当成联调证据。

## 产品资料

| 来源 | 本次观察 |
| --- | --- |
| [Speak Tutor](https://help.speak.com/en/articles/11396739-what-is-speak-tutor) | 自定义课程、自由练习与个性化导师已是公开产品能力 |
| [Speak Made For You](https://help.speak.com/en/articles/11565779-what-are-made-for-you-custom-lessons) | 基于错误、兴趣和词汇情况安排练习 |
| [ELSA：真实场景练习](https://blog.elsaspeak.com/en/practice-real-life-conversations/) | 角色任务、沟通目标和反馈 |
| [Duolingo Adventures](https://blog.duolingo.com/adventures/) | 情境探索、角色和任务结构 |
| [Praktika](https://praktika.ai/) | AI 导师、提示、纠错和个人学习计划 |

没有比较实际订阅价格，也没有采用官方营销材料中的下载量、评分或用户评价来推断商业效果。产品创意的价值和付费意愿都需要本项目自己的验证。

## 本地证据

基线 `99fc2ca`。阅读根 AGENTS、package、主题、认证、Live、对话 identity/合并、历史/学习项/场景/偏好/新闻/进度/播客路由，以及 001–007 迁移的相关结构。源码链接位于各专题，规范迁移目录为 [supabase/migrations](../../supabase/migrations)。

初期研究未读取真实 `.env` 内容，未连接生产数据库，未调用付费模型或生产 API，未安装 Swift 依赖，未运行用户试验。旧空模板的模拟器构建结果不能作为本方案中尚未实现的能力通过验证的证据。后续本地原型的实现与实际验证结果单独记录在 [09 体验版说明](09-prototype.md)。
