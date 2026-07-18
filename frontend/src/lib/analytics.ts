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
  }
}

function pushToDataLayer(...args: unknown[]) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

/** Called by CookieConsent when the user accepts, rejects, or changes
 * their choice in "Manage". Google's Consent Mode v2 signal — GA4 itself
 * decides what it's allowed to store based on this. */
export function updateConsent(state: ConsentState) {
  pushToDataLayer("consent", "update", {
    analytics_storage: state,
  });

  // The page's initial pageview fired before the user had a chance to
  // consent, so it went out as a limited "denied" ping (no client ID,
  // won't show in Realtime/DebugView). Once granted, send one real
  // pageview so GA actually has a proper, fully-consented hit to show.
  if (state === "granted" && GA_MEASUREMENT_ID) {
    pushToDataLayer("event", "page_view");
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
