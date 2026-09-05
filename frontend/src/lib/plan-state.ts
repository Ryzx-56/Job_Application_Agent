import type { Tier } from "@/lib/supabase/credits";

/* ========================================================================
   WHAT ONE PLAN CARD SHOULD OFFER A PARTICULAR READER.

   This is the decision only. Both surfaces that show plans render it their
   own way — /pricing is dark editorial type, /dashboard/upgrade is light
   product cards — and neither layout is shared. What IS shared is the rule
   for which of the seven situations a given card is in.

   WHY THIS FILE EXISTS. The rule lived in both pages independently. The
   dashboard copy was written without tier awareness at all, so an Elite
   subscriber was invited to buy Elite, and following that invitation went
   to checkout and would have charged them a second time for a plan they
   already had. That was the fourth bug in this codebase caused by one rule
   with two homes and only one of them maintained. There is now one home.

   THE MONEY RULE THIS ENCODES, and the reason it is not just presentation:
   somebody on Free has no card on file, so moving up means a real purchase
   through checkout. Somebody already subscribed HAS a card and a live
   billing period, so their move is scheduled against the period they have
   already paid for and costs nothing today. Sending the second person down
   the first person's path double-charges them. "buy" and "switch" are
   different states here because they are different transactions.
======================================================================== */

/** Plan order, for deciding which direction a move is. */
export const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };

export type PlanCardState =
  /** We do not know who is reading yet — signed out, or the tier is still
   *  loading. The two surfaces answer this differently on purpose: the
   *  marketing page shows its normal call to action, the dashboard holds a
   *  placeholder rather than flashing a buy button at a subscriber. */
  | { kind: "unknown" }
  /** Reader is on Free and this is the Free column. */
  | { kind: "current-free" }
  /** Reader subscribes to THIS plan and nothing is scheduled. */
  | { kind: "subscribed" }
  /** This is the reader's current plan and they are scheduled to leave it. */
  | { kind: "leaving"; to: Tier }
  /** This plan is the scheduled destination. */
  | { kind: "arriving"; from: Tier }
  /** Reader is on Free: moving here is a purchase. */
  | { kind: "buy" }
  /** Reader already subscribes to a different paid plan: this is a
   *  scheduled switch, charged at the next renewal, nothing taken now. */
  | { kind: "switch" }
  /** Reader subscribes and this is the Free column: a downgrade. */
  | { kind: "downgrade-to-free" };

export type Viewer = { tier: Tier; pendingTier: Tier | null } | null;

/**
 * `viewer` is null when the reader is signed out or their tier has not
 * loaded — both produce "unknown", and the caller decides what that looks
 * like.
 */
export function planCardState(planSlug: Tier, viewer: Viewer): PlanCardState {
  if (!viewer) return { kind: "unknown" };

  const { tier, pendingTier } = viewer;
  // A pending tier equal to the current one is not a change. The pricing
  // page used to treat any non-null pendingTier as pending; this is the
  // stricter reading and matches what the dashboard already did.
  const hasPending = pendingTier !== null && pendingTier !== tier;
  const isCurrent = tier === planSlug;

  if (isCurrent) {
    if (hasPending) return { kind: "leaving", to: pendingTier as Tier };
    return planSlug === "free" ? { kind: "current-free" } : { kind: "subscribed" };
  }

  if (hasPending && pendingTier === planSlug) return { kind: "arriving", from: tier };

  // Not this card, and nothing scheduled onto it.
  if (tier === "free") return { kind: "buy" };
  if (planSlug === "free") return { kind: "downgrade-to-free" };

  // RECONCILED DIFFERENCE. With a change already scheduled, /pricing used to
  // render an uninvolved paid card with no control at all — a dead column
  // with no explanation of why. It offers the switch now, as the dashboard
  // already did: changePlan simply replaces the scheduled change, which is a
  // legitimate way to stay rather than leave, and a card that does nothing
  // and says nothing is worse than one that does.
  return { kind: "switch" };
}
