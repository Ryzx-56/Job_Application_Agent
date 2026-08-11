/* ========================================================================
   PRICE DISPLAY: one place, used by every surface that shows a price.

   SAR IS THE PRICE. Every plan, pack and add-on is priced and charged in
   Saudi riyals, so SAR is what's shown large. The dollar figure underneath is
   a reference for readers who think in USD, converted at the peg, and it is
   NOT a currency the customer can pay in. Nothing here is a currency
   selector, and no dollar amount is ever the number charged.

   EVERY AMOUNT, ALLOWANCE AND CAP THE SITE QUOTES LIVES IN THIS FILE, and
   both language dictionaries import them. They used to be typed out
   separately in the `en` and `ar` halves of language.tsx — the same number
   written four or six times — and that is precisely how the site ended up
   telling visitors that Pro included 40 credits when it includes 24, and
   that LinkedIn Essential cost 49 SAR a year after it stopped being sold.
   A number that appears twice is a number that will eventually disagree
   with itself, so nothing below may be re-typed into a dictionary string:
   interpolate it.

   These mirror the backend, which is what actually enforces them:
     · TIERS.credits      -> TIER_CREDITS   in backend/core/credits.py
     · CREDIT_COST        -> CREDIT_COST    in backend/core/credits.py
     · ADDON_CAPS         -> ADDON_CAPS     in backend/core/entitlements.py
     · LINKEDIN_PREMIUM   -> PRICING        in backend/core/linkedin.py
     · TIERS.sar / PACKS  -> TIER_PRICING / PACK_PRICING in
                             backend/core/admin_stats.py
   Subscription and pack prices have no other backend home: nothing charges
   for them yet (no payment gateway is configured), so admin_stats.py is the
   only other copy and these two must be changed together.
======================================================================== */

/** SAR has been pegged at 3.75 to the dollar since 1986, so this is a
 *  constant rather than a rate to fetch. Same value the backend uses in
 *  core/admin_stats.py, deliberately: two surfaces converting differently is
 *  how a page ends up disagreeing with the ledger. */
export const SAR_PER_USD = 3.75;

/* ── THE NUMBERS ─────────────────────────────────────────────────────────
   Plain numbers, never pre-formatted strings: formatSar() below renders the
   riyal figure and each language renders its own currency word, so one
   value can serve both dictionaries. */

/** Credits spent per generated CV + cover letter. Arabic costs more because
 *  it takes more processing, which is why a free allowance yields fewer
 *  Arabic CVs than English ones — any copy about free usage must say so. */
export const CREDIT_COST = { en: 1, ar: 2 };

/** Monthly subscription price in SAR, and the credits it grants. */
export const TIERS: Record<"free" | "pro" | "elite", { sar: number; credits: number }> = {
  free: { sar: 0, credits: 3 },
  pro: { sar: 29, credits: 24 },
  elite: { sar: 99, credits: 80 },
};

/** One-off credit packs. Keys are the `slug` the checkout route reads. */
export const PACKS: Record<"starter" | "best-value" | "power", { sar: number; credits: number }> = {
  starter: { sar: 9, credits: 5 },
  "best-value": { sar: 22, credits: 15 },
  power: { sar: 38, credits: 30 },
};

/** Bundled add-ons, capped per month. Neither is sold: both come with a
 *  paid plan, and Free gets zero of each. */
export const ADDON_CAPS: Record<"pro" | "elite", { linkedinEssential: number; interviewPrep: number }> = {
  pro: { linkedinEssential: 2, interviewPrep: 5 },
  elite: { linkedinEssential: 5, interviewPrep: 15 },
};

/** The only LinkedIn tier with a price. Essential deliberately has none —
 *  it is an inclusion, not a product. */
export const LINKEDIN_PREMIUM_SAR = 200;

/**
 * Arabic counted nouns.
 *
 * Arabic does not pluralize the way English does: 1 takes a singular, 2
 * takes a DUAL form that carries the count inside the word itself (نقطتان,
 * "two credits" — no numeral in front of it), 3-10 take a plural (٣ نقاط),
 * and 11 and up go back to a singular (٢٤ نقطة). Interpolating a number in
 * front of one fixed noun therefore produces wrong Arabic the moment a
 * value crosses a band, which would trade the drift bug this file exists to
 * fix for a grammar bug. The caller supplies each form and the count picks
 * one.
 *
 * Categories are Arabic's CLDR plural rules (one / two / few / many).
 */
export function arCount(
  n: number,
  forms: { one: string; two: string; few: string; many: string }
): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

/** English counted nouns. Trivial next to arCount, but it keeps the two
 *  dictionaries symmetrical so neither drifts back to a literal. */
export function enCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The charged price, formatted for display. */
export function formatSar(amount: number, lang: string): string {
  const value = Number(amount ?? 0).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", {
    maximumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2,
  });
  return lang === "ar" ? `${value} ريال` : `${value} SAR`;
}

/**
 * The small dollar reference line, e.g. "≈ $13".
 *
 * Rounded to whole dollars on purpose: showing "$13.07" invites the reader to
 * treat it as a real, precise price, which it isn't. Returns null for zero so
 * a free plan doesn't get a pointless "≈ $0" underneath it.
 */
export function usdApprox(amountSar: number): string | null {
  const sar = Number(amountSar ?? 0);
  if (!Number.isFinite(sar) || sar <= 0) return null;
  return `≈ $${Math.round(sar / SAR_PER_USD).toLocaleString("en-US")}`;
}

/** Per-credit value for the pay-as-you-go packs, in riyals. */
export function sarPerCredit(amountSar: number, credits: number, lang: string): string | null {
  if (!credits) return null;
  const perCredit = Number(amountSar) / credits;
  const value = perCredit.toLocaleString(lang === "ar" ? "ar-EG" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return lang === "ar" ? `≈ ${value} ريال` : `≈ ${value} SAR`;
}
