"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText, FileType2, Mail, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { useLang } from "@/lib/language";
import { EmptyState, ScoreRing, ScoreBar, FileResultCard } from "@/components/dashboard";
import { fetchResumes, getDocumentUrl, deleteResume, ResumeRecord } from "@/lib/supabase/resumes";

// Mirrors WEIGHTS in utils/ats_scorer.py — fallback only, used if an older
// saved row doesn't have ats_breakdown.weights yet.
const DEFAULT_ATS_WEIGHTS = {
  keyword_match: 40,
  skills_match: 35,
  education_match: 15,
  experience_match: 10,
};

// Rows per "My Resumes" page. Keeps each page's query/render cost bounded
// no matter how many resumes a Pro/Elite user has accumulated — see PART 1
// of the storage/retention rework.
const PAGE_SIZE = 20;

function formatDate(iso: string, lang: "en" | "ar") {
  try {
    return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/* ========================================================================
   LANGUAGE BADGE — shown in the table so a user can tell EN vs AR runs
   apart before opening a row.
======================================================================== */
function LanguageBadge({ cvLanguage, copy }: { cvLanguage: "en" | "ar"; copy: any }) {
  const isAr = cvLanguage === "ar";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        isAr ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"
      }`}
    >
      {isAr ? copy.languageBadge.ar : copy.languageBadge.en}
    </span>
  );
}

/* ========================================================================
   ROW DETAIL — expands under a clicked row with the same shape of summary
   the user sees right after a run: score ring + breakdown, job match
   reasoning, overall recommendation, and preview/download for both files.

   Files are no longer pulled from Storage — they're regenerated on demand
   from the saved generation_snapshot (see PART 1 of the storage/retention
   rework), via authenticated links to the backend's regenerate-document
   endpoint. Building the link itself is fast (just signs a URL with the
   current session token); the actual render happens when the link is
   opened/downloaded, same latency profile as the original generate flow's
   preview/download links.
======================================================================== */
function ResumeDetail({ resume, lang, copy, generateCopy }: { resume: ResumeRecord; lang: "en" | "ar"; copy: any; generateCopy: any }) {
  const [cvUrl, setCvUrl] = useState<string | null>(null);
  const [clUrl, setClUrl] = useState<string | null>(null);
  const [cvDownloadUrl, setCvDownloadUrl] = useState<string | null>(null);
  const [clDownloadUrl, setClDownloadUrl] = useState<string | null>(null);
  const [cvDocxDownloadUrl, setCvDocxDownloadUrl] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);

  const hasSnapshot = !!resume.generation_snapshot;

  useEffect(() => {
    if (!hasSnapshot) {
      setLoadingFiles(false);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    Promise.all([
      getDocumentUrl(resume.id, "cv-pdf"),
      getDocumentUrl(resume.id, "cover-letter-pdf"),
      getDocumentUrl(resume.id, "cv-pdf", { download: true }),
      getDocumentUrl(resume.id, "cover-letter-pdf", { download: true }),
      getDocumentUrl(resume.id, "cv-docx", { download: true }),
    ]).then(([cv, cl, cvDl, clDl, cvDocxDl]) => {
      if (cancelled) return;
      setCvUrl(cv);
      setClUrl(cl);
      setCvDownloadUrl(cvDl);
      setClDownloadUrl(clDl);
      setCvDocxDownloadUrl(cvDocxDl);
      setLoadingFiles(false);
    });
    return () => {
      cancelled = true;
    };
  }, [resume.id, hasSnapshot]);

  const weights = resume.ats_breakdown?.weights ?? DEFAULT_ATS_WEIGHTS;

  return (
    <div className="space-y-6 border-t border-slate-100 bg-slate-50/60 px-5 py-6 sm:px-6">
      <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <div className="flex justify-center sm:justify-start">
          <ScoreRing score={resume.ats_score} label={generateCopy.atsLabel} size={112} />
        </div>
        <div className="grid gap-3 content-center sm:grid-cols-2">
          <ScoreBar label={lang === "ar" ? "الكلمات المفتاحية" : "Keywords"} value={resume.ats_breakdown?.keyword_match ?? 0} />
          <ScoreBar label={lang === "ar" ? "المهارات" : "Skills"} value={resume.ats_breakdown?.skills_match ?? 0} />
          <ScoreBar label={lang === "ar" ? "التعليم" : "Education"} value={resume.ats_breakdown?.education_match ?? 0} />
          <ScoreBar label={lang === "ar" ? "الخبرة" : "Experience"} value={resume.ats_breakdown?.experience_match ?? 0} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">
            {resume.job_match_score}% · {copy.columns.match}
          </p>
          {resume.job_match_reason && (
            <>
              <p className="mt-2 text-xs font-medium text-slate-500">{copy.matchReasonLabel}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{resume.job_match_reason}</p>
            </>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            {resume.fact_check_passed ? (
              <span className="text-emerald-600">{copy.factCheckPassed}</span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertCircle className="size-3.5" aria-hidden /> {copy.factCheckFlagged}
              </span>
            )}
          </p>
          {resume.overall_recommendation && (
            <>
              <p className="mt-2 text-xs font-medium text-slate-500">{copy.recommendationLabel}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{resume.overall_recommendation}</p>
            </>
          )}
        </div>
      </div>

      {resume.tailored_summary && (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
          {resume.tailored_summary}
        </p>
      )}

      {!hasSnapshot ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-700">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>
            {lang === "ar"
              ? "هذه السيرة الذاتية أُنشئت قبل توفر إعادة التوليد عند الطلب، ولا تتوفر لها بيانات لإعادة إنشاء الملفات."
              : "This resume was saved before on-demand regeneration existed, so there's no saved data to rebuild the files from."}
          </span>
        </div>
      ) : loadingFiles ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.loading}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FileResultCard
              icon={FileText}
              title={generateCopy.resumeCardTitle}
              readyLabel={lang === "ar" ? "جاهز" : "Ready"}
              previewLabel={generateCopy.preview}
              downloadLabel={generateCopy.download}
              previewHref={cvUrl ?? "#"}
              downloadHref={cvDownloadUrl ?? "#"}
              disabled={!cvUrl}
            />
            {cvDocxDownloadUrl && (
              <a
                href={cvDocxDownloadUrl}
                className="ms-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <FileType2 className="size-3" aria-hidden />
                {lang === "ar" ? "تنزيل بصيغة Word" : "Download as Word"}
              </a>
            )}
          </div>
          <FileResultCard
            icon={Mail}
            title={generateCopy.coverLetterCardTitle}
            readyLabel={lang === "ar" ? "جاهز" : "Ready"}
            previewLabel={generateCopy.preview}
            downloadLabel={generateCopy.download}
            previewHref={clUrl ?? "#"}
            downloadHref={clDownloadUrl ?? "#"}
            disabled={!clUrl}
          />
        </div>
      )}
    </div>
  );
}

export default function MyResumesPage() {
  const { t, lang, dir } = useLang();
  const copy = t.dashboard.resumes;
  const generateCopy = t.dashboard.generate;

  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchResumes(page, PAGE_SIZE)
      .then(({ resumes, total }) => {
        if (cancelled) return;
        setResumes(resumes);
        setTotal(total);
      })
      .catch((err) => {
        console.error("fetchResumes failed:", err);
        if (!cancelled) setError(err?.message || err?.code || "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleDelete(resume: ResumeRecord) {
    const label = resume.role || copy.untitledRole;
    const confirmMsg =
      lang === "ar"
        ? `حذف "${label}"؟ لا يمكن التراجع عن هذا الإجراء.`
        : `Delete "${label}"? This can't be undone.`;
    if (!window.confirm(confirmMsg)) return;

    setDeleteError(null);
    setDeletingId(resume.id);

    // Optimistic removal — snapshot in case we need to roll back.
    const previous = resumes;
    setResumes((prev) => prev.filter((r) => r.id !== resume.id));
    if (expandedId === resume.id) setExpandedId(null);

    try {
      await deleteResume(resume.id);
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (err: any) {
      console.error("deleteResume failed:", err);
      setResumes(previous);
      setDeleteError(err?.message || "Failed to delete resume.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6" dir={dir}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

      {deleteError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-600">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{deleteError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.loading}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/60 py-16 text-sm text-rose-600">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden /> {copy.loadError}
          </span>
          <span className="font-mono text-xs text-rose-400">{error}</span>
        </div>
      ) : resumes.length === 0 ? (
        <EmptyState icon={FileText} title={copy.emptyTitle} body={copy.emptyBody} ctaLabel={copy.emptyCta} ctaHref="/dashboard" />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 text-start font-medium">{copy.columns.role}</th>
                  <th className="px-5 py-3 text-start font-medium">{copy.columns.company}</th>
                  <th className="px-5 py-3 text-start font-medium">{copy.columns.date}</th>
                  <th className="px-5 py-3 text-start font-medium">{copy.columns.language}</th>
                  <th className="px-5 py-3 text-start font-medium">{copy.columns.score}</th>
                  <th className="px-5 py-3 text-start font-medium">{copy.columns.match}</th>
                  <th className="px-5 py-3 text-end font-medium">{copy.columns.download}</th>
                  <th className="px-5 py-3 text-end font-medium" />
                </tr>
              </thead>
              <tbody>
                {resumes.map((resume) => {
                  const isExpanded = expandedId === resume.id;
                  const isDeleting = deletingId === resume.id;
                  return (
                    <React.Fragment key={resume.id}>
                      <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-5 py-3.5">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : resume.id)}
                            className="flex items-center gap-1.5 font-medium text-slate-900 hover:text-blue-600"
                          >
                            {resume.role || copy.untitledRole}
                            {isExpanded ? (
                              <ChevronUp className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                            ) : (
                              <ChevronDown className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                            )}
                          </button>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">{resume.company || copy.unknownCompany}</td>
                        <td className="px-5 py-3.5 text-slate-500">{formatDate(resume.created_at, lang)}</td>
                        <td className="px-5 py-3.5">
                          <LanguageBadge cvLanguage={resume.cv_language} copy={copy} />
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">{resume.ats_score}%</td>
                        <td className="px-5 py-3.5 text-slate-600">{resume.job_match_score}%</td>
                        <td className="px-5 py-3.5 text-end">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : resume.id)}
                            className="ms-auto text-xs font-medium text-blue-600 hover:text-blue-700"
                          >
                            {isExpanded ? copy.hideDetails : copy.viewDetails}
                          </button>
                        </td>
                        <td className="px-5 py-3.5 text-end">
                          <button
                            type="button"
                            onClick={() => handleDelete(resume)}
                            disabled={isDeleting}
                            aria-label={lang === "ar" ? "حذف" : "Delete"}
                            className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isDeleting ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="size-4" aria-hidden />
                            )}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <ResumeDetail resume={resume} lang={lang} copy={copy} generateCopy={generateCopy} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1 text-sm text-slate-500">
              <span>
                {lang === "ar"
                  ? `الصفحة ${page + 1} من ${totalPages} · ${total} إجمالاً`
                  : `Page ${page + 1} of ${totalPages} · ${total} total`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {dir === "rtl" ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronLeft className="size-3.5" aria-hidden />}
                  {lang === "ar" ? "السابق" : "Previous"}
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {lang === "ar" ? "التالي" : "Next"}
                  {dir === "rtl" ? <ChevronLeft className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
