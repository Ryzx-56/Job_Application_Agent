"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useLang } from "@/lib/language";

const PLAN_NAME: Record<string, { en: string; ar: string }> = {
  pro: { en: "Pro", ar: "برو" },
  elite: { en: "Elite", ar: "إيليت" },
};

/**
 * Placeholder for the logged-in upgrade flow. Reached from the pricing
 * section's "Upgrade" buttons once a tier is picked. Swap the body of this
 * page for real Moyasar checkout when that's wired up — the route and the
 * links pointing to it (`/dashboard/checkout?plan=pro` etc.) don't need to
 * change.
 */
export default function CheckoutPage() {
  const { lang } = useLang();
  const isAr = lang === "ar";
  const params = useSearchParams();
  const plan = params.get("plan") ?? "pro";
  const planLabel = PLAN_NAME[plan]?.[isAr ? "ar" : "en"] ?? plan;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center space-y-4 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
        <Sparkles className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold text-slate-900">
        {isAr ? `الترقية إلى ${planLabel} قريبًا` : `Upgrading to ${planLabel} — coming soon`}
      </h1>
      <p className="text-sm leading-relaxed text-slate-500">
        {isAr
          ? "الدفع عبر ميسر قيد الإعداد حاليًا. سيتم تفعيل هذه الصفحة قريبًا لإتمام الاشتراك مباشرة."
          : "Payment via Moyasar is being set up. This page will handle the real checkout soon."}
      </p>
      <Link
        href="/dashboard"
        className="mt-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
      >
        {isAr ? "العودة للوحة التحكم" : "Back to dashboard"}
      </Link>
    </div>
  );
}
