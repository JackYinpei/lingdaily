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
        <p>支持邮箱：<a href="mailto:yoasobi996@gmail.com">yoasobi996@gmail.com</a>。反馈网页版问题时请提供浏览器、设备、发生时间和操作步骤；反馈 App 问题时请提供 App 版本以及 iOS 或 Android 版本。请勿发送密码、登录凭据或敏感对话。</p>
        <h2 id="web">网页版</h2>
        <p>在首页选择母语和目标语言，再点击开始练习。未登录时会先进入登录页，登录后继续前往对话页；网页版支持邮箱密码，以及登录页实际显示的第三方登录方式。<Link href="/podcasts">双语新闻播客</Link>无需登录即可浏览。</p>
        <p>在<Link href="/talk">对话页</Link>选择新闻或角色扮演场景，再连接语音。请使用支持麦克风的浏览器并允许本站访问麦克风。没有声音时，检查浏览器标签页是否静音、系统音量和网站麦克风权限；连接中断后可断开并重新连接。</p>
        <p>练习记录、生词和学习进度分别在<Link href="/history">历史</Link>、<Link href="/vocabulary">生词本</Link>和<Link href="/progress">学习进度</Link>查看。请等待保存完成后再关闭页面。如需账号或数据删除帮助，请通过上方邮箱联系我们；不要通过邮件发送密码。</p>
        <h2 id="app">iOS / Android App</h2>
        <h2>开始练习</h2>
        <p>打开 App 即可浏览内置场景、收听每日播客，不需要登录。App 不内置 AI 模型：到「我的 → 接口设置」填入自己的 Google Gemini 或 OpenAI API Key，以及文字模型和实时语音模型（可点「获取模型列表」选择），保存后回到场景，在准备页选择「文字对话」或「语音通话」开始。拒绝麦克风权限后仍可打字练习。App 面向成年人，当前面向中文母语的英语场景练习。</p>
        <h2>接口地址</h2>
        <p>接口地址留空即直连 Google 或 OpenAI 官方。手机网络无法直连时，可填写能访问的中转地址，例如 Gemini 填 <code>https://lingdailyapi-jp.yasobi.xyz</code>，OpenAI 填 <code>https://lingdailyapi-jp.yasobi.xyz/openai</code>。提示 API Key 无效、找不到模型或额度不足时，请在对应服务商的控制台检查 Key、模型名称和余额。</p>
        <h2>通话没有声音或断开</h2>
        <p>检查网络、系统音量和系统设置里 LingDaily 的麦克风权限，以及接口设置里的实时语音模型。结束通话后重新连接；iPhone 切到后台、来电或系统音频中断会结束当前连接，回来后需手动重连。静音只关闭你的麦克风，对方仍可说话。</p>
        <h2>记录与同步</h2>
        <p>账号是可选的：iOS 用 Apple 登录，Android 用 LingDaily 账号的邮箱或手机号和密码。登录后练习记录、词库、自建场景和接口设置会在设备之间同步。在「学习」查看历史和词库，在「我的」查看同步状态；同步失败时保持网络可用并点击重新同步。退出登录会清除本机记录和接口设置，请先等待上传完成。</p>
        <h2>删除账号</h2>
        <p>在「我的 → 账号与数据 → 删除账号」再次确认（iOS 用同一 Apple ID，Android 输入密码），可永久删除包括网页版在内的账号与云端数据。此操作无法撤销。卸载 App 或退出登录不会删除云端账号。</p>
        <p><Link href="/privacy">隐私政策</Link></p>
      </article>
    </main>
  )
}
