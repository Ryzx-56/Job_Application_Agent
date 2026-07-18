"use client";

// Update this import path to wherever your LangProvider/useLang actually
// lives in your project (you called the file language.tsx — likely
// "@/lib/language" or "@/context/language").
import { useLang } from "@/lib/language";
import { useEffect, useState } from "react";
import { COOKIE_CONSENT_KEY, updateConsent } from "@/lib/analytics";

const copy = {
  en: {
    title: "We use cookies",
    body: "We use essential cookies to keep you signed in and remember your language, and — only with your permission — Google Analytics to understand how Tarshih is used. See our ",
    privacyLink: "Privacy Policy",
    accept: "Accept",
    reject: "Reject",
    manage: "Manage",
    manageTitle: "Manage cookie preferences",
    essential: "Essential",
    essentialBadge: "Always on",
    essentialDesc: "Keeps you signed in and remembers your language. Required — cannot be turned off.",
    analytics: "Analytics",
    analyticsDesc: "Google Analytics. Helps us understand usage and improve Tarshih. Optional.",
    save: "Save preferences",
    back: "Back",
  },
  ar: {
    title: "نستخدم ملفات تعريف الارتباط",
    body: "نستخدم ملفات تعريف ارتباط أساسية للحفاظ على تسجيل دخولك وتذكّر لغتك، وفقط بموافقتك، نستخدم Google Analytics لفهم كيفية استخدام ترشيح. اطّلع على ",
    privacyLink: "سياسة الخصوصية",
    accept: "قبول",
    reject: "رفض",
    manage: "إدارة",
    manageTitle: "إدارة تفضيلات ملفات تعريف الارتباط",
    essential: "أساسية",
    essentialBadge: "مفعّلة دائمًا",
    essentialDesc: "تحافظ على تسجيل دخولك وتتذكّر لغتك. مطلوبة — لا يمكن إيقافها.",
    analytics: "تحليلات",
    analyticsDesc: "Google Analytics. تساعدنا على فهم الاستخدام وتحسين ترشيح. اختيارية.",
    save: "حفظ التفضيلات",
    back: "رجوع",
  },
} as const;

export default function CookieConsent({ onOpenPrivacy }: { onOpenPrivacy?: () => void }) {
  const { lang, isRTL } = useLang();
  const t = copy[lang as "en" | "ar"] ?? copy.en;

  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(false);

  // Only show if the user hasn't made a choice yet on this device.
  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!stored) setVisible(true);
  }, []);

  function persist(state: "granted" | "denied") {
    localStorage.setItem(COOKIE_CONSENT_KEY, state);
    updateConsent(state);
    setVisible(false);
    setManaging(false);
  }

  if (!visible) return null;

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-[70] p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-xl shadow-black/30 backdrop-blur-xl">
        {!managing ? (
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="max-w-xl">
              <p id="cookie-consent-title" className="text-sm font-semibold text-white">
                {t.title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                {t.body}
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                >
                  {t.privacyLink}
                </button>
                .
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setManaging(true)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.manage}
              </button>
              <button
                type="button"
                onClick={() => persist("denied")}
                className="rounded-lg border border-white/10 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.reject}
              </button>
              <button
                type="button"
                onClick={() => persist("granted")}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.accept}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 sm:p-6">
            <p className="text-sm font-semibold text-white">{t.manageTitle}</p>

            <div className="mt-4 space-y-3">
              <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-3.5">
                <div>
                  <p className="text-sm font-medium text-white">{t.essential}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">{t.essentialDesc}</p>
                </div>
                <span className="mt-0.5 shrink-0 rounded-full bg-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                  {t.essentialBadge}
                </span>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-3.5">
                <div>
                  <p className="text-sm font-medium text-white">{t.analytics}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">{t.analyticsDesc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={analyticsOn}
                  onClick={() => setAnalyticsOn((v) => !v)}
                  className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
                    analyticsOn ? "justify-end bg-blue-600" : "justify-start bg-zinc-700"
                  }`}
                >
                  <span className="h-5 w-5 rounded-full bg-white transition-transform" />
                </button>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setManaging(false)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.back}
              </button>
              <button
                type="button"
                onClick={() => persist(analyticsOn ? "granted" : "denied")}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.save}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
