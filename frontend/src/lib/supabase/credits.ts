import { createClient } from "@/lib/supabase/client";

export type Tier = "free" | "pro" | "elite";

export type CreditsInfo = {
  tier: Tier;
  creditsRemaining: number;
  creditsTotal: number;
};

/* ========================================================================
   FETCH — reads the logged-in user's own profile row. RLS only grants
   SELECT on this table (see 001_profiles_credits.sql), so this can never
   be used to change tier/credits — only the backend can do that.
======================================================================== */
export async function fetchCredits(): Promise<CreditsInfo> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("profiles")
    .select("tier, credits_remaining, credits_total")
    .eq("id", user.id)
    .single();

  if (error || !data) throw error ?? new Error("Failed to load credits");

  return {
    tier: data.tier,
    creditsRemaining: data.credits_remaining,
    creditsTotal: data.credits_total,
  };
}
