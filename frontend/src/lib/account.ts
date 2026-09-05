const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * Delete the signed-in account, permanently.
 *
 * Takes no user id: the backend deletes whoever the token belongs to and
 * nobody else, so there is no parameter here that could be tampered with.
 *
 * On success the auth user no longer exists. The caller must sign out
 * immediately — a JWT is stateless and stays signature-valid until it
 * expires, so the session would otherwise linger against an account that
 * is gone and every request would fail confusingly.
 */
export async function deleteAccount(): Promise<void> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/v1/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string" ? detail : detail?.message ?? `Request failed: ${res.status}`
    );
  }
}
