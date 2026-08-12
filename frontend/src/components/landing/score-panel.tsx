"use client";

import { useLang } from "@/lib/language";
import { formatNumber } from "@/lib/pricing";
import { Figure } from "./figure";

/* ========================================================================
   HERO VISUAL 1 — THE ATS SCORE PANEL (brief §3.1)

   TRACED TO THE REAL COMPONENT, not invented. The previous version showed
   "ATS score / Keyword match / Formatting", and only the first of those
   exists in the product: there is no formatting score anywhere in the
   pipeline. What the dashboard actually renders after a generation
   (app/dashboard/page.tsx, the ATS card) is an overall score plus a
   four-factor breakdown, and those four factors are exactly the ones
   utils/ats_scorer.py computes and weighs:

       keyword_match 40%   skills_match 35%
       education_match 15% experience_match 10%

   The labels below are the same strings the dashboard uses in each language.

   THE OVERALL SCORE IS COMPUTED, NOT TYPED. ats_scorer.py's composite is
   sum(rate_i * weight_i) * 100, so writing an unrelated headline number next
   to a breakdown that does not produce it would be a picture of something the
   product cannot output. OVERALL is derived from FACTORS here for the same
   reason, which also means changing a factor cannot silently desync the two.

   NO RING, NO DONUT, NO ARC. The dashboard uses a ScoreRing; a ring is
   dashboard language, and an SVG stroke-dashoffset circle is exactly the
   thing that fails to close cleanly. Scores are set as leader rules — label,
   a rule that fills to its value, a figure — which is how a typeset table of
   contents works and is the language this page already speaks.

   THE MEASURING LOOPS; THE PANEL DOES NOT. Content sets once on entry and
   stays. What repeats is the scoring: rules empty and refill, figures
   recount. An earlier draft cleared and rebuilt the whole panel every cycle,
   which reads as a glitch rather than as life.
======================================================================== */

/** Mirrors WEIGHTS in backend/utils/ats_scorer.py. */
const WEIGHTS = {
  keywords: 0.4,
  skills: 0.35,
  education: 0.15,
  experience: 0.1,
} as const;

type FactorKey = keyof typeof WEIGHTS;

const FACTORS: { key: FactorKey; value: number }[] = [
  { key: "keywords", value: 94 },
  { key: "skills", value: 88 },
  { key: "education", value: 100 },
  { key: "experience", value: 76 },
];

/** The composite, by the scorer's own formula. Comes out at 91. */
const OVERALL = Math.round(
  FACTORS.reduce((total, factor) => total + factor.value * WEIGHTS[factor.key], 0),
);

export function ScorePanel() {
  const { t, lang } = useLang();
  const copy = t.heroScore;

  return (
    <figure
      className="relative m-0 overflow-hidden rounded-[0.25rem]"
      style={{
        backgroundColor: "var(--surface-paper)",
        // A sheet of paper lit from above, not a card with a border. Two
        // stacked shadows read as thickness rather than as glow.
        boxShadow:
          "0 1px 0 0 rgb(255 255 255 / 0.35) inset, 0 18px 40px -12px rgb(0 0 0 / 0.55), 0 2px 8px -2px rgb(0 0 0 / 0.4)",
      }}
      aria-label={t.hero.scoreAlt}
    >
      <div className="p-6 sm:p-8">
        {/* ── the headline number ── */}
        <div className="rise flex items-end justify-between gap-4" style={{ ["--rise-delay" as string]: "0.05s" }}>
          <div className="min-w-0">
            <p className="t-title font-semibold" style={{ color: "var(--ink-paper)" }}>
              {copy.title}
            </p>
            <p className="t-meta mt-1 max-w-[30ch]" style={{ color: "var(--ink-paper-soft)" }}>
              {copy.sub}
            </p>
          </div>
          <Figure
            value={OVERALL}
            delay={0.15}
            className="shrink-0 text-[2.75rem] font-semibold leading-none tracking-tight"
            style={{ color: "var(--ink-paper)" }}
          />
        </div>

        {/* ── the four factors ── */}
        <div className="mt-7 border-t pt-6" style={{ borderColor: "#e2e2de" }}>
          <div className="space-y-4 sm:space-y-[1.15rem]">
            {FACTORS.map((factor, i) => {
              const delay = 0.35 + i * 0.12;
              return (
                <div key={factor.key} className="rise flex items-center gap-2.5 sm:gap-3.5" style={{ ["--rise-delay" as string]: `${delay}s` }}>
                  {/* Wide enough on a phone for the longest Arabic label,
                      "الكلمات المفتاحية", to stay on one line. Narrower and it
                      wrapped, which made that one row taller than the other
                      three and broke the comparison the rules exist to make. */}
                  <span
                    className="t-meta w-[7.25rem] shrink-0 truncate text-[0.8125rem] sm:w-[7rem]"
                    style={{ color: "var(--ink-paper)" }}
                  >
                    {copy.factors[factor.key]}
                  </span>
                  {/* The weight each factor carries, which is the number the
                      dashboard's explainer puts in a chip beside it. It is the
                      whole of "transparent ATS scoring" in one glance. */}
                  <span
                    className="t-meta w-8 shrink-0 text-[0.6875rem] tabular-nums"
                    style={{ color: "var(--ink-paper-soft)" }}
                  >
                    {formatNumber(Math.round(WEIGHTS[factor.key] * 100), lang)}%
                  </span>
                  {/* A track at full width and a fill scaled to the value, so
                      the geometry is a single transform and stays on the
                      compositor. */}
                  <span
                    className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full"
                    style={{ backgroundColor: "#e5e5e1" }}
                  >
                    <span
                      className="leader-fill absolute inset-0 rounded-full"
                      style={{
                        backgroundColor: "var(--accent)",
                        ["--leader-to" as string]: factor.value / 100,
                        ["--rise-delay" as string]: `${delay}s`,
                      }}
                    />
                  </span>
                  <Figure
                    value={factor.value}
                    delay={delay}
                    className="w-7 shrink-0 text-end text-[0.9375rem] font-semibold tabular-nums"
                    style={{ color: "var(--ink-paper)" }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* ── what it did NOT find. atsBreakdown.missing_skills in the real
              response. Showing the gap is the point: a score that only ever
              flatters is not a score. ── */}
        <p
          className="rise t-meta mt-6 border-t pt-5 text-[0.8125rem]"
          style={{ ["--rise-delay" as string]: "0.85s", borderColor: "#e2e2de", color: "var(--ink-paper-soft)" }}
        >
          {copy.missingLabel} {copy.missing.join(lang === "ar" ? "، " : ", ")}
        </p>
      </div>
    </figure>
  );
}
