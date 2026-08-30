/**
 * Same-origin redirect validation for the auth routes.
 *
 * WHY THIS EXISTS
 * /auth/confirm and /auth/callback both took a destination straight off the
 * query string and redirected to it. `redirect_to` on the confirm route was
 * used raw, so a genuine tarshih.com link could bounce someone to any site;
 * `next` on the callback route was prefixed with the origin, which looks safe
 * but is not — "//evil.com" becomes "https://tarshih.com//evil.com", which
 * browsers read as protocol-relative and follow off-site.
 *
 * WHAT HAS TO KEEP WORKING
 * The Send Email auth hook (supabase/functions/send-email) builds links as
 *   {site_url}/auth/confirm?token_hash=...&redirect_to=<ABSOLUTE URL>
 * because Supabase passes through the absolute `redirectTo` given to
 * resetPasswordForEmail() — e.g. "https://tarshih.com/reset-password?lang=ar".
 * So an absolute same-origin URL must still be accepted, or every password
 * reset link already sitting in someone's inbox breaks. Relative paths are
 * accepted too, since the hook's own comment notes redirect_to "may be absent
 * or relative".
 */

/**
 * Resolves an untrusted redirect target against `origin`, returning an
 * absolute URL string that is guaranteed to be on that origin.
 *
 * Accepts: an absolute URL on this origin, or a relative path.
 * Rejects:  a different origin, protocol-relative ("//host"), backslash
 *           variants ("/\host"), javascript:/data: schemes, and unparseable
 *           input — all fall back to `fallbackPath`.
 */
export function safeRedirect(
  raw: string | null | undefined,
  origin: string,
  fallbackPath = "/dashboard"
): string {
  const fallback = new URL(fallbackPath, origin).toString();
  if (!raw) return fallback;

  try {
    // The two-argument form resolves a relative path against the origin and
    // parses an absolute URL as-is. Either way the origin check below is what
    // actually decides: "//evil.com" resolves to https://evil.com and is
    // rejected, rather than being silently concatenated onto our own origin.
    const target = new URL(raw, origin);
    return target.origin === origin ? target.toString() : fallback;
  } catch {
    return fallback;
  }
}
