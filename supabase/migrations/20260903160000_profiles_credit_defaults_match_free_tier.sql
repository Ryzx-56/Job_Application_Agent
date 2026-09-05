-- The last fragment of the 5 / 40 / 120 allowance set.
--
-- profiles.credits_remaining and credits_total still DEFAULT 5, from the era
-- when Free meant 5 credits. The real free allowance has been 3 for a long
-- time — core/credits.py TIER_CREDITS, reset_credits_if_due(),
-- sync_credits_on_tier_change(), apply_monthly_allowance() and
-- handle_new_user() all agree on 3.
--
-- It has been harmless only because both writers name the columns explicitly:
-- handle_new_user() supplies them, and nothing else inserts a profile. It is
-- a trap rather than a live bug — any future INSERT that omits them mints two
-- free credits nobody is entitled to, and it would look like a data problem
-- rather than a schema one.
--
-- The same stale set is what shipped "Pro includes 40 credits" to the pricing
-- page once already (see 20260902180000). This is the last piece of it.

alter table public.profiles
    alter column credits_remaining set default 3,
    alter column credits_total     set default 3;
