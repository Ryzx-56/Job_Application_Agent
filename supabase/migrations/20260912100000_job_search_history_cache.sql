-- Standalone Job Search history and result caching.
--
-- ─── THE PROBLEM ────────────────────────────────────────────────────────────
--
-- The per-CV `find-jobs` button is idempotent (find_jobs_for_resume returns
-- `resumes.similar_jobs` at zero cost on a repeat visit). The standalone
-- Job Search page (/api/v1/job-search) has no equivalent: a user who
-- searches, navigates away, and comes back pays the full Tavily cost again
-- for results that were already fetched. Job Search is the single largest
-- cost line in the product (pricing-reference-v7.md §1.1) — this is pure
-- waste on it.
--
-- ─── SHARED, NOT PER-USER ───────────────────────────────────────────────────
--
-- The prompt this migration implements originally scoped the cache PER USER,
-- flagging the shared-across-users option as a privacy decision for the
-- product owner to make. Decided 2026-09-12: shared. Two users searching the
-- same normalized query (title + location + internships) become one cache
-- entry, not two — that is where the actual credit savings compound, since a
-- popular title is searched by many users independently.
--
-- That is why this is TWO TABLES, not one:
--
--   job_search_cache   — the expensive part. Keyed by a normalized query
--                         hash, no user_id at all. One row per distinct
--                         search, shared by everyone who runs it.
--   job_search_history — the free part. Which cache entries has THIS user
--                         looked up, and when, and what did they actually
--                         type (their raw, unnormalized query, for display).
--                         Retention (last 20 or 30 days, whichever is
--                         larger) applies here, per user — pruning a user's
--                         history never touches the shared cache row other
--                         users may still be relying on.
--
-- No foreign key from history to cache: the cache is expected to be
-- garbage-collectable independently later (it isn't yet — nothing deletes a
-- cache row today, rows are small and TTL'd by `fetched_at` at the
-- application layer, not by deletion) without a FK cascade surprising the
-- history table it's not authoritative over.

CREATE TABLE IF NOT EXISTS public.job_search_cache (
    cache_key text PRIMARY KEY,
    job_title text NOT NULL,
    location text NOT NULL DEFAULT '',
    internships boolean NOT NULL DEFAULT false,
    results jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- What depth policy produced `results`, for audit — not a single scalar,
    -- because depth is per-lane (see PRIORITY_LANE_SEARCH_DEPTH in
    -- agents/jobs_finder.py), not one global knob. e.g.
    -- {"default": "thorough", "priority_lane": "fast"}.
    depth_used jsonb NOT NULL DEFAULT '{}'::jsonb,
    tavily_credits_used integer NOT NULL DEFAULT 0,
    -- How many times this row has been served as a cache hit (not counting
    -- the initial live fetch that created it, and not counting a deliberate
    -- Refresh, which writes a fresh row's worth of `results`/`fetched_at`
    -- via the same UPSERT rather than incrementing this). This is the
    -- number admin_stats.py's cache-hit-rate / credits-avoided reporting
    -- reads — see increment_job_search_cache_hit below for why it isn't a
    -- plain UPDATE from Python.
    hit_count integer NOT NULL DEFAULT 0,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_search_cache IS
    'Shared across every user (2026-09-12 product decision) — keyed only by the normalized query, never by who searched it. fetched_at is what the 48h TTL in core/job_search.py checks; a stale row is not deleted, just no longer served as a cache hit.';

CREATE TABLE IF NOT EXISTS public.job_search_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    cache_key text NOT NULL,
    -- As the user actually typed it — the cache row's job_title is whoever
    -- got there first, normalized differently or not at all matters to
    -- nobody but this display.
    raw_query text NOT NULL,
    location text NOT NULL DEFAULT '',
    internships boolean NOT NULL DEFAULT false,
    searched_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_search_history IS
    'Per-user list of past standalone Job Search lookups, for the history/reopen UI. Reopening a history entry is always free regardless of age — this table does not gate that, it only points back at job_search_cache.cache_key. Pruned on write (see prune_job_search_history), not on a cron.';

CREATE INDEX IF NOT EXISTS job_search_history_user_searched_idx
    ON public.job_search_history (user_id, searched_at DESC);

CREATE INDEX IF NOT EXISTS job_search_cache_fetched_at_idx
    ON public.job_search_cache (fetched_at);


-- ─── RETENTION: keep the union of (most recent 20) and (last 30 days) ───────
--
-- "Last 20 searches per user, or 30 days, whichever is larger" means a row
-- survives if EITHER condition keeps it — so a row is deleted only when it
-- fails BOTH: it is outside the 20 most recent AND older than 30 days.
-- Called after every insert (core/job_search.py), not from a cron — pruning
-- on write means the table never accumulates unbounded rows for a user who
-- searches often, without needing a scheduled job this repo doesn't have
-- infrastructure for yet.
CREATE OR REPLACE FUNCTION public.prune_job_search_history(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.job_search_history
  WHERE user_id = p_user_id
    AND searched_at < now() - interval '30 days'
    AND id NOT IN (
      SELECT id FROM public.job_search_history
      WHERE user_id = p_user_id
      ORDER BY searched_at DESC
      LIMIT 20
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_job_search_history(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.prune_job_search_history(uuid) TO service_role;


-- ─── CACHE HIT INSTRUMENTATION ───────────────────────────────────────────────
--
-- An atomic increment, the same shape as consume_addon_quota — two users
-- hitting the same cache entry in the same instant must both be counted,
-- which a Python read-then-write (SELECT hit_count, then UPDATE hit_count+1)
-- cannot guarantee under concurrency.
CREATE OR REPLACE FUNCTION public.increment_job_search_cache_hit(p_cache_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.job_search_cache
  SET hit_count = hit_count + 1
  WHERE cache_key = p_cache_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_job_search_cache_hit(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_job_search_cache_hit(text) TO service_role;

-- No GRANTs to anon/authenticated on either table: both are read and written
-- exclusively through the backend's service-role client (core/job_search.py),
-- the same way resumes/profiles already are. 20260901120344 makes that the
-- default for new tables; this is one more table that intentionally stays
-- deny-by-default rather than opting in to PostgREST access it doesn't need.
