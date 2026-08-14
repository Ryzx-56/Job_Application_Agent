"use client";

import { useLang } from "@/lib/language";

/* ========================================================================
   HOW IT WORKS (brief §3.3)

   "The highest-value addition on the page — most visitors don't understand
   what the product does in the first 5 seconds." So it is three steps, short
   lines, and one small moving diagram each.

   NUMBERED, AND THAT IS ALLOWED HERE. §2.1 rules out 01/02/03 labels on
   things that are not sequences. This one genuinely is: you cannot paste a
   posting before you have a CV, and you cannot get a score before both.

   REPLACES A FOUR-STEP VERSION whose intro read "Six AI agents work behind
   the scenes". Two problems with that line: the pipeline runs eight agents,
   not six, and how many agents there are is not a benefit — the tone rules
   say describe what the reader gets, not what the system does internally.

   THE THREE DIAGRAMS RUN ON ONE CLOCK, one second apart, so the row plays
   left to right (right to left in Arabic) as the sequence it describes.
   Everything is CSS on the shared --cycle. Nothing here is Framer Motion:
   this section can be above the fold on a phone and an entrance that ships
   opacity:0 into the HTML is what made the hero invisible before hydration.
======================================================================== */

/** Stagger between steps, so the row reads as a sequence rather than three
 *  things twitching at once. */
const STEP_STAGGER = 1;

/** Step 1: a CV being read. Lines settle, then the parsed tick lands. */
function AddCvDiagram() {
  return (
    <div className="space-y-2" aria-hidden>
      {["78%", "94%", "62%"].map((w, i) => (
        <span
          key={i}
          className="step-draw block h-[0.3rem] rounded-full"
          style={{
            width: w,
            backgroundColor: i === 0 ? "var(--ink-3)" : "var(--line-strong)",
            ["--step-delay" as string]: `${0.1 + i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

/** Step 2: a posting being read, with the requirements it asks for picked
 *  out — which is what jd_analyzer actually does to it. */
function PostingDiagram() {
  const highlighted = new Set([1, 3]);
  return (
    <div className="space-y-2" aria-hidden>
      {["88%", "46%", "72%", "34%"].map((w, i) => (
        <span
          key={i}
          className="step-draw block h-[0.3rem] rounded-full"
          style={{
            width: w,
            backgroundColor: highlighted.has(i) ? "var(--accent)" : "var(--line-strong)",
            ["--step-delay" as string]: `${STEP_STAGGER + 0.1 + i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
}

/** Step 3: what lands. Four bars of decreasing weight, one per deliverable,
 *  so the last step visibly produces more than the two before it. */
function OutputDiagram() {
  return (
    <div className="space-y-2" aria-hidden>
      {["96%", "84%", "68%", "52%"].map((w, i) => (
        <span
          key={i}
          className="step-draw block h-[0.3rem] rounded-full"
          style={{
            width: w,
            backgroundColor: i < 2 ? "var(--accent)" : "var(--line-strong)",
            ["--step-delay" as string]: `${STEP_STAGGER * 2 + 0.1 + i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
}

const DIAGRAMS = [AddCvDiagram, PostingDiagram, OutputDiagram];

export function HowItWorks() {
  const { t } = useLang();
  const copy = t.howItWorks;

  return (
    <section id="how-it-works" className="scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        {/* Standing head, same treatment as the marquee's: accent tick, real
            weight, no pill and no letter-spacing (Arabic has neither). */}
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--accent)" }} aria-hidden />
          <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
            {copy.label}
          </p>
        </div>

        <h2 className="t-display-l mt-6 max-w-[18ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
          {copy.title}
        </h2>
        <p className="t-body-l mt-5 max-w-[58ch]" style={{ color: "var(--ink-2)" }}>
          {copy.description}
        </p>

        <ol className="m-0 mt-14 grid list-none gap-px p-0 sm:mt-16 lg:grid-cols-3" style={{ backgroundColor: "var(--line-hairline)" }}>
          {copy.steps.map((step, i) => {
            const Diagram = DIAGRAMS[i];
            return (
              <li
                key={step.title}
                className="flex flex-col gap-6 px-0 py-8 sm:gap-8 lg:px-8 lg:py-10"
                style={{ backgroundColor: "var(--surface-base)" }}
              >
                <div>
                  <div className="flex items-baseline gap-3">
                    {/* The number is set as a figure, not as a badge in a
                        coloured square. It is an ordinal, so it reads like one. */}
                    <span
                      className="t-figure text-[1.75rem] font-semibold leading-none tracking-tight"
                      style={{ color: "var(--accent-quiet)" }}
                    >
                      {i + 1}
                    </span>
                    <h3 className="t-title font-semibold" style={{ color: "var(--ink-1)" }}>
                      {step.title}
                    </h3>
                  </div>
                  <p className="t-body mt-3 max-w-[34ch]" style={{ color: "var(--ink-2)" }}>
                    {step.description}
                  </p>
                </div>

                {/* The diagram sits at the bottom of every card regardless of
                    how the copy wraps, so the three read as one row. */}
                <div className="mt-auto max-w-[15rem]">
                  <Diagram />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
