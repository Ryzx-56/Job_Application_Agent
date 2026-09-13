/* ========================================================================
   Shared reading of the 402/429 shapes begin_addon_use() (backend/
   core/entitlements.py) raises for the three credit-purchasable add-ons —
   Job Search, Interview Prep, LinkedIn Essential.

   ONE PLACE TO READ THESE FIELDS, because three pages need the exact same
   answer to "is this the confirm-a-purchase case" and must not each grow
   their own slightly different guess at the shape. Verified against the
   real backend code, not assumed:

     · 402 addon_purchase_available — {code, addon, credit_cost,
       credit_balance, message}. Baseline is exhausted, credits could cover
       it, caller didn't confirm yet.
     · 429 purchase_limit_reached — {code, addon, purchase_limit, message}.
       Job Search only (the one add-on with a purchase cap on top of its
       baseline) — spending credits cannot fix this, so it must NOT open the
       purchase dialog.
     · 402 insufficient_credits — {code, message, credits_remaining,
       credits_needed, tier}. Confirmed, but the balance moved (or was
       always short) between the 402 and the confirm.
     · 429 rate_limited (core/rate_limit.py, a DIFFERENT mechanism with a
       different code) — {code, limit, retry_after, message}. Request
       volume, not cost — a purchase cannot fix this either.
======================================================================== */

type ErrorLike = {
  code?: string;
  status?: number;
  message?: string;
  detail?: Record<string, unknown>;
};

export type AddonPurchaseOffer = {
  addon: string;
  creditCost: number;
  creditBalance: number;
  message: string;
};

/** Non-null only for the exact case this dialog exists to handle: baseline
 *  exhausted, a confirmed purchase would work. Every other shape (rate
 *  limit, purchase cap, insufficient credits, anything else) must fall
 *  through to a plain error message instead of opening the dialog. */
export function readAddonPurchaseOffer(err: ErrorLike): AddonPurchaseOffer | null {
  if (err.code !== "addon_purchase_available") return null;
  const detail = err.detail;
  const creditCost = Number(detail?.credit_cost);
  const creditBalance = Number(detail?.credit_balance);
  if (!Number.isFinite(creditCost) || !Number.isFinite(creditBalance)) return null;
  return {
    addon: typeof detail?.addon === "string" ? detail.addon : "",
    creditCost,
    creditBalance,
    message: typeof detail?.message === "string" ? detail.message : err.message || "",
  };
}

/** True for the Job Search purchase cap specifically — a real refusal, not
 *  something a credit purchase or a retry can fix. */
export function isPurchaseLimitReached(err: ErrorLike): boolean {
  return err.code === "purchase_limit_reached";
}

/** True for core/rate_limit.py's request-volume limiter — distinct from
 *  purchase_limit_reached even though both are 429s. A rate limit clears on
 *  its own after `retry_after` seconds; a purchase cap does not clear until
 *  the next billing cycle. Conflating the two would tell a rate-limited
 *  user their monthly allowance is gone, or tell a capped-out user to just
 *  wait a moment. */
export function isRateLimited(err: ErrorLike): boolean {
  return err.code === "rate_limited";
}

/** True once credits were reserved but the balance couldn't actually cover
 *  it — only reachable if the balance changed between the 402 and the
 *  confirm (another tab, a refund landing), since the 402 itself already
 *  read the balance moments earlier. */
export function isInsufficientCredits(err: ErrorLike): boolean {
  return err.code === "insufficient_credits";
}
