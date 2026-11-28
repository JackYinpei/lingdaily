import Link from 'next/link'

export const metadata = {
  title: 'LingDaily 隐私政策',
  description: 'LingDaily 网页版与 iOS、Android App 的账号、AI 对话、语音和云同步数据说明。',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <Link href="/" className="text-primary underline">LingDaily</Link>
      <article className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
        <h1>LingDaily 隐私政策</h1>
        <p>网页版说明更新于 2026 年 11 月 19 日；App 说明更新于 2026 年 11 月 26 日。本页分别说明网页版与原生 iOS、Android App 的数据处理。联系邮箱：<a href="mailto:yoasobi996@gmail.com">yoasobi996@gmail.com</a>。</p>
        <h2 id="web">网页版数据处理</h2>
        <p>网页版使用邮箱密码登录，以及实际启用的 Google、Linux.do 第三方登录。账号认证使用 Supabase 和 NextAuth；第三方登录会提供账号标识、邮箱及可用的个人资料，用于认证和账号映射。浏览器使用会话 Cookie 保持登录，并在本地存储语言、主题和练习页面偏好。</p>
        <p>使用 AI 对话、翻译或场景生成时，相关文字、场景和上下文会发送给 Google Gemini。连接实时语音前，浏览器会请求麦克风权限；连接期间音频会发送给 Gemini，模型返回音频及文字内容。服务可能使用配置的连接中转，数据处理可能跨境。请勿输入密码、身份凭据或其他敏感信息。</p>
        <p>登录后的语言偏好、对话文字、收藏词汇及用户场景等账号数据保存在 Supabase，供后续查看和跨设备使用；学习进度根据练习记录计算。退出登录或清除浏览器存储不会删除云端账号数据。网页和 App 共用账号数据；如需访问或删除个人数据，请通过上方邮箱联系我们。</p>
        <p>可在浏览器网站设置中撤回麦克风权限，断开语音连接以停止后续音频发送。已发给第三方的数据受其实际适用的<a href="https://ai.google.dev/gemini-api/terms">服务条款</a>和<a href="https://policies.google.com/privacy">隐私政策</a>约束，我们不承诺第三方零留存。以下 App 的接口设置、本机加密存储和系统听写仅适用于 iOS、Android App，不代表网页版具有相同入口。</p>
        <h2 id="app">iOS / Android App 数据处理</h2>
        <p>App 本身不提供 AI 模型服务，也不内置任何模型或 API Key。不填写接口时可以浏览内置场景、收听每日播客；文字练习、实时语音、复盘、新建场景、翻译和建议等 AI 功能，只有在你于「我的 → 接口设置」填入自己的 Google Gemini 或 OpenAI API Key 后才可使用。App 面向成年人（App Store 年龄分级 18+）。</p>
        <h2>你配置的模型接口</h2>
        <p>填写接口后，练习文字、场景描述、目标、背景及相关上下文，以及实时语音时的麦克风音频，由你的设备发送到你选择的服务商：接口地址留空时，经我们在东京的中转服务器转发到 Google 或 OpenAI；你填写了其他地址（官方地址或你自己的中转）时，直接发送到该地址。这些请求不经过 LingDaily 的应用服务器。这些请求使用你自己的账号和额度，其处理和保留受相应服务商的条款约束（<a href="https://ai.google.dev/gemini-api/terms">Gemini API 条款</a>、<a href="https://policies.google.com/privacy">Google 隐私政策</a>、<a href="https://openai.com/policies/row-terms-of-use/">OpenAI 使用条款</a>、<a href="https://openai.com/policies/row-privacy-policy/">OpenAI 隐私政策</a>），我们不承诺第三方零留存。东京中转只转发请求，不记录请求内容、地址或密钥，数据可能因此跨境传输。请勿输入身份凭证、商业机密或其他敏感信息。</p>
        <p>API Key、接口地址和模型名称加密保存在本设备（iOS Keychain、Android Keystore）。登录后会同步到你的账号：服务端用按账号派生的密钥加密后保存，只在你本人登录时返回，用于在你的其他设备上恢复设置。</p>
        <h2>账号与云端记录</h2>
        <p>账号是可选的，只用于云同步和删除账号。iOS 使用 Apple 登录，我们接收 Apple 提供的账号标识、已验证邮箱（可为隐藏邮箱）及你选择提供的姓名；Android 使用 LingDaily 账号的邮箱或手机号和密码（手机号不发送短信验证）。会话凭据加密保存在本设备。账号服务和练习数据使用 Supabase。</p>
        <p>练习的文字消息、字幕、纠错、收藏词汇、目标、背景和自建场景保存在本机；登录后同步到账号，网页和 App 共用账号数据。未登录时这些数据只保存在本机。</p>
        <h2>语音</h2>
        <p>LingDaily 不存储原始通话录音，但会保存对话文字（登录后同步）。iOS 文字模式的听写只使用设备端离线识别，朗读使用系统语音。Android 文字模式朗读优先使用系统语音；设备没有英文语音时的朗读，以及听写，会把文字或录音发送给你配置的接口。麦克风和系统听写权限可在系统设置中关闭。</p>
        <h2>选择、保留与删除</h2>
        <p>在「我的 → 接口设置」清空 API Key 后，App 不再发出 AI 请求。云端记录保留以供你回看和跨设备同步，直到被删除。退出登录会清除当前账号在本设备的记录和接口设置，尚未同步的改动可能丢失；再次登录后从云端恢复。卸载 App 不等于删除云端账号。</p>
        <p>在「我的 → 账号与数据 → 删除账号」再次确认（iOS 通过 Apple，Android 输入密码），可永久删除账号及其云端练习、词库、自建场景、加密保存的接口设置和历史用量记录，包括同账号的网页数据。其他设备已下载的本机副本，以及服务提供商按自身政策保存的数据，不在此操作的即时删除范围内。对数据访问或删除有疑问，请联系我们。</p>
        <h2>安全与追踪</h2>
        <p>App 与 LingDaily 服务之间通过 HTTPS 传输；接口地址只接受 HTTPS（本机和局域网地址除外）。App 不包含广告或跨 App 追踪 SDK，不出售个人数据。运行服务的基础设施可能处理网络地址和必要的安全日志。不要把 AI 回复当作专业建议，生成内容可能不准确。</p>
        <h2>政策变更与联系</h2>
        <p>本页会公布政策更新。隐私问题请发送邮件至 <a href="mailto:yoasobi996@gmail.com">yoasobi996@gmail.com</a>，不要发送密码、会话凭据或原始录音。</p>
        <p><Link href="/support">帮助与联系</Link></p>
      </article>
    </main>
  )
}
