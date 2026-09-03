"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/language";
import { useAuth } from "@/lib/auth";
import { DashboardButton } from "@/components/dashboard";
import { createClient } from "@/lib/supabase/client";
import { passwordErrorKey } from "@/lib/auth-errors";
import { fetchCredits, Tier } from "@/lib/supabase/credits";
import {
  fetchSavedCard,
  removeSavedCard,
  resumeSubscription,
  type SavedCard,
} from "@/lib/subscription";
import { formatMediumDate } from "@/lib/pricing";
import { updateLocation } from "@/lib/supabase/location";
import { fetchProfileNames, updateProfileNames, fetchAdminStatus, fetchBadges } from "@/lib/supabase/profile-names";
import { isPasswordBreached } from "@/lib/pwned-password";
import { RoleBadges, BadgeKey } from "@/components/badges";
import { getCountryList, getCitiesForCountry, formatLocation, parseLocation, OTHER_CITY_VALUE, CountryOption, CityOption } from "@/lib/countries";
import { SearchableSelect } from "@/components/searchable-select";
import { LegalModal } from "@/components/legal-modal";
import { CancelSubscriptionLink } from "@/components/cancel-subscription";
import { legalContent, LegalDocKey } from "@/lib/legal-content";

const TIER_LABEL: Record<Tier, { en: string; ar: string }> = {
  free: { en: "Free", ar: "مجانية" },
  pro: { en: "Pro", ar: "برو" },
  elite: { en: "Elite", ar: "إيليت" },
};

const PLAN_LABEL_EN: Record<string, string> = { free: "Free", pro: "Pro", elite: "Elite" };
const PLAN_LABEL_AR: Record<string, string> = { free: "المجانية", pro: "برو", elite: "إيليت" };

export default function SettingsPage() {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const copy = t.dashboard.settings;
  const isAr = lang === "ar";
  const [languageJustSaved, setLanguageJustSaved] = useState(false);
  const [tier, setTier] = useState<Tier | null>(null);
  // Billing state (§5). pendingTier is what the account switches to at the
  // next renewal; resetAt is when that happens.
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [card, setCard] = useState<SavedCard | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  // Drives the Admin badge here. The Admin *nav link* lives in the sidebar
  // (see useNavItems in components/dashboard.tsx). Both are convenience
  // only, never a security boundary: the admin endpoints check
  // profiles.is_admin server-side on every request, so hiding either stops
  // nothing and showing either grants nothing. Users have SELECT-only RLS
  // on profiles, so this flag can't be set by the person it describes.
  const [isAdmin, setIsAdmin] = useState(false);
  const [badges, setBadges] = useState<BadgeKey[]>([]);
  const [badgeFoundingNumber, setBadgeFoundingNumber] = useState<number | null>(null);
  const [isFoundingMember, setIsFoundingMember] = useState(false);
  const [foundingMemberNumber, setFoundingMemberNumber] = useState<number | null>(null);
  const [countryIso, setCountryIso] = useState("SA");
  const [city, setCity] = useState("");
  const [locationOther, setLocationOther] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationJustSaved, setLocationJustSaved] = useState(false);
  const [locationError, setLocationError] = useState("");
  const initialLocationRef = useRef<string>("");
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);

  // Both name scripts, editable any time — not just at registration.
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [namesSaving, setNamesSaving] = useState(false);
  const [namesJustSaved, setNamesJustSaved] = useState(false);
  const [namesError, setNamesError] = useState("");

  const countryOptions: CountryOption[] = useMemo(() => getCountryList(isAr ? "ar" : "en"), [isAr]);
  const cityOptions: CityOption[] = useMemo(
    () => (countryIso ? getCitiesForCountry(countryIso, isAr ? "ar" : "en") : []),
    [countryIso, isAr]
  );

  // The saved card, for the billing section. Failing to load it must not
  // break settings — the section simply does not render.
  useEffect(() => {
    let cancelled = false;
    fetchSavedCard()
      .then((c) => { if (!cancelled) setCard(c); })
      .catch(() => { if (!cancelled) setCard(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetchCredits()
      .then((c) => {
        setTier(c.tier);
        setPendingTier(c.pendingTier);
        setResetAt(c.creditsResetAt);
        setIsFoundingMember(c.isFoundingMember);
        setFoundingMemberNumber(c.foundingMemberNumber);
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

    // Separate call from fetchCredits on purpose — see fetchAdminStatus.
    fetchAdminStatus().then(({ isAdmin: admin }) => setIsAdmin(admin));

    fetchBadges().then((b) => {
      setBadges(b.badges as BadgeKey[]);
      setBadgeFoundingNumber(b.founding_member_number);
    });

    fetchProfileNames()
      .then((n) => {
        setNameEn(n.nameEn ?? "");
        setNameAr(n.nameAr ?? "");
      })
      .catch((err) => console.error("fetchProfileNames failed:", err));
  }, []);

  async function handleSaveNames() {
    // Mirrors the backend rule: at least one, never both required.
    if (!nameEn.trim() && !nameAr.trim()) {
      setNamesError(copy.nameAtLeastOne);
      return;
    }
    setNamesError("");
    setNamesSaving(true);
    try {
      // Both sent explicitly (empty string, not null) so clearing a field
      // here actually clears it — updateProfileNames treats null/undefined
      // as "leave unchanged".
      await updateProfileNames({ nameEn: nameEn.trim(), nameAr: nameAr.trim() });
      setNamesJustSaved(true);
      setTimeout(() => setNamesJustSaved(false), 2500);
    } catch (err) {
      setNamesError(err instanceof Error ? err.message : String(err));
    } finally {
      setNamesSaving(false);
    }
  }

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

  // full_name is no longer read here — the Account section now edits
  // profiles.name_en / name_ar directly (see handleSaveNames). The auth
  // metadata field still exists and is still written at signup for the
  // dashboard header, it just isn't the source of truth for CV output.
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
    // Fails open if HIBP is unreachable - see lib/pwned-password.ts.
    if (await isPasswordBreached(newPassword)) {
      setPasswordError(
        isAr
          ? "كلمة المرور هذه ظهرت في تسريب بيانات معروف. اختر كلمة مرور غيرها."
          : "This password has appeared in a known data breach. Please choose a different one."
      );
      return;
    }

    setPasswordStatus("saving");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setPasswordStatus("error");
      // Was surfacing Supabase's raw English string, untranslated.
      const messages: Record<ReturnType<typeof passwordErrorKey>, string> = {
        samePassword: isAr
          ? "يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية"
          : "Your new password must be different from your current one",
        tooShort: isAr
          ? "يجب ألا تقل كلمة المرور عن 8 أحرف"
          : "Password must be at least 8 characters",
        weakPassword: isAr
          ? "كلمة المرور سهلة التخمين. جرّب إضافة أرقام أو رموز أو أحرف كبيرة"
          : "That password is too easy to guess. Try adding numbers, symbols, or uppercase letters",
        sessionExpired: isAr
          ? "انتهت صلاحية جلستك. سجّل الدخول مرة أخرى وحاول من جديد"
          : "Your session expired. Log in again and retry",
        rateLimited: isAr
          ? "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى"
          : "Too many attempts. Wait a moment, then try again",
        generic: isAr ? "حدث خطأ ما. حاول مرة أخرى" : "Something went wrong. Please try again",
      };
      setPasswordError(messages[passwordErrorKey(error)]);
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.accountSection}</h2>
          {/* Cosmetic. The flags come from the backend, which re-checks them
              on every privileged request regardless of what renders here. */}
          <RoleBadges
            badges={badges}
            foundingMemberNumber={badgeFoundingNumber ?? foundingMemberNumber}
            lang={isAr ? "ar" : "en"}
            size="sm"
          />
        </div>

        {/* Two editable name fields, one per script. Previously this was a
            single read-only full_name. Editable here (not only at signup)
            because an Arabic CV needs the Arabic spelling and plenty of
            accounts were created before that field existed. */}
        <div className="space-y-4">
          <div>
            <label htmlFor="settingsNameEn" className="mb-1.5 block text-sm font-medium text-slate-700">
              {copy.nameEnLabel}
            </label>
            <input
              id="settingsNameEn"
              type="text"
              dir="ltr"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label htmlFor="settingsNameAr" className="mb-1.5 block text-sm font-medium text-slate-700">
              {copy.nameArLabel}
            </label>
            <input
              id="settingsNameAr"
              type="text"
              dir="rtl"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <p className="text-xs leading-relaxed text-slate-500">{copy.nameHelp}</p>

          {namesError && <p className="text-xs text-red-600">{namesError}</p>}

          <div className="flex items-center gap-3">
            <DashboardButton
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveNames}
              disabled={namesSaving || (!nameEn.trim() && !nameAr.trim())}
            >
              {copy.nameSave}
            </DashboardButton>
            {namesJustSaved && <span className="text-xs text-emerald-600">{copy.nameSaved}</span>}
          </div>
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

      {/* Subscription + billing (§5) */}
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.planSection}</h2>
            <p className="mt-1.5 text-sm text-slate-700">
              {copy.planLabel}: <span className="font-medium text-slate-900">{planDisplayName}</span>
            </p>

            {/* THE WAY OUT, WHERE THE PLAN IS STATED. Somebody looking for
                how to stop paying looks under "Current plan", not inside a
                pricing page — and a subscription nobody can find the exit
                for is one people cancel by emailing, or by charging back.
                Hidden once a change is already scheduled: the amber block
                below is then telling them what happens and offering the
                undo, and a second "cancel" beside it would contradict it. */}
            {tier && tier !== "free" && !pendingTier && (
              <div className="mt-2">
                <CancelSubscriptionLink isAr={isAr} onCancelled={() => setPendingTier("free")} />
              </div>
            )}
          </div>

          {/* THE WAY IN. Settings previously offered "Change plan", which
              reads as an admin toggle rather than somewhere to buy — and it
              was the only route to payment on this page, so a subscriber who
              wanted more credits had nothing to click. It says what it does
              now, and it says it differently depending on whether there is a
              plan to change. */}
          <DashboardButton as={Link} href="/dashboard/upgrade" variant="outline" size="sm">
            {tier && tier !== "free"
              ? isAr ? "تغيير الخطة أو شراء رصيد" : "Change plan or buy credits"
              : isAr ? "الترقية أو شراء رصيد" : "Upgrade or buy credits"}
          </DashboardButton>
        </div>

        {/* A SCHEDULED CHANGE, and the way out of it. pending_tier is set by
            cancelling or by changing plan; either way nothing has been
            charged yet and undoing it costs nothing, so the way back is
            offered right next to the statement rather than buried. */}
        {pendingTier && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <p className="text-sm leading-relaxed text-amber-900">
              {isAr
                ? `ستتحول خطتك إلى ${PLAN_LABEL_AR[pendingTier] ?? pendingTier}${
                    resetAt ? ` في ${formatMediumDate(resetAt, lang)}` : ""
                  }. حتى ذلك الحين لا يتغير شيء.`
                : `Your plan switches to ${PLAN_LABEL_EN[pendingTier] ?? pendingTier}${
                    resetAt ? ` on ${formatMediumDate(resetAt, lang)}` : ""
                  }. Nothing changes until then.`}
            </p>
            <button
              type="button"
              disabled={billingBusy}
              onClick={async () => {
                setBillingBusy(true);
                setBillingError(null);
                try {
                  await resumeSubscription();
                  setPendingTier(null);
                } catch (err) {
                  setBillingError(
                    isAr ? "تعذّر التراجع عن التغيير. حاول مرة أخرى." : "Couldn't undo that. Please try again."
                  );
                } finally {
                  setBillingBusy(false);
                }
              }}
              className="mt-2 rounded text-sm font-medium text-amber-900 underline underline-offset-4 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              {isAr ? "التراجع والبقاء على الخطة الحالية" : "Undo and stay on my current plan"}
            </button>
          </div>
        )}

        {/* The saved card. Only rendered when there IS one — a Free user who
            has never subscribed should not be shown an empty payment slot. */}
        {card?.card && (
          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {isAr ? "طريقة الدفع" : "Payment method"}
            </h3>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-700">
                {/* dir=ltr: a card number reads left-to-right in both
                    languages, and the bullets and digits scramble under RTL. */}
                <span dir="ltr" className="font-medium text-slate-900">
                  {(card.card.brand ?? "Card").replace(/^\w/, (c) => c.toUpperCase())} ••••{" "}
                  {card.card.last_four ?? "????"}
                </span>
                {card.card.expiry_month && card.card.expiry_year && (
                  <span dir="ltr" className="ms-2 text-slate-500">
                    {card.card.expiry_month}/{card.card.expiry_year}
                  </span>
                )}
              </p>

              <button
                type="button"
                disabled={billingBusy || !card.removable}
                title={
                  card.removable
                    ? undefined
                    : isAr
                      ? "هذه البطاقة تدفع اشتراكك الحالي."
                      : "This card is paying for your subscription."
                }
                onClick={async () => {
                  setBillingBusy(true);
                  setBillingError(null);
                  try {
                    await removeSavedCard();
                    setCard({ card: null, removable: true });
                  } catch (err) {
                    setBillingError(
                      err instanceof Error
                        ? err.message
                        : isAr ? "تعذّر حذف البطاقة." : "Couldn't remove the card."
                    );
                  } finally {
                    setBillingBusy(false);
                  }
                }}
                className="rounded text-sm font-medium text-slate-700 underline underline-offset-4 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {isAr ? "حذف البطاقة" : "Remove card"}
              </button>
            </div>

            {/* THE GUARD, EXPLAINED. Removing the card under a live
                subscription does not stop the subscription — it makes the
                next renewal fail and walks the customer through dunning for a
                downgrade they never chose. */}
            {!card.removable && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                {isAr
                  ? "هذه البطاقة تُستخدم لتجديد اشتراكك. ألغِ الاشتراك أولًا، ثم يمكنك حذفها."
                  : "This card renews your subscription. Cancel the subscription first, then it can be removed."}
              </p>
            )}
          </div>
        )}

        {billingError && (
          <p role="alert" className="text-sm text-red-700">{billingError}</p>
        )}
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
                ? "تعذّر الحفظ حاليًا (خطأ في الخادم)، يرجى المحاولة لاحقًا"
                : "Couldn't save right now (server error). Please try again later"
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
        {/* ?from=dashboard so the FAQ page's back link returns here rather
            than to the marketing home page. Same pattern /about uses. */}
        <Link href="/questions?from=dashboard" className="rounded transition-colors hover:text-slate-600">
          {isAr ? "الأسئلة الشائعة" : "FAQ"}
        </Link>
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
