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
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const { user, email_data } = data;

  const siteUrl = (SITE_URL || email_data.site_url).replace(/\/+$/, "");

  const rawLang = (user.user_metadata?.[LANG_METADATA_KEY] as string | undefined)?.toLowerCase();
  const lang: "ar" | "en" = rawLang === "ar" ? "ar" : rawLang === "en" ? "en" : DEFAULT_LANG;
  // Diagnostic: shows up in the function's logs so language selection can be
  // verified against the actual stored user_metadata without DB access.
  console.log(
    `email_action_type=${email_data.email_action_type} rawLang=${rawLang ?? "(none)"} resolvedLang=${lang} siteUrl=${siteUrl} (SITE_URL secret set: ${!!SITE_URL})`
  );

  const confirmationUrl =
    `${siteUrl}/auth/confirm` +
    `?token_hash=${email_data.token_hash}` +
    `&type=${email_data.email_action_type}` +
    `&redirect_to=${encodeURIComponent(email_data.redirect_to)}`;

  const fullName = user.user_metadata?.full_name as string | undefined;
  const { subject, html } = getEmailTemplate(lang, email_data.email_action_type, confirmationUrl, {
    siteUrl,
    name: fullName,
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
    return new Response(JSON.stringify({ error: "Email send failed" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
