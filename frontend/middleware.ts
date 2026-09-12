import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { LANG_COOKIE, LANG_HEADER, MARKETING_PATHS, isLocale, readLang, splitLocale } from "@/lib/lang-cookie";

/* ========================================================================
   MIDDLEWARE — two jobs, in a deliberate order.

   1. LOCALE ROUTING for the marketing pages, which now live under /[lang].
   2. SUPABASE SESSION REFRESH, which is what this file did before and still
      has to do, or Server Components start seeing stale sessions.

   ── THE AUTH RISK, AND HOW IT IS AVOIDED ────────────────────────────────
   prompts/tarshih-deferred-locale-routing.md flags one thing as the risk that
   matters: /auth/callback and /auth/confirm are in Supabase's redirect
   allowlist and are already inside confirmation and password-reset emails
   sitting in real inboxes. If either path changes, someone's reset link 404s
   and they are locked out.

   They are structurally safe here, for three reasons:

     · Those routes did not move, and still haven't. app/auth/** is exactly
       where it was. The marketing folders moved twice now: first under
       app/[lang]/, and — once the plain header-passing approach below
       turned out not to be enough (see next paragraph) — again, into
       app/(marketing)/[lang]/, which is its OWN root layout. Neither move
       touched app/auth, app/login, app/signup, app/dashboard,
       app/forgot-password, app/reset-password or app/api: a route group's
       parentheses are invisible in the URL, and Route Handlers
       (auth/callback, auth/confirm) don't resolve through a layout at all,
       so relocating layouts was never a thing that could reach them.
     · The locale redirect below is an ALLOW-LIST. It fires only for "/" and
       for the eight paths in MARKETING_PATHS. /auth is not one of them, so
       the rewrite branch is never even considered for it.
     · The session refresh still runs on every route that reads a session —
       the dashboard, /auth/**, and the login/signup/reset flows — exactly as
       before. It is now SKIPPED on the marketing pages, which never read one;
       see the note on step 3 for why that is safe and what it buys.

   THE HEADER-PASSING APPROACH DESCRIBED BELOW WAS THE FIRST ATTEMPT, AND IT
   WASN'T ENOUGH. Handing the resolved language to app/layout.tsx via
   x-tarshih-lang avoided a route-group move, which is why it was tried
   first — but app/layout.tsx also calls cookies(), and Next.js opts a whole
   route into dynamic rendering (cache-control: no-store, no bf-cache) the
   moment ANY server component in its tree reads a request-time API,
   regardless of whether the header itself is used. Measured live, this
   pinned marketing LCP at ~4.4s. Giving /[lang] its own root layout — the
   thing this comment used to say wasn't needed — is what actually fixes
   that, and it does so without moving anything auth-adjacent, per the point
   above. app/layout.tsx (this file's actual target below) still exists,
   still reads headers()/cookies(), and still serves everything that isn't
   under app/(marketing)/ — the header it reads is now consumed by exactly
   that layout, nothing under /[lang] any more.
======================================================================== */

/** Static assets and API-ish paths never need either job doing. */
function isInternal(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/opengraph-image" ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

/** True for a path that renders marketing content and therefore never reads
 *  a session server-side — the locale routes and their bare aliases. */
function isMarketingSurface(pathname: string) {
  const { lang, rest } = splitLocale(pathname);
  if (lang) return true;
  return isBareMarketingPath(rest);
}

/** True for a bare (unprefixed) marketing path that should be redirected. */
function isBareMarketingPath(pathname: string) {
  if (pathname === "/") return true;
  return MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isInternal(pathname)) return NextResponse.next();

  const cookieLang = readLang(request.cookies.get(LANG_COOKIE)?.value);
  const { lang: urlLang } = splitLocale(pathname);

  /* ── 1. Locale redirect ────────────────────────────────────────────────
     A bare marketing path goes to the reader's language. 307 rather than
     301: the target depends on a cookie, so it is not a permanent mapping
     and must not be cached by a browser as one. An old indexed /questions
     still resolves — it just resolves through one hop. */
  if (!urlLang && isBareMarketingPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? `/${cookieLang}` : `/${cookieLang}${pathname}`;
    url.search = search;
    return NextResponse.redirect(url, 307);
  }

  /* ── 2. The resolved language, for the root layout ─────────────────────
     The language the page should render in: the URL inside /[lang], the
     cookie everywhere else. */
  const lang = urlLang ?? cookieLang;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LANG_HEADER, lang);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  /* ── 3. Session refresh — ONLY where a session is actually read ────────
     This used to run on every single request. getUser() is a network call to
     Supabase, in the middleware, in front of the response: it sat directly in
     TTFB for anonymous readers on pages that have no session to refresh, and
     the Set-Cookie it can emit is what forced Cache-Control: no-store, which
     is what disqualified the marketing pages from the back/forward cache.

     The marketing pages do not need it. They render identically signed in or
     out; the header's Log in / Get started swap is decided client-side by
     useAuth() against the browser's own Supabase client. Nothing server-side
     on /[lang] reads the session.

     What DOES need it keeps it, unchanged: the dashboard (its layout gates on
     the session server-side), the auth routes (/auth/callback and
     /auth/confirm exchange codes and must have fresh cookies), and the
     login/signup/reset flows that redirect an already-authenticated visitor.

     Skipping it here does not weaken auth anywhere: a token that is not
     refreshed on a marketing page is refreshed the moment the reader touches
     a route that cares. */
  const needsSession = !urlLang && !isMarketingSurface(pathname);
  if (!needsSession) {
    if (urlLang && isLocale(urlLang) && urlLang !== cookieLang) {
      response.cookies.set(LANG_COOKIE, urlLang, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
    }
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touching getUser() is what actually triggers the token refresh.
  await supabase.auth.getUser();

  /* Visiting a locale URL rewrites the cookie, so the choice follows the
     reader to the dashboard and the auth pages, which have no locale in
     their own URLs. Only written when it actually differs, to avoid setting
     a cookie header on every single request. */
  if (urlLang && isLocale(urlLang) && urlLang !== cookieLang) {
    response.cookies.set(LANG_COOKIE, urlLang, {
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
