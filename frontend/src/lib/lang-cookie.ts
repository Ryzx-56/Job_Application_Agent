/* ========================================================================
   THE LANGUAGE COOKIE — shared by the server and the client.

   This lives in its own module, with no "use client" directive, ON PURPOSE.
   It used to be exported from lib/language.tsx, which is a client module, and
   that silently broke the server: every export of a "use client" module
   becomes a client *reference* when a server component imports it, so
   `cookies().get(LANG_COOKIE)` was looking up a proxy object rather than the
   string "tarshih_lang" and never found anything. The page rendered English
   for an Arabic reader with no error anywhere.

   Anything both sides need has to sit in a neutral module like this one.
======================================================================== */

export const LANG_COOKIE = "tarshih_lang";

/** Language codes the app renders. Kept here rather than in language.tsx so
 *  server components can use the type without importing a client module. */
export type Lang = "en" | "ar";

/** Narrows an untrusted cookie value to a language, defaulting to English. */
export function readLang(value: string | undefined): Lang {
  return value === "ar" ? "ar" : "en";
}

/* ========================================================================
   LOCALE ROUTING (prompts/tarshih-deferred-locale-routing.md)

   Language now lives in the URL — /ar/... and /en/... — so each language has
   a distinct, crawlable address and hreflang becomes possible. The cookie
   does NOT go away: it still decides which locale a bare "/" redirects to,
   and it is still the only signal outside /[lang] (the dashboard and the auth
   pages, which deliberately did not move).

   PRECEDENCE: inside /[lang] the URL wins and rewrites the cookie; outside
   it, the cookie is all there is.
======================================================================== */

/** Every locale with its own URL prefix. */
export const LOCALES: readonly Lang[] = ["en", "ar"] as const;

/** Request header the middleware sets so the ROOT layout can render
 *  <html lang dir> per URL without being a dynamic segment itself. Lives here
 *  rather than in middleware.ts so a server component can import the name
 *  without pulling the middleware module graph into its bundle. */
export const LANG_HEADER = "x-tarshih-lang";

/** True when a path's first segment is a locale we serve. */
export function isLocale(segment: string | undefined): segment is Lang {
  return segment === "en" || segment === "ar";
}

/**
 * The paths that live under /[lang]. Everything NOT listed here is either an
 * app route or an auth route and must never be prefixed.
 *
 * /auth IS THE ONE THAT MATTERS. /auth/callback and /auth/confirm are in
 * Supabase's redirect allowlist and are already baked into confirmation and
 * password-reset emails. They stay exactly where they are, and the middleware
 * below returns before touching them.
 */
export const MARKETING_PATHS: readonly string[] = [
  "/pricing",
  "/questions",
  "/guides",
  "/about",
  "/terms",
  "/privacy",
  "/security",
  "/refund-policy",
] as const;

/** Splits "/ar/pricing" into its locale and the rest ("/pricing"). Returns a
 *  null locale for a path that carries none. */
export function splitLocale(pathname: string): { lang: Lang | null; rest: string } {
  const [, first, ...others] = pathname.split("/");
  if (!isLocale(first)) return { lang: null, rest: pathname };
  const rest = "/" + others.join("/");
  return { lang: first, rest: rest === "/" ? "/" : rest.replace(/\/$/, "") };
}

/**
 * Builds a locale-prefixed href for a MARKETING path.
 *
 * Only marketing paths are prefixed, and that restriction is the whole point:
 * /signup, /login and /dashboard do not live under /[lang], so blindly
 * prefixing every internal link would send people to routes that do not
 * exist. Anything not on the list — an app route, a hash link, an external
 * URL, a mailto — comes back untouched.
 *
 * This is the localeHref() the deferred plan anticipated. Worth noting: that
 * plan assumed the redesign had already been built calling it. It had not —
 * the redesign used bare paths throughout — so the call sites were updated
 * as part of this change rather than being a no-op swap.
 */
export function localePath(href: string, lang: Lang): string {
  if (!href.startsWith("/")) return href;

  // Split any query/hash off before matching, then reattach.
  const match = href.match(/^([^?#]*)([?#].*)?$/);
  const path = match?.[1] || href;
  const suffix = match?.[2] || "";

  const { lang: existing, rest } = splitLocale(path);
  if (existing) return href; // already prefixed

  const isMarketing =
    rest === "/" || MARKETING_PATHS.some((m) => rest === m || rest.startsWith(m + "/"));
  if (!isMarketing) return href;

  return (rest === "/" ? `/${lang}` : `/${lang}${rest}`) + suffix;
}
