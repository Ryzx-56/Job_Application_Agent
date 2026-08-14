"use client";

import { ArrowUpRight } from "lucide-react";
import { useLang } from "@/lib/language";
import { Figure } from "./figure";

/* ========================================================================
   HERO VISUAL 2 — THE MATCHED OPENINGS PANEL (brief §3.1)

   TRACED TO THE REAL COMPONENT: the similar-jobs list the dashboard renders
   after every generation (app/dashboard/page.tsx). Its shape is fixed by the
   backend, not chosen here:

     · agents/jobs_finder.py caps the result set at RESULT_CAP = 5, which is
       where the "five" in the copy comes from.
     · Every listing carries exactly one match_label, and jobs_finder.py emits
       exactly three of them: "Strong Match", "Partial Match", "Stretch Role".
     · Every listing carries a url, and the dashboard renders each row as an
       anchor to it.

   NO EMPLOYER NAMES. Pairing a real company with a "matched opening" implies
   that company is hiring through us. Roles and cities only.

   ── WHY THIS IS PAPER AND NOT A DARK PANEL ──────────────────────────────
   It was built on --surface-raised first, on the reasoning that two identical
   sheets stacked would read as one thing shown twice. That was the wrong
   trade: --surface-raised is #131316 against a #09090b page, a four-point
   difference that reads as a rectangle of almost the same black rather than
   as an object sitting on the page. The score panel pops because it is paper.
   This one is paper too — the lighter end of the same ramp, no new colour.

   The two are told apart by STRUCTURE instead of by material, which is the
   more durable distinction anyway: visual 1 is a measurement, set as leader
   rules with no divisions; this is a list of records, so it has a tinted
   header band, a rule between every row, and a link affordance on each one.
   Same stock, different document.

   ── THE LINKS ARE THE FEATURE, SO THEY ARE ON EVERY ROW ─────────────────
   That every match opens the real posting was one caption at the bottom of
   the panel, which is where a reader's eye has already left. It now appears
   twice and both times where it cannot be missed: once in the header band, in
   the accent colour, and again as a persistent label on every single row. No
   hover state carries it, because a hover state does not exist on a phone and
   most of these readers are on one.

   THE MOTION IS A SCAN, NOT AN ENTRANCE. Rows light in sequence on the same
   9s cycle as the score panel, so both visuals breathe together and there is
   always something moving for someone who arrives a second late. Nothing is
   ever cleared: the list stays legible at every point in the cycle.
======================================================================== */

/** RESULT_CAP in backend/agents/jobs_finder.py. */
const MATCH_COUNT = 5;

/** Hairline between rows. Slightly lighter than the header band's rule so the
 *  band still reads as the panel's head rather than as the first row. */
const ROW_RULE = "#ebebe7";
const BAND_RULE = "#e2e2de";

/** Filled, half, outline. Weight carries rank, not hue — the dashboard uses
 *  emerald/amber/rose, which is both the stock SaaS palette and unreadable to
 *  anyone with a red-green deficiency. */
function RankMark({ rank }: { rank: "strong" | "partial" | "stretch" }) {
  const base = "block h-5 w-[3px] shrink-0 rounded-full";
  if (rank === "strong") {
    return <span className={base} style={{ backgroundColor: "var(--accent)" }} aria-hidden />;
  }
  if (rank === "partial") {
    return (
      <span
        className={base}
        style={{
          background: "linear-gradient(to bottom, var(--accent) 50%, #d8d8d4 50%)",
          boxShadow: "inset 0 0 0 1px var(--accent)",
        }}
        aria-hidden
      />
    );
  }
  return <span className={base} style={{ backgroundColor: "#d8d8d4" }} aria-hidden />;
}

export function MatchesPanel() {
  const { t } = useLang();
  const copy = t.heroMatches;
  const items = copy.items.slice(0, MATCH_COUNT);

  return (
    <figure
      className="relative m-0 flex h-full flex-col overflow-hidden rounded-[0.875rem]"
      style={{
        backgroundColor: "var(--surface-paper)",
        boxShadow:
          "0 1px 0 0 rgb(255 255 255 / 0.5) inset, 0 1px 2px 0 rgb(0 0 0 / 0.28), 0 12px 24px -10px rgb(0 0 0 / 0.4), 0 32px 64px -24px rgb(0 0 0 / 0.55)",
        // .scan-row's wash is tuned for the dark page ground, where 12% blue
        // is a whisper. On white paper it resolves to #e0e7f4, and
        // --ink-paper-soft on that measures 4.25:1 — under the 4.5:1 floor,
        // for the moment a row is being scanned. Lighthouse caught it mid
        // cycle. Same override the trust sheet already carries.
        ["--accent-wash" as string]: "rgb(37 99 235 / 0.055)",
      }}
      aria-label={t.hero.matchesAlt}
    >
      {/* ── masthead. The count is the headline of this panel, so it is set
            as one, and the promise that every row opens a real posting sits
            directly under it in the accent rather than competing with it on
            the same line. ── */}
      <div className="px-6 pb-5 pt-6 sm:px-7">
        <div className="flex items-baseline gap-3">
          <Figure
            value={MATCH_COUNT}
            delay={0.15}
            className="text-[2.5rem] font-semibold leading-none tracking-[-0.02em]"
            style={{ color: "var(--ink-paper)" }}
          />
          <p className="t-title font-semibold" style={{ color: "var(--ink-paper)" }}>
            {copy.countLabel}
          </p>
        </div>
        <p className="t-meta mt-2 inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--accent)" }}>
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
          {copy.linkNote}
        </p>
      </div>

      <ul className="m-0 flex flex-1 list-none flex-col justify-between p-0" style={{ borderTop: `1px solid ${BAND_RULE}` }}>
        {items.map((item, i) => (
          <li
            key={item.role}
            // Taller rows only in the side-by-side layout, so this panel
            // finishes at roughly the same height as the score panel it sits
            // under and the two read as a matched pair rather than as a big
            // one and a small one.
            className="scan-row flex flex-1 items-center gap-3.5 px-6 py-[1rem] sm:px-7 xl:py-[1.35rem]"
            style={{
              borderTop: i === 0 ? undefined : `1px solid ${ROW_RULE}`,
              // Each row's turn in the scan, spread across the shared cycle.
              ["--scan-delay" as string]: `${0.9 + i * 0.55}s`,
            }}
          >
            <RankMark rank={item.rank} />
            <span className="t-body min-w-0 flex-1 truncate font-medium" style={{ color: "var(--ink-paper)" }}>
              {item.role}
              <span className="font-normal" style={{ color: "var(--ink-paper-soft)" }}>
                {" · "}
                {item.city}
              </span>
            </span>
            {/* Kept at every width. The rank is what makes this a ranked list
                rather than five links, and dropping it on mobile would drop it
                for most of the people who see this page. */}
            <span
              className="t-meta shrink-0 whitespace-nowrap text-[0.75rem] sm:text-[0.8125rem]"
              style={{ color: "var(--ink-paper-soft)" }}
            >
              {copy.ranks[item.rank]}
            </span>
            {/* Persistent, not a hover state: on a phone there is no hover, and
                this is the thing a visitor most needs to notice. */}
            <span
              className="t-meta inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.8125rem] font-medium"
              style={{ color: "var(--accent)" }}
            >
              <span className="hidden sm:inline">{copy.viewListing}</span>
              <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
