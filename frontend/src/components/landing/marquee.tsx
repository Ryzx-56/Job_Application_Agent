"use client";

import { useLang } from "@/lib/language";

/* ========================================================================
   COMPANY MARQUEE (brief §3.2)

   THE LABEL IS THE WHOLE POINT OF THIS SECTION. "Land jobs at companies
   like" or "our users got hired at" would be a hiring-outcome claim that has
   not happened, and would imply these companies endorse us. "Tailor your CV
   for roles at" is simply true: paste any of their postings and the CV is
   written for it.

   NAMES IN TYPE, NOT LOGOS. No official monochrome wordmarks are licensed
   into this repo, and redrawing someone's logo is worse than type on both
   the legal and the design side. Saudi companies are named in Arabic when
   the page is Arabic, because that is how they are written here; global
   brands stay in Latin in both languages and are marked lang/dir so a Latin
   run inside an Arabic line cannot reorder.

   MOTION: CSS keyframes (see globals.css), not JS. This runs forever, and a
   permanent rAF loop is the single most expensive thing you can put on a
   mobile page. Transform only, and it stops entirely under
   prefers-reduced-motion.

   ACCESSIBILITY: the track is aria-hidden and the same list is duplicated
   for the loop, so a screen reader would otherwise read thirteen company
   names twice. The label above it carries the meaning.
======================================================================== */

type Company = { en: string; ar?: string };

/** `ar` is only set where the company is genuinely written in Arabic here.
 *  Everything else stays Latin in both languages. */
const COMPANIES: Company[] = [
  { en: "Aramco", ar: "أرامكو" },
  { en: "SABIC", ar: "سابك" },
  { en: "stc" },
  { en: "Saudia", ar: "السعودية" },
  { en: "Almarai", ar: "المراعي" },
  { en: "NEOM", ar: "نيوم" },
  { en: "stc pay" },
  { en: "Google" },
  { en: "Microsoft" },
  { en: "Amazon" },
  { en: "Meta" },
  { en: "Apple" },
  { en: "Nvidia" },
];

function CompanyName({ company, isRTL }: { company: Company; isRTL: boolean }) {
  const arabic = isRTL && company.ar;
  return (
    <span
      className="t-body shrink-0 whitespace-nowrap font-medium"
      style={{ color: "var(--ink-3)" }}
      // A Latin name inside an Arabic line is an embedded LTR run. Marking it
      // is what stops "stc pay" rendering as "pay stc" next to Arabic text.
      {...(arabic ? {} : { lang: "en", dir: "ltr" })}
    >
      {arabic ? company.ar : company.en}
    </span>
  );
}

export function CompanyMarquee() {
  const { t, isRTL } = useLang();

  return (
    <section
      className="border-y py-8 sm:py-10"
      style={{ borderColor: "var(--line-hairline)" }}
      aria-labelledby="marquee-label"
    >
      <p
        id="marquee-label"
        className="t-meta mx-auto mb-6 max-w-6xl px-5 sm:px-8"
        style={{ color: "var(--ink-3)" }}
      >
        {t.marquee.label}
      </p>

      {/* The fade masks the track's entry and exit so names dissolve at the
          edges instead of being clipped mid-letter. Symmetric, so it needs no
          RTL variant. */}
      <div
        className="relative overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        }}
        aria-hidden
      >
        <div className="marquee-track flex items-center gap-x-12 sm:gap-x-16">
          {/* Rendered twice: the animation translates by exactly -50%, so the
              second copy lands where the first began and the loop is seamless. */}
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center gap-x-12 sm:gap-x-16">
              {COMPANIES.map((company) => (
                <CompanyName key={`${copy}-${company.en}`} company={company} isRTL={isRTL} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
