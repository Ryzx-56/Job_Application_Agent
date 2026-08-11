"use client";

import { useInView, useReducedMotion, animate } from "framer-motion";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLang } from "@/lib/language";
import { formatNumber } from "@/lib/pricing";

/* ========================================================================
   THE CV SHEET — the hero's primary visual.

   NOT A BROWSER MOCKUP. The previous hero drew a window: traffic-light
   dots, a fake URL bar, a fake sidebar. That is the default SaaS hero and it
   sells the wrong object — what a person leaves here with is a document, not
   an app session. So this is a sheet of paper with real margins and a trim
   edge, and the ATS score sits in the margin the way a proof mark does.

   The animation is the product's actual claim made visible: the same lines
   settle into a new order, and the score resolves. It is not decoration.
   Under prefers-reduced-motion the settled state renders immediately.

   Everything animated here is transform or opacity, so it stays on the
   compositor and off the main thread.
======================================================================== */

const SCORE = 92;
const MATCH = 88;

/** One line of "text" on the sheet. Width is a percentage so the same line
 *  reads correctly at any sheet size, and the fills are type-coloured rather
 *  than grey boxes so the sheet reads as set copy rather than as a skeleton
 *  loader. */
function Line({ w, strong = false }: { w: string; strong?: boolean }) {
  return (
    <span
      className="block h-[0.4rem] rounded-full"
      style={{ width: w, backgroundColor: strong ? "#c9c9cf" : "#e3e3e0" }}
    />
  );
}

/** useLayoutEffect on the client, useEffect on the server, so zeroing the
 *  figure below happens before paint without React warning during SSR. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts to `value` once the sheet is on screen.
 *
 * THE FINAL NUMBER IS WHAT RENDERS ON THE SERVER, and the count is layered on
 * top afterwards. Starting from 0 in state instead meant the HTML shipped an
 * ATS score of "0" — which is what a reader saw with JavaScript still
 * loading, with it disabled, and what a crawler read. A wrong score is worse
 * than no animation. The figure is zeroed in a layout effect, before the
 * first paint after hydration, so nothing flickers.
 *
 * It also writes through a ref rather than state: a counter on state
 * re-renders the component sixty times a second for a purely visual effect,
 * which is exactly the kind of thing that shows up in a mobile trace.
 */
function ScoreFigure({ value, label }: { value: number; label: string }) {
  const { lang } = useLang();
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef, { once: true, amount: 0.6 });

  useBeforePaint(() => {
    // Reduced motion keeps the server's number and never animates.
    if (prefersReducedMotion() || !figureRef.current) return;
    figureRef.current.textContent = formatNumber(0, lang);
  }, [lang]);

  useEffect(() => {
    if (reduced || !inView || !figureRef.current) return;
    const node = figureRef.current;
    const controls = animate(0, value, {
      duration: 1.1,
      delay: 0.5,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = formatNumber(Math.round(v), lang);
      },
    });
    return () => controls.stop();
  }, [inView, reduced, value, lang]);

  return (
    <div ref={wrapRef}>
      <div
        ref={figureRef}
        className="t-figure text-[1.75rem] font-semibold leading-none"
        style={{ color: "var(--ink-paper)" }}
      >
        {formatNumber(value, lang)}
      </div>
      <div className="t-meta mt-1 text-[0.6875rem]" style={{ color: "var(--ink-paper-soft)" }}>
        {label}
      </div>
    </div>
  );
}

export function CvSheet() {
  const { t } = useLang();
  const copy = t.heroSheet;

  return (
    <figure
      className="relative m-0 overflow-hidden rounded-[0.25rem]"
      style={{
        backgroundColor: "var(--surface-paper)",
        // The trim edge: a paper sheet lit from above, not a card with a
        // border. Two stacked shadows read as thickness rather than as glow.
        boxShadow:
          "0 1px 0 0 rgb(255 255 255 / 0.35) inset, 0 18px 40px -12px rgb(0 0 0 / 0.55), 0 2px 8px -2px rgb(0 0 0 / 0.4)",
      }}
      aria-label={t.hero.sheetAlt}
    >
      <div className="grid grid-cols-[1fr_auto] gap-4 p-5 sm:gap-6 sm:p-7">
        {/* ── the set page ── */}
        <div className="min-w-0">
          <p className="t-meta text-[0.625rem] tracking-normal" style={{ color: "var(--ink-paper-soft)" }}>
            {copy.docLabel}
          </p>
          <p className="mt-1 text-[1.0625rem] font-semibold" style={{ color: "var(--ink-paper)" }}>
            {copy.role}
          </p>

          <div className="mt-4 space-y-4">
            {copy.sections.map((section, s) => (
              <div key={section}>
                <div className="flex items-center gap-2">
                  <span
                    className="t-meta text-[0.625rem] font-semibold"
                    style={{ color: "var(--ink-paper)" }}
                  >
                    {section}
                  </span>
                  <span className="h-px flex-1" style={{ backgroundColor: "#dcdcd8" }} />
                </div>
                <div className="mt-2.5 space-y-2">
                  {[["92%", true], ["100%", false], ["78%", false]].map(([w, strong], i) => (
                    <div
                      key={i}
                      // Staggered by section then by line, so the page
                      // composes top to bottom the way type is set. `rise-x`
                      // drifts each line in from the leading edge, which
                      // mirrors in Arabic.
                      className="rise rise-x"
                      style={{ ["--rise-delay" as string]: `${0.2 + s * 0.16 + i * 0.06}s` }}
                    >
                      <Line w={w as string} strong={strong as boolean} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── the margin, where the proof marks live ── */}
        <div
          className="flex w-[4.5rem] shrink-0 flex-col gap-5 border-s ps-4 sm:w-[5.5rem]"
          style={{ borderColor: "#e6e6e2" }}
        >
          <ScoreFigure value={SCORE} label={copy.scoreLabel} />
          <ScoreFigure value={MATCH} label={copy.matchLabel} />
        </div>
      </div>
    </figure>
  );
}
