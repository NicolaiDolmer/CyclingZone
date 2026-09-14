-- #5215 — compute_daily_growth_snapshot(): LTV-CASE'en skifter fra inkl. moms
-- (4900/26500 øre) til EKSKL. moms (3920/21200 øre), så LTV taler samme sprog
-- som MRR/ARPU (Alunta, ekskl. moms — se docs/GROWTH_STACK.md).
--
-- Ejer-beslutning 14/9 (ved merge af PR #5210), ordret: "de priser spillerne
-- ser skal være inkl moms. Det er de ting jeg ser, som skal være ekskl moms."
-- Dvs. /pro, checkout og pro.json forbliver UÆNDREDE (inkl. moms); LTV/MRR/
-- ARPU/snapshots er nu alle ekskl. moms. Tallene matcher
-- backend/scripts/lib/aluntaPlanCatalog.js's rå `amount`-felt og
-- backend/lib/growthSnapshot.js's PLAN_PRICE_CENTS (samme PR).
--
-- Historik: 2026-08-03-growth-snapshots-3196.sql og
-- 2026-09-02-growth-snapshot-paying-only-4636.sql brugte 4900/26500 (inkl.
-- moms — dengang korrekt definition, se #5051/#5210's forward-guard-historik
-- i scripts/check-pro-prices.mjs). growth_metric_snapshots-rækker skrevet FØR
-- denne migration er derfor inkl. moms; INGEN BACKFILL — knækket i LTV-kurven
-- omkring denne dato er forventet og dokumenteret her, ikke en bug.
--
-- Alt andet i funktionen er uændret fra 2026-09-02-growth-snapshot-paying-
-- only-4636.sql (DAU/WAU/MAU, retention, paying_customers-definition, NPS,
-- upsert). CREATE OR REPLACE = idempotent. RLS-gate uændret: service_role-only.
--
-- Rollback: kør 2026-09-02-growth-snapshot-paying-only-4636.sql igen (samme
-- CREATE OR REPLACE, sætter LTV-CASE'en tilbage til 4900/26500). Husk at revert
-- backend/lib/growthSnapshot.js's PLAN_PRICE_CENTS samtidig, ellers driver
-- API-svaret (JS) og snapshot-tabellen (SQL) fra hinanden igen.

CREATE OR REPLACE FUNCTION public.compute_daily_growth_snapshot(p_snapshot_date date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asof                 timestamptz := (p_snapshot_date + 1)::timestamptz; -- eksklusiv øvre grænse = start af DAGEN EFTER (UTC)
  v_dau int; v_wau int; v_mau int; v_total_registered int;
  v_d1_eligible int; v_d1_returning int;
  v_d7_eligible int; v_d7_returning int;
  v_d30_eligible int; v_d30_returning int;
  v_active_subs int; v_paying_customers int;
  v_ltv_total numeric; v_ltv_avg numeric;
  v_nps_count int; v_nps_promoters int; v_nps_passives int; v_nps_detractors int; v_nps_score numeric;
  v_result jsonb;
BEGIN
  IF NOT (auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ── DAU/WAU/MAU (union last_seen + player_events, se backfill-note i 3196-filen) ──
  WITH active_1d AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_asof - interval '1 day' AND last_seen < v_asof
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_asof - interval '1 day' AND created_at < v_asof
  )
  SELECT count(*) INTO v_dau FROM active_1d;

  WITH active_7d AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_asof - interval '7 days' AND last_seen < v_asof
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_asof - interval '7 days' AND created_at < v_asof
  )
  SELECT count(*) INTO v_wau FROM active_7d;

  WITH active_30d AS (
    SELECT id AS user_id FROM public.users WHERE last_seen >= v_asof - interval '30 days' AND last_seen < v_asof
    UNION
    SELECT user_id FROM public.player_events WHERE created_at >= v_asof - interval '30 days' AND created_at < v_asof
  )
  SELECT count(*) INTO v_mau FROM active_30d;

  SELECT count(*) INTO v_total_registered FROM auth.users WHERE created_at < v_asof;

  -- ── D1/D7/D30 rullende retention (samme model som get_sprint_metrics' D7) ──
  SELECT count(*) INTO v_d1_eligible FROM auth.users WHERE created_at <= v_asof - interval '1 day';
  SELECT count(*) INTO v_d1_returning
  FROM auth.users au
  WHERE au.created_at <= v_asof - interval '1 day'
    AND (
      EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id AND pu.last_seen >= au.created_at + interval '1 day' AND pu.last_seen < v_asof)
      OR EXISTS (SELECT 1 FROM public.player_events pe WHERE pe.user_id = au.id AND pe.created_at >= au.created_at + interval '1 day' AND pe.created_at < v_asof)
    );

  SELECT count(*) INTO v_d7_eligible FROM auth.users WHERE created_at <= v_asof - interval '7 days';
  SELECT count(*) INTO v_d7_returning
  FROM auth.users au
  WHERE au.created_at <= v_asof - interval '7 days'
    AND (
      EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id AND pu.last_seen >= au.created_at + interval '7 days' AND pu.last_seen < v_asof)
      OR EXISTS (SELECT 1 FROM public.player_events pe WHERE pe.user_id = au.id AND pe.created_at >= au.created_at + interval '7 days' AND pe.created_at < v_asof)
    );

  SELECT count(*) INTO v_d30_eligible FROM auth.users WHERE created_at <= v_asof - interval '30 days';
  SELECT count(*) INTO v_d30_returning
  FROM auth.users au
  WHERE au.created_at <= v_asof - interval '30 days'
    AND (
      EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id AND pu.last_seen >= au.created_at + interval '30 days' AND pu.last_seen < v_asof)
      OR EXISTS (SELECT 1 FROM public.player_events pe WHERE pe.user_id = au.id AND pe.created_at >= au.created_at + interval '30 days' AND pe.created_at < v_asof)
    );

  -- ── Abonnementer + LTV-estimat (#4636: kun rækker der HAR betalt) ─────────
  -- "Aktiv på snapshot_date" = dækket den dag (current_period_end >= dagen),
  -- uanset NUVÆRENDE status — current_period_end fryser ved cancel, så dette
  -- rekonstruerer historisk dækning korrekt.
  SELECT count(*) INTO v_active_subs
  FROM public.subscriptions s
  WHERE s.created_at < v_asof
    AND s.current_period_end IS NOT NULL
    AND s.current_period_end >= p_snapshot_date::timestamptz;

  SELECT count(*) INTO v_paying_customers
  FROM public.subscriptions s
  WHERE s.created_at < v_asof
    AND (
      s.alunta_subscription_id IS NOT NULL
      OR s.status IN ('active', 'cancelled', 'past_due')
      OR s.current_period_end IS NOT NULL
    );

  -- #5215: periode-prisen herunder er nu EKSKL. moms (3920/21200 øre =
  -- aluntaPlanCatalog.js's amount-felt), ikke inkl. moms (4900/26500) som
  -- før denne migration. Hold i sync med backend/lib/growthSnapshot.js's
  -- PLAN_PRICE_CENTS.
  SELECT
    COALESCE(SUM(
      GREATEST(1, CEIL(
        EXTRACT(epoch FROM (
          LEAST(v_asof, CASE WHEN s.status = 'active' THEN v_asof ELSE COALESCE(s.current_period_end, s.created_at) END) - s.created_at
        )) / (CASE WHEN s.plan_interval IN ('semiannual', '6') THEN 15778800.0 ELSE 2629800.0 END)
      )) * (CASE WHEN s.plan_interval IN ('semiannual', '6') THEN 21200 ELSE 3920 END)
    ), 0),
    COALESCE(AVG(
      GREATEST(1, CEIL(
        EXTRACT(epoch FROM (
          LEAST(v_asof, CASE WHEN s.status = 'active' THEN v_asof ELSE COALESCE(s.current_period_end, s.created_at) END) - s.created_at
        )) / (CASE WHEN s.plan_interval IN ('semiannual', '6') THEN 15778800.0 ELSE 2629800.0 END)
      )) * (CASE WHEN s.plan_interval IN ('semiannual', '6') THEN 21200 ELSE 3920 END)
    ), NULL)
  INTO v_ltv_total, v_ltv_avg
  FROM public.subscriptions s
  WHERE s.created_at < v_asof
    AND (
      s.alunta_subscription_id IS NOT NULL
      OR s.status IN ('active', 'cancelled', 'past_due')
      OR s.current_period_end IS NOT NULL
    );

  -- ── NPS-aggregat (#940/#2089) ─────────────────────────────────────────────
  SELECT
    count(*),
    count(*) FILTER (WHERE score >= 9),
    count(*) FILTER (WHERE score BETWEEN 7 AND 8),
    count(*) FILTER (WHERE score <= 6)
  INTO v_nps_count, v_nps_promoters, v_nps_passives, v_nps_detractors
  FROM public.nps_responses
  WHERE created_at < v_asof;

  v_nps_score := CASE WHEN v_nps_count > 0
    THEN ROUND(100.0 * (v_nps_promoters - v_nps_detractors) / v_nps_count, 1)
    ELSE NULL END;

  INSERT INTO public.growth_metric_snapshots (
    snapshot_date, dau, wau, mau, total_registered,
    d1_eligible, d1_returning, d1_retention_pct,
    d7_eligible, d7_returning, d7_retention_pct,
    d30_eligible, d30_returning, d30_retention_pct,
    active_subscriptions, paying_customers, ltv_total_cents, ltv_avg_cents,
    nps_response_count, nps_promoters, nps_passives, nps_detractors, nps_score,
    generated_at
  ) VALUES (
    p_snapshot_date, v_dau, v_wau, v_mau, v_total_registered,
    v_d1_eligible, v_d1_returning, CASE WHEN v_d1_eligible > 0 THEN ROUND(100.0 * v_d1_returning / v_d1_eligible, 1) ELSE NULL END,
    v_d7_eligible, v_d7_returning, CASE WHEN v_d7_eligible > 0 THEN ROUND(100.0 * v_d7_returning / v_d7_eligible, 1) ELSE NULL END,
    v_d30_eligible, v_d30_returning, CASE WHEN v_d30_eligible > 0 THEN ROUND(100.0 * v_d30_returning / v_d30_eligible, 1) ELSE NULL END,
    v_active_subs, v_paying_customers, v_ltv_total::bigint, v_ltv_avg,
    v_nps_count, v_nps_promoters, v_nps_passives, v_nps_detractors, v_nps_score,
    now()
  )
  ON CONFLICT (snapshot_date) DO UPDATE SET
    dau = EXCLUDED.dau, wau = EXCLUDED.wau, mau = EXCLUDED.mau, total_registered = EXCLUDED.total_registered,
    d1_eligible = EXCLUDED.d1_eligible, d1_returning = EXCLUDED.d1_returning, d1_retention_pct = EXCLUDED.d1_retention_pct,
    d7_eligible = EXCLUDED.d7_eligible, d7_returning = EXCLUDED.d7_returning, d7_retention_pct = EXCLUDED.d7_retention_pct,
    d30_eligible = EXCLUDED.d30_eligible, d30_returning = EXCLUDED.d30_returning, d30_retention_pct = EXCLUDED.d30_retention_pct,
    active_subscriptions = EXCLUDED.active_subscriptions, paying_customers = EXCLUDED.paying_customers,
    ltv_total_cents = EXCLUDED.ltv_total_cents, ltv_avg_cents = EXCLUDED.ltv_avg_cents,
    nps_response_count = EXCLUDED.nps_response_count, nps_promoters = EXCLUDED.nps_promoters,
    nps_passives = EXCLUDED.nps_passives, nps_detractors = EXCLUDED.nps_detractors, nps_score = EXCLUDED.nps_score,
    generated_at = EXCLUDED.generated_at
  RETURNING to_jsonb(growth_metric_snapshots.*) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_daily_growth_snapshot(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_daily_growth_snapshot(date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_daily_growth_snapshot(date) TO service_role;

COMMENT ON FUNCTION public.compute_daily_growth_snapshot(date) IS
  '#3196/#4636/#5215 skriver ét vækst-snapshot (DAU/WAU/MAU/D1/D7/D30/abonnementer/LTV-estimat/NPS) for p_snapshot_date, UPSERT-idempotent. paying_customers + LTV tæller kun rækker med betalingsspor (Alunta-id, Pro-relevant status eller dækket periode), ikke rene vilkårsaccepter. LTV er ekskl. moms siden #5215 (før: inkl. moms — ingen backfill af historiske rækker). service_role-only.';

-- Post-verify (køres af Claude efter merge, #2642): dagens snapshot genberegnes
-- og paying_customers skal matche Aluntas kundetal; ltv_avg_cents for en ren
-- månedsplan-kunde skal nu ligge omkring 3920 (ekskl. moms), ikke 4900.
--   SELECT (public.compute_daily_growth_snapshot(current_date))->>'paying_customers';
--   SELECT (public.compute_daily_growth_snapshot(current_date))->>'ltv_avg_cents';
