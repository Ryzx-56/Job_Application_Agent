import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { readLang } from "@/lib/lang-cookie";
import { localeAlternates } from "@/lib/hreflang";
import { OG_IMAGE } from "@/lib/site";
import { GuidesPage } from "@/components/guides/guides-page";

/* ========================================================================
   ROUTE "/guides" — SERVER SHELL (brief §8.2)

   The Resume Guide and the ATS tips, as one page with two anchored sections.
   Same shell shape as / and /pricing — see app/page.tsx for why the typefaces
   are declared per route rather than in the root layout.
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
    title: "Resume guide and ATS tips — Tarshih",
    description:
      "How to write a CV a person will read, and how to get it through the applicant tracking software that reads it first. Two short, practical guides.",
  },
  ar: {
    title: "دليل السيرة الذاتية ونصائح أنظمة التتبع — ترشيح",
    description:
      "كيف تكتب سيرة ذاتية تُقرأ فعلًا، وكيف تمرّ عبر أنظمة تتبّع المتقدّمين التي تقرأها قبل أي إنسان. دليلان قصيران وعمليان.",
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
    alternates: localeAlternates("/guides", lang),
    openGraph: {
      title: copy.title,
      description: copy.description,
      locale: lang === "ar" ? "ar_SA" : "en_US",
      type: "article",
      images: [OG_IMAGE],
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
    <div data-type="editorial" className={`${plexSans.variable} ${plexArabic.variable}`}>
      <GuidesPage />
    </div>
  );
}
