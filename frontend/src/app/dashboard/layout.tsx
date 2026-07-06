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

  const shellUser = {
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    email: user.email ?? "",
  };

  return <DashboardShell user={shellUser}>{children}</DashboardShell>;
}
