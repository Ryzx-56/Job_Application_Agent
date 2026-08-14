"use client";

import { Check, X } from "lucide-react";
import { useLang } from "@/lib/language";

/* ========================================================================
   TRUST — "what it will not do"

   WHAT THIS REPLACES: three rounded cards, each with an icon in a coloured
   square, under a centred eyebrow. Three assertions that the product is
   trustworthy, which is the least persuasive way to make that case: anyone
   can write "nothing invented, ever" on a page.

   SO THE SECTION SHOWS THE CHECK INSTEAD OF DESCRIBING IT. The panel is one
   real CV line and two candidate rewrites — the one the fact checker allows
   and the one it sends back — with the reason under each. A reader who
   understands that distinction in five seconds is more reassured than one who
   has read a paragraph promising it.

   EVERYTHING IN THE PANEL IS TRACED TO core/fact_checker.py. Its prompt draws
   exactly this line, and "reception work" -> "front-of-house operations" is
   one of its own examples. MAX_RETRIES = 2 is where "up to twice" comes from,
   and a failed bullet is REGENERATED and re-checked rather than flagged.

   WHY THIS LAYOUT AND NOT THE ALTERNATING SPLIT: the argument here is a
   comparison, and a comparison wants to be read across, not down a column
   beside a paragraph. The panel takes the full measure and the three
   supporting guarantees sit beneath it as a ruled row — quiet, because the
   panel is where the boldness is spent.

   MOTION IS .scan-row ON THE SHARED --cycle, the same primitive the hero's
   matched-openings list uses: each candidate row takes its turn under a wash
   of accent, so the panel reads as something being checked rather than a
   static diagram. Nothing is ever hidden or cleared — the marks and the text
   are legible at every point in the cycle, and prefers-reduced-motion stops
   the wash with the panel fully readable (globals.css already carries that
   rule for .scan-row).
======================================================================== */

/** Rules on paper, matching the hero's sheets rather than a second set. */
const PAPER_RULE = "#e2e2de";

/** One candidate rewrite: a verdict mark, the line, and why. */
function Candidate({
  ok,
  label,
  line,
  note,
  delay,
}: {
  ok: boolean;
  label: string;
  line: string;
  note: string;
  delay: number;
}) {
  const Mark = ok ? Check : X;
  return (
    <li
      className="scan-row flex gap-3.5 px-6 py-5 sm:gap-4 sm:px-8"
      style={{
        borderTop: `1px solid ${PAPER_RULE}`,
        ["--scan-delay" as string]: `${delay}s`,
      }}
    >
      {/* Weight and shape carry the verdict, not hue alone: the accepted mark
          is filled, the rejected one is an outline. Red and green on their own
          fail for a reader who cannot separate the two. */}
      <span
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full"
        style={
          ok
            ? { backgroundColor: "var(--accent)", color: "#ffffff" }
            : { boxShadow: "inset 0 0 0 1.5px #b4243c", color: "#b4243c" }
        }
        aria-hidden
      >
        <Mark className="size-3" strokeWidth={3} />
      </span>

      <div className="min-w-0">
        <p className="t-meta font-semibold" style={{ color: ok ? "var(--accent)" : "#b4243c" }}>
          {label}
        </p>
        {/* The line itself is the specimen, so it is set as document text
            rather than as UI copy. */}
        <p className="mt-1 text-[0.9375rem]" style={{ color: "var(--ink-paper)" }}>
          {line}
        </p>
        <p className="t-meta mt-1.5 text-[0.8125rem]" style={{ color: "var(--ink-paper-soft)" }}>
          {note}
        </p>
      </div>
    </li>
  );
}

function ProofSheet() {
  const { t } = useLang();
  const copy = t.trustSection.proof;

  return (
    <figure
      className="relative m-0 overflow-hidden rounded-[0.875rem]"
      style={{
        backgroundColor: "var(--surface-paper)",
        boxShadow:
          "0 1px 0 0 rgb(255 255 255 / 0.5) inset, 0 1px 2px 0 rgb(0 0 0 / 0.28), 0 12px 24px -10px rgb(0 0 0 / 0.4), 0 32px 64px -24px rgb(0 0 0 / 0.55)",
        // .scan-row's wash is tuned for the dark page ground, where 12% blue
        // is a whisper. On white paper the same value is a visible blue band
        // that reads as a status colour rather than as a pass being made over
        // the line. Overriding the token here keeps the shared primitive and
        // just gives it the right weight for this surface.
        ["--accent-wash" as string]: "rgb(37 99 235 / 0.055)",
      }}
      aria-label={copy.alt}
    >
      {/* The source line, in the masthead: everything below is judged against
          this one sentence, so it sits above the rule rather than in the list. */}
      <div className="px-6 pb-6 pt-6 sm:px-8">
        <p className="t-meta font-semibold" style={{ color: "var(--ink-paper-soft)" }}>
          {copy.caption}
        </p>
        <p className="t-meta mt-4 text-[0.8125rem]" style={{ color: "var(--ink-paper-soft)" }}>
          {copy.sourceLabel}
        </p>
        <p className="t-title mt-1 font-medium" style={{ color: "var(--ink-paper)" }}>
          {copy.source}
        </p>
      </div>

      <ul className="m-0 list-none p-0">
        <Candidate
          ok
          label={copy.allowedLabel}
          line={copy.allowed}
          note={copy.allowedNote}
          delay={1.1}
        />
        <Candidate
          ok={false}
          label={copy.rejectedLabel}
          line={copy.rejected}
          note={copy.rejectedNote}
          delay={2.4}
        />
      </ul>

      {/* What happens to the rejected line. This is the part people assume is
          "flagged for review"; it is regenerated. */}
      <p
        className="t-meta px-6 py-5 text-[0.8125rem] sm:px-8"
        style={{ borderTop: `1px solid ${PAPER_RULE}`, color: "var(--ink-paper-soft)" }}
      >
        {copy.outcome}
      </p>
    </figure>
  );
}

export function Trust() {
  const { t } = useLang();
  const copy = t.trustSection;

  return (
    <section
      id="trust"
      className="scroll-mt-24 border-y"
      style={{ borderColor: "var(--line-hairline)", backgroundColor: "var(--surface-sunken)" }}
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="flex items-center gap-3">
          <span
            className="h-3.5 w-0.5 shrink-0 rounded-full"
            style={{ backgroundColor: "var(--accent)" }}
            aria-hidden
          />
          <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
            {copy.label}
          </p>
        </div>

        {/* The heading and its paragraph sit side by side rather than stacked:
            at display size a 60-character heading over a 60-character
            paragraph is two blocks of the same width doing the same thing.
            Split, the heading states the promise and the paragraph explains
            the mechanism, and the eye reads them as a pair. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,52fr)_minmax(0,48fr)] lg:gap-16">
          <h2 className="t-display-l max-w-[24ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
            {copy.title}
          </h2>
          <p className="t-body-l max-w-[52ch] lg:pt-2" style={{ color: "var(--ink-2)" }}>
            {copy.description}
          </p>
        </div>

        <div className="mt-12 sm:mt-14">
          <ProofSheet />
        </div>

        {/* The three supporting guarantees. A ruled row, not cards: the panel
            above is where this section spends its weight. */}
        <div className="mt-14 grid gap-x-10 gap-y-9 sm:mt-16 lg:grid-cols-3">
          {copy.pillars.map((pillar) => (
            <div key={pillar.title} className="border-t pt-5" style={{ borderColor: "var(--line)" }}>
              <h3 className="t-body font-semibold" style={{ color: "var(--ink-1)" }}>
                {pillar.title}
              </h3>
              <p className="t-meta mt-2" style={{ color: "var(--ink-2)" }}>
                {pillar.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
