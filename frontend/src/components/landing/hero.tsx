"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLang } from "@/lib/language";
import { CvSheet } from "./cv-sheet";
import { JobMatches } from "./job-matches";

/* ========================================================================
   HERO (brief §3.1)

   Section shape: an asymmetric split. Text on the start side, two stacked
   visuals on the trailing side — right in LTR, left in RTL, which falls out
   of the grid's source order rather than being positioned.

   ENTRANCES ARE CSS (the `.rise` class, see globals.css), not Framer Motion.
   Framer Motion writes opacity:0 into the server-rendered HTML, which makes
   the whole hero invisible until hydration and delays LCP to whenever the
   bundle finishes. CSS animates from first paint and degrades to "visible".
   The h1 carries no entrance at all: it is the LCP element and the sentence
   the page exists to deliver.

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
    <section className="mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        {/* ── the argument ── */}
        <div className="min-w-0">
          <h1
            className="t-display-xl max-w-[15ch] font-semibold tracking-tight"
            style={{ color: "var(--ink-1)" }}
          >
            {t.hero.headline}
          </h1>

          <p className="t-body-l rise mt-6 max-w-[46ch]" style={{ ...delay(0.06), color: "var(--ink-2)" }}>
            {t.hero.sub}
          </p>

          <div className="rise mt-9 flex flex-wrap items-center gap-x-7 gap-y-4" style={delay(0.14)}>
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
          <p className="t-meta rise mt-5 max-w-[44ch]" style={{ ...delay(0.22), color: "var(--ink-3)" }}>
            {t.hero.freeLine}
          </p>
        </div>

        {/* ── the evidence ── */}
        <div className="min-w-0 space-y-4">
          <div className="rise" style={delay(0.1)}>
            <CvSheet />
          </div>
          <div className="rise" style={delay(0.26)}>
            <JobMatches />
          </div>
        </div>
      </div>
    </section>
  );
}
