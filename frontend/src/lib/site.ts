/* ========================================================================
   THE CANONICAL ORIGIN — one value, used by metadata, the sitemap and robots.

   NOT hardcoded at each call site: metadataBase, every canonical URL, the
   sitemap entries and the robots sitemap pointer all have to agree, and four
   copies of a hostname is four chances to disagree after a domain change.

   Falls back to the production origin rather than to localhost. A build with
   the env var unset is a deploy, not a dev session, and an absolute URL
   pointing at localhost in a production OG tag is worse than a hardcoded
   real one.
======================================================================== */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://tarshih.com").replace(/\/+$/, "");

/* The generated social card (src/app/opengraph-image.tsx).
 *
 * DECLARED EXPLICITLY ON EVERY ROUTE, and that is not redundancy. Next
 * attaches a file-convention opengraph-image to the SEGMENT it lives in — the
 * root — and a child route that exports its own `openGraph` object replaces
 * that segment's block wholesale. Measured: og:image appeared on / and on no
 * other page. Every route that sets openGraph therefore has to name the image
 * itself. Resolved against metadataBase, so a relative path is emitted
 * absolute, which is what scrapers require.
 */
export const OG_IMAGE = "/opengraph-image";
