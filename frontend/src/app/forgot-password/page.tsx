"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft, Mail, CheckCircle2 } from "lucide-react";
import { useLang } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function ForgotPasswordPage() {
  const { t, isRTL, dir } = useLang();
  const c = t.forgotPassword;
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function sendResetLink(targetEmail: string) {
    setError("");
    if (!targetEmail.trim()) {
      setError(c.missingEmail);
      return;
    }
    if (!isValidEmail(targetEmail.trim())) {
      setError(c.invalidEmail);
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    // redirectTo points at the existing OAuth/email-confirmation callback
    // route, which exchanges the code for a session and then forwards to
    // `next`. Reusing it means no second code-exchange handler is needed.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      targetEmail.trim(),
      {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      }
    );

    setSubmitting(false);

    if (resetError) {
      setError(c.genericError);
      return;
    }
    setSent(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await sendResetLink(email);
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

        {!sent ? (
          <>
            <Link
              href="/login"
              className="mb-6 flex w-fit items-center gap-1.5 rounded text-sm font-medium text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            >
              <BackIcon className="size-4" aria-hidden />
              {c.backToLogin}
            </Link>

            <span className="text-base font-medium text-blue-400">{c.eyebrow}</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {c.title}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-400">{c.sub}</p>

            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-base font-medium text-zinc-300">
                  {c.emailLabel}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={c.emailPlaceholder}
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
                {!submitting && <ForwardIcon className="size-4" aria-hidden />}
              </Button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full border border-blue-400/20 bg-blue-400/10 text-blue-400">
              <CheckCircle2 className="size-7" aria-hidden />
            </span>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{c.successTitle}</h1>
            <p className="mt-3 text-base leading-relaxed text-zinc-400">{c.successBody(email.trim())}</p>

            <button
              type="button"
              onClick={() => sendResetLink(email)}
              disabled={submitting}
              className="mt-6 inline-flex items-center gap-1.5 rounded text-sm font-medium text-blue-400 transition-colors hover:text-blue-300 disabled:opacity-50"
            >
              <Mail className="size-4" aria-hidden />
              {submitting ? c.submitting : c.resend}
            </button>
          </div>
        )}

        <p className="mt-7 text-center text-sm text-zinc-400">
          {c.rememberPassword}{" "}
          <Link
            href="/login"
            className="rounded font-medium text-blue-400 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            {c.login}
          </Link>
        </p>
      </div>
    </div>
  );
}
