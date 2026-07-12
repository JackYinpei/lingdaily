# LingDaily 项目地图

本文件适用于整个仓库。目标是让后续开发者或 agent 在修改代码前，能快速理解
产品功能、运行边界、数据模型和不能破坏的兼容契约。

## 项目是什么

LingDaily 是一个以实时新闻和角色扮演场景为素材的多语言口语学习应用。核心能力是：

- 用 Gemini Live 进行浏览器端双向实时语音对话。
- 用当日新闻或预设/用户场景作为对话上下文。
- 保存对话、生词/短语/语法点，并计算连续学习天数与练习量。
- 每日生成 LL/DD 双主播中英双语新闻播客，发布到 COS、网页和 RSS。
- 支持邮箱密码登录，以及可选的 Google 和 Linux.do OAuth。

当前技术栈：Next.js 15 App Router、React 19、NextAuth v5 beta、Supabase
Auth/Postgres/PostgREST、Gemini Live/HTTP/TTS、Tencent COS、Vitest、Docker。Node.js 基线为
20.19+，应用端口固定为 `8000`。

## 一分钟架构图

```mermaid
flowchart LR
  Browser[Next.js 浏览器 UI] --> Auth[NextAuth]
  Browser --> API[App Router API]
  Browser <-->|WebSocket + ephemeral token| Live[Gemini Live]
  API --> Gemini[Gemini HTTP / TTS]
  API --> DB[(Supabase Postgres / PostgREST)]
  API --> News[Kagi News RSS]
  Cron[服务器 crontab] -->|POST /api/podcast/generate| API
  API --> COS[Tencent COS]
  API --> Volume[/public/podcasts 持久化卷]
```

这是一个单体 Next.js 应用，没有独立后端服务。浏览器与 Supabase 之间的业务请求
基本都经过 `app/api/`；Gemini Live 的音频流是例外，浏览器先向本应用取一次性
token，再直接连 Gemini WebSocket 或配置的 WebSocket 代理。

## 仓库导航

| 位置 | 职责 |
| --- | --- |
| `app/page.js` | SEO 首页与产品入口 |
| `app/components/HomePageClient.jsx` | 首页 UI：三语文案、Hero、功能卡；子组件在 `app/components/home/` |
| `app/components/home/` | 首页专用组件：`AuroraBackground`（极光+颗粒背景）、`HeroPreview`（静态对话演示）、`StatsPanel`（数据卡预览） |
| `app/globals.css` | 主题单一来源：shadcn CSS 变量 + 品牌配色 + `.bg-aurora`/`.grain-overlay` 工具类 |
| `app/talk/page.jsx` | 主对话页：新闻/场景、Live 连接、文本流、历史同步 |
| `app/lib/GeminiLiveService.js` | WebSocket、麦克风 PCM、模型音频播放、打断、Live tool call |
| `app/talk/_lib/` | 对话 identity/合并/压缩、prompt 和连接小工具 |
| `app/progress/progress-client.jsx` | 学习看板：今日进度环、词汇掌握、本周量表（复用 progress + items API） |
| `app/api/` | 认证、新闻、翻译、历史、学习项、场景和播客 API |
| `app/lib/history/` | PostgREST 请求、历史合并、复合游标和 DTO |
| `app/lib/podcast/` | 新闻抓取、脚本验证、TTS、COS、DB repository、shownotes/RSS |
| `app/lib/languages.js` | 唯一语言目录、归一化与语言对规则 |
| `app/auth.js` | NextAuth providers、Supabase 密码登录、OAuth 用户映射 |
| `supabase/migrations/` | 规范数据库 schema、RLS、RPC、索引和系统场景 seed |
| `scripts/` | 生产 preflight/postflight 与隔离迁移测试 |
| `tests/` | Live 音频、对话合并、播客脚本/shownotes/RSS 单测 |
| `.github/workflows/` | PR 质量门禁与 main 分支镜像部署 |

## 用户功能

### 主题与首页

- 主题是集中式的：所有颜色都是 `app/globals.css` 里的 shadcn CSS 变量，`:root` 为浅色、
  `.dark` 为深色，两套都包含品牌紫粉配色（`--brand-from/via/to` 等）。改配色只改这一处，
  全项目自动生效——不要在组件里写死颜色。
- `ThemeContext` + `layout.js` 内联无闪烁脚本负责 system/dark/light 三态切换；
  `ThemeToggle` 循环这三态。
- 首页背景的彩虹极光和胶片颗粒是 `.bg-aurora` / `.grain-overlay` 两个工具类，引用品牌变量，
  故随主题切换。Hero 里的对话演示（`HeroPreview`）和数据卡（`StatsPanel`）是**静态展示**，
  不接后端；真实能力在 `/talk` 和 `/progress`。

### 登录与账号

- Credentials 登录直接调 Supabase Auth 密码 token 接口。
- Google 和 Linux.do 只在对应环境变量存在时启用。
- OAuth 登录后，`ensureAuthUser()` 按 email 在 Supabase `auth.users` 中创建/查找用户，
  优先把 Supabase UUID 放入 NextAuth session。
- 数据表的 `user_id` 通常是 Supabase UUID。但生产旧 `user_preferences.user_id`
  是 `text`，迁移会保留这个类型以兼容旧 OAuth ID。
- 管理员不是数据库 role；`ADMIN_EMAILS` 是逗号分隔的 NextAuth email allowlist。

### 语言偏好

- 支持的 code：`zh-CN`, `en`, `ja`, `es`, `fr`, `de`, `ko`, `pt`, `it`。
- 学习语言不允许 `zh-CN`；母语可以是上述任意语言。学习语言与母语必须不同。
- 这些 code 表示练习、翻译和数据 identity 支持，不等于有 9 套 UI 文案；当前 UI
  只专门适配中文、日文和英文，其他母语回退英文界面。
- 加载顺序：登录用户的 DB 偏好 → `localStorage` → HTTP `Accept-Language` →
  默认 `en` 学习 / `zh-CN` 母语。
- 选择器只更新本地 state；用户明确点击开始时才通过
  `/api/user/preferences` 持久化。
- 增加语言时，必须同时更新 `app/lib/languages.js`、数据库 CHECK、
  Live/scenario prompt 与相关测试。

### 新闻和场景

- 新闻由 `/api/news?category=...` 代理 Kagi RSS，category 必须在后端 allowlist 中。
- 标题翻译由鉴权后的 `/api/translate` 调 Gemini HTTP 模型完成。
- 场景分为系统场景（`user_id IS NULL`）和用户场景（`user_id = auth UUID`）。
- 用户可以用 Gemini 生成场景草稿，再保存为公开或私有场景。
- 管理页维护系统场景；应用的分类信息已嵌入 `scenarios`，
  `scenario_categories` 仅是保留的历史表。
- 对话 identity 不能改：场景的 `news_key` 是 `scenario:<scenario_uuid>`。
- 用户创建的 title、description 和 system prompt 都是不可信数据。只有当前系统场景
  feed 明确标记 `_isUserGenerated === false` 且没有用户 owner 时，briefing 才能作为
  应用生成内容拼入 Live prompt；未知来源和旧缓存必须按用户内容处理。

### Gemini Live 双向语音

连接时序是一个必须保持的产品不变量：

1. 用户点击连接按钮的同步调用栈中，立即调
   `GeminiLiveService.primeOutputAudio()`。
2. `primeOutputAudio()` 创建/恢复 24 kHz `AudioContext`，并播放一个静音 sample。
3. 只有完成触摸手势内的解锁后，才能 `await` `/api/realtime-token`。
4. 用一次性 token 建立 Gemini Live WebSocket，发送 setup，收到 `setupComplete`
   后才启动 16 kHz 麦克风 PCM16 上传。
5. Gemini 返回的 24 kHz PCM16 块按 `audioPlaybackChain` 顺序解码和调度。

修改这条链路时必须保留：

- `primeOutputAudio()` 必须在任何 `fetch`/`await` 之前同步执行，否则首段 AI 音频
  会被浏览器 autoplay 策略吞掉。
- 首段音频到达时输出 `AudioContext` 可能仍是 `suspended`（连接手势里获取麦克风常把它压回挂起）。
  此时 `playAudioParts()` 不得丢弃音频，而是把 parts 存入 `pendingAudioParts` 并监听
  `statechange`，context 变为 `running` 后自动补播；`startMic()` 成功后也会主动
  `resumeOutputAudio()`。这是“第一段音频不播放、发下一句后才响”问题的根因修复，不能回退成直接抛错。
- `playbackEpoch` 使打断/断开前排队的异步音频工作失效（含 `pendingAudioParts` 与 flush 监听）。
- `connectionEpoch` 使旧 WebSocket 的迟到 `open/message/close/error` 无法影响新连接。
- 输入静音只代表麦克风 mute，不得同时将模型输出静音。
- 账号或语言对变更时，必须取消正在连接的 socket，并清除旧账号的
  上下文与待保存数据。

Live 声明两个 tool，都遵循“先立即回 `accepted`，再异步处理”避免阻塞实时会话：

- `record_unfamiliar_learning_items`：抽取用户不会的学习项，异步写 `/api/learning/items`。
  旧 tool 名 `extract_unfamiliar_english` 仍兼容。
- `record_language_correction`：用户表达有可改进处时给一条地道改写
  （`original/corrected/explanation/category`）。通过 `config.onCorrection` 回调推给
  UI，在对话流里渲染为 `CorrectionCard`；**不落库**——correction 项在持久化前按
  `type === 'correction'` 过滤，不写入 `chat_history`。

### 对话历史、生词和进度

- 只有包含真实用户消息的对话才会保存或显示在历史列表。
- 流式转录通过 `itemId` 合并；同一消息优先保留已 final 或文本更完整的版本。
- 客户端串行化保存；DB 用 `revision` 做乐观并发。冲突时合并服务端和客户端历史，
  最多重试一次。
- 页面隐藏/卸载时使用 compact keepalive payload；必须保留最近的真实用户轮次。
- 历史列表游标是 `updated_at|id`，生词列表游标是 `timestamp|id`。
  不能退回只用时间戳，否则同一毫秒内的记录会重复或丢失。
- `unfamiliar_english` 是历史表名，现在存储任意学习语言的 word/phrase/grammar/other，
  不能因为表名而把业务限制回英语。
- 进度页不有独立表；`/api/learning/progress` 实时扫描当前用户的
  `chat_history`，按请求时区计算活跃天、streak、用户轮次与来源分布。进度看板
  （`progress-client.jsx`）在此基础上加了今日进度环、本周量表，并额外拉
  `/api/learning/items` 统计去重词汇数用于“词汇掌握”卡。

### 每日播客

生成链路：

1. 服务器 crontab 调 `POST /api/podcast/generate`。
2. RPC `claim_podcast_generation` 获取 `(date_folder, daily)` 租约；DB/RPC 不可用时
   退回本地 manifest 兼容模式。
3. 抓取 world/tech/business 新闻，调 Gemini 生成严格 JSON 脚本。
4. 对 intro/world/tech/business/outro 五个 chunk 分别调 Gemini multi-speaker TTS。
5. PCM 在 Node 内用 lamejs 编码为 96 kbps MP3，不依赖 ffmpeg。
6. MP3 上传 COS，DB 更新为 `completed`，再尽力更新本地 TXT/MP3/manifest/RSS 镜像。

脚本不变量：

- 每个双语 pair 都是中文在前、英文在后，两句传达相同信息。
- pair 0：LL 说中文，DD 说英文；pair 1：DD 说中文，LL 说英文；交替循环。
- 前四个 chunk 必须有偶数个 pair，outro 必须有奇数个 pair，以保持 chunk 边界上的交替。
- 告别只能在最后两句出现：LL 中文句最后一次“拜拜”，DD 英文句最后一次“Bye”。
- shownotes 必须有 `summary_zh`、`summary_en` 和恰好 8 个唯一生词。每个生词含
  `term`, `meaning_zh`, `definition_en`, `example_en`。
- Gemini 首次 JSON 校验失败后只允许一次纠正重试。

生产 cron 兼容契约不得破坏：

- path 仍是 `POST /api/podcast/generate`。
- header 仍是 `x-podcast-secret`，无必需 body/query。
- 成功响应中不得出现名为 `error` 的字段，也不应回传模型正文；旧脚本用字符串
  `"error"` 判定是否重试。
- 服务端 curl 超时是 350 秒，route `maxDuration` 是 300 秒。
- GitHub 播客 cron 必须保持注释/禁用；真实调度由服务器 crontab 负责。

## API 速查

| API | 权限 | 作用 |
| --- | --- | --- |
| `POST /api/auth/register` | 公开 | Supabase 邮箱注册 |
| `GET/POST /api/auth/[...nextauth]` | NextAuth | 登录、OAuth callback、session |
| `POST /api/realtime-token` | 登录 | Gemini Live 一次性 token |
| `POST /api/gemini-token` | 登录，已弃用 | 上一个接口的兼容别名，带 Deprecation/Sunset header |
| `GET /api/news` | 公开 | 受 allowlist 限制的 Kagi RSS 代理 |
| `POST /api/translate` | 登录 | 用 Gemini 翻译新闻标题 |
| `GET/POST /api/user/preferences` | 登录 | 读取/upsert 语言偏好 |
| `GET/POST/DELETE /api/chat-history` | 登录 | 历史详情/列表/保存/删除、revision 冲突 |
| `GET/POST /api/learning/items` | 登录 | 学习项事件写入与复合游标分页 |
| `GET/POST /api/learning/unfamiliar-english` | 登录，旧别名 | 转发到 `learning/items` |
| `GET /api/learning/progress` | 登录 | 由历史实时聚合学习进度 |
| `GET/POST/DELETE /api/scenarios` | 混合 | 公开读、用户场景创建/删除 |
| `POST /api/scenarios/generate` | 登录 | Gemini 生成场景草稿 |
| `/api/admin/scenarios` | `ADMIN_EMAILS` | 系统场景 CRUD |
| `GET /api/podcasts` | 公开 | 已完成播客列表/详情 |
| `POST /api/podcast/generate` | `PODCAST_SECRET` | 生成、租约、发布每日播客 |
| `GET /podcasts/feed.xml` | 公开 | RSS feed |

## 规范数据模型

除明确标为历史兼容表的对象外，以 `supabase/migrations/202607110001...007`
全部执行后的结构为准。生产库在
2026-07-11 被确认为早期手工建表并且没有
`supabase_migrations.schema_migrations`；不要仅根据 CI 通过就假设生产已迁移。

### `auth.users`

Supabase Auth 管理的账号表。`unfamiliar_english`、`chat_history`和用户场景的
UUID owner 都应对应这里的 `id`。业务迁移不创建或修改真实 Supabase Auth schema。

### `user_preferences`

| 字段 | 类型/语义 |
| --- | --- |
| `user_id` | fresh 库是 UUID FK/PK；旧生产保留 `text` PK |
| `native_language_code/label` | 母语 code 和展示名 |
| `learning_language_code/label` | 学习语言 code 和展示名 |
| `created_at`, `updated_at` | `timestamptz`，update trigger 维护 `updated_at` |

约束：每用户一行，code 必须在语言目录内，两种语言不同，label 非空。
RLS 只允许 authenticated 读、插入和更新自己的行；不提供用户删除。

### `unfamiliar_english`

表名是历史兼容名，实际是多语言学习项事件表。

| 字段 | 类型/语义 |
| --- | --- |
| `id` | UUID PK |
| `user_id` | UUID owner；fresh 库是已验证的 `auth.users` FK，旧表补建时为 `NOT VALID` FK |
| `items` | JSONB array，一次 tool call 可包多个项 |
| `context`, `user_message` | 提取语境与用户原句 |
| `learning_language_*`, `native_language_*` | 该事件的语言 identity |
| `timestamp` | 事件时间，分页主排序键 |
| `created_at` | DB 创建时间；历史行由 `timestamp` 回填 |

`items[]` 元素的应用形状是
`{ text, type: word|phrase|grammar|other, meaning?, original? }`。新写入每个事件最多 20 项，
读取时不截断旧数据。索引为 `(user_id, timestamp DESC, id DESC)` 以及带学习语言的
同类索引。RLS 只允许 owner SELECT/INSERT。

### `chat_history`

| 字段 | 类型/语义 |
| --- | --- |
| `id` | UUID PK |
| `user_id` | UUID owner，对 `auth.users` 的 `NOT VALID` FK |
| `news_key` | 用户内的主题 identity；场景必须是 `scenario:<uuid>` |
| `news_title` | 列表标题 |
| `news` | JSONB 主题快照，用于恢复对话 |
| `history` | JSONB array，消息和 system context |
| `summary` | 可选摘要 |
| `source_type` | `news` 或 `scenario` |
| `revision` | 从 1 开始的乐观并发版本 |
| `created_at`, `updated_at` | `timestamptz` |

唯一键是 `(user_id, news_key)`。列表索引是 `(user_id, updated_at DESC, id DESC)`
及带 `source_type` 的变体。RLS 是 owner CRUD。

`save_chat_history(...)` 是仅 `service_role` 可执行的 SECURITY DEFINER RPC。新增时
`p_expected_revision=0`；更新时必须等于当前 revision，成功后加 1；不匹配抛
`CHAT_HISTORY_REVISION_CONFLICT`。RPC 不存在时 API 暂时有兼容写入路径，但迁移完成后
应以 RPC 为主。

### `scenarios`

| 字段组 | 语义 |
| --- | --- |
| `id` | UUID PK，被 `chat_history.news_key` 逻辑引用 |
| `category_slug/name_*/icon/sort` | 嵌入式分类快照，不依赖分类表 FK |
| `title_zh/en/ja`, `description_zh/en/ja` | 旧 UI 兼容的多语标题/描述 |
| `title_target`, `description_target` | 当前学习语言的主展示内容 |
| `target_language_code`, `native_language_code` | 场景的学习/支持语言 identity |
| `difficulty` | `beginner`, `intermediate`, `advanced` |
| `system_prompt` | Live 角色扮演提示词 |
| `sort_order`, `is_active` | 排序与启用状态 |
| `user_id` | NULL = 系统场景；UUID = 用户场景 |
| `is_public` | 用户场景是否公开；系统场景的可读性主要由 NULL owner + active 决定 |
| `created_at`, `updated_at` | `timestamptz` |

系统场景有 partial unique index：
`(category_slug, title_en, target_language_code, native_language_code) WHERE user_id IS NULL`。
RLS 允许 anon/authenticated 读 active 系统场景、active 公开用户场景，owner 可读自己的场景；
authenticated 只能写自己的行。

seed 只插入缺失的系统场景，不覆盖生产已有 prompt/description。如果发现同语言对的
重复系统场景，迁移必须回滚；不得自动选一条并删除其余场景或对话。

### `scenario_categories`

生产旧库保留的历史分类表：`id`, unique `slug`, `name_zh/en/ja`, `icon`,
`sort_order`, timestamps。001–007 不会在 fresh 库创建它。当前应用从 `scenarios`
嵌入字段派生分类；旧库升级时迁移必须保留该表及现有数据，因为旧部署可能仍引用它。

### `podcasts`

| 字段 | 类型/语义 |
| --- | --- |
| `id` | UUID PK |
| `date_folder`, `category` | 业务唯一键；每日节目使用 `category='daily'` |
| `title`, `summary`, `script` | 标题、兼容摘要、TXT 完整文稿 |
| `content` | JSONB 结构化脚本，含 shownotes/chunks |
| `image_url` | `text[]` 新闻图片兼容字段 |
| `audio_url` | COS 公开 MP3 URL，生成中允许 NULL |
| `generation_id` | 每次生成租约 UUID，防止旧 worker 覆盖新 worker |
| `status` | `in_progress`, `script_generated`, `completed`, `failed` |
| `error_message` | 最近失败摘要 |
| `audio_bytes`, `audio_duration_seconds` | RSS/播放器元数据 |
| `created_at`, `updated_at` | `timestamptz`；旧北京无时区墙钟值在迁移时按 Asia/Shanghai 解读 |

RLS 只允许 anon/authenticated SELECT `status='completed'` 的行。
`claim_podcast_generation(date, force, generation_id)` 仅 `service_role` 可执行：failed 可重领，
completed 只有 force 可重领，进行中租约超过 30 分钟可重领。

## 数据库迁移规则

- 七个规范迁移必须按文件名顺序执行。
- 每个 migration 自带 `BEGIN`/`COMMIT`。在 SQL Editor 必须整份执行，不得去掉事务
  边界或只运行局部；保护性异常必须回滚本文件此前的 DDL/DML。
- 2026-07-11 生产 catalog 的合成等价 fixture 是
  `scripts/fixtures/production-20260711-schema.sql`。修改 schema 时必须让这条升级路径继续通过。
- `scripts/preflight-production.sql` 只读。任何 `BLOCKER` 非零时不得迁移。
- `scripts/postflight-production.sql` 只读。迁移后所有非 `INFO` 项必须是 `PASS`，
  且数据行数必须与 preflight 对比。
- migration 可对“缺失列”做无歧义默认回填，但不能对已有的未知语言、重复行、
  非数组正文或场景 prompt 猜测修复。这类异常必须 `RAISE EXCEPTION` 并使当前文件整体回滚。
- FK 可用 `NOT VALID` 保留历史 orphan；清理与 `VALIDATE CONSTRAINT` 应是单独、经审查的数据任务。
- 生产目前没有 Supabase migration history。在建立 baseline 前，使用 SQL Editor 逐文件执行，
  不要和 `supabase db push` 混用。
- `scripts/test-migrations.sh` 只会启动唯一名称的 `lingdaily-pgsql-*` 容器，不发布宿主端口，
  不得修改它去复用、停止或删除宿主上其他 PostgreSQL 进程。

## 环境变量与安全边界

完整模板见 `.env.example`。关键分组：

- 站点/认证：`NEXT_PUBLIC_SITE_URL`, `AUTH_URL`, `AUTH_SECRET`, `ADMIN_EMAILS`,
  可选 Google/Linux.do OAuth。
- Gemini 服务端：`GEMINI_API_KEY`，可选 `GEMINI_BASE_URL`。`GOOGLE_API_KEY` 和
  `GOOGLE_GEMINI_BASE_URL` 仅是旧别名。
- Gemini 浏览器代理：`NEXT_PUBLIC_GEMINI_BASE_URL`。
- Supabase 公开配置：`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`。
- Supabase 服务端密钥：`SUPABASE_SERVICE_ROLE_KEY`。
- 播客：`PODCAST_SECRET`, `PODCAST_TIMEZONE`, `PODCAST_PUBLIC_URL`, COS 配置。

不变规则：

- 不得创建 `NEXT_PUBLIC_GEMINI_API_KEY`或将任何私钥放入 `NEXT_PUBLIC_*`。
- `SUPABASE_SERVICE_ROLE_KEY`、`PODCAST_SECRET`、COS/OAuth secret 只能在服务端环境。
- 不得在日志、API 错误、commit、fixture 或文档中回显真实密钥。
- `NEXT_PUBLIC_*` 是镜像构建时值，变更后必须重建镜像，仅重启容器无效。
- 访问用户私有数据的 server API 即使用 service role，也必须先根据 NextAuth session
  限定 `user_id`。公开读取、管理员接口和播客 cron 则必须分别执行公开数据过滤、
  `ADMIN_EMAILS` 校验或 `PODCAST_SECRET` 校验；service role 不是跳过业务授权的理由。

## 兼容路径

这些分支是为了先部署代码、后迁移数据库，删除前必须确认生产已完成迁移：

- `/api/gemini-token` → `/api/realtime-token` 的弃用别名。
- `/api/learning/unfamiliar-english` → `/api/learning/items` 的旧别名。
- 学习项 API 在语言列缺失时，只允许默认 `en/zh-CN` 旧写入；非默认语言返回 503，
  避免丢失语言 identity。
- 场景 API 在新语言列缺失时，也只容许默认 `en/zh-CN` 回退。
- 对话 API 在 `revision/source_type` 列或 `save_chat_history` RPC 缺失时有兼容路径。
- 播客生成接口的租约/归档和 RSS 可以使用本地 manifest/feed 兼容路径；公开
  `/api/podcasts`、列表页和详情页仍只读数据库，DB 不可用时返回 503，不会从本地
  manifest 回退展示。

## 测试与发布

常用命令：

```bash
npm run dev
npm test
npm run test:migrations
npm run build
npm run check
```

`npm run check` 是提交/发布前的完整门禁：零 warning ESLint → Vitest → 隔离迁移测试 →
生产构建。

修改不同模块时的最低验证：

- Live/音频：`tests/lib/GeminiLiveService.test.js` 和 `tests/talk/liveConnection.test.js`。
- 对话 identity/合并/keepalive：`tests/talk/conversation.test.js`。
- 播客 prompt/shownotes/RSS：`tests/podcast/*.test.js`。
- 任何 schema/RLS/RPC/SQL 变更：`npm run test:migrations`，并更新生产 fixture、
  preflight 和 postflight。

GitHub PR 和 main push 都会先跑同类质量门禁。main 通过后构建
`ghcr.io/jackyinpei/lingdaily:latest`，再 SSH 到服务器执行 compose pull/up。CI/CD
不会自动迁移 Supabase。

Docker Compose 只运行应用，不包 PostgreSQL。`./podcasts` 挂载到
`/app/public/podcasts`，更新镜像时不得删除该目录。

## 修改前的最后检查

1. 确定修改属于浏览器、server API、Supabase、Gemini Live 还是播客链路。
2. 检查是否有旧 schema/API/cron 兼容分支，不要只修新路径。
3. 评估是否会改变 `news_key`、游标、revision、场景 ID、播客 date/category 或音频 epoch。
4. 数据库变更先更新 fixture/测试，再考虑生产 SQL；不要在真实库上试错。
5. 运行与风险成比例的测试，提交前优先运行 `npm run check`。
6. 确认没有新密钥、用户数据、生成物或临时播客文件进入 Git。
