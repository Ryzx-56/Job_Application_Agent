"use client";

import { useEffect, useRef, useState } from "react";
import { Coins, Sparkles } from "lucide-react";

interface CreditsButtonProps {
  creditsRemaining: number;
  creditsTotal: number;
  lang?: "en" | "ar";
  /** Optional — pass to make the popover's "Upgrade" button go somewhere. */
  upgradeHref?: string;
}

/* ========================================================================
   CREDITS BUTTON — v2. Redesigned to actually get noticed: gradient pill,
   glow shadow, pulsing icon ring, bigger type. Switches to an amber/red
   "low balance" look under 15% remaining so it doubles as a warning, not
   just a display.
======================================================================== */
export function CreditsButton({ creditsRemaining, creditsTotal, lang = "en", upgradeHref = "/dashboard/settings" }: CreditsButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const pct = creditsTotal > 0 ? creditsRemaining / creditsTotal : 0;
  const isLow = pct <= 0.15;
  const isEmpty = creditsRemaining <= 0;

  const copy = {
    en: {
      credits: "credits left",
      title: "Credit usage",
      english: "English CV",
      arabic: "Arabic CV",
      englishCost: "1 credit",
      arabicCost: "2 credits",
      note: "Arabic CVs take more processing, so they use more credits.",
      lowWarning: "You're almost out of credits.",
      emptyWarning: "You're out of credits for this cycle.",
      upgrade: "Upgrade plan",
    },
    ar: {
      credits: "رصيد متبقٍ",
      title: "استخدام الرصيد",
      english: "سيرة ذاتية بالإنجليزية",
      arabic: "سيرة ذاتية بالعربية",
      englishCost: "نقطة واحدة",
      arabicCost: "نقطتان",
      note: "السير الذاتية بالعربية تتطلب معالجة أكبر، لذلك تستهلك نقاطًا أكثر.",
      lowWarning: "رصيدك أوشك على النفاد.",
      emptyWarning: "نفد رصيدك لهذه الدورة.",
      upgrade: "ترقية الخطة",
    },
  }[lang];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`group relative inline-flex items-center gap-3 overflow-hidden rounded-2xl px-4 py-2.5 text-white shadow-lg ring-1 ring-white/20 transition-transform hover:scale-[1.03] active:scale-[0.98] ${
          isLow
            ? "bg-gradient-to-r from-amber-500 to-rose-500 shadow-rose-500/30"
            : "bg-gradient-to-r from-blue-600 to-cyan-500 shadow-blue-500/30"
        }`}
      >
        {/* diagonal sheen, purely decorative */}
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
          <Coins className="size-4.5 text-white" aria-hidden />
          {isLow && (
            <span
              className="absolute inset-0 rounded-full bg-white/30"
              style={{ animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite" }}
            />
          )}
        </span>

        <span className="relative text-start leading-tight">
          <span className="block text-lg font-bold tabular-nums">{creditsRemaining}</span>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-white/75">{copy.credits}</span>
        </span>
      </button>

      {open && (
        <div className="absolute end-0 z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className={`px-4 py-3 ${isLow ? "bg-gradient-to-r from-amber-500 to-rose-500" : "bg-gradient-to-r from-blue-600 to-cyan-500"}`}>
            <p className="text-sm font-semibold text-white">{copy.title}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${Math.max(pct * 100, 4)}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-white/85">
              {creditsRemaining} / {creditsTotal} {copy.credits}
            </p>
          </div>

          <div className="p-4">
            {(isLow || isEmpty) && (
              <p className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${isEmpty ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                {isEmpty ? copy.emptyWarning : copy.lowWarning}
              </p>
            )}

            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex items-center justify-between">
                <span>{copy.english}</span>
                <span className="font-medium text-slate-900">{copy.englishCost}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{copy.arabic}</span>
                <span className="font-medium text-slate-900">{copy.arabicCost}</span>
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{copy.note}</p>

            {(isLow || isEmpty) && (
              <a
                href={upgradeHref}
                className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
              >
                <Sparkles className="size-3.5" aria-hidden />
                {copy.upgrade}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
