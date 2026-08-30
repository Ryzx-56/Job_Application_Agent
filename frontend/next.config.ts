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

const connectSrc = [
  "'self'",
  supabase,
  supabaseWs,
  api,
  // Breached-password check (lib/pwned-password.ts). Without this the check is
  // blocked and fails open, silently — see that file's header.
  "https://api.pwnedpasswords.com",
  // GA4 beacons, including the regional collection endpoints.
  "https://www.google-analytics.com",
  "https://region1.google-analytics.com",
  "https://www.googletagmanager.com",
].filter(Boolean);

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  // Tailwind and next/font both emit inline <style>; there is no nonce-free
  // way around this one.
  "style-src 'self' 'unsafe-inline'",
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
