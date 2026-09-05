-- Account deletion, and the two things that make free credits survive it.
--
-- ─── THE PROBLEM ────────────────────────────────────────────────────────────
--
-- Signup grants 3 free credits (handle_new_user). Deleting an account and
-- signing up again therefore mints 3 more, forever, and so does
-- user+1@gmail.com, user+2@gmail.com, u.ser@gmail.com — Gmail delivers all of
-- them to one inbox but they are distinct strings, so they were distinct
-- accounts. One real inbox could farm unlimited free CV generations.
--
-- ─── WHAT THIS DOES ─────────────────────────────────────────────────────────
--
-- Records a HASH of the NORMALIZED email of every account that has ever been
-- granted the free starting credits, and refuses to grant them twice to the
-- same normalized identity. The ledger has no foreign key to auth.users, so
-- it OUTLIVES deletion — that is the entire point.
--
-- A LEDGER OF GRANTS, NOT A GRAVEYARD OF DELETIONS. A tombstone written only
-- when an account is deleted would stop delete-and-recreate and do nothing at
-- all about aliasing, because +1 and +2 coexist and neither is ever deleted.
-- One row per normalized identity, written at signup, covers both.
--
-- ─── WHY HMAC AND NOT A PLAIN HASH ──────────────────────────────────────────
--
-- An email address has almost no entropy. sha256('someone@gmail.com') is
-- reversible by anyone with a word list, so a table of plain hashes is a table
-- of email addresses wearing a hat — it would leak every address that ever
-- signed up, including the deleted ones we promised to erase. HMAC with a
-- server-side pepper that never leaves the database makes the ledger useless
-- to anyone who exfiltrates it without also taking the pepper.
--
-- The pepper is generated HERE, by the database, on first run. It is never in
-- this file, never in git, and never sent to the application.
--
-- ─── WHAT IS DELIBERATELY NOT DONE ──────────────────────────────────────────
--
-- Resignup is ALLOWED, with zero starting credits, rather than blocked. See
-- the note on the migration's companion endpoint in backend/core/account.py.

-- Wrapped in an explicit transaction where the other migrations are not.
-- `set local` below is only honoured inside one, and a session-level
-- search_path would leak into whatever migration ran next. If the CLI has
-- already opened a transaction this begin is a no-op warning and the commit
-- at the end lands where the CLI's would have.
begin;

-- hmac() and gen_random_bytes() both come from pgcrypto. Supabase keeps it in
-- `extensions`; a plain Postgres may have it in `public`. Putting both on the
-- path means this resolves either way rather than depending on which.
set local search_path = public, extensions, pg_temp;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ─── the pepper ─────────────────────────────────────────────────────────────
-- Own schema, not exposed through PostgREST (only public/graphql_public are),
-- and readable by nothing that is not SECURITY DEFINER.

create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.identity_secret (
    id          integer primary key generated always as identity,
    pepper      bytea   not null,
    created_at  timestamptz not null default now(),
    -- One row, forever. Regenerating the pepper would orphan every hash in
    -- the ledger and silently re-grant free credits to everyone who had
    -- already had them.
    constraint identity_secret_singleton check (id = 1)
);

insert into private.identity_secret (pepper)
select gen_random_bytes(32)
where not exists (select 1 from private.identity_secret);

revoke all on private.identity_secret from anon, authenticated;
alter table private.identity_secret enable row level security;
-- No policies: RLS with zero policies denies everyone. SECURITY DEFINER
-- functions owned by the table owner bypass it, which is the only intended
-- access path.


-- ─── normalization ──────────────────────────────────────────────────────────
--
-- FRAUD CHECKS ONLY. Nothing here touches how anyone signs in or where mail is
-- delivered — auth.users.email keeps the address exactly as typed, and Supabase
-- authenticates and delivers against that. This function's output is never
-- stored in plaintext and never shown to anyone.
--
--   Case          Everything lowercased.
--   +tag          Dropped for every domain. Universally an alias convention.
--   dots          Dropped for gmail.com / googlemail.com ONLY, because those
--                 are the domains where dots are genuinely not significant.
--                 Stripping them everywhere would merge unrelated people:
--                 firstname.lastname@company.com is a different human from
--                 firstnamelastname@company.com at most mail hosts.
--   googlemail    Folded to gmail.com — same inbox, two spellings.

create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
    with parsed as (
        select
            split_part(lower(trim(p_email)), '@', 1) as local_part,
            split_part(lower(trim(p_email)), '@', 2) as domain
        where p_email is not null
          and position('@' in trim(p_email)) > 1
    ),
    folded as (
        select
            -- Strip the +tag first, then the dots, so "u.ser+x@gmail.com"
            -- and "user@gmail.com" land on the same string.
            split_part(local_part, '+', 1) as local_part,
            case when domain = 'googlemail.com' then 'gmail.com' else domain end as domain
        from parsed
    )
    select case
             when domain in ('gmail.com')
               then replace(local_part, '.', '')
             else local_part
           end || '@' || domain
    from folded
    where local_part <> '' and domain <> '';
$$;

comment on function public.normalize_email(text) is
'Collapses email aliases to one identity for abuse checks ONLY. Never used for authentication or mail delivery.';


-- ─── the hash ───────────────────────────────────────────────────────────────

create or replace function private.identity_hash(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, private, pg_temp
as $$
declare
    v_norm   text;
    v_pepper bytea;
begin
    v_norm := public.normalize_email(p_email);
    if v_norm is null then
        return null;
    end if;

    select pepper into v_pepper from private.identity_secret where id = 1;
    if v_pepper is null then
        -- No pepper means the migration did not complete. Refuse rather than
        -- fall back to an unpeppered hash, which would be the leaky thing
        -- this design exists to avoid. The caller fails open.
        raise exception 'identity pepper is missing';
    end if;

    -- convert_to(), NOT the bare text. pgcrypto declares exactly two hmac
    -- overloads -- hmac(text, text, text) and hmac(bytea, bytea, text) --
    -- and no mixed one. Passing a text message with a bytea key matches
    -- neither and fails at RUNTIME, inside this function, with
    -- "function hmac(text, bytea, unknown) does not exist". The pepper is
    -- bytea because that is what gen_random_bytes() returns, so the message
    -- is the side that has to be converted.
    return encode(hmac(convert_to(v_norm, 'utf8'), v_pepper, 'sha256'), 'hex');
end;
$$;

revoke all on function private.identity_hash(text) from anon, authenticated;


-- ─── the ledger ─────────────────────────────────────────────────────────────
--
-- NO user_id, NO plaintext address, NO foreign key. It has to survive the
-- deletion of everything it refers to, and it must not become a second copy
-- of the user table.

create table if not exists public.free_grant_ledger (
    email_hash    text primary key,
    first_seen_at timestamptz not null default now(),
    last_seen_at  timestamptz not null default now(),
    -- 1 on a first signup; 2+ means this inbox has been here before, whether
    -- by deleting and returning or by using a +tag.
    signup_count  integer not null default 1
);

comment on table public.free_grant_ledger is
'One row per normalized email identity that has been granted the free starting credits. Survives account deletion by design — it is what stops delete-and-recreate credit farming. Contains no plaintext address and no user id.';

alter table public.free_grant_ledger enable row level security;
-- Again: no policies, so no client role can read or write it. Only the
-- SECURITY DEFINER signup trigger touches this table.
revoke all on table public.free_grant_ledger from anon, authenticated;


-- ─── backfill ───────────────────────────────────────────────────────────────
--
-- WITHOUT THIS THE FIX PROTECTS NOBODY WHO ALREADY EXISTS. Every current
-- account has already had its free credits; if their identity is not in the
-- ledger, the first thing any of them can do is delete and collect again.
-- Existing aliases are folded together here too, which is why signup_count is
-- a sum rather than a constant.

insert into public.free_grant_ledger (email_hash, first_seen_at, last_seen_at, signup_count)
select
    private.identity_hash(u.email),
    min(u.created_at),
    max(u.created_at),
    count(*)
from auth.users u
where u.email is not null
  and private.identity_hash(u.email) is not null
group by private.identity_hash(u.email)
on conflict (email_hash) do nothing;


-- ─── signup ─────────────────────────────────────────────────────────────────
--
-- Same function as before in every respect except the credit figure: the
-- profile row, the name-script split and the location all behave identically.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, private, pg_temp
as $$
declare
    v_hash        text;
    v_seen_before boolean := false;
    -- Must match the free allowance in reset_credits_if_due(),
    -- sync_credits_on_tier_change() and core/credits.py TIER_CREDITS.
    v_allowance   constant integer := 3;
    v_grant       integer;
begin
    v_grant := v_allowance;

    begin
        v_hash := private.identity_hash(new.email);

        if v_hash is not null then
            insert into public.free_grant_ledger as l (email_hash)
            values (v_hash)
            on conflict (email_hash) do update
                set signup_count = l.signup_count + 1,
                    last_seen_at = now()
            returning l.signup_count > 1 into v_seen_before;

            if v_seen_before then
                -- A RETURNING IDENTITY, NOT A NEW ONE. Not blocked, and not
                -- punished beyond this: they simply start where an existing
                -- free user who has spent their allowance stands. The normal
                -- 30-day refill in reset_credits_if_due() still reaches them,
                -- so deleting and returning gains exactly nothing instead of
                -- gaining three credits a minute.
                v_grant := 0;
            end if;
        end if;
    exception when others then
        -- FAIL OPEN. If the ledger is unreachable the choice is between
        -- handing out 3 credits we might not owe and refusing to let a real
        -- person finish signing up. Three credits is the cheaper mistake.
        raise warning 'free_grant_ledger check failed for %: %', new.id, sqlerrm;
        v_grant := v_allowance;
    end;

    insert into public.profiles (id, tier, credits_remaining, credits_total, location, name_en, name_ar)
    values (
        new.id,
        'free',
        v_grant,
        -- credits_total stays at the allowance even when the grant is zero:
        -- it describes what a free month is worth, and the reset that arrives
        -- in 30 days reads it. A returning identity shows 0 of 3, which is
        -- true, rather than 0 of 0, which would look broken.
        v_allowance,
        nullif(trim(coalesce(new.raw_user_meta_data->>'location', '')), ''),
        nullif(trim(coalesce(
            new.raw_user_meta_data->>'name_en',
            case when coalesce(new.raw_user_meta_data->>'full_name', '') !~ '[؀-ۿ]'
                 then new.raw_user_meta_data->>'full_name' end,
            ''
        )), ''),
        nullif(trim(coalesce(
            new.raw_user_meta_data->>'name_ar',
            case when coalesce(new.raw_user_meta_data->>'full_name', '') ~ '[؀-ۿ]'
                 then new.raw_user_meta_data->>'full_name' end,
            ''
        )), '')
    )
    on conflict (id) do nothing;

    return new;
end;
$$;


-- ─── payments keep their money, lose their person ───────────────────────────
--
-- payments.user_id is already ON DELETE SET NULL rather than CASCADE, so the
-- financial record survives on its own. What it does not survive is being
-- ATTRIBUTABLE: once user_id is null, three charges from one former customer
-- are indistinguishable from three charges by three strangers, and a refund
-- or a chargeback months later cannot be tied back to the rest of their
-- history. former_user_id keeps that grouping with a value that no longer
-- points at anything and cannot be resolved to a person through our data.

alter table public.payments
    add column if not exists former_user_id uuid,
    add column if not exists anonymized_at timestamptz;

comment on column public.payments.former_user_id is
'The user_id this payment belonged to before the account was deleted. Opaque: no foreign key, and the auth row it names no longer exists. Kept so a deleted customer''s charges can still be reconciled and refunded as a set.';

create index if not exists payments_former_user_id_idx
    on public.payments (former_user_id)
    where former_user_id is not null;


-- ─── the purge ──────────────────────────────────────────────────────────────
--
-- Everything that must happen inside ONE transaction, before the auth row is
-- deleted. Deleting auth.users cascades profiles, resumes, interview_preps,
-- linkedin_generations, linkedin_purchases, payment_tokens and subscriptions
-- on its own; this is the work that cascade would get WRONG.

create or replace function public.purge_account_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_subs     integer := 0;
    v_payments integer := 0;
    v_events   integer := 0;
begin
    if p_user_id is null then
        raise exception 'purge_account_data requires a user id';
    end if;

    -- 1. STOP THE MONEY FIRST, for the same reason cancel_subscription() does:
    --    of all the ways this can half-finish, still charging the card of an
    --    account we told someone we deleted is the worst one available.
    --    The cascade would delete these rows anyway — doing it explicitly and
    --    first means billing is already stopped even if a later step fails.
    update public.subscriptions
       set status = 'canceled',
           canceled_at = now(),
           next_billing_date = null
     where user_id = p_user_id
       and status <> 'canceled';
    get diagnostics v_subs = row_count;

    -- 2. Detach the payments and strip the person out of the stored gateway
    --    response. raw_response is Moyasar's payment object verbatim, which
    --    carries the CARDHOLDER NAME — deleting the account while leaving
    --    that behind would make the erasure a fiction. The financial fields
    --    (amount, currency, status, fee, gateway ids, timestamps) are
    --    untouched, so the row is still evidence in a dispute.
    update public.payments
       set former_user_id = coalesce(former_user_id, user_id),
           user_id = null,
           anonymized_at = now(),
           raw_response = (raw_response #- '{source,name}'
                                        #- '{source,email}'
                                        #- '{source,message}'
                                        #- '{metadata,email}'
                                        #- '{email}')
     where user_id = p_user_id;
    get diagnostics v_payments = row_count;

    -- 3. Product telemetry has no foreign key, so nothing would clean it up.
    --    The rows are worth keeping — they are how the Arabic pipeline's
    --    quality is measured — but they do not need to say who.
    update public.cv_generation_events
       set user_id = null
     where user_id = p_user_id;
    get diagnostics v_events = row_count;

    return jsonb_build_object(
        'subscriptions_canceled', v_subs,
        'payments_anonymized', v_payments,
        'events_detached', v_events
    );
end;
$$;

revoke all on function public.purge_account_data(uuid) from anon, authenticated;

commit;
