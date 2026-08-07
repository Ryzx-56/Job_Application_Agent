import type { AuthError } from "@supabase/supabase-js";

/**
 * Maps a Supabase auth error from updateUser({ password }) onto a stable key,
 * so each page can show its own translated message instead of a generic
 * "something went wrong" (or, worse, Supabase's raw English string).
 *
 * Matches on `error.code` first, falling back to message text: `code` is only
 * populated on newer gotrue versions, and the hosted project can be upgraded
 * out from under us.
 */
export type PasswordErrorKey =
  | "samePassword"
  | "tooShort"
  | "weakPassword"
  | "sessionExpired"
  | "rateLimited"
  | "generic";

export function passwordErrorKey(error: AuthError): PasswordErrorKey {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  const status = error.status ?? 0;

  if (code === "same_password" || message.includes("should be different from the old password")) {
    return "samePassword";
  }

  if (code === "weak_password" || message.includes("password should be at least") || message.includes("weak")) {
    // AuthWeakPasswordError carries the specific policy failures; "length"
    // means too short, which has a clearer message than the generic one.
    const reasons = (error as AuthError & { reasons?: string[] }).reasons;
    if (reasons?.includes("length") || message.includes("at least")) return "tooShort";
    return "weakPassword";
  }

  if (code === "session_not_found" || code === "reauthentication_needed" || status === 401 || status === 403) {
    return "sessionExpired";
  }

  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) {
    return "rateLimited";
  }

  return "generic";
}
