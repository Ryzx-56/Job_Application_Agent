"use client";

import { useLang } from "@/lib/language";

/* ========================================================================
   MATCHED OPENINGS — the hero's second, smaller visual.

   RANK IS CARRIED BY WEIGHT, NOT BY HUE. The obvious rendering is a green /
   amber / red pill per row, which is both the "productivity SaaS" palette
   the brief rules out and unreadable to anyone with a red-green deficiency.
   Instead the mark goes filled -> half -> outline in the single accent, and
   the label says the rest. One accent, and rank survives greyscale.
======================================================================== */

type Rank = "strong" | "partial" | "stretch";

/** Filled, half, outline. Drawn rather than themed, so the three marks are
 *  the same shape at the same size and only their weight differs. */
function RankMark({ rank }: { rank: Rank }) {
  const base = "block size-2.5 shrink-0 rounded-[2px]";
  if (rank === "strong") {
    return <span className={base} style={{ backgroundColor: "var(--accent-quiet)" }} aria-hidden />;
  }
  if (rank === "partial") {
    return (
      <span
        className={base}
        style={{
          // Half-filled along the block direction, so it mirrors with the
          // text rather than pointing the wrong way in Arabic.
          background: "linear-gradient(to bottom, var(--accent-quiet) 50%, transparent 50%)",
          boxShadow: "inset 0 0 0 1px var(--line-accent)",
        }}
        aria-hidden
      />
    );
  }
  return <span className={base} style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)" }} aria-hidden />;
}

export function JobMatches() {
  const { t } = useLang();
  const copy = t.heroMatches;

  return (
    <figure
      className="m-0 overflow-hidden rounded-[0.25rem]"
      style={{ backgroundColor: "var(--surface-raised)", boxShadow: "inset 0 0 0 1px var(--line)" }}
      aria-label={t.hero.matchesAlt}
    >
      <p
        className="t-meta border-b px-4 py-2.5 text-[0.6875rem] sm:px-5"
        style={{ color: "var(--ink-3)", borderColor: "var(--line-hairline)" }}
      >
        {copy.title}
      </p>
      <ul className="m-0 list-none p-0">
        {copy.items.map((item, i) => (
          <li
            key={`${item.role}-${item.city}`}
            // CSS entrance, staggered by index. Same reasoning as the hero:
            // this is above the fold on desktop, and a JS-gated opacity would
            // hide it until hydration.
            className="rise rise-x flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
            style={{
              borderColor: "var(--line-hairline)",
              ["--rise-delay" as string]: `${0.34 + i * 0.07}s`,
            }}
          >
            <RankMark rank={item.rank} />
            {/* At 375px a single line cannot hold role, city and rank without
                truncating the role to nothing, so the row stacks below sm and
                sits on one line above it. Nothing is dropped at either size:
                the rank is the point of the panel. */}
            <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
              <span className="t-meta block truncate" style={{ color: "var(--ink-1)" }}>
                {item.role}
              </span>
              <span
                className="t-meta block text-[0.6875rem] sm:ms-auto sm:shrink-0"
                style={{ color: "var(--ink-3)" }}
              >
                {item.city}
                <span aria-hidden> · </span>
                {copy.ranks[item.rank]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
