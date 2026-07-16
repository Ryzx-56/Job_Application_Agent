"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, ArrowRight, ArrowLeft, Lock, ScanSearch, BadgeCheck } from "lucide-react";
import { useLang } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { LegalModal } from "@/components/legal-modal";
import { legalContent, LegalDocKey } from "@/lib/legal-content";

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" className="size-[18px] shrink-0" aria-hidden {...props}>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.1 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.5-4.7 7.2l7.4 5.7C43.6 37.9 46.5 31.8 46.5 24.5z" />
      <path fill="#FBBC05" d="M10.5 19.3a14.5 14.5 0 0 0 0 9.3l-7.9 6.1a24 24 0 0 1 0-21.5l7.9 6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-3.6-13.5-8.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/* ========================================================================
   BRAND PANEL — same grid + glow signature as the login page, with copy
   that speaks to someone about to create an account rather than return.
======================================================================== */
function BrandPanel() {
  const { t } = useLang();
  const icons = [Lock, ScanSearch, BadgeCheck];
  return (
    <div className="relative hidden overflow-hidden bg-zinc-950 lg:flex lg:w-[38%] lg:flex-col lg:justify-between lg:p-10 xl:p-14">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_80%_60%_at_30%_20%,black,transparent)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="pointer-events-none absolute -top-24 -start-24 h-80 w-80 rounded-full bg-blue-600/25 blur-[110px]" />
      <div className="pointer-events-none absolute bottom-0 end-0 h-72 w-72 rounded-full bg-blue-500/10 blur-[100px]" />

      <div className="relative">
        <Link href="/" aria-label="Tarshih home">
          <Logo />
        </Link>
      </div>

      <div className="relative max-w-md">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight text-white xl:text-[2.75rem]">
          {t.signup.brandPanel.headline}
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-zinc-400">{t.signup.brandPanel.sub}</p>

        <div className="mt-9 space-y-4 border-t border-white/10 pt-7">
          {t.signup.brandPanel.points.map((point, i) => {
            const Icon = icons[i];
            return (
              <div key={point} className="flex items-center gap-3 text-base text-zinc-300">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-blue-400">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                {point}
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative text-xs text-zinc-600">© {new Date().getFullYear()} Tarshih</div>
    </div>
  );
}

/* ========================================================================
   BACK TO HOME
======================================================================== */
function BackToHome({ isRTL }: { isRTL: boolean }) {
  const { t } = useLang();
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
    >
      <BackIcon className="size-4" aria-hidden />
      {t.form.backToHome}
    </Link>
  );
}

/* ========================================================================
   SELECTED PLAN BANNER — reads ?plan= from the URL and looks the slug up
   against the pricing dictionary so the label always matches pricing copy.
======================================================================== */
function SelectedPlanBanner({ planSlug }: { planSlug: string }) {
  const { t } = useLang();
  const plan = t.pricing.plans.find((p) => p.slug === planSlug) ?? t.pricing.plans.find((p) => p.slug === "free");
  if (!plan) return null;

  return (
    <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-sm text-zinc-300">{t.signup.planLabel(plan.name)}</p>
      <Link
        href="/#pricing"
        className="shrink-0 rounded text-sm font-medium text-blue-400 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
      >
        {t.signup.changePlan}
      </Link>
    </div>
  );
}

/* ========================================================================
   SIGNUP FORM
======================================================================== */
function SignupForm() {
  const { t, isRTL, lang } = useLang();
  const searchParams = useSearchParams();
  const planSlug = searchParams.get("plan") ?? "free";

  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const router = useRouter();

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!fullName.trim() || !email.trim() || !password || !confirmPassword) {
      setError(t.signup.errors.missingFields);
      return;
    }
    if (!emailPattern.test(email.trim())) {
      setError(t.signup.errors.invalidEmail);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.signup.errors.passwordMismatch);
      return;
    }
    if (!agreedToTerms) {
      setError(t.signup.errors.termsRequired);
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // `plan` rides along on the user record so you can read it back
        // later (e.g. from a webhook or onboarding step) to put the account
        // on the right tier.
        data: { full_name: fullName.trim(), selected_plan: planSlug },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSubmitting(false);

    if (signUpError) {
      setError(t.signup.errors.signupFailed);
      return;
    }

    // If email confirmation is off in your Supabase project, signUp already
    // returns a live session — go straight to the dashboard. Otherwise show
    // the "check your inbox" state.
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setSuccess(t.signup.checkEmailBody);
    }
  }

  async function handleGoogle() {
    setError("");
    const supabase = createClient();
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthErr) setError(t.signup.errors.oauthError);
  }

  return (
    <div className="flex w-full flex-1 flex-col justify-center px-5 py-14 sm:px-10 lg:px-10 xl:px-16">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center justify-between lg:hidden">
          <Link href="/" aria-label="Tarshih home">
            <Logo />
          </Link>
          <LangSwitcher />
        </div>
        <div className="mb-8 hidden items-center justify-between lg:flex">
          <BackToHome isRTL={isRTL} />
          <LangSwitcher />
        </div>

        <span className="text-base font-medium text-blue-400">{t.signup.eyebrow}</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t.signup.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-400">{t.signup.sub}</p>

        <SelectedPlanBanner planSlug={planSlug} />

        {success ? (
          <div className="mt-7 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-6 text-center">
            <p className="text-base font-medium text-emerald-300">{t.signup.checkEmailTitle}</p>
            <p className="mt-2 text-sm leading-relaxed text-emerald-200/80">{success}</p>
            <Link
              href="/login"
              className="mt-4 inline-block rounded text-sm font-medium text-blue-400 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            >
              {t.signup.loginLink}
            </Link>
          </div>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogle}
              className="mt-7 w-full border-transparent bg-white text-zinc-900 hover:bg-zinc-100"
            >
              <GoogleIcon />
              {t.signup.googleCta}
            </Button>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-zinc-500">{t.signup.dividerLabel}</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <label htmlFor="fullName" className="mb-2 block text-base font-medium text-zinc-300">
                  {t.signup.fullNameLabel}
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t.signup.fullNamePlaceholder}
                  className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-blue-400/30"
                />
              </div>

              <div>
                <label htmlFor="email" className="mb-2 block text-base font-medium text-zinc-300">
                  {t.signup.emailLabel}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.signup.emailPlaceholder}
                  className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-blue-400/30"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-base font-medium text-zinc-300">
                  {t.signup.passwordLabel}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.signup.passwordPlaceholder}
                    className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 pe-12 text-base text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-blue-400/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t.signup.hidePassword : t.signup.showPassword}
                    className="absolute inset-y-0 end-0 grid w-12 place-items-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="mb-2 block text-base font-medium text-zinc-300">
                  {t.signup.confirmPasswordLabel}
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t.signup.confirmPasswordPlaceholder}
                    className="block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 pe-12 text-base text-white placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-blue-400/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={showConfirmPassword ? t.signup.hidePassword : t.signup.showPassword}
                    className="absolute inset-y-0 end-0 grid w-12 place-items-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </div>

              <label htmlFor="agreeToTerms" className="flex items-start gap-2.5 text-sm leading-relaxed text-zinc-400">
                <input
                  id="agreeToTerms"
                  name="agreeToTerms"
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-white/20 bg-white/5 text-blue-600 accent-blue-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                />
                <span>
                  {t.signup.termsPrefix}{" "}
                  <button type="button" onClick={() => setOpenDoc("terms")} className="font-medium text-blue-400 transition-colors hover:text-blue-300">
                    {t.form.termsLink}
                  </button>{" "}
                  {t.form.and}{" "}
                  <button type="button" onClick={() => setOpenDoc("privacy")} className="font-medium text-blue-400 transition-colors hover:text-blue-300">
                    {t.form.privacyLink}
                  </button>
                </span>
              </label>

              {error && (
                <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 px-3.5 py-2.5 text-sm text-red-300">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? t.signup.submitting : t.signup.submit}
                {!submitting && <ForwardIcon className="size-4" aria-hidden />}
              </Button>
            </form>

            <p className="mt-7 text-center text-sm text-zinc-400">
              {t.signup.alreadyHaveAccount}{" "}
              <Link
                href="/login"
                className="rounded font-medium text-blue-400 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.signup.loginLink}
              </Link>
            </p>
          </>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-zinc-600">
          {t.form.terms}{" "}
          <button type="button" onClick={() => setOpenDoc("terms")} className="text-zinc-500 underline underline-offset-2 hover:text-zinc-300">
            {t.form.termsLink}
          </button>{" "}
          {t.form.and}{" "}
          <button type="button" onClick={() => setOpenDoc("privacy")} className="text-zinc-500 underline underline-offset-2 hover:text-zinc-300">
            {t.form.privacyLink}
          </button>
        </p>
      </div>
      <LegalModal
        doc={openDoc ? legalContent[lang][openDoc] : null}
        open={openDoc !== null}
        onClose={() => setOpenDoc(null)}
        isRTL={isRTL}
      />
    </div>
  );
}

/* ========================================================================
   PAGE — route: "/signup"
   useSearchParams() requires a Suspense boundary in the App Router, so the
   part of the tree that reads ?plan= is isolated into SignupForm and
   wrapped here.
======================================================================== */
export default function SignupPage() {
  return (
    <div className="flex min-h-screen w-full">
      <BrandPanel />
      <Suspense fallback={<div className="flex w-full flex-1" />}>
        <SignupForm />
      </Suspense>
    </div>
  );
}
