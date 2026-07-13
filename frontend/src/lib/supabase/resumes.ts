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

export type SimilarJob = {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
  match_label?: string;
};

export type AtsBreakdown = {
  keyword_match?: number;
  skills_match?: number;
  education_match?: number;
  experience_match?: number;
  matched_keywords?: string[];
  unmatched_keywords?: string[];
  matched_skills?: string[];
  missing_skills?: string[];
  weights?: {
    keyword_match?: number;
    skills_match?: number;
    education_match?: number;
    experience_match?: number;
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
  cv_storage_path: string | null;
  cover_letter_storage_path: string | null;
  created_at: string;
};

const BUCKET = "resumes";
const API_URL = process.env.NEXT_PUBLIC_API_URL;

/* ========================================================================
   SAVE — inserts the metadata row, then fetches the two just-generated
   PDFs from the FastAPI backend and re-uploads them into private Supabase
   Storage so they outlive the backend's single fixed-path outputs/*.pdf
   files (which get overwritten by the very next generation, by anyone).
   Best-effort on the file upload half: if that fails, the row still exists
   with null storage paths rather than losing the whole result.
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
    })
    .select()
    .single();

  if (insertError || !row) {
    throw insertError ?? new Error("Failed to save resume record");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const uploadOne = async (endpoint: string, filename: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      const path = `${user.id}/${row.id}/${filename}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, {
        contentType: "application/pdf",
        upsert: true,
      });
      return uploadError ? null : path;
    } catch {
      return null;
    }
  };

  const [cvPath, coverLetterPath] = await Promise.all([
    uploadOne("/api/v1/preview/cv", "cv.pdf"),
    uploadOne("/api/v1/preview/cover-letter", "cover-letter.pdf"),
  ]);

  if (!cvPath && !coverLetterPath) {
    return row as ResumeRecord;
  }

  const { data: updated } = await supabase
    .from("resumes")
    .update({ cv_storage_path: cvPath, cover_letter_storage_path: coverLetterPath })
    .eq("id", row.id)
    .select()
    .single();

  return (updated ?? { ...row, cv_storage_path: cvPath, cover_letter_storage_path: coverLetterPath }) as ResumeRecord;
}

/* ========================================================================
   FETCH — list, for the "My Resumes" table. RLS already scopes this to
   the logged-in user, so no user_id filter is needed here.
======================================================================== */
export async function fetchResumes(): Promise<ResumeRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("resumes").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ResumeRecord[];
}

/* ========================================================================
   SIGNED URLS — storage bucket is private, so preview/download links must
   be generated on demand rather than being static hrefs. `download: true`
   sets Content-Disposition: attachment so the download button actually
   downloads instead of navigating.
======================================================================== */
export async function getSignedFileUrl(
  path: string | null,
  options?: { download?: boolean }
): Promise<string | null> {
  if (!path) return null;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 10, options?.download ? { download: true } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}
