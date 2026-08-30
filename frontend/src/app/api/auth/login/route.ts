import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { check, recordFailure, clear, clientIp, IP_RULE, EMAIL_RULE } from "@/lib/rate-limit";

/**
 * Server-side login, so that credential stuffing meets a rate limiter.
 *
 * WHY THIS ROUTE EXISTS
 * The login form used to call supabase.auth.signInWithPassword() straight from
 * the browser. That works, but it means every attempt goes directly to Supabase
 * and never passes through anything we control, so there is nowhere to put a
 * per-IP or per-account limit. Routing sign-in through here creates that place.
 *
 * WHY A NEXT ROUTE HANDLER AND NOT THE FASTAPI BACKEND
 * The session lives in cookies on this origin. The backend is on a different
 * domain (Render), so it could not set them without cross-site cookie work, and
 * it is on a free tier that cold-starts — putting a 30-second spin-up directly
 * in the login path would be worse than the problem being solved.
 *
 * ON FAILURE SEMANTICS
 * Wrong credentials return 401 with no detail about WHICH part was wrong, and
 * the response never distinguishes "no such account" from "wrong password" —
 * same as before, so this route does not become an account-enumeration oracle.
 */

/** Cap the body so a huge payload cannot be used to burn server time. */
const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  let email: string;
  let password: string;

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "invalid_request" }, { status: 413 });
    }
    const body = JSON.parse(raw);
    email = typeof body?.email === "string" ? body.email.trim() : "";
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const ip = clientIp(request.headers);
  // Lower-cased so casing variants of one address share a bucket.
  const emailKey = `email:${email.toLowerCase()}`;
  const ipKey = `ip:${ip}`;

  // Checked BEFORE touching Supabase: a blocked caller must cost us nothing
  // and must not reach the auth provider at all.
  const [ipVerdict, emailVerdict] = await Promise.all([
    check(ipKey, IP_RULE),
    check(emailKey, EMAIL_RULE),
  ]);
  if (!ipVerdict.ok || !emailVerdict.ok) {
    const retryAfter = Math.max(ipVerdict.retryAfter, emailVerdict.retryAfter);
    return NextResponse.json(
      { error: "too_many_attempts", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Both buckets are charged, so neither dimension can be evaded by varying
    // the other.
    await Promise.all([
      recordFailure(ipKey, IP_RULE),
      recordFailure(emailKey, EMAIL_RULE),
    ]);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // A real sign-in clears the account's counter, so someone who mistyped a few
  // times and then got it right is not left throttled.
  await clear(emailKey);

  // Session cookies were written to the response by the server client's
  // cookie adapter (lib/supabase/server.ts). The browser client reads them
  // back from document.cookie on the next page load, which is why the form
  // does a full navigation rather than a client-side push.
  return NextResponse.json({ ok: true });
}
