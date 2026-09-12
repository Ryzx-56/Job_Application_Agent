import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { readLang } from "@/lib/lang-cookie";
import { localeAlternates } from "@/lib/hreflang";
import { OG_IMAGE } from "@/lib/site";
import { BuildCvPage } from "@/components/build-cv/build-cv-page";

/* ========================================================================
   ROUTE "/build-cv" — SERVER SHELL (prompts/tarshih-copy-and-page.md, Part 2)

   Same shape as the landing and /pricing shells and for the same reasons: a
   server component so the route can export metadata, with the interactive
   page — the form included — as a client child. See app/[lang]/page.tsx for
   the full note on why the typefaces are declared per-route.

   TARGET SEARCHES (English: build a CV, CV builder, ATS-friendly CV, CV for
   Saudi jobs. Arabic: إنشاء سيرة ذاتية، سيرة ذاتية احترافية، سيرة ذاتية ATS،
   قالب سيرة ذاتية) drive the title/description below, the same way the
   landing route's do — see the note there on why the keyword leads and the
   brand closes, and why no credit count is hardcoded into either string.
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
    title: "CV builder for Saudi jobs, free to start | Tarshih",
    description:
      "Build an ATS-friendly CV for a specific job posting. Paste the job description, add your details, and get a tailored CV, an ATS score, and a cover letter — in Arabic or English.",
  },
  ar: {
    title: "إنشاء سيرة ذاتية لوظائف السعودية، مجانًا للبدء | ترشيح",
    description:
      "اصنع سيرة ذاتية متوافقة مع أنظمة ATS لإعلان وظيفة محدد. الصق الوصف الوظيفي، أضف بياناتك، واحصل على سيرة ذاتية مخصصة ودرجة ATS وخطاب تقديم — بالعربية أو الإنجليزية.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const lang = readLang((await params).lang);
  const copy = COPY[lang];

  return {
    title: copy.title,
    description: copy.description,
    alternates: localeAlternates("/build-cv", lang),
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
      <BuildCvPage />
    </div>
  );
}
