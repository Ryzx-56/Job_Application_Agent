import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/* ========================================================================
   /robots.txt (brief §6.1)

   Everything public is crawlable; everything that is private, single-use or
   meaningless to a crawler is not:

     /dashboard  — behind a login, and its content is per-user
     /auth       — one-shot token endpoints from real users' inboxes. A
                   crawler following a confirmation link can burn the token
                   before the person clicks it, which is an account bug, not
                   an SEO one. This is the entry that matters.
     /login, /signup, /forgot-password, /reset-password
                 — flows, not content. Indexing them puts a bare form in
                   search results ahead of the page that explains the product.

   ⚠️ DISALLOW IS NOT NOINDEX, and this file alone was never enough. Disallow
   stops a crawler FETCHING a URL; it does not stop the URL being INDEXED —
   Google lists disallowed URLs it finds linked elsewhere, with no title and
   "no information is available for this page" in place of a description.
   Thin results carrying the site's name, diluting the pages meant to rank.

   The two also interfere: a crawler blocked here never fetches the page, so
   it never sees a noindex tag. So every route listed above ALSO declares
   `robots: { index: false }` in its own layout — see
   src/app/dashboard/layout.tsx and the four auth-flow layouts. This file is
   the polite request; those are the instruction.
======================================================================== */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/auth",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
