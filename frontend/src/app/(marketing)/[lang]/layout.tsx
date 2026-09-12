import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import "../../globals.css";
import { LangProvider } from "@/lib/language";
import { LOCALES, isLocale, type Lang } from "@/lib/lang-cookie";
import Analytics from "@/components/analytics";
import GlobalChrome from "@/components/global-chrome";
import { SITE_URL } from "@/lib/site";
import { SoftwareApplicationJsonLd } from "@/components/software-jsonld";

/* ========================================================================
   /[lang] — ITS OWN ROOT LAYOUT (prompts/UNDONE/tarshih-outstanding-items.md
   §1, "the real fix")

   This USED TO be a plain nested layout, deliberately not a root one — see
   the removed comment this replaced, and middleware.ts's still-accurate
   account of why. The single shared root layout at app/layout.tsx read
   headers()/cookies() to build <html lang dir>, and Next.js opts a whole
   route into dynamic rendering the moment ANY server component in its tree
   calls either — which is exactly what was pinning every marketing page to
   cache-control: no-store (measured live: no bf-cache, LCP ~4.4s, TTI ~6.4s).

   THE FIX ISN'T MOVING AUTH. It's giving /[lang] its OWN root layout, which
   Next.js supports natively via a route group — the marketing tree already
   lived at a single subtree (app/[lang]/**), so only THAT moved, into
   app/(marketing)/[lang]/. app/layout.tsx, app/auth/**, app/login,
   app/signup, app/dashboard, app/forgot-password, app/reset-password and
   app/api/** are untouched, at the exact paths they were — a route group's
   parentheses are invisible in the URL, and Route Handlers (auth/callback,
   auth/confirm) don't resolve through a layout at all, so they were never
   at risk here regardless. The one real behavior change is that navigating
   from a marketing page to /login or /signup now does a full page load
   instead of a client transition — an acceptable, well-known tradeoff for
   the multi-root-layout pattern, and it only affects that one crossing.

   lang/dir now come from the ROUTE PARAM (this segment's own params — the
   thing a root layout positioned at a dynamic segment receives directly),
   not from a header middleware forwards. That's what makes the route
   analyzable at build time: no request-time API is read anywhere in this
   tree, so Next can prerender it as static HTML and serve it from cache.

   THE FONTS ARE DUPLICATED FROM app/layout.tsx ON PURPOSE, not shared. Text
   outside the marketing design system on these pages — the cookie-consent
   banner, the legal modal, both rendered by <GlobalChrome /> below — uses
   `font-sans`, which resolves through the SAME --font-geist-sans variable
   the dashboard uses. Dropping the font load here would leave that variable
   undefined on marketing pages and silently swap those two components to
   the browser's default sans-serif. The marketing typefaces (IBM Plex) are
   unaffected — they're loaded separately, in page.tsx, scoped to
   [data-type="editorial"].
======================================================================== */

const latinFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  weight: ["400", "500", "600", "700", "800"],
});

const arabicFont = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo-sans",
  weight: ["400", "500", "600", "700", "800"],
});

/* Base metadata for the marketing root layout. Every page under here sets
   its own full title/description/alternates/openGraph (see generateMetadata
   in page.tsx and its siblings) — this is the fallback those merge over, and
   the one load-bearing field is metadataBase, which is what turns a page's
   relative canonical and /opengraph-image into absolute URLs. Copied from
   app/layout.tsx rather than shared: the two root layouts no longer render
   through the same tree, so there is nothing to import this from. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Tarshih | ترشيح",
  description: "AI resume and cover letter tailoring for every job application.",
  openGraph: {
    siteName: "Tarshih",
    type: "website",
  },
};

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export default async function MarketingRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang: langParam } = await params;
  if (!isLocale(langParam)) notFound();
  const lang: Lang = langParam;
  const dir = lang === "ar" ? "rtl" : "ltr";

  return (
    <html lang={lang} dir={dir} className={`${latinFont.variable} ${arabicFont.variable}`}>
      <body>
        <SoftwareApplicationJsonLd />
        <Analytics />
        <LangProvider initialLang={lang}>
          {children}
          <GlobalChrome />
        </LangProvider>
      </body>
    </html>
  );
}
