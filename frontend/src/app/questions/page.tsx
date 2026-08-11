"use client";

import React, { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Mail, Search, X } from "lucide-react";
import { useLang } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { FaqRow } from "@/components/faq";

/**
 * /questions, every FAQ entry, searchable.
 *
 * The landing page keeps only the highest-impact handful (t.faq.landing) so it
 * stays a landing page; this is where the full list lives, with its own URL so
 * support can link straight to it.
 *
 * Content comes from the SAME t.faq.items the landing section reads, so there
 * is one copy of every answer rather than two that drift. Rows are rendered by
 * the shared FaqRow component for the same reason.
 *
 * Design follows the marketing surfaces (dark canvas, grid-glow hero, blue
 * accent, Plus Jakarta Sans / Cairo) rather than the light dashboard, since
 * this is a public page reached from the landing page and from search.
 */

/**
 * Where "back" goes. The settings footer links here with ?from=dashboard, so a
 * signed-in reader returns to the app rather than being dropped on the
 * marketing home page. Same convention /about follows.
 */
function useBackTarget(): { href: string; label: string } {
  const { t, lang } = useLang();
  const from = useSearchParams().get("from");
  const backToDashboard = lang === "ar" ? "العودة إلى لوحة التحكم" : "Back to dashboard";

  if (from === "settings") return { href: "/dashboard/settings", label: backToDashboard };
  if (from === "dashboard") return { href: "/dashboard", label: backToDashboard };
  return { href: "/", label: t.faq.backToHome };
}

function QuestionsContent() {
  const { t, lang, isRTL } = useLang();
  const back = useBackTarget();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return t.faq.items;
    // Matches question OR answer: people search for the word that's bothering
    // them ("refund", "Arabic", "ATS"), which is usually in the answer.
    return t.faq.items.filter(
      (item) => item.q.toLowerCase().includes(needle) || item.a.toLowerCase().includes(needle)
    );
  }, [query, t.faq.items]);

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* ── Header, matching the legal pages' minimal chrome ── */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Tarshih home">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
            <LangSwitcher />
            <Link
              href={back.href}
              className="hidden items-center gap-1.5 text-sm font-medium text-zinc-400 transition-colors hover:text-white sm:inline-flex"
            >
              <BackIcon className="size-4" aria-hidden />
              {back.label}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero: same grid-and-glow treatment the landing sections use ── */}
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
        {/* left-1/2, not start-1/2: -translate-x-1/2 is physical and doesn't
            mirror, so a logical inset here lands off-centre in Arabic. */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[110px]" />

        <div className="relative mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            {t.faq.eyebrow}
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t.faq.allTitle}</h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-zinc-400">{t.faq.allDescription}</p>

          {/* ── Search ── */}
          <div className="mt-8">
            <label htmlFor="faq-search" className="sr-only">
              {t.faq.searchLabel}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-zinc-500 start-4"
                aria-hidden
              />
              <input
                id="faq-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.faq.searchPlaceholder}
                className="w-full rounded-xl border border-white/10 bg-zinc-900/70 py-3 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-blue-400/50 focus:ring-2 focus:ring-blue-400/20 pe-11 ps-11"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={lang === "ar" ? "مسح البحث" : "Clear search"}
                  className="absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-white end-2.5"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
            <p className="mt-2 text-xs tabular-nums text-zinc-500">
              {t.faq.resultCount(results.length, t.faq.items.length)}
            </p>
          </div>
        </div>
      </section>

      {/* ── The list ── */}
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        {results.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 px-6 py-16 text-center">
            <p className="text-sm text-zinc-400">{t.faq.searchEmpty}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {results.map((item, i) => (
              <FaqRow
                key={item.id}
                index={i + 1}
                item={item}
                isOpen={open === item.id}
                onToggle={() => setOpen(open === item.id ? null : item.id)}
              />
            ))}
          </div>
        )}

        {/* ── Contact fallback ── */}
        <div className="relative mt-10 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 px-6 py-8 text-center">
          <div className="pointer-events-none absolute -bottom-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-blue-600/15 blur-[90px]" />
          <div className="relative">
            <span className="mx-auto grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-blue-400">
              <Mail className="size-4.5" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-white">{t.faq.contactTitle}</h2>
            <p className="mt-1.5 text-sm text-zinc-400">{t.faq.contactBody}</p>
            <a
              href={`mailto:${t.faq.supportEmail}`}
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-400 underline underline-offset-4 transition-colors hover:text-blue-300"
              dir="ltr"
            >
              {t.faq.supportEmail}
            </a>
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <Button as={Link} href={back.href} variant="outline">
            {back.label}
            <ForwardIcon className="size-4" aria-hidden />
          </Button>
        </div>
      </section>
    </div>
  );
}

export default function QuestionsPage() {
  // useSearchParams needs a Suspense boundary in the app router, otherwise the
  // whole route opts out of static rendering.
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <QuestionsContent />
    </Suspense>
  );
}
