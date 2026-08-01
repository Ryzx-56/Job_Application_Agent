import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * Updates the logged-in user's location (profiles.location). Same trust
 * model as subscription.ts/credits.ts: RLS only grants SELECT on profiles
 * for the caller's own row, so a write has to go through the backend using
 * the service_role key — see core/location.py.
 */
export async function updateLocation(location: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/profile/location`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ location }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed: ${res.status}`);
  }
}
