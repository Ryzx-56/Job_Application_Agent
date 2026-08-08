import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard";

/**
 * Auth guard lives here as a Server Component so every /dashboard/* route
 * gets protected for free without each page re-checking the session.
 * Signed-out visitors are redirected to /login before any client JS runs.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Both name scripts, so the shell can show whichever matches the
  // interface language (see DashboardShell's displayName). Read from
  // `profiles` rather than auth metadata because Settings writes name
  // edits there — auth metadata is only ever populated at signup and goes
  // stale the moment someone changes their name.
  //
  // RLS grants a user SELECT on their own profile row, so this needs no
  // service_role. A failure here is non-fatal: the header falls back to
  // user_metadata.full_name and then to the email.
  const { data: profile } = await supabase
    .from("profiles")
    .select("name_en, name_ar")
    .eq("id", user.id)
    .maybeSingle();

  const shellUser = {
    nameEn: (profile?.name_en as string | null) ?? null,
    nameAr: (profile?.name_ar as string | null) ?? null,
    // Last-resort fallback for accounts created before the name split, and
    // for Google OAuth signups, who never see our signup form and so only
    // ever get a full_name from Google.
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    email: user.email ?? "",
    preferredLanguage: (user.user_metadata?.preferred_language as string | undefined) ?? null,
  };

  return <DashboardShell user={shellUser}>{children}</DashboardShell>;
}
