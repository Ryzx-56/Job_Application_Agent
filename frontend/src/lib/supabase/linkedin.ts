import { createClient } from "@/lib/supabase/client";

/* ========================================================================
   LINKEDIN ADD-ON API CLIENT

   Every call here goes to the backend (never straight to Supabase), because
   every one of these routes re-verifies ownership server-side, see the
   security notes in backend/core/linkedin.py. The browser has SELECT-own and
   nothing else on the linkedin_* tables, so a purchase can't be created or a
   payment marked paid from here even in principle.

   Shapes mirror backend/schemas/linkedin_schema.py. All CONTENT strings are
   English regardless of the UI language, that's the feature's language rule,
   not an oversight. Wrap them in dir="ltr" when rendering under an Arabic UI.

   The exception is the "_ar" fields, which hold the Arabic rendering of the
   parts that are ADVICE rather than paste-ready content (the growth playbook,
   and why a suggested certification is worth holding). They're optional on
   these types because generations created before they existed don't have
   them, so every reader has to fall back to the English.
======================================================================== */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/** The tier a stored purchase or generation carries. "normal" is Essential,
 *  which still labels historic rows and every new bundled generation. */
export type LinkedInTier = "normal" | "premium";

/** What can actually be BOUGHT. Essential is not on this list: it comes with
 *  Pro and Elite and is metered monthly (pricing reference v6 section 4), so
 *  there is no checkout for it and the type says so. */
export type LinkedInPurchasableTier = "premium";

/** How much of this month's bundled allowance is left. */
export type LinkedInQuota = {
  tier: string;
  limit: number;
  used: number;
  remaining: number;
  /** Pro or Elite with a non-zero cap. False on Free. */
  unlocked: boolean;
};

export type LinkedInIntro = {
  first_name: string;
  last_name: string;
  headline: string;
  current_position: string;
  industry: string;
  education: string;
  location: string;
};

export type LinkedInAbout = { text: string; skills: string[] };

export type LinkedInFeaturedItem = { label: string; url: string; instruction: string };

export type LinkedInExperienceEntry = {
  job_title: string;
  organization: string;
  location: string;
  location_type: string;
  employment_type: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  description: string;
  highlights: string[];
  skills: string[];
};

export type LinkedInPostIdea = { title: string; angle: string; draft_hook: string };

export type LinkedInEducationSection = {
  instruction: string;
  education_entries: { school: string; degree: string; dates: string }[];
  certifications_note: string;
  /** name and issuer are always English (they're the credential's real,
   *  searchable names); why_ar is the Arabic of `why`, for an Arabic UI. */
  recommended_certifications: { name: string; issuer: string; why: string; why_ar?: string }[];
};

export type LinkedInProjectsSection = {
  instruction: string;
  /** `skills` are the five to tag on the project in LinkedIn's own box.
   *  Absent on generations made before the field existed. */
  entries: { name: string; description: string; skills?: string[] }[];
  recommended: { name: string; why: string; description: string }[];
};

export type LinkedInContent = {
  intro: LinkedInIntro;
  about: LinkedInAbout;
  /** null when the CV had no links to feature, the section is skipped entirely. */
  featured: LinkedInFeaturedItem[] | null;
  experience: LinkedInExperienceEntry[];
  post_ideas: LinkedInPostIdea[];
  education_and_certifications: LinkedInEducationSection;
  projects: LinkedInProjectsSection;
  /** Advice, not paste-ready content, so it comes in both languages. The
   *  Arabic pair is either complete or absent, never partial. */
  growth_playbook: { title: string; steps: string[]; title_ar?: string; steps_ar?: string[] };
  content_language: "en";
  source_cv_language: string;
};

export type LinkedInCvRef = {
  id?: string | null;
  role?: string | null;
  company?: string | null;
  cv_language?: "en" | "ar" | null;
} | null;

export type LinkedInHistoryItem = {
  generation_id: string;
  purchase_id: string;
  status: "generating" | "ready" | "failed";
  created_at: string;
  tier: LinkedInTier | null;
  source_cv: LinkedInCvRef;
};

export type LinkedInPendingGeneration = {
  purchase_id: string;
  tier: LinkedInTier;
  source_cv_id: string | null;
  source_cv: LinkedInCvRef;
  created_at: string;
};

export type LinkedInPurchase = {
  id: string;
  tier: LinkedInTier;
  source_cv_id: string | null;
  price_paid: number;
  currency: string;
  payment_status: "pending" | "paid" | "failed";
  fulfillment_status: "not_required" | "pending" | "in_progress" | "done";
  created_at: string;
  paid_at: string | null;
};

export type LinkedInOverview = {
  /** Premium only. Essential has no price, so it is absent by construction
   *  rather than present-and-zero. */
  pricing: Record<LinkedInPurchasableTier, { price: number; currency: string }>;
  /** This month's included Essential allowance. Absent on an older backend. */
  essential_quota?: LinkedInQuota;
  /** available=false is the normal state until Moyasar is live: the UI shows
   *  "payment coming soon" rather than a broken buy button. */
  gateway: { available: boolean; provider: string | null; is_mock: boolean };
  has_purchased: boolean;
  purchases: LinkedInPurchase[];
  history: LinkedInHistoryItem[];
  pending_generations: LinkedInPendingGeneration[];
};

export type LinkedInGeneration = {
  generation_id: string;
  purchase_id: string;
  status: "generating" | "ready" | "failed";
  created_at: string;
  tier: LinkedInTier | null;
  source_cv: LinkedInCvRef;
  content: LinkedInContent | null;
};

/** Error carrying the backend's machine-readable code so callers can show
 *  localized copy instead of the English fallback message, same convention
 *  useOptimizeStream.ts already uses. */
export type ApiError = Error & {
  status?: number;
  code?: string;
  field?: string;
  /** The backend's full `detail` object, when it sent one. Carries extras
   *  like `generation_id` on an "already_generated" conflict, so the UI can
   *  open the existing generation instead of just reporting the clash. */
  detail?: Record<string, unknown>;
};

async function accessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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
      err.field = detail.field;
      err.detail = detail;
    }
    throw err;
  }

  return res.json() as Promise<T>;
}

/* ── Buyer-facing ─────────────────────────────────────────────────────── */

export async function fetchLinkedInOverview(): Promise<LinkedInOverview> {
  return request<LinkedInOverview>("/api/v1/linkedin/overview");
}

export type CheckoutResult = {
  purchase_id: string;
  status: "paid" | "pending";
  provider: string;
  is_mock: boolean;
  /** Where to send the buyer to pay, when the gateway is a hosted one. */
  redirect_url: string | null;
};

export async function startLinkedInCheckout(params: {
  /** Premium only. Essential cannot be checked out. */
  tier: LinkedInPurchasableTier;
  sourceCvId: string;
  contactPhone?: string;
  contactConsent?: boolean;
}): Promise<CheckoutResult> {
  return request<CheckoutResult>("/api/v1/linkedin/checkout", {
    method: "POST",
    body: JSON.stringify({
      tier: params.tier,
      source_cv_id: params.sourceCvId,
      contact_phone: params.contactPhone ?? null,
      contact_consent: params.contactConsent ?? false,
    }),
  });
}

/** Runs the generator. Slow by nature (one Claude call), so callers should
 *  show progress rather than a spinner with no explanation. */
export async function generateLinkedInProfile(params: {
  /** Omit for the Essential included with a subscription; supply it for a
   *  paid Premium purchase. The backend picks the route from its presence. */
  purchaseId?: string;
  sourceCvId?: string;
}): Promise<{
  generation_id: string;
  purchase_id: string | null;
  tier: LinkedInTier;
  status: string;
  content: LinkedInContent;
  /** Present on the included route: what's left after this run. */
  quota?: LinkedInQuota;
}> {
  return request("/api/v1/linkedin/generate", {
    method: "POST",
    body: JSON.stringify({
      purchase_id: params.purchaseId ?? null,
      source_cv_id: params.sourceCvId ?? null,
    }),
  });
}

export async function fetchLinkedInGeneration(generationId: string): Promise<LinkedInGeneration> {
  return request<LinkedInGeneration>(`/api/v1/linkedin/generations/${generationId}`);
}

/* ── Admin: premium fulfillment queue ─────────────────────────────────── */

export type PremiumOrder = {
  id: string;
  user_id: string;
  tier: "premium";
  source_cv_id: string | null;
  price_paid: number;
  currency: string;
  contact_phone: string | null;
  contact_consent: boolean;
  fulfillment_status: "pending" | "in_progress" | "done";
  fulfilled_at: string | null;
  notified_at: string | null;
  paid_at: string | null;
  created_at: string;
  buyer: { email?: string | null; name_en?: string | null; name_ar?: string | null };
  source_cv: { id: string; role: string | null; company: string | null; cv_language: "en" | "ar" } | null;
};

export async function fetchPremiumOrders(includeDone = false): Promise<{
  orders: PremiumOrder[];
  pending_count: number;
}> {
  return request(`/api/v1/admin/linkedin/orders?include_done=${includeDone ? "true" : "false"}`);
}

export async function updatePremiumOrder(
  purchaseId: string,
  fulfillmentStatus: "pending" | "in_progress" | "done"
): Promise<{ order: PremiumOrder }> {
  return request(`/api/v1/admin/linkedin/orders/${purchaseId}?fulfillment_status=${fulfillmentStatus}`, {
    method: "PATCH",
  });
}
