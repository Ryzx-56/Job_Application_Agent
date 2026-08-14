"use client";

import { useRouter } from "next/navigation";
import { PenLine, Lock, ScanSearch, BadgeCheck } from "lucide-react";
import { useLang } from "@/lib/language";
import { Hero } from "./hero";
import { CompanyMarquee } from "./marquee";
import { HowItWorks } from "./how-it-works";
import { TailoringCase } from "./tailoring-case";
import { Features } from "./features";
import { Trust } from "./trust";
import { LandingFaq, FinalCta } from "./faq-cta";
import { SiteHeader, SiteFooter } from "./site-chrome";
import { SectionView } from "./section-view";

/* ========================================================================
   LANDING PAGE — route "/"

   WHAT LEFT THIS FILE, AND WHERE IT WENT:

     · SiteHeader / SiteFooter  -> ./site-chrome.tsx, because /pricing needs
                                   the same chrome and importing it from here
                                   would pull every landing section into that
                                   route's bundle.
     · Pricing, PayAsYouGo,     -> /pricing (brief §4). Everything about money
       LinkedInAddOn,              is on one page now, and the landing page
       ConfirmDialog               keeps a single quiet price line next to its
                                   final CTA rather than a full pricing block.
     · Faq, FinalCta            -> ./faq-cta.tsx, rebuilt in the editorial
                                   language with FAQPage structured data.

   The file was 1,089 lines doing eleven jobs. What is left is the page's
   running order and the two sections that still live here.
======================================================================== */

/* ========================================================================
   TRUST BAR
======================================================================== */
function TrustBar() {
  const { t } = useLang();
  // Fourth icon covers the humanizer line: core/humanizer.py's rules run on
  // every generation that produces prose.
  const icons = [Lock, ScanSearch, BadgeCheck, PenLine];
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
      {/* THE RULES ARE SIZED BY THE CONTENT, NOT THE OTHER WAY AROUND.

          Constraining this row to max-w-4xl overshot: the four English items
          measure 893px and need 989px with gaps, so at 848px they ran 141px
          past the end of their own hairlines — the rules stopped and the text
          kept going. `w-fit` makes the bordered box exactly as wide as the
          items plus its own padding, so the rules cannot be shorter than what
          they contain no matter what the copy or the script does.

          ONE LINE FROM xl. Between lg and xl the English items alone are
          893px in a 976px box, which leaves 83px for three gaps and two
          margins — one line there would either overflow or be cramped, so it
          wraps to a centred block instead and goes to a single line at 1280
          and up.

          SET AT READING SIZE, NOT CAPTION SIZE. These are four load-bearing
          claims about what the product will and will not do. */}
      <div className="mx-auto flex w-full max-w-full flex-col items-start gap-6 border-y border-white/10 py-9 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-10 sm:gap-y-5 sm:py-10 xl:w-fit xl:flex-nowrap xl:gap-x-12 xl:px-5">
        {t.trustBar.map((label, i) => {
          const Icon = icons[i];
          return (
            <div
              key={label}
              className="t-body flex items-center gap-3 lg:whitespace-nowrap"
              style={{ color: "var(--ink-2)" }}
            >
              <Icon className="size-5 shrink-0" style={{ color: "var(--accent-quiet)" }} aria-hidden />
              {label}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ========================================================================
   PAGE — route: "/"
======================================================================== */
export function LandingPage() {
  const router = useRouter();
  return (
    <>
      {/* About is a real page (linkable, shareable), not a modal. The legal
          docs still use the modal — reference text you glance at, not a story
          you send someone — and that modal now lives with the footer. */}
      <SiteHeader onOpenAbout={() => router.push("/about")} />
      <main id="main">
        <SectionView name="hero"><Hero /></SectionView>
        <SectionView name="marquee"><CompanyMarquee /></SectionView>
        <TrustBar />
        {/* How it works comes BEFORE the feature detail (§3.3, §3.4): a
            visitor who does not yet know what the product does cannot judge a
            feature list.

            Then the tailoring argument (§3.4), which the brief also places
            ahead of the feature detail — someone who does not believe one CV
            per job is a problem has no reason to read a feature list at all.
            Only then the features themselves (§3.5). */}
        <SectionView name="how_it_works"><HowItWorks /></SectionView>
        <SectionView name="why_tailoring"><TailoringCase /></SectionView>
        <SectionView name="features"><Features /></SectionView>
        <SectionView name="trust"><Trust /></SectionView>
        <LandingFaq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
