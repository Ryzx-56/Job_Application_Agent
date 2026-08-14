"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Search, X } from "lucide-react";
import { useLang } from "@/lib/language";
import { SiteHeader, SiteFooter } from "@/components/landing/site-chrome";
import { FaqList, FaqJsonLd, FinalCta } from "@/components/landing/faq-cta";
import { useSectionView, trackCta } from "@/lib/track";

/* ========================================================================
   /questions — the full FAQ

   THE LAST PAGE ON THE OLD LOOK. It carried a minimal header of its own
   (logo + language toggle, not the site nav), a hero with a faint grid
   texture behind it and a radial glow, an uppercase letter-spaced pill for
   an eyebrow, rounded cards with numbered badges for every question, and a
   contact block that was another rounded card with an icon in a tinted
   square. Five §2.1 tells, and none of it shared a token with the pages it
   is linked from.

   THE UPPERCASE PILL IS THE ONE WORTH NAMING: `uppercase tracking-wide` on
   an eyebrow is meaningless in Arabic, which has no capital letters, so the
   Arabic version of that badge was just a small grey word with the letters
   pushed apart. §1.1 rules the pattern out for exactly that reason.

   WHAT IS PRESERVED: the search (matching question OR answer, because people
   search for the word that is bothering them and it is usually in the
   answer), the live result count, the empty state, and the ?from= back
   target that /dashboard/settings relies on.

   The questions themselves render through the same FaqList the landing page
   and /pricing use, so all three surfaces stay one component.
======================================================================== */

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

export function QuestionsPage() {
  const { t, lang, isRTL } = useLang();
  const router = useRouter();
  const back = useBackTarget();
  const [query, setQuery] = useState("");
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  const listRef = useSectionView<HTMLDivElement>("questions_list");

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
    <>
      <SiteHeader onOpenAbout={() => router.push("/about")} />
      <main id="main">
        {/* The canonical FAQ page, so it carries the full set as structured
            data rather than the five the landing page promotes. */}
        <FaqJsonLd items={t.faq.items} />

        <section className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[120px]" />
          </div>

          <div className="relative mx-auto max-w-6xl px-5 pb-4 pt-28 sm:px-8 sm:pt-36">
            <div className="flex items-center gap-3">
              <span
                className="h-3.5 w-0.5 shrink-0 rounded-full"
                style={{ backgroundColor: "var(--accent)" }}
                aria-hidden
              />
              <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
                {t.faq.eyebrow}
              </p>
            </div>

            <h1
              className="t-display-xl mt-6 max-w-[16ch] font-semibold tracking-tight"
              style={{ color: "var(--ink-1)" }}
            >
              {t.faq.allTitle}
            </h1>
            <p className="t-body-l mt-5 max-w-[58ch]" style={{ color: "var(--ink-2)" }}>
              {t.faq.allDescription}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8 sm:pb-24 sm:pt-16">
          {/* Search sits with the list it filters, at the list's own measure,
              rather than floating in the head as a full-width bar. */}
          <div className="mx-auto max-w-[72ch]">
            <label htmlFor="faq-search" className="sr-only">
              {t.faq.searchLabel}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 start-4"
                style={{ color: "var(--ink-3)" }}
                aria-hidden
              />
              <input
                id="faq-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.faq.searchPlaceholder}
                className="t-body w-full rounded-[0.3rem] border py-3 pe-11 ps-11 outline-none transition-colors focus:ring-2"
                style={{
                  borderColor: "var(--line)",
                  backgroundColor: "var(--surface-raised)",
                  color: "var(--ink-1)",
                  ["--tw-ring-color" as string]: "var(--accent-quiet)",
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={lang === "ar" ? "مسح البحث" : "Clear search"}
                  className="absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[0.2rem] transition-colors end-2.5"
                  style={{ color: "var(--ink-3)" }}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
            <p className="t-meta mt-2 tabular-nums" style={{ color: "var(--ink-3)" }}>
              {t.faq.resultCount(results.length, t.faq.items.length)}
            </p>

            <div ref={listRef} className="mt-8">
              {results.length === 0 ? (
                <p
                  className="t-body border-t py-10"
                  style={{ borderColor: "var(--line-hairline)", color: "var(--ink-2)" }}
                >
                  {t.faq.searchEmpty}
                </p>
              ) : (
                // Keyed on the query so a filtered list starts with everything
                // closed rather than holding open a row that has scrolled out
                // of the result set.
                <FaqList key={query} items={results} />
              )}
            </div>

            {/* ── contact fallback ──
                Type and a rule, not a card with a mail glyph in a tinted
                square. The address is the content. */}
            <div className="mt-14 border-t pt-8" style={{ borderColor: "var(--line)" }}>
              <h2 className="t-title font-semibold" style={{ color: "var(--ink-1)" }}>
                {t.faq.contactTitle}
              </h2>
              <p className="t-body mt-2 max-w-[52ch]" style={{ color: "var(--ink-2)" }}>
                {t.faq.contactBody}
              </p>
              <a
                href={`mailto:${t.faq.supportEmail}`}
                onClick={() => trackCta("support_email", "questions")}
                className="t-body-l mt-3 inline-block rounded-[0.2rem] font-medium underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
                style={{
                  color: "var(--accent-quiet)",
                  ["--tw-ring-color" as string]: "var(--accent-quiet)",
                }}
                // A contact identifier is a Latin run inside an Arabic page,
                // and one reordered by the bidi algorithm is a bug this
                // product has shipped before.
                dir="ltr"
              >
                {t.faq.supportEmail}
              </a>
            </div>

            <div className="mt-12">
              <Link
                href={back.href}
                className="t-meta inline-flex items-center gap-2 rounded-[0.2rem] underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
                style={{
                  color: "var(--ink-2)",
                  ["--tw-ring-color" as string]: "var(--accent-quiet)",
                }}
              >
                <BackIcon className="size-4 shrink-0" aria-hidden />
                {back.label}
              </Link>
            </div>
          </div>
        </div>

        <FinalCta surface="questions" />
      </main>
      <SiteFooter />
    </>
  );
}
