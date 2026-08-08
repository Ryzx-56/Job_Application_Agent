import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/* ========================================================================
   ADMIN DATA

   Every call is gated server-side by profiles.is_admin (core/auth.py). A
   non-admin gets a 403 no matter what the browser sends, so there is no
   client-side check here by design.
======================================================================== */

async function adminGet<T>(path: string): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}${path}`, {
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

export type MoneyAmount = { usd: number; sar: number };

export type AdminAnalytics = {
  generated_at: string;
  current_month_label: string;
  usd_to_sar: number;
  signups: { total: number | null; this_month: number | null };
  generations: {
    total: number | null;
    this_month: number | null;
    arabic_total: number | null;
    english_total: number | null;
    arabic_this_month: number | null;
    english_this_month: number | null;
    failed_total: number | null;
  };
  founding_members: number | null;
  tiers: { tier: string; current_count: number; active_count: number }[];
  /** False until the first payment_events row exists. Revenue and
   *  purchase-history tiles are unknowable, not zero, while this is false. */
  payments_wired: boolean;
  revenue: { all_time: MoneyAmount; this_month: MoneyAmount };
  subscriptions: { ever: number; this_month: number };
  packs: { ever: number; this_month: number };
  by_product: {
    kind: string;
    product_slug: string;
    count_ever: number;
    count_month: number;
    revenue: MoneyAmount;
  }[];
};

export type AdminPipelineHealth = {
  window_days: number;
  runs: number;
  succeeded: number;
  failed: number;
  success_rate: number | null;
  hit_max_retries: number;
  avg_tailoring_attempts: number;
  arabic: {
    runs: number;
    purity_pass_fired: number;
    still_latin_after_pass: number;
    still_latin_rate: number | null;
  };
  name_fallback_used: number;
  tokens: { input: number; output: number; calls: number };
  top_errors: { message: string; count: number; last_seen: string }[];
};

export type AdminUserRow = {
  id: string;
  email: string | null;
  name_en: string | null;
  name_ar: string | null;
  tier: string | null;
  pending_tier: string | null;
  subscription_status: string | null;
  tier_expires_at: string | null;
  credits_remaining: number | null;
  credits_total: number | null;
  credits_reset_at: string | null;
  is_founding_member: boolean | null;
  founding_member_number: number | null;
  locked_price: string | number | null;
  location: string | null;
  is_admin: boolean | null;
  is_owner: boolean | null;
  signed_up_at: string | null;
  cv_count: number;
  last_generated_at: string | null;
  total_paid: MoneyAmount;
  payment_count: number;
};

export const fetchAdminAnalytics = () => adminGet<AdminAnalytics>("/api/v1/admin/analytics");

export const fetchPipelineHealth = (days = 30) =>
  adminGet<AdminPipelineHealth>(`/api/v1/admin/pipeline-health?days=${days}`);

export const fetchAdminUsers = (q?: string) =>
  adminGet<{ users: AdminUserRow[]; count: number }>(
    `/api/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`
  );
