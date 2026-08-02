// lib/countries.ts
//
// Country -> city cascade for the location picker (signup + Settings).
// Requires two packages — run:
//   npm install country-state-city i18n-iso-countries
//
// Why two packages: country-state-city gives country/city data keyed by
// ISO2 code, but its city names are English-only. i18n-iso-countries adds
// localized COUNTRY names (Arabic included, 79 languages) keyed by the same
// ISO2 codes, so the two combine cleanly. Neither one gives Arabic CITY
// names for anywhere outside what we curate ourselves — see the Saudi
// Arabia special-case below.
//
// Storage convention: everything stored in profiles.location is the
// canonical ENGLISH "City, Country" string (e.g. "Jeddah, Saudi Arabia"),
// regardless of what language the user was signing up in. Only the
// DISPLAYED label is localized. This is the same "store one canonical
// value, localize only the label" pattern saudi-cities.ts used before —
// it's what keeps jobs_finder.py's location matching predictable.

import { Country, City } from "country-state-city";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import ar from "i18n-iso-countries/langs/ar.json";

countries.registerLocale(en);
countries.registerLocale(ar);

const SAUDI_ISO = "SA";

// Curated because i18n-iso-countries only localizes the COUNTRY name, not
// city names — and country-state-city's Saudi city list is English-only.
// Saudi Arabia is the priority market (shown first, everyone else
// alphabetical after it), so it gets real Arabic city names; every other
// country falls back to country-state-city's English city names even in
// Arabic UI — see getCitiesForCountry below.
const SAUDI_CITIES_AR: Record<string, string> = {
  Riyadh: "الرياض",
  Jeddah: "جدة",
  Mecca: "مكة المكرمة",
  Medina: "المدينة المنورة",
  Dammam: "الدمام",
  Khobar: "الخبر",
  Dhahran: "الظهران",
  Taif: "الطائف",
  Buraidah: "بريدة",
  Tabuk: "تبوك",
  "Khamis Mushait": "خميس مشيط",
  Abha: "أبها",
  Najran: "نجران",
  Jazan: "جازان",
  Hail: "حائل",
  "Al Ahsa": "الأحساء",
  Yanbu: "ينبع",
  Jubail: "الجبيل",
  Qatif: "القطيف",
  "Al Kharj": "الخرج",
  Sakaka: "سكاكا",
  Arar: "عرعر",
  Bisha: "بيشة",
};

export type CountryOption = { isoCode: string; name: string };
export type CityOption = { value: string; label: string };

// Sentinel for "not in the list" — same role as OTHER_CITY_VALUE before.
export const OTHER_CITY_VALUE = "__other__";

/**
 * All countries, Saudi Arabia pinned first, everyone else alphabetically
 * sorted BY THE LOCALIZED NAME (so the Arabic list is alphabetized in
 * Arabic order, not just re-labeled English order).
 */
export function getCountryList(lang: "en" | "ar"): CountryOption[] {
  const allCountries = Country.getAllCountries();
  const localized = allCountries.map((c) => ({
    isoCode: c.isoCode,
    name: countries.getName(c.isoCode, lang) || c.name, // fall back to English if a code has no translation
  }));

  const saudi = localized.find((c) => c.isoCode === SAUDI_ISO);
  const rest = localized
    .filter((c) => c.isoCode !== SAUDI_ISO)
    .sort((a, b) => a.name.localeCompare(b.name, lang));

  return saudi ? [saudi, ...rest] : rest;
}

/**
 * Cities for a given country ISO code.
 *
 * Saudi Arabia: returns ONLY the curated SAUDI_CITIES_AR list above — NOT
 * country-state-city's raw ~285-entry Saudi list. That raw list is small
 * towns, has genuine duplicate entries (a known quality issue in that
 * dataset), and — since it's English-only — was silently falling back to
 * English for every city outside the curated ~23, even in Arabic UI. This
 * was the actual bug behind all three symptoms reported at once (too many
 * cities, duplicates, English-in-Arabic-UI): the curated list was only
 * being used as a translation lookup, not as the list itself.
 *
 * Every other country: still country-state-city's raw list (no curated
 * data exists for 194 other countries), but now deduplicated by name —
 * that dataset has real duplicate entries outside Saudi too. City names
 * stay English-only there; see the file-header note on why.
 */
export function getCitiesForCountry(isoCode: string, lang: "en" | "ar"): CityOption[] {
  if (isoCode === SAUDI_ISO) {
    return Object.entries(SAUDI_CITIES_AR)
      .map(([value, ar]) => ({ value, label: lang === "ar" ? ar : value }))
      .sort((a, b) => a.label.localeCompare(b.label, lang));
  }

  const cities = City.getCitiesOfCountry(isoCode) || [];
  const seen = new Set<string>();
  const deduped: CityOption[] = [];
  for (const city of cities) {
    const key = city.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ value: city.name, label: city.name });
  }
  return deduped.sort((a, b) => a.label.localeCompare(b.label));
}

/** Builds the canonical "City, Country" string stored in profiles.location. */
export function formatLocation(city: string, countryIsoCode: string): string {
  const countryName = countries.getName(countryIsoCode, "en") || countryIsoCode;
  return `${city}, ${countryName}`;
}

/**
 * Reverses formatLocation() — used by Settings to pre-populate the
 * country+city dropdowns from an already-stored value. Returns null if the
 * string doesn't parse as "City, Country" with a recognizable country name
 * (e.g. a pre-cascade value stored before this change, or genuinely
 * unrecognized free text) — callers should fall back to the "Other"
 * free-text field in that case rather than guessing.
 */
export function parseLocation(location: string): { countryIso: string; city: string } | null {
  const lastComma = location.lastIndexOf(",");
  if (lastComma === -1) return null;

  const city = location.slice(0, lastComma).trim();
  const countryName = location.slice(lastComma + 1).trim();
  if (!city || !countryName) return null;

  const countryIso = countries.getAlpha2Code(countryName, "en");
  return countryIso ? { countryIso, city } : null;
}
