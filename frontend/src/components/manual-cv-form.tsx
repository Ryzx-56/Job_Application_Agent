"use client";

import React from "react";
import { Plus, Trash2, User, GraduationCap, Briefcase, FolderKanban, Award, Wrench } from "lucide-react";
import { useLang } from "@/lib/language";

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

export type ManualCvData = {
  name: string;
  email: string;
  phone: string;
  phoneCountry: string; // ISO code into COUNTRY_OPTIONS below — drives phone formatting
  linkedin: string;
  location: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  skills: string; // comma separated — split on submit
};

export const emptyManualCvData: ManualCvData = {
  name: "",
  email: "",
  phone: "",
  phoneCountry: "SA",
  linkedin: "",
  location: "",
  education: [{ institution: "", degree: "", gpa: "", graduation_year: "" }],
  experience: [{ company: "", title: "", dates: "", bullets: "" }],
  projects: [{ name: "", tech_stack: "", description: "" }],
  certifications: [{ name: "" }],
  skills: "",
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

export function ManualCvForm({
  value,
  onChange,
}: {
  value: ManualCvData;
  onChange: (value: ManualCvData) => void;
}) {
  const { lang, dir } = useLang();

  function set(patch: Partial<ManualCvData>) {
    onChange({ ...value, ...patch });
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
            <FieldLabel>{lang === "ar" ? "الموقع (المدينة، الدولة)" : "Location"}</FieldLabel>
            <input
              className={inputClass}
              value={value.location}
              onChange={(e) => set({ location: e.target.value })}
              placeholder={lang === "ar" ? "المدينة، الدولة" : "City, Country"}
            />
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
              placeholder={lang === "ar" ? "الفترة، مثل: يونيو 2024 – أغسطس 2024" : "Dates, e.g. Jun 2024 – Aug 2024"}
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
    </div>
  );
}
