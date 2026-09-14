-- Separate the PAID "Find matching jobs" results from the FREE automatic
-- per-CV teaser — 2026-09-14.
--
-- ─── THE BUG THIS FIXES ─────────────────────────────────────────────────────
--
-- `resumes.similar_jobs` was written by exactly one thing (the on-demand
-- button), so find_jobs_for_resume could treat "this column has rows" as
-- "this user already paid for a search" and return them for free. That is
-- correct idempotency: a double-click must not buy a second search.
--
-- On 2026-09-14 the automatic per-CV job match came back as a graph sibling
-- (core/orchestrator.py), and it writes the SAME column. The idempotency
-- check could no longer tell the two apart, so every CV arrived at the
-- results page already holding five rows — and the paid button, on seeing
-- them, returned those five for free and never ran. The paid feature
-- silently stopped being a feature.
--
-- Two columns, because they are two different products:
--
--   similar_jobs   FREE. Up to 5. Written automatically on every generation
--                  by agents/jobs_finder.find_matching_jobs_for_cv (2 lanes,
--                  3 provider credits, shared-cache first). A teaser.
--   matched_jobs   PAID. Up to 10. Written only by
--                  POST /api/v1/resumes/{id}/find-jobs, which spends a Job
--                  Search allowance slot or credits. The deliberate feature.
--
-- The button's idempotency now reads `matched_jobs` alone, so a CV holding
-- only the free teaser still triggers a real, separately-paid search.
--
-- NOT A RENAME, AND NOTHING IS BACKFILLED. Every existing `similar_jobs`
-- value was written by the paid button, so on those rows the free column
-- currently holds paid results. That is harmless in the direction it
-- matters: the user keeps seeing the listings they paid for, and the worst
-- case is that pressing the button once more runs one search they have
-- already had. Copying them across would be the riskier choice — it would
-- hand every one of those rows a permanent free pass on the paid button.

ALTER TABLE public.resumes
    ADD COLUMN IF NOT EXISTS matched_jobs jsonb;

COMMENT ON COLUMN public.resumes.similar_jobs IS
    'FREE automatic teaser, up to 5 listings, written on every CV generation '
    'by agents/jobs_finder.find_matching_jobs_for_cv. Never gates the paid button.';

COMMENT ON COLUMN public.resumes.matched_jobs IS
    'PAID results, up to 10 listings, written only by POST /api/v1/resumes/{id}/find-jobs. '
    'This column alone decides whether that button has already been paid for.';
