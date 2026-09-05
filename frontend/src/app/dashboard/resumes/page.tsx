"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText, FileType2, Mail, Loader2, AlertCircle, Trash2, Briefcase, ExternalLink } from "lucide-react";
import { useLang } from "@/lib/language";
import { EmptyState, ScoreRing, ScoreBar, FileResultCard } from "@/components/dashboard";
import { fetchResumes, getDocumentUrl, deleteResume, ResumeRecord } from "@/lib/supabase/resumes";
import { MATCH_TIER_COPY, getMatchTier, type MatchTier, type SimilarJob } from "@/lib/jobMatch";
import { formatMediumDate } from "@/lib/pricing";

// Mirrors WEIGHTS in utils/ats_scorer.py — fallback only, used if an older
// saved row doesn't have ats_breakdown.weights yet.
// Mirrors utils/ats_scorer.py's WEIGHTS — see the note on the copy in
// dashboard/page.tsx. Fallback only; the real values arrive per resume.
const DEFAULT_ATS_WEIGHTS = {
  skills_match: 40,
  keyword_match: 25,
  title_match: 15,
  experience_match: 12,
  education_match: 8,
};

// Rows per "My Resumes" page. Keeps each page's query/render cost bounded
// no matter how many resumes a Pro/Elite user has accumulated — see PART 1
// of the storage/retention rework.
const PAGE_SIZE = 20;

// Dates come through the shared formatter so an Arabic row doesn't show
// Eastern Arabic numerals next to Western-digit scores and page numbers —
// see formatMediumDate in @/lib/pricing for the whole reasoning.
const formatDate = formatMediumDate;

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
   JOB COUNT — how many listings were saved with a resume, shown on the
   COLLAPSED row so the jobs are discoverable without opening the row first.

   Reads the same resume.similar_jobs array the expanded panel renders —
   already fetched with the row, so this costs nothing extra.

   Deliberately not a filled pill: the row is already carrying a language
   badge and two percentages, and a third coloured chip would turn a data
   row into a badge collection. A muted icon and count sits underneath the
   role as metadata, which is what it is. Renders nothing at zero — "0 jobs"
   is noise on every older row that predates job search.
======================================================================== */
/** One score, label above the number.
 *
 *  These were table columns. Out of a table they need their own label, and
 *  the label has to sit with the number rather than in a header row far
 *  away — that is the whole reason the old layout needed 720px it did not
 *  have. tabular-nums so a column of cards keeps its digits aligned. */
function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="text-end">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="block text-sm font-semibold tabular-nums text-slate-900">
        {value === null || value === undefined ? "—" : `${value}%`}
      </span>
    </span>
  );
}


function JobCount({ count, copy }: { count: number; copy: any }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <Briefcase className="size-3 shrink-0 text-slate-400" aria-hidden />
      {copy.jobsCount(count)}
    </span>
  );
}

/* ========================================================================
   DELETE BUTTON — shared by the mobile card and the desktop table so the
   two layouts can't drift on hit area, disabled state or aria-label.
======================================================================== */
function DeleteButton({
  onClick,
  isDeleting,
  lang,
}: {
  onClick: () => void;
  isDeleting: boolean;
  lang: "en" | "ar";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDeleting}
      aria-label={lang === "ar" ? "حذف" : "Delete"}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isDeleting ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="size-4" aria-hidden />
      )}
    </button>
  );
}

/* ========================================================================
   MATCH BADGE — the light-theme counterpart to the dashboard panel's glassy
   badge. Same tiers and same wording (both read @/lib/jobMatch); only the
   palette differs, because this list sits on white rather than on the
   dashboard's dark gradient.
======================================================================== */
const MATCH_BADGE_CLASSES: Record<MatchTier, string> = {
  strong: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  stretch: "border-rose-200 bg-rose-50 text-rose-700",
};

/* ========================================================================
   JOBS FOUND — the listings jobs_finder.py returned for this resume at
   generation time, read straight off the saved row.

   NO SEARCH RUNS HERE. resumes.similar_jobs is written once by
   saveResumeResult and fetchResumes already does select("*"), so these
   listings arrive with the row the page has loaded anyway — this is a
   pure render of stored data, not a second trip to Tavily.

   Older rows can legitimately have an empty array (saved before job search
   existed, or a run that genuinely matched nothing), which is why the empty
   case says nothing was SAVED rather than nothing was found.
======================================================================== */
function ResumeJobs({ jobs, lang, copy }: { jobs: SimilarJob[]; lang: "en" | "ar"; copy: any }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
          <Briefcase className="size-3.5" aria-hidden />
        </span>
        <p className="text-sm font-semibold text-slate-900">{copy.jobsTitle}</p>
        {jobs.length > 0 && (
          <span className="text-xs font-medium text-slate-500">· {copy.jobsCount(jobs.length)}</span>
        )}
      </div>

      {jobs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{copy.jobsEmpty}</p>
      ) : (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{copy.jobsSub}</p>
          <ul className="mt-3 space-y-2">
            {jobs.map((job, i) => {
              const tier = getMatchTier(job);
              const title = job.title || job.url;
              // A listing with neither a title nor a URL has nothing to show
              // and nowhere to go — skip it rather than render a dead row.
              if (!title) return null;
              return (
                <li key={job.url ?? i}>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-snug text-slate-900 group-hover:text-blue-700">
                        {title}
                      </p>
                      {tier && (
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${MATCH_BADGE_CLASSES[tier]}`}
                        >
                          {MATCH_TIER_COPY[tier][lang === "ar" ? "ar" : "en"]}
                        </span>
                      )}
                    </div>
                    {job.snippet && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{job.snippet}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                      {job.source && <span className="truncate">{job.source}</span>}
                      {job.url && (
                        <span className="inline-flex items-center gap-1 text-blue-600 group-hover:text-blue-700">
                          <ExternalLink className="size-3 shrink-0" aria-hidden />
                          <span className="sr-only">{copy.jobsOpen}</span>
                        </span>
                      )}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
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
          {/* Ordered by weight, heaviest first, to match the ATS card on the
              dashboard and WEIGHTS in utils/ats_scorer.py. title_match is
              optional because resumes generated before it existed have no
              value stored for it — those rows simply omit the bar rather
              than showing a misleading 0. */}
          <ScoreBar label={lang === "ar" ? "المهارات" : "Skills"} value={resume.ats_breakdown?.skills_match ?? 0} />
          <ScoreBar label={lang === "ar" ? "الكلمات المفتاحية" : "Keywords"} value={resume.ats_breakdown?.keyword_match ?? 0} />
          {resume.ats_breakdown?.title_match !== undefined && (
            <ScoreBar label={lang === "ar" ? "المسمى الوظيفي" : "Job title"} value={resume.ats_breakdown.title_match} />
          )}
          <ScoreBar label={lang === "ar" ? "الخبرة" : "Experience"} value={resume.ats_breakdown?.experience_match ?? 0} />
          <ScoreBar label={lang === "ar" ? "التعليم" : "Education"} value={resume.ats_breakdown?.education_match ?? 0} />
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

      {/* similar_jobs is a JSONB column that can be null on rows written
          before job search shipped — coalesce before handing it on. */}
      <ResumeJobs jobs={resume.similar_jobs ?? []} lang={lang} copy={copy} />

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
          {/* ── ONE LIST, EVERY WIDTH ──────────────────────────────────────
              There used to be two of these: a card list under md and an
              eight-column table above it, each with its own markup for the
              same eight fields. Both were wrong. The table carried
              min-w-[720px] inside a dashboard whose content column is
              narrower than that once the sidebar is out, so it scrolled
              sideways on a laptop and clipped on a phone, and the two
              implementations had already drifted apart in what they showed.

              A saved CV is not tabular data anyone scans down a column of —
              it is a list of things with a name, a couple of scores and two
              actions. So it is a list, and it reflows instead of switching
              layouts: the header row wraps its own parts, the scores sit
              beside the title when there is room and beneath it when there
              is not, and nothing anywhere scrolls horizontally. */}
          <ul className="space-y-3">
            {resumes.map((resume) => {
              const isExpanded = expandedId === resume.id;
              const isDeleting = deletingId === resume.id;
              const jobCount = (resume.similar_jobs ?? []).length;
              return (
                <li
                  key={resume.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="flex items-start gap-3 p-4 sm:p-5">
                    {/* The whole identity block is the expand target, so the
                        hit area is the card rather than a small chevron. */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : resume.id)}
                      aria-expanded={isExpanded}
                      className="min-w-0 flex-1 rounded text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                        {/* min-w forces the scores onto their own line
                            rather than letting them squeeze the job title
                            down to a few characters — which is what a phone
                            width does otherwise. Content decides the wrap;
                            there is no breakpoint here. */}
                        <p className="min-w-[14rem] flex-1 truncate font-medium text-slate-900">
                          {resume.role || copy.untitledRole}
                        </p>
                        {/* Right-aligned beside the title on a wide card,
                            wrapped underneath it on a narrow one. No
                            breakpoint decides this; the content does. */}
                        <div className="flex shrink-0 items-baseline gap-4">
                          <Stat label={copy.columns.score} value={resume.ats_score} />
                          <Stat label={copy.columns.match} value={resume.job_match_score} />
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-600">
                        {/* No middot separators. In a wrapping row they
                            strand themselves at the end of a line with
                            nothing after them, which is what a bullet
                            between two wrapped items always does. The gap
                            separates these perfectly well. */}
                        <span className="min-w-0 truncate">
                          {resume.company || copy.unknownCompany}
                        </span>
                        <span className="whitespace-nowrap text-slate-500">
                          {formatDate(resume.created_at, lang)}
                        </span>
                        <LanguageBadge cvLanguage={resume.cv_language} copy={copy} />
                        <JobCount count={jobCount} copy={copy} />
                      </div>
                    </button>

                    <DeleteButton onClick={() => handleDelete(resume)} isDeleting={isDeleting} lang={lang} />
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : resume.id)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs font-medium text-blue-700 hover:bg-slate-100/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                  >
                    {isExpanded ? copy.hideDetails : copy.viewDetails}
                    {isExpanded ? (
                      <ChevronUp className="size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                    )}
                  </button>

                  {isExpanded && (
                    <ResumeDetail resume={resume} lang={lang} copy={copy} generateCopy={generateCopy} />
                  )}
                </li>
              );
            })}
          </ul>

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
