"use client";

import { useState } from "react";
import { cancelSubscription } from "@/lib/subscription";

/* ========================================================================
   "Cancel subscription" — the words, in red, underlined, and nothing else.

   DELIBERATELY NOT A BUTTON. Cancelling is not an action this product
   should compete for: it belongs in plain sight so nobody has to hunt for
   it or email us to get out, but giving it a border and a filled background
   would make it the loudest thing in a card whose subject is the plan the
   customer is happily paying for. Text at meta size, in red, underlined,
   with a real focus ring is findable without being shouted.

   Used by /dashboard/upgrade and /dashboard/settings so the two surfaces
   cannot drift apart. The public /pricing page has its own copy of this
   flow against a dark editorial surface and is intentionally left alone.

   NOTHING IS CHARGED OR LOST HERE. The backend schedules the downgrade for
   the end of the period already paid for; resumeSubscription() undoes it
   until then, which is what the confirm text promises.
======================================================================== */
export function CancelSubscriptionLink({
  isAr,
  onCancelled,
  className = "",
}: {
  isAr: boolean;
  /** Called after the backend accepts, so the parent can show the pending
   *  state without refetching. */
  onCancelled: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = isAr
    ? {
        link: "إلغاء الاشتراك",
        title: "تأكيد إلغاء الاشتراك",
        body: "ستحتفظ بخطتك ورصيدك حتى نهاية الدورة الحالية التي دفعت مقابلها، ثم تنتقل إلى الخطة المجانية. يمكنك التراجع قبل ذلك.",
        confirm: "نعم، ألغِ الاشتراك",
        dismiss: "تراجع",
        failed: "تعذّر إلغاء الاشتراك. حاول مرة أخرى.",
      }
    : {
        link: "Cancel subscription",
        title: "Confirm cancellation",
        body: "You keep your plan and your credits until the end of the cycle you've already paid for, then move to the Free plan. You can undo this before then.",
        confirm: "Yes, cancel",
        dismiss: "Never mind",
        failed: "Couldn't cancel the subscription. Please try again.",
      };

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await cancelSubscription();
      setConfirming(false);
      onCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className={`rounded text-sm text-red-600 underline underline-offset-4 transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 ${className}`}
      >
        {copy.link}
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={copy.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            dir={isAr ? "rtl" : "ltr"}
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">{copy.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.body}</p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                {busy ? "…" : copy.confirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {copy.dismiss}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
