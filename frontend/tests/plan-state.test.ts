import { test } from "node:test";
import assert from "node:assert/strict";

import { planCardState, type Viewer } from "../src/lib/plan-state.ts";
import type { Tier } from "../src/lib/supabase/credits.ts";

/* Run with `npm test` (node's built-in runner — no test dependency).

   THE INVARIANT AT THE BOTTOM IS THE POINT. Everything else documents
   behaviour; that one asserts a subscriber is never shown a purchase, which
   is the bug this module was extracted to make impossible. */

const TIERS: Tier[] = ["free", "pro", "elite"];
const kind = (plan: Tier, viewer: Viewer) => planCardState(plan, viewer).kind;

test("a reader we cannot identify gets no tier-specific state", () => {
  for (const plan of TIERS) assert.equal(kind(plan, null), "unknown");
});

test("someone on Free is offered a purchase, and told Free is theirs", () => {
  const free: Viewer = { tier: "free", pendingTier: null };
  assert.equal(kind("free", free), "current-free");
  assert.equal(kind("pro", free), "buy");
  assert.equal(kind("elite", free), "buy");
});

test("a subscriber sees their own plan as subscribed, not as something to buy", () => {
  const elite: Viewer = { tier: "elite", pendingTier: null };
  assert.equal(kind("elite", elite), "subscribed");
  // The original bug: this rendered "Go Elite" and sent them to checkout.
  assert.equal(kind("pro", elite), "switch");
  assert.equal(kind("free", elite), "downgrade-to-free");
});

test("a scheduled change is shown on both the plan being left and the one arriving", () => {
  const leaving: Viewer = { tier: "elite", pendingTier: "free" };
  assert.equal(kind("elite", leaving), "leaving");
  assert.equal(kind("free", leaving), "arriving");
  // Uninvolved paid plan still offers a way to stay rather than rendering blank.
  assert.equal(kind("pro", leaving), "switch");
});

test("a pending tier equal to the current tier is not a change", () => {
  const noop: Viewer = { tier: "pro", pendingTier: "pro" };
  assert.equal(kind("pro", noop), "subscribed");
});

test("nobody with a card on file is ever offered a purchase", () => {
  // "buy" means checkout, which takes money and opens a second subscription.
  // A subscriber's move must always be a scheduled switch instead.
  const leaks: string[] = [];
  for (const tier of ["pro", "elite"] as Tier[]) {
    for (const pendingTier of [null, "free", "pro", "elite"] as (Tier | null)[]) {
      for (const plan of TIERS) {
        if (kind(plan, { tier, pendingTier }) === "buy") {
          leaks.push(`tier=${tier} pending=${pendingTier} card=${plan}`);
        }
      }
    }
  }
  assert.deepEqual(leaks, [], `double-charge paths: ${leaks.join("; ")}`);
});
