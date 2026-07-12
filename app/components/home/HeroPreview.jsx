import { Bot, Sparkles, Volume2, User } from 'lucide-react'

// Static, non-interactive mock of the live AI conversation. It showcases two
// real product features visually: unfamiliar-word extraction (highlighted terms
// in the user's reply) and AI correction (the suggestion card). No network.
export default function HeroPreview({ t }) {
  return (
    <div className="rounded-3xl border border-border bg-card/70 p-4 shadow-xl backdrop-blur-md sm:p-5">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-brand" aria-hidden />
          {t.preview.title}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand">Lv.12</span>
          <span>🔥 {t.preview.streak}</span>
        </div>
      </div>

      {/* topic + dialogue */}
      <div className="rounded-2xl border border-border bg-background/60 p-4">
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-0.5">{t.preview.topic}</span>
          <span>{t.preview.source}: BBC News</span>
        </div>
        <p className="text-sm font-semibold">Space exploration: A new era of discovery</p>
        <p className="mb-4 text-xs text-muted-foreground">太空探索：发现的新时代</p>

        {/* AI bubble */}
        <div className="mb-3 flex items-start gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
            <Bot className="size-4" aria-hidden />
          </span>
          <div className="flex-1 rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm">
            What do you think is the biggest benefit of space exploration for humanity?
          </div>
          <Volume2 className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>

        {/* user bubble with highlighted unfamiliar terms */}
        <div className="mb-1 flex items-start justify-end gap-2">
          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand/15 px-3 py-2 text-sm">
            I think it brings{' '}
            <mark className="rounded bg-brand/25 px-1 text-brand">advanced technology</mark> and{' '}
            <mark className="rounded bg-brand/25 px-1 text-brand">inspires</mark> future generations.
          </div>
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
            <User className="size-4" aria-hidden />
          </span>
        </div>
      </div>

      {/* correction suggestion card */}
      <div className="mt-4 rounded-2xl border border-brand/30 bg-brand/5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-brand">
            <Sparkles className="size-4" aria-hidden />
            {t.preview.correctTitle}
          </span>
          <Volume2 className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <p className="text-sm">Great answer! ✨</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.preview.correctBody}</p>
        <p className="mt-1 text-sm text-brand">
          I think it brings advanced technology and inspires future generations.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-border bg-background px-2 py-1">
            advanced → advanced
          </span>
          <span className="rounded-full border border-border bg-background px-2 py-1">
            inspires → inspires
          </span>
          <span className="rounded-full border border-border bg-background px-2 py-1">
            {t.preview.grammar}
          </span>
        </div>
      </div>
    </div>
  )
}
