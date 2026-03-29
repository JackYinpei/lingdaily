'use client'

import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/app/components/ui/button'
import ThemeToggle from '@/app/components/ThemeToggle'

export default function Navbar() {
  const { data: session, status } = useSession()

  return (
    <header className="w-full border-b border-border bg-card text-card-foreground">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold">LingDaily</Link>
          {status === 'authenticated' && (
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/talk" className="hover:underline">对话</Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {status === 'authenticated' ? (
            <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: '/' })}>
              退出登录
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/sign-in">登录</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
