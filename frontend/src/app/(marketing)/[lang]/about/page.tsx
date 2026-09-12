import type { Metadata } from "next";
import { Suspense } from "react";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { readLang } from "@/lib/lang-cookie";
import { localeAlternates } from "@/lib/hreflang";
import { OG_IMAGE } from "@/lib/site";
import { AboutPage } from "@/components/about/about-page";

/* ========================================================================
   ROUTE "/about" — SERVER SHELL

   Was a single "use client" module, which meant the route could not export
   metadata at all and inherited the generic root title — on a page whose
   entire job is to explain who is behind the product to someone deciding
   whether to trust it. Same shell shape as /, /pricing and /guides now.

   The Suspense boundary is still required: the page reads useSearchParams
   for its back-link target, and without a boundary that opts the whole
   route out of static rendering.
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
    title: "About Tarshih",
    description:
      "Why Tarshih was built, who is behind it, and why the free plan exists even though it loses money on every person who uses it.",
  },
  ar: {
    title: "عن ترشيح",
    description:
      "لماذا بُنيت ترشيح، ومن يقف خلفها، ولماذا الخطة المجانية موجودة رغم أنها تخسر على كل من يستخدمها.",
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
    alternates: localeAlternates("/about", lang),
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
      <Suspense fallback={null}>
        <AboutPage />
      </Suspense>
    </div>
  );
}
