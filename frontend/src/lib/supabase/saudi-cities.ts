// lib/saudi-cities.ts
//
// Shared list for the location dropdown used at signup and in Settings.
// `value` is the canonical stored string (always English, never localized)
// — this is what goes in profiles.location and what jobs_finder.py's
// fallback reads. Keeping storage in one fixed language regardless of the
// UI language is what avoids the classic Arabic-vs-English city-name
// mismatch (e.g. "جدة" vs "Jeddah" vs "Jedda") ending up scattered across
// user records. Display label is picked from `en`/`ar` based on the
// current UI language, same pattern as TIER_LABEL in settings-page.tsx.

export type SaudiCity = {
  value: string;
  en: string;
  ar: string;
};

export const SAUDI_CITIES: SaudiCity[] = [
  { value: "Riyadh", en: "Riyadh", ar: "الرياض" },
  { value: "Jeddah", en: "Jeddah", ar: "جدة" },
  { value: "Mecca", en: "Mecca", ar: "مكة المكرمة" },
  { value: "Medina", en: "Medina", ar: "المدينة المنورة" },
  { value: "Dammam", en: "Dammam", ar: "الدمام" },
  { value: "Khobar", en: "Khobar", ar: "الخبر" },
  { value: "Dhahran", en: "Dhahran", ar: "الظهران" },
  { value: "Taif", en: "Taif", ar: "الطائف" },
  { value: "Buraidah", en: "Buraidah", ar: "بريدة" },
  { value: "Tabuk", en: "Tabuk", ar: "تبوك" },
  { value: "Khamis Mushait", en: "Khamis Mushait", ar: "خميس مشيط" },
  { value: "Abha", en: "Abha", ar: "أبها" },
  { value: "Najran", en: "Najran", ar: "نجران" },
  { value: "Jazan", en: "Jazan", ar: "جازان" },
  { value: "Hail", en: "Hail", ar: "حائل" },
  { value: "Al Ahsa", en: "Al Ahsa", ar: "الأحساء" },
  { value: "Yanbu", en: "Yanbu", ar: "ينبع" },
  { value: "Jubail", en: "Jubail", ar: "الجبيل" },
  { value: "Qatif", en: "Qatif", ar: "القطيف" },
  { value: "Al Kharj", en: "Al Kharj", ar: "الخرج" },
  { value: "Sakaka", en: "Sakaka", ar: "سكاكا" },
  { value: "Arar", en: "Arar", ar: "عرعر" },
  { value: "Bisha", en: "Bisha", ar: "بيشة" },
];

// Sentinel value for "not in the list" — reveals a free-text field only in
// this one case, so someone outside Saudi Arabia (or in a smaller town)
// isn't stuck picking a wrong city just because the dropdown is curated.
export const OTHER_CITY_VALUE = "__other__";

export function cityLabel(value: string | null | undefined, lang: "en" | "ar"): string {
  if (!value) return "";
  const match = SAUDI_CITIES.find((c) => c.value === value);
  return match ? match[lang] : value; // unrecognized value (e.g. free-text "Other") — show as-is
}
