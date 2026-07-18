"use client";

import { useState } from "react";
import { useLang } from "@/lib/language";
import { legalContent } from "@/lib/legal-content";
import { LegalModal } from "@/components/legal-modal";
import CookieConsent from "@/components/cookie-consent";

/**
 * Mounted once in app/layout.tsx. Exists purely to give CookieConsent a
 * way to open the Privacy Policy modal — layout.tsx itself is a server
 * component (it exports `metadata`) so it can't hold this state directly.
 */
export default function GlobalChrome() {
  const { lang, isRTL } = useLang();
  const [privacyOpen, setPrivacyOpen] = useState(false);

  return (
    <>
      <CookieConsent onOpenPrivacy={() => setPrivacyOpen(true)} />
      <LegalModal
        doc={legalContent[lang]?.privacy ?? null}
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        isRTL={isRTL}
      />
    </>
  );
}
