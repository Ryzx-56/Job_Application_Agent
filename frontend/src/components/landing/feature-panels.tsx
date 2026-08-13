"use client";

import { ArrowUpRight } from "lucide-react";
import { useLang } from "@/lib/language";
import { Figure } from "./figure";

/* ========================================================================
   THE THREE PRIMARY FEATURE VISUALS (brief §3.5)

   Not three of the same object. The hero already spends two paper sheets on
   the score and the matched openings, and repeating that material here in the
   same material would read as the page saying one thing twice:

     1. DOCUMENTS — a paper sheet, because it IS a document. The one place on
        the page that shows the product's Arabic typesetting next to its
        English, in both site languages.
     2. GAPS      — set directly on the page ground with rules and margins, no
        container. §2.1: not every section should be a card, and this is a
        table of findings rather than a document.
     3. RANKS     — same treatment as 2, so the second and third read as a
        pair of readings taken FROM the documents above them.

   MOTION IS THE SHARED --cycle, never a scroll trigger. The primitives are
   the ones the hero already proved: .leader-fill for a rule that fills to a
   value, <Figure> for a number that counts (and stops paying for itself when
   it scrolls out of view), .scan-row for a row taking its turn. All three
   have prefers-reduced-motion rules in globals.css already.
======================================================================== */

/** The hero's sheet, so a document on this page is always the same stock.
 *  Two stacked shadows read as thickness rather than as glow. */
const SHEET: React.CSSProperties = {
  backgroundColor: "var(--surface-paper)",
  boxShadow:
    "0 1px 0 0 rgb(255 255 255 / 0.5) inset, 0 1px 2px 0 rgb(0 0 0 / 0.28), 0 12px 24px -10px rgb(0 0 0 / 0.4), 0 32px 64px -24px rgb(0 0 0 / 0.55)",
};

/** Rules on paper. Matches the hero's panels rather than inventing a second
 *  set of hairline values. */
const PAPER_RULE = "#e2e2de";

/* ========================================================================
   1 — THE TWO DOCUMENTS

   BOTH SCRIPTS ARE ON THIS PANEL IN BOTH SITE LANGUAGES, and that is the
   whole point of it. The claim is "Arabic or English, typeset properly in
   either", and an English reader who is shown only English has been given no
   evidence for the half of the claim that is the actual differentiator.
   So the CV sheet is always Arabic and the letter sheet is always English.

   The specimen text therefore lives HERE and not in the dictionary: it does
   not follow the site language, so a per-language copy of it would be wrong
   in one language or the other.

   FONTS ARE SET EXPLICITLY ON EACH SHEET. globals.css selects the Arabic
   face with `[dir="rtl"] [data-type="editorial"]`, which needs dir="rtl" on
   an ANCESTOR of the editorial root — a dir="rtl" DESCENDANT like this sheet
   does not match it. Left alone, the Arabic sheet would render in IBM Plex
   Sans (Latin only) on an English page and fall back to whatever the system
   has, which is exactly the "Arabic as an afterthought" this panel exists to
   disprove. Same in reverse for the letter on an Arabic page, which also has
   to escape the global `[dir="rtl"] { line-height: 1.7 !important }`.
======================================================================== */

/** The Arabic specimen. Latin technical terms sit inside Arabic sentences on
 *  purpose: that mix is where this product has had real rendering bugs, so
 *  the mockup has to show it rather than avoid it. Digits are Western, which
 *  is Saudi digital convention and what lib/pricing.ts pins the locale to. */
const AR_CV = {
  section: "الخبرة العملية",
  role: "مهندس واجهات أمامية",
  meta: "شركة تقنية · الرياض · 2022 حتى الآن",
  bullets: [
    "أعدت بناء واجهة لوحة التحكم باستخدام React، فانخفض زمن التحميل الأول إلى النصف.",
    "نقلت 24 شاشة إلى TypeScript دون إيقاف الخدمة.",
  ],
};

/** The English specimen. No greeting and no sign-off: the template adds both
 *  separately, and agents/document_generator.py's prompt forbids the model
 *  from writing either. A mockup that showed "Dear Hiring Manager" would be a
 *  picture of output the product does not produce. */
const EN_LETTER = [
  "Your posting asks for someone who has taken a dashboard from prototype to production.",
  "That is the work I spent last year on, and the part I would want to talk about first.",
];

export function DocumentsPanel() {
  const { t } = useLang();
  const copy = t.featureDocs;

  return (
    <figure className="relative m-0" aria-label={copy.alt}>
      {/* THE COVER LETTER, BEHIND AND ABOVE. Aligned to the trailing edge
          with a logical margin, so the pair mirrors in Arabic without a
          second set of classes. The CV below tucks 1.5rem under it: enough
          to read as a stack of two documents, not so much that either one is
          cropped at a narrow width. */}
      <div
        dir="ltr"
        lang="en"
        // The bottom padding is the overlap allowance, not decoration: the CV
        // below tucks 1.5rem under this sheet, and without clearance that
        // 1.5rem lands on the last line of the letter and crops it. Measured
        // on a screenshot after it happened.
        className="ms-auto w-[92%] overflow-hidden rounded-[0.875rem] px-5 pb-11 pt-4 sm:px-6 sm:pb-12 sm:pt-5"
        style={{
          ...SHEET,
          fontFamily: "var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif",
          lineHeight: 1.55,
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-[0.8125rem] font-semibold" style={{ color: "var(--ink-paper)" }}>
            {copy.letterLabel}
          </p>
          {/* The script tag names the language the sheet is IN, so it is set
              in that language in both directions rather than translated. */}
          <p className="text-[0.75rem]" style={{ color: "var(--ink-paper-soft)" }}>
            English
          </p>
        </div>
        <div className="mt-3 border-t pt-3" style={{ borderColor: PAPER_RULE }}>
          {EN_LETTER.map((line) => (
            <p key={line} className="text-[0.8125rem]" style={{ color: "var(--ink-paper)" }}>
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* THE CV, IN FRONT. Arabic in both site languages. */}
      <div
        dir="rtl"
        lang="ar"
        className="relative z-10 -mt-6 me-auto w-[96%] overflow-hidden rounded-[0.875rem] px-5 py-5 sm:px-7 sm:py-6"
        style={{
          ...SHEET,
          fontFamily: "var(--font-plex-arabic), ui-sans-serif, system-ui, sans-serif",
          // NO line-height here. This element carries dir="rtl" lang="ar", so
          // it matches the app-wide `[dir="rtl"], [lang="ar"] { line-height:
          // 1.7 !important }` in globals.css — and an author !important beats
          // an inline declaration that isn't. Anything set here is discarded.
          // It goes on the content block below, which carries neither
          // attribute and therefore keeps what it is given.
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-[0.8125rem] font-semibold" style={{ color: "var(--ink-paper)" }}>
            {copy.cvLabel}
          </p>
          <p className="text-[0.75rem]" style={{ color: "var(--ink-paper-soft)" }}>
            العربية
          </p>
        </div>

        {/* 1.7, which is a document's leading rather than a web page's — and
            the value this specimen already rendered at while the rule above
            was overriding it, so it is stated rather than inherited by
            accident. */}
        <div className="mt-3 border-t pt-4" style={{ borderColor: PAPER_RULE, lineHeight: 1.7 }}>
          <p className="text-[0.75rem] font-semibold" style={{ color: "var(--ink-paper-soft)" }}>
            {AR_CV.section}
          </p>
          <p className="mt-2 text-[0.9375rem] font-semibold" style={{ color: "var(--ink-paper)" }}>
            {AR_CV.role}
          </p>
          <p className="text-[0.75rem]" style={{ color: "var(--ink-paper-soft)" }}>
            {AR_CV.meta}
          </p>

          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {AR_CV.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2.5 text-[0.8125rem]" style={{ color: "var(--ink-paper)" }}>
                <span
                  className="mt-[0.6em] block size-[0.3rem] shrink-0 rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                  aria-hidden
                />
                <span className="min-w-0">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <figcaption className="t-meta mt-5" style={{ color: "var(--ink-3)" }}>
        {copy.caption}
      </figcaption>
    </figure>
  );
}

/* ========================================================================
   2 — THE SCORES AND WHAT THEY LEFT OUT

   Deliberately NOT another copy of the hero's score panel. That one shows
   the four factors utils/ats_scorer.py weighs; this shows the part the hero
   has no room for — the second, separate score (agents/match_scorer.py
   judges fit independently of the ATS composite) and the gap list behind
   both, which is the thing the feature's headline actually promises.

   The ATS figure is the hero's number on purpose: same example CV, carried
   one step further, rather than a second unrelated specimen.
======================================================================== */

/** The hero's composite. Kept in sync by hand rather than imported, because
 *  importing it would pull the whole hero panel into this chunk for one
 *  integer. If ScorePanel's FACTORS change, this changes with them. */
const ATS_SCORE = 91;
/** Independent of the ATS composite by design — match_scorer.py is told the
 *  ATS score is "one signal" and that its own answer "does NOT have to equal
 *  ATS", so showing them equal would misdescribe the product. */
const MATCH_SCORE = 84;

function ScoreReading({ label, value, delay }: { label: string; value: number; delay: number }) {
  return (
    <div className="min-w-0">
      <p className="t-meta" style={{ color: "var(--ink-3)" }}>
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <Figure
          value={value}
          delay={delay}
          className="text-[2.25rem] font-semibold leading-none tracking-[-0.02em]"
          style={{ color: "var(--ink-1)" }}
        />
      </div>
      {/* Track and fill, the same construction as the hero's leader rules:
          one transform, so it stays on the compositor. */}
      <span
        className="relative mt-3 block h-[5px] overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--line)" }}
      >
        <span
          className="leader-fill absolute inset-0 rounded-full"
          style={{
            backgroundColor: "var(--accent)",
            ["--leader-to" as string]: value / 100,
            ["--rise-delay" as string]: `${delay}s`,
          }}
        />
      </span>
    </div>
  );
}

export function GapsPanel() {
  const { t } = useLang();
  const copy = t.featureGaps;

  return (
    <figure className="m-0" aria-label={copy.alt}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:gap-x-12">
        <ScoreReading label={copy.atsLabel} value={ATS_SCORE} delay={0.15} />
        <ScoreReading label={copy.matchLabel} value={MATCH_SCORE} delay={0.3} />
      </div>

      <p
        className="t-meta mt-9 border-t pt-6 font-semibold"
        style={{ borderColor: "var(--line)", color: "var(--ink-1)" }}
      >
        {copy.gapsLabel}
      </p>

      <ul className="m-0 mt-1 list-none p-0">
        {copy.items.map((item) => (
          <li key={item.skill} className="border-t pt-4 pb-4 last:pb-0" style={{ borderColor: "var(--line-hairline)" }}>
            <div className="flex items-baseline justify-between gap-4">
              {/* A tool name is a Latin run wherever it appears. Marked as its
                  own isolate so an Arabic line around it cannot reorder it —
                  the bug class this codebase has actually shipped before. */}
              <bdi className="t-body font-medium" style={{ color: "var(--ink-1)" }}>
                {item.skill}
              </bdi>
              <span className="t-meta shrink-0 whitespace-nowrap" style={{ color: "var(--ink-3)" }}>
                {copy.importance[item.importance]}
              </span>
            </div>
            <p className="t-meta mt-1.5 max-w-[46ch]" style={{ color: "var(--ink-2)" }}>
              {item.how}
            </p>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/* ========================================================================
   3 — WHAT THE THREE LABELS MEAN

   The hero's panel shows five openings carrying these labels and never says
   what any of them means, so this adds information instead of repeating a
   visual. The label STRINGS come from t.heroMatches.ranks, which is what the
   hero renders too, so the two can never drift apart.

   Weight carries rank, not hue — the same decision the hero's marks make.
   The colours differ because those sit on paper and these sit on the page.
======================================================================== */

const RANKS = ["strong", "partial", "stretch"] as const;

function RankMark({ rank }: { rank: (typeof RANKS)[number] }) {
  const base = "block h-4 w-[3px] shrink-0 rounded-full";
  if (rank === "strong") {
    return <span className={base} style={{ backgroundColor: "var(--accent)" }} aria-hidden />;
  }
  if (rank === "partial") {
    return (
      <span
        className={base}
        style={{
          background: "linear-gradient(to bottom, var(--accent) 50%, var(--line-strong) 50%)",
        }}
        aria-hidden
      />
    );
  }
  return <span className={base} style={{ backgroundColor: "var(--line-strong)" }} aria-hidden />;
}

export function RanksPanel() {
  const { t } = useLang();
  const copy = t.featureRanks;

  return (
    <figure className="m-0" aria-label={copy.alt}>
      <p className="t-meta font-semibold" style={{ color: "var(--ink-1)" }}>
        {copy.title}
      </p>

      <ul className="m-0 mt-4 list-none p-0">
        {RANKS.map((rank, i) => (
          <li
            key={rank}
            className="scan-row border-t py-4"
            style={{
              borderColor: "var(--line-hairline)",
              ["--scan-delay" as string]: `${0.9 + i * 0.55}s`,
            }}
          >
            <div className="flex items-center gap-3">
              <RankMark rank={rank} />
              <span className="t-body font-medium" style={{ color: "var(--ink-1)" }}>
                {t.heroMatches.ranks[rank]}
              </span>
            </div>
            <p className="t-meta mt-1.5 max-w-[42ch] ps-[calc(3px+0.75rem)]" style={{ color: "var(--ink-2)" }}>
              {copy.meanings[rank]}
            </p>
          </li>
        ))}
      </ul>

      {/* The link is the part of this feature people do not expect, so it
          closes the panel rather than sitting in a caption nobody reaches.
          The arrow points away from the page in both directions: it means
          "leaves this site", not "forward", so it does not mirror. */}
      <div className="border-t pt-4" style={{ borderColor: "var(--line-hairline)" }}>
        <p
          className="t-meta inline-flex items-center gap-1.5 font-medium"
          style={{ color: "var(--accent-quiet)" }}
        >
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
          {t.heroMatches.linkNote}
        </p>
      </div>
    </figure>
  );
}
