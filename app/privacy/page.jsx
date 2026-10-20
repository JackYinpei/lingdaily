import Link from 'next/link'

export const metadata = {
  title: 'LingDaily iOS 隐私政策',
  description: 'LingDaily iOS 的账号、AI 对话、语音和云同步数据说明。',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <Link href="/" className="text-primary underline">LingDaily</Link>
      <article className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
        <h1>LingDaily iOS 隐私政策</h1>
        <p>更新于 2026 年 10 月 20 日。本政策说明 LingDaily 原生 iOS App 的数据处理。联系邮箱：<a href="mailto:yoasobi996@gmail.com">yoasobi996@gmail.com</a>。</p>
        <h2>账号与云端记录</h2>
        <p>本 iOS App 的 AI 练习面向年满 18 周岁的成年人。首次允许 AI 数据使用前，需要确认已年满 18 周岁；未成年人请勿使用 AI 功能。</p>
        <p>使用 Apple 登录时，我们接收 Apple 提供的账号标识、已验证邮箱（可为隐藏邮箱）及你选择提供的姓名，用于认证和账号映射。会话凭据存入本设备 Keychain。账号服务和练习数据使用 Supabase。</p>
        <p>练习的文字消息、字幕、纠错、收藏词汇、目标、背景和自建场景保存在本机，登录后同步到账号。网页和 App 共用账号数据。我们还保存与账号关联的 AI 功能、模型、调用时间及 token 用量，以提供用量记录和维护服务。</p>
        <h2>Google Gemini 与语音</h2>
        <p>使用 AI 前，App 会单独询问你的许可。允许后，输入文字、场景描述、练习目标及相关上下文会经 LingDaily 服务发送给 Google Gemini，用于回复、翻译、建议、纠错和生成场景。实时语音通话会把麦克风音频发送给 Gemini，接收模型音频和文字转录；连接可能经过我们管理的东京中转，因此数据可能跨境传输。</p>
        <p>LingDaily 不存储原始通话录音，但会保存和同步对话文字。Google 对请求的处理和保留受实际适用的 <a href="https://ai.google.dev/gemini-api/terms">Gemini API 条款</a>和 <a href="https://policies.google.com/privacy">Google 隐私政策</a>约束；我们不承诺第三方零留存。请勿输入身份凭证、商业机密或其他敏感信息。</p>
        <p>文字模式的系统听写仅在设备支持离线识别时使用，不回退云端听写。系统朗读用于文字模式；实时通话使用 Gemini 生成的音频。麦克风及系统听写权限独立于 AI 数据授权。</p>
        <h2>选择、保留与删除</h2>
        <p>可在「我的 → AI 数据使用」拒绝或撤回 AI 授权，停止后续 AI 请求；仍可查看已有记录。可在系统设置中关闭麦克风或听写权限。撤回授权不会自动删除已有云端记录或撤回已发送给第三方的数据。</p>
        <p>云端记录保留以供你回看和跨设备同步，直到被删除。退出登录会清除当前账号在本设备的记录，尚未同步的改动可能丢失；云端记录会在再次登录后恢复。卸载 App 不等于删除云端账号。</p>
        <p>在「我的 → 账号与数据 → 删除账号」通过 Apple 再次确认，可永久删除账号及其云端练习、词库、自建场景和用量记录，包括同账号的网页数据。其他设备已下载的本机副本及服务提供商按自身政策保存的数据不在此操作的即时删除范围内。对数据访问或删除有疑问，请联系我们。</p>
        <h2>安全与追踪</h2>
        <p>正式服务通过 HTTPS/WSS 传输；模型私钥留在服务端。App 不包含广告或跨 App 追踪 SDK，不出售个人数据。运行服务的基础设施可能处理网络地址和必要的安全日志。不要把 AI 回复当作专业建议，生成内容可能不准确。</p>
        <h2>政策变更与联系</h2>
        <p>本页会公布政策更新。AI 数据用途有实质变化时会重新征求授权。隐私问题请发送邮件至 <a href="mailto:yoasobi996@gmail.com">yoasobi996@gmail.com</a>，不要发送密码、会话凭据或原始录音。</p>
        <p><Link href="/support">帮助与联系</Link></p>
      </article>
    </main>
  )
}
