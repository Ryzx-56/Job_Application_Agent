import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { LANG_COOKIE, readLang } from "@/lib/lang-cookie";
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

const COPY = {
  en: {
    title: "Tarshih — a CV rewritten for the job you're applying to",
    description:
      "Paste a job posting and get a CV and cover letter rewritten for it, in Arabic or English, with an ATS score and matched openings. Three credits free every month, no card.",
  },
  ar: {
    title: "ترشيح — سيرة ذاتية تُكتب من جديد للوظيفة التي تتقدّم لها",
    description:
      "الصق إعلان الوظيفة واحصل على سيرة ذاتية وخطاب تقديم مكتوبين له، بالعربية أو بالإنجليزية، مع درجة التوافق ووظائف مطابقة. ثلاث نقاط مجانًا كل شهر بلا بطاقة.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  // Same cookie the root layout reads, so the title and description are in
  // the language the page will actually render in.
  const lang = readLang((await cookies()).get(LANG_COOKIE)?.value);
  const copy = COPY[lang];

  return {
    title: copy.title,
    description: copy.description,
    openGraph: {
      title: copy.title,
      description: copy.description,
      locale: lang === "ar" ? "ar_SA" : "en_US",
      type: "website",
    },
    twitter: { card: "summary_large_image", title: copy.title, description: copy.description },
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
