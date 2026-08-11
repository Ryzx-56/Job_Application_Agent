"use client";

import Image from "next/image";
import { useLang } from "@/lib/language";

/* ========================================================================
   COMPANY MARQUEE (brief §3.2)

   THE LABEL IS THE WHOLE POINT OF THIS SECTION. "Land jobs at companies
   like" or "our users got hired at" would be a hiring-outcome claim that has
   not happened, and would imply these companies endorse us. "Tailor your CV
   for roles at" is simply true: paste any of their postings and the CV is
   written for it.

   ── WHY THE LOOP IS BUILT THIS WAY ──────────────────────────────────────
   The first version vanished after a few seconds and was worse in Arabic.
   Three separate causes, all fixed here:

   1. THE TRANSLATE DID NOT MATCH THE CONTENT. The track held two copies of
      the list separated by a flex `gap`, so its width was 2C + one extra
      gap while the animation moved it by exactly 50%. Every cycle drifted by
      half a gap and the seam walked across the screen. Spacing now lives in
      each item's own margin, so the track is exactly 2C wide and -50% lands
      precisely one copy along. Nothing to drift.

   2. RTL BROKE THE GEOMETRY, NOT JUST THE DIRECTION. A `width: max-content`
      flex row inside an RTL overflow container starts against the right edge
      and grows leftward, so the same negative translate pushed the content
      out of the box entirely — which is why it disappeared faster in Arabic.
      The track is now explicitly dir="ltr" so its layout is identical in both
      languages, and RTL reverses the TRAVEL with animation-direction, which
      is the thing that actually has to mirror.

   3. ARABIC RAN SLOWER because Arabic company names are narrower, so the
      same fixed duration covered less distance per second. Items are now a
      fixed width, so both languages have identical track widths and one
      duration gives one speed.

   It autoplays from first paint. There is no scroll trigger and never was
   meant to be one — the earlier "it only moves after you scroll" was the
   content being off-box from cause 2, not a trigger.
======================================================================== */

type Company = {
  /** Latin name, and the filename stem for its logo. */
  en: string;
  /** Only where the company is genuinely written in Arabic here. */
  ar?: string;
  /** Monogram shown until an official asset exists. See LOGOS below. */
  mark: string;
  slug: string;
};

/*
 * LOGOS — READ BEFORE ADDING ONE.
 *
 * Every item renders a logo slot. It looks for `/logos/<slug>.svg` and falls
 * back to a monogram tile when that file is absent, which is the current
 * state for all of them: this repo has no licensed brand assets, and drawing
 * someone's wordmark from memory produces something that is both wrong and a
 * worse trademark position than plain type.
 *
 * To use real logos, drop official monochrome SVGs into
 * frontend/public/logos/ named by the slug below (aramco.svg, sabic.svg, ...)
 * and they appear automatically with no code change. They are rendered at a
 * uniform height and reduced opacity so the row reads as context rather than
 * as endorsement.
 */
const COMPANIES: Company[] = [
  { en: "Aramco", ar: "أرامكو", mark: "A", slug: "aramco" },
  { en: "SABIC", ar: "سابك", mark: "S", slug: "sabic" },
  { en: "stc", mark: "stc", slug: "stc" },
  { en: "Saudia", ar: "السعودية", mark: "S", slug: "saudia" },
  { en: "Almarai", ar: "المراعي", mark: "M", slug: "almarai" },
  { en: "NEOM", ar: "نيوم", mark: "N", slug: "neom" },
  { en: "stc pay", mark: "pay", slug: "stc-pay" },
  { en: "Google", mark: "G", slug: "google" },
  { en: "Microsoft", mark: "M", slug: "microsoft" },
  { en: "Amazon", mark: "a", slug: "amazon" },
  { en: "Meta", mark: "M", slug: "meta" },
  { en: "Apple", mark: "A", slug: "apple" },
  { en: "Nvidia", mark: "N", slug: "nvidia" },
];

/** Present only for companies whose official SVG has been added to
 *  public/logos/. Listing them explicitly avoids a 404 per missing file on
 *  every page load, which is what <img onError> fallback would cost. */
const HAVE_LOGO_ASSET = new Set<string>([]);

function CompanyCell({ company, isRTL }: { company: Company; isRTL: boolean }) {
  const arabic = isRTL && company.ar;
  const hasLogo = HAVE_LOGO_ASSET.has(company.slug);

  return (
    <li
      // Fixed width, and spacing as the item's own margin rather than a flex
      // gap on the track — both are load-bearing for the loop maths above.
      className="me-10 flex w-36 shrink-0 items-center justify-center gap-2.5 sm:me-14 sm:w-44"
      style={{ opacity: 0.75 }}
    >
      {hasLogo ? (
        <Image
          src={`/logos/${company.slug}.svg`}
          alt=""
          width={20}
          height={20}
          className="size-5 shrink-0 object-contain"
          style={{ filter: "grayscale(1) brightness(1.6)" }}
        />
      ) : (
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-[3px] text-[0.5625rem] font-semibold leading-none"
          style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)", color: "var(--ink-3)" }}
        >
          {company.mark}
        </span>
      )}
      <span
        className="t-body whitespace-nowrap font-medium"
        style={{ color: "var(--ink-2)" }}
        // A Latin name inside an Arabic line is an embedded LTR run. Marking
        // it is what stops "stc pay" rendering as "pay stc".
        {...(arabic ? { lang: "ar", dir: "rtl" } : { lang: "en", dir: "ltr" })}
      >
        {arabic ? company.ar : company.en}
      </span>
    </li>
  );
}

export function CompanyMarquee() {
  const { t, isRTL } = useLang();

  return (
    <section
      className="border-y py-10 sm:py-12"
      style={{ borderColor: "var(--line-hairline)" }}
      aria-labelledby="marquee-label"
    >
      {/* THE LABEL IS A SECTION LABEL, NOT A SENTENCE. It read as stray body
          copy before. It now carries weight, its own colour, and a rule that
          runs to the trailing edge — the editorial convention for a standing
          head. No caps or letter-spacing: Arabic has neither. */}
      <div className="mx-auto mb-8 flex max-w-6xl items-center gap-4 px-5 sm:mb-10 sm:gap-5 sm:px-8">
        <span className="h-3 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--accent-quiet)" }} aria-hidden />
        <p
          id="marquee-label"
          className="t-body shrink-0 font-semibold tracking-tight"
          style={{ color: "var(--ink-1)" }}
        >
          {t.marquee.label}
        </p>
        <span className="h-px min-w-0 flex-1" style={{ backgroundColor: "var(--line)" }} aria-hidden />
      </div>

      {/* The fade masks entry and exit so names dissolve at the edges instead
          of being clipped mid-letter. Symmetric, so it needs no RTL variant.
          The mask sits on this wrapper and NOT on the animated track: masking
          a moving element forces a re-raster every frame, which is what made
          it stutter on desktop. */}
      <div className="marquee-window relative overflow-hidden" aria-hidden>
        {/*
          dir="ltr" is deliberate and load-bearing — see cause 2 in the header.
          The track's geometry is identical in both languages; only the
          direction of travel mirrors, via CSS.
        */}
        <ul dir="ltr" className="marquee-track m-0 flex list-none items-center p-0">
          {/* Two copies. The animation moves exactly one copy's width, so the
              second lands precisely where the first began. */}
          {[0, 1].map((copy) => (
            <li key={copy} className="contents">
              <ul className="m-0 flex list-none items-center p-0">
                {COMPANIES.map((company) => (
                  <CompanyCell key={`${copy}-${company.slug}`} company={company} isRTL={isRTL} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
