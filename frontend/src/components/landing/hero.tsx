"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLang } from "@/lib/language";
import { ScorePanel } from "./score-panel";
import { MatchesPanel } from "./matches-panel";

/* ========================================================================
   HERO (brief §3.1)

   TWO STACKED VISUALS, as originally specced. A single combined panel was
   built in between and it was wrong: it forced the CV, the score and the
   matched jobs into one object, which made the scores look like a footnote
   on a document rather than the product's own answer, and buried the job
   matching entirely. They are two different claims and they get two visuals.

     Visual 1 — the ATS score and its four real factors.
     Visual 2 — the five openings found for the CV that was just made, with
                its own heading, because most people do not know we do this.

   The CTA sits under BOTH, which is the point at which the argument is
   complete: here is the CV, here is what it scored, here is where to send it.

   ENTRANCES ARE CSS (the `.rise` class, see globals.css), not Framer Motion.
   Framer Motion writes opacity:0 into the server-rendered HTML, which makes
   the hero invisible until hydration and delays LCP to whenever the bundle
   finishes. CSS animates from first paint and degrades to "visible". The h1
   carries no entrance at all: it is the LCP element and the sentence the page
   exists to deliver.

   VISUAL 2 IS FULL WIDTH, NOT STACKED INSIDE THE RIGHT COLUMN. Both visuals
   in one column made that column roughly three times the height of the
   headline beside it, which left an empty half-page under the opening
   sentence — checked on a screenshot, not guessed. Visual 2 spanning the
   grid fixes that, and it suits the content: five openings with a role at one
   end and a match label at the other is a list, and a list wants width.

   What is deliberately absent, and why:
     · No eyebrow pill. "New · 6 AI agents tailoring every application" was a
       tag label carrying no information (§2.1).
     · No grid or dot texture behind it (§2.1). Type and space organise this.
     · No accent-coloured phrase inside the headline, and no centring (§2.1).
     · One primary action and one quiet link, not four buttons.
======================================================================== */

/** Staggered entrance delay, as a CSS variable rather than a JS timer. */
const delay = (seconds: number) => ({ ["--rise-delay" as string]: `${seconds}s` });

export function Hero() {
  const { t, isRTL } = useLang();
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;

  return (
    <section className="relative">
      {/* THE GLOW. Restored: the page reads as bare without it, and it is the
          one piece of atmosphere here — no grid, no dots, no second colour.

          left-1/2 with -translate-x-1/2, both physical: `start-1/2` is a
          logical property and `-translate-x-1/2` is not, so mixing them
          double-shifts the glow off-centre in Arabic. That was a real bug.

          Its own overflow-hidden wrapper rather than overflow-hidden on the
          section, because an overflow-clipping ancestor becomes the sticky
          containing block and would silently kill the sticky column above. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36">
        {/* ── visual 1, beside the argument ── */}
        <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div className="min-w-0">
            <h1 className="t-display-xl max-w-[15ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
              {t.hero.headline}
            </h1>

            <p className="t-body-l rise mt-6 max-w-[46ch]" style={{ ...delay(0.06), color: "var(--ink-2)" }}>
              {t.hero.sub}
            </p>
          </div>

          <div className="rise min-w-0" style={delay(0.1)}>
            <ScorePanel />
          </div>
        </div>

        {/* ── visual 2, with its own heading, because almost nobody arrives
              knowing we do this part ── */}
        <div className="mt-20 sm:mt-24">
          <h2
            className="t-display-m rise max-w-[22ch] font-semibold tracking-tight"
            style={{ ...delay(0.14), color: "var(--ink-1)" }}
          >
            {t.heroMatches.headline}
          </h2>
          <p className="t-body-l rise mt-4 max-w-[54ch]" style={{ ...delay(0.18), color: "var(--ink-2)" }}>
            {t.heroMatches.sub}
          </p>
          <div className="rise mt-8" style={delay(0.22)}>
            <MatchesPanel />
          </div>
        </div>

        {/* ── the action, under both visuals ── */}
        <div className="rise mt-14 sm:mt-16" style={delay(0.26)}>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
            <Link
              href="/signup?plan=free"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[0.3rem] px-6 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                backgroundColor: "var(--accent)",
                color: "#ffffff",
                // The ring offset has to sit on the page ground, or the focus
                // ring reads as a halo against a transparent default.
                ["--tw-ring-color" as string]: "var(--accent-quiet)",
                ["--tw-ring-offset-color" as string]: "var(--surface-base)",
              }}
            >
              {t.hero.ctaPrimary}
              <ForwardIcon className="size-4" aria-hidden />
            </Link>

            {/* The quiet second action: a link, not a second button. */}
            <a
              href="#how-it-works"
              className="t-meta inline-flex items-center gap-1.5 rounded-[0.2rem] underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
              style={{
                color: "var(--ink-2)",
                ["--tw-ring-color" as string]: "var(--accent-quiet)",
              }}
            >
              {t.hero.ctaSecondary}
              <ForwardIcon className="size-3.5" aria-hidden />
            </a>
          </div>

          {/* Messaging pillar 3, placed with the CTA because that is where the
              last objection to signing up gets removed. Exact, including the
              part that costs us: an Arabic CV spends two credits. */}
          <p className="t-meta mt-5 max-w-[52ch]" style={{ color: "var(--ink-3)" }}>
            {t.hero.freeLine}
          </p>
        </div>
      </div>
    </section>
  );
}
