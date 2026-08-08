"use client";

import React from "react";
import Link from "next/link";
import { FileText, BarChart3, Users, Activity, ArrowRight } from "lucide-react";
import { AdminPage, ADMIN_MONO } from "@/components/admin-ui";

/**
 * Admin landing page. Four tools, each its own route — real navigation
 * rather than tabs, so any one of them can be linked to or bookmarked
 * directly (which matters when you're mid-support-conversation).
 *
 * Access is enforced entirely server-side: every /api/v1/admin/* endpoint
 * re-checks profiles.is_admin. This page does no gating of its own, so a
 * non-admin who reaches it sees the cards but every request behind them
 * fails with "Admin access required".
 */

const TOOLS = [
  {
    href: "/dashboard/admin/analytics",
    name: "Analytics",
    cmd: "analytics",
    icon: BarChart3,
    accent: "text-emerald-600",
    ring: "group-hover:border-emerald-300",
    desc: "Signups, generations, tier distribution and revenue. Dollar figures show their SAR equivalent at the 3.75 peg.",
  },
  {
    href: "/dashboard/admin/users",
    name: "Accounts",
    cmd: "users",
    icon: Users,
    accent: "text-violet-600",
    ring: "group-hover:border-violet-300",
    desc: "Look a user up by email, name or id. Credits, tier, spend and usage in one view for support.",
  },
  {
    href: "/dashboard/admin/resumes",
    name: "Resume Viewer",
    cmd: "resumes",
    icon: FileText,
    accent: "text-blue-600",
    ring: "group-hover:border-blue-300",
    desc: "Open the exact CV or cover letter a user received, re-rendered from their saved generation snapshot.",
  },
  {
    href: "/dashboard/admin/health",
    name: "Pipeline Health",
    cmd: "health",
    icon: Activity,
    accent: "text-amber-600",
    ring: "group-hover:border-amber-300",
    desc: "Success rate, the failures actually happening, Arabic localization quality and token spend per run.",
  },
];

export default function AdminHomePage() {
  return (
    <AdminPage
      title="Admin"
      subtitle="Internal tooling. Everything here reads production data and is gated on your account's admin flag, checked server-side on every request."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map(({ href, name, cmd, icon: Icon, desc, accent, ring }) => (
          <Link
            key={href}
            href={href}
            className={`group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md ${ring}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50">
                <Icon className={`size-4.5 ${accent}`} aria-hidden />
              </span>
              <ArrowRight
                className="size-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500 rtl:rotate-180"
                aria-hidden
              />
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-900">{name}</h2>
            <p className={`${ADMIN_MONO} mt-0.5 text-[11px] text-slate-400`}>admin/{cmd}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{desc}</p>
          </Link>
        ))}
      </div>

    </AdminPage>
  );
}
