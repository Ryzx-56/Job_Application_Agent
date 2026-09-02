"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useLang, useLocaleHref } from "@/lib/language";
import { formatSar, formatShortDate, sarPerCredit, usdApprox } from "@/lib/pricing";
import { LinkedInGlyph } from "@/components/linkedin-ui";
import { useAuth } from "@/lib/auth";
// Type-only: erased at compile time, so it adds nothing to the bundle. The
// fetchCredits implementation is imported dynamically in the effect below —
// it pulls in the Supabase client, and this page is a MARKETING page that
// most visitors read signed out. See the note in lib/auth.ts.
import type { Tier } from "@/lib/supabase/credits";
import { cancelSubscription, resumeSubscription } from "@/lib/subscription";
import { SiteHeader, SiteFooter } from "@/components/landing/site-chrome";
import { FaqList, FaqJsonLd, useFaqItems, FinalCta } from "@/components/landing/faq-cta";
import { trackCta, useSectionView } from "@/lib/track";

/* ========================================================================
   /pricing (brief §4)

   Everything about money now lives here: the three plans, the credits
   explainer, the pay-as-you-go packs, the founding-member badge, the LinkedIn
   add-on, and the billing questions. The landing page keeps one quiet line
   near its final CTA pointing at this route.

   A VISUAL PASS, NOT A PRICING CHANGE. Every figure is read from
   lib/pricing.ts through the same dictionary entries the old sections used —
   Pro 29 SAR / 24 credits, Elite 99 SAR / 80 credits, packs untouched. No
   number is typed into this file.

   THE SUBSCRIPTION CONTROLS CAME ACROSS UNCHANGED. Current plan, cancel,
   undo-cancel and switch-to-free all still call the same two functions in
   lib/subscription.ts with the same confirm step. This was the one part of
   the old block that was doing real work rather than presenting, so it was
   moved rather than rewritten.

   WHAT THE OLD SECTIONS LOOKED LIKE, AND WHY THEY DO NOT ANY MORE: three
   rounded cards with a coloured icon square, a lifted "featured" card with a
   blue glow shadow, pill badges in the corners, and the same treatment
   repeated for packs and again for LinkedIn — §2.1's card grid three times on
   one page. Here a plan is a column of type separated by hairlines, the
   recommended one is marked by an accent rule rather than by a shadow, and
   each block alternates which side its argument sits on.

   FOUNDING MEMBER IS A BADGE, NOT A DISCOUNT. There is no second price
   anywhere on this page, no strikethrough, and no "was X SAR" anchor.
======================================================================== */

/** Plan order for comparing what a signed-in reader already has. */
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };

/* ── the confirm step, moved across verbatim ─────────────────────────────
   Same two actions it always guarded: cancel a subscription, or switch down
   to Free. Restyled to the editorial surface, but the flow is untouched. */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onDismiss}>
      <div
        className="w-full max-w-sm rounded-[0.875rem] p-6"
        style={{ backgroundColor: "var(--surface-raised)", boxShadow: "0 24px 64px -16px rgb(0 0 0 / 0.7)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="t-title font-semibold" style={{ color: "var(--ink-1)" }}>{title}</h3>
        <p className="t-body mt-2" style={{ color: "var(--ink-2)" }}>{body}</p>
        {error && <p className="t-meta mt-3" style={{ color: "#fb7185" }}>{error}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-[0.3rem] px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
            style={{ backgroundColor: "#e11d48" }}
          >
            {busy ? "…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="flex-1 rounded-[0.3rem] border px-4 py-2.5 text-sm font-medium transition-colors"
            style={{ borderColor: "var(--line)", color: "var(--ink-2)" }}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A standing head: accent tick, real weight, no pill and no letter-spacing
 *  (Arabic has neither uppercase nor tracking to spare). */
function StandingHead({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-3.5 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: muted ? "var(--line-strong)" : "var(--accent)" }}
        aria-hidden
      />
      <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
        {label}
      </p>
    </div>
  );
}

/**
 * One block of the page: an argument on one side, the thing it describes on
 * the other, alternating down the page — the same structure §3.5 uses.
 */
function Block({
  title,
  body,
  flipped = false,
  children,
  id,
  first = false,
  /** Content spans the full measure with the intro stacked above it, instead
   *  of sitting beside it. For the plan comparison only: three plans inside a
   *  62% column come out about 230px wide each, which turns every feature
   *  line into three wrapped lines and makes the columns unreadably tall.
   *  Measured on a screenshot — the first version of this page had it. */
  wide = false,
  track,
}: {
  title: string;
  body?: string;
  flipped?: boolean;
  children: React.ReactNode;
  id?: string;
  first?: boolean;
  wide?: boolean;
  /** Section name for section_view. Omitted means the block is not measured. */
  track?: string;
}) {
  const ref = useSectionView<HTMLDivElement>(track || "unnamed", "pricing");
  const spacing = first ? "" : "mt-16 border-t pt-16 sm:mt-20 sm:pt-20";
  const rule = first ? undefined : { borderColor: "var(--line-hairline)" };

  const intro = (
    <>
      <h2 className="t-display-m max-w-[20ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
        {title}
      </h2>
      {body && (
        <p className="t-body-l mt-4 max-w-[44ch]" style={{ color: "var(--ink-2)" }}>
          {body}
        </p>
      )}
    </>
  );

  if (wide) {
    return (
      <div ref={track ? ref : undefined} id={id} className={`scroll-mt-24 ${spacing}`} style={rule}>
        {intro}
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    );
  }

  return (
    <div
      ref={track ? ref : undefined}
      id={id}
      className={`grid scroll-mt-24 gap-10 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-16 ${spacing}`}
      style={rule}
    >
      <div className={`min-w-0 lg:row-start-1 ${flipped ? "lg:col-start-2" : "lg:col-start-1"}`}>
        {intro}
      </div>
      <div className={`min-w-0 lg:row-start-1 ${flipped ? "lg:col-start-1" : "lg:col-start-2"}`}>
        {children}
      </div>
    </div>
  );
}

export function PricingPage() {
  const { t, lang, isRTL } = useLang();
  const href = useLocaleHref();
  const { isLoggedIn } = useAuth();
  const router = useRouter();
  const isAr = lang === "ar";
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;
  const copy = t.pricingPage;

  /* ── subscription state: moved from the landing page, unchanged ── */
  const [tier, setTier] = useState<Tier | null>(null);
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"cancel" | "downgrade" | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    // A signed-out reader never needs this: `showTierState` below is
    // `isLoggedIn && tierLoaded && …`, so the flag cannot affect anything
    // while isLoggedIn is false. The version this moved from set it here
    // anyway, which did nothing except trip the cascading-render lint.
    if (!isLoggedIn) return;
    // Only signed-in visitors ever need this, and only after hydration, so
    // the Supabase client is fetched on demand rather than shipped to every
    // reader of the pricing page.
    import("@/lib/supabase/credits")
      .then(({ fetchCredits }) => fetchCredits())
      .then((c) => {
        setTier(c.tier);
        setPendingTier(c.pendingTier);
        setResetAt(c.creditsResetAt);
      })
      .catch((err) => console.error("fetchCredits failed:", err))
      .finally(() => setTierLoaded(true));
  }, [isLoggedIn]);

  async function handleConfirm() {
    setBusy(true);
    setActionError(null);
    try {
      await cancelSubscription();
      setPendingTier("free");
      setConfirmTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchPlan(target: Tier) {
    setBusy(true);
    setActionError(null);
    try {
      const { changePlan } = await import("@/lib/subscription");
      const result = await changePlan(target as "free" | "pro" | "elite");
      setPendingTier((result.pending_plan as Tier) ?? null);
    } catch (err) {
      console.error("changePlan failed:", err);
      // Same shape as the cancel/undo handlers either side of this one.
      setActionError(
        err instanceof Error
          ? err.message
          : isAr ? "حدث خطأ ما. حاول مرة أخرى." : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    setBusy(true);
    setActionError(null);
    try {
      await resumeSubscription();
      setPendingTier(null);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  const resetDateLabel = resetAt ? formatShortDate(resetAt, lang) : "";

  const PENDING_TIER_LABEL: Record<Tier, string> = {
    free: isAr ? "المجانية" : "Free",
    pro: "Pro",
    elite: "Elite",
  };

  const ui = {
    subscribed: isAr ? "مفعّل" : "Active",
    currentPlan: isAr ? "خطتك الحالية" : "Current plan",
    switchToFree: isAr ? "التبديل إلى المجانية" : "Switch to Free",
    cancelSub: isAr ? "إلغاء الاشتراك" : "Cancel subscription",
    undo: isAr ? "تراجع عن الإلغاء" : "Undo",
    switchesOn: (target: string, date: string) =>
      isAr ? `سيتحول إلى ${target} في ${date}` : `Switching to ${target} on ${date}`,
    cancelTitle: isAr ? "تأكيد إلغاء الاشتراك" : "Confirm cancellation",
    cancelBody: isAr
      ? "ستحتفظ بخطتك الحالية ورصيدك الحالي حتى نهاية دورة الفوترة الحالية. بعدها ستنتقل إلى الخطة المجانية."
      : "You'll keep your current plan and credits until the end of this billing cycle. After that, you'll move to the Free plan.",
    downgradeTitle: isAr ? "تأكيد التبديل إلى المجانية" : "Confirm switch to Free",
    downgradeBody: isAr
      ? "ستحتفظ بخطتك الحالية ورصيدك الحالي حتى نهاية الدورة الحالية، ثم تنتقل إلى المجانية."
      : "You'll keep your current plan and credits until the end of this cycle, then move to Free.",
    confirm: isAr ? "نعم، تأكيد" : "Yes, confirm",
    dismiss: isAr ? "تراجع" : "Never mind",
  };

  const billingFaq = useFaqItems(t.faq.pricingPage);

  return (
    <>
      <SiteHeader onOpenAbout={() => router.push("/about")} />
      <main id="main">
        <FaqJsonLd items={billingFaq} />

        {/* ── page head ── */}
        <section className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[120px]" />
          </div>
          <div className="relative mx-auto max-w-6xl px-5 pb-4 pt-28 sm:px-8 sm:pt-36">
            <StandingHead label={copy.label} />
            <h1
              className="t-display-xl mt-6 max-w-[18ch] font-semibold tracking-tight"
              style={{ color: "var(--ink-1)" }}
            >
              {copy.title}
            </h1>
            <p className="t-body-l mt-5 max-w-[56ch]" style={{ color: "var(--ink-2)" }}>
              {copy.description}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          {/* ── PLANS ─────────────────────────────────────────────────────
              Three columns separated by hairlines, not three cards. The
              recommended plan carries an accent rule along its top edge; the
              old version lifted it, shadowed it and gave it a blue border,
              which is a lot of decoration to say "this one". */}
          <Block title={copy.plansTitle} body={copy.plansBody} first wide track="plans">
            <div
              className="grid gap-px lg:grid-cols-3"
              style={{ backgroundColor: "var(--line-hairline)" }}
            >
              {t.pricing.plans.map((plan) => {
                const planSlug = plan.slug as Tier;
                const showTierState = isLoggedIn && tierLoaded && tier !== null;
                const isCurrent = showTierState && tier === planSlug;
                const hasPendingChange = showTierState && pendingTier !== null;
                const isDowngradeTarget =
                  showTierState && planSlug === "free" && tier !== "free" && !hasPendingChange;
                const isUpgrade = showTierState && TIER_RANK[planSlug] > TIER_RANK[tier as Tier];
                // Already paying: they have a card and a live period, so any
                // move between paid plans is a scheduled switch, not a sale.
                const isSubscriber = showTierState && tier !== "free";
                const isPlanSwitch =
                  isSubscriber && !isCurrent && !hasPendingChange && planSlug !== "free";

                return (
                  <div
                    key={plan.name}
                    className="flex flex-col px-0 py-8 lg:px-7 lg:py-9"
                    style={{ backgroundColor: "var(--surface-base)" }}
                  >
                    {/* The one mark of emphasis on the recommended plan. */}
                    {plan.featured && (
                      <span
                        className="mb-5 block h-0.5 w-10 rounded-full"
                        style={{ backgroundColor: "var(--accent)" }}
                        aria-hidden
                      />
                    )}

                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="t-title font-semibold" style={{ color: "var(--ink-1)" }}>
                        {plan.name}
                      </h3>
                      {isCurrent && planSlug !== "free" && !hasPendingChange && (
                        <span className="t-meta font-medium" style={{ color: "var(--accent-quiet)" }}>
                          {ui.subscribed}
                        </span>
                      )}
                    </div>

                    {/* SAR large, because SAR is what gets charged. The dollar
                        line is a reference for readers who think in USD and is
                        derived from the same number at the peg, so the two can
                        never disagree. See lib/pricing.ts. */}
                    <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
                      <span
                        className="t-figure text-[2.5rem] font-semibold leading-none tracking-[-0.02em]"
                        style={{ color: "var(--ink-1)" }}
                      >
                        {formatSar(plan.sar, lang)}
                      </span>
                      <span className="t-meta" style={{ color: "var(--ink-3)" }}>
                        {plan.period}
                      </span>
                    </div>
                    {usdApprox(plan.sar) && (
                      <p className="t-meta mt-1" style={{ color: "var(--ink-3)" }}>
                        {usdApprox(plan.sar)}
                      </p>
                    )}

                    <p className="t-body mt-4 max-w-[34ch]" style={{ color: "var(--ink-2)" }}>
                      {plan.description}
                    </p>

                    <div className="mt-7">
                      {!showTierState && (
                        <Link
                          href={isLoggedIn ? `/dashboard/checkout?plan=${plan.slug}` : `/signup?plan=${plan.slug}`}
                          onClick={() => trackCta(`plan_${plan.slug}`, "pricing")}
                          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[0.3rem] px-5 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                          style={
                            plan.featured
                              ? {
                                  backgroundColor: "var(--accent)",
                                  color: "#ffffff",
                                  ["--tw-ring-color" as string]: "var(--accent-quiet)",
                                  ["--tw-ring-offset-color" as string]: "var(--surface-base)",
                                }
                              : {
                                  border: "1px solid var(--line)",
                                  color: "var(--ink-1)",
                                  ["--tw-ring-color" as string]: "var(--accent-quiet)",
                                  ["--tw-ring-offset-color" as string]: "var(--surface-base)",
                                }
                          }
                        >
                          {plan.cta}
                        </Link>
                      )}

                      {isCurrent && planSlug === "free" && (
                        <p className="t-meta" style={{ color: "var(--ink-3)" }}>{ui.currentPlan}</p>
                      )}

                      {isCurrent && planSlug !== "free" && !hasPendingChange && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setConfirmTarget("cancel");
                          }}
                          className="t-meta underline underline-offset-4 transition-opacity hover:opacity-80"
                          style={{ color: "#fb7185" }}
                        >
                          {ui.cancelSub}
                        </button>
                      )}

                      {isCurrent && planSlug !== "free" && hasPendingChange && (
                        <div className="space-y-1.5">
                          <p className="t-meta" style={{ color: "var(--ink-3)" }}>
                            {ui.switchesOn(PENDING_TIER_LABEL[pendingTier as Tier], resetDateLabel)}
                          </p>
                          <button
                            type="button"
                            onClick={handleUndo}
                            disabled={busy}
                            className="t-meta underline underline-offset-4 disabled:opacity-60"
                            style={{ color: "var(--accent-quiet)" }}
                          >
                            {ui.undo}
                          </button>
                        </div>
                      )}

                      {isDowngradeTarget && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setConfirmTarget("downgrade");
                          }}
                          className="inline-flex h-11 w-full items-center justify-center rounded-[0.3rem] border px-5 text-[0.9375rem] font-medium"
                          style={{ borderColor: "var(--line)", color: "var(--ink-1)" }}
                        >
                          {ui.switchToFree}
                        </button>
                      )}

                      {/* TWO DIFFERENT ACTIONS THAT LOOK THE SAME.
                          Somebody on Free has no card on file, so moving up
                          means paying: checkout, which saves the card for the
                          renewal. Somebody already subscribed HAS a card and
                          a live billing period — sending them through
                          checkout would charge them a second time and start a
                          second subscription. For them the move is scheduled
                          against the period they already paid for, takes
                          effect at the next renewal, and costs nothing now. */}
                      {isUpgrade && !isSubscriber && (
                        <Link
                          href={`/dashboard/checkout?plan=${plan.slug}`}
                          className="inline-flex h-11 w-full items-center justify-center rounded-[0.3rem] px-5 text-[0.9375rem] font-semibold"
                          style={{ backgroundColor: "var(--accent)", color: "#ffffff" }}
                        >
                          {plan.cta}
                        </Link>
                      )}

                      {isPlanSwitch && (
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleSwitchPlan(planSlug)}
                            className="inline-flex h-11 w-full items-center justify-center rounded-[0.3rem] px-5 text-[0.9375rem] font-semibold disabled:opacity-60"
                            style={{ backgroundColor: "var(--accent)", color: "#ffffff" }}
                          >
                            {plan.cta}
                          </button>
                          <p className="t-meta" style={{ color: "var(--ink-3)" }}>
                            {isAr
                              ? "يبدأ مع التجديد القادم — لا يوجد خصم الآن."
                              : "Starts at your next renewal — nothing is charged now."}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* The founding line sits AFTER the action, not before
                        it. Above it, it pushed Pro's button roughly 50px
                        below the other two and the row of three read as
                        ragged — seen on a screenshot. It is a statement with
                        an accent rule, not a badge in a coloured box, and it
                        names a badge rather than implying money off. */}
                    {plan.limitedOffer && (
                      <p
                        className="t-meta mt-5 border-s-2 ps-3"
                        style={{ borderColor: "var(--accent)", color: "var(--ink-2)" }}
                      >
                        {plan.limitedOffer}
                      </p>
                    )}

                    <ul
                      className="m-0 mt-7 list-none space-y-2.5 border-t p-0 pt-6"
                      style={{ borderColor: "var(--line-hairline)" }}
                    >
                      {plan.features.map((feature) => (
                        <li key={feature} className="t-meta flex gap-2.5" style={{ color: "var(--ink-2)" }}>
                          <Check
                            className="mt-0.5 size-3.5 shrink-0"
                            style={{ color: "var(--accent-quiet)" }}
                            aria-hidden
                          />
                          <span className="min-w-0">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            {t.pricing.currencyNote && (
              <p className="t-meta mt-6" style={{ color: "var(--ink-3)" }}>
                {t.pricing.currencyNote}
              </p>
            )}
          </Block>

          {/* ── CREDITS EXPLAINER ─────────────────────────────────────── */}
          <Block title={copy.creditsTitle} body={copy.creditsBody} flipped track="credits">
            <dl className="m-0">
              {copy.creditsRows.map((row, i) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-6 border-t py-4"
                  style={{ borderColor: "var(--line-hairline)" }}
                >
                  <dt className="t-body min-w-0" style={{ color: "var(--ink-2)" }}>
                    {row.label}
                  </dt>
                  {/* The two that cost a credit are set in full ink; the two
                      that ride along with them are quieter. */}
                  <dd
                    className="t-body m-0 shrink-0 font-medium"
                    style={{ color: i < 2 ? "var(--ink-1)" : "var(--ink-3)" }}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Block>

          {/* ── PAY AS YOU GO ─────────────────────────────────────────── */}
          <Block title={copy.packsTitle} body={copy.packsBody} track="packs">
            <div>
              {t.payg.packs.map((pack) => (
                <div
                  key={pack.slug}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-t py-5"
                  style={{ borderColor: "var(--line-hairline)" }}
                >
                  <span
                    className="t-figure w-24 shrink-0 text-[1.5rem] font-semibold leading-none tracking-[-0.02em]"
                    style={{ color: "var(--ink-1)" }}
                  >
                    {formatSar(pack.sar, lang)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="t-body font-medium" style={{ color: "var(--ink-1)" }}>
                      {pack.credits}
                    </p>
                    <p className="t-meta" style={{ color: "var(--ink-3)" }}>
                      {sarPerCredit(pack.sar, pack.creditCount, lang)} {t.payg.perApp}
                      {usdApprox(pack.sar) ? ` · ${usdApprox(pack.sar)}` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/checkout?pack=${pack.slug}`}
                    onClick={() => trackCta(`pack_${pack.slug}`, "pricing")}
                    className="t-meta inline-flex shrink-0 items-center gap-1.5 rounded-[0.2rem] font-medium underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
                    style={{
                      color: "var(--accent-quiet)",
                      ["--tw-ring-color" as string]: "var(--accent-quiet)",
                    }}
                  >
                    {t.payg.cta}
                    <ForwardIcon className="size-3.5" aria-hidden />
                  </Link>
                </div>
              ))}
            </div>
          </Block>

          {/* ── FOUNDING MEMBER ───────────────────────────────────────────
              A badge and a cap. No price, no discount, no anchor. */}
          <Block title={copy.foundingTitle} flipped track="founding">
            <p className="t-body-l max-w-[54ch]" style={{ color: "var(--ink-2)" }}>
              {copy.foundingBody}
            </p>
          </Block>

          {/* ── LINKEDIN ADD-ON ───────────────────────────────────────────
              Both tiers, both prices, on the page: the objection this answers
              is "why pay when a chatbot is free", and the price is half of
              that conversation. Essential has no price because it is an
              inclusion rather than a product. */}
          <Block title={copy.linkedinTitle} body={t.linkedinPromo.description} id="linkedin" track="linkedin">
            <div>
              {[t.linkedinPromo.essential, t.linkedinPromo.premium].map((data) => (
                <div
                  key={data.name}
                  className="border-t py-6"
                  style={{ borderColor: "var(--line-hairline)" }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h3
                      className="t-title inline-flex items-center gap-2 font-semibold"
                      style={{ color: "var(--ink-1)" }}
                    >
                      <LinkedInGlyph className="size-4 shrink-0" />
                      {data.name}
                    </h3>
                    <div className="shrink-0 text-end">
                      {"sar" in data ? (
                        <>
                          <span
                            className="t-figure text-[1.5rem] font-semibold leading-none tracking-[-0.02em]"
                            style={{ color: "var(--ink-1)" }}
                          >
                            {formatSar(data.sar, lang)}
                          </span>
                          <span className="t-meta ms-2" style={{ color: "var(--ink-3)" }}>
                            {t.linkedinPromo.oneTime}
                          </span>
                        </>
                      ) : (
                        <span className="t-meta font-medium" style={{ color: "var(--accent-quiet)" }}>
                          {data.includedLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="t-body mt-1.5 max-w-[52ch]" style={{ color: "var(--ink-2)" }}>
                    {data.tagline}
                  </p>

                  <ul className="m-0 mt-4 list-none space-y-2 p-0">
                    {data.bullets.map((bullet) => (
                      <li key={bullet} className="t-meta flex gap-2.5" style={{ color: "var(--ink-2)" }}>
                        <Check
                          className="mt-0.5 size-3.5 shrink-0"
                          style={{ color: "var(--accent-quiet)" }}
                          aria-hidden
                        />
                        <span className="min-w-0">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <p
                className="t-meta border-t pt-5"
                style={{ borderColor: "var(--line-hairline)", color: "var(--ink-3)" }}
              >
                {t.linkedinPromo.alwaysEnglish}
              </p>
            </div>
          </Block>

          {/* ── BILLING QUESTIONS ─────────────────────────────────────────
              ONE COLUMN, NOT A SPLIT. This was the alternating layout like
              every other block, and it was the one place the pattern broke:
              the heading sat alone in a 38% column with nothing under it —
              the "see all" link had gone into the content column after the
              list — so half the row was empty and the two halves read as two
              unrelated fragments rather than one section.

              Stacking fixes it outright, and it fixes the direction problem
              with it. A split layout is the thing that swaps sides between
              Arabic and English; a single column has no sides to swap, so the
              structure is now identical in both languages and only the text
              changes, which is what was asked for. The alternative — pinning
              the split to physical positions the way the hero does — would
              have put the Arabic heading at the left edge, away from the edge
              an Arabic reader starts from, to fix a layout that was broken
              anyway.

              The measure is capped rather than left at the full 1088px: a
              question set in one line across the whole page is a target the
              eye has to track, and these are short. */}
          <div
            className="mt-16 scroll-mt-24 border-t pt-16 sm:mt-20 sm:pt-20"
            style={{ borderColor: "var(--line-hairline)" }}
          >
            {/* mx-auto, not start-aligned. A capped column that hangs off the
                start edge sits on the left in English and the right in Arabic
                — the block itself moving across the page, which is the
                mirroring this section was asked to stop doing. Centred, it
                occupies the same physical position in both languages and only
                the text inside it changes direction. */}
            <div className="mx-auto max-w-[68ch]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
                <h2 className="t-display-m font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
                  {copy.faqTitle}
                </h2>
                <Link
                  href={href("/questions")}
                  className="t-meta inline-flex items-center gap-1.5 rounded-[0.2rem] font-medium underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
                  style={{
                    color: "var(--accent-quiet)",
                    ["--tw-ring-color" as string]: "var(--accent-quiet)",
                  }}
                >
                  {t.faq.seeAll}
                  <ForwardIcon className="size-3.5" aria-hidden />
                </Link>
              </div>

              <div className="mt-8">
                <FaqList items={billingFaq} />
              </div>
            </div>
          </div>
        </div>

        <FinalCta showPriceLine={false} surface="pricing" />
      </main>
      <SiteFooter />

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget === "cancel" ? ui.cancelTitle : ui.downgradeTitle}
        body={confirmTarget === "cancel" ? ui.cancelBody : ui.downgradeBody}
        confirmLabel={ui.confirm}
        cancelLabel={ui.dismiss}
        busy={busy}
        error={actionError}
        onConfirm={handleConfirm}
        onDismiss={() => (busy ? null : setConfirmTarget(null))}
      />
    </>
  );
}
