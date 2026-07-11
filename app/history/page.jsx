import { redirect } from 'next/navigation'

import { auth } from '@/app/auth'

import HistoryClient from './history-client'

export const metadata = {
  title: '对话历史 | LingDaily',
  description: '查看并继续你的 LingDaily 学习对话。',
}

export default async function HistoryPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/sign-in?callbackUrl=%2Fhistory')
  }

  return <HistoryClient />
}
