"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, CheckCircle2 } from "lucide-react";
import { useLang } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const { t, dir } = useLang();
  const c = t.resetPassword;
  const router = useRouter();

  // The /auth/callback route already exchanged the recovery code for a
  // session before redirecting here, so by the time this page mounts
  // there should be an active (recovery) session. If there isn't one —
  // e.g. the link was already used, or expired — updateUser() below will
  // fail, and we also proactively check on mount so the form doesn't
  // render for a session that doesn't exist.
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setCheckingSession(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!password || !confirmPassword) {
      setError(c.missingFields);
      return;
    }
    if (password.length < 8) {
      setError(c.tooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(c.mismatch);
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(c.genericError);
      return;
    }
    setSuccess(true);
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-950 px-5 py-14" dir={dir}>
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" aria-label="Tarshih home">
            <Logo />
          </Link>
          <LangSwitcher />
        </div>

        {checkingSession ? (
          <div className="py-10 text-center text-sm text-zinc-500">…</div>
        ) : success ? (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full border border-blue-400/20 bg-blue-400/10 text-blue-400">
              <CheckCircle2 className="size-7" aria-hidden />
            </span>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{c.successTitle}</h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-400">{c.successBody}</p>
            <Button className="mt-7 w-full" onClick={() => router.push("/dashboard")}>
              {c.goToDashboard}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        ) : !hasSession ? (
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{c.invalidLinkTitle}</h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-400">{c.invalidLinkBody}</p>
            <Link href="/forgot-password">
              <Button className="mt-7 w-full">{c.requestNewLink}</Button>
            </Link>
          </div>
        ) : (
          <>
            <span className="text-base font-medium text-blue-400">{c.eyebrow}</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{c.title}</h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-400">{c.sub}</p>

            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
              <div>
                <label htmlFor="password" className="mb-2 block text-base font-medium text-zinc-300">
                  {c.passwordLabel}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={c.placeholder}
                    className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 pe-12 text-base text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-blue-400/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? c.hidePassword : c.showPassword}
                    className="absolute inset-y-0 end-0 grid w-12 place-items-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="mb-2 block text-base font-medium text-zinc-300">
                  {c.confirmLabel}
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={c.placeholder}
                  className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-blue-400/30"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-400/20 bg-red-400/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {error}
                </p>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? c.submitting : c.submit}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
