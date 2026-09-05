"use client";

import React, { useEffect, useState } from "react";
import { Check, Sparkles, Zap, Heart } from "lucide-react";
import { Badge } from "@/components/badges";
import Link from "next/link";
import { useLang } from "@/lib/language";
import { fetchLinkedInOverview, LinkedInOverview } from "@/lib/supabase/linkedin";
import { LinkedInGlyph } from "@/components/linkedin-ui";
import { formatSar, formatMediumDate, sarPerCredit, usdApprox } from "@/lib/pricing";
import { fetchCredits, type Tier } from "@/lib/supabase/credits";
import { changePlan, resumeSubscription } from "@/lib/subscription";
import { CancelSubscriptionLink } from "@/components/cancel-subscription";
import { planCardState, type Viewer } from "@/lib/plan-state";

/**
 * In-dashboard upgrade page. Replaces the old behaviour where an
 * out-of-credits user was sent to Settings, which had nothing to buy on it.
 *
 * Tiers and packs are read straight from the SAME pricing data the public
 * landing page renders (t.pricing.plans and t.pricing.payg.packs), so
 * names, prices, credit counts and feature lists can never drift out of
 * sync with what's advertised. Nothing about pricing is duplicated here.
 *
 * Selecting anything routes to /dashboard/checkout, which is the existing
 * "payment coming soon" placeholder — same destination the Upgrade buttons
 * elsewhere already use.
 */
/**
 * Prices come from the shared helpers in src/lib/pricing.ts, in SAR, with the
 * dollar figure as a small reference line beneath. This page used to do the
 * opposite: show a USD string and derive SAR from it by parsing the string
 * back into a number. SAR is what customers are actually charged, so it is
 * now the stored value and the primary display, and USD is what gets derived.
 */

export default function UpgradePage() {
  const { t, lang } = useLang();
  const isAr = lang === "ar";
  const pricing = t.pricing;
  const payg = t.payg;
  const li = t.dashboard.linkedin;

  // LinkedIn add-on prices are read from the backend (PRICING in
  // core/linkedin.py) rather than restated here, so the number on this page
  // can never disagree with the number actually charged.
  const [linkedinData, setLinkedinData] = useState<LinkedInOverview | null>(null);
  useEffect(() => {
    fetchLinkedInOverview()
      .then(setLinkedinData)
      .catch(() => setLinkedinData(null));
  }, []);

  /* ── WHAT THE READER IS ALREADY PAYING FOR ────────────────────────────
     This page used to render "Go Pro"/"Go Elite" unconditionally, so an
     Elite subscriber was invited to buy the plan they were already on —
     and following that invitation went to checkout, which would have
     charged them a second time and started a second subscription. The tier
     is read here so each card can show the customer's actual position. */
  const [tier, setTier] = useState<Tier | null>(null);
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    fetchCredits()
      .then((c) => {
        setTier(c.tier);
        setPendingTier(c.pendingTier);
        setResetAt(c.creditsResetAt);
      })
      .catch((err) => console.error("fetchCredits failed:", err))
      .finally(() => setTierLoaded(true));
  }, []);

  /** Move between paid plans WITHOUT a second charge — see the note on the
   *  switch button below. Schedules only; nothing is taken now. */
  async function handleSwitchPlan(target: Tier) {
    setPlanBusy(true);
    setPlanError(null);
    try {
      const result = await changePlan(target as "free" | "pro" | "elite");
      setPendingTier((result.pending_plan as Tier) ?? null);
    } catch (err) {
      setPlanError(
        err instanceof Error
          ? err.message
          : isAr ? "حدث خطأ ما. حاول مرة أخرى." : "Something went wrong. Please try again."
      );
    } finally {
      setPlanBusy(false);
    }
  }

  async function handleUndo() {
    setPlanBusy(true);
    setPlanError(null);
    try {
      await resumeSubscription();
      setPendingTier(null);
    } catch (err) {
      setPlanError(
        isAr ? "تعذّر التراجع عن التغيير. حاول مرة أخرى." : "Couldn't undo that. Please try again."
      );
    } finally {
      setPlanBusy(false);
    }
  }

  // Null until the tier is known, which is what makes every card render its
  // placeholder rather than a buy button aimed at an existing subscriber.
  const viewer: Viewer = tierLoaded && tier !== null ? { tier, pendingTier } : null;

  /** A plan's display name in the reader's language, from the same pricing
   *  data the cards render — never a second hardcoded list. */
  const planName = (slug: string | null) =>
    pricing.plans.find((p) => p.slug === slug)?.name ?? slug ?? "";

  // The LinkedIn tab links here with #linkedin-tiers. A client-side
  // navigation doesn't restore hash scrolling on its own, so do it once the
  // section is on the page.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#linkedin-tiers") return;
    const id = requestAnimationFrame(() => {
      document.getElementById("linkedin-tiers")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [linkedinData]);

  // The free tier isn't purchasable, so it has no place on a page whose
  // entire purpose is choosing something to buy.
  const paidPlans = pricing.plans.filter((p) => p.slug !== "free");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <span className="text-sm font-medium text-blue-600">
          {isAr ? "المزيد من الرصيد" : "More credits"}
        </span>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {isAr ? "اختر خطة أو باقة رصيد" : "Choose a plan or a credit pack"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500 sm:text-base">
          {isAr
            ? "اشترك للحصول على رصيد شهري متجدد، أو اشترِ باقة لمرة واحدة دون اشتراك."
            : "Subscribe for credits that refill every month, or buy a one-off pack with no subscription."}
        </p>
      </div>

      {/* Same founder note the landing page shows. It's the honest reason
          the free tier exists at a loss, and it belongs here more than
          anywhere: this is the moment someone is deciding whether to pay. */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6">
        <div className="flex gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-500">
            <Heart className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{pricing.founderNote.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{pricing.founderNote.body}</p>
            <Link
              href="/about?from=upgrade"
              className="mt-2 inline-block text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-500"
            >
              {pricing.founderNote.cta}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Subscriptions ── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <Sparkles className="size-4 text-blue-500" aria-hidden />
          {isAr ? "الاشتراكات" : "Subscriptions"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {paidPlans.map((plan) => {
            // ONE SHARED RULE with /pricing — see lib/plan-state.ts.
            const state = planCardState(plan.slug as Tier, viewer);
            const switchDate = resetAt ? formatMediumDate(resetAt, lang) : "";
            return (
            <div
              key={plan.slug}
              className={`relative flex flex-col rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
                plan.premium ? "border-slate-300 ring-1 ring-slate-200" : "border-slate-200"
              }`}
            >
              {/* NO OFFER BANNER, NO DISCOUNT PILL, NO STRUCK-THROUGH PRICE.
                  The founding offer gives a badge and nothing else, so there
                  is no markdown to announce and no earlier price to strike
                  through. See the plans data in src/lib/language.tsx. */}
              <div className="flex flex-1 flex-col p-5">
              {plan.badge && (
                <span className="absolute -top-2.5 start-5 rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {plan.badge}
                </span>
              )}
              <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-slate-900">{formatSar(plan.sar, lang)}</span>
                <span className="text-sm text-slate-500">{plan.period}</span>
              </div>
              {usdApprox(plan.sar) && (
                <p className="mt-0.5 text-xs text-slate-400">
                  {usdApprox(plan.sar)} {plan.period}
                </p>
              )}
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{plan.description}</p>

              <ul className="mt-4 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm text-slate-600">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {/* What you actually keep, shown as the badge itself rather
                  than described in text. Pro/Elite subscribers earn their
                  tier badge; the first 50 payers also keep Founding Member
                  and their locked price permanently. */}
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {isAr ? "شارات تحصل عليها" : "Badges you unlock"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    badge={plan.slug === "elite" ? "elite" : "pro"}
                    size="sm"
                    lang={isAr ? "ar" : "en"}
                    withTooltip={false}
                  />
                  <Badge badge="founding_member" size="sm" lang={isAr ? "ar" : "en"} withTooltip={false} />
                </div>
                {plan.limitedOffer ? (
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">{plan.limitedOffer}</p>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    {isAr
                      ? "شارة عضو مؤسس دائمة لأول 50 مشتركًا في برو."
                      : "A permanent Founding Member badge goes to the first 50 Pro subscribers."}
                  </p>
                )}
              </div>

              {/* ── WHAT THIS CARD OFFERS DEPENDS ON WHAT YOU ALREADY HAVE ──
                  Held back until the tier has actually loaded. Rendering the
                  buy button first and correcting it a moment later would
                  flash "Go Elite" at an Elite subscriber, which is the exact
                  thing being fixed. */}
              {state.kind === "unknown" ? (
                <div className="mt-5 h-[42px] animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" aria-hidden />
              ) : state.kind === "subscribed" ? (
                <div className="mt-5">
                  <p className="text-sm font-semibold text-slate-900">
                    {isAr ? `مشترك — ${plan.name}` : `Subscribed — ${plan.name}`}
                  </p>
                  <div className="mt-1.5">
                    <CancelSubscriptionLink isAr={isAr} onCancelled={() => setPendingTier("free")} />
                  </div>
                </div>
              ) : state.kind === "leaving" || state.kind === "arriving" ? (
                /* Either the plan being left, or the plan being moved to —
                   both want the same sentence and the same way back. */
                <div className="mt-5">
                  <p className="text-sm text-slate-600">
                    {isAr
                      ? `ستتحول خطتك إلى ${planName(pendingTier)}${switchDate ? ` في ${switchDate}` : ""}.`
                      : `Switching to ${planName(pendingTier)}${switchDate ? ` on ${switchDate}` : ""}.`}
                  </p>
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={planBusy}
                    className="mt-1.5 rounded text-sm font-medium text-blue-600 underline underline-offset-4 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    {isAr ? "التراجع عن التغيير" : "Undo this change"}
                  </button>
                </div>
              ) : state.kind === "switch" ? (
                /* TWO MOVES THAT LOOK ALIKE AND ARE NOT.
                   Somebody on Free has no card on file, so moving up means
                   paying: checkout, which saves the card for the renewal.
                   Somebody already subscribed HAS a card and a live billing
                   period — putting them through checkout would charge them
                   again and open a second subscription. Their move is
                   scheduled against the period they already paid for. */
                <div className="mt-5">
                  <button
                    type="button"
                    disabled={planBusy}
                    onClick={() => handleSwitchPlan(plan.slug as Tier)}
                    className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                      plan.featured
                        ? "bg-blue-600 text-white hover:bg-blue-500"
                        : "border border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {isAr ? `التبديل إلى ${plan.name}` : `Switch to ${plan.name}`}
                  </button>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    {isAr
                      ? "يبدأ مع التجديد القادم — لا يوجد خصم الآن."
                      : "Starts at your next renewal — nothing is charged now."}
                  </p>
                </div>
              ) : (
                <Link
                  href={`/dashboard/checkout?plan=${plan.slug}`}
                  className={`mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                    plan.featured
                      ? "bg-blue-600 text-white hover:bg-blue-500"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {plan.cta}
                </Link>
              )}
              </div>
            </div>
            );
          })}
        </div>
        {planError && (
          <p role="alert" className="text-sm text-red-700">{planError}</p>
        )}
      </section>

      {/* ── Packs ── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <Zap className="size-4 text-amber-500" aria-hidden />
          {payg.title}
        </h2>
        <p className="text-sm text-slate-500">{payg.description}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {payg.packs.map((pack) => (
            <div
              key={pack.slug}
              className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
                pack.featured ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200"
              }`}
            >
              {pack.badge && (
                <span className="absolute -top-2.5 start-5 rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {pack.badge}
                </span>
              )}
              <h3 className="text-base font-semibold text-slate-900">{pack.name}</h3>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{formatSar(pack.sar, lang)}</div>
              {usdApprox(pack.sar) && <p className="mt-0.5 text-xs text-slate-400">{usdApprox(pack.sar)}</p>}
              <p className="mt-1 text-sm font-medium text-blue-600">{pack.credits}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{pack.blurb}</p>
              <p className="mt-2 text-xs text-slate-400">
                {sarPerCredit(pack.sar, pack.creditCount, lang)} {payg.perApp}
              </p>
              <Link
                href={`/dashboard/checkout?pack=${pack.slug}`}
                className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                {payg.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── LinkedIn add-on ──
          Not a plan and not a credit pack: a one-time add-on for a CV you've
          already made. Both buy paths (here and the LinkedIn tab) funnel into
          the same checkout, so the tier is chosen here and the CV is chosen on
          the LinkedIn page immediately after — there is one checkout flow, not
          two. The #linkedin-tiers id is what the LinkedIn tab deep-links to. */}
      <section id="linkedin-tiers" className="scroll-mt-6 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <LinkedInGlyph className="size-4 text-[#0A66C2]" />
          {isAr ? "إضافة لينكدإن" : "LinkedIn add-on"}
        </h2>
        <p className="text-sm text-slate-500">{li.sub}</p>

        {/* Stacked, not a 2-up grid, and Premium in ink and gold rather than
            a second blue card. Two adjacent matching cards read as one product
            in two sizes, which is the wrong idea: one tier is words you place
            yourself, the other is a specialist building the profile for you.
            Same treatment as the LinkedIn tab, so the two surfaces agree. */}
        <div className="space-y-4">
          {(["normal", "premium"] as const).map((tier) => {
            const isPremium = tier === "premium";
            // Only Premium has a price. Essential is included with Pro and
            // Elite (pricing reference v6 section 4), so it renders the
            // entitlement line instead of a figure.
            const price = isPremium ? linkedinData?.pricing?.premium?.price : undefined;
            return (
              <div
                key={tier}
                className={`relative flex flex-col overflow-hidden rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md ${
                  isPremium
                    ? "border-[#D4AF37]/45 bg-gradient-to-b from-[#131C2E] to-[#0B1220]"
                    : "border-slate-200 bg-white"
                }`}
              >
                <span
                  className={`self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    isPremium ? "bg-[#D4AF37] text-[#0B1220]" : "bg-[#EAF4FB] text-[#0A66C2]"
                  }`}
                >
                  {isPremium ? li.tiers.premiumBadge : li.tiers.normalBadge}
                </span>

                <div className="mt-2.5 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className={`text-lg font-semibold ${isPremium ? "text-white" : "text-slate-900"}`}>
                      {isPremium ? li.tiers.premiumName : li.tiers.normalName}
                    </h3>
                    <p className={`mt-0.5 text-sm ${isPremium ? "text-[#E4CE86]" : "text-slate-500"}`}>
                      {isPremium ? li.tiers.premiumTagline : li.tiers.normalTagline}
                    </p>
                  </div>
                  <div className="text-end">
                    <div className={`text-2xl font-semibold ${isPremium ? "text-white" : "text-slate-900"}`}>
                      {/* Premium has a price; Essential is included with a
                          subscription, so it says that rather than "n/a",
                          which read like the price had failed to load. */}
                      {price !== undefined ? formatSar(price, lang) : li.tiers.normalIncluded}
                    </div>
                    {price !== undefined && usdApprox(price) && (
                      <div className={`text-xs ${isPremium ? "text-slate-500" : "text-slate-400"}`}>
                        {usdApprox(price)}
                      </div>
                    )}
                    <div className={`text-xs ${isPremium ? "text-slate-400" : "text-slate-500"}`}>
                      {li.tiers.oneTime}
                    </div>
                  </div>
                </div>

                <ul className="mt-4 flex-1 space-y-2">
                  {(isPremium ? li.explainer.premiumItems : li.explainer.normalItems).map((feature) => (
                    <li
                      key={feature}
                      className={`flex gap-2 text-sm leading-relaxed ${isPremium ? "text-slate-200" : "text-slate-600"}`}
                    >
                      <Check
                        className={`mt-0.5 size-4 shrink-0 ${isPremium ? "text-[#D4AF37]" : "text-emerald-500"}`}
                        aria-hidden
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Straight to the LinkedIn tab with the tier preselected: the
                    CV has to be chosen before checkout, and that's where the
                    picker lives. */}
                <Link
                  href={`/dashboard/linkedin?tier=${tier}`}
                  className={`mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                    isPremium
                      ? "bg-[#D4AF37] text-[#0B1220] hover:bg-[#E0BF54]"
                      : "bg-[#0A66C2] text-white hover:bg-[#095196]"
                  }`}
                >
                  {isPremium ? li.tiers.premiumCta : li.tiers.normalCta}
                </Link>

                {isPremium && (
                  <p className="mt-2.5 text-center text-xs leading-relaxed text-slate-400">
                    {li.tiers.premiumScarcity}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs leading-relaxed text-slate-400">{li.refundNote.oneTime}</p>
      </section>
    </div>
  );
}
