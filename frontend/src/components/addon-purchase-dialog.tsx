"use client";

import { enCount, arCount } from "@/lib/pricing";

const AR_POINTS = { one: "نقطة واحدة", two: "نقطتان", few: "نقاط", many: "نقطة" };

/* ========================================================================
   ADD-ON PURCHASE CONFIRMATION — shared by the three credit-purchasable
   add-ons (Job Search, Interview Prep, LinkedIn Essential).

   2026-09-12/13: begin_addon_use() (backend/core/entitlements.py) returns a
   402 `addon_purchase_available` once a tier's monthly baseline for one of
   these three is used up, naming the add-on, its exact credit cost, and the
   caller's current balance — and does NOT spend anything until the caller
   resubmits with confirmed_purchase (spend_credits) = true. This dialog is
   the one place that confirmation happens: a real dialog, not a toast or an
   inline banner, because spending credits is closer to "cancel subscription"
   than to "here's an error" — see cancel-subscription.tsx for the same
   shape (light dashboard theme, confirm/dismiss, busy-disabled, click-
   outside-to-dismiss guarded by !busy).

   ONE COMPONENT, THREE CALLERS. Each page owns its own addon's display name
   (only that page knows whether to say "Job Search", "Interview Prep" or
   "LinkedIn Essential") and its own resubmit logic (each of
   core/documents.py, core/job_search.py, core/interview.py and
   core/linkedin.py takes the confirmation as `spend_credits` — verified in
   all four, not assumed). This component owns only the confirmation UI
   itself, built from the exact numbers the 402 response carried, so the
   sentence can never say a different price than what will actually be
   charged.

   ON CANCEL: nothing is sent. No partial action, no credits touched — this
   matches what the backend already guarantees (begin_addon_use never spends
   without confirmed_purchase=true), so cancelling here has nothing left to
   undo.
======================================================================== */
export function AddonPurchaseDialog({
  open,
  isAr,
  addonLabel,
  creditCost,
  creditBalance,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  isAr: boolean;
  /** This add-on's display name, in the caller's own language — "Job
   *  Search", "Interview Prep", "LinkedIn Essential" (or their Arabic
   *  equivalents). Not derived from the backend's `addon` slug on purpose:
   *  only the calling page knows the right display string for its own
   *  feature. */
  addonLabel: string;
  /** From the 402's `credit_cost`. */
  creditCost: number;
  /** From the 402's `credit_balance` — the balance AT THE TIME the 402 was
   *  raised, not re-fetched, so the dialog states exactly what the backend
   *  just told the caller rather than a number that could have moved. */
  creditBalance: number;
  /** Disables both buttons and shows a spinner label while the confirmed
   *  request is in flight. */
  busy?: boolean;
  /** A failure from the CONFIRMED attempt (e.g. insufficient_credits if the
   *  balance moved between the 402 and the confirm, or the feature itself
   *  failing after payment was accepted) — shown inside the dialog rather
   *  than closing it, so retrying doesn't require reopening it. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const copy = isAr
    ? {
        title: "استخدام رصيدك",
        question: `استخدم ${arCount(creditCost, AR_POINTS)} لـ${addonLabel} إضافية؟ لديك ${arCount(creditBalance, AR_POINTS)}.`,
        confirm: "نعم، استخدم رصيدي",
        confirmBusy: "جارٍ التنفيذ…",
        cancel: "إلغاء",
      }
    : {
        title: "Use your credits",
        question: `Use ${enCount(creditCost, "credit")} for another ${addonLabel}? You have ${enCount(creditBalance, "credit")}.`,
        confirm: "Yes, use credits",
        confirmBusy: "Working…",
        cancel: "Cancel",
      };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">{copy.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.question}</p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {busy ? copy.confirmBusy : copy.confirm}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {copy.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
