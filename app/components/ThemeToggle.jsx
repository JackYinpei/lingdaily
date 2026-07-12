'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { useTheme } from '@/app/contexts/ThemeContext'

const LABELS = { system: '跟随系统', dark: '深色', light: '浅色' }

export default function ThemeToggle() {
  const { theme, resolvedTheme, toggleTheme } = useTheme()
  const label = LABELS[theme] || LABELS.system
  const Icon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      title={`主题：${label}（当前 ${resolvedTheme}）`}
    >
      <Icon className="size-4" aria-hidden />
      <span>{label}</span>
    </Button>
  )
}


