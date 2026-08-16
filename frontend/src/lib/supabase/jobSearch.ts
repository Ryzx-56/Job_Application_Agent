import { createClient } from "@/lib/supabase/client";
import type { SimilarJob } from "@/lib/jobMatch";

/* ========================================================================
   JOB SEARCH (/dashboard/job-search) — Pro and Elite.

   Standalone: a job title goes in, live listings come back. No CV, no job
   description, no credits. The backend does the searching through the same
   pipeline the post-generation "similar jobs" panel uses — see
   backend/agents/jobs_finder.py's search_jobs_by_title.

   Listings come back in the SAME SHAPE as the ones stored on a resume
   (SimilarJob, from @/lib/jobMatch), so the page can resolve match tiers
   with the same getMatchTier the dashboard and My Resumes use.
======================================================================== */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type JobSearchOverview = {
  tier: string;
  unlocked: boolean;
  default_location: string;
};

export type JobSearchResults = {
  job_title: string;
  internships: boolean;
  location: string;
  /** Listings whose own title genuinely matches what was searched. */
  exact: SimilarJob[];
  /** Adjacent roles, only populated once the exact matches ran out. */
  related: SimilarJob[];
  /** The adjacent titles that were searched, for labelling the second group. */
  related_titles: string[];
};

export class JobSearchError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new JobSearchError("Not authenticated", "unauthenticated", 401);
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

async function unwrap(res: Response) {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  // The backend sends a machine-readable `code` so the page can show
  // localized copy rather than an English sentence from the server — the
  // same convention core/linkedin.py and core/interview.py use.
  throw new JobSearchError(
    typeof detail === "string" ? detail : detail?.message ?? `Request failed: ${res.status}`,
    typeof detail === "object" ? detail?.code : undefined,
    res.status
  );
}

/** Tier + default location. Not gated — a Free user loads this to see the
 *  locked preview, exactly like the Interview Prep overview. */
export async function fetchJobSearchOverview(): Promise<JobSearchOverview> {
  const res = await fetch(`${API_URL}/api/v1/job-search/overview`, { headers: await authHeaders() });
  return unwrap(res);
}

/** The search itself. 403 `upgrade_required` for Free users — enforced
 *  server-side, not by this client. */
export async function searchJobs(params: {
  jobTitle: string;
  internships: boolean;
  location?: string;
}): Promise<JobSearchResults> {
  const res = await fetch(`${API_URL}/api/v1/job-search`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      job_title: params.jobTitle,
      internships: params.internships,
      location: params.location || null,
    }),
  });
  return unwrap(res);
}
