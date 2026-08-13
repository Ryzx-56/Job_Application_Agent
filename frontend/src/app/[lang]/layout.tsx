import { notFound } from "next/navigation";
import { LOCALES, isLocale } from "@/lib/lang-cookie";

/* ========================================================================
   /[lang] — THE LOCALE SEGMENT

   Not a root layout, and deliberately not one. The plan in
   prompts/tarshih-deferred-locale-routing.md called for two root layouts via
   route groups, which would have meant relocating the dashboard AND the auth
   pages — and moving /auth is the one change that file warns can lock people
   out of their accounts. Middleware hands the resolved language to the single
   existing root layout in a request header instead, so <html lang dir> is
   still correct per URL and /auth/** never moves.

   What this layout is for is the guard below: [lang] is a dynamic segment, so
   without it /anything-at-all would render the landing page under a junk
   locale and get indexed. Only the locales we actually serve resolve.
======================================================================== */

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <>{children}</>;
}
