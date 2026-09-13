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
  /** True when this response was served from the shared cache rather than a
   *  live search — see supabase/migrations/20260912100000_..._cache.sql. */
  from_cache?: boolean;
  /** When the underlying listings were actually fetched (ISO 8601) — only
   *  present on a cache hit; a fresh live search has no separate "cached
   *  at" moment worth showing. */
  cached_at?: string;
};

/** One entry in this user's own search history. Free to list and free to
 *  reopen, regardless of age — see /api/v1/job-search/history. */
export type JobSearchHistoryEntry = {
  id: string;
  cache_key: string;
  raw_query: string;
  location: string;
  internships: boolean;
  searched_at: string;
};

/** A reopened history entry's results — always served from cache, and
 *  flagged stale rather than silently re-fetched. */
export type JobSearchReopenResult = JobSearchResults & {
  searched_at: string;
  is_stale: boolean;
};

export class JobSearchError extends Error {
  code?: string;
  status?: number;
  /** The backend's full `detail` object, when it sent one — carries the
   *  extra fields a plain code/message can't (credit_cost/credit_balance on
   *  a 402, purchase_limit on a 429). See @/lib/addonPurchase. */
  detail?: Record<string, unknown>;
  constructor(message: string, code?: string, status?: number, detail?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
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
    res.status,
    typeof detail === "object" ? detail : undefined
  );
}

/** Tier + default location. Not gated — a Free user loads this to see the
 *  locked preview, exactly like the Interview Prep overview. */
export async function fetchJobSearchOverview(): Promise<JobSearchOverview> {
  const res = await fetch(`${API_URL}/api/v1/job-search/overview`, { headers: await authHeaders() });
  return unwrap(res);
}

/** The search itself.
 *
 *  A plain call (refresh not set) may still come back `from_cache: true` —
 *  that's the shared cache serving a fresh entry, not something the caller
 *  asked for. `refresh: true` is the ONLY thing that forces a live
 *  re-search of a query that already has one; the caller must have gotten
 *  an explicit confirmation from the user before ever setting it — this
 *  function does not ask again.
 *
 *  Once the shared Job Search baseline is exhausted (core/job_search.py,
 *  same pool as the per-CV find-jobs button), this raises a 402
 *  `addon_purchase_available` naming the credit cost and balance — see
 *  @/lib/addonPurchase. Pass `spendCredits: true` (the request's
 *  `spend_credits` field) only after the user has explicitly confirmed
 *  that dialog; this function never asks on its own. */
export async function searchJobs(params: {
  jobTitle: string;
  internships: boolean;
  location?: string;
  refresh?: boolean;
  spendCredits?: boolean;
}): Promise<JobSearchResults> {
  const res = await fetch(`${API_URL}/api/v1/job-search`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      job_title: params.jobTitle,
      internships: params.internships,
      location: params.location || null,
      refresh: params.refresh ?? false,
      spend_credits: params.spendCredits ?? false,
    }),
  });
  return unwrap(res);
}

/** This user's past searches, newest first. Costs nothing to call — it's a
 *  list of past lookups, not a search. */
export async function fetchJobSearchHistory(): Promise<JobSearchHistoryEntry[]> {
  const res = await fetch(`${API_URL}/api/v1/job-search/history`, { headers: await authHeaders() });
  const data = await unwrap(res);
  return data.history ?? [];
}

/** Reopens one past search. ALWAYS free regardless of age — a result set
 *  past the cache TTL comes back with `is_stale: true` rather than hidden
 *  or silently re-fetched. Refresh (searchJobs with refresh: true) is the
 *  only paid path. */
export async function reopenJobSearch(historyId: string): Promise<JobSearchReopenResult> {
  const res = await fetch(`${API_URL}/api/v1/job-search/history/${encodeURIComponent(historyId)}`, {
    headers: await authHeaders(),
  });
  return unwrap(res);
}
