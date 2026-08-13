"use client";

import { useEffect, useRef } from "react";
import { event } from "@/lib/analytics";

/* ========================================================================
   MARKETING-PAGE INSTRUMENTATION (brief §6.7)

   "Analytics events on every CTA and section view, so the redesign can
   actually be measured."

   NO NEW PROVIDER. This sits on top of lib/analytics.ts, which is already
   gtag.js with Consent Mode v2: consent defaults to denied before gtag.js
   loads, and only CookieConsent may grant it. Everything here goes through
   that same event() call, so a visitor who has not accepted cookies is
   pushing into a dataLayer that GA4 is not permitted to send. There is no
   second tracker and no separate storage.

   TWO EVENT NAMES, NOT TWENTY. GA4 caps custom event names at 500 per
   property and reporting on twenty near-identical names is worse than
   reporting on two with parameters:

     cta_click    { cta, surface }   — cta: which button, surface: which page
     section_view { section, surface }

   Both are snake_case because GA4 lower-cases and normalises event names
   anyway, and mixed conventions show up as separate rows in reports.
======================================================================== */

/** Which page the event happened on. Passed explicitly rather than read from
 *  the pathname, so an event fired from a shared component (the footer CTA,
 *  say) still says where the reader actually was. */
export type Surface = "landing" | "pricing" | "about" | "questions" | "guides";

/** A click on something we asked the reader to click. */
export function trackCta(cta: string, surface: Surface | string) {
  event("cta_click", { cta, surface });
}

/**
 * Fires once when a section has been meaningfully on screen.
 *
 * ONCE, AND ONLY ONCE. A section the reader scrolls back past is not a second
 * view, and an observer left connected on a long page is a listener per
 * section for the life of the tab. The observer disconnects itself on the
 * first hit.
 *
 * 40% VISIBLE, NOT 1px. A section clipping into the viewport by a pixel at
 * the end of a fast scroll has not been seen by anyone. On a tall section
 * that cannot reach 40% on a phone, the fallback root margin means the top
 * of it being well inside the viewport counts.
 *
 * Returns a ref to attach to the element. Safe when IntersectionObserver is
 * missing (older Safari, or a test environment): it simply never fires.
 */
export function useSectionView<T extends HTMLElement>(section: string, surface: Surface | string = "landing") {
  const ref = useRef<T>(null);
  // Guards against a re-render re-arming the observer after it has fired.
  const sent = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || sent.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || sent.current) continue;
          sent.current = true;
          event("section_view", { section, surface });
          observer.disconnect();
        }
      },
      { threshold: 0.4, rootMargin: "0px 0px -15% 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [section, surface]);

  return ref;
}
