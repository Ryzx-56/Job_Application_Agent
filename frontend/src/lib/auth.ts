"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Real Supabase auth hook, replacing the old localStorage placeholder.
 * Reads the current session on mount and stays in sync with sign-in/out
 * events, so any client component can call useAuth() to get the user.
 *
 * Route-level protection (redirecting signed-out visitors away from
 * /dashboard) happens server-side in app/dashboard/layout.tsx — this hook
 * is for reading user info inside client components, not for gatekeeping.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setChecked(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { user, isLoggedIn: !!user, checked };
}

/** Signs the current user out and sends them back to /login. */
export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = "/login";
}

/** Where a "Get started" button should point, based on auth state. */
export function getStartedHref(isLoggedIn: boolean) {
  return isLoggedIn ? "/dashboard" : "/login";
}
