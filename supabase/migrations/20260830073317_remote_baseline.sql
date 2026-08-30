--
-- PostgreSQL database dump
--

\restrict MEZbJSCJZ5BuxwhWCNeKMhNwz1onBMcaaVf9iE2BiX6xwHK73PXJQgcRiyuXPd8

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: subscription_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_tier AS ENUM (
    'free',
    'pro',
    'elite'
);


--
-- Name: admin_cv_counts_by_users(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_cv_counts_by_users(ids uuid[]) RETURNS TABLE(user_id uuid, cv_count bigint, last_generated timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT e.user_id, count(*), max(e.created_at)
  FROM public.cv_generation_events e
  WHERE e.user_id = ANY(ids)
  GROUP BY e.user_id;
$$;


--
-- Name: admin_paid_by_users(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_paid_by_users(ids uuid[]) RETURNS TABLE(user_id uuid, total_paid_usd numeric, payment_count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.user_id,
         COALESCE(SUM(p.amount_usd) FILTER (WHERE p.status = 'paid'), 0),
         count(*) FILTER (WHERE p.status = 'paid')
  FROM public.payment_events p
  WHERE p.user_id = ANY(ids)
  GROUP BY p.user_id;
$$;


--
-- Name: admin_payment_by_product(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_payment_by_product() RETURNS TABLE(kind text, product_slug text, count_ever bigint, count_month bigint, revenue_usd numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    p.kind,
    COALESCE(p.product_slug, 'unknown'),
    count(*),
    count(*) FILTER (WHERE p.created_at >= date_trunc('month', now())),
    COALESCE(SUM(p.amount_usd), 0)
  FROM public.payment_events p
  WHERE p.status = 'paid' AND p.kind <> 'refund'
  GROUP BY p.kind, COALESCE(p.product_slug, 'unknown')
  ORDER BY 1, 2;
$$;


--
-- Name: admin_payment_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_payment_stats() RETURNS TABLE(total_events bigint, revenue_all_time_usd numeric, revenue_this_month_usd numeric, subs_ever bigint, subs_this_month bigint, packs_ever bigint, packs_this_month bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH month_start AS (SELECT date_trunc('month', now()) AS d)
  SELECT
    count(*),
    COALESCE(SUM(amount_usd) FILTER (WHERE status = 'paid'), 0),
    COALESCE(SUM(amount_usd) FILTER (WHERE status = 'paid'
             AND created_at >= (SELECT d FROM month_start)), 0),
    count(*) FILTER (WHERE kind = 'subscription' AND status = 'paid'),
    count(*) FILTER (WHERE kind = 'subscription' AND status = 'paid'
             AND created_at >= (SELECT d FROM month_start)),
    count(*) FILTER (WHERE kind = 'pack' AND status = 'paid'),
    count(*) FILTER (WHERE kind = 'pack' AND status = 'paid'
             AND created_at >= (SELECT d FROM month_start))
  FROM public.payment_events;
$$;


--
-- Name: admin_pipeline_health(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_pipeline_health(days integer DEFAULT 30) RETURNS TABLE(runs bigint, succeeded bigint, failed bigint, hit_max_retries bigint, arabic_runs bigint, arabic_purity_fired bigint, arabic_purity_bad bigint, name_fallback_used bigint, input_tokens bigint, output_tokens bigint, total_calls bigint, avg_tailoring_attempts numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE pipeline_succeeded),
    count(*) FILTER (WHERE pipeline_succeeded IS FALSE),
    count(*) FILTER (WHERE hit_max_retries),
    count(*) FILTER (WHERE cv_language = 'ar'),
    count(*) FILTER (WHERE arabic_purity_pass_fired),
    count(*) FILTER (WHERE arabic_purity_still_bad),
    count(*) FILTER (WHERE name_fallback_used),
    COALESCE(SUM(total_input_tokens), 0),
    COALESCE(SUM(total_output_tokens), 0),
    COALESCE(SUM(total_calls), 0),
    COALESCE(ROUND(AVG(tailoring_attempts)::numeric, 2), 0)
  FROM public.cv_generation_events
  WHERE created_at >= now() - make_interval(days => days);
$$;


--
-- Name: admin_platform_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_platform_stats() RETURNS TABLE(signups_total bigint, signups_month bigint, cvs_total bigint, cvs_month bigint, cvs_ar_total bigint, cvs_en_total bigint, cvs_ar_month bigint, cvs_en_month bigint, cvs_failed_total bigint, founding_members bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  WITH m AS (SELECT date_trunc('month', now()) AS d)
  SELECT
    (SELECT count(*) FROM auth.users),
    (SELECT count(*) FROM auth.users WHERE created_at >= (SELECT d FROM m)),
    (SELECT count(*) FROM public.cv_generation_events),
    (SELECT count(*) FROM public.cv_generation_events WHERE created_at >= (SELECT d FROM m)),
    (SELECT count(*) FROM public.cv_generation_events WHERE cv_language = 'ar'),
    (SELECT count(*) FROM public.cv_generation_events WHERE cv_language <> 'ar'),
    (SELECT count(*) FROM public.cv_generation_events WHERE cv_language = 'ar' AND created_at >= (SELECT d FROM m)),
    (SELECT count(*) FROM public.cv_generation_events WHERE cv_language <> 'ar' AND created_at >= (SELECT d FROM m)),
    (SELECT count(*) FROM public.cv_generation_events WHERE pipeline_succeeded IS FALSE),
    (SELECT count(*) FROM public.profiles WHERE is_founding_member);
$$;


--
-- Name: admin_search_users(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_search_users(term text) RETURNS TABLE(id uuid, email text, name_en text, name_ar text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $_$
  SELECT u.id,
         u.email::text,
         p.name_en,
         p.name_ar
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE
    -- Exact uuid match, so pasting a raw user id still works.
    (term ~ '^[0-9a-fA-F-]{36}$' AND u.id = term::uuid)
    -- Otherwise substring match on email or either name, case-insensitive.
    OR u.email ILIKE '%' || term || '%'
    OR p.name_en ILIKE '%' || term || '%'
    OR p.name_ar ILIKE '%' || term || '%'
  ORDER BY u.created_at DESC
  LIMIT 50;
$_$;


--
-- Name: admin_tier_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_tier_counts() RETURNS TABLE(tier text, current_count bigint, active_count bigint, founding_count bigint, locked_price_total numeric, locked_price_count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    p.tier,
    count(*),
    -- "Active" means actually paying right now. Free is counted as active
    -- because there is no subscription to be in a lapsed state.
    count(*) FILTER (
      WHERE COALESCE(p.subscription_status, '') IN ('active', 'trialing')
         OR p.tier = 'free'
    ),
    count(*) FILTER (WHERE p.is_founding_member),
    -- Only sum locked prices for people who are actually subscribed;
    -- a cancelled founding member contributes nothing this month.
    COALESCE(SUM(
      CASE
        WHEN p.locked_price IS NOT NULL
         AND COALESCE(p.subscription_status, '') IN ('active', 'trialing')
        THEN p.locked_price::numeric
      END
    ), 0),
    count(*) FILTER (
      WHERE p.locked_price IS NOT NULL
        AND COALESCE(p.subscription_status, '') IN ('active', 'trialing')
    )
  FROM public.profiles p
  GROUP BY p.tier
  ORDER BY 1;
$$;


--
-- Name: admin_top_errors(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_top_errors(days integer DEFAULT 30, limit_n integer DEFAULT 10) RETURNS TABLE(error_message text, occurrences bigint, last_seen timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    -- Collapse the variable tail (ids, token counts) so the same failure
    -- groups into one row instead of fragmenting into dozens.
    left(COALESCE(e.error_message, 'unknown'), 120),
    count(*),
    max(e.created_at)
  FROM public.cv_generation_events e
  WHERE e.error_message IS NOT NULL
    AND e.created_at >= now() - make_interval(days => days)
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT limit_n;
$$;


--
-- Name: admin_users_by_ids(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_users_by_ids(ids uuid[]) RETURNS TABLE(id uuid, email text, name_en text, name_ar text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT u.id, u.email::text, p.name_en, p.name_ar
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = ANY(ids);
$$;


--
-- Name: cascade_profile_info_to_resumes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cascade_profile_info_to_resumes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if new.email is distinct from old.email or new.full_name is distinct from old.full_name then
    update public.resumes
    set email = new.email, full_name = new.full_name
    where user_id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: claim_founding_member_slot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_founding_member_slot(p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  existing integer;
  taken    integer;
  slot     integer;
BEGIN
  SELECT founding_member_number INTO existing
  FROM public.profiles WHERE id = p_user_id;

  -- Idempotent: a retried webhook must not consume a second slot.
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  -- Serializes every concurrent claim on one arbitrary but constant key.
  PERFORM pg_advisory_xact_lock(hashtext('founding_member_slot'));

  SELECT count(*) INTO taken FROM public.profiles WHERE is_founding_member;
  IF taken >= 50 THEN
    RETURN NULL;
  END IF;

  slot := taken + 1;
  UPDATE public.profiles
  SET is_founding_member = true,
      founding_member_number = slot
  WHERE id = p_user_id;

  RETURN slot;
END;
$$;


--
-- Name: claim_founding_member_slot(uuid, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_founding_member_slot(p_user_id uuid, p_max_slots integer DEFAULT 50, p_price numeric DEFAULT 10.99) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_next_number int;
begin
  -- Serialize concurrent claims for the duration of this transaction —
  -- without this, two simultaneous signups can both read the same count
  -- before either writes, and both get slot #50.
  perform pg_advisory_xact_lock(hashtext('founding_member_claim'));

  select count(*) + 1 into v_next_number
  from profiles
  where is_founding_member = true;

  if v_next_number > p_max_slots then
    return null; -- offer is full
  end if;

  update profiles
  set is_founding_member = true,
      founding_member_number = v_next_number,
      locked_price = p_price
  where id = p_user_id
    and is_founding_member = false; -- idempotent, no double-claim

  return v_next_number;
end;
$$;


--
-- Name: consume_addon_quota(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_addon_quota(p_user_id uuid, p_addon text, p_limit integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_addon NOT IN ('linkedin_essential', 'interview_prep') THEN
    RAISE EXCEPTION 'Unknown add-on: %', p_addon;
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 THEN
    RETURN FALSE;
  END IF;

  IF p_addon = 'linkedin_essential' THEN
    UPDATE public.profiles
    SET linkedin_essential_used = linkedin_essential_used + 1
    WHERE id = p_user_id AND linkedin_essential_used < p_limit;
  ELSE
    UPDATE public.profiles
    SET interview_prep_used = interview_prep_used + 1
    WHERE id = p_user_id AND interview_prep_used < p_limit;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;


--
-- Name: enforce_resume_retention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_resume_retention() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tier text;
  v_cap  integer;
BEGIN
  SELECT tier INTO v_tier FROM public.profiles WHERE id = NEW.user_id;
  v_tier := COALESCE(v_tier, 'free');

  IF v_tier = 'elite' THEN
    RETURN NEW; -- unlimited
  ELSIF v_tier = 'pro' THEN
    v_cap := 100;
  ELSE
    v_cap := 10;
  END IF;

  UPDATE public.resumes
  SET is_archived = true
  WHERE id IN (
    SELECT id FROM public.resumes
    WHERE user_id = NEW.user_id AND is_archived = false
    ORDER BY created_at DESC
    OFFSET v_cap
  );

  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, tier, credits_remaining, credits_total, location, name_en, name_ar)
  VALUES (
    NEW.id,
    'free',
    3,
    3,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'location', '')), ''),
    NULLIF(trim(COALESCE(
      NEW.raw_user_meta_data->>'name_en',
      -- Google OAuth and legacy signups only ever send full_name; keep it
      -- if it's Latin script.
      CASE WHEN COALESCE(NEW.raw_user_meta_data->>'full_name', '') !~ '[؀-ۿ]'
           THEN NEW.raw_user_meta_data->>'full_name' END,
      ''
    )), ''),
    NULLIF(trim(COALESCE(
      NEW.raw_user_meta_data->>'name_ar',
      CASE WHEN COALESCE(NEW.raw_user_meta_data->>'full_name', '') ~ '[؀-ۿ]'
           THEN NEW.raw_user_meta_data->>'full_name' END,
      ''
    )), '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: refund_credits(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_credits(p_user_id uuid, p_amount integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  update public.profiles
  set credits_remaining = credits_remaining + p_amount,
      updated_at = now()
  where id = p_user_id;
end;
$$;


--
-- Name: release_addon_quota(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_addon_quota(p_user_id uuid, p_addon text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_addon NOT IN ('linkedin_essential', 'interview_prep') THEN
    RAISE EXCEPTION 'Unknown add-on: %', p_addon;
  END IF;

  IF p_addon = 'linkedin_essential' THEN
    UPDATE public.profiles
    SET linkedin_essential_used = GREATEST(linkedin_essential_used - 1, 0)
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET interview_prep_used = GREATEST(interview_prep_used - 1, 0)
    WHERE id = p_user_id;
  END IF;
END;
$$;


--
-- Name: reserve_credits(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_updated integer;
begin
  update public.profiles
  set credits_remaining = credits_remaining - p_amount,
      updated_at = now()
  where id = p_user_id and credits_remaining >= p_amount;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;


--
-- Name: reset_credits_if_due(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_credits_if_due(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_tier subscription_tier;
  v_pending_tier subscription_tier;
  v_reset_at timestamptz;
  v_remaining integer;
  v_new_total integer;
begin
  select tier, pending_tier, credits_reset_at, credits_remaining
    into v_tier, v_pending_tier, v_reset_at, v_remaining
  from public.profiles where id = p_user_id;

  if v_reset_at is null or now() < v_reset_at then
    return;
  end if;

  if v_pending_tier is not null then
    v_new_total := case v_pending_tier
      when 'free' then 3
      when 'pro' then 24
      when 'elite' then 80
    end;

    update public.profiles
    set tier = v_pending_tier,
        pending_tier = null,
        credits_remaining = v_remaining + v_new_total,
        credits_total = v_new_total,
        subscription_status = case when v_pending_tier = 'free' then 'inactive' else subscription_status end,
        credits_reset_at = now() + interval '30 days',
        linkedin_essential_used = 0,
        interview_prep_used = 0,
        updated_at = now()
    where id = p_user_id;
  else
    v_new_total := case v_tier
      when 'free' then 3
      when 'pro' then 24
      when 'elite' then 80
    end;

    update public.profiles
    set credits_remaining = v_new_total,
        credits_total = v_new_total,
        credits_reset_at = now() + interval '30 days',
        linkedin_essential_used = 0,
        interview_prep_used = 0,
        updated_at = now()
    where id = p_user_id;
  end if;
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: set_resume_owner_info(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_resume_owner_info() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  select email, full_name into new.email, new.full_name
  from public.profiles where id = new.user_id;
  return new;
end;
$$;


--
-- Name: sync_credits_on_tier_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_credits_on_tier_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_total integer;
begin
  if new.tier is distinct from old.tier then
    v_total := case new.tier
      when 'free' then 5
      when 'pro' then 40
      when 'elite' then 120
    end;
    new.credits_total := v_total;
    new.credits_remaining := v_total;
    new.credits_reset_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;


--
-- Name: sync_profile_from_auth_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_profile_from_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'auth', 'pg_temp'
    AS $$
begin
  update public.profiles
  set email = new.email,
      full_name = new.raw_user_meta_data ->> 'full_name'
  where id = new.id;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cv_generation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cv_generation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    cv_language text NOT NULL,
    input_mode text,
    tailoring_attempts integer DEFAULT 1 NOT NULL,
    hit_max_retries boolean DEFAULT false NOT NULL,
    arabic_purity_pass_fired boolean DEFAULT false NOT NULL,
    arabic_purity_still_bad boolean DEFAULT false NOT NULL,
    bullets_regenerated_count integer DEFAULT 0 NOT NULL,
    total_input_tokens integer,
    total_output_tokens integer,
    total_calls integer DEFAULT 1 NOT NULL,
    pipeline_succeeded boolean DEFAULT true NOT NULL,
    error_message text,
    name_fallback_used boolean DEFAULT false NOT NULL
);


--
-- Name: interview_preps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interview_preps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resume_id uuid NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    content jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: linkedin_generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linkedin_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid,
    user_id uuid NOT NULL,
    generated_content jsonb,
    status text DEFAULT 'generating'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT linkedin_generations_status_check CHECK ((status = ANY (ARRAY['generating'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: linkedin_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linkedin_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tier text NOT NULL,
    source_cv_id uuid,
    price_paid numeric(10,2) NOT NULL,
    currency text DEFAULT 'SAR'::text NOT NULL,
    payment_status text DEFAULT 'pending'::text NOT NULL,
    payment_reference text,
    payment_provider text,
    paid_at timestamp with time zone,
    contact_phone text,
    contact_consent boolean DEFAULT false NOT NULL,
    fulfillment_status text DEFAULT 'not_required'::text NOT NULL,
    fulfilled_at timestamp with time zone,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT linkedin_purchases_fulfillment_status_check CHECK ((fulfillment_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'in_progress'::text, 'done'::text]))),
    CONSTRAINT linkedin_purchases_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text]))),
    CONSTRAINT linkedin_purchases_price_paid_check CHECK ((price_paid >= (0)::numeric)),
    CONSTRAINT linkedin_purchases_tier_check CHECK ((tier = ANY (ARRAY['normal'::text, 'premium'::text])))
);


--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    kind text NOT NULL,
    product_slug text,
    amount_usd numeric(12,2) NOT NULL,
    credits_granted integer,
    charged_currency text DEFAULT 'USD'::text NOT NULL,
    charged_amount numeric(12,2),
    provider text DEFAULT 'moyasar'::text NOT NULL,
    provider_ref text,
    status text DEFAULT 'paid'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT payment_events_kind_check CHECK ((kind = ANY (ARRAY['subscription'::text, 'pack'::text, 'refund'::text]))),
    CONSTRAINT payment_events_status_check CHECK ((status = ANY (ARRAY['paid'::text, 'pending'::text, 'failed'::text, 'refunded'::text])))
);


--
-- Name: TABLE payment_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_events IS 'Append-only money ledger. One row per charge/refund. Refunds are negative amount_usd so SUM(amount_usd) is net revenue.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    tier public.subscription_tier DEFAULT 'free'::public.subscription_tier NOT NULL,
    credits_remaining integer DEFAULT 5 NOT NULL,
    credits_total integer DEFAULT 5 NOT NULL,
    credits_reset_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    payment_provider text,
    payment_customer_id text,
    payment_subscription_id text,
    subscription_status text DEFAULT 'inactive'::text,
    tier_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    full_name text,
    pending_tier public.subscription_tier,
    is_founding_member boolean DEFAULT false NOT NULL,
    founding_member_number integer,
    locked_price numeric(6,2),
    location text,
    is_admin boolean DEFAULT false NOT NULL,
    name_en text,
    name_ar text,
    is_owner boolean DEFAULT false NOT NULL,
    is_alpha_tester boolean DEFAULT false NOT NULL,
    seen_badges text[] DEFAULT '{}'::text[] NOT NULL,
    linkedin_essential_used integer DEFAULT 0 NOT NULL,
    interview_prep_used integer DEFAULT 0 NOT NULL,
    CONSTRAINT profiles_locked_price_sar_sane CHECK (((locked_price IS NULL) OR (locked_price >= (20)::numeric)))
);


--
-- Name: COLUMN profiles.is_admin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.is_admin IS 'Grants access to /api/v1/admin/* and the Resume Viewer. Checked server-side on every request (core/auth.py::_require_admin). Users have SELECT-only RLS on profiles, so nobody can grant this to themselves.';


--
-- Name: COLUMN profiles.name_en; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.name_en IS 'Candidate name in Latin script, used verbatim on English CVs. Never machine-translated.';


--
-- Name: COLUMN profiles.name_ar; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.name_ar IS 'Candidate name in Arabic script, used verbatim on Arabic CVs. Never machine-translated.';


--
-- Name: COLUMN profiles.is_owner; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.is_owner IS 'Display only: renders the Owner badge. Grants no capability by itself — every privileged route checks is_admin, never this.';


--
-- Name: COLUMN profiles.is_alpha_tester; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.is_alpha_tester IS 'Display only: renders the Alpha Tester badge. Grants no capability.';


--
-- Name: COLUMN profiles.seen_badges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.seen_badges IS 'Badge keys the user has already seen the congratulations popup for. Compared against their currently-earned badges to decide what is new.';


--
-- Name: resumes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resumes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    company text NOT NULL,
    ats_score smallint,
    resume_file_path text,
    cover_letter_file_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cv_language text DEFAULT 'en'::text NOT NULL,
    job_description text,
    ats_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    job_match_score integer DEFAULT 0 NOT NULL,
    job_match_reason text DEFAULT ''::text,
    overall_recommendation text DEFAULT ''::text,
    fact_check_passed boolean DEFAULT false NOT NULL,
    tailored_summary text DEFAULT ''::text,
    tailored_bullets jsonb DEFAULT '[]'::jsonb NOT NULL,
    gap_analysis jsonb DEFAULT '[]'::jsonb NOT NULL,
    similar_jobs jsonb DEFAULT '[]'::jsonb NOT NULL,
    cover_letter_text text DEFAULT ''::text,
    cv_storage_path text,
    cover_letter_storage_path text,
    email text,
    full_name text,
    is_archived boolean DEFAULT false NOT NULL,
    generation_snapshot jsonb,
    CONSTRAINT resumes_ats_score_check CHECK (((ats_score >= 0) AND (ats_score <= 100))),
    CONSTRAINT resumes_cv_language_check CHECK ((cv_language = ANY (ARRAY['en'::text, 'ar'::text])))
);


--
-- Name: cv_generation_events cv_generation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cv_generation_events
    ADD CONSTRAINT cv_generation_events_pkey PRIMARY KEY (id);


--
-- Name: interview_preps interview_preps_one_per_cv; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_preps
    ADD CONSTRAINT interview_preps_one_per_cv UNIQUE (user_id, resume_id);


--
-- Name: interview_preps interview_preps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_preps
    ADD CONSTRAINT interview_preps_pkey PRIMARY KEY (id);


--
-- Name: linkedin_generations linkedin_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin_generations
    ADD CONSTRAINT linkedin_generations_pkey PRIMARY KEY (id);


--
-- Name: linkedin_purchases linkedin_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin_purchases
    ADD CONSTRAINT linkedin_purchases_pkey PRIMARY KEY (id);


--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- Name: payment_events payment_events_provider_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_provider_ref_key UNIQUE (provider_ref);


--
-- Name: profiles profiles_has_a_name; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_has_a_name CHECK ((COALESCE(NULLIF(TRIM(BOTH FROM name_en), ''::text), NULLIF(TRIM(BOTH FROM name_ar), ''::text)) IS NOT NULL)) NOT VALID;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: resumes resumes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resumes
    ADD CONSTRAINT resumes_pkey PRIMARY KEY (id);


--
-- Name: idx_cv_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cv_events_created_at ON public.cv_generation_events USING btree (created_at);


--
-- Name: idx_cv_events_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cv_events_language ON public.cv_generation_events USING btree (cv_language);


--
-- Name: idx_resumes_user_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resumes_user_id_created_at ON public.resumes USING btree (user_id, created_at DESC);


--
-- Name: interview_preps_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interview_preps_user_idx ON public.interview_preps USING btree (user_id, updated_at DESC);


--
-- Name: linkedin_generations_one_per_purchase; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX linkedin_generations_one_per_purchase ON public.linkedin_generations USING btree (purchase_id) WHERE (status <> 'failed'::text);


--
-- Name: linkedin_generations_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX linkedin_generations_user_created_idx ON public.linkedin_generations USING btree (user_id, created_at DESC);


--
-- Name: linkedin_purchases_fulfillment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX linkedin_purchases_fulfillment_idx ON public.linkedin_purchases USING btree (fulfillment_status, created_at DESC) WHERE (fulfillment_status = ANY (ARRAY['pending'::text, 'in_progress'::text]));


--
-- Name: linkedin_purchases_payment_reference_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX linkedin_purchases_payment_reference_key ON public.linkedin_purchases USING btree (payment_reference) WHERE (payment_reference IS NOT NULL);


--
-- Name: linkedin_purchases_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX linkedin_purchases_user_created_idx ON public.linkedin_purchases USING btree (user_id, created_at DESC);


--
-- Name: payment_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_events_created_at_idx ON public.payment_events USING btree (created_at DESC);


--
-- Name: payment_events_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_events_kind_idx ON public.payment_events USING btree (kind, product_slug);


--
-- Name: payment_events_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_events_user_id_idx ON public.payment_events USING btree (user_id);


--
-- Name: resumes_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resumes_user_id_created_at_idx ON public.resumes USING btree (user_id, created_at DESC);


--
-- Name: resumes_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resumes_user_id_idx ON public.resumes USING btree (user_id);


--
-- Name: profiles on_profile_info_change_cascade_resumes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_profile_info_change_cascade_resumes AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.cascade_profile_info_to_resumes();


--
-- Name: profiles on_profile_tier_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_profile_tier_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_credits_on_tier_change();


--
-- Name: resumes on_resume_insert_set_owner_info; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_resume_insert_set_owner_info BEFORE INSERT ON public.resumes FOR EACH ROW EXECUTE FUNCTION public.set_resume_owner_info();


--
-- Name: resumes trg_enforce_resume_retention; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_resume_retention AFTER INSERT ON public.resumes FOR EACH ROW EXECUTE FUNCTION public.enforce_resume_retention();


--
-- Name: interview_preps interview_preps_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_preps
    ADD CONSTRAINT interview_preps_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;


--
-- Name: interview_preps interview_preps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_preps
    ADD CONSTRAINT interview_preps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: linkedin_generations linkedin_generations_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin_generations
    ADD CONSTRAINT linkedin_generations_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.linkedin_purchases(id) ON DELETE CASCADE;


--
-- Name: linkedin_generations linkedin_generations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin_generations
    ADD CONSTRAINT linkedin_generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: linkedin_purchases linkedin_purchases_source_cv_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin_purchases
    ADD CONSTRAINT linkedin_purchases_source_cv_id_fkey FOREIGN KEY (source_cv_id) REFERENCES public.resumes(id) ON DELETE SET NULL;


--
-- Name: linkedin_purchases linkedin_purchases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin_purchases
    ADD CONSTRAINT linkedin_purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: payment_events payment_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: resumes resumes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resumes
    ADD CONSTRAINT resumes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: resumes Users can delete their own resumes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own resumes" ON public.resumes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: resumes Users can insert their own resumes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own resumes" ON public.resumes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: resumes Users can update their own resumes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own resumes" ON public.resumes FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: resumes Users can view their own resumes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own resumes" ON public.resumes FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: cv_generation_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cv_generation_events ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_preps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interview_preps ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_preps interview_preps_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY interview_preps_select_own ON public.interview_preps FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: linkedin_generations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.linkedin_generations ENABLE ROW LEVEL SECURITY;

--
-- Name: linkedin_generations linkedin_generations_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linkedin_generations_select_own ON public.linkedin_generations FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: linkedin_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.linkedin_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: linkedin_purchases linkedin_purchases_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linkedin_purchases_select_own ON public.linkedin_purchases FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: resumes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

--
-- Name: resumes resumes_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_delete_own ON public.resumes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: resumes resumes_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_insert_own ON public.resumes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: resumes resumes_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_select_own ON public.resumes FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: resumes resumes_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resumes_update_own ON public.resumes FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: cv_generation_events service_role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_role full access" ON public.cv_generation_events TO service_role USING (true) WITH CHECK (true);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION admin_cv_counts_by_users(ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_cv_counts_by_users(ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_cv_counts_by_users(ids uuid[]) TO service_role;


--
-- Name: FUNCTION admin_paid_by_users(ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_paid_by_users(ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_paid_by_users(ids uuid[]) TO service_role;


--
-- Name: FUNCTION admin_payment_by_product(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_payment_by_product() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_payment_by_product() TO service_role;


--
-- Name: FUNCTION admin_payment_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_payment_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_payment_stats() TO service_role;


--
-- Name: FUNCTION admin_pipeline_health(days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_pipeline_health(days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_pipeline_health(days integer) TO service_role;


--
-- Name: FUNCTION admin_platform_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_platform_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_platform_stats() TO service_role;


--
-- Name: FUNCTION admin_search_users(term text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_search_users(term text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_search_users(term text) TO service_role;


--
-- Name: FUNCTION admin_tier_counts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_tier_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_tier_counts() TO service_role;


--
-- Name: FUNCTION admin_top_errors(days integer, limit_n integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_top_errors(days integer, limit_n integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_top_errors(days integer, limit_n integer) TO service_role;


--
-- Name: FUNCTION admin_users_by_ids(ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_users_by_ids(ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_users_by_ids(ids uuid[]) TO service_role;


--
-- Name: FUNCTION cascade_profile_info_to_resumes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cascade_profile_info_to_resumes() FROM PUBLIC;


--
-- Name: FUNCTION claim_founding_member_slot(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_founding_member_slot(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_founding_member_slot(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION claim_founding_member_slot(p_user_id uuid, p_max_slots integer, p_price numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_founding_member_slot(p_user_id uuid, p_max_slots integer, p_price numeric) FROM PUBLIC;


--
-- Name: FUNCTION consume_addon_quota(p_user_id uuid, p_addon text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.consume_addon_quota(p_user_id uuid, p_addon text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.consume_addon_quota(p_user_id uuid, p_addon text, p_limit integer) TO service_role;


--
-- Name: FUNCTION enforce_resume_retention(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_resume_retention() FROM PUBLIC;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;


--
-- Name: FUNCTION refund_credits(p_user_id uuid, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refund_credits(p_user_id uuid, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refund_credits(p_user_id uuid, p_amount integer) TO service_role;


--
-- Name: FUNCTION release_addon_quota(p_user_id uuid, p_addon text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_addon_quota(p_user_id uuid, p_addon text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_addon_quota(p_user_id uuid, p_addon text) TO service_role;


--
-- Name: FUNCTION reserve_credits(p_user_id uuid, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer) TO service_role;


--
-- Name: FUNCTION reset_credits_if_due(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reset_credits_if_due(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_credits_if_due(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;


--
-- Name: FUNCTION set_resume_owner_info(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_resume_owner_info() FROM PUBLIC;


--
-- Name: FUNCTION sync_credits_on_tier_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_credits_on_tier_change() FROM PUBLIC;


--
-- Name: FUNCTION sync_profile_from_auth_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_profile_from_auth_user() FROM PUBLIC;


--
-- Name: TABLE cv_generation_events; Type: ACL; Schema: public; Owner: -
--

GRANT TRIGGER,MAINTAIN ON TABLE public.cv_generation_events TO anon;
GRANT TRIGGER,MAINTAIN ON TABLE public.cv_generation_events TO authenticated;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.cv_generation_events TO service_role;


--
-- Name: TABLE interview_preps; Type: ACL; Schema: public; Owner: -
--

GRANT TRIGGER,MAINTAIN ON TABLE public.interview_preps TO anon;
GRANT TRIGGER,MAINTAIN ON TABLE public.interview_preps TO authenticated;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.interview_preps TO service_role;


--
-- Name: TABLE linkedin_generations; Type: ACL; Schema: public; Owner: -
--

GRANT TRIGGER,MAINTAIN ON TABLE public.linkedin_generations TO anon;
GRANT SELECT,TRIGGER,MAINTAIN ON TABLE public.linkedin_generations TO authenticated;
GRANT ALL ON TABLE public.linkedin_generations TO service_role;


--
-- Name: TABLE linkedin_purchases; Type: ACL; Schema: public; Owner: -
--

GRANT TRIGGER,MAINTAIN ON TABLE public.linkedin_purchases TO anon;
GRANT SELECT,TRIGGER,MAINTAIN ON TABLE public.linkedin_purchases TO authenticated;
GRANT ALL ON TABLE public.linkedin_purchases TO service_role;


--
-- Name: TABLE payment_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.payment_events TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT TRIGGER,MAINTAIN ON TABLE public.profiles TO anon;
GRANT SELECT,TRIGGER,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE resumes; Type: ACL; Schema: public; Owner: -
--

GRANT TRIGGER,MAINTAIN ON TABLE public.resumes TO anon;
GRANT SELECT,INSERT,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.resumes TO authenticated;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.resumes TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict MEZbJSCJZ5BuxwhWCNeKMhNwz1onBMcaaVf9iE2BiX6xwHK73PXJQgcRiyuXPd8

