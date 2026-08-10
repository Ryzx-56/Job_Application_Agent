"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useLang } from "@/lib/language";
import { DashboardButton } from "@/components/dashboard";
import {
  ApiError,
  fetchInterviewOverview,
  generateInterviewPrep,
  InterviewCategory,
  InterviewCv,
  InterviewOverview,
  InterviewPrepContent,
  InterviewStep,
  INTERVIEW_CATEGORIES,
} from "@/lib/supabase/interview";
import {
  CategoryTabs,
  CvPicker,
  GeneratingState,
  LockedOverlay,
  QuestionCard,
  ResultsHeader,
} from "@/components/interview-ui";

/* ========================================================================
   /dashboard/interview — Interview Prep (Pro and Elite).

   Three states, one page:
     · picker     — "Choose a CV to get started", the user's saved CVs as
                    cards. Only CVs with a job description AND structured
                    data attached are selectable; the rest render disabled
                    with the reason.
     · generating — stepped progress while the one backend call runs.
     · results    — the question set, filterable by category, cards
                    collapsed to the question and expanded to the answer.

   FREE USERS see all of that rendered and blurred behind an upgrade panel
   (see LockedOverlay), never a redirect. The blur is presentation only:
   /api/v1/interview/generate re-checks the tier server-side on every call,
   so a Free user who defeats the CSS still gets a 403 rather than questions.

   NOTHING IS PERSISTED. A generated set lives in this component's state.
   Navigating away and back means generating again, which is the scope this
   version was specified at: no chat, no scoring, no voice, no sessions.
======================================================================== */

export default function InterviewPrepPage() {
  const { t, lang, dir } = useLang();
  const copy = t.dashboard.interview;
  const resumesCopy = t.dashboard.resumes;

  const [overview, setOverview] = useState<InterviewOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  // The phase the server last reported. Null until the first `step` event,
  // which is also how the list renders with nothing lit while the request is
  // still in flight.
  const [step, setStep] = useState<InterviewStep | null>(null);
  const [result, setResult] = useState<InterviewPrepContent | null>(null);
  const [resultCvId, setResultCvId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [filter, setFilter] = useState<InterviewCategory | "all">("all");
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  const formatDate = useCallback(
    (iso: string) => {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      } catch {
        return iso;
      }
    },
    [lang]
  );

  /**
   * Reads the overview. Deliberately does NOT flip `loading` on at the
   * start: `loading` already begins true for the first mount, and setting
   * state synchronously from inside the mount effect is a cascading render.
   * The retry button turns it back on itself before calling this.
   *
   * The two outcome handlers are split out so the mount effect below can
   * hang them off the promise directly, which is what keeps every setState
   * in this file inside a callback rather than in an effect body.
   */
  const applyOverview = useCallback((data: InterviewOverview) => {
    setOverview(data);
    setLoadError(null);
    setLoadErrorDetail(null);
    setLoading(false);
  }, []);

  const applyLoadError = useCallback(
    (error: unknown) => {
      const err = error as ApiError;
      console.error("fetchInterviewOverview failed:", err);
      setOverview(null);
      setLoadError(copy.errors.load);
      // The underlying failure in mono under the friendly line, same as My
      // Resumes and the LinkedIn page. A bare "please try again" on a page
      // whose backend isn't reachable is undebuggable from a screenshot,
      // which is exactly when someone sends you one.
      setLoadErrorDetail(
        [err?.status ? `HTTP ${err.status}` : null, err?.code, err?.message]
          .filter(Boolean)
          .join(" · ")
      );
      setLoading(false);
    },
    // copy.errors.load is stable per language; a language switch shouldn't
    // rebuild the handler or refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const load = useCallback(
    () => fetchInterviewOverview().then(applyOverview).catch(applyLoadError),
    [applyOverview, applyLoadError]
  );

  useEffect(() => {
    let cancelled = false;
    fetchInterviewOverview()
      .then((data) => !cancelled && applyOverview(data))
      .catch((error) => !cancelled && applyLoadError(error));
    return () => {
      cancelled = true;
    };
  }, [applyOverview, applyLoadError]);

  function messageForError(err: ApiError): string {
    switch (err.code) {
      case "upgrade_required":
        return copy.errors.upgradeRequired;
      case "no_jd":
        return copy.errors.no_jd;
      case "no_snapshot":
        return copy.errors.no_snapshot;
      case "generation_failed":
      case "stream_interrupted":
        return copy.errors.generationFailed;
      default:
        return err.message || copy.errors.generationFailed;
    }
  }

  async function handleGenerate(cvId: string) {
    setBusyId(cvId);
    setStep(null);
    setActionError(null);
    try {
      const { content } = await generateInterviewPrep(cvId, setStep);
      setResult(content);
      setResultCvId(cvId);
      setFilter("all");
      setOpenIds(new Set());
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const err = error as ApiError;
      console.error("generateInterviewPrep failed:", err);
      setActionError(messageForError(err));
      // A 403 here means the tier changed under them (or the page was open
      // across an expiry). Re-reading the overview re-locks the page rather
      // than leaving an unlocked UI that can't actually generate.
      if (err.status === 403) await load().catch(() => undefined);
    } finally {
      setBusyId(null);
      setStep(null);
    }
  }

  // Which phases this particular run will report. An English CV never emits
  // "localize", so listing it would leave a step that can never light up.
  const phases = useMemo<InterviewStep[]>(() => {
    const cv = overview?.cvs.find((c) => c.id === busyId);
    return cv?.cv_language === "ar"
      ? ["prepare", "generate", "localize"]
      : ["prepare", "generate"];
  }, [overview, busyId]);

  // Memoized so the empty-array fallback isn't a fresh reference on every
  // render, which would make both derived useMemos below recompute forever.
  const questions = useMemo(() => result?.questions ?? [], [result]);

  const counts = useMemo(() => {
    const empty = Object.fromEntries(
      INTERVIEW_CATEGORIES.map((category) => [category, 0])
    ) as Record<InterviewCategory, number>;
    for (const question of questions) {
      if (question.category in empty) empty[question.category] += 1;
    }
    return empty;
  }, [questions]);

  const visible = useMemo(
    () =>
      questions
        .map((question, index) => ({ question, index }))
        .filter(({ question }) => filter === "all" || question.category === filter),
    [questions, filter]
  );

  // The QUESTIONS follow the CV's language, which is not necessarily the
  // site's: an Arabic CV read on an English interface still has to render
  // its Arabic RTL, and vice versa.
  const contentLang = result?.language === "ar" ? "ar" : "en";
  const contentDir: "ltr" | "rtl" = contentLang === "ar" ? "rtl" : "ltr";

  function toggle(index: number) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const allOpen = visible.length > 0 && visible.every(({ index }) => openIds.has(index));

  function toggleAll() {
    setOpenIds(allOpen ? new Set() : new Set(visible.map(({ index }) => index)));
  }

  /* ── The page body, rendered identically locked or unlocked ────────── */

  const body = (
    <div className="space-y-6">
      <header>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-600">
          {copy.eyebrow}
        </span>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </header>

      {actionError && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
          <span className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{actionError}</span>
          </span>
        </div>
      )}

      {loadError && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <span>{loadError}</span>
              {loadErrorDetail && (
                <p dir="ltr" className="mt-0.5 break-words text-left font-mono text-xs text-rose-400">
                  {loadErrorDetail}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="shrink-0 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
          >
            {copy.errors.retry}
          </button>
        </div>
      )}

      {/* ── Generating ── */}
      {busyId ? (
        <GeneratingState copy={copy} phases={phases} current={step} />
      ) : result ? (
        /* ── Results ── */
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setResultCvId(null);
                setActionError(null);
              }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              {dir === "rtl" ? (
                <ArrowRight className="size-4" aria-hidden />
              ) : (
                <ArrowLeft className="size-4" aria-hidden />
              )}
              {copy.results.backToCvs}
            </button>

            <button
              type="button"
              onClick={() => resultCvId && handleGenerate(resultCvId)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {copy.results.regenerate}
            </button>
          </div>

          <ResultsHeader
            total={questions.length}
            counts={counts}
            role={result.role}
            company={result.company}
            overview={result.overview}
            copy={copy}
            contentDir={contentDir}
          />

          {/* Only worth saying when the two languages differ — otherwise it
              states the obvious. */}
          {contentLang !== lang && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              {copy.results.languageNote[contentLang]}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <CategoryTabs
              active={filter}
              onChange={setFilter}
              counts={counts}
              total={questions.length}
              copy={copy}
            />
            {visible.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                {allOpen ? copy.results.collapseAll : copy.results.expandAll}
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-400">
              {copy.results.emptyFilter}
            </p>
          ) : (
            <div className="space-y-3">
              {visible.map(({ question, index }) => (
                <QuestionCard
                  key={index}
                  question={question}
                  index={index}
                  open={openIds.has(index)}
                  onToggle={() => toggle(index)}
                  copy={copy}
                  contentDir={contentDir}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        /* ── Picker (landing state) ── */
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {copy.picker.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">{copy.picker.sub}</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {copy.picker.loading}
            </div>
          ) : (
            <CvPicker
              cvs={overview?.cvs ?? []}
              onSelect={(cv: InterviewCv) => handleGenerate(cv.id)}
              busyId={busyId}
              copy={copy}
              resumesCopy={resumesCopy}
              formatDate={formatDate}
            />
          )}
        </section>
      )}
    </div>
  );

  /* ── Gate ──────────────────────────────────────────────────────────
     Locked until the overview says otherwise. Defaulting to LOCKED while
     loading matters: the alternative flashes the working page for a moment
     on every visit by a Free user, which reads as the feature being taken
     away from them rather than never having been theirs. */
  const unlocked = overview?.unlocked === true;

  return (
    <div className="mx-auto max-w-4xl" dir={dir}>
      {loading || unlocked ? (
        body
      ) : (
        <LockedOverlay copy={copy}>{body}</LockedOverlay>
      )}

      {/* A Free user's page is inert, so the one action they DO have has to
          live outside the blurred region. LockedOverlay carries the button;
          this is the keyboard-reachable duplicate for anyone who scrolled
          past the panel on a long page. */}
      {!loading && !unlocked && (
        <div className="mt-6 text-center">
          <DashboardButton as="a" href="/dashboard/upgrade" variant="outline" size="sm">
            {copy.locked.cta}
          </DashboardButton>
        </div>
      )}
    </div>
  );
}
