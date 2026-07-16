import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * Cancels a Pro/Elite subscription and downgrades to Free. Used for both
 * the explicit "Cancel subscription" action and the "Switch to Free"
 * downgrade — same backend call either way.
 */
export async function cancelSubscription(): Promise<void> {
  const supabase = createClient();
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
  const supabase = createClient();
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
