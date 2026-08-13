"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Minus, Plus } from "lucide-react";
import { useLang, useLocaleHref } from "@/lib/language";
import { formatSar } from "@/lib/pricing";
import { trackCta, useSectionView, type Surface } from "@/lib/track";
import { TIERS } from "@/lib/pricing";

/* ========================================================================
   SHORT FAQ + FINAL CTA (brief §3.7)

   WHAT THIS REPLACES: seven rounded cards, each with a numbered badge in a
   rounded square, under a centred eyebrow-plus-heading — §2.1's card grid and
   its centred-headline tell in one section. And a final CTA sitting in a
   rounded panel with a faint grid texture behind it, which §2.1 bans by name.

   FOUR TO FIVE QUESTIONS, per the brief. It was showing seven. The two that
   left — refunds and what the LinkedIn add-on is — are commerce questions and
   have moved to /pricing with everything else about money. Nothing was
   written for this section: every question and answer already existed in the
   dictionary and is shown verbatim.

   THE DISCLOSURE IS A RULED LIST, not a stack of cards: a hairline above
   every row, the question set at reading size, and a single mark that turns
   from + to −. Keyboard and screen-reader behaviour is unchanged from the
   component this replaces — a real <button>, aria-expanded, aria-controls,
   and a labelled region — because that part was already right.
======================================================================== */

/** One question. Open state is owned by the list so only one is ever open. */
function FaqEntry({
  item,
  isOpen,
  onToggle,
}: {
  item: { id: string; q: string; a: string };
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = `faq-panel-${item.id}`;
  const Mark = isOpen ? Minus : Plus;

  return (
    <li className="border-t" style={{ borderColor: "var(--line-hairline)" }}>
      <h3 className="m-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="flex w-full items-start justify-between gap-6 py-5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 sm:py-6"
          style={{
            color: "var(--ink-1)",
            ["--tw-ring-color" as string]: "var(--accent-quiet)",
          }}
        >
          <span className="t-body-l min-w-0 font-medium">{item.q}</span>
          {/* The mark is the only moving part, and it does not rotate: a
              rotating plus is a dashboard flourish, and at this size the
              swap between + and − reads more clearly than a 45° turn. */}
          <Mark
            className="mt-1 size-[1.125rem] shrink-0 transition-colors"
            style={{ color: isOpen ? "var(--accent-quiet)" : "var(--ink-3)" }}
            aria-hidden
          />
        </button>
      </h3>

      {/* Grid-rows collapse rather than max-height: it animates to the
          content's real height, so a long Arabic answer cannot be clipped by
          a guessed maximum. */}
      <div
        id={panelId}
        role="region"
        className={`grid transition-all duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <p className="t-body max-w-[68ch] pb-6 pe-10" style={{ color: "var(--ink-2)" }}>
            {item.a}
          </p>
        </div>
      </div>
    </li>
  );
}

/** The ruled disclosure list, with one-open-at-a-time state. Exported so
 *  /pricing shows billing questions in exactly this form rather than growing
 *  a second FAQ that looks almost the same. */
export function FaqList({ items }: { items: { id: string; q: string; a: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    // The closing rule under the last row is what makes this read as a set
    // list rather than as a list that ran out.
    <ul className="m-0 min-w-0 list-none border-b p-0" style={{ borderColor: "var(--line-hairline)" }}>
      {items.map((item) => (
        <FaqEntry
          key={item.id}
          item={item}
          isOpen={open === item.id}
          onToggle={() => setOpen(open === item.id ? null : item.id)}
        />
      ))}
    </ul>
  );
}

/** Resolves a list of question ids against the dictionary, dropping any that
 *  no longer exist. Ids rather than slices, so reordering the master list
 *  cannot silently change what a page promotes. */
export function useFaqItems(ids: readonly string[]) {
  const { t } = useLang();
  return ids
    .map((id) => t.faq.items.find((item) => item.id === id))
    .filter((item): item is (typeof t.faq.items)[number] => Boolean(item));
}

/** Structured data for a set of questions (brief §6.1, §3.7). Built from the
 *  SAME array that renders, so the markup and the page cannot disagree —
 *  which is what gets structured data ignored, or penalised. */
export function FaqJsonLd({ items }: { items: { q: string; a: string }[] }) {
  const payload = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  return (
    <script
      type="application/ld+json"
      // Our own dictionary, not user input. This is a client component, but
      // Next server-renders it, so the script is in the initial HTML where a
      // crawler finds it without running any JavaScript — verified with curl.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}

export function LandingFaq() {
  const { t, isRTL } = useLang();
  const href = useLocaleHref();
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;
  const faqRef = useSectionView<HTMLElement>("faq", "landing");
  const featured = useFaqItems(t.faq.landing);

  return (
    <section ref={faqRef} id="faq" className="scroll-mt-24 py-20 sm:py-28">
      <FaqJsonLd items={featured} />

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        {/* Copy on one side, questions on the other. The heading stays with
            the list instead of sitting centred above it, which is what let
            the old version read as a generic support page. */}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,34fr)_minmax(0,66fr)] lg:gap-16">
          <div className="flex min-w-0 flex-col">
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

            <h2
              className="t-display-l mt-6 max-w-[16ch] font-semibold tracking-tight"
              style={{ color: "var(--ink-1)" }}
            >
              {t.faq.title}
            </h2>

            {/* THE LINK SITS AT THE FOOT OF THIS COLUMN, not tucked under the
                heading. Directly beneath the h2 it read as a third line of the
                heading block and was easy to miss entirely, with a column of
                empty space below it. mt-auto drops it to the bottom of the
                row, where it fills that space and lands level with the end of
                the question list beside it.

                The arrow is the affordance. A coloured word alone does not
                read as clickable on a page where accent-coloured text also
                appears as ordinary emphasis. It points forward, so it flips
                with direction — left in Arabic, right in English — unlike the
                "opens the real posting" arrow in the features panel, which
                means "leaves this site" and does not mirror. */}
            <Link
              href={href("/questions")}
              onClick={() => trackCta("faq_see_all", "landing")}
              className="group mt-8 inline-flex items-center gap-2 self-start rounded-[0.2rem] underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 lg:mt-auto lg:pt-10"
              style={{
                color: "var(--accent-quiet)",
                ["--tw-ring-color" as string]: "var(--accent-quiet)",
              }}
            >
              <span className="t-body font-medium">{t.faq.seeAll}</span>
              <ForwardIcon
                className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                aria-hidden
              />
            </Link>
          </div>

          <FaqList items={featured} />
        </div>
      </div>
    </section>
  );
}

/* ========================================================================
   FINAL CTA

   ONE CLEAR CTA, as the brief asks, and no panel around it. The previous
   version was a rounded box with a grid-pattern overlay and a blue glow —
   two banned patterns holding one button.

   THE PRICE LINE IS DELIBERATE (brief §4). Pricing has moved to its own
   route, and a visitor who cannot find a price anywhere assumes "expensive"
   and leaves. One quiet line, the real numbers from lib/pricing.ts, linking
   to the page that explains them.
======================================================================== */
export function FinalCta({
  /** /pricing sets this false — a price line linking to the page you are
   *  already on is a dead link dressed as a signpost. It gets a link back to
   *  the product instead. */
  showPriceLine = true,
  /** Which page this closer is on, so cta_click can tell the landing page's
   *  signups from /pricing's. */
  surface = "landing",
}: {
  showPriceLine?: boolean;
  surface?: Surface;
} = {}) {
  const { t, lang, isRTL } = useLang();
  const localeHref = useLocaleHref();
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;
  const ref = useSectionView<HTMLElement>("final_cta", surface);

  return (
    <section
      ref={ref}
      id="get-started"
      className="scroll-mt-24 border-t"
      style={{ borderColor: "var(--line-hairline)" }}
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <h2
          className="t-display-xl max-w-[18ch] font-semibold tracking-tight"
          style={{ color: "var(--ink-1)" }}
        >
          {t.finalCta.title}
        </h2>
        <p className="t-body-l mt-5 max-w-[52ch]" style={{ color: "var(--ink-2)" }}>
          {t.finalCta.description}
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
          <Link
            href="/signup?plan=free"
            onClick={() => trackCta("final_cta_signup", surface)}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[0.3rem] px-6 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              backgroundColor: "var(--accent)",
              color: "#ffffff",
              ["--tw-ring-color" as string]: "var(--accent-quiet)",
              ["--tw-ring-offset-color" as string]: "var(--surface-base)",
            }}
          >
            {t.finalCta.ctaPrimary}
            <ForwardIcon className="size-4" aria-hidden />
          </Link>

          <Link
            href={localeHref(showPriceLine ? "/pricing" : "/#features")}
            onClick={() => trackCta(showPriceLine ? "final_cta_pricing" : "final_cta_features", surface)}
            className="t-meta inline-flex items-center gap-1.5 rounded-[0.2rem] underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
            style={{
              color: "var(--ink-2)",
              ["--tw-ring-color" as string]: "var(--accent-quiet)",
            }}
          >
            {/* The price is interpolated from TIERS.pro.sar and formatted by
                lib/pricing.ts. Nothing about a price is typed into a string. */}
            {showPriceLine
              ? t.finalCta.priceLine(formatSar(TIERS.pro.sar, lang))
              : t.pricingPage.backToProduct}
            <ForwardIcon className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
