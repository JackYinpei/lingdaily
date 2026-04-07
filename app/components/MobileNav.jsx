'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import ThemeToggle from '@/app/components/ThemeToggle'

export default function MobileNav({ t, signedIn, signOutAction }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="lg:hidden">
      {/* Hamburger button */}
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-md text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 border-b border-border bg-background shadow-md">
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-4">
            {signedIn ? (
              <>
                <Link
                  href="/talk"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {t.nav.talk}
                </Link>
                <ThemeToggle />
                <form action={signOutAction}>
                  <Button variant="outline" className="w-full font-semibold">
                    {t.nav.signOut}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="#features"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {t.nav.features}
                </Link>
                <Link
                  href="#how-it-works"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {t.nav.how}
                </Link>
                <Link
                  href="#testimonials"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {t.nav.reviews}
                </Link>
                <ThemeToggle />
                <Link href="/sign-in" onClick={() => setOpen(false)}>
                  <Button variant="outline" className="w-full font-semibold">
                    {t.nav.signIn}
                  </Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  )
}
