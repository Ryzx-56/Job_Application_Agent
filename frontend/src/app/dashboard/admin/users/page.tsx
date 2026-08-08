"use client";

import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  AdminPage, Panel, Money, Loading, ErrorNote, Empty, ADMIN_MONO,
} from "@/components/admin-ui";
import { fetchAdminUsers, AdminUserRow } from "@/lib/supabase/admin";

/**
 * Account support lookup. Same search contract as the Resume Viewer
 * (email, name in either script, or a raw user id), resolved by the same
 * admin_search_users function so both pages accept identical input.
 *
 * Laid out as cards rather than a wide table: a support question is about
 * ONE account, and a 15-column table forces horizontal scrolling to answer
 * it. Empty search shows recent signups so the page is useful on open.
 */

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`${ADMIN_MONO} text-[10px] uppercase tracking-[0.14em] text-slate-400`}>{label}</div>
      <div className="mt-0.5 text-sm text-slate-900">{children}</div>
    </div>
  );
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "emerald" | "amber" | "violet" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  }[tone];
  return (
    <span className={`${ADMIN_MONO} inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tones}`}>
      {children}
    </span>
  );
}

function UserCard({ u }: { u: AdminUserRow }) {
  const lowCredits = (u.credits_remaining ?? 0) <= 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {u.name_en || u.name_ar || "No name saved"}
            {u.name_en && u.name_ar && <span className="ms-2 font-normal text-slate-400">{u.name_ar}</span>}
          </p>
          <p className={`${ADMIN_MONO} truncate text-xs text-slate-500`}>{u.email ?? u.id}</p>
          <p className={`${ADMIN_MONO} mt-0.5 truncate text-[10px] text-slate-300`}>{u.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {u.is_owner && <Pill tone="amber">owner</Pill>}
          {u.is_admin && <Pill tone="emerald">admin</Pill>}
          {u.is_founding_member && <Pill tone="violet">founder #{u.founding_member_number ?? "?"}</Pill>}
          <Pill>{u.tier ?? "—"}</Pill>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="credits">
          <span className={`${ADMIN_MONO} ${lowCredits ? "text-rose-600" : ""}`}>
            {u.credits_remaining ?? "—"} / {u.credits_total ?? "—"}
          </span>
        </Field>
        <Field label="cvs generated">
          <span className={ADMIN_MONO}>{u.cv_count}</span>
        </Field>
        <Field label="total paid">
          <Money usd={u.total_paid?.usd} sar={u.total_paid?.sar} />
        </Field>
        <Field label="subscription">
          <span className={`${ADMIN_MONO} text-xs`}>{u.subscription_status ?? "none"}</span>
        </Field>

        <Field label="signed up">{fmtDate(u.signed_up_at)}</Field>
        <Field label="last generated">{fmtDate(u.last_generated_at)}</Field>
        <Field label="tier expires">{fmtDate(u.tier_expires_at)}</Field>
        <Field label="credits reset">{fmtDate(u.credits_reset_at)}</Field>

        {u.pending_tier && <Field label="pending tier">{u.pending_tier}</Field>}
        {u.location && <Field label="location">{u.location}</Field>}
        {u.locked_price != null && <Field label="locked price">{String(u.locked_price)}</Field>}
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [term, setTerm] = useState("");
  const [applied, setApplied] = useState<string | undefined>(undefined);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdminUsers(applied)
      .then(({ users }) => !cancelled && setUsers(users))
      .catch((e) => !cancelled && setError(e?.message ?? "Lookup failed."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [applied]);

  return (
    <AdminPage
      title="Accounts"
      subtitle="Look up a user by email, name (either script) or id. Everything support needs about one account, in one view."
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(term.trim() || undefined);
        }}
      >
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Email, name, or user id"
          className={`${ADMIN_MONO} w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/15`}
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Search className="size-3.5" aria-hidden />
          Search
        </button>
      </form>

      {error && <ErrorNote message={error} />}

      {loading ? (
        <Loading label="looking up" />
      ) : users.length === 0 ? (
        <Panel>
          <Empty message={applied ? `nothing matched "${applied}"` : "no accounts yet"} />
        </Panel>
      ) : (
        <>
          <p className={`${ADMIN_MONO} text-xs text-slate-400`}>
            {users.length} account{users.length === 1 ? "" : "s"}
            {applied ? ` matching "${applied}"` : " · most recent signups"}
          </p>
          <div className="space-y-3">
            {users.map((u) => (
              <UserCard key={u.id} u={u} />
            ))}
          </div>
        </>
      )}
    </AdminPage>
  );
}
