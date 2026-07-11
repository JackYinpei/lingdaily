import { redirect } from 'next/navigation'

import { auth } from '@/app/auth'

import ProgressClient from './progress-client'

export const metadata = {
  title: '学习进度 | LingDaily',
  description: '查看你的 LingDaily 对话练习数据和连续学习天数。',
}

export default async function ProgressPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/sign-in?callbackUrl=%2Fprogress')
  }

  return <ProgressClient />
}
