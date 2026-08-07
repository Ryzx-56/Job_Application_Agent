"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { useLang } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { legalContent, LegalDocKey } from "@/lib/legal-content";

/* ========================================================================
   LEGAL PAGE SHELL
   Shared layout for the four standalone legal routes (/terms, /privacy,
   /security, /refund-policy). Reuses the landing page's design language
   (dark canvas, Plus Jakarta Sans / Cairo, blue accents, grid-glow hero)
   but as a real page instead of a modal, so each document has its own
   crawlable, linkable URL — required for payment-provider merchant
   verification.

   Only the four "policy" docs from legal-content.ts are meant to be passed
   in here; About/Resume Guide/ATS Tips/Contact stay as footer modals.
======================================================================== */

type PublicLegalDocKey = Extract<LegalDocKey, "terms" | "privacy" | "security" | "returnPolicy">;

const LEGAL_ROUTES: { key: PublicLegalDocKey; href: string }[] = [
  { key: "terms", href: "/terms" },
  { key: "privacy", href: "/privacy" },
  { key: "security", href: "/security" },
  { key: "returnPolicy", href: "/refund-policy" },
];

const copy = {
  en: {
    backToHome: "Back to home",
    onThisPage: "On this page",
    otherDocs: "Related documents",
    questionsPrefix: "Questions about this page? Email us at",
  },
  ar: {
    backToHome: "العودة إلى الرئيسية",
    onThisPage: "في هذه الصفحة",
    otherDocs: "مستندات ذات صلة",
    questionsPrefix: "لديك سؤال عن هذه الصفحة؟ راسلنا على",
  },
} as const;

export function LegalPageShell({ docKey }: { docKey: PublicLegalDocKey }) {
  const { t, lang, isRTL } = useLang();
  const doc = legalContent[lang][docKey];
  const c = copy[lang];
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  const [activeSection, setActiveSection] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    sectionRefs.current = sectionRefs.current.slice(0, doc.sections.length);

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top of the "active" band that's
        // currently intersecting, so the nav tracks scroll position rather
        // than just firing on any overlap.
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const idx = sectionRefs.current.findIndex((el) => el === topMost.target);
        if (idx !== -1) setActiveSection(idx);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );

    sectionRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
    // Re-run when the document (and therefore its sections) changes, e.g. on language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, docKey]);

  function jumpTo(e: React.MouseEvent, i: number) {
    e.preventDefault();
    sectionRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const showSideNav = doc.sections.length > 3;

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* ---------------------------------------------------------------
          HEADER — trimmed version of the landing header: logo, language
          switcher, and a way back home. Not fixed, since these pages are
          meant to be read top to bottom, not navigated section by section
          via a persistent nav.
      --------------------------------------------------------------- */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="rounded-md" aria-label="Tarshih home">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <LangSwitcher />
            <Button as={Link} href="/" variant="ghost" size="sm" className="hidden sm:inline-flex">
              <BackIcon className="size-4" aria-hidden />
              {c.backToHome}
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* -------------------------------------------------------------
            HERO — same grid + glow signature as the landing page's final
            CTA panel, sized down into a page header.
        ------------------------------------------------------------- */}
        <section className="relative overflow-hidden border-b border-white/10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
            }}
          />
          <div className="pointer-events-none absolute -top-24 start-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[110px]" />
          <div className="relative mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
            {doc.updated && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400">
                <Clock className="size-3.5" aria-hidden />
                {doc.updated}
              </span>
            )}
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{doc.title}</h1>
            {doc.intro && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-400">{doc.intro}</p>}
          </div>
        </section>

        {/* -------------------------------------------------------------
            BODY — sticky in-page nav on desktop + section content.
        ------------------------------------------------------------- */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <div className={showSideNav ? "lg:grid lg:grid-cols-[240px_1fr] lg:gap-14" : ""}>
            {showSideNav && (
              <nav aria-label={c.onThisPage} className="hidden lg:block">
                <div className="sticky top-8">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">{c.onThisPage}</p>
                  <ul className="space-y-1 border-s border-white/10 ps-4">
                    {doc.sections.map((s, i) => (
                      <li key={s.heading}>
                        <a
                          href={`#section-${i}`}
                          onClick={(e) => jumpTo(e, i)}
                          className={`block rounded-md py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
                            activeSection === i ? "font-medium text-blue-400" : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          {s.heading}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </nav>
            )}

            <div className="min-w-0 max-w-3xl">
              <div className="space-y-12">
                {doc.sections.map((s, i) => (
                  <div
                    key={s.heading}
                    id={`section-${i}`}
                    ref={(el) => {
                      sectionRefs.current[i] = el;
                    }}
                    className="scroll-mt-8"
                  >
                    <h2 className="text-xl font-semibold text-white sm:text-2xl">{s.heading}</h2>
                    <div className="mt-4 space-y-4">
                      {s.body.map((p, j) => (
                        <p key={j} className="text-[15px] leading-relaxed text-zinc-400">
                          {p}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Cross-links to the other three legal documents */}
              <div className="mt-16 border-t border-white/10 pt-8">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{c.otherDocs}</p>
                <div className="flex flex-wrap gap-3">
                  {LEGAL_ROUTES.filter((r) => r.key !== docKey).map((r) => (
                    <Link
                      key={r.key}
                      href={r.href}
                      className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-zinc-400 transition-colors hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                    >
                      {t.footer[r.key]}
                    </Link>
                  ))}
                </div>
              </div>

              <p className="mt-8 text-sm text-zinc-500">
                {c.questionsPrefix}{" "}
                <a href="mailto:tarshih.dev@gmail.com" className="text-blue-400 hover:text-blue-300">
                  tarshih.dev@gmail.com
                </a>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 sm:flex-row sm:px-6">
          <p className="text-sm text-zinc-500">{t.footer.rights(new Date().getFullYear())}</p>
          <Link
            href="/"
            className="rounded text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            {c.backToHome}
          </Link>
        </div>
      </footer>
    </div>
  );
}
