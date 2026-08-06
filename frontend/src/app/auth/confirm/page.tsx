"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { useLang } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";

/**
 * Requires an actual click before verifying the token, rather than
 * verifying automatically on page load (which the previous route.ts did).
 *
 * Why: email providers (Gmail's link-safety scanner, Outlook Safe Links,
 * etc.) automatically pre-fetch links inside incoming emails to scan them
 * for phishing/malware, before the person ever clicks. Since these OTP
 * tokens are single-use, an automatic GET-triggered verification gets
 * silently consumed by that scan, so the real click a moment later finds
 * the link already "expired or used". Waiting for an explicit button press
 * sidesteps this — scanners fetch and render, but they don't click buttons.
 */
function ConfirmForm() {
  const { t, dir } = useLang();
  const c = t.confirmLink;
  const searchParams = useSearchParams();

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const redirectTo = searchParams.get("redirect_to") || "/dashboard";

  const [status, setStatus] = useState<"idle" | "verifying" | "error">("idle");

  async function handleContinue() {
    if (!tokenHash || !type) {
      setStatus("error");
      return;
    }
    setStatus("verifying");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      setStatus("error");
      return;
    }
    window.location.href = redirectTo;
  }

  const missingParams = !tokenHash || !type;
  const isRecovery = type === "recovery";

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-950 px-5 py-14" dir={dir}>
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" aria-label="Tarshih home">
            <Logo />
          </Link>
          <LangSwitcher />
        </div>

        {status === "error" || missingParams ? (
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {missingParams ? c.invalidTitle : isRecovery ? c.expiredTitleRecovery : c.expiredTitleGeneric}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-400">
              {missingParams ? c.invalidBody : isRecovery ? c.expiredBodyRecovery : c.expiredBodyGeneric}
            </p>
            <Link href={isRecovery ? "/forgot-password" : "/login"}>
              <Button className="mt-7 w-full">{isRecovery ? c.requestNewLink : c.backToLogin}</Button>
            </Link>
          </div>
        ) : (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full border border-blue-400/20 bg-blue-400/10 text-blue-400">
              <ShieldCheck className="size-7" aria-hidden />
            </span>
            <span className="mt-6 block text-base font-medium text-blue-400">{c.eyebrow}</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{c.title}</h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-400">{c.sub}</p>

            <Button onClick={handleContinue} disabled={status === "verifying"} className="mt-7 w-full">
              {status === "verifying" ? (
                c.verifying
              ) : (
                <>
                  <CheckCircle2 className="size-4" aria-hidden />
                  {c.button}
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the App Router.
export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen w-full bg-zinc-950" />}>
      <ConfirmForm />
    </Suspense>
  );
}
