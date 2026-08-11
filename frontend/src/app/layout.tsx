import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/lib/language";
import { LANG_COOKIE, readLang } from "@/lib/lang-cookie";
import Analytics from "@/components/analytics";
import GlobalChrome from "@/components/global-chrome";

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

export const metadata: Metadata = {
  title: "Tarshih | ترشيح",
  description: "AI resume and cover letter tailoring for every job application.",
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
   * Reading the cookie here opts the app out of static generation. That is a
   * real cost and it is the intended trade: correct language on first paint
   * beats a prerendered page in the wrong one. Splitting the marketing pages
   * into /ar and /en routes would win the static rendering back AND give the
   * hreflang tags the SEO pass needs, which is the right long-term shape.
   */
  const lang = readLang((await cookies()).get(LANG_COOKIE)?.value);
  const dir = lang === "ar" ? "rtl" : "ltr";

  return (
    <html lang={lang} dir={dir} className={`${latinFont.variable} ${arabicFont.variable}`}>
      <body>
        <Analytics />
        <LangProvider initialLang={lang}>
          {children}
          <GlobalChrome />
        </LangProvider>
      </body>
    </html>
  );
}
