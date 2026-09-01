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
