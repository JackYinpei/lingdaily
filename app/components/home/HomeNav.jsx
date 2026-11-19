'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu, Monitor, Moon, Sun, X } from 'lucide-react'
import { useTheme } from '@/app/contexts/ThemeContext'

export default function HomeNav({ t, signedIn, signOutAction }) {
  const [open, setOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun
  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        document.getElementById('home-menu-toggle')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="home-nav-wrap">
      <button
        type="button"
        id="home-menu-toggle"
        className="home-menu-toggle"
        aria-label={open ? t.nav.close : t.nav.open}
        aria-expanded={open}
        aria-controls="home-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      <nav
        id="home-navigation"
        className={`home-navigation${open ? ' is-open' : ''}`}
        aria-label={t.nav.label}
        onClick={(event) => {
          if (event.target.closest('a')) setOpen(false)
        }}
      >
        <Link href={signedIn ? '/talk' : '#features'}>
          {signedIn ? t.nav.talk : t.nav.features}
        </Link>
        <Link href={signedIn ? '/history' : '#how'}>
          {signedIn ? t.nav.history : t.nav.how}
        </Link>
        <Link href="/podcasts">{t.nav.podcasts}</Link>
        <button
          type="button"
          className="home-theme-toggle"
          onClick={toggleTheme}
          aria-label={`${t.nav.theme}: ${theme}`}
          title={`${t.nav.theme}: ${theme}`}
        >
          <ThemeIcon size={17} aria-hidden="true" />
        </button>
        {signedIn ? (
          <form action={signOutAction}>
            <button className="home-nav-signin">{t.nav.signOut}</button>
          </form>
        ) : (
          <Link className="home-nav-signin" href="/sign-in">
            {t.nav.signIn}
            <span aria-hidden="true">↗</span>
          </Link>
        )}
        <a className="home-mobile-start" href="#start">
          {signedIn ? t.continue : t.start}
        </a>
      </nav>
    </div>
  )
}
