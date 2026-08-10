import { createClient } from "@/lib/supabase/client";

/* ========================================================================
   INTERVIEW PREP API CLIENT

   Both calls go to the backend rather than straight to Supabase, because
   both re-verify ownership server-side and /generate additionally re-checks
   the caller's subscription tier. See backend/core/interview.py.

   Shapes mirror backend/schemas/interview_schema.py. Unlike the LinkedIn
   add-on, the questions are written in THE SITE'S language at generation
   time, not the CV's: someone reading the page in Arabic wants Arabic
   questions whichever language their CV happens to be in, and the model
   translates. `content.language` records which was used, and the results
   view sets its direction from that, so a prep generated in Arabic still
   renders RTL after the reader switches the site to English.

   RESULTS ARE SAVED, one per CV. fetchSavedInterviewPrep opens an existing
   one for free; generateInterviewPrep is the only call that spends one of
   the month's generations.
======================================================================== */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type InterviewCategory = "behavioral" | "technical" | "role_specific" | "gap";

/** The four buckets, in the order the filter tabs show them. Gap sits last
 *  because it's the one worth ending on, and first-among-equals visually. */
export const INTERVIEW_CATEGORIES: InterviewCategory[] = [
  "behavioral",
  "technical",
  "role_specific",
  "gap",
];

export type InterviewStarAnswer = {
  situation: string;
  task: string;
  action: string;
  result: string;
};

export type InterviewQuestion = {
  question: string;
  category: InterviewCategory;
  /** Why this employer would ask this, tied to a specific line in the JD. */
  why_asked: string;
  /** The short JD phrase it comes from. */
  jd_hook: string;
  answer_angle: string;
  /** The answer itself: a first-person paragraph to read and rehearse from.
   *  Absent on preps generated before this field existed. */
  answer_paragraph?: string;
  /** The same answer as four beats, shown underneath as a summary. */
  star: InterviewStarAnswer;
  /** Real CV items the answer draws on: project names, employers, roles. */
  cv_evidence: string[];
  /** Gap questions only. An honest way to handle a requirement the CV does
   *  not demonstrate, never a way to claim it is met. Empty on every other
   *  category. */
  gap_honesty: string;
};

export type InterviewPrepContent = {
  overview: string;
  questions: InterviewQuestion[];
  role: string;
  company: string;
  /** The CV's language, which is the language the questions are written in. */
  language: "en" | "ar" | string;
  /** False when the JD analysis had to be recomputed because the CV predates
   *  generation_snapshot. Not shown to the user; useful in a bug report. */
  reused_stored_analysis: boolean;
};

/** Why a CV can't be prepped from. Both are permanent for that row, which is
 *  why the picker disables the card instead of letting it fail on click. */
export type InterviewIneligibleReason = "no_jd" | "no_snapshot" | null;

export type InterviewCv = {
  id: string;
  role: string | null;
  company: string | null;
  cv_language: "en" | "ar";
  created_at: string;
  eligible: boolean;
  ineligible_reason: InterviewIneligibleReason;
  /** When a prep was last generated for this CV, or null. Opening a prepared
   *  CV costs no monthly generation. */
  prepared_at?: string | null;
};

export type InterviewOverview = {
  tier: string;
  /** Pro or Elite. The page blurs itself when false; the backend refuses
   *  /generate when false. Two checks, and only the second one matters. */
  unlocked: boolean;
  cvs: InterviewCv[];
  question_range: { min: number; max: number };
  /** This month's allowance. Absent on an older backend. */
  quota?: InterviewQuota;
};

/** How many generations are left this month. */
export type InterviewQuota = {
  tier: string;
  limit: number;
  used: number;
  remaining: number;
  unlocked: boolean;
};

/** Error carrying the backend's machine-readable code so the page can show
 *  localized copy instead of the English fallback. Same convention
 *  lib/supabase/linkedin.ts uses. */
export type ApiError = Error & {
  status?: number;
  code?: string;
  detail?: Record<string, unknown>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const err: ApiError = new Error(
      typeof detail === "string" ? detail : detail?.message ?? `Request failed: ${res.status}`
    );
    err.status = res.status;
    if (detail && typeof detail === "object") {
      err.code = detail.code;
      err.detail = detail;
    }
    throw err;
  }

  return res.json() as Promise<T>;
}

export async function fetchInterviewOverview(): Promise<InterviewOverview> {
  return request<InterviewOverview>("/api/v1/interview/overview");
}

/** Opens a previously generated prep. Costs no monthly generation, which is
 *  why the page always tries this before offering to generate. */
export async function fetchSavedInterviewPrep(
  resumeId: string
): Promise<{ resume_id: string; content: InterviewPrepContent; updated_at: string }> {
  return request(`/api/v1/interview/preps/${resumeId}`);
}

/** The phases the backend actually reports, in order. `localize` only fires
 *  on an Arabic CV. Mirrors the `on_step` calls in
 *  backend/agents/interview_prep.py. */
export type InterviewStep = "prepare" | "generate" | "localize";

/**
 * Runs the generator, over Server-Sent Events.
 *
 * WHY SSE AND NOT A PLAIN POST: a run takes two to four minutes, which is
 * long enough for a proxy or load balancer to drop an idle connection. The
 * backend emits a heartbeat every 10 seconds so the connection is never idle
 * (see the note above the streaming endpoint in backend/core/interview.py).
 * The side benefit is that `onStep` reports phases the backend has genuinely
 * reached, instead of a timer pretending to know.
 *
 * Uses fetch with a manually-parsed body rather than the native EventSource,
 * for the same reason useOptimizeStream.ts does: EventSource is GET-only and
 * cannot send an Authorization header.
 *
 * Anything refusable (tier, ownership, eligibility) is refused before the
 * stream opens and arrives as a normal HTTP error, so those still throw an
 * ApiError with a `code` exactly like the other calls here.
 */
export async function generateInterviewPrep(
  resumeId: string,
  /** The site's language. The questions are written in it, so an English CV
   *  read on an Arabic page produces Arabic questions. */
  language: "en" | "ar",
  onStep?: (step: InterviewStep) => void
): Promise<{ resume_id: string; content: InterviewPrepContent; quota?: InterviewQuota }> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/interview/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ resume_id: resumeId, language }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const err: ApiError = new Error(
      typeof detail === "string" ? detail : detail?.message ?? `Request failed: ${res.status}`
    );
    err.status = res.status;
    if (detail && typeof detail === "object") {
      err.code = detail.code;
      err.detail = detail;
    }
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: { resume_id: string; content: InterviewPrepContent; quota?: InterviewQuota } | null = null;
  let streamError: ApiError | null = null;

  // SSE frames are separated by a blank line; a frame can arrive split across
  // reads, so only whole frames are consumed and the remainder stays buffered.
  const consume = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return; // a malformed frame is not worth failing the whole run over
    }

    if (event === "step" && onStep) {
      onStep(payload.step as InterviewStep);
    } else if (event === "complete") {
      complete = payload as unknown as {
        resume_id: string;
        content: InterviewPrepContent;
        quota?: InterviewQuota;
      };
    } else if (event === "error") {
      const err: ApiError = new Error(
        (payload.message as string) || "Generation failed."
      );
      err.code = payload.code as string;
      streamError = err;
    }
    // "ping" is the keep-alive and carries nothing to act on.
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      consume(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
    }
  }
  if (buffer.trim()) consume(buffer);

  if (streamError) throw streamError;
  if (!complete) {
    // The stream ended without either outcome, which means it was cut short.
    // Reported as its own code so the page can offer a retry rather than
    // showing a generic failure for something that may simply have dropped.
    const err: ApiError = new Error("The connection dropped before your questions finished.");
    err.code = "stream_interrupted";
    throw err;
  }
  return complete;
}
