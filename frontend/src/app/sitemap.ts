import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { LOCALES } from "@/lib/lang-cookie";

/* ========================================================================
   /sitemap.xml (brief §6.1)

   PUBLIC MARKETING ROUTES ONLY. The dashboard, the auth pages and the
   checkout screens are all behind a login or are single-use flows; listing
   them invites a crawler to spend its budget on pages it will only ever be
   bounced from, and /auth/callback and /auth/confirm must never be crawled
   at all — they are one-shot token endpoints from real users' inboxes.

   BOTH LOCALES, EVERY ROUTE, WITH alternates. The /[lang] restructure gave
   each language its own crawlable URL, so a sitemap entry can now carry the
   xhtml:link alternates that make an hreflang cluster reciprocal — which is
   the condition for Google honouring it at all. Next emits these from the
   `alternates.languages` field below.
======================================================================== */

/** How often each page's content actually changes, not a wish. */
const ROUTES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/questions", changeFrequency: "monthly", priority: 0.8 },
  { path: "/guides", changeFrequency: "yearly", priority: 0.7 },
  { path: "/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/security", changeFrequency: "yearly", priority: 0.3 },
  { path: "/refund-policy", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  /** The absolute URL of one route in one locale. */
  const url = (lang: string, path: string) => `${SITE_URL}/${lang}${path === "/" ? "" : path}`;

  return ROUTES.flatMap((route) =>
    LOCALES.map((lang) => ({
      url: url(lang, route.path),
      lastModified,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: {
          ...Object.fromEntries(LOCALES.map((l) => [l, url(l, route.path)])),
          "x-default": url("en", route.path),
        },
      },
    }))
  );
}
