"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLang } from "@/lib/language";
import { BRAND_LOGOS } from "./logo-paths";

/* ========================================================================
   COMPANY MARQUEE (brief §3.2)

   THE LABEL IS THE WHOLE POINT OF THIS SECTION. "Land jobs at companies
   like" or "our users got hired at" would be a hiring-outcome claim that has
   not happened, and would imply these companies endorse us. "Tailor your CV
   for roles at" is simply true: paste any of their postings and the CV is
   written for it.

   ── WHY IT KEPT VANISHING IN ARABIC ─────────────────────────────────────
   The previous fix put dir="ltr" on the TRACK. That was the right idea in
   the wrong place, which is why the served HTML looked correct and the bug
   was still there on a phone.

   Overflow anchoring is decided by the CONTAINING BLOCK, not by the
   overflowing box. A block wider than its container is placed against the
   container's start edge — so in an RTL container the track's RIGHT edge
   aligns with the window's right edge and the track overflows leftward. The
   visible window therefore showed the LAST screenful of the track, and any
   negative translate slid the content further past its own end: empty band.
   Setting dir on the track itself changed the direction of text inside it
   and nothing about where the box was anchored.

   dir="ltr" now sits on the WINDOW, the element that establishes the
   containing block. The track anchors to the left in both languages, so its
   geometry is identical, and RTL mirrors only the DIRECTION OF TRAVEL via
   animation-direction — which is the part that actually has to reverse.

   SPEED IS DEFINED IN PIXELS PER SECOND, NOT IN SECONDS. Arabic and English
   tracks are different widths (different company names, different script
   metrics), so one fixed duration meant one language scrolled slower. The
   duration is measured from the real width of a single copy on mount, so
   both languages move at the same speed without pinning items to a fixed
   width — which is what left the big empty gaps in the row.
======================================================================== */

/** Pixels per second the row travels. Slow enough to read a name in passing. */
const SPEED_PX_PER_SEC = 46;

/** Playback rate while the pointer is over the row. Slows, never stops:
 *  a dead-stopped marquee reads as a bug, which is where this started. */
const HOVER_RATE = 0.28;

type Company = {
  /** simple-icons slug; also the key into BRAND_LOGOS. */
  slug: string;
  /** Latin name as it should read on the page. */
  en: string;
  /** Official Arabic name, for companies that genuinely have one in use.
   *  Global brands stay in Latin script in Arabic mode — that is what Saudi
   *  readers expect to see and what the companies themselves use here. */
  ar?: string;
};

/*
 * EVERY COMPANY HERE HAS A REAL MARK. There is no monogram tile and no
 * text-only fallback: a company either has a licensed CC0 mark in
 * logo-paths.ts or it is not on this row.
 *
 * To add one that simple-icons does not carry (Aramco, SABIC, stc, Almarai,
 * NEOM all fall in this bucket — see the note in the commit), add its
 * official SVG path to logo-paths.ts and an entry here.
 */
const COMPANIES: Company[] = [
  { slug: "saudia", en: "Saudia", ar: "السعودية" },
  { slug: "sap", en: "SAP" },
  { slug: "siemens", en: "Siemens" },
  { slug: "accenture", en: "Accenture" },
  { slug: "ericsson", en: "Ericsson" },
  { slug: "nokia", en: "Nokia" },
  { slug: "cisco", en: "Cisco" },
  { slug: "huawei", en: "Huawei" },
  { slug: "samsung", en: "Samsung" },
  { slug: "google", en: "Google" },
  { slug: "apple", en: "Apple" },
  { slug: "nvidia", en: "Nvidia" },
  { slug: "snapchat", en: "Snap" },
  { slug: "shell", en: "Shell" },
];

function CompanyCell({ company, isRTL }: { company: Company; isRTL: boolean }) {
  const logo = BRAND_LOGOS[company.slug];
  const arabic = isRTL && company.ar;
  const name = arabic ? company.ar : company.en;

  return (
    <li className="me-9 flex shrink-0 items-center gap-2.5 sm:me-14">
      <svg
        viewBox="0 0 24 24"
        className="size-[1.15rem] shrink-0"
        fill="currentColor"
        style={{ color: "var(--ink-2)" }}
        aria-hidden
      >
        <path d={logo.path} />
      </svg>
      <span
        className="t-body whitespace-nowrap font-medium"
        style={{ color: "var(--ink-2)" }}
        // A Latin name inside an Arabic line is an embedded LTR run, and the
        // track itself is dir="ltr". Marking each name explicitly is what
        // keeps an Arabic name from being reordered against its own script.
        {...(arabic ? { lang: "ar", dir: "rtl" } : { lang: "en", dir: "ltr" })}
      >
        {name}
      </span>
    </li>
  );
}

export function CompanyMarquee() {
  const { t, isRTL, lang } = useLang();

  const trackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLUListElement>(null);

  /* Duration from measured width, so px/second is constant across languages.
     Re-measures on language change (different names, different widths) and on
     resize, since the type scale is fluid. */
  useEffect(() => {
    const track = trackRef.current;
    const copy = copyRef.current;
    if (!track || !copy) return;

    const measure = () => {
      const width = copy.getBoundingClientRect().width;
      if (width > 0) {
        track.style.setProperty("--marquee-duration", `${width / SPEED_PX_PER_SEC}s`);
      }
    };

    measure();
    // Fonts land after first paint and change the width materially in both
    // scripts; without this the row keeps whatever speed the fallback face
    // happened to produce.
    document.fonts?.ready.then(measure).catch(() => {});

    const observer = new ResizeObserver(measure);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [lang]);

  /* Hover slows the row. updatePlaybackRate changes speed from the animation's
     CURRENT position; assigning .playbackRate directly makes it jump, and
     re-writing animation-duration restarts the timing altogether. */
  const setRate = useCallback((rate: number) => {
    const track = trackRef.current;
    if (!track) return;
    for (const animation of track.getAnimations()) {
      if (typeof animation.updatePlaybackRate === "function") {
        animation.updatePlaybackRate(rate);
      } else {
        animation.playbackRate = rate;
      }
    }
  }, []);

  const items = COMPANIES.map((company) => (
    <CompanyCell key={company.slug} company={company} isRTL={isRTL} />
  ));

  return (
    <section className="py-14 sm:py-16" aria-labelledby="marquee-label">
      {/* THE LABEL SITS OUTSIDE THE BAND. It used to live between the two
          rules, inside the moving row's own enclosure, which made it read as
          a caption on the animation rather than as the heading of a section.
          No trailing rule: with the band's own hairline directly beneath it,
          a second rule was one line too many. */}
      <div className="mx-auto mb-6 flex max-w-6xl items-center gap-3 px-5 sm:mb-7 sm:px-8">
        <span
          className="h-3.5 w-0.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
          aria-hidden
        />
        <p id="marquee-label" className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
          {t.marquee.label}
        </p>
      </div>

      <div className="border-y py-7 sm:py-8" style={{ borderColor: "var(--line-hairline)" }}>
        {/*
          dir="ltr" HERE, on the overflow container, is the load-bearing part.
          See the header comment: this is the element whose direction decides
          which edge the over-wide track anchors to.
        */}
        <div
          dir="ltr"
          className="relative overflow-hidden"
          onMouseEnter={() => setRate(HOVER_RATE)}
          onMouseLeave={() => setRate(1)}
        >
          <div ref={trackRef} className="marquee-track flex">
            {/* Copy 1 is the real content and the one that gets measured. */}
            <ul ref={copyRef} className="m-0 flex list-none items-center p-0">
              {items}
            </ul>
            {/* Copy 2 exists only so the seam is never visible. Hidden from
                assistive tech so the names are not announced twice. */}
            <ul className="m-0 flex list-none items-center p-0" aria-hidden>
              {items}
            </ul>
          </div>

          {/* Soft entry and exit. These are static overlays, not a mask on the
              moving track — masking an animated element forces a re-raster of
              the whole track every frame, which is what made it stutter. */}
          <div className="marquee-edge marquee-edge-start" aria-hidden />
          <div className="marquee-edge marquee-edge-end" aria-hidden />
        </div>
      </div>
    </section>
  );
}
