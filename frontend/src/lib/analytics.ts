// lib/analytics.ts
//
// Thin wrapper around gtag.js. Nothing here fires anything on its own —
// <Analytics /> (components/analytics.tsx) sets Consent Mode defaults to
// "denied" before gtag.js even loads, and only <CookieConsent /> is allowed
// to call updateConsent("granted"), and only after the user clicks Accept.

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export const COOKIE_CONSENT_KEY = "tarshih_cookie_consent"; // "granted" | "denied"

type ConsentState = "granted" | "denied";

declare global {
  interface Window {
    dataLayer: unknown[];
    // Defined by gtag.js once it loads (see the "consent-defaults" inline
    // script in analytics.tsx, which sets up a local gtag() shim as a
    // bootstrap before the real script tag arrives). Optional because it
    // won't exist yet if this file is touched before gtag.js has loaded.
    gtag?: (...args: unknown[]) => void;
  }
}

function pushToDataLayer(...args: unknown[]) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

/** Called by CookieConsent when the user accepts, rejects, or changes
 * their choice in "Manage". Google's Consent Mode v2 signal — GA4 itself
 * decides what it's allowed to store based on this.
 *
 * IMPORTANT: this must go through the real window.gtag() function, not a
 * raw dataLayer.push(). A bare array push gets logged in gtag.js's debug
 * console as a "data layer command" (as opposed to a "GTAG command") and
 * does NOT reliably update gtag's live internal consent state — every
 * subsequent hit for the rest of the session kept going out as gcs=G100
 * (denied) even after this ran. Calling window.gtag(...) directly is what
 * actually re-evaluates and persists the new consent state. */
export function updateConsent(state: ConsentState) {
  if (typeof window === "undefined" || !window.gtag) return;

  window.gtag("consent", "update", {
    analytics_storage: state,
  });

  // The page's initial pageview fired before the user had a chance to
  // consent, so it went out as a limited "denied" ping (no client ID,
  // won't show in Realtime/DebugView). Once granted, send one real
  // pageview so GA actually has a proper, fully-consented hit to show.
  if (state === "granted" && GA_MEASUREMENT_ID) {
    window.gtag("event", "page_view");
  }
}

/** Manual pageview — only needed if you later add client-side route
 * tracking on top of GA4's automatic pageview collection. Safe to ignore
 * for now. */
export function pageview(url: string) {
  if (!GA_MEASUREMENT_ID) return;
  pushToDataLayer("config", GA_MEASUREMENT_ID, { page_path: url });
}

/** Fire a custom GA4 event, e.g. event("cv_optimized", { tier: "pro" }).
 * No-ops silently if analytics consent hasn't been granted, since gtag.js
 * won't be sending anything anyway in that case. */
export function event(name: string, params?: Record<string, unknown>) {
  pushToDataLayer("event", name, params);
}
