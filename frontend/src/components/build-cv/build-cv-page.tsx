"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, FileUp, Languages, Sparkles } from "lucide-react";
import { useLang, useLocaleHref } from "@/lib/language";
import { useAuth } from "@/lib/auth";
import { trackCta, useSectionView } from "@/lib/track";
import { SiteHeader, SiteFooter } from "@/components/landing/site-chrome";
import { FaqList, FaqJsonLd, useFaqItems } from "@/components/landing/faq-cta";
import { UploadZone, DashboardButton } from "@/components/dashboard";
import {
  ManualCvForm,
  ManualCvData,
  emptyManualCvData,
  missingRequiredFields,
  requiredFieldLabel,
} from "@/components/manual-cv-form";
import { saveBuildCvDraft, buildUploadedFileField } from "@/lib/build-cv-draft";

/* ========================================================================
   /build-cv — public CV-creation landing page (prompts/tarshih-copy-and-page.md)

   THE FORM IS THE PAGE, not a link to one. A visitor arriving from Google
   starts typing immediately; the account wall (see handleGenerate below)
   only appears at Generate.

   THE DEFERRED-SIGNUP MECHANISM THIS RELIES ON DID NOT EXIST BEFORE THIS
   FILE. There is no guest session and no return-URL machinery anywhere in
   the codebase — every generation call already requires a Supabase session,
   and every auth path (signup, login, Google OAuth, email confirmation)
   already lands on /dashboard. So rather than build new auth plumbing, this
   page saves what the visitor typed to lib/build-cv-draft.ts (localStorage)
   and sends them to the existing /signup or straight to /dashboard if
   they're already signed in; dashboard/page.tsx picks the draft back up on
   mount. Nothing here touches auth, credits, or the generation endpoints.

   TEMPLATE, PHOTO AND THE NAME-PROMPT MODAL ARE DELIBERATELY NOT HERE. This
   page captures the two inputs generation actually needs — the candidate's
   details and the job posting — and hands off to the dashboard for
   everything downstream (template choice, the photo slot, results). Cloning
   the full 1900-line dashboard form onto a marketing page was the wrong
   trade for a page whose job is to get someone typing, not to be the
   product a second time.

   MAX_CV_UPLOAD_BYTES mirrors dashboard/page.tsx's own constant. The server
   is the real limit; this only avoids uploading a 40 MB scan on a phone
   connection before finding out.
======================================================================== */

const MAX_CV_UPLOAD_BYTES = 5 * 1024 * 1024;

/* ── mode toggle + form ─────────────────────────────────────────────────── */
function CvForm() {
  const { t, lang, dir } = useLang();
  const copy = t.buildCv.form;
  const router = useRouter();
  const { isLoggedIn } = useAuth();

  const [cvMode, setCvMode] = useState<"upload" | "manual">("manual");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [manualData, setManualData] = useState<ManualCvData>(emptyManualCvData);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [cvLanguage, setCvLanguage] = useState<"en" | "ar">("en");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleCvFileSelect(selected: File) {
    if (selected.size > MAX_CV_UPLOAD_BYTES) {
      setCvFile(null);
      setError(copy.fileTooLarge);
      return;
    }
    setError("");
    setCvFile(selected);
  }

  const missingFields = cvMode === "manual" ? missingRequiredFields(manualData) : [];
  const canGenerate =
    (cvMode === "upload" ? !!cvFile : missingFields.length === 0) &&
    jobDescription.trim().length > 0 &&
    !submitting;

  async function handleGenerate() {
    setError("");
    if (cvMode === "upload" && !cvFile) {
      setError(copy.missingFields);
      return;
    }
    if (cvMode === "manual" && missingFields.length > 0) {
      setError(copy.missingRequired(missingFields.map((f) => requiredFieldLabel(f, lang)).join(lang === "ar" ? "، " : ", ")));
      return;
    }
    if (!jobDescription.trim()) {
      setError(copy.missingJobDescription);
      return;
    }

    setSubmitting(true);
    trackCta("build_cv_generate", "build-cv");
    try {
      const uploadedFileField =
        cvMode === "upload" ? await buildUploadedFileField(cvFile) : { uploadedFile: null, uploadOmitted: false };

      saveBuildCvDraft({
        cvMode,
        manualData,
        additionalInfo,
        jobDescription,
        cvLanguage,
        candidatePhoto: null,
        ...uploadedFileField,
      });

      // Read-only check: decides which existing page to send the visitor
      // to, never used to call the generation endpoint from here.
      const { createClient } = await import("@/lib/supabase/client");
      const { data } = await createClient().auth.getSession();
      router.push(data.session ? "/dashboard" : "/signup?plan=free");
    } catch (err) {
      console.error("build-cv handleGenerate failed:", err);
      // The draft was still saved best-effort above (saveBuildCvDraft never
      // throws), so falling back to the account wall loses nothing that a
      // successful session check wouldn't also have sent there eventually
      // for a signed-out visitor.
      router.push("/signup?plan=free");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      dir={dir}
      className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5 sm:p-7"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setCvMode("manual")}
          className={`flex items-start gap-3 rounded-xl border-2 px-5 py-4 text-start transition-all ${
            cvMode === "manual" ? "border-blue-500 bg-blue-50/60 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <span
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${
              cvMode === "manual" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            <PenLine className="size-4" aria-hidden />
          </span>
          <span>
            <p className="text-sm font-medium text-slate-900">{copy.modeManualTitle}</p>
            <p className="mt-0.5 text-xs text-slate-500">{copy.modeManualSub}</p>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setCvMode("upload")}
          className={`flex items-start gap-3 rounded-xl border-2 px-5 py-4 text-start transition-all ${
            cvMode === "upload" ? "border-blue-500 bg-blue-50/60 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <span
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${
              cvMode === "upload" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            <FileUp className="size-4" aria-hidden />
          </span>
          <span>
            <p className="text-sm font-medium text-slate-900">{copy.modeUploadTitle}</p>
            <p className="mt-0.5 text-xs text-slate-500">{copy.modeUploadSub}</p>
          </span>
        </button>
      </div>

      {cvMode === "upload" ? (
        <UploadZone
          file={cvFile}
          onFileSelect={handleCvFileSelect}
          onRemove={() => setCvFile(null)}
          label={copy.uploadLabel}
          hint={copy.uploadHint}
          parsedLabel={copy.uploadedLabel}
          removeLabel={copy.removeFile}
        />
      ) : (
        <ManualCvForm value={manualData} onChange={setManualData} />
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">
          {copy.additionalInfoLabel} <span className="text-slate-400">({copy.additionalInfoOptional})</span>
        </label>
        <textarea
          rows={3}
          value={additionalInfo}
          onChange={(e) => setAdditionalInfo(e.target.value)}
          placeholder={copy.additionalInfoPlaceholder}
          className="block max-h-48 w-full resize-none overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      <div>
        <label htmlFor="build-cv-jd" className="mb-2 block text-sm font-medium text-slate-700">
          {copy.jdLabel}
        </label>
        <textarea
          id="build-cv-jd"
          rows={7}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder={copy.jdPlaceholder}
          aria-describedby="build-cv-jd-hint"
          className="block w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
        />
        <p id="build-cv-jd-hint" className="mt-2 text-xs leading-relaxed text-slate-500">
          {copy.jdHint}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <DashboardButton type="button" size="lg" disabled={!canGenerate} onClick={handleGenerate} className="w-full sm:w-auto">
          <Sparkles className={`size-4 ${submitting ? "animate-pulse" : ""}`} aria-hidden />
          {submitting ? copy.generatingCta : copy.generateCta}
        </DashboardButton>

        <div
          role="group"
          aria-label={copy.languageLabel}
          className="inline-flex items-center gap-1 self-start rounded-full border border-slate-200 bg-slate-50 p-1 sm:self-auto"
        >
          <Languages className="ms-1.5 size-4 shrink-0 text-slate-400" aria-hidden />
          <button
            type="button"
            onClick={() => setCvLanguage("en")}
            aria-pressed={cvLanguage === "en"}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              cvLanguage === "en" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setCvLanguage("ar")}
            aria-pressed={cvLanguage === "ar"}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              cvLanguage === "ar" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            العربية
          </button>
        </div>
      </div>

      {/* Only shown to a signed-out visitor — someone already signed in (they
          bookmarked this page, say) has no wall ahead of them, so the note
          would be false for them. */}
      {!isLoggedIn && <p className="text-xs leading-relaxed text-slate-500">{copy.accountWallNote}</p>}
    </div>
  );
}

/* ── H1 + subhead + form ───────────────────────────────────────────────── */
function BuildCvHero() {
  const { t } = useLang();
  return (
    <section className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[120px]" />
      </div>
      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="t-display-xl font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
            {t.buildCv.h1}
          </h1>
          <p className="t-body-l mt-5" style={{ color: "var(--ink-2)" }}>
            {t.buildCv.subhead}
          </p>
        </div>
        <div className="mx-auto mt-10 max-w-2xl">
          <CvForm />
        </div>
      </div>
    </section>
  );
}

/* ── How it works — 3 steps ────────────────────────────────────────────── */
function BuildCvHowItWorks() {
  const { t } = useLang();
  const copy = t.buildCv.howItWorks;
  const ref = useSectionView<HTMLElement>("build_cv_how_it_works", "build-cv");
  return (
    <section ref={ref} className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--accent)" }} aria-hidden />
          <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
            {copy.label}
          </p>
        </div>
        <ol
          className="m-0 mt-8 grid list-none gap-px p-0 lg:grid-cols-3"
          style={{ backgroundColor: "var(--line-hairline)" }}
        >
          {copy.steps.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-3 px-0 py-8 lg:px-8 lg:py-10" style={{ backgroundColor: "var(--surface-base)" }}>
              <div className="flex items-baseline gap-3">
                <span className="t-figure text-[1.75rem] font-semibold leading-none tracking-tight" style={{ color: "var(--accent-quiet)" }}>
                  {i + 1}
                </span>
                <h3 className="t-title font-semibold" style={{ color: "var(--ink-1)" }}>
                  {step.title}
                </h3>
              </div>
              <p className="t-body max-w-[34ch]" style={{ color: "var(--ink-2)" }}>
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── the SEO/education body ───────────────────────────────────────────── */
function BuildCvAtsSection() {
  const { t } = useLang();
  const copy = t.buildCv.atsSection;
  return (
    <section className="border-t py-20 sm:py-28" style={{ borderColor: "var(--line-hairline)" }}>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="t-display-l max-w-[20ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
          {copy.title}
        </h2>
        <div className="mt-8 max-w-[68ch] space-y-5">
          {copy.paragraphs.map((p, i) => (
            <p key={i} className="t-body-l" style={{ color: "var(--ink-2)" }}>
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Arabic and English ───────────────────────────────────────────────── */
function BuildCvBilingualSection() {
  const { t } = useLang();
  const copy = t.buildCv.bilingualSection;
  return (
    <section className="border-t py-16 sm:py-20" style={{ borderColor: "var(--line-hairline)" }}>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="t-title font-semibold" style={{ color: "var(--ink-1)" }}>
          {copy.title}
        </h2>
        <p className="t-body mt-3 max-w-[62ch]" style={{ color: "var(--ink-2)" }}>
          {copy.body}
        </p>
      </div>
    </section>
  );
}

/* ── What you get free ────────────────────────────────────────────────── */
function BuildCvFreeSection() {
  const { t } = useLang();
  const copy = t.buildCv.freeSection;
  return (
    <section className="border-t py-16 sm:py-20" style={{ borderColor: "var(--line-hairline)" }}>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="t-title font-semibold" style={{ color: "var(--ink-1)" }}>
          {copy.title}
        </h2>
        <p className="t-body mt-3 max-w-[62ch]" style={{ color: "var(--ink-2)" }}>
          {copy.body}
        </p>
      </div>
    </section>
  );
}

/* ── FAQ ───────────────────────────────────────────────────────────────── */
function BuildCvFaq() {
  const { t } = useLang();
  const href = useLocaleHref();
  const items = useFaqItems(t.faq.buildCv);
  return (
    <section id="faq" className="border-t py-20 sm:py-28" style={{ borderColor: "var(--line-hairline)" }}>
      <FaqJsonLd items={items} />
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="t-display-l max-w-[16ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
          {t.faq.title}
        </h2>
        <div className="mt-10 max-w-[68ch]">
          <FaqList items={items} />
        </div>
        <a
          href={href("/questions")}
          className="t-meta mt-6 inline-block rounded-[0.2rem] font-medium underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
          style={{ color: "var(--accent-quiet)", ["--tw-ring-color" as string]: "var(--accent-quiet)" }}
        >
          {t.faq.seeAll}
        </a>
      </div>
    </section>
  );
}

export function BuildCvPage() {
  const router = useRouter();
  return (
    <>
      <SiteHeader onOpenAbout={() => router.push("/about")} />
      <main id="main">
        <BuildCvHero />
        <BuildCvHowItWorks />
        <BuildCvAtsSection />
        <BuildCvBilingualSection />
        <BuildCvFreeSection />
        <BuildCvFaq />
      </main>
      <SiteFooter />
    </>
  );
}
