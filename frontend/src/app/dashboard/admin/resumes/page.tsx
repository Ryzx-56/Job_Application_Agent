"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle, FileText, Mail, FileType2, Search } from "lucide-react";
import { fetchAdminResumes, getAdminDocumentUrl, AdminResumeSummary } from "@/lib/supabase/resumes";

/**
 * Admin-only debug tool: look up any user's saved resumes by their auth
 * user id and open exactly the CV/cover letter they saw, regenerated on
 * demand from the saved generation_snapshot (see PART 1 of the
 * storage/retention rework — rendered files aren't stored anywhere
 * permanently anymore, so this is the only way to see a specific past
 * result after the fact).
 *
 * Not linked from any nav — reachable only by URL. Access control is
 * entirely server-side (backend checks profiles.is_admin on every request
 * here); a non-admin visiting this page just sees every request fail with
 * "Admin access required."
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
  const [userId, setUserId] = useState("");
  const [appliedUserId, setAppliedUserId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [resumes, setResumes] = useState<AdminResumeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdminResumes({ page, pageSize: PAGE_SIZE, userId: appliedUserId })
      .then(({ resumes }) => {
        if (!cancelled) setResumes(resumes);
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
  }, [page, appliedUserId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin — Resume Viewer</h1>
        <p className="mt-2 text-sm text-slate-500">
          Look up any user&apos;s saved resumes by their Supabase auth user id and regenerate the CV/cover letter they saw. Find a
          reporter&apos;s user id in the Supabase dashboard under Authentication → Users (search by their email).
        </p>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setAppliedUserId(userId.trim() || undefined);
        }}
      >
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Filter by user id (leave blank for all users)"
          className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Search className="size-3.5" aria-hidden />
          Filter
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-600">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading...
        </div>
      ) : resumes.length === 0 && !error ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">No resumes found.</div>
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left font-medium">User ID</th>
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
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.user_id}</td>
                  <td className="px-4 py-3 text-slate-900">{r.role || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.company || "—"}</td>
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
    </div>
  );
}
