"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLang } from "@/lib/language";
import { legalContent } from "@/lib/legal-content";
import { SiteHeader, SiteFooter } from "@/components/landing/site-chrome";
import { FinalCta } from "@/components/landing/faq-cta";

/* ========================================================================
   /about

   WHAT THIS REPLACES: a white page with a blue gradient band across the top,
   a pill badge with a sparkle icon in it, 01/02/03 numbering down the
   headings, and two rounded cards with icons in tinted squares at the
   bottom. Four of §2.1's banned patterns on one page, and none of it shared
   a single token with the rest of the site — a reader arriving from the
   footer left the design system entirely.

   THE NUMBERING IS GONE, DELIBERATELY. "A one-person company", "What we're
   trying to solve" and "Where it's going" are three topics, not three steps.
   §2.1 allows numbering only where order carries meaning, which is how it
   works stays numbered and this does not.

   CONTENT IS UNCHANGED. Every word comes from legalContent[lang].about, the
   same source the old page and the old modal both read, so there is one copy
   of this story rather than three. Nothing was rewritten for the redesign.

   THE BACK BEHAVIOUR IS PRESERVED. /dashboard/upgrade links here with
   ?from=upgrade and expects to be returned to; that logic is carried across
   unchanged, because it is the one piece of this page doing real work.
======================================================================== */

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

export function AboutPage() {
  const { lang, isRTL } = useLang();
  const router = useRouter();
  const isAr = lang === "ar";
  const doc = legalContent[isAr ? "ar" : "en"].about;
  const backTarget = useBackTarget();
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  const backLabel =
    backTarget === "/"
      ? isAr
        ? "العودة إلى الصفحة الرئيسية"
        : "Back to home"
      : isAr
      ? "العودة إلى الخطط"
      : "Back to plans";

  /* The colophon: who runs this and where from. Set as two labelled entries
     rather than two cards with icons in tinted squares — the fact is the
     content, and a mail glyph adds nothing to an email address. */
  const colophon = [
    {
      label: isAr ? "تواصل مباشر" : "Reach the person building this",
      value: "support@tarshih.com",
      href: "mailto:support@tarshih.com",
    },
    {
      label: isAr ? "المقر" : "Based in",
      value: isAr ? "جدة، المملكة العربية السعودية" : "Jeddah, Saudi Arabia",
      href: null,
    },
  ];

  return (
    <>
      <SiteHeader onOpenAbout={() => router.push("/about")} />
      <main id="main">
        {/* ── page head ── */}
        <section className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[120px]" />
          </div>

          <div className="relative mx-auto max-w-6xl px-5 pb-4 pt-28 sm:px-8 sm:pt-36">
            {/* Standing head, not a pill with a sparkle in it. */}
            <div className="flex items-center gap-3">
              <span
                className="h-3.5 w-0.5 shrink-0 rounded-full"
                style={{ backgroundColor: "var(--accent)" }}
                aria-hidden
              />
              <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
                {isAr ? "قصة ترشيح" : "The story behind Tarshih"}
              </p>
            </div>

            <h1
              className="t-display-xl mt-6 max-w-[16ch] font-semibold tracking-tight"
              style={{ color: "var(--ink-1)" }}
            >
              {doc.title}
            </h1>
            <p className="t-body-l mt-5 max-w-[56ch]" style={{ color: "var(--ink-2)" }}>
              {isAr
                ? "لماذا بُنيت ترشيح، ومن يقف خلفها، ولماذا الخطة المجانية موجودة رغم خسارتها."
                : "Why Tarshih was built, who is behind it, and why the free plan exists even though it loses money."}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pb-24 sm:pt-20">
          {/* ── the story ──
              The same ruled two-column treatment /guides uses: the heading
              holds the start column, the prose runs at a reading measure
              beside it. Long-form set as a document, not as cards. */}
          {doc.sections.map((section, i) => (
            <article
              key={section.heading}
              className={`border-t py-8 sm:py-10 ${i === 0 ? "" : ""}`}
              style={{ borderColor: "var(--line-hairline)" }}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,34fr)_minmax(0,66fr)] lg:gap-12">
                <h2 className="t-title max-w-[24ch] font-semibold" style={{ color: "var(--ink-1)" }}>
                  {section.heading}
                </h2>
                <div className="min-w-0">
                  {section.body.map((paragraph, j) => (
                    <p
                      key={j}
                      className={`t-body max-w-[68ch] ${j === 0 ? "" : "mt-4"}`}
                      style={{ color: "var(--ink-2)" }}
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            </article>
          ))}

          {/* ── colophon ── */}
          <div
            className="grid gap-x-12 gap-y-6 border-t pt-8 sm:grid-cols-2"
            style={{ borderColor: "var(--line)" }}
          >
            {colophon.map((entry) => (
              <div key={entry.label}>
                <p className="t-meta" style={{ color: "var(--ink-3)" }}>
                  {entry.label}
                </p>
                {entry.href ? (
                  <a
                    href={entry.href}
                    className="t-body-l mt-1 inline-block rounded-[0.2rem] font-medium underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
                    style={{
                      color: "var(--accent-quiet)",
                      ["--tw-ring-color" as string]: "var(--accent-quiet)",
                    }}
                    // An email address is a Latin run wherever it appears, and
                    // a contact identifier reordered by the bidi algorithm is
                    // a bug this product has shipped before.
                    dir="ltr"
                  >
                    {entry.value}
                  </a>
                ) : (
                  <p className="t-body-l mt-1 font-medium" style={{ color: "var(--ink-1)" }}>
                    {entry.value}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Return path, kept at the bottom so a reader who has scrolled the
              whole page does not have to scroll back up to leave. This is the
              link the dashboard's upgrade page depends on. */}
          <div className="mt-12">
            <Link
              href={backTarget}
              className="t-meta inline-flex items-center gap-2 rounded-[0.2rem] underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
              style={{
                color: "var(--ink-2)",
                ["--tw-ring-color" as string]: "var(--accent-quiet)",
              }}
            >
              <BackIcon className="size-4 shrink-0" aria-hidden />
              {backLabel}
            </Link>
          </div>
        </div>

        <FinalCta surface="about" />
      </main>
      <SiteFooter />
    </>
  );
}
