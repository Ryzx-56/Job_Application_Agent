"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/language";

/* ========================================================================
   "N/M left this month", for the three metered add-ons.

   WHY IT EXISTS. Job Search, Interview Prep and LinkedIn Essential all draw
   on a monthly baseline, and until now the only way to discover the baseline
   was exhausted was to press the button and get the credit-purchase dialog.
   That dialog is correct — nothing is charged without confirmation — but it
   arrives after the user has committed, which is the wrong moment to learn
   how much is left.

   ONE ENDPOINT, NOT THREE. /api/v1/addons/summary (backend/core/
   entitlements.py) already answers this for every add-on in a single GET;
   it exists precisely so a page doesn't assemble this from several calls.

   ─── A FAILED READ IS NOT A ZERO ──────────────────────────────────────
   If the summary cannot be fetched, this renders NOTHING. It does not fall
   back to 0/0, and it does not fall back to a full allowance. A count is
   only shown when it was actually read, because a confident "0 left"
   painted red on an unread value tells a paying subscriber they are out of
   something they still have — the exact defect CLAUDE.md's rule is about.
   The button beside it is unaffected either way: enforcement lives in
   begin_addon_use() server-side, never here.

   (The backend's own read is deliberately optimistic one level down —
   get_addon_quota reports `used: 0` when the counter column can't be read,
   so a transient failure shows the FULL allowance rather than locking
   someone out. That direction is safe for this badge: it can over-report
   what's left, never under-report it.)
======================================================================== */

export type AddonKey = "job_search" | "interview_prep" | "linkedin_essential";

type AddonFigures = {
  baseline_limit: number;
  baseline_remaining: number;
};

type AddonSummaryResponse = Record<AddonKey, AddonFigures> & {
  credit_balance: number;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/** The summary, or null if it could not be read. Null is "unknown", never
 *  "nothing left" — see the header note. */
export async function fetchAddonSummary(): Promise<AddonSummaryResponse | null> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session?.access_token) return null;
    const res = await fetch(`${API_URL}/api/v1/addons/summary`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      console.error("fetchAddonSummary failed:", res.status);
      return null;
    }
    return (await res.json()) as AddonSummaryResponse;
  } catch (err) {
    console.error("fetchAddonSummary failed:", err);
    return null;
  }
}

/** Loads the summary once on mount. `refresh` re-reads it — call it after a
 *  generation so the count moves without a page reload. */
export function useAddonSummary(): {
  summary: AddonSummaryResponse | null;
  refresh: () => void;
} {
  const [summary, setSummary] = useState<AddonSummaryResponse | null>(null);

  const load = React.useCallback(() => {
    let cancelled = false;
    fetchAddonSummary().then((data) => {
      if (!cancelled) setSummary(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return { summary, refresh: load };
}

/* Proportion of the allowance still unspent decides the colour. "Comfortable"
   is more than half; anything at or below half is a warning; zero is the
   point at which the next action spends credits instead, which the existing
   purchase dialog already handles. */
export function addonRemainingTone(remaining: number, limit: number): string {
  if (remaining <= 0) return "border-rose-200 bg-rose-50 text-rose-700";
  if (remaining / limit <= 0.5) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

/** The same three bands as a bare text colour, for a caller that already has
 *  the numbers and its own layout — the LinkedIn Essential panel prints this
 *  line itself and must not grow a second badge saying the same thing.
 *  Each of these clears 4.5:1 on white. */
export function addonRemainingTextTone(remaining: number, limit: number): string {
  if (remaining <= 0) return "text-rose-700";
  if (remaining / limit <= 0.5) return "text-amber-800";
  return "text-emerald-700";
}

export function AddonRemaining({
  addon,
  summary,
  className = "",
}: {
  addon: AddonKey;
  summary: AddonSummaryResponse | null;
  className?: string;
}) {
  const { t } = useLang();
  const copy = t.dashboard.addons;

  const figures = summary?.[addon];
  // Not read yet, unreadable, or a tier with no monthly allowance at all
  // (Free) — in none of those cases is there an honest "N of M" to print.
  if (!figures || figures.baseline_limit <= 0) return null;

  const { baseline_limit: limit, baseline_remaining: remaining } = figures;

  return (
    <p
      className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${addonRemainingTone(
        remaining,
        limit
      )} ${className}`}
    >
      <span>{copy.remainingLabel}</span>
      {/* A count is a left-to-right expression even inside an RTL page: an
          isolate keeps "1/5" from being reordered into "5/1". */}
      <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">
        {remaining}/{limit}
      </span>
      {remaining <= 0 && <span className="font-normal">{copy.remainingExhausted}</span>}
      <span className="sr-only">{copy.remainingSr(remaining, limit)}</span>
    </p>
  );
}
