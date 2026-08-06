"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/language";
import { useAuth } from "@/lib/auth";
import { DashboardButton } from "@/components/dashboard";
import { createClient } from "@/lib/supabase/client";
import { fetchCredits, Tier } from "@/lib/supabase/credits";
import { updateLocation } from "@/lib/supabase/location";
import { getCountryList, getCitiesForCountry, formatLocation, parseLocation, OTHER_CITY_VALUE, CountryOption, CityOption } from "@/lib/countries";
import { SearchableSelect } from "@/components/searchable-select";
import { LegalModal } from "@/components/legal-modal";
import { legalContent, LegalDocKey } from "@/lib/legal-content";

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
  const [countryIso, setCountryIso] = useState("SA");
  const [city, setCity] = useState("");
  const [locationOther, setLocationOther] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationJustSaved, setLocationJustSaved] = useState(false);
  const [locationError, setLocationError] = useState("");
  const initialLocationRef = useRef<string>("");
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);

  const countryOptions: CountryOption[] = useMemo(() => getCountryList(isAr ? "ar" : "en"), [isAr]);
  const cityOptions: CityOption[] = useMemo(
    () => (countryIso ? getCitiesForCountry(countryIso, isAr ? "ar" : "en") : []),
    [countryIso, isAr]
  );

  useEffect(() => {
    fetchCredits()
      .then((c) => {
        setTier(c.tier);
        if (!c.location) return;

        const parsed = parseLocation(c.location);
        if (parsed) {
          setCountryIso(parsed.countryIso);
          setCity(parsed.city);
          initialLocationRef.current = parsed.city;
        } else {
          // Doesn't parse as a recognized "City, Country" — e.g. free-text
          // "Other" entered at signup. Show it under Other rather than
          // silently dropping it or guessing at a country.
          setCity(OTHER_CITY_VALUE);
          setLocationOther(c.location);
          initialLocationRef.current = OTHER_CITY_VALUE;
        }
      })
      .catch((err) => console.error("fetchCredits failed:", err));
  }, []);

  async function handleSaveLocation() {
    if (!city) return;
    const resolved = city === OTHER_CITY_VALUE ? locationOther.trim() : formatLocation(city, countryIso);
    if (!resolved) return; // "Other" picked but no text typed yet

    setLocationError("");
    setLocationSaving(true);
    try {
      await updateLocation(resolved);
      initialLocationRef.current = city;
      setLocationJustSaved(true);
      setTimeout(() => setLocationJustSaved(false), 2500);
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocationSaving(false);
    }
  }

  function handleCountryChange(newIso: string) {
    setCountryIso(newIso);
    setCity(""); // previous city no longer applies under the new country — pick a new one before saving
  }

  function handleCityChange(newCity: string) {
    setCity(newCity);
    // No auto-save here — this only updates the dropdowns. Nothing is
    // written to the database until the Save button below is clicked.
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

        <div className="flex max-w-md gap-2">
          <div className="w-1/2">
            <SearchableSelect
              theme="light"
              dir={isAr ? "rtl" : "ltr"}
              value={countryIso}
              onChange={handleCountryChange}
              options={countryOptions.map((c) => ({ value: c.isoCode, label: c.name }))}
              placeholder={isAr ? "اختر دولتك" : "Select your country"}
              searchPlaceholder={isAr ? "ابحث..." : "Search..."}
              noResultsLabel={isAr ? "لا توجد نتائج" : "No results"}
              disabled={locationSaving}
            />
          </div>

          <div className="w-1/2">
            <SearchableSelect
              theme="light"
              dir={isAr ? "rtl" : "ltr"}
              value={city}
              onChange={handleCityChange}
              options={[...cityOptions, { value: OTHER_CITY_VALUE, label: isAr ? "أخرى" : "Other" }]}
              placeholder={isAr ? "اختر مدينتك" : "Select your city"}
              searchPlaceholder={isAr ? "ابحث..." : "Search..."}
              noResultsLabel={isAr ? "لا توجد نتائج" : "No results"}
              disabled={locationSaving}
              dropUp
            />
          </div>
        </div>

        {city === OTHER_CITY_VALUE && (
          <input
            type="text"
            value={locationOther}
            onChange={(e) => setLocationOther(e.target.value)}
            placeholder={isAr ? "اكتب مدينتك" : "Type your city"}
            className="mt-2.5 block w-full max-w-xs rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        )}

        <div className="mt-3">
          <DashboardButton
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSaveLocation}
            disabled={
              locationSaving ||
              !city ||
              (city === OTHER_CITY_VALUE && !locationOther.trim()) ||
              city === initialLocationRef.current
            }
          >
            {locationSaving ? (isAr ? "جارٍ الحفظ..." : "Saving...") : isAr ? "حفظ الموقع" : "Save location"}
          </DashboardButton>
        </div>

        {locationError && (
          <p className="mt-2.5 text-sm text-rose-600">
            {locationError.toLowerCase().includes("not found")
              ? isAr
                ? "تعذّر الحفظ حاليًا (خطأ في الخادم) — يرجى المحاولة لاحقًا"
                : "Couldn't save right now (server error) — please try again later"
              : locationError}
          </p>
        )}
        {locationJustSaved && (
          <p className="mt-2.5 text-sm text-emerald-600">{isAr ? "تم حفظ الموقع" : "Location saved"}</p>
        )}
      </section>

      {/* Legal — compact links only, not the full marketing footer. See
          note below on why this lives here and not on every dashboard page. */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 pb-2 pt-1 text-xs text-slate-400">
        <Link href="/terms" className="rounded transition-colors hover:text-slate-600">
          {isAr ? "الشروط والأحكام" : "Terms & Conditions"}
        </Link>
        <Link href="/privacy" className="rounded transition-colors hover:text-slate-600">
          {isAr ? "سياسة الخصوصية" : "Privacy Policy"}
        </Link>
        <Link href="/security" className="rounded transition-colors hover:text-slate-600">
          {isAr ? "الأمان" : "Security"}
        </Link>
        <Link href="/refund-policy" className="rounded transition-colors hover:text-slate-600">
          {isAr ? "سياسة الاسترداد والاستبدال" : "Refund & Exchange Policy"}
        </Link>
        <button type="button" onClick={() => setOpenDoc("contact")} className="rounded transition-colors hover:text-slate-600">
          {isAr ? "تواصل معنا" : "Contact"}
        </button>
      </div>

      <LegalModal
        doc={openDoc ? legalContent[lang][openDoc] : null}
        open={openDoc !== null}
        onClose={() => setOpenDoc(null)}
        isRTL={isAr}
      />
    </div>
  );
}
