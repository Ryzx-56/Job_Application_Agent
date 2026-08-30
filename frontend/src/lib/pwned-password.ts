/**
 * Breached-password check via Have I Been Pwned's k-anonymity range API.
 *
 * HOW IT PRESERVES PRIVACY
 * The password is SHA-1 hashed locally and only the FIRST FIVE hex characters
 * of the hash ever leave the browser. HIBP returns every suffix sharing that
 * prefix (~500-1000 of them) and the match is done here. The full hash, the
 * password, and the account it belongs to are never transmitted.
 *
 * SHA-1 is not a security choice here — it is the digest HIBP's corpus is
 * keyed on. Nothing is stored or verified with it.
 *
 * WHAT THIS IS AND IS NOT
 * This runs in the browser, so it is a GUARDRAIL, not a security boundary.
 * Signup, reset and password-change all call Supabase Auth directly from the
 * client, so anyone willing to call that API themselves bypasses this check
 * entirely. It stops a real person choosing a known-breached password; it does
 * not stop an attacker. The actual server-side floor remains Supabase's
 * `minimum_password_length` setting.
 *
 * Enforcing this server-side would require proxying all three password flows
 * through route handlers. Supabase Auth Hooks cannot do it: `before-user-created`
 * receives no password in its payload, `password-verification-attempt` fires on
 * sign-in rather than password creation and is Teams/Enterprise only, and there
 * is no hook for password change or reset at all.
 *
 * NOTE FOR SECTION 7 (CSP): this fetches https://api.pwnedpasswords.com, which
 * must be present in `connect-src` or the check will be blocked and fail open.
 */

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** Give up rather than hold up a signup if HIBP is slow. */
const TIMEOUT_MS = 3000;

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * How many times this password appears in known breach corpora.
 * Returns 0 when it does not appear — and ALSO 0 on any failure.
 *
 * Failing open is deliberate. HIBP being down, rate-limiting us, or blocked by
 * an extension must never stop someone creating an account or recovering one.
 * A breached password getting through is a far smaller harm than a signup flow
 * that breaks whenever a third party has a bad day.
 */
export async function pwnedCount(password: string): Promise<number> {
  if (!password) return 0;

  // crypto.subtle only exists in a secure context (https, or localhost).
  if (typeof crypto === "undefined" || !crypto.subtle) return 0;

  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(HIBP_RANGE_URL + prefix, {
        signal: controller.signal,
        // Pads the response with random entries so its SIZE cannot be used to
        // infer how many real matches the prefix had.
        headers: { "Add-Padding": "true" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return 0;

    const body = await res.text();
    for (const line of body.split("\n")) {
      // Format is "SUFFIX:COUNT". Padded entries carry a count of 0.
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      if (line.slice(0, idx).trim().toUpperCase() !== suffix) continue;
      const count = Number.parseInt(line.slice(idx + 1).trim(), 10);
      return Number.isFinite(count) ? count : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Convenience wrapper: true when the password appears in a known breach. */
export async function isPasswordBreached(password: string): Promise<boolean> {
  return (await pwnedCount(password)) > 0;
}
