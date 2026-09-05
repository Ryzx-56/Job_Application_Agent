import type { NextConfig } from "next";

/* ============================================================================
   SECURITY HEADERS
   ----------------------------------------------------------------------------
   There were none before this. Everything below is defence-in-depth: the app's
   actual protections are React's escaping, the RLS policies, and the backend's
   auth guards. These headers are what limits the damage when one of those is
   wrong.

   ON 'unsafe-inline' IN script-src — a deliberate tradeoff, not an oversight.
   Removing it means per-request nonces, and in the App Router a nonce forces
   DYNAMIC rendering on every page that carries one. The marketing pages were
   deliberately tuned the other way (see the session-refresh note in
   middleware.ts: static output is what keeps them in the bfcache and out of
   TTFB). Paying for that with a full dynamic render everywhere is a bad trade
   while no user-controlled HTML reaches the DOM — Section 4 established that
   React escaping is not bypassed anywhere, and the only two
   dangerouslySetInnerHTML uses are JSON-LD built from our own constants.

   What the CSP still buys with 'unsafe-inline' present: an injected
   <script src="https://attacker/..."> is blocked, exfiltration to an
   unapproved origin is blocked by connect-src, and the page cannot be framed.
   If nonces become worthwhile later, that is the upgrade path.
========================================================================== */

const isProd = process.env.NODE_ENV === "production";

/** Origin of a full URL, or "" when it is unset/unparseable. Keeps a missing
 *  env var from silently emitting "undefined" into the policy. */
function origin(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
// Supabase Auth and PostgREST are https; Realtime, if it is ever used, needs
// the websocket scheme on the same host.
const supabaseWs = supabase ? supabase.replace(/^https:/, "wss:") : "";
const api = origin(process.env.NEXT_PUBLIC_API_URL);

/* Moyasar's hosted card form (lib/payments.ts). THREE directives need it and
   only three — established by reading moyasar.js 1.19.0, not by guessing:

     script-src   the form bundle itself, served from their CDN
     style-src    its stylesheet, same CDN. Every image inside that stylesheet
                  is a data: URI, so img-src needs nothing added.
     connect-src  its `base_url` — the form fetch()es api.moyasar.com to
                  create the payment when the buyer submits the card.

   3-D SECURE NEEDS NOTHING HERE. The form hands off with a top-level
   `window.location.href = payment.source.transaction_url` — not an iframe and
   not a cross-origin form post — so `frame-src 'none'` and
   `form-action 'self'` stay exactly as they are. Widening either of those to
   make a card form work would be giving up real protection for no reason.

   WITHOUT THESE the browser blocks the script before it ever reaches the
   network, loadMoyasarForm() rejects with "moyasar-script-failed", and
   checkout shows "The payment form couldn't load" on every attempt — while
   the CDN answers 200 to anything that isn't a browser, which makes it look
   like a working URL. */
const MOYASAR_CDN = "https://cdn.moyasar.com";
const MOYASAR_API = "https://api.moyasar.com";

const connectSrc = [
  "'self'",
  supabase,
  supabaseWs,
  api,
  // Breached-password check (lib/pwned-password.ts). Without this the check is
  // blocked and fails open, silently — see that file's header.
  "https://api.pwnedpasswords.com",
  // GA4 beacons. ALL FIVE HOSTS ARE REQUIRED, not just the obvious two:
  // gtag fans a single page_view out across several origins and the ones
  // missing here were being blocked silently, so the numbers in the GA
  // console were under-counting rather than showing an error anywhere.
  // Confirmed from real CSP violation reports in the browser console.
  "https://www.google-analytics.com",
  "https://region1.google-analytics.com",
  "https://www.googletagmanager.com",
  // The endpoint gtag actually posts the measurement payload to.
  "https://analytics.google.com",
  // Google Signals / cross-device measurement.
  "https://stats.g.doubleclick.net",
  // gtag's own redirect-based collection hop.
  "https://www.google.com",
  // The card form's own API. Without it the buyer fills the card in and the
  // charge request is blocked at submit.
  MOYASAR_API,
].filter(Boolean);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com ${MOYASAR_CDN}`,
  // Tailwind and next/font both emit inline <style>; there is no nonce-free
  // way around this one.
  `style-src 'self' 'unsafe-inline' ${MOYASAR_CDN}`,
  "img-src 'self' data: https://www.googletagmanager.com https://www.google-analytics.com",
  // next/font/google self-hosts the font files at build time, so no external
  // font origin is needed. data: covers inlined subsets.
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  // No iframes anywhere: document previews open in a new tab via window.open,
  // so nothing legitimate needs to be framed or to frame us.
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Only in production: locally the dev server is http and this would break it.
  isProd ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // frame-ancestors already covers this for modern browsers; kept for older
  // ones that honour the header but not the directive.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses a camera, microphone or location sensor.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

if (isProd) {
  // HSTS only in production. Sending it from a local http dev server would
  // pin localhost to https in the developer's browser and be a nuisance to
  // undo. Two years with subdomains, which is what preload requires.
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
