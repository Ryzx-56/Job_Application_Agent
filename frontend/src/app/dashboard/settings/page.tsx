"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/language";
import { useAuth } from "@/lib/auth";
import { DashboardButton } from "@/components/dashboard";
import { createClient } from "@/lib/supabase/client";
import { fetchCredits, Tier } from "@/lib/supabase/credits";
import { updateLocation } from "@/lib/supabase/location";
import { SAUDI_CITIES, OTHER_CITY_VALUE } from "@/lib/saudi-cities";

const TIER_LABEL: Record<Tier, { en: string; ar: string }> = {
  free: { en: "Free", ar: "مجانية" },
  pro: { en: "Pro", ar: "برو" },
  elite: { en: "Elite", ar: "إيليت" },
};

export default function SettingsPage() {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const copy = t.dashboard.settings;
  const isAr = lang === "ar";
  const [languageJustSaved, setLanguageJustSaved] = useState(false);
  const [tier, setTier] = useState<Tier | null>(null);
  const [location, setLocation] = useState("");
  const [locationOther, setLocationOther] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationJustSaved, setLocationJustSaved] = useState(false);
  const [locationError, setLocationError] = useState("");

  useEffect(() => {
    fetchCredits()
      .then((c) => {
        setTier(c.tier);
        const known = SAUDI_CITIES.some((city) => city.value === c.location);
        if (c.location && known) {
          setLocation(c.location);
        } else if (c.location) {
          // A value that isn't in the curated list — e.g. free-text "Other"
          // from signup — show it under Other instead of silently dropping it.
          setLocation(OTHER_CITY_VALUE);
          setLocationOther(c.location);
        }
      })
      .catch((err) => console.error("fetchCredits failed:", err));
  }, []);

  async function handleLocationChange(newValue: string) {
    setLocationError("");
    setLocation(newValue);
    if (newValue === OTHER_CITY_VALUE) return; // wait for free-text entry before saving
    setLocationSaving(true);
    try {
      await updateLocation(newValue);
      setLocationJustSaved(true);
      setTimeout(() => setLocationJustSaved(false), 2500);
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocationSaving(false);
    }
  }

  async function handleOtherLocationSave() {
    if (!locationOther.trim()) return;
    setLocationError("");
    setLocationSaving(true);
    try {
      await updateLocation(locationOther.trim());
      setLocationJustSaved(true);
      setTimeout(() => setLocationJustSaved(false), 2500);
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocationSaving(false);
    }
  }

  const planDisplayName = tier ? TIER_LABEL[tier][isAr ? "ar" : "en"] : isAr ? "جارٍ التحميل…" : "Loading…";

  function handleLanguageChange(newLang: "en" | "ar") {
    if (newLang === lang) return;
    setLang(newLang);
    setLanguageJustSaved(true);
    setTimeout(() => setLanguageJustSaved(false), 2500);
  }

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";
  const email = user?.email ?? "";

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [passwordError, setPasswordError] = useState("");

  function resetPasswordForm() {
    setShowPasswordForm(false);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setPasswordStatus("idle");
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");

    if (newPassword.length < 8) {
      setPasswordError(isAr ? "يجب ألا تقل كلمة المرور عن 8 أحرف" : "Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(isAr ? "كلمتا المرور غير متطابقتين" : "Passwords don't match");
      return;
    }

    setPasswordStatus("saving");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setPasswordStatus("error");
      setPasswordError(error.message);
      return;
    }

    setPasswordStatus("success");
    setNewPassword("");
    setConfirmPassword("");
    setTimeout(resetPasswordForm, 2000);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

      {/* Account */}
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.accountSection}</h2>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{copy.nameLabel}</label>
          <input
            type="text"
            value={fullName}
            readOnly
            className="block w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{copy.emailLabel}</label>
          <input
            type="email"
            value={email}
            readOnly
            className="block w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600"
          />
        </div>
      </section>

      {/* Password */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.passwordSection}</h2>
          {!showPasswordForm && (
            <DashboardButton type="button" variant="outline" size="sm" onClick={() => setShowPasswordForm(true)}>
              {copy.changePassword}
            </DashboardButton>
          )}
        </div>

        {showPasswordForm && (
          <form onSubmit={handlePasswordSubmit} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {isAr ? "كلمة المرور الجديدة" : "New password"}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                className="block w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {isAr ? "تأكيد كلمة المرور" : "Confirm password"}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                className="block w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </div>

            {passwordError && <p className="text-sm text-rose-600">{passwordError}</p>}
            {passwordStatus === "success" && (
              <p className="text-sm text-emerald-600">{isAr ? "تم تحديث كلمة المرور" : "Password updated"}</p>
            )}

            <div className="flex gap-2">
              <DashboardButton type="submit" variant="primary" size="sm" disabled={passwordStatus === "saving"}>
                {passwordStatus === "saving" ? (isAr ? "جارٍ الحفظ..." : "Saving...") : isAr ? "حفظ" : "Save"}
              </DashboardButton>
              <DashboardButton type="button" variant="ghost" size="sm" onClick={resetPasswordForm}>
                {isAr ? "إلغاء" : "Cancel"}
              </DashboardButton>
            </div>
          </form>
        )}
      </section>

      {/* Subscription */}
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.planSection}</h2>
          <p className="mt-1.5 text-sm text-slate-700">
            {copy.planLabel}: <span className="font-medium text-slate-900">{planDisplayName}</span>
          </p>
        </div>
        <DashboardButton as={Link} href="/#pricing" variant="outline" size="sm">
          {copy.changePlan}
        </DashboardButton>
      </section>

      {/* Language */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.languageSection}</h2>
        <p className="mb-3 text-sm text-slate-500">{copy.languageLabel}</p>

        <div className="flex items-center gap-2">
          <DashboardButton
            type="button"
            variant={lang === "en" ? "primary" : "outline"}
            size="sm"
            onClick={() => handleLanguageChange("en")}
          >
            English
          </DashboardButton>
          <DashboardButton
            type="button"
            variant={lang === "ar" ? "primary" : "outline"}
            size="sm"
            onClick={() => handleLanguageChange("ar")}
          >
            العربية
          </DashboardButton>
        </div>

        {languageJustSaved && (
          <p className="mt-2.5 text-sm text-emerald-600">{copy.languageSaved}</p>
        )}
      </section>

      {/* Location */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {isAr ? "الموقع" : "Location"}
        </h2>
        <p className="mb-3 text-sm text-slate-500">
          {isAr
            ? "نستخدم هذا لعرض وظائف مناسبة لموقعك إذا لم تذكر سيرتك الذاتية موقعًا."
            : "We use this to show you relevant job openings if your CV doesn't mention a location."}
        </p>

        <select
          value={location}
          onChange={(e) => handleLocationChange(e.target.value)}
          disabled={locationSaving}
          className="block w-full max-w-xs rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
        >
          <option value="" disabled>
            {isAr ? "اختر مدينتك" : "Select your city"}
          </option>
          {SAUDI_CITIES.map((city) => (
            <option key={city.value} value={city.value}>
              {isAr ? city.ar : city.en}
            </option>
          ))}
          <option value={OTHER_CITY_VALUE}>{isAr ? "أخرى" : "Other"}</option>
        </select>

        {location === OTHER_CITY_VALUE && (
          <div className="mt-2.5 flex max-w-xs gap-2">
            <input
              type="text"
              value={locationOther}
              onChange={(e) => setLocationOther(e.target.value)}
              placeholder={isAr ? "اكتب مدينتك" : "Type your city"}
              className="block w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
            <DashboardButton
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOtherLocationSave}
              disabled={locationSaving || !locationOther.trim()}
            >
              {isAr ? "حفظ" : "Save"}
            </DashboardButton>
          </div>
        )}

        {locationError && <p className="mt-2.5 text-sm text-rose-600">{locationError}</p>}
        {locationJustSaved && (
          <p className="mt-2.5 text-sm text-emerald-600">{isAr ? "تم حفظ الموقع" : "Location saved"}</p>
        )}
      </section>
    </div>
  );
}
