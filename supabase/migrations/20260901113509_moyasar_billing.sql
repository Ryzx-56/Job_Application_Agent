-- Moyasar billing: payments, saved cards, subscriptions, webhook deliveries.
--
-- Four new tables. None of them is writable by a logged-in user: the backend
-- writes with the service_role key, and a user's only privilege is SELECT on
-- their own rows. Money state that a client can write is money state a client
-- can forge.
--
-- MONEY IS AN INTEGER OF HALALAS throughout (100 to the riyal), which is
-- Moyasar's own unit. Never numeric, never a float, never SAR. The existing
-- `linkedin_purchases.price_paid numeric(10,2)` and `payment_events.amount_usd`
-- predate this rule and are left alone here; see the note at the bottom.
--
-- GRANTS ARE REVOKED EXPLICITLY. `ALTER DEFAULT PRIVILEGES FOR ROLE
-- supabase_admin ... GRANT ALL ON TABLES TO anon, authenticated` is still in
-- effect on this database, so a new table can land with ALL granted to both
-- roles depending on which role creates it. RLS would still stand in the way,
-- but a table whose grants say "anon may DELETE" is one policy mistake from a
-- disaster. Every table below revokes first and grants back the minimum.


-- ─── updated_at ─────────────────────────────────────────────────────────────
-- This database has no generic touch-updated_at trigger; existing code sets
-- `updated_at = now()` by hand inside each SQL function. That works because
-- profiles has exactly two writers. `payments` and `subscriptions` are written
-- from the verify endpoint, the webhook receiver AND the renewal job, so a
-- trigger is the only way the column stays honest.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;


-- ─── payments ───────────────────────────────────────────────────────────────
-- One row per Moyasar payment ATTEMPT, not per successful charge. A declined
-- card gets a row too — "why did this customer's payment not work" is a
-- question the support inbox will ask, and it is unanswerable if only
-- successes are recorded.

CREATE TABLE IF NOT EXISTS public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,

    -- ON DELETE SET NULL, deliberately NOT cascade. A payment is a financial
    -- record: it has to outlive the account it belonged to, for refunds,
    -- reconciliation and ZATCA record-keeping. Same choice payment_events
    -- already made. (payment_tokens below cascades, for the opposite reason.)
    user_id uuid,

    -- Moyasar's `pay_...` id. UNIQUE is the idempotency guarantee this whole
    -- integration rests on: the callback-page verify and the webhook can both
    -- arrive for one payment, in either order, possibly twice, and exactly one
    -- of them can insert. NOT NULL because there is no flow that creates a
    -- payment row before Moyasar has issued an id — the hosted form creates
    -- the payment first, and the renewal job gets the id back from the charge.
    -- (A charge that times out has no id and writes NO row; it is resolved by
    -- re-reading status from Moyasar, never by inserting a placeholder.)
    moyasar_payment_id text NOT NULL,

    type text NOT NULL,

    -- Which pack/plan/addon this was for: 'pro_plan', 'starter_pack',
    -- 'linkedin_premium'. Not a FK — it is a slug from the pricing config in
    -- code (§6), and it must keep meaning what it meant on the day of the
    -- charge even after that config changes.
    reference text NOT NULL,

    amount integer NOT NULL,
    currency text DEFAULT 'SAR'::text NOT NULL,
    status text NOT NULL,

    -- NULL means "credits are not the point of this payment" (the LinkedIn
    -- premium add-on), which is different from 0.
    credits_granted integer,

    -- The full Moyasar payment object, verbatim. When a customer disputes a
    -- charge months later, this is the evidence.
    raw_response jsonb DEFAULT '{}'::jsonb NOT NULL,

    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT payments_pkey PRIMARY KEY (id),
    CONSTRAINT payments_moyasar_payment_id_key UNIQUE (moyasar_payment_id),
    CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT payments_type_check CHECK ((type = ANY (ARRAY[
        'credit_pack'::text,
        'subscription_initial'::text,
        'subscription_renewal'::text,
        'addon'::text
    ]))),
    -- Moyasar's payment statuses, verbatim. Deliberately mirrors their
    -- vocabulary rather than ours: core/payment_gateway.py is the layer that
    -- normalises these onto paid/failed/pending, and a stored status that has
    -- already been translated cannot be re-checked against their API.
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY[
        'initiated'::text,
        'paid'::text,
        'failed'::text,
        'authorized'::text,
        'captured'::text,
        'refunded'::text,
        'voided'::text
    ]))),
    CONSTRAINT payments_amount_positive CHECK ((amount > 0)),
    CONSTRAINT payments_credits_granted_nonneg CHECK (((credits_granted IS NULL) OR (credits_granted >= 0)))
);

COMMENT ON TABLE public.payments IS
    'One row per Moyasar payment attempt, successful or not. amount is an integer of HALALAS (100 = 1.00 SAR), never a float. moyasar_payment_id is UNIQUE — that constraint is what makes the callback-verify and webhook paths safe to run in either order, twice.';
COMMENT ON COLUMN public.payments.user_id IS
    'Nulled rather than cascaded on account deletion: a financial record must outlive the account for refunds and tax record-keeping.';
COMMENT ON COLUMN public.payments.credits_granted IS
    'NULL means credits were not what was bought (e.g. the LinkedIn premium add-on). That is not the same as 0.';
COMMENT ON COLUMN public.payments.raw_response IS
    'The full Moyasar payment object as returned. Audit evidence for disputes; never parsed for business logic — re-fetch from the API for that.';

CREATE INDEX IF NOT EXISTS payments_user_created_idx
    ON public.payments USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_created_idx
    ON public.payments USING btree (status, created_at DESC);
-- Powers the admin payments table (§7) and revenue-by-product reporting.
CREATE INDEX IF NOT EXISTS payments_type_reference_idx
    ON public.payments USING btree (type, reference);

DROP TRIGGER IF EXISTS payments_set_updated_at ON public.payments;
CREATE TRIGGER payments_set_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── payment_tokens ─────────────────────────────────────────────────────────
-- Saved cards, for recurring billing. Holds NO card data — a Moyasar token id
-- plus the four display fields needed to render "Visa •••• 4242" in account
-- settings. A PAN must never reach this database or this backend.

CREATE TABLE IF NOT EXISTS public.payment_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,

    -- ON DELETE CASCADE, the opposite of payments above and for the opposite
    -- reason: a saved card belonging to a deleted account is a data-protection
    -- liability, not a record worth keeping.
    user_id uuid NOT NULL,

    moyasar_token_id text NOT NULL,

    -- Moyasar's token statuses. Only 'active' can be charged; 'initiated'
    -- means created-but-not-yet-usable, and the renewal job must check this
    -- rather than assume a token stored months ago still works.
    status text DEFAULT 'initiated'::text NOT NULL,

    card_brand text,
    card_last_four text,
    -- Kept as text, not integer: Moyasar returns them as strings and a
    -- zero-padded '03' must survive the round trip.
    card_expiry_month text,
    card_expiry_year text,

    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT payment_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT payment_tokens_moyasar_token_id_key UNIQUE (moyasar_token_id),
    CONSTRAINT payment_tokens_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT payment_tokens_status_check CHECK ((status = ANY (ARRAY[
        'active'::text,
        'inactive'::text,
        'initiated'::text
    ]))),
    CONSTRAINT payment_tokens_last_four_check CHECK (
        ((card_last_four IS NULL) OR (card_last_four ~ '^[0-9]{4}$'))
    )
);

COMMENT ON TABLE public.payment_tokens IS
    'Moyasar card tokens for recurring billing. Contains no card number — only a token id and the four fields needed to display the card. Cascades on user deletion, unlike payments.';

CREATE INDEX IF NOT EXISTS payment_tokens_user_idx
    ON public.payment_tokens USING btree (user_id, created_at DESC);

-- At most one default card per user, enforced by the database rather than by
-- remembering to clear the old one in application code.
CREATE UNIQUE INDEX IF NOT EXISTS payment_tokens_one_default_per_user
    ON public.payment_tokens USING btree (user_id) WHERE is_default;


-- ─── subscriptions ──────────────────────────────────────────────────────────
--
-- ⚠️ READ THIS BEFORE USING `plan` FOR ANYTHING.
--
-- A subscriptions table did NOT exist before this migration, but subscription
-- state very much did: it lives on `profiles` (tier, subscription_status,
-- pending_tier, credits_reset_at, payment_provider, payment_customer_id,
-- payment_subscription_id, locked_price, tier_expires_at) and is what
-- core/subscription.py, core/credits.py, core/entitlements.py and
-- reset_credits_if_due() all read.
--
-- So this table does NOT take ownership of "what plan is this user on".
--
--     profiles.tier               = the ENTITLEMENT authority. What the app
--                                   lets the user do. Unchanged.
--     subscriptions.plan/status   = the BILLING record. What we are charging
--                                   for, on what cycle, with which card.
--
-- `plan` is denormalised here on purpose: it records what was being billed at
-- the time, which legitimately differs from profiles.tier during an upgrade or
-- a scheduled downgrade (profiles.pending_tier already models that). Anything
-- deciding what a user may DO must read profiles.tier. Section 5's code is
-- responsible for writing both in one place so they cannot drift.

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,

    plan text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,

    -- SET NULL, not CASCADE: losing the card must not delete the record that
    -- someone has a subscription. A null token on an active row is exactly the
    -- "needs a new card" state dunning has to be able to see.
    payment_token_id uuid,

    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,

    -- NULL once canceled or past the final dunning attempt — nothing further
    -- is scheduled. The renewal job's query is driven off this column.
    next_billing_date timestamp with time zone,

    failed_charge_count integer DEFAULT 0 NOT NULL,
    canceled_at timestamp with time zone,

    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT subscriptions_payment_token_id_fkey FOREIGN KEY (payment_token_id)
        REFERENCES public.payment_tokens(id) ON DELETE SET NULL,
    -- 'free' is accepted so a downgraded row can stay put rather than being
    -- deleted, but the free plan never creates a subscription of its own — it
    -- involves no payment and never touches Moyasar.
    CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY[
        'free'::text, 'pro'::text, 'elite'::text
    ]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY[
        'active'::text, 'past_due'::text, 'canceled'::text
    ]))),
    CONSTRAINT subscriptions_failed_charge_count_nonneg CHECK ((failed_charge_count >= 0)),
    CONSTRAINT subscriptions_period_order CHECK (
        ((current_period_start IS NULL) OR (current_period_end IS NULL)
         OR (current_period_end > current_period_start))
    ),
    -- A canceled row must say when it was canceled. Deliberately a one-way
    -- implication, not an equivalence: it catches the real bug (a canceled
    -- subscription with no timestamp, so nobody can tell when access should
    -- have ended) without forbidding a "cancel at period end" model where
    -- canceled_at is stamped while the row is still active and paid-for.
    CONSTRAINT subscriptions_canceled_at_present CHECK (
        ((status <> 'canceled'::text) OR (canceled_at IS NOT NULL))
    )
);

COMMENT ON TABLE public.subscriptions IS
    'The BILLING record for a paid plan: which card, which cycle, how many failed charges. It does NOT own entitlement — profiles.tier decides what a user may do, and subscriptions.plan records what is being charged for. Section 5 writes both together.';
COMMENT ON COLUMN public.subscriptions.plan IS
    'What is being BILLED. Not the entitlement authority — read profiles.tier for that. The two legitimately differ mid-upgrade and during a scheduled downgrade.';
COMMENT ON COLUMN public.subscriptions.next_billing_date IS
    'Drives the daily renewal job. NULL means nothing further is scheduled (canceled, or dunning exhausted). Advancing this is what makes the job idempotent: an advanced row no longer matches the due query.';

CREATE INDEX IF NOT EXISTS subscriptions_user_idx
    ON public.subscriptions USING btree (user_id, created_at DESC);

-- The renewal job's one hot query: active subscriptions that are due.
CREATE INDEX IF NOT EXISTS subscriptions_due_idx
    ON public.subscriptions USING btree (next_billing_date)
    WHERE ((status = 'active'::text) AND (next_billing_date IS NOT NULL));

-- One live subscription per user. A canceled row is history and may repeat;
-- two simultaneously active ones would mean billing someone twice.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_per_user
    ON public.subscriptions USING btree (user_id)
    WHERE (status <> 'canceled'::text);

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── webhook_events ─────────────────────────────────────────────────────────
--
-- Why this is NOT public.payment_events:
--
-- payment_events is an append-only REVENUE LEDGER — one row per money
-- movement, amount_usd NOT NULL, kind constrained to
-- subscription|pack|refund, and admin_payment_stats() /
-- admin_payment_by_product() SUM(amount_usd) straight off it to draw the
-- admin revenue panel. This table is one row per DELIVERY RECEIVED, most of
-- which move no money at all: failed payments, replays, events for payments
-- that are not ours. Putting those in payment_events would mean inventing an
-- amount_usd for a non-event and corrupting the only revenue figure the admin
-- panel has. Different grain, different lifetime, different consumer.

CREATE TABLE IF NOT EXISTS public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,

    -- Moyasar's own top-level webhook `id`. UNIQUE, and that constraint IS the
    -- idempotency mechanism: the receiver inserts before processing and treats
    -- a unique violation as "already handled, return 200". Confirmed present
    -- in their documented webhook payload (id / type / created_at /
    -- secret_token / account_name / live / data) — §4 verifies this against a
    -- real captured delivery before the receiver is trusted in production.
    moyasar_event_id text NOT NULL,

    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,

    received_at timestamp with time zone DEFAULT now() NOT NULL,

    -- NULL until processing finishes. A row with received_at set and
    -- processed_at NULL is a delivery that arrived and then crashed us — the
    -- single most useful thing to be able to query when billing misbehaves.
    processed_at timestamp with time zone,

    CONSTRAINT webhook_events_pkey PRIMARY KEY (id),
    CONSTRAINT webhook_events_moyasar_event_id_key UNIQUE (moyasar_event_id)
);

COMMENT ON TABLE public.webhook_events IS
    'One row per webhook delivery received from Moyasar, including ones that move no money. The UNIQUE on moyasar_event_id is the idempotency key: insert first, process second, treat a conflict as already-done. Distinct from payment_events, which is a revenue ledger.';
COMMENT ON COLUMN public.webhook_events.processed_at IS
    'NULL means received but not finished processing. received_at set + processed_at NULL = a delivery that crashed mid-handling; query for these first when billing misbehaves.';

CREATE INDEX IF NOT EXISTS webhook_events_received_idx
    ON public.webhook_events USING btree (received_at DESC);
-- Finds deliveries that arrived and never completed.
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx
    ON public.webhook_events USING btree (received_at DESC)
    WHERE (processed_at IS NULL);


-- ─── RLS + GRANTS ───────────────────────────────────────────────────────────
--
-- The rule for all four tables: the backend (service_role, which bypasses RLS)
-- writes; a logged-in user may SELECT their own rows and nothing else; anon
-- gets nothing anywhere. No INSERT/UPDATE/DELETE policy exists for any of
-- these tables, so there is no path by which a browser can write to them even
-- if a grant were mistakenly widened later.

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select_own ON public.payments;
CREATE POLICY payments_select_own ON public.payments
    FOR SELECT USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS payment_tokens_select_own ON public.payment_tokens;
CREATE POLICY payment_tokens_select_own ON public.payment_tokens
    FOR SELECT USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
CREATE POLICY subscriptions_select_own ON public.subscriptions
    FOR SELECT USING ((auth.uid() = user_id));

-- webhook_events gets NO policy at all. RLS is on and nothing is permitted, so
-- it is service_role-only — the same shape payment_events already has. A raw
-- provider payload is not something a customer should be able to read.

REVOKE ALL ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.webhook_events FROM anon, authenticated;

GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.payment_tokens TO authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;

GRANT ALL ON TABLE public.payments TO service_role;
GRANT ALL ON TABLE public.payment_tokens TO service_role;
GRANT ALL ON TABLE public.subscriptions TO service_role;
GRANT ALL ON TABLE public.webhook_events TO service_role;


-- ─── Not done here, on purpose ──────────────────────────────────────────────
--
-- 1. public.payment_events is left exactly as it is. It now overlaps with
--    public.payments, and only one of them should end up being the revenue
--    source. Resolving that means rewriting admin_payment_stats() and
--    admin_payment_by_product(), which is admin-visibility work — §7, not a
--    schema migration. Until then payment_events stays empty and the admin
--    panel keeps reporting `payments_wired: false`.
--
-- 2. No "claimed" column on subscriptions for renewal-job concurrency. The
--    job can take row locks with SELECT ... FOR UPDATE SKIP LOCKED, which
--    needs no schema and cannot leak a stuck flag if a worker dies mid-run.
--    §5 confirms that choice; if it needs a column instead, that is its own
--    migration.
--
-- 3. reset_credits_if_due() is UNCHANGED and still grants a tier's credits
--    every 30 days based only on profiles.credits_reset_at, with no reference
--    to whether anything was ever paid. Harmless today (nobody can pay).
--    Once renewals are live it means a subscriber whose card fails keeps
--    receiving credits until dunning finally downgrades them. Flagged for §5.
