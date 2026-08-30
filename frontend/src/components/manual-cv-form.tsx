"use client";

import React, { useMemo, useState } from "react";
import {
  Plus, Trash2, User, GraduationCap, Briefcase, FolderKanban, Award, Wrench,
  Trophy, BookOpen, Users, FileText, ScrollText, Presentation, Medal, ListPlus, ChevronDown,
  Languages,
} from "lucide-react";
import { useLang } from "@/lib/language";
import {
  getCountryList,
  getCitiesForCountry,
  formatLocation,
  parseLocation,
  OTHER_CITY_VALUE,
  CountryOption,
  CityOption,
} from "@/lib/countries";
import { SearchableSelect } from "@/components/searchable-select";

export type EducationEntry = {
  institution: string;
  degree: string;
  gpa: string;
  graduation_year: string;
};

export type ExperienceEntry = {
  company: string;
  title: string;
  dates: string;
  bullets: string; // one bullet per line — split on submit
};

export type ProjectEntry = {
  name: string;
  tech_stack: string; // comma separated — split on submit
  description: string;
};

export type CertificationEntry = {
  name: string;
};

/* ── The categories FactsJSON gained (see backend/schemas/facts_schema.py) ──
   An uploaded CV can put content in every one of these; without matching
   fields here, someone typing their CV in by hand simply could not. Each is
   optional, and they live behind the "more sections" disclosure below so the
   default form stays as short as it was — most people have none of them, and
   most people are on a phone. */
export type TrainingEntry = {
  name: string;
  provider: string;
  date: string;
};

export type ParticipationEntry = {
  title: string;
  role: string;
  organization: string;
  scope: string; // "" | "local" | "international"
  date: string;
};

export type PublicationEntry = {
  title: string;
  venue: string;
  year: string;
};

export type CustomSectionEntry = {
  section_title: string;
  entries: string; // one per line — split on submit, same as experience bullets
};

export type ManualCvData = {
  name: string;
  email: string;
  phone: string;
  phoneCountry: string; // ISO code into COUNTRY_OPTIONS below — drives phone formatting
  linkedin: string;
  location: string;
  summary: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  skills: string; // comma separated — split on submit
  languages: string; // human languages, comma separated — split on submit
  achievements: string; // one per line — split on submit
  training: TrainingEntry[];
  participation: ParticipationEntry[];
  publications: PublicationEntry[];
  teaching: string; // one per line — split on submit
  awards: string; // one per line — split on submit
  customSections: CustomSectionEntry[];
};

export const emptyManualCvData: ManualCvData = {
  name: "",
  email: "",
  phone: "",
  phoneCountry: "SA",
  linkedin: "",
  location: "",
  summary: "",
  education: [{ institution: "", degree: "", gpa: "", graduation_year: "" }],
  experience: [{ company: "", title: "", dates: "", bullets: "" }],
  projects: [{ name: "", tech_stack: "", description: "" }],
  certifications: [{ name: "" }],
  skills: "",
  languages: "",
  achievements: "",
  training: [{ name: "", provider: "", date: "" }],
  participation: [{ title: "", role: "", organization: "", scope: "", date: "" }],
  publications: [{ title: "", venue: "", year: "" }],
  teaching: "",
  awards: "",
  customSections: [{ section_title: "", entries: "" }],
};

type CountryPhoneOption = {
  iso: string;
  dial: string; // "" for the "Other / International" catch-all — no forced formatting
  label: string;
  flag: string;
  groups: number[]; // how the significant digits are chunked, e.g. [2,3,4] -> "5X-XXX-XXXX"
};

/**
 * Not an exhaustive list of every country — just the ones most likely to
 * matter for JBAA's users, plus a genuine "Other / International" option
 * that applies zero formatting so nobody's number gets mangled into a shape
 * that doesn't fit their country.
 */
const COUNTRY_OPTIONS: CountryPhoneOption[] = [
  { iso: "SA", dial: "966", label: "Saudi Arabia", flag: "🇸🇦", groups: [2, 3, 4] },
  { iso: "AE", dial: "971", label: "UAE", flag: "🇦🇪", groups: [2, 3, 4] },
  { iso: "KW", dial: "965", label: "Kuwait", flag: "🇰🇼", groups: [4, 4] },
  { iso: "BH", dial: "973", label: "Bahrain", flag: "🇧🇭", groups: [4, 4] },
  { iso: "QA", dial: "974", label: "Qatar", flag: "🇶🇦", groups: [4, 4] },
  { iso: "OM", dial: "968", label: "Oman", flag: "🇴🇲", groups: [4, 4] },
  { iso: "EG", dial: "20", label: "Egypt", flag: "🇪🇬", groups: [3, 3, 4] },
  { iso: "JO", dial: "962", label: "Jordan", flag: "🇯🇴", groups: [1, 3, 4] },
  { iso: "US", dial: "1", label: "United States / Canada", flag: "🇺🇸", groups: [3, 3, 4] },
  { iso: "GB", dial: "44", label: "United Kingdom", flag: "🇬🇧", groups: [4, 6] },
  { iso: "IN", dial: "91", label: "India", flag: "🇮🇳", groups: [5, 5] },
  { iso: "OTHER", dial: "", label: "Other / International", flag: "🌍", groups: [] },
];

/**
 * Live-formats a phone number as the person types, adapted to whichever
 * country they've selected — e.g. Saudi Arabia -> "+966 5X-XXX-XXXX",
 * UAE -> "+971 5X-XXX-XXXX", US -> "+1 XXX-XXX-XXXX". For "Other /
 * International" (empty dial code) it applies no formatting at all and
 * just returns what was typed, since guessing a format for an unknown
 * country risks mangling a valid number worse than leaving it alone.
 */
function formatPhoneForCountry(raw: string, country: CountryPhoneOption): string {
  if (!country.dial) {
    return raw;
  }

  let digits = raw.replace(/\D/g, "");

  // Strip the country's own dial code (with or without a leading "00") and a
  // local trunk "0" prefix, so we always work from just the significant
  // digits no matter how the person typed it (local format, with "+", etc).
  if (digits.startsWith("00" + country.dial)) {
    digits = digits.slice(2 + country.dial.length);
  } else if (digits.startsWith(country.dial)) {
    digits = digits.slice(country.dial.length);
  }
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  const maxDigits = country.groups.reduce((a, b) => a + b, 0);
  digits = digits.slice(0, maxDigits);
  if (!digits) return "";

  let formatted = `+${country.dial} `;
  let cursor = 0;
  country.groups.forEach((size, idx) => {
    const chunk = digits.slice(cursor, cursor + size);
    if (!chunk) return;
    formatted += (idx === 0 ? "" : "-") + chunk;
    cursor += size;
  });
  return formatted;
}

/** Placeholder pattern like "5X-XXX-XXXX" derived from a country's digit groups. */
function placeholderForCountry(country: CountryPhoneOption): string {
  if (!country.dial) return "Phone number";
  const dial = `+${country.dial} `;
  return dial + country.groups.map((size) => "X".repeat(size)).join("-");
}

const inputClass =
  "block w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-slate-600">{children}</label>;
}

/* ========================================================================
   SECTION CARD — every part of the form (Education, Experience, Projects,
   Certifications) now lives in its own bordered card with an icon + title,
   so the long form reads as distinct steps instead of one dense wall.
======================================================================== */
function SectionCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:p-5">
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600">
            <Icon className="size-3.5" aria-hidden />
          </span>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function RepeatableSection<T>({
  icon,
  title,
  items,
  onChange,
  emptyItem,
  renderItem,
  lang,
}: {
  icon: React.ElementType;
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  emptyItem: T;
  renderItem: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  lang: string;
}) {
  return (
    <SectionCard
      icon={icon}
      title={title}
      action={
        <button
          type="button"
          onClick={() => onChange([...items, emptyItem])}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
        >
          <Plus className="size-3.5" aria-hidden /> {lang === "ar" ? "إضافة" : "Add"}
        </button>
      }
    >
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="relative rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                aria-label="Remove entry"
                className={`absolute top-2.5 grid size-6 place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 ${
                  lang === "ar" ? "left-2.5" : "right-2.5"
                }`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            )}
            {renderItem(item, (patch) => {
              const next = [...items];
              next[i] = { ...next[i], ...patch };
              onChange(next);
            })}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/**
 * A textarea for a plain list of lines — the shape `major_achievements`,
 * `teaching_and_editorial` and `awards` actually have on the backend (a list
 * of strings). Reuses the "one per line" convention the Experience card
 * already uses for bullets rather than inventing a second way to type a list.
 */
function LineListSection({
  icon,
  title,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  icon: React.ElementType;
  title: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <SectionCard icon={icon} title={title}>
      <textarea
        className={`${inputClass} resize-y`}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </SectionCard>
  );
}

export function ManualCvForm({
  value,
  onChange,
}: {
  value: ManualCvData;
  onChange: (value: ManualCvData) => void;
}) {
  const { lang, dir } = useLang();
  // The extra CV sections start collapsed. They're all optional, the form is
  // already long, and most users are on a phone — but anything typed into
  // them is still submitted whether the group is open or shut, since the data
  // lives on ManualCvData, not on this flag.
  const [showMore, setShowMore] = useState(false);

  function set(patch: Partial<ManualCvData>) {
    onChange({ ...value, ...patch });
  }

  // Location: kept as one plain string on ManualCvData (unchanged shape, so
  // nothing downstream that reads value.location breaks) — this just fixes
  // HOW it's edited, replacing free text (which let anyone type unrecognized
  // garbage that then couldn't be used for job-location matching) with the
  // same country+city cascade used at signup/Settings. Lazy-initialized
  // once from whatever's already in value.location, same as phoneCountry
  // above being a plain field rather than continuously re-synced.
  const [locationCountryIso, setLocationCountryIso] = useState(() => parseLocation(value.location)?.countryIso ?? "SA");
  const [locationCity, setLocationCity] = useState(() => {
    const parsed = parseLocation(value.location);
    if (parsed) return parsed.city;
    return value.location ? OTHER_CITY_VALUE : ""; // pre-existing free text that doesn't parse — keep it under Other
  });
  const [locationOther, setLocationOther] = useState(() => (parseLocation(value.location) ? "" : value.location));

  const locationCountryOptions: CountryOption[] = useMemo(() => getCountryList(lang), [lang]);
  const locationCityOptions: CityOption[] = useMemo(
    () => (locationCountryIso ? getCitiesForCountry(locationCountryIso, lang) : []),
    [locationCountryIso, lang]
  );

  function handleLocationCountryChange(iso: string) {
    setLocationCountryIso(iso);
    setLocationCity("");
    set({ location: "" }); // previous city no longer applies under the new country — wait for a new pick
  }

  function handleLocationCityChange(city: string) {
    setLocationCity(city);
    if (city === OTHER_CITY_VALUE) return; // wait for free-text entry before writing to value.location
    set({ location: formatLocation(city, locationCountryIso) });
  }

  function handleLocationOtherChange(text: string) {
    setLocationOther(text);
    set({ location: text.trim() });
  }

  return (
    <div className="space-y-4" dir={dir}>
      <SectionCard icon={User} title={lang === "ar" ? "المعلومات الشخصية" : "Personal information"}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>{lang === "ar" ? "الاسم الكامل *" : "Full name *"}</FieldLabel>
            <input
              className={inputClass}
              value={value.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={lang === "ar" ? "اسمك الكامل" : "Your full name"}
            />
          </div>
          <div>
            <FieldLabel>{lang === "ar" ? "البريد الإلكتروني" : "Email"}</FieldLabel>
            <input
              className={inputClass}
              value={value.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <FieldLabel>{lang === "ar" ? "رقم الهاتف" : "Phone"}</FieldLabel>
            <div className="flex gap-2">
              <select
                value={value.phoneCountry}
                onChange={(e) => {
                  const nextCountry =
                    COUNTRY_OPTIONS.find((c) => c.iso === e.target.value) ?? COUNTRY_OPTIONS[0];
                  // Re-derive from raw digits already typed so switching country
                  // doesn't just tack a new dial code onto the old formatting.
                  const digitsOnly = value.phone.replace(/\D/g, "");
                  set({
                    phoneCountry: nextCountry.iso,
                    phone: nextCountry.dial ? formatPhoneForCountry(digitsOnly, nextCountry) : value.phone,
                  });
                }}
                aria-label={lang === "ar" ? "رمز الدولة" : "Country"}
                className="w-[92px] shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {c.flag} {c.dial ? `+${c.dial}` : lang === "ar" ? "دولي" : "Intl"}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                inputMode="tel"
                className={`${inputClass} flex-1`}
                value={value.phone}
                onChange={(e) => {
                  const country =
                    COUNTRY_OPTIONS.find((c) => c.iso === value.phoneCountry) ?? COUNTRY_OPTIONS[0];
                  set({ phone: formatPhoneForCountry(e.target.value, country) });
                }}
                placeholder={placeholderForCountry(
                  COUNTRY_OPTIONS.find((c) => c.iso === value.phoneCountry) ?? COUNTRY_OPTIONS[0]
                )}
              />
            </div>
          </div>
          <div>
            <FieldLabel>{lang === "ar" ? "لينكد إن" : "LinkedIn"}</FieldLabel>
            <input
              className={inputClass}
              value={value.linkedin}
              onChange={(e) => set({ linkedin: e.target.value })}
              placeholder="linkedin.com/in/..."
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>{lang === "ar" ? "الموقع" : "Location"}</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <SearchableSelect
                theme="light"
                dir={dir}
                value={locationCountryIso}
                onChange={handleLocationCountryChange}
                options={locationCountryOptions.map((c) => ({ value: c.isoCode, label: c.name }))}
                placeholder={lang === "ar" ? "اختر دولتك" : "Select your country"}
                searchPlaceholder={lang === "ar" ? "ابحث..." : "Search..."}
                noResultsLabel={lang === "ar" ? "لا توجد نتائج" : "No results"}
              />
              <SearchableSelect
                theme="light"
                dir={dir}
                value={locationCity}
                onChange={handleLocationCityChange}
                options={[
                  ...locationCityOptions,
                  { value: OTHER_CITY_VALUE, label: lang === "ar" ? "أخرى" : "Other" },
                ]}
                placeholder={lang === "ar" ? "اختر مدينتك" : "Select your city"}
                searchPlaceholder={lang === "ar" ? "ابحث..." : "Search..."}
                noResultsLabel={lang === "ar" ? "لا توجد نتائج" : "No results"}
              />
            </div>
            {locationCity === OTHER_CITY_VALUE && (
              <input
                className={`${inputClass} mt-2`}
                value={locationOther}
                onChange={(e) => handleLocationOtherChange(e.target.value)}
                placeholder={lang === "ar" ? "اكتب مدينتك" : "Type your city"}
              />
            )}
          </div>
        </div>
      </SectionCard>

      <RepeatableSection
        icon={GraduationCap}
        title={lang === "ar" ? "التعليم" : "Education"}
        lang={lang}
        items={value.education}
        emptyItem={{ institution: "", degree: "", gpa: "", graduation_year: "" }}
        onChange={(education) => set({ education })}
        renderItem={(item, update) => (
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input
              className={inputClass}
              value={item.institution}
              onChange={(e) => update({ institution: e.target.value })}
              placeholder={lang === "ar" ? "اسم الجامعة / المدرسة" : "University / school name"}
            />
            <input
              className={inputClass}
              value={item.degree}
              onChange={(e) => update({ degree: e.target.value })}
              placeholder={lang === "ar" ? "الدرجة العلمية، مثل: بكالوريوس ذكاء اصطناعي" : "Degree, e.g. BSc AI"}
            />
            <input
              className={inputClass}
              value={item.gpa}
              onChange={(e) => update({ gpa: e.target.value })}
              placeholder={lang === "ar" ? "المعدل التراكمي (اختياري)" : "GPA (optional)"}
            />
            <input
              className={inputClass}
              value={item.graduation_year}
              onChange={(e) => update({ graduation_year: e.target.value })}
              placeholder={lang === "ar" ? "سنة التخرج" : "Graduation year"}
            />
          </div>
        )}
      />

      <RepeatableSection
        icon={Briefcase}
        title={lang === "ar" ? "الخبرات المهنية" : "Experience"}
        lang={lang}
        items={value.experience}
        emptyItem={{ company: "", title: "", dates: "", bullets: "" }}
        onChange={(experience) => set({ experience })}
        renderItem={(item, update) => (
          <div className="space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                className={inputClass}
                value={item.company}
                onChange={(e) => update({ company: e.target.value })}
                placeholder={lang === "ar" ? "الشركة" : "Company"}
              />
              <input
                className={inputClass}
                value={item.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder={lang === "ar" ? "المسمى الوظيفي" : "Job title"}
              />
            </div>
            <input
              className={inputClass}
              value={item.dates}
              onChange={(e) => update({ dates: e.target.value })}
              placeholder={lang === "ar" ? "الفترة، مثل: يونيو 2024 إلى أغسطس 2024" : "Dates, e.g. Jun 2024 to Aug 2024"}
            />
            <textarea
              className={`${inputClass} resize-y`}
              rows={3}
              value={item.bullets}
              onChange={(e) => update({ bullets: e.target.value })}
              placeholder={lang === "ar" ? "إنجاز واحد في كل سطر" : "One achievement per line"}
            />
          </div>
        )}
      />

      <RepeatableSection
        icon={FolderKanban}
        title={lang === "ar" ? "المشاريع" : "Projects"}
        lang={lang}
        items={value.projects}
        emptyItem={{ name: "", tech_stack: "", description: "" }}
        onChange={(projects) => set({ projects })}
        renderItem={(item, update) => (
          <div className="space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                className={inputClass}
                value={item.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder={lang === "ar" ? "اسم المشروع" : "Project name"}
              />
              <input
                className={inputClass}
                value={item.tech_stack}
                onChange={(e) => update({ tech_stack: e.target.value })}
                placeholder={lang === "ar" ? "التقنيات المستخدمة (مفصولة بفاصلة)" : "Tech stack, comma separated"}
              />
            </div>
            <textarea
              className={`${inputClass} resize-y`}
              rows={2}
              value={item.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder={lang === "ar" ? "وصف قصير / النتائج المحققة" : "Short description / results"}
            />
          </div>
        )}
      />

      <RepeatableSection
        icon={Award}
        title={lang === "ar" ? "الشهادات الاحترافية" : "Certifications"}
        lang={lang}
        items={value.certifications}
        emptyItem={{ name: "" }}
        onChange={(certifications) => set({ certifications })}
        renderItem={(item, update) => (
          <input
            className={inputClass}
            value={item.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={lang === "ar" ? "اسم الشهادة" : "Certification name"}
          />
        )}
      />

      <SectionCard icon={Wrench} title={lang === "ar" ? "المهارات" : "Skills"}>
        <input
          className={inputClass}
          value={value.skills}
          onChange={(e) => set({ skills: e.target.value })}
          placeholder={
            lang === "ar"
              ? "بايثون، قيادة الفرق، كلاود إيه بي آي (مفصولة بفاصلة)"
              : "Python, LangGraph, Claude API, Team leadership (comma separated)"
          }
        />
      </SectionCard>

      {/* Human languages — facts_json.languages_spoken, which every template
          now renders as its own section directly after Skills. */}
      <SectionCard icon={Languages} title={lang === "ar" ? "اللغات" : "Languages"}>
        <input
          className={inputClass}
          value={value.languages}
          onChange={(e) => set({ languages: e.target.value })}
          placeholder={
            lang === "ar"
              ? "العربية (اللغة الأم)، الإنجليزية (متقدم) — مفصولة بفاصلة"
              : "Arabic (native), English (fluent) — comma separated"
          }
        />
      </SectionCard>

      <button
        type="button"
        onClick={() => setShowMore((open) => !open)}
        aria-expanded={showMore}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-start text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        <span>
          {lang === "ar" ? "أقسام إضافية (اختيارية)" : "More sections (optional)"}
          <span className="ms-2 text-xs font-normal text-slate-500">
            {lang === "ar"
              ? "الملخص، الإنجازات، الدورات، المشاركات، الأبحاث، الجوائز"
              : "Summary, achievements, courses, participation, publications, awards"}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-slate-400 transition-transform ${showMore ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {showMore && (
        <div className="space-y-4">
          <SectionCard icon={FileText} title={lang === "ar" ? "الملخص المهني" : "Professional summary"}>
            <textarea
              className={`${inputClass} resize-y`}
              rows={4}
              value={value.summary}
              onChange={(e) => set({ summary: e.target.value })}
              placeholder={
                lang === "ar"
                  ? "نبذة قصيرة عن خبرتك وتخصصك، كما تكتبها في سيرتك الذاتية"
                  : "A short profile of your background and specialism, as you'd write it on your CV"
              }
            />
          </SectionCard>

          <LineListSection
            icon={Trophy}
            title={lang === "ar" ? "أبرز الإنجازات" : "Key achievements"}
            value={value.achievements}
            onChange={(achievements) => set({ achievements })}
            placeholder={lang === "ar" ? "إنجاز واحد في كل سطر" : "One achievement per line"}
          />

          <RepeatableSection
            icon={BookOpen}
            title={lang === "ar" ? "الدورات التدريبية" : "Training & courses"}
            lang={lang}
            items={value.training}
            emptyItem={{ name: "", provider: "", date: "" }}
            onChange={(training) => set({ training })}
            renderItem={(item, update) => (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  className={`${inputClass} sm:col-span-2`}
                  value={item.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder={lang === "ar" ? "اسم الدورة أو البرنامج" : "Course or programme name"}
                />
                <input
                  className={inputClass}
                  value={item.provider}
                  onChange={(e) => update({ provider: e.target.value })}
                  placeholder={lang === "ar" ? "الجهة المنظمة" : "Provider"}
                />
                <input
                  className={inputClass}
                  value={item.date}
                  onChange={(e) => update({ date: e.target.value })}
                  placeholder={lang === "ar" ? "التاريخ، مثل: مارس 2025" : "Date, e.g. March 2025"}
                />
              </div>
            )}
          />

          <RepeatableSection
            icon={Users}
            title={lang === "ar" ? "المشاركات المحلية والدولية" : "Conferences & participation"}
            lang={lang}
            items={value.participation}
            emptyItem={{ title: "", role: "", organization: "", scope: "", date: "" }}
            onChange={(participation) => set({ participation })}
            renderItem={(item, update) => (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  className={`${inputClass} sm:col-span-2`}
                  value={item.title}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder={lang === "ar" ? "اسم المؤتمر أو اللجنة أو البرنامج" : "Conference, committee or programme"}
                />
                <input
                  className={inputClass}
                  value={item.role}
                  onChange={(e) => update({ role: e.target.value })}
                  placeholder={lang === "ar" ? "صفة المشاركة، مثل: متحدث" : "Your role, e.g. speaker"}
                />
                <input
                  className={inputClass}
                  value={item.organization}
                  onChange={(e) => update({ organization: e.target.value })}
                  placeholder={lang === "ar" ? "الجهة المنظمة" : "Organization"}
                />
                <select
                  value={item.scope}
                  onChange={(e) => update({ scope: e.target.value })}
                  aria-label={lang === "ar" ? "نطاق المشاركة" : "Scope"}
                  className={inputClass}
                >
                  <option value="">{lang === "ar" ? "النطاق (اختياري)" : "Scope (optional)"}</option>
                  <option value="local">{lang === "ar" ? "محلي" : "Local"}</option>
                  <option value="international">{lang === "ar" ? "دولي" : "International"}</option>
                </select>
                <input
                  className={inputClass}
                  value={item.date}
                  onChange={(e) => update({ date: e.target.value })}
                  placeholder={lang === "ar" ? "التاريخ" : "Date"}
                />
              </div>
            )}
          />

          <RepeatableSection
            icon={ScrollText}
            title={lang === "ar" ? "الأبحاث والمنشورات" : "Publications"}
            lang={lang}
            items={value.publications}
            emptyItem={{ title: "", venue: "", year: "" }}
            onChange={(publications) => set({ publications })}
            renderItem={(item, update) => (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  className={`${inputClass} sm:col-span-2`}
                  value={item.title}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder={lang === "ar" ? "عنوان البحث أو المقال" : "Title of the paper or article"}
                />
                <input
                  className={inputClass}
                  value={item.venue}
                  onChange={(e) => update({ venue: e.target.value })}
                  placeholder={lang === "ar" ? "المجلة أو المؤتمر أو الناشر" : "Journal, conference or publisher"}
                />
                <input
                  className={inputClass}
                  value={item.year}
                  onChange={(e) => update({ year: e.target.value })}
                  placeholder={lang === "ar" ? "السنة" : "Year"}
                />
              </div>
            )}
          />

          <LineListSection
            icon={Presentation}
            title={lang === "ar" ? "التدريس وعضوية هيئات التحرير" : "Teaching & editorial boards"}
            value={value.teaching}
            onChange={(teaching) => set({ teaching })}
            placeholder={
              lang === "ar"
                ? "مهمة تدريسية أو عضوية واحدة في كل سطر"
                : "One teaching post or board membership per line"
            }
          />

          <LineListSection
            icon={Medal}
            title={lang === "ar" ? "الجوائز والتكريمات" : "Awards"}
            value={value.awards}
            onChange={(awards) => set({ awards })}
            placeholder={lang === "ar" ? "جائزة واحدة في كل سطر" : "One award per line"}
          />

        </div>
      )}

      {/* THE FREE-FORM ESCAPE HATCH — deliberately outside the collapsed
          group above, and last.

          Everything else on this form is a category we chose. This is the one
          that lets the candidate name their own: an "Add section" button, a
          heading they write, and as many lines as they want under it, repeated
          for as many sections as their CV has. It is the typed-in equivalent
          of FactsJSON.additional_sections, which is how an UPLOADED CV keeps a
          section we never anticipated — a surgeon's procedure counts, a
          pilot's flight hours. Hiding it behind a disclosure made the manual
          flow look like a fixed menu of categories, which is exactly what it
          is not. */}
      <RepeatableSection
        icon={ListPlus}
        title={lang === "ar" ? "أقسام تضيفها بنفسك" : "Add your own sections"}
        lang={lang}
        items={value.customSections}
        emptyItem={{ section_title: "", entries: "" }}
        onChange={(customSections) => set({ customSections })}
        renderItem={(item, update) => (
          <div className="space-y-2.5">
            <input
              className={inputClass}
              value={item.section_title}
              onChange={(e) => update({ section_title: e.target.value })}
              placeholder={
                lang === "ar"
                  ? "عنوان القسم كما تريده أن يظهر، مثل: العمليات الجراحية"
                  : "Your own section heading, e.g. Surgical Outcomes"
              }
            />
            <textarea
              className={`${inputClass} resize-y`}
              rows={3}
              value={item.entries}
              onChange={(e) => update({ entries: e.target.value })}
              placeholder={lang === "ar" ? "بند واحد في كل سطر" : "One line per entry"}
            />
          </div>
        )}
      />
      <p className="px-1 text-xs text-slate-500">
        {lang === "ar"
          ? "أي قسم في سيرتك الذاتية لا تجده أعلاه: اكتب عنوانه وبنوده كما هي، وسيظهر في السيرة كما كتبته."
          : "Any section of your CV that isn't listed above: write its heading and its lines, and it appears on the CV exactly as you wrote it."}
      </p>
    </div>
  );
}
