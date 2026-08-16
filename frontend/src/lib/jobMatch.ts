/* ========================================================================
   JOB MATCH TIERS — shared between the two places that render the job
   listings jobs_finder.py produced for a run:

     · dashboard/page.tsx        the panel shown right after a generation
     · dashboard/resumes/page.tsx  the same listings, re-read later from the
                                   resume's stored similar_jobs column

   Extracted here rather than copied into the second page because both
   views describe the SAME saved rows. Two copies of getMatchTier could
   drift and label one listing "Strong Match" in one place and "Partial"
   in the other, for the same job, on the same resume — a difference the
   user would read as the product being wrong about their match.

   Only tier RESOLUTION and its wording live here. Badge colours stay with
   each page: the dashboard panel is white-on-dark-gradient and the resume
   history is dark-on-white, so the two need genuinely different palettes
   to stay legible, and forcing one styling helper to serve both would take
   more theme plumbing than it saves.
======================================================================== */

export type MatchTier = "strong" | "partial" | "stretch";

export type SimilarJob = {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
  // Machine-readable tier, sent by jobs_finder.py. Prefer this.
  match_tier?: string;
  // English prose. Still sent, and the only one present on resumes saved
  // before match_tier existed.
  match_label?: string;
};

// The three tiers jobs_finder.py emits, in each language. The backend sends
// a tier key and this renders it, rather than the backend sending English
// prose that got printed verbatim — which is why an Arabic generation used
// to come back fully Arabic apart from three English badges.
export const MATCH_TIER_COPY: Record<MatchTier, { en: string; ar: string }> = {
  strong: { en: "Strong Match", ar: "تطابق قوي" },
  partial: { en: "Partial Match", ar: "تطابق جزئي" },
  stretch: { en: "Stretch Role", ar: "فرصة طموحة" },
};

/**
 * Resolves a listing's tier. Prefers match_tier; falls back to reading the
 * English label for resumes saved before that field existed, which is the
 * only reason the substring match is still here.
 *
 * That fallback matters more on the history page than it did on the
 * dashboard: the resume list is where the OLDEST rows surface, so it is
 * the view most likely to meet a listing that only has match_label.
 */
export function getMatchTier(job: SimilarJob): MatchTier | null {
  const tier = job.match_tier;
  if (tier === "strong" || tier === "partial" || tier === "stretch") return tier;

  const normalized = (job.match_label || "").toLowerCase();
  if (normalized.includes("strong")) return "strong";
  if (normalized.includes("partial")) return "partial";
  if (normalized.includes("stretch")) return "stretch";
  return null;
}
