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

/** SAR is the charged amount; usd is a converted reference. Both come from the
 *  backend so no surface converts differently. */
export type MoneyAmount = { usd: number; sar: number };

/** Revenue minus worst-case AI cost, where worst case assumes every granted
 *  credit is burned on the most expensive generation. See §7 of the pricing
 *  reference and worst_case_cost_sar in backend/core/admin_stats.py. */
export type WorstCase = {
  worst_case_cost: MoneyAmount;
  worst_case_profit: MoneyAmount;
  /** null when there's no revenue to divide by, which is not the same as 0%. */
  worst_case_margin_pct: number | null;
  unit_worst_case_cost: MoneyAmount;
};

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
  tiers: ({
    tier: string;
    label: string;
    current_count: number;
    active_count: number;
    founding_count: number;
    price_sar: number | null;
    credits: number;
    estimated_monthly: MoneyAmount;
    /** Free tier: the figure is a cost, shown negative. */
    is_cost: boolean;
  } & WorstCase)[];
  packs_catalogue: ({
    slug: string;
    label: string;
    price_sar: number;
    credits: number;
    sold_ever: number;
    sold_this_month: number;
    revenue: MoneyAmount;
  } & WorstCase)[];
  /** Projected from who is subscribed right now at their actual price.
   *  Distinct from `revenue`, which is money actually recorded. */
  estimated_mrr: MoneyAmount;
  packs_revenue: { all_time: MoneyAmount; this_month: MoneyAmount };
  subscription_revenue: { this_month_estimated: MoneyAmount };
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
  /** Running worst-case total across paid tiers, packs and LinkedIn Essential.
   *  `excludes` names what is deliberately left out (LinkedIn Premium, whose
   *  cost is manual time rather than compute). */
  worst_case: {
    revenue: MoneyAmount;
    cost: MoneyAmount;
    profit: MoneyAmount;
    margin_pct: number | null;
    cost_per_credit: MoneyAmount;
    excludes: string[];
  };
  /** Actual LinkedIn add-on sales, read from linkedin_purchases rather than
   *  projected. `available: false` means those tables couldn't be read on this
   *  environment, which is an unread figure, not zero sales. */
  linkedin: {
    available: boolean;
    essential: {
      label: string;
      sold: number;
      revenue: MoneyAmount;
      worst_case_cost: MoneyAmount | null;
      worst_case_profit: MoneyAmount | null;
      worst_case_margin_pct: number | null;
      cost_tracked: boolean;
    };
    premium: {
      label: string;
      sold: number;
      revenue: MoneyAmount;
      /** Always null: premium's cost is manual labour, not a fixed API charge. */
      worst_case_cost: MoneyAmount | null;
      worst_case_profit: MoneyAmount | null;
      worst_case_margin_pct: number | null;
      cost_tracked: boolean;
    };
  };
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
