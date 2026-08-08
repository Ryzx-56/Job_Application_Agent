"use client";

import React, { useEffect, useState } from "react";
import { Loader2, FileText, Mail, FileType2, Search } from "lucide-react";
import { AdminPage, ErrorNote, ADMIN_MONO } from "@/components/admin-ui";
import {
  fetchAdminResumes,
  getAdminDocumentUrl,
  AdminResumeSummary,
  AdminMatchedUser,
} from "@/lib/supabase/resumes";

/**
 * Admin-only debug tool. Search for a user by email, name, or id, then open
 * the exact CV or cover letter they received. Documents are re-rendered on
 * demand from the generation_snapshot saved on each resume row, because the
 * rendered files themselves are not kept anywhere after the request that
 * created them.
 *
 * Access control is entirely server-side: the backend checks
 * profiles.is_admin on every request. This page does no client-side gating,
 * so a non-admin who opens it just sees every request fail with "Admin
 * access required". The Settings link to it is likewise only a convenience,
 * not a security boundary.
 */

const PAGE_SIZE = 25;

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function DocLink({ resumeId, docType, label, icon: Icon }: { resumeId: string; docType: "cv-pdf" | "cv-docx" | "cover-letter-pdf"; label: string; icon: React.ElementType }) {
  const [href, setHref] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    if (href) return; // already resolved, let the anchor navigate normally
    e.preventDefault();
    setLoading(true);
    const url = await getAdminDocumentUrl(resumeId, docType);
    setLoading(false);
    if (url) {
      setHref(url);
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <a
      href={href ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {loading ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Icon className="size-3" aria-hidden />}
      {label}
    </a>
  );
}

export default function AdminResumesPage() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState<string | undefined>(undefined);
  const [matchedUsers, setMatchedUsers] = useState<AdminMatchedUser[]>([]);
  const [page, setPage] = useState(0);
  const [resumes, setResumes] = useState<AdminResumeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdminResumes({ page, pageSize: PAGE_SIZE, search: appliedSearch })
      .then(({ resumes, matched_users }) => {
        if (cancelled) return;
        setResumes(resumes);
        setMatchedUsers(matched_users ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Failed to load resumes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, appliedSearch]);

  return (
    <AdminPage
      title="Resume Viewer"
      subtitle="Search by email, name, or user id to open the CV and cover letter someone actually received. Leave the box empty to see the most recent resumes from everyone."
    >

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setAppliedSearch(search.trim() || undefined);
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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

      {appliedSearch && matchedUsers.length > 0 && (
        <p className="text-xs text-slate-500">
          {matchedUsers.length === 1
            ? `1 account matched: ${matchedUsers[0].email ?? matchedUsers[0].id}`
            : `${matchedUsers.length} accounts matched. Showing resumes from all of them.`}
        </p>
      )}

      {error && <ErrorNote message={error} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading
        </div>
      ) : resumes.length === 0 && !error ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
          {appliedSearch ? `Nothing matched "${appliedSearch}".` : "No resumes yet."}
        </div>
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left font-medium">User</th>
                <th className="px-4 py-3 text-left font-medium">Role</th>
                <th className="px-4 py-3 text-left font-medium">Company</th>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Lang</th>
                <th className="px-4 py-3 text-left font-medium">ATS</th>
                <th className="px-4 py-3 text-left font-medium">Archived</th>
                <th className="px-4 py-3 text-left font-medium">Documents</th>
              </tr>
            </thead>
            <tbody>
              {resumes.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-900">
                        {r.name_en || r.name_ar || "No name saved"}
                      </p>
                      <p className="truncate text-xs text-slate-500">{r.email || r.user_id}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{r.role || "Not recorded"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.company || "Not recorded"}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-slate-500">{r.cv_language}</td>
                  <td className="px-4 py-3 text-slate-600">{r.ats_score}%</td>
                  <td className="px-4 py-3">
                    {r.is_archived ? <span className="text-xs text-amber-600">yes</span> : <span className="text-xs text-slate-400">no</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DocLink resumeId={r.id} docType="cv-pdf" label="CV" icon={FileText} />
                      <DocLink resumeId={r.id} docType="cv-docx" label="Word" icon={FileType2} />
                      <DocLink resumeId={r.id} docType="cover-letter-pdf" label="Cover Letter" icon={Mail} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>Page {page + 1}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={resumes.length < PAGE_SIZE}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </AdminPage>
  );
}
