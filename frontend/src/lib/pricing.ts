/* ========================================================================
   PRICE DISPLAY: one place, used by every surface that shows a price.

   SAR IS THE PRICE. Every plan, pack and add-on is priced and charged in
   Saudi riyals, so SAR is what's shown large. The dollar figure underneath is
   a reference for readers who think in USD, converted at the peg, and it is
   NOT a currency the customer can pay in. Nothing here is a currency
   selector, and no dollar amount is ever the number charged.

   Amounts live as NUMBERS in language.tsx (`sar: 49`), not as pre-baked
   strings, so the riyal figure and its dollar reference can never disagree,
   and Arabic can render the same number with its own currency word.
======================================================================== */

/** SAR has been pegged at 3.75 to the dollar since 1986, so this is a
 *  constant rather than a rate to fetch. Same value the backend uses in
 *  core/admin_stats.py, deliberately: two surfaces converting differently is
 *  how a page ends up disagreeing with the ledger. */
export const SAR_PER_USD = 3.75;

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
