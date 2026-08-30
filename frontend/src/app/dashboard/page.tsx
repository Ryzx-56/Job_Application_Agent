"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
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
  HelpCircle,
  Languages,
  Palette,
  X,
  Download,
  Eye,
  FileType2,
  MapPin,
  AlertTriangle,
} from "lucide-react";
import { useLang } from "@/lib/language";
import { MATCH_TIER_COPY, getMatchTier, type MatchTier, type SimilarJob } from "@/lib/jobMatch";
import { CreditsButton } from "@/components/CreditsButton";
import { DashboardButton, ScoreRing, ScoreBar, UploadZone, FileResultCard } from "@/components/dashboard";
import { AgentProgress } from "@/components/agent-progress";
import { useOptimizeStream } from "@/lib/useOptimizeStream";
import { createClient } from "@/lib/supabase/client";
import { ManualCvForm, ManualCvData, emptyManualCvData } from "@/components/manual-cv-form";
import { saveResumeResult } from "@/lib/supabase/resumes";
import { fetchCredits } from "@/lib/supabase/credits";
import { updateProfileNames, suggestNameFromCv, fetchAdminStatus, fetchBadges, markBadgesSeen } from "@/lib/supabase/profile-names";
import { BadgeUnlockModal } from "@/components/badge-unlock";
import { RoleBadges, BadgeKey } from "@/components/badges";

// Detects Arabic script. Used only to decide whether a manually-typed name
// can be offered back as an Arabic suggestion — never to transform a name.
const ARABIC_TEXT_RE = /[؀-ۿ]/;

type TailoredBullet = {
  original: string;
  tailored: string;
  relevance_score: number;
};

// MatchTier / SimilarJob / MATCH_TIER_COPY / getMatchTier moved to
// @/lib/jobMatch so the My Resumes page renders the same saved listings
// through the same tier logic — see that file's header for why a second
// copy was the wrong answer.

type AtsBreakdown = {
  skills_match?: number;
  keyword_match?: number;
  title_match?: number;
  experience_match?: number;
  education_match?: number;
  matched_keywords?: string[];
  unmatched_keywords?: string[];
  matched_skills?: string[];
  missing_skills?: string[];
  matched_preferred_skills?: string[];
  // Weight each factor carries toward the overall ATS score (percent),
  // sent by ats_scorer.py so this always matches the backend exactly
  // instead of a hardcoded guess on the frontend.
  weights?: {
    skills_match?: number;
    keyword_match?: number;
    title_match?: number;
    experience_match?: number;
    education_match?: number;
  };
};

// Fallback only — used if an older backend response doesn't include
// atsBreakdown.weights yet. Mirrors WEIGHTS in utils/ats_scorer.py.
// Fallback only — the real weights ride in atsBreakdown.weights from
// utils/ats_scorer.py. Kept in sync with WEIGHTS there; skills leads because
// a named skill is the most concrete claim on a CV, and title_match exists
// because real ATS engines weight the role you have held heavily.
const DEFAULT_ATS_WEIGHTS = {
  skills_match: 40,
  keyword_match: 25,
  title_match: 15,
  experience_match: 12,
  education_match: 8,
};

type GapItem = {
  skill: string;
  importance: "required" | "preferred";
  how_to_close: string;
};

type GenerateResult = {
  requestId: string;
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
  jobTitle: string;
  company: string;
  // Small structured payload (facts_json, tailored_* fields, cover letter
  // text, template_id) the backend needs to REGENERATE the PDF/DOCX on
  // demand later — see backend/main.py's build_generation_snapshot. Saved
  // verbatim into resumes.generation_snapshot; the rendered files
  // themselves are no longer stored anywhere. Opaque here on purpose — the
  // frontend never needs to read into its shape, only round-trip it.
  generationSnapshot: unknown;
};

// Base URL for the FastAPI backend, e.g. http://127.0.0.1:8000 in dev.
const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Mirrors utils/template_registry.py's TEMPLATE_REGISTRY keys exactly — if
// you add a template on the backend, add its id/label pair here too so it
// shows up in the picker. Deliberately does NOT include the cover letter
// template; this list is CV-only.
// `thumbnail` points at /public/templates/<id>.png — a real render of each
// template with the same sample candidate, produced by
// backend/tools/generate_template_thumbs.py. Re-run it whenever a
// template's HTML changes.
// `photo: true` mirrors the backend registry's photo flag: the template has
// a slot for the candidate's picture, extracted from the uploaded CV. The
// slot is optional — these templates lay out correctly for someone whose CV
// has no photo in it, so this is a label, not a requirement.
const CV_TEMPLATES: { id: string; label: string; labelAr: string; accent: string; thumbnail: string; photo?: boolean }[] = [
  { id: "original_classic", label: "Classic (Default)", labelAr: "الكلاسيكي (الافتراضي)", accent: "#1a1a1a", thumbnail: "/templates/original_classic.png" },
  { id: "classic_serif", label: "Classic Serif", labelAr: "كلاسيكي", accent: "#1a1a1a", thumbnail: "/templates/classic_serif.png" },
  { id: "modern_minimal", label: "Modern Minimal", labelAr: "بسيط عصري", accent: "#b0b0b0", thumbnail: "/templates/modern_minimal.png" },
  { id: "navy_executive", label: "Navy Executive", labelAr: "تنفيذي كحلي", accent: "#1F3864", thumbnail: "/templates/navy_executive.png" },
  { id: "sidebar_dark", label: "Sidebar Dark", labelAr: "شريط جانبي داكن", accent: "#16223A", thumbnail: "/templates/sidebar_dark.png" },
  { id: "timeline", label: "Timeline", labelAr: "الجدول الزمني", accent: "#0284C7", thumbnail: "/templates/timeline.png" },
  { id: "elegant_gold", label: "Elegant Gold", labelAr: "أنيق ذهبي", accent: "#A9862E", thumbnail: "/templates/elegant_gold.png" },
  { id: "compact_ats", label: "Compact ATS-Safe", labelAr: "متوافق مع الأنظمة الآلية", accent: "#000000", thumbnail: "/templates/compact_ats.png" },
  { id: "bold_banner", label: "Bold Banner", labelAr: "شريط جريء", accent: "#1C1C1C", thumbnail: "/templates/bold_banner.png" },
  { id: "geometric_creative", label: "Geometric Creative", labelAr: "إبداعي هندسي", accent: "#FF6B6B", thumbnail: "/templates/geometric_creative.png" },
  { id: "letterhead_corporate", label: "Corporate Letterhead", labelAr: "ترويسة رسمية", accent: "#333333", thumbnail: "/templates/letterhead_corporate.png" },
  { id: "portrait_rail", label: "Portrait Rail", labelAr: "عمود جانبي بصورة", accent: "#8C5A3C", thumbnail: "/templates/portrait_rail.png", photo: true },
  { id: "portrait_band", label: "Portrait Band", labelAr: "ترويسة بصورة", accent: "#14202B", thumbnail: "/templates/portrait_band.png", photo: true },
  { id: "portrait_corner", label: "Corner Portrait", labelAr: "صورة في الزاوية", accent: "#D96F32", thumbnail: "/templates/portrait_corner.png", photo: true },
  { id: "portrait_formal", label: "Formal Portrait", labelAr: "رسمي بصورة", accent: "#1A1A1A", thumbnail: "/templates/portrait_formal.png", photo: true },
  { id: "portrait_card", label: "Portrait Card", labelAr: "بطاقة بصورة", accent: "#35566E", thumbnail: "/templates/portrait_card.png", photo: true },
];
const DEFAULT_CV_TEMPLATE_ID = "original_classic";

// Max height (px) the "Additional information" textarea grows to before it
// stops expanding and becomes scrollable instead. Kept slightly taller than
// the job description textarea (rows=7 ≈ 188px) so it never dominates the form.
const ADDITIONAL_INFO_MAX_HEIGHT = 220;

export class InsufficientCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

// Localized copy for the backend's machine-readable failure codes (see
// ERROR_MESSAGES in backend/main.py). Every one of these outcomes is
// refunded server-side before the error is emitted, so the copy says so
// explicitly — a user who sees "generation failed" with no mention of their
// credits reasonably assumes they were charged anyway.
const GENERATION_ERROR_COPY: Record<string, { en: string; ar: string }> = {
  // Returned by the backend's per-user rate limiter (core/rate_limit.py).
  // Says nothing was charged, because nothing was: the limit is enforced
  // before credits are reserved.
  rate_limited: {
    en: "You've made a lot of requests in a short time. Please wait a few minutes and try again — nothing has been charged.",
    ar: "أرسلت طلبات كثيرة خلال وقت قصير. انتظر بضع دقائق ثم أعد المحاولة، ولم يُخصم أي رصيد.",
  },
  file_too_large: {
    en: "That file is larger than 5 MB. Please upload a smaller CV.",
    ar: "حجم الملف أكبر من 5 ميجابايت. أرفق نسخة أصغر من سيرتك الذاتية.",
  },
  unreadable_upload: {
    en: "We couldn't read that file. Please upload your CV as a PDF or Word (.docx) file with selectable text.",
    ar: "تعذّرت قراءة هذا الملف. يرجى رفع سيرتك الذاتية بصيغة PDF أو Word ‏(.docx) بنص قابل للتحديد.",
  },
  tailoring_failed: {
    en: "We couldn't finish tailoring your CV, so you haven't been charged. Please try again.",
    ar: "لم نتمكن من إكمال تخصيص سيرتك الذاتية، ولم يتم خصم أي رصيد. يرجى المحاولة مرة أخرى.",
  },
  fact_check_failed: {
    en: "Fact check did not fully pass, so you haven't been charged. Please try again.",
    ar: "لم يجتز التحقق من الحقائق بالكامل، ولم يتم خصم أي رصيد. يرجى المحاولة مرة أخرى.",
  },
  fact_check_unavailable: {
    en: "Our fact checker is temporarily unavailable, so you haven't been charged. Please try again in a moment.",
    ar: "خدمة التحقق من الحقائق غير متاحة مؤقتًا، ولم يتم خصم أي رصيد. يرجى المحاولة بعد قليل.",
  },
  wrong_language: {
    en: "We couldn't generate your CV in Arabic this time, so you haven't been charged. Please try again.",
    ar: "لم نتمكن من إنشاء سيرتك الذاتية بالعربية هذه المرة، ولم يتم خصم أي رصيد. يرجى المحاولة مرة أخرى.",
  },
  cv_unreadable: {
    en: "We couldn't read your CV, so you haven't been charged. Please try again in a moment.",
    ar: "تعذّرت قراءة سيرتك الذاتية، ولم يتم خصم أي رصيد. يرجى المحاولة بعد قليل.",
  },
  jd_unreadable: {
    en: "We couldn't analyze that job description, so you haven't been charged. Please try again in a moment.",
    ar: "تعذّر تحليل الوصف الوظيفي، ولم يتم خصم أي رصيد. يرجى المحاولة بعد قليل.",
  },
};

async function throwForFailedResponse(res: Response): Promise<never> {
  if (res.status === 402) {
    const body = await res.json().catch(() => null);
    throw new InsufficientCreditsError(body?.detail?.message ?? "Not enough credits.");
  }
  throw new Error(`Request failed: ${res.status}`);
}

function mapBackendResponse(raw: any): GenerateResult {
  return {
    requestId: raw.request_id ?? "",
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
    jobTitle: raw.job_title ?? "",
    company: raw.company ?? "",
    generationSnapshot: raw.generation_snapshot ?? null,
  };
}

/**
 * Grabs the current Supabase access token, throwing the same way the old
 * generateFromUpload/generateFromManual did if there's no session.
 */
async function getAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }
  return session.access_token;
}

/** Builds the multipart form body for the upload-CV flow. */
function buildUploadFormData(
  cv: File,
  jobDescription: string,
  additionalInfo: string,
  cvLanguage: "en" | "ar",
  templateId: string,
  // Explicit opt-in to the legacy name path — only ever true when the user
  // clicked "Generate without it" on the name prompt. See
  // apply_candidate_names() in backend/main.py.
  allowNameFallback = false
): FormData {
  const formData = new FormData();
  formData.append("cv", cv);
  formData.append("job_description", jobDescription);
  formData.append("additional_info", additionalInfo);
  formData.append("cv_language", cvLanguage);
  formData.append("template_id", templateId);
  formData.append("allow_name_fallback", String(allowNameFallback));
  return formData;
}

/**
 * The form's "one per line" textareas (achievements, teaching posts, awards,
 * a custom section's entries) as the string lists the backend expects —
 * the same convention experience bullets already use.
 */
function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Converts the flat "Create New CV" form state into the nested JSON shape
 * the backend's ManualCVRequest schema expects.
 */
function buildManualPayload(
  data: ManualCvData,
  jobDescription: string,
  additionalInfo: string,
  cvLanguage: "en" | "ar",
  templateId: string,
  // See buildUploadFormData's note — same explicit legacy-path opt-in.
  allowNameFallback = false
) {
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
    // Human languages, not programming ones — facts_json keeps the two apart
    // and every template renders this list as its own Languages section.
    languages_spoken: data.languages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    // The categories FactsJSON gained. Same filtering rule as the blocks
    // above: an entry the user started and left blank is dropped rather than
    // posted as an empty row, since the form seeds every repeatable list with
    // one empty item.
    summary: data.summary.trim() || null,
    major_achievements: splitLines(data.achievements),
    training_courses: data.training
      .filter((t) => t.name.trim())
      .map((t) => ({ name: t.name, provider: t.provider, date: t.date })),
    participation: data.participation
      .filter((p) => p.title.trim())
      .map((p) => ({
        title: p.title,
        role: p.role,
        organization: p.organization,
        scope: p.scope,
        date: p.date,
      })),
    publications: data.publications
      .filter((p) => p.title.trim())
      .map((p) => ({ title: p.title, venue: p.venue, year: p.year })),
    teaching_and_editorial: splitLines(data.teaching),
    awards: splitLines(data.awards),
    additional_sections: data.customSections
      .map((s) => ({ section_title: s.section_title.trim(), entries: splitLines(s.entries) }))
      .filter((s) => s.entries.length > 0),
    job_description: jobDescription,
    additional_info: additionalInfo || "",
    cv_language: cvLanguage,
    template_id: templateId,
    allow_name_fallback: allowNameFallback,
  };
}

/** Color-codes a match tier into a glassy badge style, for the dark panel. */
function getMatchBadgeStyle(tier: MatchTier | null): { classes: string; dot: string } {
  if (tier === "strong") {
    return { classes: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200", dot: "bg-emerald-400" };
  }
  if (tier === "partial") {
    return { classes: "border-amber-400/40 bg-amber-400/15 text-amber-200", dot: "bg-amber-400" };
  }
  if (tier === "stretch") {
    return { classes: "border-rose-400/40 bg-rose-400/15 text-rose-200", dot: "bg-rose-400" };
  }
  return { classes: "border-white/20 bg-white/10 text-white/80", dot: "bg-white/50" };
}

export default function DashboardHomePage() {
  const { t, dir, lang } = useLang();
  const copy = t.dashboard.generate;
  const progressCopy = copy.progress;

  // Pre-combined "Agent N · Label" strings for each pipeline step, in the
  // active UI language — built once per render from language.tsx so the
  // hook and component below stay i18n-agnostic.
  const stepLabels = {
    cvParse: `${progressCopy.agentLabel(1)} · ${progressCopy.steps.cvParse}`,
    jdAnalyze: `${progressCopy.agentLabel(2)} · ${progressCopy.steps.jdAnalyze}`,
    tailor: `${progressCopy.agentLabel(3)} · ${progressCopy.steps.tailor}`,
    factCheck: `${progressCopy.agentLabel(4)} · ${progressCopy.steps.factCheck}`,
    atsScore: `${progressCopy.agentLabel(5)} · ${progressCopy.steps.atsScore}`,
    coverLetter: `${progressCopy.agentLabel(6)} · ${progressCopy.steps.coverLetter}`,
    matchScore: `${progressCopy.agentLabel(7)} · ${progressCopy.steps.matchScore}`,
    similarJobs: `${progressCopy.agentLabel(8)} · ${progressCopy.steps.similarJobs}`,
  };
  const { steps: agentSteps, run: runOptimizeStream } = useOptimizeStream(stepLabels);

  const [cvMode, setCvMode] = useState<"upload" | "manual">("upload");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [manualData, setManualData] = useState<ManualCvData>(emptyManualCvData);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [cvLanguage, setCvLanguage] = useState<"en" | "ar">("en");
  const [templateId, setTemplateId] = useState<string>(DEFAULT_CV_TEMPLATE_ID);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(0);
  const [creditsTotal, setCreditsTotal] = useState(0);
  const [isFoundingMember, setIsFoundingMember] = useState(false);
  const [foundingMemberNumber, setFoundingMemberNumber] = useState<number | null>(null);
  // Role flags come from their own endpoint, never from the profiles
  // select — see fetchAdminStatus for why.
  const [isAdmin, setIsAdmin] = useState(false);
  // Badge list comes from the server so the tier badges (which depend on
  // live subscription state) can't drift from what the backend believes.
  const [badges, setBadges] = useState<BadgeKey[]>([]);
  const [newBadges, setNewBadges] = useState<BadgeKey[]>([]);
  const [badgeFoundingNumber, setBadgeFoundingNumber] = useState<number | null>(null);
  const [location, setLocation] = useState<string | null | undefined>(undefined);

  const refreshCredits = () => {
    fetchCredits()
      .then((c) => {
        setCreditsRemaining(c.creditsRemaining);
        setCreditsTotal(c.creditsTotal);
        setIsFoundingMember(c.isFoundingMember);
        setFoundingMemberNumber(c.foundingMemberNumber);
        setLocation(c.location);
      })
      .catch((err) => console.error("fetchCredits failed:", err));
  };

  useEffect(() => {
    refreshCredits();
    fetchAdminStatus().then(({ isAdmin: admin }) => setIsAdmin(admin));

    fetchBadges().then((b) => {
      setBadges(b.badges as BadgeKey[]);
      setNewBadges(b.new as BadgeKey[]);
      setBadgeFoundingNumber(b.founding_member_number);
    });
  }, []);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);

  // BUG #14 FIX: previously these held blob: URLs built by fetching the PDF
  // via JS (fetch() with an Authorization header) and calling
  // URL.createObjectURL(). iOS Safari is unreliable with the `download`
  // attribute on a blob: URL — instead of downloading, it often just
  // navigates the tab to display the blob inline, wiping all React state,
  // which is exactly what "the site refreshed and everything disappeared"
  // reports described. Now these hold plain backend URLs with the access
  // token as a `?token=` query param (see core/auth.py's
  // get_current_user_id_query_or_header and main.py's download/preview
  // routes), so the browser handles the download/preview natively via a
  // real <a href download> — no JS blob involved at all.
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [cvPreviewUrl, setCvPreviewUrl] = useState<string | null>(null);
  const [cvDownloadUrl, setCvDownloadUrl] = useState<string | null>(null);
  const [cvDownloadDocxUrl, setCvDownloadDocxUrl] = useState<string | null>(null);
  const [clPreviewUrl, setClPreviewUrl] = useState<string | null>(null);
  const [clDownloadUrl, setClDownloadUrl] = useState<string | null>(null);

  // Format-picker popup for the CV download button (PDF vs Word) — see the
  // modal markup near the end of the component.
  const [cvFormatPickerOpen, setCvFormatPickerOpen] = useState(false);
  const [cvSelectedFormat, setCvSelectedFormat] = useState<"pdf" | "docx">("pdf");

  const [error, setError] = useState("");

  /* Mirrors MAX_CV_UPLOAD_BYTES in backend/main.py. The server is the real
     limit — this only means someone with a 40 MB scan is told so straight
     away instead of after uploading all of it on a phone connection. */
  const MAX_CV_UPLOAD_BYTES = 5 * 1024 * 1024;

  function handleCvFileSelect(selected: File) {
    if (selected.size > MAX_CV_UPLOAD_BYTES) {
      setCvFile(null);
      setError(
        lang === "ar"
          ? "حجم الملف أكبر من 5 ميجابايت. أرفق نسخة أصغر من سيرتك الذاتية."
          : "That file is larger than 5 MB. Please upload a smaller CV."
      );
      return;
    }
    setError("");
    setCvFile(selected);
  }
  const [showAllBullets, setShowAllBullets] = useState(false);
  const [showAllGaps, setShowAllGaps] = useState(false);

  const additionalInfoRef = useRef<HTMLTextAreaElement>(null);
  const agentProgressRef = useRef<HTMLDivElement>(null);

  // Name prompt — shown when the profile has no name in the language being
  // generated. See the missing_profile_name branch in handleGenerate.
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [namePromptField, setNamePromptField] = useState<"en" | "ar">("ar");
  const [namePromptValue, setNamePromptValue] = useState("");
  const [namePromptSuggested, setNamePromptSuggested] = useState(false);
  const [namePromptSaving, setNamePromptSaving] = useState(false);
  const [namePromptError, setNamePromptError] = useState("");
  const nameCopy = copy.namePrompt;

  async function handleSaveNameAndGenerate() {
    const value = namePromptValue.trim();
    if (!value) return;
    setNamePromptError("");
    setNamePromptSaving(true);
    try {
      await updateProfileNames(
        namePromptField === "ar" ? { nameAr: value } : { nameEn: value }
      );
      setNamePromptOpen(false);
      // Retry without the fallback flag — the name now exists, so the
      // backend gate passes on this second attempt.
      await handleGenerate(false);
    } catch (err) {
      console.error(err);
      setNamePromptError(nameCopy.error);
    } finally {
      setNamePromptSaving(false);
    }
  }

  // Scroll the agent list into view as soon as generation starts, so the
  // user immediately sees Agent 1..8 running instead of having to scroll
  // down to discover anything is happening — this matters most on mobile,
  // where the generate button sits well above the progress list.
  //
  // This has to be an effect, not a call inside handleGenerate: the progress
  // block only mounts once `generating` is true, so scrolling in the same
  // tick as setGenerating(true) targets an element that doesn't exist yet.
  // The rAF defers one more frame so AgentProgress has finished expanding
  // and the element has its real height before we scroll to it.
  useEffect(() => {
    if (!generating) return;
    const frame = requestAnimationFrame(() => {
      agentProgressRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [generating]);

  // Auto-grow the "Additional information" textarea as the user types, capped
  // at ADDITIONAL_INFO_MAX_HEIGHT (slightly taller than the job description
  // block below it). Past that cap it stays fixed size and scrolls.
  useEffect(() => {
    const el = additionalInfoRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ADDITIONAL_INFO_MAX_HEIGHT)}px`;
  }, [additionalInfo]);

  const requiredCredits = cvLanguage === "ar" ? 2 : 1;
  const canGenerate =
    (cvMode === "upload" ? !!cvFile : manualData.name.trim().length > 0) &&
    jobDescription.trim().length > 0 &&
    !generating &&
    creditsRemaining >= requiredCredits;

  // BUG #14 FIX: builds plain, reliable preview/download URLs once a result
  // and access token are both available — no fetch, no blob, no cleanup
  // needed. Token is short-lived (Supabase access token), but still worth
  // keeping this endpoint read-only-only — see the trade-off note in
  // core/auth.py's get_current_user_id_query_or_header docstring.
  useEffect(() => {
    if (!result || !accessToken) {
      setCvPreviewUrl(null);
      setCvDownloadUrl(null);
      setCvDownloadDocxUrl(null);
      setClPreviewUrl(null);
      setClDownloadUrl(null);
      return;
    }
    if (!result.requestId) {
      // Older cached result predating the request_id fix, or the backend
      // response genuinely didn't include one — don't build URLs that are
      // guaranteed to 422 against the backend's now-required param.
      console.error("mapBackendResponse: missing request_id, so download/preview links will not work.");
      return;
    }
    const tokenParam = encodeURIComponent(accessToken);
    const reqParam = encodeURIComponent(result.requestId);
    setCvPreviewUrl(`${API_URL}/api/v1/preview/cv?token=${tokenParam}&request_id=${reqParam}`);
    setCvDownloadUrl(`${API_URL}/api/v1/download/cv?token=${tokenParam}&request_id=${reqParam}`);
    setCvDownloadDocxUrl(`${API_URL}/api/v1/download/cv-docx?token=${tokenParam}&request_id=${reqParam}`);
    setClPreviewUrl(`${API_URL}/api/v1/preview/cover-letter?token=${tokenParam}&request_id=${reqParam}`);
    setClDownloadUrl(`${API_URL}/api/v1/download/cover-letter?token=${tokenParam}&request_id=${reqParam}`);
  }, [result, accessToken]);

  async function handleGenerate(allowNameFallback = false) {
    setError("");
    if (cvMode === "upload" && (!cvFile || !jobDescription.trim())) {
      setError(copy.missingFields);
      return;
    }
    if (cvMode === "manual" && (!manualData.name.trim() || !jobDescription.trim())) {
      setError(copy.missingFields);
      return;
    }
    setNamePromptOpen(false);
    setGenerating(true);
    setResult(null);
    // NOTE: the scroll-into-view used to happen right here, and it never
    // worked. The whole progress block is rendered behind
    // `{(generating || result) && ...}`, so at this point in the same tick
    // React hasn't committed the re-render yet — agentProgressRef.current is
    // still null and the call silently no-ops. That's why you had to scroll
    // down by hand to see the agents running. It now lives in a useEffect
    // keyed on `generating`, which runs after the element actually exists.
    try {
      const token = await getAccessToken();
      setAccessToken(token);
      const raw =
        cvMode === "upload"
          ? await runOptimizeStream(
              `${API_URL}/api/v1/optimize/stream`,
              buildUploadFormData(cvFile!, jobDescription, additionalInfo, cvLanguage, templateId, allowNameFallback),
              token
            )
          : await runOptimizeStream(
              `${API_URL}/api/v1/optimize-manual/stream`,
              JSON.stringify(
                buildManualPayload(manualData, jobDescription, additionalInfo, cvLanguage, templateId, allowNameFallback)
              ),
              token
            );
      const data = mapBackendResponse(raw);
      setResult(data);

      // Persist so it shows up in "My Resumes" and survives sign-out/back-in.
      // Best-effort — the user already has their result on screen either way.
      saveResumeResult({
        role: data.jobTitle,
        company: data.company,
        cvLanguage,
        jobDescription,
        result: data,
      }).catch((err) => console.error("Failed to save resume to history:", err));
    } catch (err) {
      console.error(err);
      const code = (err as Error & { code?: string })?.code;

      // The profile has no name in the language being generated. Ask for it
      // rather than transliterating — see apply_candidate_names() in
      // backend/main.py. Nothing was charged: the check runs before credits
      // are reserved.
      if (code === "missing_profile_name") {
        const field = (err as Error & { field?: string })?.field === "name_ar" ? "ar" : "en";
        setNamePromptField(field);
        setNamePromptValue("");
        setNamePromptSuggested(false);
        setNamePromptError("");
        setNamePromptOpen(true);
        // Pre-fill from the uploaded CV where we can — a CV already written
        // in Arabic carries the candidate's own spelling, which beats any
        // transliteration we could produce.
        if (cvMode === "upload" && cvFile) {
          suggestNameFromCv(cvFile)
            .then((s) => {
              const suggestion = field === "ar" ? s.nameAr : s.nameEn;
              if (suggestion) {
                setNamePromptValue(suggestion);
                setNamePromptSuggested(true);
              }
            })
            .catch(() => {});
        } else if (cvMode === "manual" && field === "ar" && ARABIC_TEXT_RE.test(manualData.name)) {
          // Manual entry: the typed name is already Arabic, offer it back.
          setNamePromptValue(manualData.name);
          setNamePromptSuggested(true);
        }
        return;
      }

      if (err instanceof InsufficientCreditsError || (err as Error & { status?: number })?.status === 402) {
        setError((err as Error).message);
      } else if (code && GENERATION_ERROR_COPY[code]) {
        // Show what actually went wrong instead of the catch-all. The old
        // branch swallowed every backend detail, which is why a failed run
        // looked identical to a network blip and gave the user no signal
        // that their credit had been returned.
        setError(GENERATION_ERROR_COPY[code][lang === "ar" ? "ar" : "en"]);
      } else {
        setError(
          lang === "ar"
            ? "حدث خطأ ما أثناء إعداد طلبك. يرجى المحاولة مرة أخرى."
            : "Something went wrong generating your application. Please try again."
        );
      }
    } finally {
      setGenerating(false);
      // Covers both outcomes: a successful generation spent credits, and a
      // failed one after reservation gets refunded server-side — either way
      // the button should reflect the true balance right after this call.
      refreshCredits();
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8" dir={dir}>
      {location === null && (
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
        >
          <MapPin className="size-4 shrink-0" aria-hidden />
          {lang === "ar"
            ? "الرجاء إضافة موقعك حتى نتمكن من عرض وظائف مناسبة لك"
            : "Please add your location so we can show you relevant jobs"}
        </Link>
      )}

      {creditsRemaining <= 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="flex items-center gap-2.5 font-medium">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {lang === "ar"
              ? "لا تملك أي رصيد متبقٍ. قم بالترقية أو اشترِ رصيدًا إضافيًا للمتابعة."
              : "You have 0 credits left. Upgrade or buy more credits to keep generating."}
          </span>
          {/* Goes to the in-dashboard plan/pack picker, not Settings (which
              had nothing purchasable on it) and not straight to checkout
              (which would pre-pick a tier the user never chose). */}
          <DashboardButton as={Link} href="/dashboard/upgrade" variant="primary" size="sm">
            {lang === "ar" ? "الترقية الآن" : "Upgrade Now"}
          </DashboardButton>
        </div>
      )}

      {/* Badges row. Owner and Admin sit alongside Founding Member rather
          than in their own section — this is already where a user looks for
          "what am I". The whole block renders if the user has ANY badge, so
          an admin who isn't a founding member still gets the row. */}
      {badges.length > 0 && (
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
            {lang === "ar" ? "الشارات" : "Badges"}
          </span>
          <RoleBadges
            badges={badges}
            foundingMemberNumber={badgeFoundingNumber ?? foundingMemberNumber}
            lang={lang === "ar" ? "ar" : "en"}
            size="lg"
          />
        </div>
      )}

      {/* Fires once per newly-earned badge. Acknowledged only after it has
          actually been shown — see markBadgesSeen. */}
      {newBadges.length > 0 && (
        <BadgeUnlockModal
          badges={newBadges}
          foundingMemberNumber={badgeFoundingNumber ?? foundingMemberNumber}
          lang={lang === "ar" ? "ar" : "en"}
          onDismiss={() => {
            setNewBadges([]);
            markBadgesSeen();
          }}
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-blue-600">{copy.eyebrow}</span>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
        </div>
        <CreditsButton creditsRemaining={creditsRemaining} creditsTotal={creditsTotal} lang={lang} />
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
            onFileSelect={handleCvFileSelect}
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
            ref={additionalInfoRef}
            rows={3}
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder={
              lang === "ar"
                ? "أي شيء آخر يستحق الإضافة ولم يتم ذكره أعلاه، مثل الجوائز أو الأعمال التطوعية أو اللغات أو سياق حول فجوة مهنية."
                : "Anything else worth including that isn't captured above, like awards, volunteer work, languages, or context about a gap."
            }
            style={{ maxHeight: ADDITIONAL_INFO_MAX_HEIGHT }}
            className="block w-full resize-none overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
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
            aria-describedby="jdHint"
            className="block w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
          />
          <p id="jdHint" className="mt-2 text-xs leading-relaxed text-slate-500">
            {copy.jdHint}
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600">
            {error}
          </p>
        )}

        {/* NAME PROMPT — appears only when the profile has no name in the
            language being generated. Nothing has been charged at this
            point: the backend checks before reserving credits. */}
        {namePromptOpen && (
          <div
            role="group"
            aria-label={namePromptField === "ar" ? nameCopy.titleAr : nameCopy.titleEn}
            className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5"
          >
            <h3 className="text-sm font-semibold text-slate-900">
              {namePromptField === "ar" ? nameCopy.titleAr : nameCopy.titleEn}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              {namePromptField === "ar" ? nameCopy.bodyAr : nameCopy.bodyEn}
            </p>

            <input
              type="text"
              autoFocus
              dir={namePromptField === "ar" ? "rtl" : "ltr"}
              value={namePromptValue}
              onChange={(e) => {
                setNamePromptValue(e.target.value);
                setNamePromptSuggested(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && namePromptValue.trim() && !namePromptSaving) {
                  e.preventDefault();
                  handleSaveNameAndGenerate();
                }
              }}
              placeholder={namePromptField === "ar" ? "اسمك بالعربية" : "Your name in English"}
              className="mt-3 block w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />

            {namePromptSuggested && (
              <p className="mt-1.5 text-xs text-slate-500">{nameCopy.suggested}</p>
            )}
            {namePromptError && <p className="mt-1.5 text-xs text-rose-600">{namePromptError}</p>}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <DashboardButton
                type="button"
                size="sm"
                disabled={!namePromptValue.trim() || namePromptSaving}
                onClick={handleSaveNameAndGenerate}
                className="w-full sm:w-auto"
              >
                {nameCopy.saveAndGenerate}
              </DashboardButton>
              <DashboardButton
                type="button"
                variant="outline"
                size="sm"
                disabled={namePromptSaving}
                // Requirement 7's escape hatch: proceed on the legacy path.
                // The backend records name_fallback_used so we can measure
                // how many users end up here.
                onClick={() => handleGenerate(true)}
                className="w-full sm:w-auto"
              >
                {nameCopy.skip}
              </DashboardButton>
            </div>
            <p className="mt-2 text-xs text-slate-500">{nameCopy.skipHint}</p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <DashboardButton
            type="button"
            size="lg"
            disabled={!canGenerate}
            onClick={() => handleGenerate()}
            className="w-full sm:w-auto"
          >
            <Sparkles className={`size-4 ${generating ? "animate-pulse" : ""}`} aria-hidden />
            {generating ? copy.generatingCta : copy.generateCta}
          </DashboardButton>

          <div
            role="group"
            aria-label={lang === "ar" ? "لغة السيرة الذاتية الناتجة" : "Output CV language"}
            className="inline-flex items-center gap-1 self-start rounded-full border border-slate-200 bg-slate-50 p-1 sm:self-auto"
          >
            <Languages className="ml-1.5 size-4 shrink-0 text-slate-400" aria-hidden />
            <button
              type="button"
              onClick={() => setCvLanguage("en")}
              aria-pressed={cvLanguage === "en"}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                cvLanguage === "en" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setCvLanguage("ar")}
              aria-pressed={cvLanguage === "ar"}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                cvLanguage === "ar" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              العربية
            </button>
          </div>

          <button
            type="button"
            onClick={() => setTemplatePickerOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-full border-2 border-blue-200 bg-blue-50/70 px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-100 sm:self-auto"
          >
            <Palette className="size-4" aria-hidden />
            {lang === "ar" ? "اختر قالب السيرة الذاتية" : "Choose CV template"}
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-600 shadow-sm">
              {CV_TEMPLATES.find((t) => t.id === templateId)?.[lang === "ar" ? "labelAr" : "label"] ?? ""}
            </span>
          </button>
        </div>
        <p className="-mt-1.5 text-xs text-slate-400">
          {lang === "ar"
            ? "سيتم إنشاء سيرتك الذاتية وخطاب التقديم باللغة المختارة، حتى لو كانت بياناتك المُدخلة بلغة أخرى."
            : "Your CV and cover letter will be generated in the selected language, even if your input is in the other language."}
        </p>
        <p className="-mt-1.5 text-xs text-slate-400">
          {lang === "ar" ? "الإنجليزية: نقطة واحدة · العربية: نقطتان" : "English uses 1 credit · Arabic uses 2 credits"}
        </p>

        {/* The same out-of-credits prompt as the top banner, repeated right
            where the user actually hits the wall. The banner sits above the
            whole form and is easy to scroll past on mobile; by the time
            someone has filled everything in and reached a disabled Generate
            button, they need the explanation here, not 800px up. */}
        {creditsRemaining <= 0 && (
          <div className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="font-medium">
              {lang === "ar"
                ? "لا تملك أي رصيد متبقٍ. قم بالترقية أو اشترِ رصيدًا إضافيًا للمتابعة."
                : "You have 0 credits left. Upgrade or buy more credits to keep generating."}
            </span>
            <Link
              href="/dashboard/upgrade"
              className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
            >
              {lang === "ar" ? "عرض الخطط والباقات" : "View plans and packs"}
            </Link>
          </div>
        )}
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
                    : "This takes a few moments, since we run several specialized AI agents in sequence to make sure everything is accurate and polished."
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

          <div ref={agentProgressRef}>
            <AgentProgress steps={agentSteps} expanded={generating} />
          </div>

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
                      ? "تقدير آلي لمدى قدرة أنظمة تتبع المتقدمين (ATS) التي تستخدمها الشركات على قراءة سيرتك ومطابقتها مع هذه الوظيفة تحديدًا."
                      : "An estimate of how well the software companies use to auto-screen CVs (an ATS) would match yours to this specific job."}
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

              <div className="mt-3 flex flex-col items-start gap-1.5">
                {result.gapAnalysis.length > 0 && (
                  <a
                    href="#improve-cv"
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <TrendingUp className="size-3.5" aria-hidden />
                    {lang === "ar"
                      ? "راجع «كيف تُحسّن سيرتك الذاتية» أدناه لرفع هذه النتيجة"
                      : "See “How to improve your CV” below to raise this score"}
                  </a>
                )}
                <a
                  href="#ats-explainer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  <HelpCircle className="size-3.5" aria-hidden />
                  {lang === "ar" ? "كيف يتم حساب نتيجة ATS؟" : "See how ATS is calculated"}
                </a>
              </div>
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
                {(showAllGaps ? result.gapAnalysis : result.gapAnalysis.slice(0, 2)).map((gap, i) => (
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

              {result.gapAnalysis.length > 2 && (
                <button
                  type="button"
                  onClick={() => setShowAllGaps((v) => !v)}
                  className="mt-3 flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {showAllGaps ? (
                    <>
                      {lang === "ar" ? "عرض أقل" : "Show fewer"} <ChevronUp className="size-4" aria-hidden />
                    </>
                  ) : (
                    <>
                      {lang === "ar"
                        ? `عرض المزيد (${result.gapAnalysis.length - 2})`
                        : `Show ${result.gapAnalysis.length - 2} more`}{" "}
                      <ChevronDown className="size-4" aria-hidden />
                    </>
                  )}
                </button>
              )}

              {result.overallRecommendation && (
                <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 px-3.5 py-2.5 text-xs leading-relaxed text-blue-700">
                  {result.overallRecommendation}
                </p>
              )}

              <a
                href="#ats-explainer"
                className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                <HelpCircle className="size-3.5" aria-hidden />
                {lang === "ar" ? "كيف يتم حساب نتيجة ATS؟" : "See how ATS is calculated"}
              </a>
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
                  ? "لم يجتز فحص الحقائق بالكامل. يرجى مراجعة النقاط المُنشأة قبل إرسالها."
                  : "Fact check did not fully pass. Review the generated bullets before sending this out."}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2.5 text-sm font-medium text-slate-700">
              {lang === "ar" ? "ملفاتك جاهزة" : "Your files"}
            </p>
            {/* items-stretch (grid default) + h-full on both cards keeps the
                two the same height. The CV card is a hand-rolled copy of
                FileResultCard because it needs the PDF/Word format picker
                instead of a plain download link — it had drifted to
                different padding (px-3 py-2 text-sm vs h-8 text-xs) and icon
                sizes, so the two boxes rendered at visibly different heights.
                Arabic made it obvious because the longer label wrapped, but
                the mismatch was there in English too. Sizing below is now
                identical to FileResultCard's; keep them in sync. */}
            <div className="grid items-stretch gap-3 sm:grid-cols-2">
              <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                    <FileText className="size-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{copy.resumeCardTitle}</p>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <CheckCircle2 className="size-3" aria-hidden />
                      {lang === "ar" ? "جاهز" : "Ready"}
                    </span>
                  </div>
                </div>
                {/* mt-auto pins the buttons to the bottom so both cards'
                    action rows line up even if one title wraps. */}
                <div className="mt-auto flex items-center gap-2 pt-3.5">
                  <a
                    href={cvPreviewUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!cvPreviewUrl}
                    className={`inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-700 transition-colors ${
                      cvPreviewUrl ? "hover:border-slate-300 hover:bg-slate-50" : "pointer-events-none opacity-40"
                    }`}
                  >
                    <Eye className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{copy.preview}</span>
                  </a>
                  <button
                    type="button"
                    disabled={!cvDownloadUrl || !cvDownloadDocxUrl}
                    onClick={() => setCvFormatPickerOpen(true)}
                    className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Download className="size-3.5 shrink-0" aria-hidden />
                    {/* truncate + shrink-0 icon: a long Arabic label ellipsises
                        instead of wrapping and blowing out the button height. */}
                    <span className="truncate">{copy.downloadCv}</span>
                  </button>
                </div>
              </div>
              <FileResultCard
                icon={Mail}
                title={copy.coverLetterCardTitle}
                readyLabel={lang === "ar" ? "جاهز" : "Ready"}
                previewLabel={copy.preview}
                downloadLabel={copy.downloadCoverLetter}
                previewHref={clPreviewUrl ?? "#"}
                downloadHref={clDownloadUrl ?? "#"}
                disabled={!clPreviewUrl || !clDownloadUrl}
              />
            </div>
          </div>

          {result.similarJobs.length > 0 && (
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0B1220] via-[#0F1E3D] to-[#122952] p-6 shadow-lg shadow-blue-950/20 sm:p-8">
              <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-blue-500/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-10 size-56 rounded-full bg-cyan-400/10 blur-3xl" />

              <div className="relative">
                {location === null && (
                  <Link
                    href="/dashboard/settings"
                    className="mb-4 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-400/15"
                  >
                    <MapPin className="size-3.5 shrink-0" aria-hidden />
                    {lang === "ar"
                      ? "أضف موقعك في الإعدادات لوظائف أكثر ملاءمة لمنطقتك"
                      : "Add your location in Settings for jobs more relevant to your area"}
                  </Link>
                )}
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
                    const tier = getMatchTier(job);
                    const badge = getMatchBadgeStyle(tier);
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
                            {tier && (
                              <span
                                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur-sm ${badge.classes}`}
                              >
                                <span className={`size-1.5 rounded-full ${badge.dot}`} aria-hidden />
                                {MATCH_TIER_COPY[tier][lang === "ar" ? "ar" : "en"]}
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

          <div id="ats-explainer" className="scroll-mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-5 sm:p-6">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
                <HelpCircle className="size-4" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-slate-900">
                {lang === "ar" ? "كيف يتم حساب نتيجة ATS؟" : "How your ATS score is calculated"}
              </p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {lang === "ar"
                ? "ATS تعني «نظام تتبع المتقدمين»، البرنامج الذي تستخدمه معظم الشركات لفرز السير الذاتية قبل أن يراها أي إنسان. نحاكي هذا الفرز لنقدّر مدى مطابقة سيرتك لهذه الوظيفة تحديدًا، بناءً على العوامل التالية:"
                : "ATS stands for Applicant Tracking System, the software most companies use to auto-screen CVs before a human ever sees them. We simulate that screening to estimate how well your CV matches this specific job, based on these factors:"}
            </p>

            <ul className="mt-4 space-y-3">
              {[
                {
                  key: "skills_match" as const,
                  title: lang === "ar" ? "المهارات" : "Skills",
                  desc:
                    lang === "ar"
                      ? "مدى تطابق المهارات المطلوبة في الوظيفة مع المهارات المذكورة في ملفك. المهارات المفضّلة (غير الإلزامية) تضيف رصيدًا عند توفرها، ولا تخصم عند غيابها."
                      : "How many of the required skills for this role are actually listed in your profile. Skills the job lists as preferred add credit when you have them, and never cost you anything when you don't.",
                },
                {
                  key: "keyword_match" as const,
                  title: lang === "ar" ? "الكلمات المفتاحية" : "Keywords",
                  desc:
                    lang === "ar"
                      ? "لغة إعلان الوظيفة التي ليست مهارة مسمّاة أصلًا، حتى لا يُحتسب الشيء نفسه مرتين. نتيجة منخفضة هنا تعني أن سيرتك لا تستخدم نفس صياغة الإعلان، ولا تعني بالضرورة أنك غير مؤهل."
                      : "The job's own wording that isn't already a named skill, so the same evidence isn't counted twice. A low score here means your CV isn't using the posting's phrasing. It doesn't necessarily mean you're unqualified.",
                },
                {
                  key: "title_match" as const,
                  title: lang === "ar" ? "المسمى الوظيفي" : "Job title",
                  desc:
                    lang === "ar"
                      ? "مدى قرب المسميات التي شغلتها فعلًا من المسمى المطلوب، ومستواها مقارنة بمستوى الوظيفة. تزن أنظمة التتبع الكبرى هذا العامل بشدة."
                      : "How close the job titles you've actually held are to the one you're applying for, and how their level compares. Major ATS platforms weight this heavily.",
                },
                {
                  key: "experience_match" as const,
                  title: lang === "ar" ? "الخبرة" : "Experience",
                  desc:
                    lang === "ar"
                      ? "سنوات خبرتك محسوبة من تواريخ وظائفك نفسها مقارنة بما تطلبه الوظيفة، مع احتساب الفترات المتداخلة مرة واحدة."
                      : "Your years of experience, measured from the dates on your own roles, against what the job asks for. Overlapping roles are counted once.",
                },
                {
                  key: "education_match" as const,
                  title: lang === "ar" ? "التعليم" : "Education",
                  desc:
                    lang === "ar"
                      ? "هل يتوافق تخصصك ودرجتك العلمية مع ما تطلبه الوظيفة، في أي مجال كان."
                      : "Whether your degree and field of study line up with what the role asks for, in any field.",
                },
              ].map((factor) => {
                const weight =
                  result.atsBreakdown.weights?.[factor.key] ?? DEFAULT_ATS_WEIGHTS[factor.key];
                return (
                  <li key={factor.key} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white">
                      {weight}%
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{factor.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{factor.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 px-3.5 py-2.5 text-xs leading-relaxed text-blue-700">
              {lang === "ar"
                ? "نتيجة منخفضة لا تعني أنك مرشح ضعيف. غالبًا تعني فقط أن سيرتك لا تُظهر بعد المصطلحات التي تبحث عنها هذه الوظيفة تحديدًا. استخدم قسم «كيف تُحسّن سيرتك الذاتية» أعلاه لسد هذه الفجوة."
                : "A low score doesn't mean you're a weak candidate. It usually just means your CV isn't yet surfacing the exact terms this specific job is scanning for. Use the “How to improve your CV” section above to close that gap."}
            </p>
          </div>
        </div>
      )}

      {templatePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setTemplatePickerOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl sm:p-7"
            onClick={(e) => e.stopPropagation()}
            dir={dir}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {lang === "ar" ? "اختر قالب السيرة الذاتية" : "Choose your CV template"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {lang === "ar"
                    ? "إذا لم تختر، سيتم استخدام القالب الكلاسيكي الافتراضي."
                    : "If you don't choose one, the default classic template is used."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTemplatePickerOpen(false)}
                className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={lang === "ar" ? "إغلاق" : "Close"}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {CV_TEMPLATES.map((tpl) => {
                const selected = templateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setTemplateId(tpl.id);
                      setTemplatePickerOpen(false);
                    }}
                    className={`flex flex-col items-start gap-2 rounded-xl border-2 p-3 text-left transition-all ${
                      lang === "ar" ? "text-right" : "text-left"
                    } ${
                      selected
                        ? "border-blue-500 bg-blue-50/60 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className="relative block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      {/* Real screenshot preview, cropped tight to the header +
                          summary + start of experience — that's where templates
                          look most different from each other — and shown large
                          so the layout, fonts, and colors are actually legible. */}
                      <span className="block aspect-[3/4] w-full overflow-hidden">
                        <img
                          src={tpl.thumbnail}
                          alt={lang === "ar" ? tpl.labelAr : tpl.label}
                          loading="lazy"
                          className="h-full w-full object-cover object-top"
                        />
                      </span>
                      <span
                        className="absolute inset-x-0 bottom-0 h-1.5"
                        style={{ backgroundColor: tpl.accent }}
                        aria-hidden
                      />
                    </span>
                    <span className="flex w-full flex-col gap-0.5">
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {lang === "ar" ? tpl.labelAr : tpl.label}
                        </span>
                        {selected && <CheckCircle2 className="size-4 shrink-0 text-blue-600" aria-hidden />}
                      </span>
                      {/* Says what the slot does without promising a photo the
                          user's CV may not contain — these templates lay out
                          correctly either way. */}
                      {tpl.photo && (
                        <span className="text-xs text-slate-500">
                          {lang === "ar"
                            ? "يعرض صورتك الشخصية إذا كانت موجودة في الملف الذي رفعته"
                            : "Shows your photo if the CV you upload has one"}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {cvFormatPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setCvFormatPickerOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            dir={dir}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-base font-semibold text-slate-900">
                {lang === "ar" ? "اختر صيغة التنزيل" : "Choose a format"}
              </h3>
              <button
                type="button"
                onClick={() => setCvFormatPickerOpen(false)}
                className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={lang === "ar" ? "إغلاق" : "Close"}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => setCvSelectedFormat("pdf")}
                aria-pressed={cvSelectedFormat === "pdf"}
                className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                  lang === "ar" ? "text-right" : "text-left"
                } ${
                  cvSelectedFormat === "pdf"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/60"
                }`}
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                    cvSelectedFormat === "pdf" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <FileText className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">PDF</span>
                  <span className="block text-xs text-slate-400">.pdf</span>
                </span>
                {cvSelectedFormat === "pdf" && <CheckCircle2 className="size-4 shrink-0 text-blue-600" aria-hidden />}
              </button>

              <button
                type="button"
                onClick={() => setCvSelectedFormat("docx")}
                aria-pressed={cvSelectedFormat === "docx"}
                className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                  lang === "ar" ? "text-right" : "text-left"
                } ${
                  cvSelectedFormat === "docx"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/60"
                }`}
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                    cvSelectedFormat === "docx" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <FileType2 className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{lang === "ar" ? "وورد" : "Word"}</span>
                  <span className="block text-xs text-slate-400">.docx</span>
                </span>
                {cvSelectedFormat === "docx" && <CheckCircle2 className="size-4 shrink-0 text-blue-600" aria-hidden />}
              </button>
            </div>

            <a
              href={(cvSelectedFormat === "pdf" ? cvDownloadUrl : cvDownloadDocxUrl) ?? "#"}
              download
              onClick={() => setCvFormatPickerOpen(false)}
              aria-disabled={cvSelectedFormat === "pdf" ? !cvDownloadUrl : !cvDownloadDocxUrl}
              className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 ${
                (cvSelectedFormat === "pdf" ? !cvDownloadUrl : !cvDownloadDocxUrl)
                  ? "pointer-events-none opacity-50"
                  : ""
              }`}
            >
              <Download className="size-4" aria-hidden />
              {lang === "ar" ? "تنزيل" : "Download"}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
