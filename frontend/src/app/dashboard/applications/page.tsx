"use client";

import React from "react";
import { Files } from "lucide-react";
import { useLang } from "@/lib/language";
import { EmptyState, StatusBadge } from "@/components/dashboard";

// Mock data — swap for a real query (e.g. Supabase table `applications`)
// once application tracking is wired up.
const mockApplications: {
  id: string;
  company: string;
  role: string;
  status: "applied" | "interview" | "rejected";
  date: string;
}[] = [
  { id: "1", company: "Linear", role: "Senior Frontend Engineer", status: "interview", date: "2026-06-28" },
  { id: "2", company: "Notion", role: "Product Designer", status: "applied", date: "2026-06-21" },
  { id: "3", company: "Anthropic", role: "ML Engineer", status: "rejected", date: "2026-06-14" },
];

export default function ApplicationsPage() {
  const { t } = useLang();
  const copy = t.dashboard.applications;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

      {mockApplications.length === 0 ? (
        <EmptyState
          icon={Files}
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
                <th className="px-5 py-3 text-start font-medium">{copy.columns.company}</th>
                <th className="px-5 py-3 text-start font-medium">{copy.columns.role}</th>
                <th className="px-5 py-3 text-start font-medium">{copy.columns.status}</th>
                <th className="px-5 py-3 text-start font-medium">{copy.columns.date}</th>
              </tr>
            </thead>
            <tbody>
              {mockApplications.map((application) => (
                <tr key={application.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3.5 font-medium text-slate-900">{application.company}</td>
                  <td className="px-5 py-3.5 text-slate-600">{application.role}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={application.status} label={copy.status[application.status]} />
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{application.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
