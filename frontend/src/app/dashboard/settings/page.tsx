"use client";

import React from "react";
import Link from "next/link";
import { useLang } from "@/lib/language";
import { useAuth } from "@/lib/auth";
import { DashboardButton } from "@/components/dashboard";

// TODO: replace with the user's real subscription tier once billing is
// wired up (e.g. read from a Supabase `subscriptions` table or Stripe).
const mockPlan = "Free";

export default function SettingsPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const copy = t.dashboard.settings;

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";
  const email = user?.email ?? "";

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
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.passwordSection}</h2>
        <DashboardButton as={Link} href="/forgot-password" variant="outline" size="sm">
          {copy.changePassword}
        </DashboardButton>
      </section>

      {/* Subscription */}
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.planSection}</h2>
          <p className="mt-1.5 text-sm text-slate-700">
            {copy.planLabel}: <span className="font-medium text-slate-900">{mockPlan}</span>
          </p>
        </div>
        <DashboardButton as={Link} href="/#pricing" variant="outline" size="sm">
          {copy.changePlan}
        </DashboardButton>
      </section>

      {/* Language */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.languageSection}</h2>
        <p className="text-sm text-slate-500">{copy.languageLabel}</p>
      </section>
    </div>
  );
}
