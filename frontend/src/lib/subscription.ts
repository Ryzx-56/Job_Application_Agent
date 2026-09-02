const API_URL = process.env.NEXT_PUBLIC_API_URL;

/* Loaded on demand rather than imported at the top. This module is reached
   from the PRICING page, which is a marketing page most visitors read signed
   out — and both functions below are only ever called from a button a
   subscriber clicks. A static import here put the Supabase client back into
   the marketing bundle through the back door, undoing the split in
   lib/auth.ts. See the note there. */
async function supabaseClient() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

/**
 * Cancels a Pro/Elite subscription and downgrades to Free. Used for both
 * the explicit "Cancel subscription" action and the "Switch to Free"
 * downgrade — same backend call either way.
 */
export async function cancelSubscription(): Promise<void> {
  const supabase = await supabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/subscription/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed: ${res.status}`);
  }
}

/** Undoes a scheduled cancellation/downgrade. */
export async function resumeSubscription(): Promise<void> {
  const supabase = await supabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/subscription/resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed: ${res.status}`);
  }
}

/** A scheduled plan change, or null when nothing is scheduled. */
export type PlanChange = {
  changed: boolean;
  plan: string;
  pending_plan?: string | null;
  direction?: "upgrade" | "downgrade";
  effective_at?: string | null;
  reason?: string;
};

/**
 * Move between Free, Pro and Elite.
 *
 * TAKES EFFECT AT THE NEXT BILLING DATE — no proration, no charge now. It
 * only schedules the change, which is why it is safe to offer as a plain
 * button: nothing is taken and resumeSubscription() undoes it.
 */
export async function changePlan(plan: "free" | "pro" | "elite"): Promise<PlanChange> {
  const supabase = await supabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/subscription/change-plan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.message ?? body?.detail ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export type SavedCard = {
  card: {
    brand: string | null;
    last_four: string | null;
    expiry_month: string | null;
    expiry_year: string | null;
    status: string;
  } | null;
  /** False while a live subscription depends on this card. */
  removable: boolean;
  in_use_by?: { plan: string; status: string } | null;
};

export async function fetchSavedCard(): Promise<SavedCard> {
  const supabase = await supabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/payments/card`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

/** Removing a card is refused server-side while a subscription depends on
 *  it — the UI disables the button for the same reason, but the 409 is the
 *  actual guard. */
export async function removeSavedCard(): Promise<void> {
  const supabase = await supabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/payments/card`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.message ?? `Request failed: ${res.status}`);
  }
}
