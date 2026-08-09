"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/* ========================================================================
   ADMIN DESIGN SYSTEM

   A technical control-panel look that stays in the app's LIGHT theme. The
   "developer tool" read comes from typography and structure rather than
   from going dark:
     - monospace for every number, id, key and label
     - uppercase micro-labels with wide tracking
     - hairline slate rules and a faint grid, not heavy borders
     - a terminal prompt glyph on headings
   That keeps it visually distinct from the user-facing dashboard without
   fighting the white background everything else uses.

   Shared here so all four admin pages stay consistent by construction
   rather than by copy-paste.
======================================================================== */

export const ADMIN_MONO = "font-mono tabular-nums";

/* ---------------- Page frame ---------------- */

export function AdminPage({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminBreadcrumb />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <span className={`${ADMIN_MONO} select-none text-emerald-600`} aria-hidden>
              &gt;_
            </span>
            {title}
          </h1>
          {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

const CRUMBS: Record<string, string> = {
  "/dashboard/admin": "admin",
  "/dashboard/admin/analytics": "admin / analytics",
  "/dashboard/admin/users": "admin / users",
  "/dashboard/admin/resumes": "admin / resumes",
  "/dashboard/admin/health": "admin / health",
  "/dashboard/admin/linkedin": "admin / linkedin",
};

function AdminBreadcrumb() {
  const pathname = usePathname();
  const crumb = CRUMBS[pathname] ?? "admin";
  const isRoot = pathname === "/dashboard/admin";
  return (
    <div className={`${ADMIN_MONO} flex items-center gap-2 text-xs text-slate-400`}>
      <span className="text-slate-300">~/</span>
      {isRoot ? (
        <span>{crumb}</span>
      ) : (
        <>
          <Link href="/dashboard/admin" className="hover:text-slate-600 hover:underline">
            admin
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-500">{crumb.split(" / ")[1]}</span>
        </>
      )}
    </div>
  );
}

/* ---------------- Panels ---------------- */

export function Panel({
  title,
  hint,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className={`${ADMIN_MONO} text-xs font-semibold uppercase tracking-[0.14em] text-slate-500`}>
            {title}
          </h2>
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/* ---------------- Stat tile ----------------
   `value === null | undefined` means "not read", which renders as a dash
   rather than 0 — a metric that failed to load must never look like a
   measured zero. `pending` marks a figure that can't exist yet (no payment
   data), which is a different thing again and says so. */

export function Stat({
  label,
  value,
  sub,
  pending = false,
  accent = "slate",
}: {
  label: string;
  /** Numbers are formatted with thousands separators automatically. Pass a
   *  node (e.g. <Money/>) when the value needs its own rendering. */
  value?: number | string | React.ReactNode | null;
  sub?: string;
  pending?: boolean;
  accent?: "slate" | "emerald" | "amber" | "violet" | "rose";
}) {
  const accents: Record<string, string> = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    violet: "text-violet-600",
    rose: "text-rose-600",
  };
  const display = pending
    ? "—"
    : value === null || value === undefined
    ? "—"
    : typeof value === "number"
    ? value.toLocaleString()
    : value;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className={`${ADMIN_MONO} text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400`}>
        {label}
      </div>
      <div className={`${ADMIN_MONO} mt-1.5 text-2xl font-semibold ${pending ? "text-slate-300" : accents[accent]}`}>
        {display}
      </div>
      {pending ? (
        <div className="mt-1 text-[11px] leading-snug text-amber-600">Awaiting payment integration</div>
      ) : (
        sub && <div className="mt-1 text-[11px] leading-snug text-slate-400">{sub}</div>
      )}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={`grid gap-3 ${c}`}>{children}</div>;
}

/* ---------------- Money ----------------
   Both currencies always shown together, converted server-side at the
   fixed 3.75 peg so no two surfaces can disagree. */

export function Money({ usd, sar, pending = false }: { usd?: number | null; sar?: number | null; pending?: boolean }) {
  if (pending || usd === null || usd === undefined) {
    return <span className="text-slate-300">—</span>;
  }
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span className={ADMIN_MONO}>
      ${fmt(usd)}
      <span className="ml-1.5 text-slate-400">({fmt(sar ?? usd * 3.75)} SAR)</span>
    </span>
  );
}

/* ---------------- Table ---------------- */

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {head.map((h) => (
              <th
                key={h}
                className={`${ADMIN_MONO} px-3 py-2.5 text-start text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">{children}</tr>;
}

export function Cell({ children, mono = false, className = "" }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return <td className={`px-3 py-2.5 align-top ${mono ? ADMIN_MONO : ""} ${className}`}>{children}</td>;
}

/* ---------------- States ---------------- */

export function Loading({ label = "loading" }: { label?: string }) {
  return (
    <div className={`${ADMIN_MONO} flex items-center gap-2 py-14 text-sm text-slate-400`}>
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
      {label}
      <span className="animate-pulse">…</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className={`${ADMIN_MONO} rounded-lg border border-rose-200 bg-rose-50/70 px-4 py-3 text-xs text-rose-700`}>
      <span className="font-semibold">error:</span> {message}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <div className={`${ADMIN_MONO} py-14 text-center text-sm text-slate-400`}>{message}</div>;
}

/* ---------------- Notice ----------------
   Used for the "these numbers need the payment integration" explanation.
   Amber rather than red: it isn't broken, it's not connected yet. */

export function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
      <p className={`${ADMIN_MONO} text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700`}>{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">{children}</p>
    </div>
  );
}
