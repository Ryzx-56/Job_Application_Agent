"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
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
  linkedin: "",
  location: "",
  education: [{ institution: "", degree: "", gpa: "", graduation_year: "" }],
  experience: [{ company: "", title: "", dates: "", bullets: "" }],
  projects: [{ name: "", tech_stack: "", description: "" }],
  certifications: [{ name: "" }],
  skills: "",
};

const inputClass =
  "block w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-500/20";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-slate-600">{children}</label>;
}

function RepeatableSection<T>({
  title,
  items,
  onChange,
  emptyItem,
  renderItem,
  lang,
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  emptyItem: T;
  renderItem: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  lang: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{title}</p>
        <button
          type="button"
          onClick={() => onChange([...items, emptyItem])}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
        >
          <Plus className="size-3.5" aria-hidden /> {lang === "ar" ? "إضافة" : "Add"}
        </button>
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                aria-label={`Remove entry`}
                className={`absolute top-2.5 grid size-6 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-rose-500 ${
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
    </div>
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
    <div className="space-y-6" dir={dir}>
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
          <input
            className={inputClass}
            value={value.phone}
            onChange={(e) => set({ phone: e.target.value })}
            placeholder={lang === "ar" ? "9665+..." : "+966 5..."}
          />
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

      <RepeatableSection
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

      <div>
        <FieldLabel>{lang === "ar" ? "المهارات" : "Skills"}</FieldLabel>
        <input
          className={inputClass}
          value={value.skills}
          onChange={(e) => set({ skills: e.target.value })}
          placeholder={
            lang === "ar"
              ? "بايثون، قيادة الفرق، كلاود إيه بي آي — مفصولة بفاصلة"
              : "Python, LangGraph, Claude API, Team leadership — comma separated"
          }
        />
      </div>
    </div>
  );
}