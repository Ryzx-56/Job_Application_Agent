import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * SERVER-SIDE GATE for every /dashboard/admin/* route.
 *
 * The sub-pages were already safe — each one only renders data fetched from
 * /api/v1/admin/*, which re-checks profiles.is_admin on every request — but
 * the landing page is a static list of cards with no fetch behind it, so a
 * non-admin who typed the URL got a fully rendered admin page. Nothing
 * sensitive leaked, but it advertised the tooling's existence and shape to
 * anyone who guessed the path.
 *
 * As a Server Component layout this runs BEFORE any admin page is sent to
 * the browser, so a non-admin never receives the markup at all. It covers
 * every current and future route under /dashboard/admin automatically —
 * nobody has to remember to add a guard to the next page.
 *
 * notFound() rather than a redirect or a 403 message, deliberately: a 404
 * doesn't confirm the route exists. To someone without access, the admin
 * area is indistinguishable from a typo.
 *
 * This is defence in depth, NOT the security boundary. The real boundary is
 * still the backend check on every /api/v1/admin/* call — that's what stops
 * a direct API request, which no amount of frontend routing can.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    try {
      // RLS grants a user SELECT on their own profile row, so no
      // service_role is needed. Wrapped because selecting a column that
      // doesn't exist is a PostgREST error rather than a null — if the
      // is_admin migration hasn't run, this must fail CLOSED.
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();
      isAdmin = Boolean(data?.is_admin);
    } catch {
      isAdmin = false;
    }
  }

  // Called outside the try: notFound() works by throwing, and catching it
  // here would swallow the 404 and render the admin area anyway.
  if (!isAdmin) notFound();

  return <>{children}</>;
}
