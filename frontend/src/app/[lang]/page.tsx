import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { readLang } from "@/lib/lang-cookie";
import { localeAlternates } from "@/lib/hreflang";
import { OG_IMAGE } from "@/lib/site";
import { LandingPage } from "@/components/landing/landing-page";

/* ========================================================================
   ROUTE "/" — SERVER SHELL

   The landing page used to be one 1,300-line client component, which meant
   the route could not export `metadata` at all: a "use client" module has no
   way to. The page therefore inherited the generic root title and had no
   description, no canonical, no social card — on a site whose whole SEO
   problem is that nothing but the bare URL reaches it.

   So the shell is a server component and the interactive page is a child.
   This file owns everything the crawler and the browser need before any
   JavaScript runs: metadata, the marketing typefaces, and the token root.

   TYPEFACES ARE LOADED HERE, NOT IN app/layout.tsx, on purpose. next/font
   preloads a face on the routes where its variable is applied. Declaring
   Plex in the root layout would have shipped a preload hint for it to every
   dashboard route that never renders a glyph of it. Declared here, it is
   preloaded on the marketing route and nowhere else — and the dashboard
   keeps Cairo and Plus Jakarta Sans untouched.
======================================================================== */

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  variable: "--font-plex-arabic",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/* ── THE TITLE AND DESCRIPTION ARE WRITTEN FOR SEARCH, NOT FOR US ────────
   The site was reachable by typing the URL and essentially no other way: it
   ranked for neither "CV maker" nor "Tarshih", in either language. Both
   titles used to open with the brand and an em dash, which spends the first
   third of a ~60-character title budget on a word nobody is searching yet
   and a punctuation mark search engines get nothing from.

   So the keywords lead and the brand closes. The terms are the ones the
   product actually delivers — a CV rewritten against a pasted job
   description, an ATS score, a cover letter, matched openings, in Arabic or
   English, for the Saudi market. Nothing here names a feature that does not
   exist, which is the only reason the density is safe: it reads as a
   description because it is one.

   THE ARABIC IS NOT THE ENGLISH TRANSLATED. Arabic searchers type
   "منشئ سيرة ذاتية" for the category and reach for the Latin "ATS" rather
   than an Arabic rendering of it, so the Arabic title is built from those
   terms rather than from the English word order.

   NO CREDIT COUNT IN EITHER DESCRIPTION ANY MORE. Both used to state the
   free monthly allowance as a hardcoded word ("Three credits", "ثلاث نقاط")
   while lib/pricing.ts is the source of truth everywhere else on the site —
   a number that has already changed several times, typed by hand, in the
   one string a search engine quotes back at people. The clause is gone
   rather than interpolated: the description's ~155-character budget buys
   more in keywords than in an allowance the hero already states exactly. */
const COPY = {
  en: {
    title: "AI CV maker and ATS resume builder for Saudi jobs | Tarshih",
    description:
      "Tarshih is an AI CV maker for Saudi jobs. Paste a job description and get an ATS-optimized CV and cover letter in Arabic or English, with live matched openings.",
  },
  ar: {
    title: "منشئ سيرة ذاتية بالذكاء الاصطناعي لوظائف السعودية | ترشيح",
    description:
      "ترشيح: منشئ سيرة ذاتية بالذكاء الاصطناعي لوظائف السعودية. الصق إعلان الوظيفة لتحصل على سيرة ذاتية وخطاب تقديم متوافقين مع أنظمة ATS، بالعربية أو بالإنجليزية، مع وظائف مطابقة.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  // The URL is the source of truth now, not the cookie. readLang() still
  // narrows it, so a junk segment that somehow reached here falls back to
  // English rather than throwing.
  const lang = readLang((await params).lang);
  const copy = COPY[lang];

  return {
    title: copy.title,
    description: copy.description,
    alternates: localeAlternates("/", lang),
    openGraph: {
      title: copy.title,
      description: copy.description,
      locale: lang === "ar" ? "ar_SA" : "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: [OG_IMAGE],
    },
  };
}

export default function Page() {
  return (
    /*
     * data-type="editorial" is the switch for the whole marketing design
     * system — tokens, type scale, the RTL heading override, the marquee
     * keyframes (see globals.css). Scoping it to this subtree is what keeps
     * the dashboard's palette and faces exactly as they are.
     */
    <div data-type="editorial" className={`${plexSans.variable} ${plexArabic.variable}`}>
      <LandingPage />
    </div>
  );
}
