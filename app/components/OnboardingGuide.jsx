"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const STORAGE_KEY = "onboarding-completed";

const STEPS_ZH = [
  {
    target: '[data-tour="mode-toggle"]',
    title: "切换模式",
    description: "选新闻聊观点\n或选场景练对话",
    position: "bottom",
    showSkipMode: true,
  },
  {
    target: '[data-tour="category-bar"]',
    title: "选择分类",
    description: "左右滑动分类\n选一个想聊的话题",
    position: "bottom",
  },
  {
    target: '[data-tour="news-card"]',
    title: "选择内容",
    description: "点选新闻或场景卡片\n作为这次对话的话题",
    position: "bottom",
  },
  {
    target: '[data-tour="connect-btn"]',
    title: "开始对话",
    description: "点击连接按钮\n允许使用麦克风后就能开始",
    position: "top",
  },
];

const STEPS_EN = [
  {
    target: '[data-tour="mode-toggle"]',
    title: "Switch Mode",
    description: "Choose News to discuss a story\nor Scenarios to try a role play",
    position: "bottom",
    showSkipMode: true,
  },
  {
    target: '[data-tour="category-bar"]',
    title: "Browse Categories",
    description: "Swipe through the categories\nand choose a topic",
    position: "bottom",
  },
  {
    target: '[data-tour="news-card"]',
    title: "Pick a Topic",
    description: "Select a news story or scenario\nfor this conversation",
    position: "bottom",
  },
  {
    target: '[data-tour="connect-btn"]',
    title: "Start Talking",
    description: "Select Connect\nand allow microphone access to speak",
    position: "top",
  },
];

const STEPS_JA = [
  {
    target: '[data-tour="mode-toggle"]',
    title: "モード切替",
    description: "ニュースについて話す\nシナリオで会話を練習する",
    position: "bottom",
    showSkipMode: true,
  },
  {
    target: '[data-tour="category-bar"]',
    title: "カテゴリを選ぶ",
    description: "カテゴリを左右にスワイプして\n話題を選んでください",
    position: "bottom",
  },
  {
    target: '[data-tour="news-card"]',
    title: "トピックを選ぶ",
    description: "ニュースやシナリオのカードを選んで\n今回の話題にします",
    position: "bottom",
  },
  {
    target: '[data-tour="connect-btn"]',
    title: "会話を始める",
    description: "接続ボタンをタップして\nマイクを許可すると話せます",
    position: "top",
  },
];

const STEPS_MAP = { zh: STEPS_ZH, en: STEPS_EN, ja: STEPS_JA };

const UI = {
  zh: { next: "下一步", skip: "跳过", done: "知道了", skipMode: "跳过（使用新闻模式）", stepOf: (c, t) => `${c} / ${t}` },
  en: { next: "Next", skip: "Skip", done: "Done", skipMode: "Skip (use News mode)", stepOf: (c, t) => `${c} / ${t}` },
  ja: { next: "次へ", skip: "スキップ", done: "閉じる", skipMode: "スキップ（ニュースモード）", stepOf: (c, t) => `${c} / ${t}` },
};

export default function OnboardingGuide({ lang = "zh", onSkipToNews }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState(null);
  const rafRef = useRef(null);
  const missingTimerRef = useRef(null);
  const normalizedLang = STEPS_MAP[lang] ? lang : "en";
  const steps = STEPS_MAP[normalizedLang];
  const ui = UI[normalizedLang];

  // Check if onboarding was already completed
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch (_) {}
    // Small delay to let the page render
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  // Find the first *visible* element matching the selector
  // (mobile and desktop render duplicate elements — one is display:none)
  const findVisibleTarget = useCallback((selector) => {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }, []);

  // Track target element position
  const updateRect = useCallback(() => {
    if (!visible || step >= steps.length) return;
    const el = findVisibleTarget(steps[step].target);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    } else {
      setRect(null);
    }
    rafRef.current = requestAnimationFrame(updateRect);
  }, [visible, step, steps, findVisibleTarget]);

  useEffect(() => {
    if (!visible) return;
    rafRef.current = requestAnimationFrame(updateRect);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, updateRect]);

  // Auto-skip if target element can't be found within 2s
  // (e.g. mobile category bar hidden because a news is already selected)
  useEffect(() => {
    if (!visible || step >= steps.length) return;
    if (missingTimerRef.current) clearTimeout(missingTimerRef.current);
    missingTimerRef.current = setTimeout(() => {
      const el = findVisibleTarget(steps[step].target);
      if (!el) {
        // Skip to the next step (or finish if last)
        if (step >= steps.length - 1) {
          setVisible(false);
          try { localStorage.setItem(STORAGE_KEY, "1"); } catch (_) {}
        } else {
          setStep((s) => s + 1);
        }
      }
    }, 2000);
    return () => {
      if (missingTimerRef.current) clearTimeout(missingTimerRef.current);
    };
  }, [visible, step, steps, findVisibleTarget]);

  const finish = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch (_) {}
  }, []);

  const next = useCallback(() => {
    if (step >= steps.length - 1) {
      finish();
    } else {
      setStep((s) => s + 1);
    }
  }, [step, steps.length, finish]);

  if (!visible) return null;

  // Element not yet in DOM (e.g. news cards still loading) — render a
  // semi-transparent waiting overlay; the rAF loop keeps polling until it appears
  if (!rect) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center">
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-[280px] text-center">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {normalizedLang === "zh" ? "加载中..." : normalizedLang === "ja" ? "読み込み中..." : "Loading..."}
          </p>
          <button
            onClick={finish}
            className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {ui.skip}
          </button>
        </div>
      </div>,
      document.body
    );
  }

  const padding = 8;
  const spotTop = rect.top - padding;
  const spotLeft = rect.left - padding;
  const spotW = rect.width + padding * 2;
  const spotH = rect.height + padding * 2;

  const currentStep = steps[step];
  const isLast = step === steps.length - 1;

  // Compute tooltip position
  let tooltipStyle = {};
  const tooltipMaxW = 300;
  if (currentStep.position === "bottom") {
    tooltipStyle = {
      top: spotTop + spotH + 16,
      left: Math.max(16, Math.min(spotLeft + spotW / 2 - tooltipMaxW / 2, window.innerWidth - tooltipMaxW - 16)),
    };
  } else {
    tooltipStyle = {
      top: spotTop - 16,
      left: Math.max(16, Math.min(spotLeft + spotW / 2 - tooltipMaxW / 2, window.innerWidth - tooltipMaxW - 16)),
      transform: "translateY(-100%)",
    };
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      style={{ pointerEvents: "auto" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Overlay with spotlight cutout using CSS clip-path */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={spotLeft}
              y={spotTop}
              width={spotW}
              height={spotH}
              rx={12}
              ry={12}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.65)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Spotlight border glow */}
      <div
        className="absolute rounded-xl ring-2 ring-primary/80 shadow-[0_0_20px_rgba(59,130,246,0.5)]"
        style={{
          top: spotTop,
          left: spotLeft,
          width: spotW,
          height: spotH,
          pointerEvents: "none",
          transition: "all 0.3s ease",
        }}
      />

      {/* Tooltip card */}
      <div
        className="absolute bg-card border border-border rounded-2xl shadow-2xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{
          ...tooltipStyle,
          width: tooltipMaxW,
          pointerEvents: "auto",
          zIndex: 10000,
        }}
      >
        {/* Step indicator */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium">
            {ui.stepOf(step + 1, steps.length)}
          </span>
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? "w-5 bg-primary" : i < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
        </div>

        <h3 className="text-base font-semibold text-card-foreground mb-1">{currentStep.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line mb-4">{currentStep.description}</p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={finish}
            className="min-h-11 shrink-0 whitespace-nowrap text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {ui.skip}
          </button>
          <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
            {currentStep.showSkipMode && (
              <button
                onClick={() => {
                  onSkipToNews?.();
                  finish();
                }}
                className="text-sm px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-accent transition-colors"
              >
                {ui.skipMode}
              </button>
            )}
            <button
              onClick={next}
              className="min-h-11 shrink-0 whitespace-nowrap text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors"
            >
              {isLast ? ui.done : ui.next}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
