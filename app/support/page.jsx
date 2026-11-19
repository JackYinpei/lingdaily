import Link from 'next/link'

export const metadata = {
  title: 'LingDaily 帮助与联系',
  description: '登录、语音练习、同步与删除账号帮助。',
  alternates: { canonical: '/support' },
}

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <Link href="/" className="text-primary underline">LingDaily</Link>
      <article className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
        <h1>LingDaily 帮助与联系</h1>
        <p>支持邮箱：<a href="mailto:yoasobi996@gmail.com">yoasobi996@gmail.com</a>。反馈网页版问题时请提供浏览器、设备、发生时间和操作步骤；反馈 App 问题时请提供 App 与 iOS 版本。请勿发送密码、登录凭据或敏感对话。</p>
        <h2 id="web">网页版</h2>
        <p>在首页选择母语和目标语言，再点击开始练习。未登录时会先进入登录页，登录后继续前往对话页；网页版支持邮箱密码，以及登录页实际显示的第三方登录方式。<Link href="/podcasts">双语新闻播客</Link>无需登录即可浏览。</p>
        <p>在<Link href="/talk">对话页</Link>选择新闻或角色扮演场景，再连接语音。请使用支持麦克风的浏览器并允许本站访问麦克风。没有声音时，检查浏览器标签页是否静音、系统音量和网站麦克风权限；连接中断后可断开并重新连接。</p>
        <p>练习记录、生词和学习进度分别在<Link href="/history">历史</Link>、<Link href="/vocabulary">生词本</Link>和<Link href="/progress">学习进度</Link>查看。请等待保存完成后再关闭页面。如需账号或数据删除帮助，请通过上方邮箱联系我们；不要通过邮件发送密码。</p>
        <h2>iOS App</h2>
        <h2>开始练习</h2>
        <p>AI 练习面向年满 18 周岁的成年人。通过 Apple 登录，选择预设场景或创建自己的场景，确认年龄并允许 AI 数据使用。准备页可以选择语音或文字。拒绝麦克风权限后仍可打字练习。当前 iOS 版面向中文母语的英语场景练习，尚不包含网页版的新闻和播客。</p>
        <h2>通话没有声音或断开</h2>
        <p>检查网络、系统音量和「设置 → LingDaily」的麦克风权限。结束通话后重新连接；切到后台、来电或系统音频中断会结束当前连接，回来后需手动重连。静音只关闭你的麦克风，对方仍可说话。AI 服务暂时不可用时，可稍后重试。</p>
        <h2>记录与同步</h2>
        <p>在「学习」查看历史和词库，在「我的」查看同步状态。出现同步失败时，保持网络可用并点击重新同步。退出登录前请等待上传完成，以免丢失本机待同步改动。</p>
        <h2>撤回授权或删除账号</h2>
        <p>在「我的」撤回 AI 数据使用授权，可以停止新的 AI 请求。在「我的 → 账号与数据 → 删除账号」用同一 Apple ID 再次确认，可永久删除包括网页版在内的账号与云端数据。此操作无法撤销。卸载 App 或退出登录不会删除云端账号。</p>
        <p><Link href="/privacy">隐私政策</Link></p>
      </article>
    </main>
  )
}
