import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { LOCALES, type Lang } from "@/lib/lang-cookie";

/* ========================================================================
   hreflang (brief §6.1)

   Now possible, and only now. It requires a distinct crawlable URL per
   language, which is exactly what the /[lang] restructure created — before
   it, both languages shared one address and any hreflang pair would have
   pointed at itself, which Google ignores at best.

   EVERY PAGE DECLARES THE FULL SET, ITSELF INCLUDED. That is the part people
   get wrong: an hreflang cluster has to be reciprocal and self-referential,
   or the whole cluster is dropped.

   x-default POINTS AT ENGLISH. It is the fallback for a reader whose
   language matches neither, and English is the wider net of the two. It is
   NOT a claim that English is the primary version — the Arabic URL stands on
   its own and is the one most of these readers will land on.
======================================================================== */

/** Builds `alternates` for one marketing route. `path` is the route WITHOUT
 *  its locale prefix: "/" for the landing page, "/pricing", "/guides". */
export function localeAlternates(path: string, lang: Lang): Metadata["alternates"] {
  const suffix = path === "/" ? "" : path;
  const languages: Record<string, string> = {};

  for (const locale of LOCALES) {
    languages[locale] = `${SITE_URL}/${locale}${suffix}`;
  }
  languages["x-default"] = `${SITE_URL}/en${suffix}`;

  return {
    canonical: `${SITE_URL}/${lang}${suffix}`,
    languages,
  };
}
