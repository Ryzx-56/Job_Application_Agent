"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Briefcase, ExternalLink, Loader2, Lock, Search } from "lucide-react";
import { useLang } from "@/lib/language";
import { DashboardButton } from "@/components/dashboard";
import { MATCH_TIER_COPY, getMatchTier, type MatchTier, type SimilarJob } from "@/lib/jobMatch";
import {
  fetchJobSearchOverview,
  searchJobs,
  JobSearchError,
  type JobSearchResults,
} from "@/lib/supabase/jobSearch";

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
    return () => {
      cancelled = true;
    };
  }, []);

  function messageFor(err: JobSearchError): string {
    switch (err.code) {
      case "upgrade_required":
        return copy.errors.upgradeRequired;
      case "missing_title":
        return copy.errors.missingTitle;
      case "title_too_long":
        return copy.errors.titleTooLong;
      default:
        return copy.errors.search;
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const title = jobTitle.trim();
    if (!title) {
      setError(copy.errors.missingTitle);
      return;
    }
    setError(null);
    setSearching(true);
    setResults(null);
    try {
      const data = await searchJobs({ jobTitle: title, internships, location: location.trim() });
      setResults(data);
    } catch (err) {
      console.error("searchJobs failed:", err);
      setError(messageFor(err as JobSearchError));
    } finally {
      setSearching(false);
    }
  }

  const totalResults = (results?.exact.length ?? 0) + (results?.related.length ?? 0);

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

      {searching && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-14 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.searching}
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
    </div>
  );
}
