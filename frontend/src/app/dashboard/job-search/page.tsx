"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Briefcase, Clock, ExternalLink, History, Loader2, Lock, RefreshCw, Search } from "lucide-react";
import { useLang } from "@/lib/language";
import { DashboardButton } from "@/components/dashboard";
import { AddonPurchaseDialog } from "@/components/addon-purchase-dialog";
import { readAddonPurchaseOffer, type AddonPurchaseOffer } from "@/lib/addonPurchase";
import { MATCH_TIER_COPY, getMatchTier, type MatchTier, type SimilarJob } from "@/lib/jobMatch";
import {
  fetchJobSearchHistory,
  fetchJobSearchOverview,
  reopenJobSearch,
  searchJobs,
  JobSearchError,
  type JobSearchHistoryEntry,
  type JobSearchResults,
} from "@/lib/supabase/jobSearch";

/** "6 hours ago" / "قبل 6 ساعات" — via Intl so Arabic plural/number forms
 *  are correct natively rather than hand-written (CLAUDE.md: write Arabic
 *  natively, and don't hand-roll what a locale-aware API already gets
 *  right). Falls back to the plain date past a month, where "ago" phrasing
 *  stops being useful. */
function relativeTime(iso: string | undefined, lang: "en" | "ar"): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar" : "en", { numeric: "auto" });
  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [2592000, "day"],
  ];
  for (const [limit, unit] of thresholds) {
    if (Math.abs(diffSeconds) < limit) {
      const divisor = unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400;
      return rtf.format(Math.round(diffSeconds / divisor), unit);
    }
  }
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en");
}

/* ========================================================================
   /dashboard/job-search — standalone Job Search (Pro and Elite).

   Separate from the CV-tailoring flow entirely: a job title goes in, live
   listings come out. Nothing here reads or writes a CV.

   FREE USERS see the page rendered and blurred behind an upgrade panel
   rather than a redirect, the same treatment Interview Prep gets, so they
   can see what they'd be buying. That blur is presentation only —
   /api/v1/job-search re-checks the tier server-side on every call, so a
   Free user who defeats the CSS still gets a 403 rather than results.

   RESULTS COME BACK IN TWO GROUPS. `exact` are listings whose own title
   matches what was searched; `related` are adjacent roles, searched only
   once the exact matches ran out. They stay visually separate so the page
   never implies an adjacent role was an exact hit.
======================================================================== */

const MATCH_BADGE_CLASSES: Record<MatchTier, string> = {
  strong: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  stretch: "border-rose-200 bg-rose-50 text-rose-700",
};

/* Same listing card the My Resumes jobs panel uses. Kept local rather than
   shared because that one reads its copy from t.dashboard.resumes; the two
   are the same shape but answer to different dictionaries. */
function JobCard({ job, lang }: { job: SimilarJob; lang: "en" | "ar" }) {
  const tier = getMatchTier(job);
  const title = job.title || job.url;
  if (!title) return null;
  return (
    <li>
      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium leading-snug text-slate-900 group-hover:text-blue-700">
            {title}
          </p>
          {tier && (
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${MATCH_BADGE_CLASSES[tier]}`}
            >
              {MATCH_TIER_COPY[tier][lang === "ar" ? "ar" : "en"]}
            </span>
          )}
        </div>
        {job.snippet && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{job.snippet}</p>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
          {job.source && <span className="truncate">{job.source}</span>}
          {job.url && <ExternalLink className="size-3 shrink-0 text-blue-600" aria-hidden />}
        </div>
      </a>
    </li>
  );
}

export default function JobSearchPage() {
  const { t, lang, dir } = useLang();
  const copy = t.dashboard.jobSearch;

  const [unlocked, setUnlocked] = useState(true);
  const [defaultLocation, setDefaultLocation] = useState("");
  const [loadingOverview, setLoadingOverview] = useState(true);

  const [jobTitle, setJobTitle] = useState("");
  const [internships, setInternships] = useState(false);
  const [location, setLocation] = useState("");

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<JobSearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set only on a cache hit (live or reopened) — a fresh live search has no
  // separate "found at" moment worth showing, and `is_stale` doesn't apply.
  const [resultAge, setResultAge] = useState<{ at?: string; stale: boolean } | null>(null);
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);

  const [history, setHistory] = useState<JobSearchHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState(false);

  // The 402 addon_purchase_available offer (baseline exhausted, credits
  // could cover it) — set only when the caller hasn't confirmed yet. The
  // exact search params are remembered so confirming resubmits the SAME
  // request with spendCredits: true, not a reconstructed guess at it.
  const [purchaseOffer, setPurchaseOffer] = useState<AddonPurchaseOffer | null>(null);
  const [pendingSearch, setPendingSearch] = useState<{
    title: string; internships: boolean; location: string; refresh?: boolean;
  } | null>(null);
  const [purchaseDialogError, setPurchaseDialogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJobSearchOverview()
      .then((data) => {
        if (cancelled) return;
        setUnlocked(data.unlocked);
        setDefaultLocation(data.default_location || "");
      })
      .catch((err) => {
        console.error("fetchJobSearchOverview failed:", err);
        // A failed overview must not lock a paying user out of the page —
        // the real gate is server-side on the search itself.
        if (!cancelled) setUnlocked(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingOverview(false);
      });
    // History is read-only and free — loading it up front is what lets the
    // "recent searches" list appear without the user searching first.
    fetchJobSearchHistory()
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((err) => {
        console.error("fetchJobSearchHistory failed:", err);
        if (!cancelled) setHistoryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function messageFor(err: JobSearchError): string {
    switch (err.code) {
      // upgrade_required REMOVED (2026-09-13): nothing on this page's search
      // path can raise it any more. /api/v1/job-search uses
      // get_current_user_id (not the paid-only dependency) and prices
      // through begin_addon_use, which never raises a 403 — a Free user now
      // gets addon_purchase_available (handled below, as a dialog) if
      // credits could cover it, or purchase_limit_reached if not (Job
      // Search's Free-tier exclusion — its purchase cap equals its zero
      // baseline). Confirmed against core/job_search.py and
      // core/entitlements.py directly before removing this case.
      case "missing_title":
        return copy.errors.missingTitle;
      case "title_too_long":
        return copy.errors.titleTooLong;
      case "cache_unavailable":
        return copy.errors.reopenFailed;
      // The purchase cap (Job Search only — see PURCHASE_CAPPED_ADDONS in
      // core/entitlements.py) is spent too. A credit purchase cannot fix
      // this, so it is never offered as the dialog above.
      case "purchase_limit_reached":
        return copy.errors.purchaseLimitReached;
      // core/rate_limit.py's request-VOLUME limiter (30/hour) — a distinct
      // mechanism from the purchase cap above, with its own `code`. Neither
      // a credit purchase nor an upgrade fixes this; it clears on its own.
      case "rate_limited":
        return copy.errors.rateLimited;
      case "insufficient_credits":
        return copy.errors.insufficientCredits;
      default:
        return copy.errors.search;
    }
  }

  async function runSearch(opts: {
    title: string; internships: boolean; location: string; refresh?: boolean; spendCredits?: boolean;
  }) {
    setConfirmingRefresh(false);
    if (!opts.spendCredits) {
      // A fresh attempt (not a confirmed resubmit) starts clean — any
      // dialog left over from a different search must not linger.
      setError(null);
      setPurchaseOffer(null);
      setPendingSearch(null);
      setPurchaseDialogError(null);
    } else {
      setPurchaseDialogError(null);
    }
    setSearching(true);
    if (!opts.refresh) setResults(null);
    try {
      const data = await searchJobs({
        jobTitle: opts.title,
        internships: opts.internships,
        location: opts.location,
        refresh: opts.refresh,
        spendCredits: opts.spendCredits,
      });
      setResults(data);
      setResultAge(data.from_cache ? { at: data.cached_at, stale: false } : null);
      setPurchaseOffer(null);
      setPendingSearch(null);
      // A fresh entry from someone else's search, plus this user's own past
      // searches, both belong in "recent" — refetch rather than guess at
      // the shape of the row the backend just inserted.
      fetchJobSearchHistory().then(setHistory).catch(() => {});
    } catch (err) {
      console.error("searchJobs failed:", err);
      const e = err as JobSearchError;
      if (!opts.spendCredits) {
        const offer = readAddonPurchaseOffer(e);
        if (offer) {
          // THE DIALOG IS THE RESPONSE — no generic error banner alongside
          // it, and nothing has been charged yet.
          setPendingSearch(opts);
          setPurchaseOffer(offer);
          return;
        }
      } else {
        // The CONFIRMED attempt failed (balance moved between the 402 and
        // the confirm, or the search itself then failed) — shown inside the
        // still-open dialog so retrying doesn't mean reopening it.
        setPurchaseDialogError(messageFor(e));
        return;
      }
      setError(messageFor(e));
    } finally {
      setSearching(false);
    }
  }

  function handlePurchaseConfirm() {
    if (!pendingSearch) return;
    runSearch({ ...pendingSearch, spendCredits: true });
  }

  function handlePurchaseCancel() {
    // Nothing is sent. No partial action, no credits touched — matching
    // what begin_addon_use already guarantees server-side.
    setPurchaseOffer(null);
    setPendingSearch(null);
    setPurchaseDialogError(null);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const title = jobTitle.trim();
    if (!title) {
      setError(copy.errors.missingTitle);
      return;
    }
    await runSearch({ title, internships, location: location.trim() });
  }

  /** Refresh needs its OWN confirmed title/location/internships — the form
   *  fields may have changed since the results on screen were fetched. */
  function handleRefreshConfirmed() {
    runSearch({ title: jobTitle.trim() || results?.job_title || "", internships, location: location.trim(), refresh: true });
  }

  async function handleReopen(entry: JobSearchHistoryEntry) {
    setError(null);
    setConfirmingRefresh(false);
    setSearching(true);
    setResults(null);
    try {
      const data = await reopenJobSearch(entry.id);
      setJobTitle(entry.raw_query);
      setInternships(entry.internships);
      setLocation(entry.location || "");
      setResults(data);
      setResultAge({ at: data.cached_at, stale: data.is_stale });
    } catch (err) {
      console.error("reopenJobSearch failed:", err);
      setError(messageFor(err as JobSearchError));
    } finally {
      setSearching(false);
    }
  }

  const totalResults = (results?.exact.length ?? 0) + (results?.related.length ?? 0);
  const ageLabel = resultAge?.at ? relativeTime(resultAge.at, lang) : null;

  const page = (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-blue-600">{copy.eyebrow}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

      <form
        onSubmit={handleSearch}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div>
          <label htmlFor="jobTitle" className="mb-2 block text-sm font-medium text-slate-700">
            {copy.titleLabel}
          </label>
          <input
            id="jobTitle"
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder={copy.titlePlaceholder}
            maxLength={80}
            className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">{copy.kindLabel}</span>
            {/* Radio group, not a checkbox: jobs and internships are two
                different searches, not a modifier on one. */}
            <div role="radiogroup" aria-label={copy.kindLabel} className="flex gap-2">
              {[
                { value: false, label: copy.kindJobs },
                { value: true, label: copy.kindInternships },
              ].map((option) => {
                const selected = internships === option.value;
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setInternships(option.value)}
                    className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                      selected
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="jsLocation" className="mb-2 block text-sm font-medium text-slate-700">
              {copy.locationLabel}
            </label>
            <input
              id="jsLocation"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={defaultLocation || copy.locationPlaceholder}
              maxLength={60}
              aria-describedby="jsLocationHint"
              className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <p id="jsLocationHint" className="text-xs leading-relaxed text-slate-500">
          {copy.locationHint}
        </p>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}

        <DashboardButton type="submit" disabled={searching || !jobTitle.trim()}>
          {searching ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.searching}
            </>
          ) : (
            <>
              <Search className="size-4" aria-hidden /> {copy.searchCta}
            </>
          )}
        </DashboardButton>
      </form>

      {!searching && !results && historyError && (
        <p className="text-xs text-slate-400">{copy.errors.historyUnavailable}</p>
      )}

      {!searching && !results && history.length > 0 && (
        <section aria-labelledby="jsHistoryHeading">
          <h2 id="jsHistoryHeading" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <History className="size-4 text-slate-400" aria-hidden />
            {copy.history.heading}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => handleReopen(entry)}
                  aria-label={copy.history.reopenLabel(entry.raw_query)}
                  className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  {entry.raw_query}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {searching && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-14 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.searching}
        </div>
      )}

      {results && !searching && (totalResults > 0 || resultAge) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {ageLabel && (
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                {copy.foundAgo(ageLabel)}
              </span>
            )}
            {resultAge?.stale && (
              <span className="font-medium text-amber-700">{copy.stale}</span>
            )}
          </div>
          {resultAge && !confirmingRefresh && (
            <button
              type="button"
              onClick={() => setConfirmingRefresh(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {copy.refreshCta}
            </button>
          )}
          {resultAge && confirmingRefresh && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-600">{copy.refreshConfirm.question}</span>
              <button
                type="button"
                onClick={handleRefreshConfirmed}
                className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {copy.refreshConfirm.confirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRefresh(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {copy.refreshConfirm.cancel}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Not components/dashboard's EmptyState: that one requires a CTA, and
          "nothing is open right now" has no action to offer. Searching again
          is the only next step and the form is already right above. */}
      {results && !searching && totalResults === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500">
            <Briefcase className="size-5" aria-hidden />
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-900">{copy.emptyTitle}</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
            {copy.emptyBody}
          </p>
        </div>
      )}

      {results && !searching && results.exact.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-x-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {copy.exactHeading(results.job_title)}
            </h2>
            <span className="text-xs font-medium text-slate-500">
              · {copy.resultCount(results.exact.length)}
            </span>
          </div>
          <ul className="space-y-2.5">
            {results.exact.map((job, i) => (
              <JobCard key={job.url ?? i} job={job} lang={lang} />
            ))}
          </ul>
        </section>
      )}

      {results && !searching && results.related.length > 0 && (
        <section>
          <div className="mb-1 flex flex-wrap items-center gap-x-2">
            <h2 className="text-sm font-semibold text-slate-900">{copy.relatedHeading}</h2>
            <span className="text-xs font-medium text-slate-500">
              · {copy.resultCount(results.related.length)}
            </span>
          </div>
          {/* Says plainly that these are adjacent roles. Presenting them
              beside the exact matches with no distinction would misrepresent
              what was found. */}
          <p className="mb-3 text-xs leading-relaxed text-slate-500">{copy.relatedSub}</p>
          <ul className="space-y-2.5">
            {results.related.map((job, i) => (
              <JobCard key={job.url ?? i} job={job} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl" dir={dir}>
      {loadingOverview || unlocked ? (
        page
      ) : (
        <div className="relative">
          {/* `inert` must be the boolean, not inert="" — React 19 drops the
              empty string, which would leave the blurred page keyboard
              reachable. Same note as interview-ui.tsx's LockedOverlay. */}
          <div aria-hidden inert className="pointer-events-none select-none blur-[5px] saturate-50">
            {page}
          </div>
          <div className="absolute inset-0 bg-slate-50/40" aria-hidden />
          <div className="absolute inset-0 flex items-start justify-center px-4 py-16 sm:py-24">
            <div className="sticky top-8 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl shadow-slate-900/10">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-blue-50 text-blue-600">
                <Lock className="size-5" aria-hidden />
              </span>
              <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                {copy.locked.badge}
              </span>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">{copy.locked.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.locked.body}</p>
              <Link
                href="/dashboard/upgrade"
                className="mt-4 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {copy.locked.cta}
              </Link>
            </div>
          </div>
        </div>
      )}

      <AddonPurchaseDialog
        open={purchaseOffer !== null}
        isAr={lang === "ar"}
        addonLabel={copy.title}
        creditCost={purchaseOffer?.creditCost ?? 0}
        creditBalance={purchaseOffer?.creditBalance ?? 0}
        busy={searching}
        error={purchaseDialogError}
        onConfirm={handlePurchaseConfirm}
        onCancel={handlePurchaseCancel}
      />
    </div>
  );
}
