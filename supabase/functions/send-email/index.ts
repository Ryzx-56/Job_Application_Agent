// index.ts
// Supabase "Send Email" Auth Hook.
// Deploy as an Edge Function, then point Authentication -> Hooks -> Send Email
// at this function's URL in the Supabase dashboard.
//
// This bypasses Supabase's built-in email sender (and its 2/hour limit)
// entirely — Supabase calls this function instead of sending the email itself.
// We pick the language template based on the user's stored preference and
// send via Resend.
//
// ASSUMPTION TO CHECK: this reads the user's language from
// user.user_metadata.preferred_language (expects "ar" or "en").
// If your signup form stores it under a different key, change LANG_METADATA_KEY below.

import { Webhook } from "npm:standardwebhooks@1.0.0";
import { getEmailTemplate, EmailType } from "./templates.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
// The Supabase dashboard gives you this secret as "v1,whsec_XXXX" (a version
// prefix + the real secret), but the standardwebhooks library only expects
// the "whsec_XXXX" part — strip the version prefix or every signature check
// fails and GoTrue reports the hook as broken (500 on signup/recover).
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace(/^v1[a-z]?,/, "");
const FROM_ADDRESS = Deno.env.get("EMAIL_FROM") ?? "Tarshih <noreply@tarshih.com>";
// Prefer our own explicit site URL over email_data.site_url — the latter
// comes from Supabase's "Site URL" Auth setting, but in practice it can
// resolve to the project's own API base URL (https://<ref>.supabase.co/auth/v1)
// instead of the real frontend domain, breaking both the confirmation link
// and the logo image. Setting SITE_URL ourselves removes that uncertainty.
const SITE_URL = Deno.env.get("SITE_URL"); // e.g. "https://tarshih.com" — no trailing slash

const LANG_METADATA_KEY = "preferred_language"; // <-- adjust to match your signup form's field name
const DEFAULT_LANG: "ar" | "en" = "en";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeLang(value: string | null | undefined): "ar" | "en" | null {
  const v = value?.toLowerCase();
  return v === "ar" ? "ar" : v === "en" ? "en" : null;
}

Deno.serve(async (req: Request) => {
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  // Verify the request actually came from Supabase (Standard Webhooks signature).
  const wh = new Webhook(HOOK_SECRET);
  let data: {
    user: { email: string; user_metadata?: Record<string, unknown> };
    email_data: {
      token: string;
      token_hash: string;
      redirect_to: string;
      email_action_type: EmailType;
      site_url: string;
    };
  };

  try {
    data = wh.verify(payload, headers) as typeof data;
  } catch (err) {
    console.error("Hook signature verification failed:", err);
    return json({ error: { http_code: 401, message: "Invalid signature" } }, 401);
  }

  const { user, email_data } = data;

  const siteUrl = (SITE_URL || email_data.site_url).replace(/\/+$/, "");

  // Language, in priority order:
  //  1. ?lang= on redirect_to — the language the person is browsing in right
  //     now. Password resets happen while logged out, where the language
  //     switcher can't write to the account, so stored metadata goes stale;
  //     what's on screen at request time is the better signal.
  //  2. user_metadata.preferred_language — set at signup / from settings.
  //  3. DEFAULT_LANG.
  let redirectLang: "ar" | "en" | null = null;
  try {
    redirectLang = normalizeLang(new URL(email_data.redirect_to).searchParams.get("lang"));
  } catch {
    // redirect_to may be absent or relative; metadata fallback covers it.
  }
  const metaLang = normalizeLang(user.user_metadata?.[LANG_METADATA_KEY] as string | undefined);
  const lang: "ar" | "en" = redirectLang ?? metaLang ?? DEFAULT_LANG;
  console.log(
    `email_action_type=${email_data.email_action_type} redirectLang=${redirectLang ?? "(none)"} metaLang=${metaLang ?? "(none)"} resolvedLang=${lang} siteUrl=${siteUrl}`
  );

  const confirmationUrl =
    `${siteUrl}/auth/confirm` +
    `?token_hash=${email_data.token_hash}` +
    `&type=${email_data.email_action_type}` +
    `&redirect_to=${encodeURIComponent(email_data.redirect_to)}`;

  // Greet the reader in the script the email itself is written in. Users
  // supply a name in Arabic, English, or both, so an Arabic email should
  // open with their Arabic name where one exists. Falls back to the other
  // script (a real name in the wrong script still beats no name), then to
  // the legacy full_name, which is all a Google OAuth signup ever has.
  //
  // These are kept in sync with profiles by the backend whenever a name is
  // edited — see _sync_auth_metadata_names in core/profile_names.py.
  const meta = user.user_metadata ?? {};
  const nameEn = meta.name_en as string | undefined;
  const nameAr = meta.name_ar as string | undefined;
  const preferredName = lang === "ar" ? nameAr : nameEn;
  const otherName = lang === "ar" ? nameEn : nameAr;
  const greetingName =
    preferredName?.trim() || otherName?.trim() || (meta.full_name as string | undefined);

  const { subject, html } = getEmailTemplate(lang, email_data.email_action_type, confirmationUrl, {
    siteUrl,
    name: greetingName,
  });

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [user.email],
      subject,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("Resend send failed:", errText);
    return json({ error: { http_code: 500, message: "Email send failed" } }, 500);
  }

  // MUST be an empty JSON object with an application/json content type.
  // GoTrue parses this response; anything else (including a stray {"ok":true}
  // sent as text/plain) makes it treat the hook as failed, which returns 400
  // to the caller AND rolls back the token it just generated — so the email
  // we already sent carries a token_hash that never got committed, and the
  // link 403s the instant it's clicked.
  return json({}, 200);
});
