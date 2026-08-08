"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Mail, MapPin, Sparkles } from "lucide-react";
import { useLang } from "@/lib/language";
import { legalContent } from "@/lib/legal-content";

/**
 * Standalone About page.
 *
 * Previously this content only existed inside a modal on the landing page,
 * so the upgrade page's "Read the full story" link pointed at /about and
 * 404'd. Giving it a real route also makes it linkable and shareable, which
 * a modal never is.
 *
 * Content is read from legalContent[lang].about — the SAME source the
 * landing page modal used — so there's one copy of this text, not two that
 * drift apart.
 */

/** Where "back" should go. The upgrade page links here with ?from=upgrade;
 *  everything else falls back to the landing page. Referrer is checked as a
 *  secondary signal for links that didn't carry the param. */
function useBackTarget() {
  const params = useSearchParams();
  const from = params.get("from");
  if (from === "upgrade") return "/dashboard/upgrade";
  if (from === "dashboard") return "/dashboard";
  if (typeof document !== "undefined" && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === window.location.origin && ref.pathname.startsWith("/dashboard")) {
        return ref.pathname;
      }
    } catch {
      // Malformed referrer — fall through to the landing page.
    }
  }
  return "/";
}

function AboutContent() {
  const { lang, isRTL } = useLang();
  const router = useRouter();
  const isAr = lang === "ar";
  const doc = legalContent[isAr ? "ar" : "en"].about;
  const backTarget = useBackTarget();
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  return (
    <main className="min-h-screen bg-white">
      {/* Hero. Dark band against the white body so the page opens with
          something deliberate rather than a wall of text. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0B1220] via-[#0F1E3D] to-[#122952] px-5 pb-16 pt-6 sm:px-8 sm:pb-20">
        {/* Soft light bloom, purely decorative. */}
        <div
          className="pointer-events-none absolute -top-24 start-1/3 size-[28rem] rounded-full bg-blue-500/20 blur-3xl"
          aria-hidden
        />

        <div className="relative mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => router.push(backTarget)}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-blue-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            <BackIcon className="size-4" aria-hidden />
            {isAr ? "رجوع" : "Back"}
          </button>

          <div className="mt-8">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200">
              <Sparkles className="size-3.5" aria-hidden />
              {isAr ? "قصة ترشيح" : "The story behind Tarshih"}
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{doc.title}</h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-blue-100/80">
              {isAr
                ? "لماذا بُنيت ترشيح، ومن يقف خلفها، ولماذا الخطة المجانية موجودة رغم خسارتها."
                : "Why Tarshih was built, who is behind it, and why the free plan exists even though it loses money."}
            </p>
          </div>
        </div>
      </section>

      {/* Body */}
      <section className="px-5 py-14 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="space-y-12">
            {doc.sections.map((section, i) => (
              <article key={section.heading} className="relative">
                {/* Numbered rule, echoing the admin pages' quiet technical
                    styling without importing their whole look. */}
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs tabular-nums text-blue-500">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                    {section.heading}
                  </h2>
                </div>
                <div className="mt-4 space-y-4 ps-0 sm:ps-9">
                  {section.body.map((para, j) => (
                    <p key={j} className="text-base leading-relaxed text-slate-600">
                      {para}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>

          {/* Contact + location strip */}
          <div className="mt-14 grid gap-3 sm:grid-cols-2">
            <a
              href="mailto:support@tarshih.com"
              className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                <Mail className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">
                  {isAr ? "تواصل معنا مباشرة" : "Reach the person building this"}
                </span>
                <span className="block truncate text-sm text-slate-500">support@tarshih.com</span>
              </span>
            </a>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                <MapPin className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">
                  {isAr ? "المقر" : "Based in"}
                </span>
                <span className="block text-sm text-slate-500">
                  {isAr ? "جدة، المملكة العربية السعودية" : "Jeddah, Saudi Arabia"}
                </span>
              </span>
            </div>
          </div>

          {/* Return path, repeated at the bottom so a reader who has scrolled
              the whole page doesn't have to scroll back up to leave. */}
          <div className="mt-12 border-t border-slate-200 pt-8">
            <Link
              href={backTarget}
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              <BackIcon className="size-4" aria-hidden />
              {backTarget === "/"
                ? isAr
                  ? "العودة إلى الصفحة الرئيسية"
                  : "Back to home"
                : isAr
                ? "العودة إلى الخطط"
                : "Back to plans"}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function AboutPage() {
  // useSearchParams needs a Suspense boundary in the app router, otherwise
  // the whole route opts out of static rendering.
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <AboutContent />
    </Suspense>
  );
}
