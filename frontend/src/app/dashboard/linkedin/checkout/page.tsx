"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Clock, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { useLang } from "@/lib/language";
import { fetchResumes, ResumeRecord } from "@/lib/supabase/resumes";
import { ApiError, fetchLinkedInOverview, LinkedInOverview, LinkedInTier, startLinkedInCheckout } from "@/lib/supabase/linkedin";
import { formatSar, liOutlineButton, liPrimaryButton, LinkedInPageShell } from "@/components/linkedin-ui";

/* ========================================================================
   /dashboard/linkedin/checkout — the one checkout flow for both entry points
   (the LinkedIn tab and /dashboard/upgrade#linkedin-tiers both land here).

   Three things this page is responsible for:
     1. Showing exactly what's being bought, for how much, based on which CV.
     2. Putting the refund/expectations note ON THIS SCREEN, not behind a ToS
        link — it's the last thing read before paying, which is the point.
     3. Collecting the phone number and contact consent for premium, since
        premium means a person calls them.

   It never marks anything paid. startLinkedInCheckout asks the backend, which
   asks the gateway; unlocking happens server-side when the gateway confirms.
   While no gateway is configured (the production default until Moyasar is
   approved) the backend answers 503 and this page shows "coming soon".
======================================================================== */

export default function LinkedInCheckoutPage() {
  const { t, lang, dir } = useLang();
  const copy = t.dashboard.linkedin;
  const router = useRouter();
  const params = useSearchParams();

  const tier = (params.get("tier") as LinkedInTier | null) ?? null;
  const cvId = params.get("cv");
  const isPremium = tier === "premium";

  const [overview, setOverview] = useState<LinkedInOverview | null>(null);
  const [resume, setResume] = useState<ResumeRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the backend says no gateway is live yet — this is the normal
  // production state right now, not a failure, so it gets its own panel
  // rather than an error message.
  const [comingSoon, setComingSoon] = useState(false);
  const [paidPurchaseId, setPaidPurchaseId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([fetchLinkedInOverview(), fetchResumes(0, 50)])
      .then(([data, saved]) => {
        if (cancelled) return;
        setOverview(data);
        setResume(saved.resumes.find((r) => r.id === cvId) ?? null);
      })
      .catch((err) => {
        console.error("LinkedIn checkout load failed:", err);
        if (!cancelled) setError(copy.errors.load);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvId]);

  const price = tier && overview ? overview.pricing[tier].price : null;
  const priceLabel = price !== null ? formatSar(price, lang) : "";
  const invalidOrder = !tier || !cvId;

  async function handlePay() {
    if (invalidOrder) {
      setError(copy.checkout.errors.missingSelection);
      return;
    }
    if (isPremium && !consent) {
      setError(copy.checkout.errors.consent);
      return;
    }
    if (isPremium && !phone.trim()) {
      setError(copy.checkout.errors.phone);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await startLinkedInCheckout({
        tier: tier!,
        sourceCvId: cvId!,
        contactPhone: isPremium ? phone.trim() : undefined,
        contactConsent: isPremium ? consent : false,
      });

      // A hosted gateway hands back somewhere to pay — leave the app.
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      // Mock gateway: the backend already confirmed it server-side through the
      // same path the real webhook uses, so the purchase is genuinely paid.
      if (result.status === "paid") {
        setPaidPurchaseId(result.purchase_id);
        return;
      }
      // Pending with nowhere to send them: nothing to do here but wait for the
      // gateway's webhook. Back to the tab, where the purchase will appear.
      router.push("/dashboard/linkedin");
    } catch (err) {
      const apiError = err as ApiError;
      console.error("startLinkedInCheckout failed:", apiError);

      if (apiError.code === "payment_gateway_unavailable") {
        setComingSoon(true);
        return;
      }
      if (apiError.code === "consent_required") {
        setError(copy.checkout.errors.consent);
        return;
      }
      if (apiError.code === "phone_required") {
        setError(copy.checkout.errors.phone);
        return;
      }
      if (apiError.code === "cv_not_supported") {
        setError(copy.errors.cvNotSupported);
        return;
      }
      setError(apiError.message || copy.checkout.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  const BackArrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  if (loading) {
    return (
      <LinkedInPageShell dir={dir}>
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-20 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {copy.cvSelector.loading}
        </div>
      </LinkedInPageShell>
    );
  }

  /* ── Payment isn't live yet (production default) ── */
  if (comingSoon) {
    return (
      <LinkedInPageShell dir={dir}>
        <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-[#EAF4FB] text-[#0A66C2]">
            <Clock className="size-6" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold text-slate-900">{copy.checkout.comingSoonTitle}</h1>
          <p className="text-sm leading-relaxed text-slate-600">{copy.checkout.comingSoonBody}</p>
          <Link href="/dashboard/linkedin" className={`mt-2 ${liOutlineButton}`}>
            {copy.checkout.comingSoonCta}
          </Link>
        </div>
      </LinkedInPageShell>
    );
  }

  /* ── Paid (mock gateway, or a confirmed return) ── */
  if (paidPurchaseId) {
    return (
      <LinkedInPageShell dir={dir}>
        <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-white p-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold text-slate-900">{copy.checkout.paidTitle}</h1>
          <p className="text-sm leading-relaxed text-slate-600">{copy.checkout.paidBody}</p>
          <Link href="/dashboard/linkedin" className={`mt-2 ${liPrimaryButton}`}>
            <Sparkles className="size-4" aria-hidden />
            {copy.checkout.goGenerate}
          </Link>
        </div>
      </LinkedInPageShell>
    );
  }

  return (
    <LinkedInPageShell dir={dir}>
      <Link
        href="/dashboard/linkedin"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0A66C2] hover:underline"
      >
        <BackArrow className="size-4" aria-hidden />
        {copy.checkout.back}
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.checkout.title}</h1>
        <p className="mt-1.5 text-sm text-slate-600">{copy.checkout.sub}</p>
      </header>

      {invalidOrder ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{copy.checkout.errors.missingSelection}</span>
        </div>
      ) : (
        <>
          {/* ── Order summary ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">{copy.checkout.orderTitle}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">{copy.checkout.tierLabel}</dt>
                <dd className="font-medium text-slate-900">
                  {isPremium ? copy.tiers.premiumName : copy.tiers.normalName}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">{copy.checkout.cvLabel}</dt>
                <dd className="min-w-0 truncate text-end font-medium text-slate-900">
                  {resume ? resume.role || copy.cvSelector.untitled : copy.cvSelector.untitled}
                  {resume?.company ? <span className="text-slate-400"> · {resume.company}</span> : null}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2">
                <dt className="text-slate-500">{copy.checkout.totalLabel}</dt>
                <dd className="text-base font-semibold text-slate-900">
                  {priceLabel} <span className="text-xs font-normal text-slate-500">{copy.tiers.oneTime}</span>
                </dd>
              </div>
            </dl>
          </section>

          {/* ── The expectations/refund note, on the screen itself (§4) ── */}
          <section className="rounded-2xl border border-[#0A66C2]/25 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Lock className="size-4 text-[#0A66C2]" aria-hidden />
              {copy.refundNote.title}
            </h2>
            <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-slate-600">
              <li>{copy.refundNote.oneTime}</li>
              <li>{isPremium ? copy.refundNote.premium : copy.refundNote.normal}</li>
              <li>{copy.refundNote.contact}</li>
            </ul>
            <Link
              href="/refund-policy"
              className="mt-3 inline-block text-xs font-medium text-[#0A66C2] underline underline-offset-2"
            >
              {copy.refundNote.policyLink}
            </Link>
          </section>

          {/* ── Premium: how we reach them ── */}
          {isPremium && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">{copy.checkout.contactTitle}</h2>

              <label htmlFor="linkedin-phone" className="mt-3 block text-xs font-medium text-slate-600">
                {copy.checkout.phoneLabel}
              </label>
              <input
                id="linkedin-phone"
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={copy.checkout.phonePlaceholder}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-900 outline-none focus:border-[#0A66C2] focus:ring-2 focus:ring-[#0A66C2]/20"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{copy.checkout.phoneHint}</p>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-slate-700">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-[#0A66C2] focus:ring-[#0A66C2]/30"
                />
                <span>{copy.checkout.consentLabel}</span>
              </label>
            </section>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {overview?.gateway.is_mock && (
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
              {copy.checkout.mockNotice}
            </p>
          )}

          <button type="button" onClick={handlePay} disabled={submitting} className={`w-full ${liPrimaryButton}`}>
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {submitting ? copy.checkout.paying : copy.checkout.payCta(priceLabel)}
          </button>
        </>
      )}
    </LinkedInPageShell>
  );
}
