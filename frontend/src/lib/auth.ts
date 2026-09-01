"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

/* ========================================================================
   SUPABASE IS LOADED ON DEMAND, NOT IMPORTED AT THE TOP.

   `import type` is erased at compile time, so the User type above costs
   nothing. The client itself is pulled in with `await import(...)` inside
   the effect below, which puts @supabase/supabase-js in its own chunk
   instead of the entry bundle.

   Why it matters: site-chrome.tsx calls useAuth(), and site-chrome is the
   header and footer on EVERY marketing page — the landing page, pricing,
   about, questions, guides. A static import here therefore shipped the whole
   Supabase client to every visitor who has never signed in, as part of the
   critical path, to decide one thing: whether the nav says "Log in" or
   "Dashboard".

   Nothing renders differently as a result. The hook already starts at
   `user: null, checked: false` and fills in after mount, so moving the
   import into the effect changes when the code arrives, not what it does.
======================================================================== */

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      if (cancelled) return;
      const supabase = createClient();

      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(data.user ?? null);
      setChecked(true);

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });
      // The import is async, so the component can unmount before the
      // subscription exists. Assigning it here (rather than returning it
      // from the effect) is what lets the cleanup below still find it.
      unsubscribe = () => listener.subscription.unsubscribe();
      if (cancelled) unsubscribe();
    })().catch(() => {
      // A failed chunk load must not leave the header stuck: `checked`
      // flipping true with a null user is the signed-out state, which is the
      // correct thing to show someone whose auth we could not read.
      if (!cancelled) setChecked(true);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { user, isLoggedIn: !!user, checked };
}

/** Signs the current user out and sends them back to /login. */
export async function signOut() {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = "/login";
}

/** Where a "Get started" button should point, based on auth state. */
export function getStartedHref(isLoggedIn: boolean) {
  return isLoggedIn ? "/dashboard" : "/login";
}
