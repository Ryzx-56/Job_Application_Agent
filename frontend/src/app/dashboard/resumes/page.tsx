"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Mail, Loader2, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/language";
import { EmptyState, ScoreRing, ScoreBar, FileResultCard } from "@/components/dashboard";
import { fetchResumes, getSignedFileUrl, ResumeRecord } from "@/lib/supabase/resumes";

// Mirrors WEIGHTS in utils/ats_scorer.py — fallback only, used if an older
// saved row doesn't have ats_breakdown.weights yet.
const DEFAULT_ATS_WEIGHTS = {
  keyword_match: 40,
  skills_match: 35,
  education_match: 15,
  experience_match: 10,
};

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
======================================================================== */
function ResumeDetail({ resume, lang, copy, generateCopy }: { resume: ResumeRecord; lang: "en" | "ar"; copy: any; generateCopy: any }) {
  const [cvUrl, setCvUrl] = useState<string | null>(null);
  const [clUrl, setClUrl] = useState<string | null>(null);
  const [cvDownloadUrl, setCvDownloadUrl] = useState<string | null>(null);
  const [clDownloadUrl, setClDownloadUrl] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingFiles(true);
    Promise.all([
      getSignedFileUrl(resume.cv_storage_path),
      getSignedFileUrl(resume.cover_letter_storage_path),
      getSignedFileUrl(resume.cv_storage_path, { download: true }),
      getSignedFileUrl(resume.cover_letter_storage_path, { download: true }),
    ]).then(([cv, cl, cvDl, clDl]) => {
      if (cancelled) return;
      setCvUrl(cv);
      setClUrl(cl);
      setCvDownloadUrl(cvDl);
      setClDownloadUrl(clDl);
      setLoadingFiles(false);
    });
    return () => {
      cancelled = true;
    };
  }, [resume.id, resume.cv_storage_path, resume.cover_letter_storage_path]);

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

      <div className="grid gap-3 sm:grid-cols-2">
        {loadingFiles ? (
          <div className="col-span-2 flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.loading}
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

export default function MyResumesPage() {
  const { t, lang, dir } = useLang();
  const copy = t.dashboard.resumes;
  const generateCopy = t.dashboard.generate;

  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchResumes()
      .then((data) => {
        if (!cancelled) setResumes(data);
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
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6" dir={dir}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

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
              </tr>
            </thead>
            <tbody>
              {resumes.map((resume) => {
                const isExpanded = expandedId === resume.id;
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
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="p-0">
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
      )}
    </div>
  );
}
