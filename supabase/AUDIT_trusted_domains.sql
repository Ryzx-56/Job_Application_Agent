-- ============================================================================
-- WHICH TRUSTED DOMAINS HAVE EVER PRODUCED A KEPT RESULT?
--
-- Read-only. Paste into the Supabase SQL editor and run; nothing is written.
--
-- WHY THIS EXISTS. jobs_finder.TRUSTED_DOMAINS holds sixteen entries. Google
-- stops honouring `site:` terms past roughly eight OR'd together, so on Serper
-- the trusted lane has to be split into two calls — and that is a cost paid on
-- every search, forever. Trimming the list to the entries that actually earn
-- their place removes the split entirely. This asks the only question that
-- settles it: which of them has ever put a listing in front of a user?
--
-- WHAT COUNTS AS EVIDENCE. resumes.similar_jobs holds the job leads that
-- survived the screener and were shown with a finished CV. A domain appearing
-- there was not merely returned by the search — it was kept.
--
-- WHAT THIS DOES NOT COVER. The standalone /dashboard/job-search page does not
-- persist its results, so those runs are invisible here. Same pipeline, same
-- domains, so the ranking should hold, but read the counts as a lower bound.
-- A domain with zero here is a domain that has never survived the screener in
-- the flow we can see — which is the case for cutting it, not proof.
-- ============================================================================

WITH trusted(domain, lane) AS (
  VALUES
    ('linkedin.com',        'global board'),
    ('indeed.com',          'global board'),
    ('glassdoor.com',       'global board'),
    ('ziprecruiter.com',    'global board'),
    ('monster.com',         'global board'),
    ('lever.co',            'ATS'),
    ('greenhouse.io',       'ATS'),
    ('myworkdayjobs.com',   'ATS'),
    ('smartrecruiters.com', 'ATS'),
    ('icims.com',           'ATS'),
    ('bayt.com',            'Gulf/MENA'),
    ('gulftalent.com',      'Gulf/MENA'),
    ('naukrigulf.com',      'Gulf/MENA'),
    ('mihnati.com',         'Gulf/MENA'),
    ('wuzzuf.net',          'Gulf/MENA'),
    ('tanqeeb.com',         'Gulf/MENA'),
    ('getsaudijobs.com',    'Saudi aggregator lane'),
    ('saudi.tanqeeb.com',   'Saudi aggregator lane')
),
kept AS (
  SELECT
    r.id                                   AS resume_id,
    r.created_at,
    lower(regexp_replace(j->>'url', '^https?://(www\.)?([^/?#]+).*$', '\2')) AS host
  FROM public.resumes r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.similar_jobs) = 'array' THEN r.similar_jobs ELSE '[]'::jsonb END
  ) AS j
  WHERE j->>'url' IS NOT NULL
),
-- Longest match wins, so saudi.tanqeeb.com is not credited to tanqeeb.com.
attributed AS (
  SELECT k.*, m.domain, m.lane
  FROM kept k
  LEFT JOIN LATERAL (
    SELECT t.domain, t.lane
    FROM trusted t
    WHERE k.host = t.domain OR k.host LIKE '%.' || t.domain
    ORDER BY length(t.domain) DESC
    LIMIT 1
  ) m ON TRUE
)

-- 1. THE ANSWER: every trusted domain, with zeroes included. The zero rows
--    are the point — those are the entries pushing the lane over eight.
SELECT
  t.lane,
  t.domain,
  count(a.resume_id)                       AS kept_results,
  count(DISTINCT a.resume_id)              AS distinct_cvs,
  count(DISTINCT date_trunc('day', a.created_at)) AS days_seen,
  min(a.created_at)::date                  AS first_seen,
  max(a.created_at)::date                  AS last_seen
FROM trusted t
LEFT JOIN attributed a ON a.domain = t.domain
GROUP BY t.lane, t.domain
ORDER BY kept_results DESC, t.domain;

-- 2. HOW MUCH OF THE OUTPUT THE TRUSTED LIST IS ACTUALLY RESPONSIBLE FOR.
--    If the open lane carries most of it, the trusted list is a smaller lever
--    than it looks and the split is even less worth paying for.
SELECT
  CASE WHEN domain IS NULL THEN 'open lane (not in TRUSTED_DOMAINS)' ELSE 'trusted list' END AS source,
  count(*) AS kept_results,
  round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 1) AS pct
FROM attributed
GROUP BY 1
ORDER BY kept_results DESC;

-- 3. THE OPEN LANE'S OWN TOP DOMAINS. Anything here with real volume is a
--    candidate for PROMOTION into the trusted list — which is the other half
--    of the decision, and the reason not to just cut blindly.
SELECT host, count(*) AS kept_results, count(DISTINCT resume_id) AS distinct_cvs,
       min(created_at)::date AS first_seen, max(created_at)::date AS last_seen
FROM attributed
WHERE domain IS NULL
GROUP BY host
ORDER BY kept_results DESC
LIMIT 30;

-- 4. SAMPLE SIZE, so the numbers above can be read honestly. Twelve CVs is
--    not evidence about sixteen domains; four hundred is.
SELECT
  count(*)                                              AS resumes_total,
  count(*) FILTER (WHERE jsonb_array_length(similar_jobs) > 0) AS resumes_with_jobs,
  coalesce(sum(jsonb_array_length(similar_jobs)), 0)    AS kept_results_total,
  min(created_at)::date                                 AS earliest,
  max(created_at)::date                                 AS latest
FROM public.resumes
WHERE jsonb_typeof(similar_jobs) = 'array';
