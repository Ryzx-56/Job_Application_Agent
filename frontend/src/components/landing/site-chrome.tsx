"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useLang, useLocaleHref } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { trackCta } from "@/lib/track";
import { LegalModal } from "@/components/legal-modal";
import { legalContent, LegalDocKey } from "@/lib/legal-content";

/* ========================================================================
   SITE CHROME — the marketing header and footer, shared by every public page.

   MOVED HERE FROM landing-page.tsx, UNCHANGED IN APPEARANCE. /pricing needs
   the same header and footer, and the alternative was either importing them
   from landing-page.tsx — which would pull every landing section into the
   pricing bundle for two components — or keeping a second copy that drifts.

   Two things did have to change to work off the landing page:

     · Section links are absolute ("/#features"), not bare hashes. A bare
       "#features" on /pricing points at nothing.
     · The smooth-scroll handler only intercepts when the reader is already
       on "/". Anywhere else the link is a real navigation and Next handles
       the hash on arrival.

   The footer now owns its own legal-modal state. It used to be lifted into
   the landing page, which meant a second page using this footer would render
   dead links. Nothing about the modal itself changed.
======================================================================== */

/** Smooth-scrolls to a section by id, respecting that section's scroll-mt-*
 *  class so the heading never ends up hidden behind the fixed navbar. */
export function scrollToSection(event: React.MouseEvent, id: string) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SiteHeader({ onOpenAbout }: { onOpenAbout: () => void }) {
  const { t, isRTL } = useLang();
  const href = useLocaleHref();
  const { isLoggedIn } = useAuth();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Pricing and the LinkedIn add-on live on /pricing now (brief §4), so those
     two are real routes rather than anchors. The rest still point at landing
     sections and are written absolute so they work from any page. */
  const NAV_LINKS = [
    { label: t.nav.features, href: "/#features" },
    { label: t.nav.howItWorks, href: "/#how-it-works" },
    { label: t.nav.pricing, href: "/pricing" },
    { label: t.nav.linkedin, href: "/pricing#linkedin" },
    { label: t.nav.faq, href: "/#faq" },
  ];

  /** A hash link on the page it points into scrolls; everywhere else it
   *  navigates. Returns undefined so the anchor keeps its default behaviour
   *  when there is nothing on this page to scroll to. */
  const handleNav = (href: string) => {
    if (!href.startsWith("/#") || pathname !== "/") return undefined;
    const id = href.slice(2);
    return (e: React.MouseEvent) => scrollToSection(e, id);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        {isRTL ? "تخطَّ إلى المحتوى" : "Skip to content"}
      </a>
      <div
        className={`mx-auto flex h-16 max-w-6xl items-center justify-between px-4 transition-all duration-300 sm:px-6 ${
          scrolled ? "mt-2 max-w-5xl rounded-2xl border border-white/10 bg-zinc-950/70 px-4 shadow-lg shadow-black/20 backdrop-blur-xl" : ""
        }`}
      >
        <Link href={href("/")} className="rounded-md" aria-label="Tarshih home">
          <Logo />
        </Link>

        {/* WHY lg AND NOT md, AND WHY whitespace-nowrap.
            The horizontal bar used to switch on at 768px, where its contents
            need roughly 1,100. Two things broke at once: every label wrapped
            inside its own px-3 py-2 box, so the text spilled out of its own
            hover and focus highlight and collided with the row above and
            below; and the Log in / Get started buttons were pushed clean off
            the right edge. Both languages, worst in Arabic, where the labels
            are longer and the app-wide RTL scale sets text-sm to 20px.

            nowrap makes a label physically unable to break inside its box, and
            the editorial scale keeps the nav off the app-wide RTL bump, which
            exists for reading body copy and not for a navigation bar. */}
        <nav className="hidden min-w-0 flex-1 items-center justify-evenly px-2 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={href(link.href)}
              onClick={handleNav(link.href)}
              className="t-nav whitespace-nowrap rounded-lg px-2 py-2 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={onOpenAbout}
            className="t-nav whitespace-nowrap rounded-lg px-2 py-2 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            {t.nav.about}
          </button>
        </nav>

        {/* t-body on the buttons is the other half of the size fix. Without it
            they keep the app-wide scale, which puts Arabic button text at
            20.25px next to a 15.6px link. */}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <LangSwitcher compact />
          {!isLoggedIn && (
            <Button variant="ghost" size="md" className="t-body" as={Link} href="/login">
              {t.nav.login}
            </Button>
          )}
          <Button size="md" className="t-body" as={Link} href={isLoggedIn ? "/dashboard" : "/signup"} onClick={() => trackCta(isLoggedIn ? "header_dashboard" : "header_signup", "header")}>
            {isLoggedIn ? t.nav.dashboard : t.nav.getStarted}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid size-11 place-items-center rounded-lg border border-white/10 text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      <div
        id="mobile-menu"
        className={`mx-4 grid transition-all duration-300 ease-out lg:hidden ${
          open ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden rounded-2xl">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/95 p-3 shadow-xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-2 flex justify-center">
              <LangSwitcher />
            </div>
            <nav className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={href(link.href)}
                  onClick={(e) => {
                    handleNav(link.href)?.(e);
                    setOpen(false);
                  }}
                  className="rounded-lg px-3 py-3 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                >
                  {link.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => {
                  onOpenAbout();
                  setOpen(false);
                }}
                className="rounded-lg px-3 py-3 text-start text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.nav.about}
              </button>
              <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
                {!isLoggedIn && (
                  <Button variant="outline" as={Link} href="/login">{t.nav.login}</Button>
                )}
                <Button as={Link} href={isLoggedIn ? "/dashboard" : "/signup"} onClick={() => trackCta(isLoggedIn ? "header_dashboard" : "header_signup", "header")}>
                  {isLoggedIn ? t.nav.dashboard : t.nav.getStarted}
                </Button>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { t, lang, isRTL } = useLang();
  const href = useLocaleHref();
  const pathname = usePathname();
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);

  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_2fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-400">{t.footer.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {t.footer.columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-medium text-white">{col.title}</h3>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) =>
                    link.doc ? (
                      <li key={link.label}>
                        <button
                          type="button"
                          onClick={() => setOpenDoc(link.doc as LegalDocKey)}
                          className="rounded text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                        >
                          {link.label}
                        </button>
                      </li>
                    ) : (
                      <li key={link.label}>
                        <a
                          href={href(link.href)}
                          /* Footer section links are absolute ("/#features")
                             for the same reason the nav's are: they have to
                             work from /pricing. On the landing page itself
                             they still scroll smoothly rather than jumping. */
                          onClick={
                            link.href.startsWith("/#") && pathname === "/"
                              ? (e) => scrollToSection(e, link.href.slice(2))
                              : undefined
                          }
                          className="rounded text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                        >
                          {link.label}
                        </a>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
          {/* --ink-3, not text-zinc-500. Lighthouse measured zinc-500
              (#71717b) on this canvas at 4.12:1, under the 4.5:1 floor — the
              single accessibility failure on the whole page. It is the exact
              value the editorial token was created to replace: see the note
              on --ink-3 in globals.css, where #83838f measures 5.2:1. */}
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>
            {t.footer.rights(new Date().getFullYear())}
          </p>
          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <Link href={href("/terms")} className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.terms}</Link>
            <Link href={href("/privacy")} className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.privacy}</Link>
            <Link href={href("/security")} className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.security}</Link>
            <Link href={href("/refund-policy")} className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.returnPolicy}</Link>
          </div>
        </div>
      </div>

      <LegalModal
        doc={openDoc ? legalContent[lang][openDoc] : null}
        open={openDoc !== null}
        onClose={() => setOpenDoc(null)}
        isRTL={isRTL}
      />
    </footer>
  );
}
