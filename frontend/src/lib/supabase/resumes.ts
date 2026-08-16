import { createClient } from "@/lib/supabase/client";

/* ========================================================================
   TYPES — mirror the GenerateResult shape produced in the Dashboard's
   generate flow (Dashboard-page.tsx). Kept separate rather than imported
   from there to avoid a client-page -> client-page import; if that file's
   shape changes, update both.
======================================================================== */
export type TailoredBullet = {
  original: string;
  tailored: string;
  relevance_score: number;
};

// Imported rather than redeclared: the same listings are rendered by the
// dashboard's post-generation panel and by My Resumes, and both resolve a
// listing's tier through @/lib/jobMatch. One shape, one tier function.
// Re-exported so existing `import { SimilarJob } from ".../resumes"` callers
// keep working.
import type { SimilarJob } from "@/lib/jobMatch";
export type { SimilarJob };

export type AtsBreakdown = {
  keyword_match?: number;
  skills_match?: number;
  education_match?: number;
  experience_match?: number;
  matched_keywords?: string[];
  unmatched_keywords?: string[];
  matched_skills?: string[];
  missing_skills?: string[];
  title_match?: number;
  weights?: {
    skills_match?: number;
    keyword_match?: number;
    title_match?: number;
    experience_match?: number;
    education_match?: number;
  };
};

export type GapItem = {
  skill: string;
  importance: "required" | "preferred";
  how_to_close: string;
};

export type ResumeRecord = {
  id: string;
  user_id: string;
  role: string | null;
  company: string | null;
  cv_language: "en" | "ar";
  job_description: string | null;
  ats_score: number;
  ats_breakdown: AtsBreakdown;
  job_match_score: number;
  job_match_reason: string;
  overall_recommendation: string;
  fact_check_passed: boolean;
  tailored_summary: string;
  tailored_bullets: TailoredBullet[];
  gap_analysis: GapItem[];
  similar_jobs: SimilarJob[];
  cover_letter_text: string;
  // Structured data the backend regenerates the PDF/DOCX from on demand —
  // see backend/main.py's build_generation_snapshot. Opaque on the
  // frontend; only ever round-tripped to the regenerate-document endpoint.
  // null on legacy rows saved before this existed.
  generation_snapshot: unknown | null;
  is_archived: boolean;
  created_at: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/* ========================================================================
   SAVE — inserts one row of structured generation data. No file upload:
   the rendered PDF/DOCX are regenerated on demand from generation_snapshot
   (see getDocumentUrl below) instead of being stored anywhere permanently
   — that's the whole point of this rework, since a JSON snapshot is a
   fraction of the size of the rendered files it replaces. Retention-cap
   archiving (per-tier, oldest-first) happens server-side via a DB trigger
   on insert — see the SQL migration notes — so nothing extra is needed
   here for that.
======================================================================== */
export async function saveResumeResult(params: {
  role: string;
  company: string;
  cvLanguage: "en" | "ar";
  jobDescription: string;
  result: {
    atsScore: number;
    atsBreakdown: AtsBreakdown;
    jobMatchScore: number;
    jobMatchReason: string;
    overallRecommendation: string;
    factCheckPassed: boolean;
    tailoredSummary: string;
    tailoredBullets: TailoredBullet[];
    gapAnalysis: GapItem[];
    similarJobs: SimilarJob[];
    coverLetterText: string;
    generationSnapshot: unknown;
  };
}): Promise<ResumeRecord> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: row, error: insertError } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      role: params.role || null,
      company: params.company || null,
      cv_language: params.cvLanguage,
      job_description: params.jobDescription || null,
      ats_score: params.result.atsScore,
      ats_breakdown: params.result.atsBreakdown,
      job_match_score: params.result.jobMatchScore,
      job_match_reason: params.result.jobMatchReason,
      overall_recommendation: params.result.overallRecommendation,
      fact_check_passed: params.result.factCheckPassed,
      tailored_summary: params.result.tailoredSummary,
      tailored_bullets: params.result.tailoredBullets,
      gap_analysis: params.result.gapAnalysis,
      similar_jobs: params.result.similarJobs,
      cover_letter_text: params.result.coverLetterText,
      generation_snapshot: params.result.generationSnapshot ?? null,
    })
    .select()
    .single();

  if (insertError || !row) {
    throw insertError ?? new Error("Failed to save resume record");
  }

  return row as ResumeRecord;
}

/* ========================================================================
   FETCH — paginated list for the "My Resumes" page. RLS already scopes
   this to the logged-in user. Archived rows (past the tier's retention
   cap — see the retention trigger in the SQL migration notes) are
   excluded from this list by default; their data isn't deleted, just
   hidden from the main view, per the retention design.
======================================================================== */
export async function fetchResumes(
  page: number,
  pageSize: number
): Promise<{ resumes: ResumeRecord[]; total: number }> {
  const supabase = createClient();
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("resumes")
    .select("*", { count: "exact" })
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { resumes: (data ?? []) as ResumeRecord[], total: count ?? 0 };
}

/* ========================================================================
   DOCUMENT URLS — the PDF/DOCX no longer live in Storage; they're
   regenerated on demand by the backend from generation_snapshot. These
   build authenticated links to that endpoint the same way the live
   generate flow's preview/download links already work (a `?token=`
   query param, since a plain <a href> / <iframe src> can't send an
   Authorization header — see core/auth.py's
   get_current_user_id_query_or_header for the full reasoning).
   docType: "cv-pdf" | "cv-docx" | "cover-letter-pdf"
======================================================================== */
export async function getDocumentUrl(
  resumeId: string,
  docType: "cv-pdf" | "cv-docx" | "cover-letter-pdf",
  options?: { download?: boolean }
): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const params = new URLSearchParams({ token: session.access_token });
  if (options?.download) params.set("download", "true");
  return `${API_URL}/api/v1/resumes/${resumeId}/document/${docType}?${params.toString()}`;
}

/* ========================================================================
   ADMIN — debug tool for the founder to look at exactly what a specific
   user/tester saw when they report a bug, now that rendered files aren't
   stored anywhere (see PART 1 of the storage/retention rework). Every call
   here hits the backend directly (not Supabase-RLS-scoped table access)
   and is gated server-side by profiles.is_admin — see
   core/auth.py::get_current_admin_user_id. A non-admin caller just gets a
   403 from the backend; there is no separate frontend-side admin check.
======================================================================== */
export type AdminResumeSummary = {
  id: string;
  user_id: string;
  role: string | null;
  company: string | null;
  cv_language: "en" | "ar";
  ats_score: number;
  job_match_score: number;
  is_archived: boolean;
  created_at: string;
  // Joined server-side from auth.users + profiles so the table can show who
  // a row belongs to. Null when the lookup function isn't available.
  email?: string | null;
  name_en?: string | null;
  name_ar?: string | null;
};

export type AdminMatchedUser = {
  id: string;
  email: string | null;
  name_en: string | null;
  name_ar: string | null;
};

export async function fetchAdminResumes(params: {
  page: number;
  pageSize: number;
  /** Email, name (English or Arabic), or auth user id. Blank = everyone. */
  search?: string;
}): Promise<{
  resumes: AdminResumeSummary[];
  limit: number;
  offset: number;
  matched_users?: AdminMatchedUser[];
  total_matched_users?: number;
}> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const query = new URLSearchParams({
    limit: String(params.pageSize),
    offset: String(params.page * params.pageSize),
  });
  if (params.search) query.set("q", params.search);

  const res = await fetch(`${API_URL}/api/v1/admin/resumes?${query.toString()}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string" ? detail : detail?.message ?? `Request failed: ${res.status}`
    );
  }
  return res.json();
}

export async function getAdminDocumentUrl(
  resumeId: string,
  docType: "cv-pdf" | "cv-docx" | "cover-letter-pdf",
  options?: { download?: boolean }
): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const params = new URLSearchParams({ token: session.access_token });
  if (options?.download) params.set("download", "true");
  return `${API_URL}/api/v1/admin/resumes/${resumeId}/document/${docType}?${params.toString()}`;
}

/* ========================================================================
   DELETE — removes the row itself. RLS scopes the delete to rows owned by
   the caller. There's no associated Storage object to clean up anymore
   (see the module comment above) — just the row.
======================================================================== */
export async function deleteResume(id: string): Promise<void> {
  const supabase = createClient();

  const { error, count } = await supabase
    .from("resumes")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) throw error;
  if (!count) {
    // 0 rows affected almost always means there's no RLS DELETE policy on
    // `resumes` yet — Supabase returns success with nothing deleted rather
    // than an error in that case.
    throw new Error("Delete did not remove any rows. Check the RLS DELETE policy on `resumes`.");
  }
}
