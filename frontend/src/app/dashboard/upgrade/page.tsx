"use client";

import React from "react";
import Link from "next/link";
import { Check, Sparkles, Zap } from "lucide-react";
import { useLang } from "@/lib/language";

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
 * Most customers are in Saudi Arabia, so every price shows its SAR value
 * underneath. Derived from the USD string at the fixed 3.75 peg rather than
 * stored separately — the landing page's `priceSar` fields are null on the
 * English side, and a second hand-maintained number is one that eventually
 * disagrees with the first.
 */
const USD_TO_SAR = 3.75;

function toSar(price: string): string | null {
  const usd = parseFloat(price.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return `${(usd * USD_TO_SAR).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} SAR`;
}

export default function UpgradePage() {
  const { t, lang } = useLang();
  const isAr = lang === "ar";
  const pricing = t.pricing;
  const payg = t.payg;

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
              className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
                plan.featured ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200"
              }`}
            >
              {plan.badge && (
                <span className="absolute -top-2.5 start-5 rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {plan.badge}
                </span>
              )}
              <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-slate-900">{plan.price}</span>
                {plan.originalPrice && (
                  <span className="text-sm text-slate-400 line-through">{plan.originalPrice}</span>
                )}
                <span className="text-sm text-slate-500">{plan.period}</span>
              </div>
              {toSar(plan.price) && (
                <p className="mt-0.5 text-sm text-slate-500">
                  {toSar(plan.price)} {plan.period}
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
              <div className="mt-1 text-2xl font-semibold text-slate-900">{pack.price}</div>
              {toSar(pack.price) && <p className="mt-0.5 text-sm text-slate-500">{toSar(pack.price)}</p>}
              <p className="mt-1 text-sm font-medium text-blue-600">{pack.credits}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{pack.blurb}</p>
              <p className="mt-2 text-xs text-slate-400">
                {pack.perAppValue} {payg.perApp}
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
    </div>
  );
}
