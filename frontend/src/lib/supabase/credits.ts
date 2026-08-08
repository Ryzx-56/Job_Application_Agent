import { createClient } from "@/lib/supabase/client";

export type Tier = "free" | "pro" | "elite";

export type CreditsInfo = {
  tier: Tier;
  creditsRemaining: number;
  creditsTotal: number;
  pendingTier: Tier | null;
  creditsResetAt: string;
  isFoundingMember: boolean;
  foundingMemberNumber: number | null;
  location: string | null;
};

/* ========================================================================
   FETCH — reads the logged-in user's own profile row. RLS only grants
   SELECT on this table (see 001_profiles_credits.sql), so this can never
   be used to change tier/credits — only the backend can do that. Same
   applies to `location` — see lib/supabase/location.ts for the write path.
======================================================================== */
export async function fetchCredits(): Promise<CreditsInfo> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("profiles")
    // NOTE: do NOT add speculative columns here. PostgREST fails the ENTIRE
    // query if any single named column is missing, so a column that hasn't
    // been migrated yet takes down tier, credits AND location with it. The
    // admin flag is read from its own endpoint for exactly this reason —
    // see fetchAdminStatus in lib/supabase/profile-names.ts.
    .select("tier, credits_remaining, credits_total, pending_tier, credits_reset_at, is_founding_member, founding_member_number, location")
    .eq("id", user.id)
    .single();

  if (error || !data) throw error ?? new Error("Failed to load credits");

  return {
    tier: data.tier,
    creditsRemaining: data.credits_remaining,
    creditsTotal: data.credits_total,
    pendingTier: data.pending_tier,
    creditsResetAt: data.credits_reset_at,
    isFoundingMember: data.is_founding_member,
    foundingMemberNumber: data.founding_member_number,
    location: data.location,
  };
}
