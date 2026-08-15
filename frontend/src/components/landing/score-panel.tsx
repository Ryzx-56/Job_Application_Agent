"use client";

import { useLang } from "@/lib/language";
import { Figure } from "./figure";

/* ========================================================================
   HERO VISUAL 1 — THE ATS SCORE PANEL (brief §3.1)

   TRACED TO THE REAL COMPONENT, not invented. The previous version showed
   "ATS score / Keyword match / Formatting", and only the first of those
   exists in the product: there is no formatting score anywhere in the
   pipeline. What the dashboard actually renders after a generation
   (app/dashboard/page.tsx, the ATS card) is an overall score plus a
   weighted breakdown, and those factors are exactly the ones
   utils/ats_scorer.py computes and weighs:

       skills_match 40%   keyword_match 25%   title_match 15%
       experience_match 12%   education_match 8%

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
  skills: 0.4,
  keywords: 0.25,
  title: 0.15,
  experience: 0.12,
  education: 0.08,
} as const;

type FactorKey = keyof typeof WEIGHTS;

const FACTORS: { key: FactorKey; value: number }[] = [
  { key: "skills", value: 88 },
  { key: "keywords", value: 94 },
  { key: "title", value: 90 },
  { key: "experience", value: 100 },
  { key: "education", value: 100 },
];

/** The composite, by the scorer's own formula. Comes out at 92. */
const OVERALL = Math.round(
  FACTORS.reduce((total, factor) => total + factor.value * WEIGHTS[factor.key], 0),
);

export function ScorePanel() {
  const { t, lang } = useLang();
  const copy = t.heroScore;

  return (
    <figure
      className="relative m-0 overflow-hidden rounded-[0.875rem]"
      style={{
        backgroundColor: "var(--surface-paper)",
        // A sheet of paper lit from above, not a card with a border. Two
        // stacked shadows read as thickness rather than as glow.
        boxShadow:
          "0 1px 0 0 rgb(255 255 255 / 0.5) inset, 0 1px 2px 0 rgb(0 0 0 / 0.28), 0 12px 24px -10px rgb(0 0 0 / 0.4), 0 32px 64px -24px rgb(0 0 0 / 0.55)",
      }}
      aria-label={t.hero.scoreAlt}
    >
      <div className="p-6 sm:p-8">
        {/* ── the headline number ── */}
        <div className="rise flex items-center justify-between gap-4" style={{ ["--rise-delay" as string]: "0.05s" }}>
          <p className="t-title font-semibold" style={{ color: "var(--ink-paper)" }}>
            {copy.title}
          </p>
          <Figure
            value={OVERALL}
            delay={0.15}
            className="shrink-0 text-[3rem] font-semibold leading-none tracking-[-0.02em]"
            style={{ color: "var(--ink-paper)" }}
          />
        </div>

        {/* ── the weighted factors ── */}
        <div className="mt-7 border-t pt-6" style={{ borderColor: "#e2e2de" }}>
          <div className="space-y-[1.15rem] sm:space-y-[1.35rem]">
            {FACTORS.map((factor, i) => {
              const delay = 0.35 + i * 0.12;
              return (
                <div key={factor.key} className="rise flex items-center gap-3 sm:gap-4" style={{ ["--rise-delay" as string]: `${delay}s` }}>
                  {/* Wide enough on a phone for the longest Arabic label,
                      "الكلمات المفتاحية", to stay on one line. Narrower and it
                      wrapped, which made that one row taller than the rest and
                      broke the comparison the rules exist to make. */}
                  <span
                    className="t-meta w-[7.25rem] shrink-0 truncate text-[0.875rem]"
                    style={{ color: "var(--ink-paper)" }}
                  >
                    {copy.factors[factor.key]}
                  </span>
                  {/* A track at full width and a fill scaled to the value, so
                      the geometry is a single transform and stays on the
                      compositor. */}
                  <span
                    className="relative h-[5px] min-w-0 flex-1 overflow-hidden rounded-full"
                    style={{ backgroundColor: "#e7e7e3" }}
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
                    className="w-8 shrink-0 text-end text-[1rem] font-semibold tabular-nums"
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
