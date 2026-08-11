"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useLang } from "@/lib/language";
import { formatNumber } from "@/lib/pricing";

/* ========================================================================
   THE PROOF SHEET — the hero's single visual.

   REPLACES a static paper card with a separate list panel bolted underneath
   it. That arrangement had two problems: it was two objects pretending to be
   one, and the list rendered as a plain table, which is the least designed
   thing you can put on a page.

   This is ONE sheet — the page the product actually hands you. It carries
   the tailored CV, what it scored, and the roles it matched, in that order,
   separated by rules the way a typeset document separates sections.

   WHAT IT IS NOT: not a donut, not an arc, not a ring, not a grid of stat
   cards. Scores are leader rules — label, a rule that fills to its value, a
   figure — which is the convention of a set table of contents and is already
   the language the rest of this page speaks. It also cannot fail to "close
   cleanly" the way a stroke-dashoffset circle can.

   THE MEASURING LOOPS; THE DOCUMENT DOES NOT. The text sets once on entry
   and then stays put — an earlier draft cleared the whole panel and rebuilt
   it every cycle, which reads as a glitch rather than as life, and is the
   same fault the marquee had. What repeats is the scoring: the rules empty
   and refill, the figures recount, and one thin pass sweeps down the sheet.
   So there is always motion for someone who looks a second late (which is
   why the previous version read as static) without anything blinking out.

   Real numbers are in the DOM, server-rendered. The count is layered on top
   and only runs while the sheet is on screen.
======================================================================== */

/** Scores shown. These are the real components utils/ats_scorer.py computes
 *  (a weighted composite over keyword, skills, education and experience), not
 *  invented metrics. */
const SCORES = [
  { key: "ats", value: 92 },
  { key: "keywords", value: 94 },
  { key: "formatting", value: 88 },
] as const;

const MATCH_COUNT = 4;

/** Staggered position in the shared cycle. */
const at = (seconds: number) => ({ ["--rise-delay" as string]: `${seconds}s` });

/**
 * A figure that counts up once per cycle.
 *
 * Real value in the DOM so the served HTML, a crawler and a reader with
 * JavaScript still loading all see the true number — the first version state
 * initialised at 0 and shipped an ATS score of "0" in the HTML.
 *
 * Writes through a ref rather than state: a counter on state re-renders the
 * component every frame, and this page already has a main-thread problem.
 * `useInView` without `once` means the loop stops when the hero scrolls away.
 */
function Figure({ value, delay }: { value: number; delay: number }) {
  const { lang } = useLang();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.5 });

  useEffect(() => {
    const node = ref.current;
    if (reduced || !inView || !node) return;

    // 9s cycle: count for 1.6s starting at the element's own delay, then hold.
    const controls = animate(0, value, {
      duration: 1.6,
      delay,
      ease: [0.16, 1, 0.3, 1],
      repeat: Infinity,
      repeatDelay: 9 - 1.6 - delay,
      onUpdate: (v) => {
        node.textContent = formatNumber(Math.round(v), lang);
      },
    });
    return () => {
      controls.stop();
      // Leave the true number behind when the loop stops.
      node.textContent = formatNumber(value, lang);
    };
  }, [inView, reduced, value, delay, lang]);

  return (
    <span ref={ref} className="t-figure font-semibold" style={{ color: "var(--ink-paper)" }}>
      {formatNumber(value, lang)}
    </span>
  );
}

/** Rank mark: filled, half, outline. Weight carries rank, not hue — a
 *  green/amber/red set would be both the stock SaaS palette and unreadable
 *  to anyone with a red-green deficiency. */
function RankMark({ rank }: { rank: "strong" | "partial" | "stretch" }) {
  const base = "block size-2 shrink-0 rounded-[2px]";
  if (rank === "strong") return <span className={base} style={{ backgroundColor: "var(--accent)" }} aria-hidden />;
  if (rank === "partial")
    return (
      <span
        className={base}
        style={{
          background: "linear-gradient(to bottom, var(--accent) 50%, transparent 50%)",
          boxShadow: "inset 0 0 0 1px var(--accent)",
        }}
        aria-hidden
      />
    );
  return <span className={base} style={{ boxShadow: "inset 0 0 0 1px #c2c2c8" }} aria-hidden />;
}

export function ProofSheet() {
  const { t } = useLang();
  const sheet = t.heroSheet;
  const matches = t.heroMatches;

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
      aria-label={t.hero.sheetAlt}
    >
      {/* One slow pass down the sheet per cycle. Decorative, transform only. */}
      <div
        aria-hidden
        className="sweep pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: "linear-gradient(to right, transparent, var(--accent), transparent)",
          ["--sweep-distance" as string]: "460px",
        }}
      />

      <div className="p-5 sm:p-7">
        {/* ── head ── */}
        <div className="rise flex items-baseline justify-between gap-3" style={at(0.05)}>
          <p className="text-[1.0625rem] font-semibold" style={{ color: "var(--ink-paper)" }}>
            {sheet.role}
          </p>
          <p className="t-meta text-[0.625rem]" style={{ color: "var(--ink-paper-soft)" }}>
            {sheet.docLabel}
          </p>
        </div>

        {/* ── the CV itself ── */}
        <div className="mt-5 space-y-3.5">
          {sheet.sections.slice(0, 2).map((section, s) => (
            <div key={section}>
              <div className="rise flex items-center gap-2" style={at(0.15 + s * 0.1)}>
                <span className="t-meta text-[0.625rem] font-semibold" style={{ color: "var(--ink-paper)" }}>
                  {section}
                </span>
                <span className="h-px flex-1" style={{ backgroundColor: "#e2e2de" }} />
              </div>
              <div className="mt-2 space-y-1.5">
                {["94%", "100%", "72%"].map((w, i) => (
                  <span
                    key={i}
                    className="rise rise-x block h-[0.35rem] rounded-full"
                    style={{
                      width: w,
                      backgroundColor: i === 0 ? "#c9c9cf" : "#e3e3e0",
                      ...at(0.25 + s * 0.12 + i * 0.06),
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── scores, as leader rules ── */}
        <div className="mt-6 border-t pt-5" style={{ borderColor: "#e2e2de" }}>
          <div className="space-y-3">
            {SCORES.map((score, i) => (
              <div key={score.key} className="rise flex items-center gap-3" style={at(0.6 + i * 0.12)}>
                <span
                  className="t-meta w-[6.5rem] shrink-0 text-[0.6875rem] sm:w-[8rem]"
                  style={{ color: "var(--ink-paper-soft)" }}
                >
                  {sheet.scoreLabels[score.key]}
                </span>
                {/* The rule. A track at full width, and a fill scaled to the
                    value — so the geometry is a single transform, which stays
                    on the compositor. */}
                <span className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "#e8e8e4" }}>
                  <span
                    className="leader-fill absolute inset-0 rounded-full"
                    style={{
                      backgroundColor: "var(--accent)",
                      ["--leader-to" as string]: score.value / 100,
                      ["--rise-delay" as string]: `${0.6 + i * 0.12}s`,
                    }}
                  />
                </span>
                <span className="w-8 shrink-0 text-end text-[0.9375rem] tabular-nums">
                  <Figure value={score.value} delay={0.6 + i * 0.12} />
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── matched openings, on the same sheet ── */}
        <div className="mt-6 border-t pt-5" style={{ borderColor: "#e2e2de" }}>
          <p className="rise t-meta text-[0.625rem] font-semibold" style={at(1)} data-role="matches-title">
            {matches.title}
          </p>
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
            {matches.items.slice(0, MATCH_COUNT).map((item, i) => (
              <li
                key={item.role}
                className="rise rise-x flex items-center gap-2.5"
                style={at(1.1 + i * 0.09)}
              >
                <RankMark rank={item.rank} />
                <span className="t-meta min-w-0 flex-1 truncate text-[0.75rem]" style={{ color: "var(--ink-paper)" }}>
                  {item.role}
                </span>
                <span className="t-meta shrink-0 text-[0.6875rem]" style={{ color: "var(--ink-paper-soft)" }}>
                  {matches.ranks[item.rank]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </figure>
  );
}
