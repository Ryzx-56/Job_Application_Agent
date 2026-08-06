import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the link sent by the "Send Email" Auth Hook
 * (supabase/functions/send-email) for signup confirmation, password
 * reset, and any other OTP-based email action.
 *
 * The hook builds links as:
 *   {site_url}/auth/confirm?token_hash=...&type=...&redirect_to=...
 * which is the token_hash/OTP flow — distinct from `/auth/callback`,
 * which only handles the `?code=` PKCE exchange used by Google OAuth.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const redirectTo = searchParams.get("redirect_to") ?? `${origin}/dashboard`;

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
