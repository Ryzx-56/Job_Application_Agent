"use client";

import React, { useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileUp,
  PenLine,
  FileText,
  Mail,
  TrendingUp,
} from "lucide-react";
import { useLang } from "@/lib/language";
import { DashboardButton, ScoreRing, ScoreBar, UploadZone, FileResultCard } from "@/components/dashboard";
import { createClient } from "@/lib/supabase/client";
import { ManualCvForm, ManualCvData, emptyManualCvData } from "@/components/manual-cv-form";

type TailoredBullet = {
  original: string;
  tailored: string;
  relevance_score: number;
};

type SimilarJob = {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
  match_label?: string;
};

type AtsBreakdown = {
  keyword_match?: number;
  skills_match?: number;
  education_match?: number;
  experience_match?: number;
  matched_keywords?: string[];
  unmatched_keywords?: string[];
  matched_skills?: string[];
  missing_skills?: string[];
};

type GapItem = {
  skill: string;
  importance: "required" | "preferred";
  how_to_close: string;
};

type GenerateResult = {
  atsScore: number;
  atsBreakdown: AtsBreakdown;
  jobMatchScore: number;
  jobMatchReason: string;
  tailoredSummary: string;
  tailoredBullets: TailoredBullet[];
  coverLetterText: string;
  similarJobs: SimilarJob[];
  factCheckPassed: boolean;
  gapAnalysis: GapItem[];
  overallRecommendation: string;
};

// Base URL for the FastAPI backend, e.g. http://127.0.0.1:8000 in dev.
const API_URL = process.env.NEXT_PUBLIC_API_URL;

function mapBackendResponse(raw: any): GenerateResult {
  return {
    atsScore: raw.ats_score ?? 0,
    atsBreakdown: raw.ats_breakdown ?? {},
    jobMatchScore: raw.job_match_score ?? 0,
    jobMatchReason: raw.job_match_reason ?? "",
    tailoredSummary: raw.tailored_summary ?? "",
    tailoredBullets: raw.tailored_bullets ?? [],
    coverLetterText: raw.cover_letter_text ?? "",
    similarJobs: raw.similar_jobs ?? [],
    factCheckPassed: raw.fact_check_passed ?? false,
    gapAnalysis: raw.gap_analysis ?? [],
    overallRecommendation: raw.overall_recommendation ?? "",
  };
}

/**
 * Upload flow — sends an actual CV file + job description (+ optional
 * additional info) to the backend as multipart form data.
 */
async function generateFromUpload(
  cv: File,
  jobDescription: string,
  additionalInfo: string
): Promise<GenerateResult> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  const formData = new FormData();
  formData.append("cv", cv);
  formData.append("job_description", jobDescription);
  formData.append("additional_info", additionalInfo);

  const res = await fetch(`${API_URL}/api/v1/optimize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  return mapBackendResponse(await res.json());
}

/**
 * Converts the flat "Create New CV" form state into the nested JSON shape
 * the backend's ManualCVRequest schema expects.
 */
function buildManualPayload(data: ManualCvData, jobDescription: string, additionalInfo: string) {
  return {
    personal: {
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      linkedin: data.linkedin || null,
      location: data.location || null,
    },
    education: data.education
      .filter((e) => e.institution || e.degree)
      .map((e) => ({
        institution: e.institution,
        degree: e.degree,
        gpa: e.gpa || null,
        graduation_year: e.graduation_year || null,
      })),
    experience: data.experience
      .filter((e) => e.company || e.title)
      .map((e) => ({
        company: e.company,
        title: e.title,
        dates: e.dates || null,
        bullets: e.bullets
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean),
      })),
    projects: data.projects
      .filter((p) => p.name)
      .map((p) => ({
        name: p.name,
        tech_stack: p.tech_stack
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        description: p.description || null,
      })),
    certifications: data.certifications.map((c) => c.name).filter(Boolean),
    skills: {
      other: data.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    job_description: jobDescription,
    additional_info: additionalInfo || "",
  };
}

/**
 * Manual entry flow — sends structured form data as JSON to the
 * dedicated manual-entry endpoint.
 */
async function generateFromManual(
  data: ManualCvData,
  jobDescription: string,
  additionalInfo: string
): Promise<GenerateResult> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  const payload = buildManualPayload(data, jobDescription, additionalInfo);

  const res = await fetch(`${API_URL}/api/v1/optimize-manual`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  return mapBackendResponse(await res.json());
}

/**
 * Color-codes a similar-job match label into a glassy badge style.
 * jobs_finder.py emits exactly one of: "Strong Match", "Partial Match", "Stretch Role".
 */
function getMatchBadgeStyle(label?: string): { classes: string; dot: string } {
  const normalized = (label || "").toLowerCase();
  if (normalized.includes("strong")) {
    return { classes: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200", dot: "bg-emerald-400" };
  }
  if (normalized.includes("partial")) {
    return { classes: "border-amber-400/40 bg-amber-400/15 text-amber-200", dot: "bg-amber-400" };
  }
  if (normalized.includes("stretch")) {
    return { classes: "border-rose-400/40 bg-rose-400/15 text-rose-200", dot: "bg-rose-400" };
  }
  return { classes: "border-white/20 bg-white/10 text-white/80", dot: "bg-white/50" };
}

export default function DashboardHomePage() {
  const { t, dir, lang } = useLang();
  const copy = t.dashboard.generate;

  const [cvMode, setCvMode] = useState<"upload" | "manual">("upload");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [manualData, setManualData] = useState<ManualCvData>(emptyManualCvData);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");
  const [showAllBullets, setShowAllBullets] = useState(false);

  const canGenerate =
    (cvMode === "upload" ? !!cvFile : manualData.name.trim().length > 0) &&
    jobDescription.trim().length > 0 &&
    !generating;

  async function handleGenerate() {
    setError("");
    if (cvMode === "upload" && (!cvFile || !jobDescription.trim())) {
      setError(copy.missingFields);
      return;
    }
    if (cvMode === "manual" && (!manualData.name.trim() || !jobDescription.trim())) {
      setError(copy.missingFields);
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const data =
        cvMode === "upload"
          ? await generateFromUpload(cvFile!, jobDescription, additionalInfo)
          : await generateFromManual(manualData, jobDescription, additionalInfo);
      setResult(data);
    } catch (err) {
      console.error(err);
      setError(
        lang === "ar"
          ? "حدث خطأ ما أثناء إعداد طلبك. يرجى المحاولة مرة أخرى."
          : "Something went wrong generating your application. Please try again."
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8" dir={dir}>
      <div>
        <span className="text-sm font-medium text-blue-600">{copy.eyebrow}</span>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">{copy.uploadLabel}</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setCvMode("manual")}
              className={`flex items-start gap-3 rounded-xl border-2 px-5 py-4 transition-all ${
                lang === "ar" ? "text-right" : "text-left"
              } ${
                cvMode === "manual"
                  ? "border-blue-500 bg-blue-50/60 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span
                className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${
                  cvMode === "manual" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                <PenLine className="size-4" aria-hidden />
              </span>
              <span>
                <p className="text-sm font-medium text-slate-900">
                  {lang === "ar" ? "إنشاء سيرة ذاتية جديدة" : "Create new CV"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {lang === "ar" ? "أدخل بياناتك يدويًا بالتفصيل" : "Fill in your details manually"}
                </p>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCvMode("upload")}
              className={`flex items-start gap-3 rounded-xl border-2 px-5 py-4 transition-all ${
                lang === "ar" ? "text-right" : "text-left"
              } ${
                cvMode === "upload"
                  ? "border-blue-500 bg-blue-50/60 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span
                className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${
                  cvMode === "upload" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                <FileUp className="size-4" aria-hidden />
              </span>
              <span>
                <p className="text-sm font-medium text-slate-900">
                  {lang === "ar" ? "رفع سيرة ذاتية الحالية" : "Upload existing CV"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {lang === "ar" ? "اسحب وأفلت ملف PDF أو DOCX" : "Drag & drop a PDF or DOCX"}
                </p>
              </span>
            </button>
          </div>
        </div>

        {cvMode === "upload" ? (
          <UploadZone
            file={cvFile}
            onFileSelect={setCvFile}
            onRemove={() => setCvFile(null)}
            label={copy.uploadLabel}
            hint={copy.uploadHint}
            parsedLabel={copy.uploadedLabel}
            removeLabel={copy.removeFile}
          />
        ) : (
          <ManualCvForm value={manualData} onChange={setManualData} />
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            {lang === "ar" ? "معلومات إضافية" : "Additional information"}{" "}
            <span className="text-slate-400">({lang === "ar" ? "اختياري" : "optional"})</span>
          </label>
          <textarea
            rows={3}
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder={
              lang === "ar"
                ? "أي شيء آخر يستحق الإضافة ولم يتم ذكره أعلاه — جوائز، أعمال تطوعية، لغات، سياق حول فجوة مهنية، إلخ."
                : "Anything else worth including that isn't captured above — awards, volunteer work, languages, context about a gap, etc."
            }
            className="block w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div>
          <label htmlFor="jobDescription" className="mb-2 block text-sm font-medium text-slate-700">
            {copy.jdLabel}
          </label>
          <textarea
            id="jobDescription"
            rows={7}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder={copy.jdPlaceholder}
            className="block w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600">
            {error}
          </p>
        )}

        <DashboardButton
          type="button"
          size="lg"
          disabled={!canGenerate}
          onClick={handleGenerate}
          className="w-full sm:w-auto"
        >
          <Sparkles className={`size-4 ${generating ? "animate-pulse" : ""}`} aria-hidden />
          {generating ? copy.generatingCta : copy.generateCta}
        </DashboardButton>
      </div>

      {(generating || result) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                {generating
                  ? lang === "ar"
                    ? "جارٍ إنشاء سيرتك الذاتية وخطاب التقديم"
                    : "Creating your new CV and cover letter"
                  : lang === "ar"
                  ? "تم التحسين"
                  : "Optimized"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {generating
                  ? lang === "ar"
                    ? "يستغرق الأمر بضع لحظات لأننا نستخدم عدة وكلاء ذكاء اصطناعي متخصصين لضمان أفضل جودة."
                    : "This takes a few moments — we run several specialized AI agents in sequence to make sure everything is accurate and polished."
                  : lang === "ar"
                  ? "سيرتك الذاتية وخطاب التقديم جاهزان أدناه."
                  : "Your tailored CV and cover letter are ready below."}
              </p>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                generating ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
              }`}
            >
              <CheckCircle2 className="size-3.5" aria-hidden />
              {generating ? (lang === "ar" ? "جارٍ الإنشاء" : "Generating") : lang === "ar" ? "محسّن" : "Optimized"}
            </span>
          </div>

          {generating && (
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-1/3 rounded-full bg-blue-600 animate-jbaa-loading-bar" />
            </div>
          )}

          <style>{`
            @keyframes jbaa-loading-bar-slide {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(340%); }
            }
            .animate-jbaa-loading-bar {
              animation: jbaa-loading-bar-slide 1.15s ease-in-out infinite;
            }
          `}</style>
        </div>
      )}

      {result && (
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-semibold text-slate-900">{copy.resultsTitle}</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
              <div className="flex items-center gap-4">
                <ScoreRing score={result.atsScore} size={88} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {lang === "ar" ? "نتيجة نظام ATS" : "ATS Score"}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {lang === "ar"
                      ? "تطابق الكلمات المفتاحية، المهارات، التعليم والخبرة مع متطلبات هذه الوظيفة."
                      : "Keyword, skills, education & experience match against this job's requirements."}
                  </p>
                </div>
              </div>

              {(result.atsBreakdown.keyword_match !== undefined ||
                result.atsBreakdown.skills_match !== undefined ||
                result.atsBreakdown.education_match !== undefined ||
                result.atsBreakdown.experience_match !== undefined) && (
                <div className="mt-4 space-y-3">
                  {result.atsBreakdown.keyword_match !== undefined && (
                    <ScoreBar
                      label={lang === "ar" ? "الكلمات المفتاحية" : "Keywords"}
                      value={result.atsBreakdown.keyword_match}
                    />
                  )}
                  {result.atsBreakdown.skills_match !== undefined && (
                    <ScoreBar
                      label={lang === "ar" ? "المهارات" : "Skills"}
                      value={result.atsBreakdown.skills_match}
                    />
                  )}
                  {result.atsBreakdown.education_match !== undefined && (
                    <ScoreBar
                      label={lang === "ar" ? "التعليم" : "Education"}
                      value={result.atsBreakdown.education_match}
                    />
                  )}
                  {result.atsBreakdown.experience_match !== undefined && (
                    <ScoreBar
                      label={lang === "ar" ? "الخبرة" : "Experience"}
                      value={result.atsBreakdown.experience_match}
                    />
                  )}
                </div>
              )}

              {(result.atsBreakdown.missing_skills?.length ?? 0) > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {result.atsBreakdown.missing_skills!.slice(0, 5).map((kw) => (
                    <span
                      key={kw}
                      className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                    >
                      {lang === "ar" ? "مفقود:" : "missing:"} {kw}
                    </span>
                  ))}
                </div>
              )}

              {result.gapAnalysis.length > 0 && (
                <a
                  href="#improve-cv"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <TrendingUp className="size-3.5" aria-hidden />
                  {lang === "ar"
                    ? "راجع «كيف تُحسّن سيرتك الذاتية» أدناه لرفع هذه النتيجة"
                    : "See “How to improve your CV” below to raise this score"}
                </a>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
              <div className="flex items-center gap-4">
                <ScoreRing score={result.jobMatchScore} size={88} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {lang === "ar" ? "نتيجة الملاءمة للوظيفة" : "Job Match Score"}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {lang === "ar"
                      ? "تقييم لمدى ملاءمة خلفيتك المهنية الحقيقية لهذه الوظيفة المحددة."
                      : "Judgment of how well your background genuinely fits this specific role."}
                  </p>
                </div>
              </div>
              {result.jobMatchReason && (
                <p className="mt-4 text-xs leading-relaxed text-slate-600">{result.jobMatchReason}</p>
              )}
            </div>
          </div>

          {result.gapAnalysis.length > 0 && (
            <div id="improve-cv" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
                  <TrendingUp className="size-4" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-slate-900">
                  {lang === "ar" ? "كيف تُحسّن سيرتك الذاتية" : "How to improve your CV"}
                </p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                {lang === "ar"
                  ? "أضف أيًا من هذه إلى ملفك، ثم أعد الرفع لرؤية نتيجة ATS أعلى."
                  : "Add any of these to your profile, then re-upload or re-generate to see a higher ATS score."}
              </p>

              <ul className="mt-4 space-y-2.5">
                {result.gapAnalysis.map((gap, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3.5 py-3"
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        gap.importance === "required" ? "bg-rose-400" : "bg-amber-400"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                        {gap.skill}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            gap.importance === "required"
                              ? "bg-rose-50 text-rose-600"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {gap.importance === "required"
                            ? lang === "ar"
                              ? "مطلوب"
                              : "required"
                            : lang === "ar"
                            ? "مُفضّل"
                            : "preferred"}
                        </span>
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{gap.how_to_close}</p>
                    </div>
                  </li>
                ))}
              </ul>

              {result.overallRecommendation && (
                <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 px-3.5 py-2.5 text-xs leading-relaxed text-blue-700">
                  {result.overallRecommendation}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">
              {lang === "ar" ? "ملخص مخصص" : "Tailored summary"}
            </p>
            <p className="text-sm leading-relaxed text-slate-600">{result.tailoredSummary}</p>
            {!result.factCheckPassed && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {lang === "ar"
                  ? "لم يجتز فحص الحقائق بالكامل — يرجى مراجعة النقاط المُنشأة قبل إرسالها."
                  : "Fact check did not fully pass — review the generated bullets before sending this out."}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2.5 text-sm font-medium text-slate-700">
              {lang === "ar" ? "ملفاتك جاهزة" : "Your files"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FileResultCard
                icon={FileText}
                title={copy.resumeCardTitle}
                readyLabel={lang === "ar" ? "جاهز" : "Ready"}
                previewLabel={copy.preview}
                downloadLabel={copy.download}
                previewHref={`${API_URL}/api/v1/preview/cv`}
                downloadHref={`${API_URL}/api/v1/download/cv`}
              />
              <FileResultCard
                icon={Mail}
                title={copy.coverLetterCardTitle}
                readyLabel={lang === "ar" ? "جاهز" : "Ready"}
                previewLabel={copy.preview}
                downloadLabel={copy.download}
                previewHref={`${API_URL}/api/v1/preview/cover-letter`}
                downloadHref={`${API_URL}/api/v1/download/cover-letter`}
              />
            </div>
          </div>

          {result.similarJobs.length > 0 && (
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0B1220] via-[#0F1E3D] to-[#122952] p-6 shadow-lg shadow-blue-950/20 sm:p-8">
              <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-blue-500/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-10 size-56 rounded-full bg-cyan-400/10 blur-3xl" />

              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-cyan-300 ring-1 ring-white/20">
                    <Sparkles className="size-4" aria-hidden />
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
                    {lang === "ar" ? "بحث تلقائي بالذكاء الاصطناعي" : "Found automatically by AI"}
                  </p>
                </div>
                <h3 className="mt-2.5 text-xl font-bold text-white sm:text-2xl">
                  {lang === "ar" ? "وظائف مشابهة، مطابقة لك" : "Similar jobs, matched for you"}
                </h3>
                <p className="mt-1 text-sm text-white/60">
                  {lang === "ar"
                    ? "بناءً على سيرتك الذاتية المخصصة، هذه أقرب الفرص المتاحة الآن."
                    : "Based on your tailored CV, here's what's actually open right now."}
                </p>

                <ul className="mt-5 space-y-3">
                  {result.similarJobs.map((job, i) => {
                    const badge = getMatchBadgeStyle(job.match_label);
                    return (
                      <li key={i}>
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group block rounded-xl border border-white/10 bg-white/[0.06] px-4 py-4 backdrop-blur-md transition-all hover:border-cyan-300/40 hover:bg-white/[0.1] sm:px-5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-base font-semibold text-white sm:text-[17px]">
                              {job.title ?? job.url}
                            </p>
                            {job.match_label && (
                              <span
                                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur-sm ${badge.classes}`}
                              >
                                <span className={`size-1.5 rounded-full ${badge.dot}`} aria-hidden />
                                {job.match_label}
                              </span>
                            )}
                          </div>
                          {job.snippet && (
                            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-white/60">
                              {job.snippet}
                            </p>
                          )}
                          {job.source && <p className="mt-2 text-xs text-white/35">{job.source}</p>}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          <div>
            <p className="mb-2.5 text-sm font-medium text-slate-700">
              {lang === "ar" ? "نقاط سيرتك الذاتية المخصصة" : "Your tailored CV points"}
            </p>
            <ul className="space-y-2.5">
              {(showAllBullets ? result.tailoredBullets : result.tailoredBullets.slice(0, 2)).map((bullet, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
                    <Sparkles className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-slate-700">{bullet.tailored}</p>
                    {typeof bullet.relevance_score === "number" && (
                      <span className="mt-1.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {Math.round(bullet.relevance_score * 100)}% {lang === "ar" ? "ملاءمة" : "relevant"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {result.tailoredBullets.length > 2 && (
              <button
                type="button"
                onClick={() => setShowAllBullets((v) => !v)}
                className="mt-3 flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {showAllBullets ? (
                  <>
                    {lang === "ar" ? "عرض أقل" : "Show fewer"} <ChevronUp className="size-4" aria-hidden />
                  </>
                ) : (
                  <>
                    {lang === "ar"
                      ? `عرض المزيد (${result.tailoredBullets.length - 2})`
                      : `Show ${result.tailoredBullets.length - 2} more`}{" "}
                    <ChevronDown className="size-4" aria-hidden />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
