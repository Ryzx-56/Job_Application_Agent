-- Subscriptions that cannot renew, and how to repair them.
--
-- ─── WHAT HAPPENED ──────────────────────────────────────────────────────────
--
-- core/billing.py::_upsert_token caught every exception, logged, and returned
-- None. start_subscription never checked the return value, so the row was
-- written with payment_token_id NULL. The customer paid, the plan looked
-- active, and at renewal the job finds no card and the subscription lapses
-- with nothing to explain it.
--
-- The code is fixed (it now retries once and then refuses outright), but a
-- fix does not repair rows already written. This finds them.

-- ── 1. THE AFFECTED LIST ────────────────────────────────────────────────────
-- Any live subscription with no card attached. Every row here WILL lapse at
-- next_billing_date unless repaired.
select s.id             as subscription_id,
       s.user_id,
       s.plan,
       s.status,
       s.current_period_end,
       s.next_billing_date,
       s.payment_token_id,
       -- Is there a usable card sitting in payment_tokens that the
       -- subscription simply was not linked to? If so the repair is a
       -- one-line UPDATE rather than asking the customer to re-enter a card.
       (select t.id
          from public.payment_tokens t
         where t.user_id = s.user_id
           and coalesce(t.status, 'active') = 'active'
         order by t.is_default desc nulls last, t.created_at desc
         limit 1)      as recoverable_token_id
from public.subscriptions s
where s.payment_token_id is null
  and s.status in ('active', 'past_due')
order by s.next_billing_date;


-- ── 2. HOW URGENT ───────────────────────────────────────────────────────────
-- Days until each affected subscription tries, and fails, to renew.
select s.user_id,
       s.plan,
       s.next_billing_date::date                                as renews_on,
       (s.next_billing_date::date - current_date)               as days_left
from public.subscriptions s
where s.payment_token_id is null
  and s.status in ('active','past_due')
order by days_left;


-- ── 3. THE REPAIR, WHERE A CARD EXISTS ──────────────────────────────────────
-- Run ONLY after reading query 1. If recoverable_token_id was non-null, the
-- card was tokenized and stored and only the link was lost — this restores it.
--
-- Commented out deliberately: this writes to a billing table on a database
-- with live subscribers. Read the output of query 1 first, then uncomment.
--
-- update public.subscriptions s
--    set payment_token_id = t.id,
--        updated_at       = now()
--   from public.payment_tokens t
--  where s.payment_token_id is null
--    and s.status in ('active','past_due')
--    and t.user_id = s.user_id
--    and coalesce(t.status,'active') = 'active';


-- ── 4. WHERE NO CARD EXISTS ─────────────────────────────────────────────────
-- If recoverable_token_id was NULL, the token was never stored at all and
-- there is nothing in the database to relink. Moyasar still holds the token —
-- it is on the original payment object. Recover it with:
--
--   GET https://api.moyasar.com/v1/payments/<moyasar_payment_id>
--       -> source.token
--
-- Find the payment for that user and plan:
select p.moyasar_payment_id,
       p.user_id,
       p.reference,
       p.amount / 100.0 as sar,
       p.status,
       p.created_at
from public.payments p
where p.type = 'subscription_initial'
  and p.status = 'paid'
  and p.user_id in (
        select user_id from public.subscriptions
         where payment_token_id is null and status in ('active','past_due'))
order by p.created_at desc;

-- Then insert the token and link it:
--
--   insert into public.payment_tokens
--     (user_id, moyasar_token_id, status, card_brand, card_last_four,
--      card_expiry_month, card_expiry_year, is_default)
--   values ('<user_id>', '<source.token>', 'active', '<brand>', '<last4>',
--           '<mm>', '<yyyy>', true);
--
--   update public.subscriptions
--      set payment_token_id = (select id from public.payment_tokens
--                               where moyasar_token_id = '<source.token>')
--    where user_id = '<user_id>' and payment_token_id is null;


-- ── 5. A GUARD, SO THIS CANNOT SILENTLY RECUR ───────────────────────────────
-- Optional but recommended. The code now refuses to create such a row, so
-- this should never fire — which is exactly what makes it cheap to keep.
--
-- NOT added as a migration, because it would fail immediately on any existing
-- affected row. Add it AFTER the repair above:
--
--   alter table public.subscriptions
--     add constraint subscriptions_active_needs_card
--     check (status not in ('active','past_due') or payment_token_id is not null)
--     not valid;
--   alter table public.subscriptions validate constraint subscriptions_active_needs_card;


-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING THE AFFECTED USERS IN RENDER'S LOGS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The old success line rendered placeholders that ONLY appear when the token
-- store returned None:
--
--   🎟️ Subscription started for <user_id>: pro until 2026-10-10, card ? ••••????
--
-- `card ? ••••????` is therefore a historical record of every time this fired
-- and for whom. The string has been removed from the code, so it can only ever
-- refer to the broken period.
--
-- In Render → your service → Logs, search for:
--
--     ••••????
--
-- or, if the log search does not handle the bullet characters well:
--
--     card ? ••••
--     Subscription started
--
-- Every hit carries the user_id immediately after "Subscription started for".
-- That is the affected list, and it is authoritative in a way the database is
-- not — a row repaired by hand later would no longer show a NULL, but the log
-- line stays.
--
-- Also worth searching, from the same period:
--
--     Could not store card token
--
-- which was the ERROR line logged just before the placeholder success line.
-- If that string appears and `••••????` does not, the store failed on a path
-- other than start_subscription.
