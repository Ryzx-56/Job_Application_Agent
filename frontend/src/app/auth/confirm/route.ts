import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * Handles the link sent by the "Send Email" Auth Hook
 * (supabase/functions/send-email) for signup confirmation, password
 * reset, and any other OTP-based email action.
 *
 * The hook builds links as:
 *   {site_url}/auth/confirm?token_hash=...&type=...&redirect_to=...
 * which is the token_hash/OTP flow — distinct from `/auth/callback`,
 * which only handles the `?code=` PKCE exchange used by Google OAuth.
 *
 * Verifying here (server-side) sets the session cookies, so the person
 * lands on /reset-password (or /dashboard) already authenticated.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // `redirect_to` comes off the emailed link and is attacker-controllable, so
  // it is resolved against our own origin and rejected if it points anywhere
  // else. Absolute same-origin URLs still work, which is the shape the email
  // hook actually sends — see lib/safe-redirect.ts.
  const redirectTo = safeRedirect(searchParams.get("redirect_to"), origin);

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
    console.error("verifyOtp failed:", { type, message: error.message, status: error.status });
  }

  // Expired/already-used links are the common failure case (tokens are
  // single-use). Recovery links fail back to forgot-password with a message
  // the person can actually act on, rather than a silent trip to /login.
  const fallback = type === "recovery" ? "/forgot-password?error=expired" : "/login?error=confirm";
  return NextResponse.redirect(`${origin}${fallback}`);
}
