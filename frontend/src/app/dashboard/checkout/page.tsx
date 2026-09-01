"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Clock, Loader2, Lock } from "lucide-react";
import { useLang } from "@/lib/language";
import { PACK_REFERENCE, PLAN_REFERENCE, formatSar, usdApprox } from "@/lib/pricing";
import {
  fetchPaymentCatalog,
  loadMoyasarForm,
  mountCheckoutForm,
  type PaymentProduct,
} from "@/lib/payments";

/* ========================================================================
   /dashboard/checkout — the real card checkout for CREDIT PACKS.

   Reached as ?pack=starter | best-value | power.

   ?plan=pro | elite still lands on the "coming soon" panel: a subscription
   needs the card TOKENIZED as well as charged, plus a billing cycle and
   dunning, which is §5 of the billing brief and not built yet. Charging
   someone a first month through this page would take their money for a
   subscription that would never renew and could not be cancelled.

   NOTHING HERE UNLOCKS ANYTHING. The form posts to Moyasar, Moyasar
   redirects to /payment/callback, and the credits are granted server-side by
   backend/core/payments.py once Moyasar's webhook confirms the charge. This
   page cannot grant a credit even if every line of it were rewritten in the
   browser's console.
======================================================================== */

const PACK_SLUGS = ["starter", "best-value", "power"] as const;
type PackSlug = (typeof PACK_SLUGS)[number];

function isPackSlug(value: string | null): value is PackSlug {
  return !!value && (PACK_SLUGS as readonly string[]).includes(value);
}

export default function CheckoutPage() {
  const { lang, dir } = useLang();
  const isAr = lang === "ar";
  const params = useSearchParams();

  const plan = params.get("plan");
  const packParam = params.get("pack");

  const reference = isPackSlug(packParam)
    ? PACK_REFERENCE[packParam]
    : plan === "pro" || plan === "elite"
      ? PLAN_REFERENCE[plan]
      : null;
  // Subscriptions are §5. Until then this page sells packs only.
  const isSubscription = reference === PLAN_REFERENCE.pro || reference === PLAN_REFERENCE.elite;

  const [product, setProduct] = useState<PaymentProduct | null>(null);
  const [mode, setMode] = useState<string>("unknown");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formReady, setFormReady] = useState(false);

  // Guards against React StrictMode's double effect invocation in dev, which
  // would otherwise render two card forms into the same container.
  const mountedRef = useRef(false);
  const formHostId = "moyasar-checkout-form";

  const BackArrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  /* ── Load the price list ─────────────────────────────────────────── */
  useEffect(() => {
    if (!reference || isSubscription) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    fetchPaymentCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const match = catalog.products.find((p) => p.reference === reference) ?? null;
        setProduct(match);
        setMode(catalog.mode);
        if (!match) {
          setError(
            isAr
              ? "هذه الباقة لم تعد متاحة."
              : "That pack isn't available any more."
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            isAr
              ? "تعذّر تحميل بيانات الدفع. حدّث الصفحة وحاول مرة أخرى."
              : "We couldn't load the payment details. Refresh the page and try again."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reference, isSubscription, isAr]);

  /* ── Mount the Moyasar form ──────────────────────────────────────── */
  const mountForm = useCallback(async () => {
    if (!product || mountedRef.current) return;
    mountedRef.current = true;

    try {
      await loadMoyasarForm();
      mountCheckoutForm({
        element: `#${formHostId}`,
        // FROM THE BACKEND CATALOG, never a local constant: this is the exact
        // integer the server will check the payment against.
        amountHalalas: product.amount_halalas,
        currency: product.currency,
        description: isAr ? product.label_ar : product.label_en,
        callbackUrl: `${window.location.origin}/payment/callback`,
        // The server prices the payment from `reference` alone.
        metadata: { reference: product.reference },
        lang,
        // A credit-pack buyer did not ask us to keep their card. Saving one
        // is §5's subscribe flow, where it is the point of the transaction.
        saveCard: false,
        onFailure: () => {
          setError(
            isAr
              ? "لم تكتمل عملية الدفع. لم يتم خصم أي مبلغ، ويمكنك المحاولة مرة أخرى."
              : "The payment didn't go through. Nothing was charged — you can try again."
          );
        },
      });
      setFormReady(true);
    } catch {
      mountedRef.current = false;
      setError(
        isAr
          ? "تعذّر تحميل نموذج الدفع. تحقّق من اتصالك وحدّث الصفحة."
          : "The payment form couldn't load. Check your connection and refresh."
      );
    }
  }, [product, isAr, lang]);

  useEffect(() => {
    void mountForm();
  }, [mountForm]);

  /* ── Nothing valid selected ──────────────────────────────────────── */
  if (!reference) {
    return (
      <Shell dir={dir}>
        <Notice tone="warning">
          {isAr
            ? "لم يتم تحديد باقة. اختر باقة من صفحة الأسعار."
            : "No pack selected. Choose one from the pricing page."}
        </Notice>
        <BackLink isAr={isAr} Arrow={BackArrow} />
      </Shell>
    );
  }

  /* ── Subscriptions: not this page's job yet ──────────────────────── */
  if (isSubscription) {
    return (
      <Shell dir={dir}>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-600">
            <Clock className="size-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">
            {isAr ? "الاشتراكات الشهرية قريبًا" : "Monthly plans are coming soon"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {isAr
              ? "الاشتراك الشهري يتطلب حفظ البطاقة للتجديد التلقائي، وهذا الجزء قيد الإعداد. باقات النقاط متاحة الآن للشراء لمرة واحدة."
              : "A monthly plan needs your card saved for automatic renewal, and that part is still being set up. Credit packs are available now as a one-time purchase."}
          </p>
          <Link
            href="/dashboard/upgrade"
            className="mt-5 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {isAr ? "عرض باقات النقاط" : "See credit packs"}
          </Link>
        </div>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell dir={dir}>
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-20 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {isAr ? "جارٍ التحميل" : "Loading"}
        </div>
      </Shell>
    );
  }

  return (
    <Shell dir={dir}>
      <BackLink isAr={isAr} Arrow={BackArrow} />

      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {isAr ? "إتمام الشراء" : "Checkout"}
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          {isAr
            ? "تضاف النقاط إلى رصيدك فور تأكيد العملية."
            : "Your credits are added to your balance as soon as the payment clears."}
        </p>
      </header>

      {mode === "test" && (
        <Notice tone="warning">
          {isAr
            ? "وضع تجريبي: لن يتم خصم أي مبلغ حقيقي، ولا تستخدم بطاقة حقيقية."
            : "Test mode: no real money is charged. Do not enter a real card."}
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {product && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            {isAr ? "ملخص الطلب" : "Order summary"}
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-600">{isAr ? "الباقة" : "Pack"}</dt>
              <dd className="text-end font-medium text-slate-900">
                {isAr ? product.label_ar : product.label_en}
              </dd>
            </div>
            {product.credits !== null && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-600">{isAr ? "النقاط" : "Credits"}</dt>
                <dd className="text-end font-medium text-slate-900">
                  {/* Western digits in both languages — see localeFor(). */}
                  {product.credits}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2">
              <dt className="text-slate-600">{isAr ? "الإجمالي" : "Total"}</dt>
              <dd className="text-end">
                <span className="text-base font-semibold text-slate-900">
                  {formatSar(product.amount_sar, lang)}
                </span>
                {usdApprox(product.amount_sar) && (
                  <span className="block text-xs text-slate-500">
                    {usdApprox(product.amount_sar)}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* ── The card form ──────────────────────────────────────────────
          Moyasar renders into this node. It is LTR in both languages: card
          numbers, expiry and CVC are Latin-digit fields, and mirroring them
          under RTL puts the cursor and the digit order at odds. The labels
          inside are still Arabic — the form's own `language: "ar"`. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          {isAr ? "بيانات البطاقة" : "Card details"}
        </h2>
        <div className="mt-4" dir="ltr">
          <div id={formHostId} className="mysr-form" />
        </div>
        {!formReady && !error && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {isAr ? "جارٍ تحميل نموذج الدفع" : "Loading the payment form"}
          </div>
        )}
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-600">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {isAr
              ? "تتم معالجة الدفع عبر ميسر. بيانات بطاقتك لا تمر على خوادمنا ولا نحتفظ بها."
              : "Payment is processed by Moyasar. Your card details never reach our servers and we don't store them."}
          </span>
        </p>
      </section>
    </Shell>
  );
}

/* ── Small local pieces ─────────────────────────────────────────────── */

function Shell({ dir, children }: { dir: "rtl" | "ltr"; children: React.ReactNode }) {
  return (
    <div dir={dir} className="mx-auto w-full max-w-lg space-y-5 px-4 py-6 sm:px-0">
      {children}
    </div>
  );
}

function BackLink({ isAr, Arrow }: { isAr: boolean; Arrow: typeof ArrowLeft }) {
  return (
    <Link
      href="/dashboard/upgrade"
      className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      <Arrow className="size-4" aria-hidden />
      {isAr ? "رجوع" : "Back"}
    </Link>
  );
}

function Notice({ tone, children }: { tone: "warning" | "error"; children: React.ReactNode }) {
  const styles =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}
