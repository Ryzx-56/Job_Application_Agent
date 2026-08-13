import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { readLang } from "@/lib/lang-cookie";
import { localeAlternates } from "@/lib/hreflang";
import { OG_IMAGE } from "@/lib/site";
import { PricingPage } from "@/components/pricing/pricing-page";

/* ========================================================================
   ROUTE "/pricing" — SERVER SHELL (brief §4)

   Same shape as the landing route's shell and for the same reasons: a server
   component so the route can export metadata, with the interactive page as a
   client child. See app/page.tsx for the full note on why the typefaces are
   declared per-route rather than in the root layout.
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

/* No figure appears in either description. The prices live in lib/pricing.ts
   and this file cannot import them into a server component without pulling a
   "use client" module — see the note in lib/lang-cookie.ts — so rather than
   retype "29 SAR" here where it would quietly rot, the copy describes the
   shape of the pricing instead. */
const COPY = {
  en: {
    title: "Pricing — Tarshih",
    description:
      "Three plans, or credits bought on their own. What a credit buys, why an Arabic CV costs more than an English one, and what the LinkedIn add-on includes.",
  },
  ar: {
    title: "الأسعار — ترشيح",
    description:
      "ثلاث خطط، أو نقاط تُشترى وحدها. ما الذي تشتريه النقطة، ولماذا تكلّف السيرة العربية أكثر من الإنجليزية، وما الذي تتضمّنه إضافة لينكدإن.",
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
    alternates: localeAlternates("/pricing", lang),
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
      <PricingPage />
    </div>
  );
}
