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

  /* ── THE ONE PLACE ON THIS SITE THAT DOES NOT MIRROR ──────────────────
     CSS grid places columns along the INLINE axis, so in an RTL document
     column 1 is on the right. Every box in this section therefore swapped
     sides in Arabic: headline right, score panel left, jobs panel right.
     That is correct default behaviour and it is not what this section wants.

     The boxes here are pinned to physical positions in both languages —
     headline left, panels right, jobs panel left of its copy — by forcing
     `dir="ltr"` on the two grid CONTAINERS, which is what decides where
     columns land. The direction is then handed straight back to every box
     via `boxDir`, so Arabic inside each box still reads and aligns
     right-to-left. Only the arrangement is frozen; nothing about the text is.

     SCOPED TO THIS COMPONENT ON PURPOSE. The rest of the site mirrors
     normally, and it should. Do not copy this pattern into another section
     without the same explicit reason. */
  const boxDir = isRTL ? "rtl" : "ltr";

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

      {/* THE HERO IS WIDER THAN THE SECTIONS BELOW IT, from lg up. The jobs
          block sets the requirement: a heading beside a five-row table needs
          roughly 800px, and after a headline column there was not 800px left
          inside max-w-6xl. Rather than squeeze both, the hero gets its own
          measure. It reads as deliberate because the hero is the one section
          that should be the widest thing on the page, and it steps down into
          the full-bleed marquee below rather than jumping. */}
      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36 lg:max-w-[88rem]">
        {/*
          TWO COLUMNS ON DESKTOP. The start column carries the headline and
          its sub-line and nothing else. EVERYTHING ELSE — the score panel,
          the second heading, its sub-line and the matched-jobs panel — is one
          stack in the trailing column, in that order.

          The whole evidence column shares one edge, so the second heading
          reads as a caption on the panel above it and an introduction to the
          panel below it, which is what it is. An earlier pass put that
          heading in the start column under the main headline; it lined up
          with the wrong thing and read as a second argument rather than as
          part of the demonstration.

          The mobile order is the DOM order and is unchanged: headline, sub,
          score panel, second heading, sub, jobs panel. That falls out for
          free because the grid is `lg:` — below it these are plain blocks in
          source order. No duplicated markup, no reordering.

          THE HEADLINE COLUMN STICKS. The evidence stack is roughly four times
          its height, so the alternative is a sentence stranded at the top of
          an empty half-page. Pinned, it stays with the evidence it makes
          claims about. This is why the glow above lives in its own
          overflow-hidden wrapper rather than the section carrying it: an
          overflow-clipping ancestor becomes the sticky containing block and
          would silently kill this.
        */}
        <div dir="ltr" className="lg:grid lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:items-stretch lg:gap-0">
          <div
            dir={boxDir}
            className="min-w-0 lg:col-start-1 lg:row-start-1 lg:border-r lg:pb-14 lg:pr-14"
            style={{ borderColor: "var(--line-hairline)" }}
          >
            {/* The two headings are set at the SAME size on purpose. The
                display-xl / display-m pairing made the second one read as a
                subheading of the first rather than as the second half of the
                argument. They meet in the middle at display-l: the first comes
                down, the second goes up. */}
            <h1 className="t-display-l max-w-[15ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
              {t.hero.headline}
            </h1>

            <p className="t-body-l rise mt-6 max-w-[46ch]" style={{ ...delay(0.06), color: "var(--ink-2)" }}>
              {t.hero.sub}
            </p>
          </div>

          {/* Visual 1, in the trailing cell of the first row. Capped at
              44rem: filling a 968px column made it the loudest thing on the
              page and left the headline beside it looking like a caption. The
              cap is a judgement about proportion, not an attempt to match the
              jobs panel — those two cannot be equal while both fill their own
              cells, and that is fine. Height follows content; there is no
              max-height, because clipping a panel is worse than a tall one. */}
          <div className="lg:col-start-2 lg:row-start-1 lg:pb-14 lg:pl-14">
            {/* Offset down rather than stretched. The panel keeps its own
                height; the gap is what stops it sitting flush with the
                headline's cap-line and gives the top row a step. */}
            <div dir={boxDir} className="rise mt-12 lg:mt-16" style={delay(0.1)}>
              <ScorePanel />
            </div>
          </div>

          {/* Visual 2. SPANS BOTH COLUMNS.

              WHY THE LAST FIX DID NOT LAND: items-stretch was correct and did
              work — the panel filled its cell with zero leftover on all four
              sides, measured. The cell was the problem. This row used to be
              nested inside a wrapper around the trailing column, so its 57%
              share was 57% of THAT column: 520px starting a third of the way
              across the page. Stretching to fill a small box still leaves a
              small box. The wrapper is gone and this row is now a grid item
              spanning both columns, so its start edge is the headline's start
              edge and it fills the full measure from there.

              THE PANEL LEADS AND THE COPY FOLLOWS. In the DOM the copy comes
              first, because on a phone a heading has to introduce the thing it
              names. On desktop the two are placed by column, which swaps them
              visually without reordering the markup.

              Stacked below xl deliberately: under about 1280 the row cannot
              hold a display-size heading beside a five-column table without
              one of them becoming unreadable. */}
          <div
            dir="ltr"
            className="mt-16 sm:mt-20 lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:mt-0 lg:grid lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:items-stretch lg:gap-0 lg:border-t lg:pt-14"
            style={{ borderColor: "var(--line-hairline)" }}
          >
              <div dir={boxDir} className="lg:col-start-2 lg:row-start-1 lg:flex lg:flex-col lg:justify-center lg:pl-14">
                <h2
                  className="t-display-l rise max-w-[16ch] font-semibold tracking-tight"
                  style={{ ...delay(0.14), color: "var(--ink-1)" }}
                >
                  {t.heroMatches.headline}
                </h2>
                <p className="t-body rise mt-4 max-w-[40ch]" style={{ ...delay(0.18), color: "var(--ink-2)" }}>
                  {t.heroMatches.sub}
                </p>
              </div>

              <div
                dir={boxDir}
                className="rise mt-8 lg:col-start-1 lg:row-start-1 lg:mt-0 lg:border-r lg:pr-14"
                style={{ ...delay(0.22), borderColor: "var(--line-hairline)" }}
              >
                <MatchesPanel />
              </div>
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
