import type { Metadata } from "next";
import { Suspense } from "react";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { readLang } from "@/lib/lang-cookie";
import { localeAlternates } from "@/lib/hreflang";
import { OG_IMAGE } from "@/lib/site";
import { QuestionsPage } from "@/components/questions/questions-page";

/* ========================================================================
   ROUTE "/questions" — SERVER SHELL

   Same shell shape as /, /pricing, /guides and /about. Was a single
   "use client" module, so the route could not export metadata — on the page
   most likely to be found through a search for a specific question, which is
   the one place metadata matters most.

   The Suspense boundary is required: the page reads useSearchParams for its
   ?from= back target.
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
    title: "Questions, answered — Tarshih",
    description:
      "What a credit is, whether you need an existing CV, what happens to your data, refunds, Arabic output, and the LinkedIn add-on. Every question, searchable.",
  },
  ar: {
    title: "أسئلة وأجوبتها — ترشيح",
    description:
      "ما هي النقطة، وهل تحتاج سيرة ذاتية جاهزة، وما الذي يحدث لبياناتك، والاسترداد، والمخرجات العربية، وإضافة لينكدإن. كل الأسئلة، قابلة للبحث.",
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
    alternates: localeAlternates("/questions", lang),
    openGraph: {
      title: copy.title,
      description: copy.description,
      locale: lang === "ar" ? "ar_SA" : "en_US",
      type: "website",
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
      <Suspense fallback={null}>
        <QuestionsPage />
      </Suspense>
    </div>
  );
}
