import { execFileSync } from "node:child_process";
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

   ── lastmod COMES FROM GIT, NOT FROM THE CLOCK ──────────────────────────
   Every entry used to carry one shared `new Date()`, so each deploy told
   Google that all eighteen URLs had just changed — including four legal
   pages last touched in a different week. A lastmod that is always "now" is
   worse than none: it is the signal crawlers use to decide what to re-fetch,
   and one that never distinguishes anything trains them to ignore it.

   Each route now reports the commit date of the files it actually renders
   from. Shared modules are listed per route on purpose — a page's copy is
   its content no matter which file holds it, so a change to lib/language.tsx
   genuinely does change the pages built from it. The legal pages
   deliberately do NOT list language.tsx: their text lives in
   lib/legal-content.ts, which is why they can and should report an older,
   truthful date.
======================================================================== */

type Route = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
  /** Paths, relative to frontend/, whose last commit dates this page. */
  sources: string[];
};

const LEGAL_SOURCES = ["src/components/legal-page.tsx", "src/lib/legal-content.ts"];

/** How often each page's content actually changes, not a wish. */
const ROUTES: Route[] = [
  {
    path: "/",
    changeFrequency: "weekly",
    priority: 1,
    sources: ["src/app/[lang]/page.tsx", "src/components/landing", "src/lib/language.tsx"],
  },
  {
    path: "/pricing",
    changeFrequency: "monthly",
    priority: 0.9,
    sources: [
      "src/app/[lang]/pricing/page.tsx",
      "src/components/pricing",
      "src/lib/pricing.ts",
      "src/lib/language.tsx",
    ],
  },
  {
    path: "/questions",
    changeFrequency: "monthly",
    priority: 0.8,
    sources: ["src/app/[lang]/questions/page.tsx", "src/components/questions", "src/lib/language.tsx"],
  },
  {
    path: "/guides",
    changeFrequency: "yearly",
    priority: 0.7,
    sources: ["src/app/[lang]/guides/page.tsx", "src/components/guides", "src/lib/language.tsx"],
  },
  {
    path: "/about",
    changeFrequency: "yearly",
    priority: 0.6,
    sources: ["src/app/[lang]/about/page.tsx", "src/components/about", "src/lib/language.tsx"],
  },
  {
    path: "/terms",
    changeFrequency: "yearly",
    priority: 0.3,
    sources: ["src/app/[lang]/terms/page.tsx", ...LEGAL_SOURCES],
  },
  {
    path: "/privacy",
    changeFrequency: "yearly",
    priority: 0.3,
    sources: ["src/app/[lang]/privacy/page.tsx", ...LEGAL_SOURCES],
  },
  {
    path: "/security",
    changeFrequency: "yearly",
    priority: 0.3,
    sources: ["src/app/[lang]/security/page.tsx", ...LEGAL_SOURCES],
  },
  {
    path: "/refund-policy",
    changeFrequency: "yearly",
    priority: 0.3,
    sources: ["src/app/[lang]/refund-policy/page.tsx", ...LEGAL_SOURCES],
  },
];

/**
 * The last commit date touching any of `paths`, or undefined.
 *
 * --literal-pathspecs because the route folders are named `[lang]`, and git
 * would otherwise read those brackets as a glob character class and date the
 * wrong files.
 *
 * Runs at build time only: this route is statically generated, so git is
 * consulted once per deploy and never per request.
 */
function lastCommitDate(paths: string[]): Date | undefined {
  try {
    const stdout = execFileSync(
      "git",
      ["--literal-pathspecs", "log", "-1", "--format=%cI", "--", ...paths],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (!stdout) return undefined;
    const date = new Date(stdout);
    return Number.isNaN(date.getTime()) ? undefined : date;
  } catch {
    // No git, no history, or a shallow clone deep enough to have lost this
    // file's last change. Never fatal: a sitemap is not worth failing a
    // build over, and the caller degrades to a coarser but still honest date.
    return undefined;
  }
}

/**
 * FALLBACK ORDER, and why each step is honest:
 *   1. The commit that last touched this page's own sources — the real answer.
 *   2. HEAD's commit date. Reached on a shallow clone (Vercel and most CI
 *      clone with --depth), where a file untouched recently has no reachable
 *      commit. Still a real date on which the site changed, just coarser.
 *   3. undefined -> the <lastmod> element is omitted entirely. Deliberately
 *      NOT the build clock: the protocol makes lastmod optional, and saying
 *      nothing is better than repeating the lie this rewrite removed.
 */
const headDate = lastCommitDate(["."]);

export default function sitemap(): MetadataRoute.Sitemap {
  /** The absolute URL of one route in one locale. */
  const url = (lang: string, path: string) => `${SITE_URL}/${lang}${path === "/" ? "" : path}`;

  return ROUTES.flatMap((route) => {
    const lastModified = lastCommitDate(route.sources) ?? headDate;

    return LOCALES.map((lang) => ({
      url: url(lang, route.path),
      // Both locales of a page share a date because they share their source
      // files — the Arabic and English copy live side by side in the same
      // modules, so a change to one is a change to that page.
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: {
          ...Object.fromEntries(LOCALES.map((l) => [l, url(l, route.path)])),
          "x-default": url("en", route.path),
        },
      },
    }));
  });
}
