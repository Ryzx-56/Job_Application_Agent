"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useLang } from "@/lib/language";
import { verifyPayment, type VerifyResult } from "@/lib/payments";

/* ========================================================================
   /payment/callback — where Moyasar returns the buyer after a card payment.

   THIS PAGE IS NOT WHAT GRANTS ANYTHING. It asks the backend what happened
   and says so. The credits are granted server-side, driven by Moyasar's
   webhook (§4), which fires whether or not the buyer ever gets back here.

   Which is the case worth designing for: on mobile — most of this product's
   traffic — a 3-D Secure step hands control to the bank's app or a new tab,
   and people routinely never return to the original one. That buyer is still
   charged and still gets their credits. If this page never loads, nothing is
   lost; it exists so the buyer who DOES come back gets an answer immediately
   instead of staring at a dashboard wondering whether it worked.

   It is deliberately outside /[lang]: the callback URL is registered with
   Moyasar and baked into payments already in flight, so it must not depend on
   a locale segment. The language comes from the cookie, like the rest of the
   dashboard.
======================================================================== */

/** How long the "all done" screen sits before moving the buyer along. */
const REDIRECT_DELAY_MS = 4000;

export default function PaymentCallbackPage() {
  return (
    // useSearchParams needs a Suspense boundary to avoid opting the whole
    // route into client-side rendering at build time.
    <Suspense fallback={null}>
      <PaymentCallback />
    </Suspense>
  );
}

function PaymentCallback() {
  const { lang, dir } = useLang();
  const isAr = lang === "ar";
  const params = useSearchParams();
  const router = useRouter();

  // Moyasar appends these to the callback URL.
  const paymentId = params.get("id");
  const statusParam = params.get("status");
  const providerMessage = params.get("message");

  const [state, setState] = useState<"checking" | "done" | "error">("checking");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const askedRef = useRef(false);

  useEffect(() => {
    if (askedRef.current) return;
    askedRef.current = true;

    if (!paymentId) {
      setState("error");
      return;
    }

    verifyPayment(paymentId)
      .then((r) => {
        setResult(r);
        setState("done");
      })
      .catch(() => {
        // A failed verify does NOT mean a failed payment — the webhook is the
        // authority and may not have landed yet. Say so honestly rather than
        // telling someone whose card was charged that it failed.
        setState("error");
      });
  }, [paymentId]);

  /* Move the buyer along once they've read the outcome. Not on the error
     state: that one asks them to check their balance, so it stays put. */
  useEffect(() => {
    if (state !== "done") return;
    const paid = result?.status === "paid";
    const timer = setTimeout(
      () => router.push(paid ? "/dashboard" : "/dashboard/upgrade"),
      REDIRECT_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [state, result, router]);

  const failedAtProvider = statusParam && statusParam !== "paid";

  return (
    <div dir={dir} className="mx-auto flex w-full max-w-md flex-col px-4 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center sm:p-8">
        {/* ── Still asking ── */}
        {state === "checking" && (
          <>
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-600">
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">
              {isAr ? "جارٍ تأكيد عملية الدفع" : "Confirming your payment"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {isAr ? "لحظات من فضلك." : "This will only take a moment."}
            </p>
          </>
        )}

        {/* ── Paid ── */}
        {state === "done" && result?.status === "paid" && (
          <>
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="size-5" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">
              {isAr ? "تم استلام دفعتك" : "Payment received"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {result.credits_granted
                ? isAr
                  ? `أضيفت ${result.credits_granted} نقاط إلى رصيدك.`
                  : `${result.credits_granted} credits have been added to your balance.`
                : isAr
                  ? "تم تأكيد عملية الشراء."
                  : "Your purchase is confirmed."}
            </p>
          </>
        )}

        {/* ── Not paid: declined, cancelled, or a failed 3-D Secure step ── */}
        {state === "done" && result?.status === "failed" && (
          <>
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-red-50 text-red-700">
              <AlertCircle className="size-5" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">
              {isAr ? "لم تكتمل عملية الدفع" : "The payment didn't go through"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {isAr
                ? "لم يتم خصم أي مبلغ من بطاقتك. يمكنك المحاولة مرة أخرى أو استخدام بطاقة أخرى."
                : "Nothing was charged to your card. You can try again, or use a different card."}
            </p>
            {providerMessage && (
              // Straight from the provider, so it can be Latin text under an
              // Arabic UI. Pinned LTR so it doesn't render reversed.
              <p dir="ltr" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {providerMessage}
              </p>
            )}
          </>
        )}

        {/* ── Authorised but not settled yet ── */}
        {state === "done" && result?.status === "pending" && (
          <>
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-amber-50 text-amber-800">
              <Clock className="size-5" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">
              {isAr ? "دفعتك قيد المعالجة" : "Your payment is being processed"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {isAr
                ? "سنضيف النقاط إلى رصيدك تلقائيًا فور تأكيد العملية. لا حاجة للدفع مرة أخرى."
                : "We'll add the credits to your balance automatically once it clears. There's no need to pay again."}
            </p>
          </>
        )}

        {/* ── We couldn't ask, or there was no payment id ── */}
        {state === "error" && (
          <>
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-amber-50 text-amber-800">
              <Clock className="size-5" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">
              {failedAtProvider
                ? isAr
                  ? "لم تكتمل عملية الدفع"
                  : "The payment didn't go through"
                : isAr
                  ? "تعذّر تأكيد العملية الآن"
                  : "We couldn't confirm this just yet"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {failedAtProvider
                ? isAr
                  ? "لم يتم خصم أي مبلغ من بطاقتك."
                  : "Nothing was charged to your card."
                : isAr
                  ? "إذا تمت العملية بنجاح فستظهر النقاط في رصيدك خلال دقائق. لا تدفع مرة أخرى — تواصل معنا إذا لم تظهر."
                  : "If it went through, your credits will appear in your balance within a few minutes. Please don't pay again — contact us if they don't show up."}
            </p>
          </>
        )}

        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {isAr ? "العودة للوحة التحكم" : "Back to dashboard"}
        </Link>
      </div>
    </div>
  );
}
