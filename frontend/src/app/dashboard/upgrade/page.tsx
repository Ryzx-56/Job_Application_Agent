"use client";

import React, { useEffect, useState } from "react";
import { Check, Sparkles, Zap, Clock, Heart } from "lucide-react";
import { Badge } from "@/components/badges";
import Link from "next/link";
import { useLang } from "@/lib/language";
import { fetchLinkedInOverview, LinkedInOverview } from "@/lib/supabase/linkedin";
import { LinkedInGlyph } from "@/components/linkedin-ui";
import { formatSar, sarPerCredit, usdApprox } from "@/lib/pricing";

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
          {paidPlans.map((plan) => (
            <div
              key={plan.slug}
              className={`relative flex flex-col rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
                plan.offerBanner
                  ? "border-orange-300 ring-2 ring-orange-200"
                  : plan.premium
                  ? "border-slate-300 ring-1 ring-slate-200"
                  : "border-slate-200"
              }`}
            >
              {/* Offer banner, matching the landing page. Orange rather than
                  the app's blue precisely because it should interrupt the
                  page — a discount that blends in isn't doing its job. */}
              {plan.offerBanner && (
                <div className="flex items-center justify-center gap-1.5 rounded-t-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                  <Clock className="size-3.5 shrink-0" aria-hidden />
                  {plan.offerBanner}
                </div>
              )}

              <div className="flex flex-1 flex-col p-5">
              {plan.badge && (
                <span
                  className={`absolute start-5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white ${
                    plan.offerBanner ? "-top-2.5 bg-orange-600" : "-top-2.5 bg-blue-600"
                  }`}
                >
                  {plan.badge}
                </span>
              )}
              {plan.discountLabel && (
                <span className="absolute -top-2.5 end-5 rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                  {plan.discountLabel}
                </span>
              )}
              <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-slate-900">{formatSar(plan.sar, lang)}</span>
                {plan.originalSar !== null && (
                  <span className="text-sm text-slate-400 line-through">{formatSar(plan.originalSar, lang)}</span>
                )}
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
                  <p className="mt-2 text-xs leading-relaxed text-orange-700">{plan.limitedOffer}</p>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    {isAr
                      ? "شارة عضو مؤسس دائمة لأول 50 مشتركًا يدفعون، في أي خطة."
                      : "A permanent Founding Member badge goes to the first 50 people to pay, on any plan."}
                  </p>
                )}
              </div>

              <Link
                href={`/dashboard/checkout?plan=${plan.slug}`}
                className={`mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  plan.offerBanner
                    ? "bg-orange-600 text-white hover:bg-orange-500"
                    : plan.featured
                    ? "bg-blue-600 text-white hover:bg-blue-500"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {plan.cta}
              </Link>
              </div>
            </div>
          ))}
        </div>
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
            const price = linkedinData?.pricing?.[tier]?.price;
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
                      {price !== undefined ? formatSar(price, lang) : "n/a"}
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
