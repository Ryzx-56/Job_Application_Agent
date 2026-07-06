"use client";

import React from "react";
import { Download, FileText } from "lucide-react";
import { useLang } from "@/lib/language";
import { EmptyState } from "@/components/dashboard";

// Mock data — swap for a real query (e.g. Supabase table `resumes`) once
// the generate flow actually persists results.
const mockResumes: {
  id: string;
  role: string;
  company: string;
  date: string;
  score: number;
}[] = [
  { id: "1", role: "Senior Frontend Engineer", company: "Linear", date: "2026-06-28", score: 87 },
  { id: "2", role: "Product Designer", company: "Notion", date: "2026-06-21", score: 91 },
  { id: "3", role: "ML Engineer", company: "Anthropic", date: "2026-06-14", score: 79 },
];

export default function MyResumesPage() {
  const { t } = useLang();
  const copy = t.dashboard.resumes;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

      {mockResumes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={copy.emptyTitle}
          body={copy.emptyBody}
          ctaLabel={copy.emptyCta}
          ctaHref="/dashboard"
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 text-start font-medium">{copy.columns.role}</th>
                <th className="px-5 py-3 text-start font-medium">{copy.columns.company}</th>
                <th className="px-5 py-3 text-start font-medium">{copy.columns.date}</th>
                <th className="px-5 py-3 text-start font-medium">{copy.columns.score}</th>
                <th className="px-5 py-3 text-end font-medium">{copy.columns.download}</th>
              </tr>
            </thead>
            <tbody>
              {mockResumes.map((resume) => (
                <tr key={resume.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3.5 font-medium text-slate-900">{resume.role}</td>
                  <td className="px-5 py-3.5 text-slate-600">{resume.company}</td>
                  <td className="px-5 py-3.5 text-slate-500">{resume.date}</td>
                  <td className="px-5 py-3.5 text-slate-600">{resume.score}%</td>
                  <td className="px-5 py-3.5 text-end">
                    <button
                      type="button"
                      aria-label={copy.columns.download}
                      className="ms-auto grid size-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Download className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
