"use client";

import { useLang } from "@/lib/language";
import { DocumentsPanel, GapsPanel, RanksPanel } from "./feature-panels";

/* ========================================================================
   FEATURES (brief §3.5)

   HIERARCHY, NOT A FLAT GRID. Three primary features, each with its own
   visual, alternating sides; then a compact secondary list for the rest.

   WHAT THIS REPLACES: a six-up grid of rounded cards, each with a Lucide
   icon in a rounded coloured square. That is the single loudest template
   tell in §2.1, and the copy inside it had its own problems — one card sold
   "6 AI agents working together", which is an internal implementation
   detail AND the wrong number (the pipeline runs eight).

   THE SECONDARY LIST IS NOT CARDS EITHER. Each item is a rule, a heading and
   a line, sitting directly on the page ground — the index page of a
   well-set book rather than a dashboard. Two lines maximum per item, as
   specified; anything that read as a paragraph was cut.

   MIRRORS NORMALLY. The alternation is column placement inside a logical
   grid, so in Arabic the first feature's copy is on the right and its visual
   on the left, which is what an Arabic reader should get. The hero's
   fixed-physical-position exception is scoped to the hero and is not
   repeated here.
======================================================================== */

const PANELS = [DocumentsPanel, GapsPanel, RanksPanel];

export function Features() {
  const { t } = useLang();
  const copy = t.features;

  return (
    <section id="features" className="scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
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

        {/* 24ch: at 20 the Arabic headline dropped its last word onto a line
            of its own. Arabic runs shorter than the same English sentence, so
            a measure that reads well in one script has to be checked in the
            other — this one was checked in Arabic first. */}
        <h2 className="t-display-l mt-6 max-w-[24ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
          {copy.title}
        </h2>
        <p className="t-body-l mt-5 max-w-[58ch]" style={{ color: "var(--ink-2)" }}>
          {copy.description}
        </p>

        {/* ── the three primary features ── */}
        <div className="mt-14 sm:mt-16">
          {copy.primary.map((item, i) => {
            const Panel = PANELS[i];
            // Odd rows put the copy in the trailing column. Both are placed
            // by grid line, so the DOM order stays copy-then-visual and a
            // screen reader hears the heading before the figure it labels.
            const flipped = i % 2 === 1;
            return (
              <div
                key={item.lead}
                className={`grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16 ${
                  i === 0 ? "" : "mt-16 border-t pt-16 sm:mt-20 sm:pt-20"
                }`}
                style={i === 0 ? undefined : { borderColor: "var(--line-hairline)" }}
              >
                <div
                  className={`min-w-0 lg:row-start-1 ${flipped ? "lg:col-start-2" : "lg:col-start-1"}`}
                >
                  <h3
                    className="t-display-m max-w-[20ch] font-semibold tracking-tight"
                    style={{ color: "var(--ink-1)" }}
                  >
                    {item.lead}
                  </h3>
                  <p className="t-body-l mt-4 max-w-[46ch]" style={{ color: "var(--ink-2)" }}>
                    {item.body}
                  </p>
                </div>

                <div
                  className={`min-w-0 lg:row-start-1 ${flipped ? "lg:col-start-1" : "lg:col-start-2"}`}
                >
                  <Panel />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── the rest of it ──
            A quieter head than the section's own: this is a continuation of
            the same list, not a new argument. */}
        <div className="mt-20 sm:mt-24">
          <div className="flex items-center gap-3">
            <span
              className="h-3.5 w-0.5 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--line-strong)" }}
              aria-hidden
            />
            <h3 className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
              {copy.secondaryTitle}
            </h3>
          </div>

          <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {copy.secondary.map((item) => (
              <div key={item.title} className="border-t pt-5" style={{ borderColor: "var(--line)" }}>
                <h4 className="t-body font-semibold" style={{ color: "var(--ink-1)" }}>
                  {item.title}
                </h4>
                <p className="t-meta mt-2" style={{ color: "var(--ink-2)" }}>
                  {item.body}
                </p>
                {/* The plan requirement, where there is one. Set as a line of
                    text rather than a badge: core/entitlements.py caps both
                    of these at zero on Free, and a page that takes payments
                    has to say so where the feature is named, not in a pill
                    that reads as decoration. */}
                {item.note && (
                  <p className="t-meta mt-2 font-medium" style={{ color: "var(--ink-3)" }}>
                    {item.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
