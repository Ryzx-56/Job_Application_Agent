"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  FileText,
  Lightbulb,
  Loader2,
  Lock,
  Quote,
  Sparkles,
  Target,
  TriangleAlert,
  UserRound,
  Wrench,
} from "lucide-react";
import type { content } from "@/lib/language";
import type {
  InterviewCategory,
  InterviewCv,
  InterviewQuestion,
  InterviewStep,
} from "@/lib/supabase/interview";
import { INTERVIEW_CATEGORIES } from "@/lib/supabase/interview";
import { DashboardButton, EmptyState } from "@/components/dashboard";

/* ========================================================================
   INTERVIEW PREP, SHARED UI

   Palette and shapes follow the existing dashboard exactly: slate-50 ground,
   white cards, rounded-2xl containers, blue-600 as the single accent, the
   same border/shadow scale as components/dashboard.tsx. This page is part of
   the dashboard, not a separate surface like the LinkedIn add-on (which
   borrows LinkedIn's own blue on purpose), so it should be indistinguishable
   from My Resumes in feel.

   The one place colour does extra work is the four question categories. Each
   gets its own hue, used identically on the filter tab, the card's left
   spine and its badge, so a colour learned once in the tab row keeps meaning
   the same thing down the list.
======================================================================== */

type InterviewCopy = (typeof content)["en"]["dashboard"]["interview"];
/** Borrowed from the My Resumes block so a CV's title, company and language
 *  pill read identically on both pages. */
type ResumesCopy = (typeof content)["en"]["dashboard"]["resumes"];

/** One category's full visual treatment. Kept in one object per category so
 *  a tab, a badge and a card spine can never drift out of agreement. */
const CATEGORY_STYLES: Record<
  InterviewCategory,
  { icon: React.ElementType; badge: string; spine: string; tabActive: string; dot: string }
> = {
  behavioral: {
    icon: UserRound,
    badge: "bg-violet-50 text-violet-700 ring-violet-100",
    spine: "bg-violet-400",
    tabActive: "bg-violet-600 text-white",
    dot: "bg-violet-500",
  },
  technical: {
    icon: Wrench,
    badge: "bg-blue-50 text-blue-700 ring-blue-100",
    spine: "bg-blue-500",
    tabActive: "bg-blue-600 text-white",
    dot: "bg-blue-500",
  },
  role_specific: {
    icon: Target,
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    spine: "bg-emerald-500",
    tabActive: "bg-emerald-600 text-white",
    dot: "bg-emerald-500",
  },
  // Amber, not red: a gap is a thing to prepare for, not a failure. Red here
  // would read as "your CV is bad" on a page someone opens when they're
  // already nervous.
  gap: {
    icon: TriangleAlert,
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
    spine: "bg-amber-500",
    tabActive: "bg-amber-600 text-white",
    dot: "bg-amber-500",
  },
};

/* ========================================================================
   LOCK OVERLAY: the whole page renders underneath, blurred and inert.

   Rendered rather than replaced on purpose. A Free user seeing the real
   layout of what they'd get is a better upgrade case than a bare paywall,
   and it costs nothing because the page's own data is theirs anyway. The
   blur is presentation only: /api/v1/interview/generate re-checks the tier
   server-side, so nothing here is load-bearing for access.

   `inert` + aria-hidden matter as much as pointer-events: without them the
   blurred content stays keyboard-reachable and screen readers announce a UI
   the user cannot use.
======================================================================== */
export function LockedOverlay({
  copy,
  children,
}: {
  copy: InterviewCopy;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {/* `inert` must be the boolean, not inert="": React 19 treats the empty
          string as false and drops the attribute entirely, which silently
          leaves the blurred page keyboard-reachable. */}
      <div
        aria-hidden
        inert
        className="pointer-events-none select-none blur-[5px] saturate-50"
      >
        {children}
      </div>

      {/* A soft wash so the panel reads against whatever is behind it,
          without hiding the shape of the page underneath. */}
      <div className="absolute inset-0 bg-slate-50/40" aria-hidden />

      <div className="absolute inset-0 flex items-start justify-center px-4 py-16 sm:py-24">
        <div className="sticky top-8 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl shadow-slate-900/10">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-blue-50 text-blue-600">
            <Lock className="size-5" aria-hidden />
          </span>
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
            {copy.locked.badge}
          </span>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
            {copy.locked.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.locked.body}</p>
          <DashboardButton as={Link} href="/dashboard/upgrade" size="lg" className="mt-5 w-full">
            <Sparkles className="size-4" aria-hidden />
            {copy.locked.cta}
          </DashboardButton>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================
   CV PICKER: the landing state.

   Card treatment matches My Resumes' row content (role, company, date,
   language pill) so the same CV is recognizable across both pages. Cards
   that can't be used are rendered disabled WITH THE REASON rather than
   hidden: a user who can see a CV on My Resumes and not here would assume
   the page is broken.
======================================================================== */
function LanguagePill({ cvLanguage, copy }: { cvLanguage: "en" | "ar"; copy: ResumesCopy }) {
  const isAr = cvLanguage === "ar";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        isAr ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"
      }`}
    >
      {isAr ? copy.languageBadge.ar : copy.languageBadge.en}
    </span>
  );
}

export function CvPicker({
  cvs,
  onSelect,
  busyId,
  copy,
  resumesCopy,
  formatDate,
}: {
  cvs: InterviewCv[];
  onSelect: (cv: InterviewCv) => void;
  busyId: string | null;
  copy: InterviewCopy;
  resumesCopy: ResumesCopy;
  formatDate: (iso: string) => string;
}) {
  const eligible = cvs.filter((cv) => cv.eligible);
  const blocked = cvs.filter((cv) => !cv.eligible);

  if (cvs.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={copy.picker.emptyTitle}
        body={copy.picker.emptyBody}
        ctaLabel={copy.picker.emptyCta}
        ctaHref="/dashboard"
      />
    );
  }

  return (
    <div className="space-y-4">
      {eligible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-6 text-center">
          <p className="text-sm font-medium text-slate-900">{copy.picker.noneEligibleTitle}</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">
            {copy.picker.noneEligibleBody}
          </p>
          <DashboardButton as={Link} href="/dashboard" variant="outline" size="sm" className="mt-3">
            {copy.picker.emptyCta}
          </DashboardButton>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {eligible.map((cv) => {
          const busy = busyId === cv.id;
          const anyBusy = busyId !== null;
          return (
            <button
              key={cv.id}
              type="button"
              onClick={() => onSelect(cv)}
              disabled={anyBusy}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-4 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                  <FileText className="size-4.5" aria-hidden />
                </span>
                {/* A CV that already has a prep opens it, free. The badge
                    says so before the click, because the difference is one
                    of this month's generations. */}
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    cv.prepared_at ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  <Check className="size-3" aria-hidden />
                  {cv.prepared_at ? copy.picker.preparedTag : copy.picker.eligibleTag}
                </span>
              </div>

              <p className="mt-3 line-clamp-2 text-sm font-semibold text-slate-900">
                {cv.role || resumesCopy.untitledRole}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {cv.company || resumesCopy.unknownCompany}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>
                  {cv.prepared_at ? copy.picker.preparedOn(formatDate(cv.prepared_at)) : formatDate(cv.created_at)}
                </span>
                <LanguagePill cvLanguage={cv.cv_language} copy={resumesCopy} />
              </div>

              <span className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600">
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-3.5" aria-hidden />
                )}
                {busy
                  ? cv.prepared_at
                    ? copy.picker.openingCta
                    : copy.picker.selectCta
                  : cv.prepared_at
                  ? copy.picker.openCta
                  : copy.picker.selectCta}
              </span>
            </button>
          );
        })}
      </div>

      {blocked.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs text-slate-400">{copy.picker.hiddenCount(blocked.length)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {blocked.map((cv) => (
              <div
                key={cv.id}
                className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 opacity-80"
                aria-disabled
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400">
                    <FileText className="size-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-500">
                      {cv.role || resumesCopy.untitledRole}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {cv.company || resumesCopy.unknownCompany}
                    </p>
                  </div>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-slate-400">
                  {cv.ineligible_reason ? copy.picker.reasons[cv.ineligible_reason] : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================
   GENERATING STATE: a stepped list driven by the server, not by a timer.

   Each line lights up when the backend reports that phase has genuinely
   started (see the `step` SSE events in core/interview.py). Nothing here
   guesses at elapsed time, and a run that stalls looks stalled rather than
   marching through a fake sequence.

   `phases` is the ordered list to show. An English run never emits
   "localize", so the caller leaves it out entirely rather than rendering a
   step that will never complete.
======================================================================== */
export function GeneratingState({
  copy,
  phases,
  current,
}: {
  copy: InterviewCopy;
  phases: InterviewStep[];
  /** The phase the server last reported, or null before the first event. */
  current: InterviewStep | null;
}) {
  const activeIndex = current ? phases.indexOf(current) : -1;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm sm:px-8">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-blue-50 text-blue-600">
        <BrainCircuit className="size-5.5 animate-pulse" aria-hidden />
      </span>
      <p className="mt-4 text-base font-semibold text-slate-900">{copy.generating.title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
        {copy.generating.body}
      </p>

      <ol className="mx-auto mt-6 max-w-sm space-y-2.5 text-start">
        {phases.map((phase, index) => {
          const label = copy.generating.steps[phase];
          const done = activeIndex > index;
          const active = activeIndex === index;
          return (
            <li key={phase} className="flex items-center gap-3">
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full transition-colors ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {done ? (
                  <Check className="size-3" aria-hidden />
                ) : active ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                )}
              </span>
              <span
                className={`text-sm transition-colors ${
                  done ? "text-slate-400" : active ? "font-medium text-slate-900" : "text-slate-400"
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ========================================================================
   FILTER TABS: All / Behavioral / Technical / Role-specific / Gap.

   Each tab carries its own count, so the row doubles as the breakdown of
   what was generated and a category with nothing in it is visibly empty
   before it's clicked rather than after.
======================================================================== */
export function CategoryTabs({
  active,
  onChange,
  counts,
  total,
  copy,
}: {
  active: InterviewCategory | "all";
  onChange: (next: InterviewCategory | "all") => void;
  counts: Record<InterviewCategory, number>;
  total: number;
  copy: InterviewCopy;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";

  return (
    <div className="flex flex-wrap gap-2" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={active === "all"}
        onClick={() => onChange("all")}
        className={`${base} ${
          active === "all"
            ? "bg-slate-900 text-white"
            : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
        }`}
      >
        {copy.results.filterAll}
        <span className={active === "all" ? "text-white/70" : "text-slate-400"}>{total}</span>
      </button>

      {INTERVIEW_CATEGORIES.map((category) => {
        const style = CATEGORY_STYLES[category];
        const selected = active === category;
        const count = counts[category] ?? 0;
        return (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(category)}
            disabled={count === 0}
            className={`${base} ${
              selected
                ? style.tabActive
                : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {!selected && <span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden />}
            {copy.categories[category]}
            <span className={selected ? "text-white/70" : "text-slate-400"}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ========================================================================
   QUESTION CARD: collapsed to the question itself, expanded to the answer.

   Collapsed by default and one row per question, because the first useful
   thing to do with this page is read the twelve questions straight through
   and notice which ones you can't answer. The answer is what you open when
   you get to that one.

   `dir` comes from the CONTENT's language, not the page's: an Arabic CV
   produces Arabic questions that must render RTL even while the site is in
   English, and vice versa.
======================================================================== */
export function QuestionCard({
  question,
  index,
  open,
  onToggle,
  copy,
  contentDir,
}: {
  question: InterviewQuestion;
  index: number;
  open: boolean;
  onToggle: () => void;
  copy: InterviewCopy;
  contentDir: "ltr" | "rtl";
}) {
  const style = CATEGORY_STYLES[question.category] ?? CATEGORY_STYLES.role_specific;
  const Icon = style.icon;
  const isGap = question.category === "gap";

  const starBeats = [
    { key: "situation", label: copy.results.star.situation, value: question.star?.situation },
    { key: "task", label: copy.results.star.task, value: question.star?.task },
    { key: "action", label: copy.results.star.action, value: question.star?.action },
    { key: "result", label: copy.results.star.result, value: question.star?.result },
  ].filter((beat) => Boolean(beat.value?.trim()));

  const bodyId = `interview-q-${index}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex">
        {/* The category spine. Colour only, no text: it's what makes a
            scrolled list of twelve cards scannable by type. */}
        <span className={`w-1 shrink-0 ${style.spine}`} aria-hidden />

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex w-full items-start gap-3 p-4 text-start transition-colors hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40 sm:p-5"
          >
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
              {index + 1}
            </span>

            <span className="min-w-0 flex-1">
              <span
                dir={contentDir}
                className={`block text-sm font-medium leading-relaxed text-slate-900 ${
                  contentDir === "rtl" ? "text-right" : "text-left"
                }`}
              >
                {question.question}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${style.badge}`}
                >
                  <Icon className="size-3" aria-hidden />
                  {copy.categories[question.category]}
                </span>
              </span>
            </span>

            <ChevronDown
              className={`mt-1 size-4 shrink-0 text-slate-400 transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </button>

          {open && (
            <div id={bodyId} className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5">
              {question.jd_hook && (
                <div className="flex gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
                  <Quote className="mt-0.5 size-3.5 shrink-0 text-slate-300" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {copy.results.fromPosting}
                    </p>
                    <p
                      dir={contentDir}
                      className={`mt-0.5 text-xs italic leading-relaxed text-slate-600 ${
                        contentDir === "rtl" ? "text-right" : "text-left"
                      }`}
                    >
                      {question.jd_hook}
                    </p>
                  </div>
                </div>
              )}

              {question.why_asked && (
                <Block
                  icon={Lightbulb}
                  label={copy.results.whyAsked}
                  text={question.why_asked}
                  contentDir={contentDir}
                />
              )}

              {question.answer_angle && (
                <Block
                  icon={Target}
                  label={copy.results.answerAngle}
                  text={question.answer_angle}
                  contentDir={contentDir}
                />
              )}

              {/* GAP QUESTIONS. Placed above the STAR beats on purpose: on a
                  gap question the honest framing IS the answer, and the STAR
                  beats below it (when there are any) are only the adjacent
                  experience that supports it. */}
              {isGap && question.gap_honesty && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    <TriangleAlert className="size-3" aria-hidden />
                    {copy.results.gapHonesty}
                  </p>
                  <p
                    dir={contentDir}
                    className={`mt-1.5 text-sm leading-relaxed text-amber-900 ${
                      contentDir === "rtl" ? "text-right" : "text-left"
                    }`}
                  >
                    {question.gap_honesty}
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-700/80">
                    {copy.results.gapHonestyNote}
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {copy.results.starLabel}
                </p>

                {/* THE ANSWER, as continuous prose. Four labelled fragments
                    are not something a person can say out loud, so the
                    paragraph leads and the beats are the summary below it. */}
                {question.answer_paragraph?.trim() ? (
                  <p
                    dir={contentDir}
                    className={`mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700 ${
                      contentDir === "rtl" ? "text-right" : "text-left"
                    }`}
                  >
                    {question.answer_paragraph}
                  </p>
                ) : starBeats.length === 0 ? (
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {copy.results.starEmpty}
                  </p>
                ) : null}

                {starBeats.length > 0 && (
                  <p className="mt-4 border-t border-slate-100 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {copy.results.starSummaryLabel}
                  </p>
                )}

                {starBeats.length === 0 ? null : (
                  <ol className="mt-2.5 space-y-2.5">
                    {starBeats.map((beat) => (
                      <li key={beat.key} className="flex gap-2.5">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                            {beat.label}
                          </p>
                          <p
                            dir={contentDir}
                            className={`mt-0.5 text-sm leading-relaxed text-slate-700 ${
                              contentDir === "rtl" ? "text-right" : "text-left"
                            }`}
                          >
                            {beat.value}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                {question.cv_evidence.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {copy.results.evidenceLabel}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {question.cv_evidence.map((item) => (
                        <span
                          key={item}
                          dir={contentDir}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One labeled paragraph inside an expanded card. */
function Block({
  icon: Icon,
  label,
  text,
  contentDir,
}: {
  icon: React.ElementType;
  label: string;
  text: string;
  contentDir: "ltr" | "rtl";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
      <p
        dir={contentDir}
        className={`mt-1 text-sm leading-relaxed text-slate-600 ${
          contentDir === "rtl" ? "text-right" : "text-left"
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/* ========================================================================
   RESULTS HEADER: the "12 questions prepared" line and the category split.

   The count is the progress feel the brief asked for. The bar underneath is
   the same twelve questions expressed as proportions per category, which is
   genuinely informative (a role with five gap questions is a different
   interview from one with none) rather than decorative.
======================================================================== */
export function ResultsHeader({
  total,
  counts,
  role,
  company,
  overview,
  copy,
  contentDir,
  unknownCompanyLabel,
}: {
  total: number;
  counts: Record<InterviewCategory, number>;
  role: string;
  /** Already normalized by the caller: empty when the CV's company is a
   *  placeholder rather than a real employer. */
  company: string;
  overview: string;
  unknownCompanyLabel: string;
  copy: InterviewCopy;
  contentDir: "ltr" | "rtl";
}) {
  const segments = useMemo(
    () => INTERVIEW_CATEGORIES.filter((category) => (counts[category] ?? 0) > 0),
    [counts]
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            <Sparkles className="size-4.5 text-blue-600" aria-hidden />
            {copy.results.prepared(total)}
          </p>
          {(role || company) && (
            <p className="mt-1 truncate text-sm text-slate-500">
              {copy.results.forRole} <span className="font-medium text-slate-700">{role}</span>
              {" "}
              {copy.results.atCompany}{" "}
              {/* jd_analyzer writes the literal "Unknown" when the posting
                  never named an employer, so it arrives as data. Printed raw
                  it reads as a bug; the localized label says the same thing
                  honestly. */}
              <span className="font-medium text-slate-700">{company || unknownCompanyLabel}</span>
            </p>
          )}
        </div>
      </div>

      {/* Proportional split. aria-hidden because the same numbers are on the
          filter tabs as real text right below it. */}
      {segments.length > 0 && (
        <div className="mt-4 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {segments.map((category) => (
            <span
              key={category}
              className={`${CATEGORY_STYLES[category].spine} rounded-full`}
              style={{ width: `${((counts[category] ?? 0) / total) * 100}%` }}
            />
          ))}
        </div>
      )}

      {overview && (
        <div className="mt-4 rounded-xl bg-slate-50 p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {copy.results.overviewLabel}
          </p>
          <p
            dir={contentDir}
            className={`mt-1 text-sm leading-relaxed text-slate-700 ${
              contentDir === "rtl" ? "text-right" : "text-left"
            }`}
          >
            {overview}
          </p>
        </div>
      )}
    </div>
  );
}

export { CATEGORY_STYLES };
