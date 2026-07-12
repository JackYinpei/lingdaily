import { TrendingUp } from 'lucide-react'

// Static preview of the learning dashboard shown on the right of the hero. The
// real, data-backed version lives at /progress; this mirrors its look so the
// landing page previews what a signed-in learner sees. All copy comes from the
// homepage i18n dictionary.
function ProgressRing({ percent }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - percent / 100)
  return (
    <svg viewBox="0 0 80 80" className="size-20 -rotate-90" aria-hidden>
      <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
      <circle
        cx="40"
        cy="40"
        r={radius}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        stroke="url(#ring-grad)"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-from)" />
          <stop offset="100%" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function StatsPanel({ t }) {
  const week = [40, 55, 48, 70, 60, 95, 80]
  const days = t.week.days

  return (
    <div className="flex flex-col gap-4">
      {/* Today's progress */}
      <div className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur">
        <p className="mb-3 text-sm font-semibold">{t.today.title}</p>
        <div className="flex items-center gap-4">
          <div className="relative grid place-items-center">
            <ProgressRing percent={75} />
            <div className="absolute text-center">
              <span className="block text-lg font-bold leading-none">75%</span>
              <span className="block text-[10px] text-muted-foreground">{t.today.goal}</span>
            </div>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">{t.today.minutes}</p>
            <p className="text-2xl font-bold">
              22<span className="text-sm font-normal text-muted-foreground"> / 30 {t.today.min}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Vocabulary mastery */}
      <div className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur">
        <p className="mb-3 text-sm font-semibold">{t.vocab.title}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{t.vocab.known}</p>
            <p className="text-2xl font-bold">12</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{t.vocab.rate}</p>
            <p className="text-2xl font-bold text-brand">68%</p>
          </div>
          <TrendingUp className="size-8 text-brand/60" aria-hidden />
        </div>
      </div>

      {/* Weekly volume */}
      <div className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">{t.week.title}</p>
          <span className="text-xs text-muted-foreground">{t.week.total}: 3.6h</span>
        </div>
        <div className="flex h-24 items-end justify-between gap-1.5" aria-hidden>
          {week.map((h, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-gradient-to-t from-brand-from to-brand-to"
                style={{ height: `${h}%` }}
              />
              <span className="text-[10px] text-muted-foreground">{days[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
