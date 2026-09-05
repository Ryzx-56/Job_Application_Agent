"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { deleteAccount } from "@/lib/account";
import { signOut } from "@/lib/auth";

/* ========================================================================
   DELETE ACCOUNT — the only irreversible control in the product.

   Everything here is shaped by that. The button is red and it is last, so
   it is never adjacent to something routine. The dialog lists what is
   actually lost rather than asking "are you sure?", because the person
   clicking has no way to know what the account contains that they might
   still want. And the confirm button is dead for five seconds.

   THE COOLDOWN IS NOT A SPEED BUMP FOR ITS OWN SAKE. The failure mode it
   exists for is the frustrated double-click: someone opens this dialog
   while already angry at something, and a confirm button under the cursor
   at the moment the dialog paints is a deletion that happens before the
   sentence explaining it has been read. Five seconds is roughly how long
   the list below takes to read, which is the point.
======================================================================== */

const COOLDOWN_SECONDS = 5;

export function DeleteAccountSection({ isAr, hasSubscription }: { isAr: boolean; hasSubscription: boolean }) {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState(COOLDOWN_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // The countdown runs only while the dialog is open, and restarts every
  // time it opens — closing and reopening does not bank the wait.
  useEffect(() => {
    if (!open) return;
    setRemaining(COOLDOWN_SECONDS);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  // Escape closes it, and focus starts inside the dialog rather than on the
  // page behind it. Not while deleting: there is nothing to go back to.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const copy = isAr
    ? {
        section: "حذف الحساب",
        lead: "حذف الحساب نهائي. لا يمكن التراجع عنه ولا استعادة أي من محتوياته لاحقًا.",
        button: "حذف الحساب",
        title: "سيتم حذف حسابك نهائيًا",
        intro: "سيُحذف ما يلي فورًا وبلا رجعة:",
        items: [
          "الدخول إلى حسابك — ستحتاج إلى إنشاء حساب جديد لاستخدام المنصة مرة أخرى.",
          "رصيدك الحالي، بما فيه أي نقاط اشتريتها ولم تستخدمها. لا تُسترد قيمتها.",
          "كل السير الذاتية وخطابات التقديم التي أنشأتها، وسجلها بالكامل.",
          "ملفك الشخصي، وبياناتك، وملفات لينكدإن وتحضيرات المقابلات المرتبطة بحسابك.",
        ],
        subscription: "سيتم إلغاء اشتراكك الحالي فورًا، ولن تُخصم منك أي مبالغ بعد ذلك. الفترة التي دفعت مقابلها لا تُسترد.",
        reuse: "يمكنك التسجيل بالبريد نفسه لاحقًا، لكن دون النقاط المجانية المخصصة للحسابات الجديدة.",
        confirm: "حذف حسابي نهائيًا",
        waiting: (n: number) => `حذف حسابي نهائيًا (${n})`,
        dismiss: "إلغاء",
        failed: "تعذّر حذف الحساب. حاول مرة أخرى.",
      }
    : {
        section: "Delete account",
        lead: "Deleting your account is permanent. It cannot be undone and nothing can be recovered afterwards.",
        button: "Delete Account",
        title: "Your account will be permanently deleted",
        intro: "The following is deleted immediately and cannot be restored:",
        items: [
          "Access to your account — you'd need to sign up again to use the product.",
          "Your current credits, including any you bought and haven't used. These are not refunded.",
          "Every CV and cover letter you've generated, and your full history.",
          "Your profile, your details, and any LinkedIn profiles and interview prep tied to the account.",
        ],
        subscription: "Your subscription is cancelled immediately and your card will not be charged again. The period you've already paid for is not refunded.",
        reuse: "You can sign up again later with the same email, but without the free credits given to new accounts.",
        confirm: "Permanently delete my account",
        waiting: (n: number) => `Permanently delete my account (${n})`,
        dismiss: "Cancel",
        failed: "Couldn't delete the account. Please try again.",
      };

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // The account is gone; the session must go with it.
      await signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failed);
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-red-700">
        {copy.section}
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-slate-600">{copy.lead}</p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
      >
        {copy.button}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-6"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            dir={isAr ? "rtl" : "ltr"}
            className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600">
                <AlertTriangle className="size-4.5" aria-hidden />
              </span>
              <h3 id="delete-account-title" className="mt-1 text-base font-semibold text-slate-900">
                {copy.title}
              </h3>
            </div>

            <p className="mt-4 text-sm text-slate-700">{copy.intro}</p>
            <ul className="mt-2 space-y-1.5 ps-5 text-sm leading-relaxed text-slate-600">
              {copy.items.map((item) => (
                <li key={item} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>

            {/* Only shown to someone who actually has one — telling a Free
                user their subscription is being cancelled is confusing at
                the exact moment they need to be reading carefully. */}
            {hasSubscription && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
                {copy.subscription}
              </p>
            )}

            <p className="mt-3 text-xs leading-relaxed text-slate-500">{copy.reuse}</p>

            {error && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy || remaining > 0}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                {busy ? "…" : remaining > 0 ? copy.waiting(remaining) : copy.confirm}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {copy.dismiss}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
