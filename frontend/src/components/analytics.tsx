"use client";

import Script from "next/script";
import { useEffect } from "react";
import { GA_MEASUREMENT_ID, COOKIE_CONSENT_KEY, updateConsent } from "@/lib/analytics";

/**
 * Mount this once in app/layout.tsx, inside <body>, alongside <CookieConsent />.
 * Order matters:
 *   1. "consent-defaults" runs first (beforeInteractive) and tells gtag.js
 *      to treat analytics as denied until told otherwise.
 *   2. gtag.js itself loads after that.
 *   3. On mount, if the user already chose "granted" on a previous visit,
 *      we immediately re-send that choice — Consent Mode doesn't persist
 *      across page loads on its own, localStorage does.
 */
export default function Analytics() {
  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored === "granted") updateConsent("granted");
  }, []);

  if (!GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script id="consent-defaults" strategy="beforeInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied',
            wait_for_update: 500
          });
        `}
      </Script>

      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />

      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
