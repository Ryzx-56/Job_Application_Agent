import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/lib/language";
import { LANG_COOKIE, LANG_HEADER, readLang, isLocale, type Lang } from "@/lib/lang-cookie";
import Analytics from "@/components/analytics";
import GlobalChrome from "@/components/global-chrome";
import { SITE_URL } from "@/lib/site";
import { SoftwareApplicationJsonLd } from "@/components/software-jsonld";

/**
 * Font loading — THE APPLICATION FACES.
 *
 * NOTE: the variable name below is intentionally "--font-geist-sans" — that's
 * the same CSS variable your globals.css theme already wires up to the
 * `font-sans` Tailwind utility (from the default Next.js starter). Reusing
 * that exact name means the whole site picks up this font automatically
 * with zero changes to globals.css.
 *
 * The marketing pages do NOT use these. They load IBM Plex Sans and IBM Plex
 * Sans Arabic themselves (see app/page.tsx) and scope them to their own
 * subtree, so the dashboard keeps Cairo and Plus Jakarta Sans until that is
 * decided separately. Loading the marketing faces there rather than here also
 * keeps them off the dashboard's preload list.
 */
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

/* metadataBase is what turns every per-route `canonical: "/pricing"` and the
   generated /opengraph-image into absolute URLs. Without it Next emits a
   relative og:image, which most scrapers refuse to resolve — which is why
   the cards were rendering as bare links. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Tarshih | ترشيح",
  description: "AI resume and cover letter tailoring for every job application.",
  alternates: { canonical: "/" },
  // Inherited by every route that does not set its own. Routes that do set
  // openGraph still inherit the image from here, so the card is declared once.
  openGraph: {
    siteName: "Tarshih",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /*
   * THE DOCUMENT'S LANGUAGE AND DIRECTION COME FROM THE COOKIE.
   *
   * This used to be a hardcoded lang="en" with no dir attribute at all, while
   * the real direction was applied to a div further down by a client
   * component after mount. Two things were wrong with that. The document
   * element lied to screen readers and to search engines about what language
   * the page was in, and every returning Arabic reader was served English LTR
   * and watched it flip once React hydrated — on a product whose primary
   * audience reads Arabic, that flip was the first thing they saw.
   *
   * THE LANGUAGE NOW COMES FROM THE URL, via a header.
   *
   * The marketing pages live under /[lang], but a ROOT layout cannot read a
   * child segment's params — so middleware resolves the language once (URL
   * inside /[lang], cookie everywhere else) and sets it on the request as
   * x-tarshih-lang. Reading it here is what lets <html lang dir> be correct
   * per URL without moving the dashboard and auth routes into a second root
   * layout, which is the change that would have put /auth/callback at risk.
   *
   * The cookie is still the fallback: it covers the dashboard, the auth
   * pages, and any request that somehow arrives without the header.
   */
  const headerLang = (await headers()).get(LANG_HEADER);
  const lang = isLocale(headerLang ?? undefined)
    ? (headerLang as Lang)
    : readLang((await cookies()).get(LANG_COOKIE)?.value);
  const dir = lang === "ar" ? "rtl" : "ltr";

  return (
    <html lang={lang} dir={dir} className={`${latinFont.variable} ${arabicFont.variable}`}>
      <body>
        {/* One statement of what this product is, on every page. Server
            component, so it is in the initial HTML with no JS involved. */}
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
