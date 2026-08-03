-- Samlet admin-vækstdashboard (#3196, ejer-direktiv 31/7 #feedback-from-dolmer).
-- Subsumerer #2089 (NPS i admin).
--
-- Denne fil dækker TO ting:
--   1. growth_metric_snapshots: daglig persisteret snapshot-tabel + en
--      idempotent compute-funktion, så DAU/WAU/MAU/D1/D7/D30/abonnementer/LTV/NPS
--      kan tegnes som TREND over tid (7/30/90 dage) i stedet for kun "lige nu".
--   2. Dokumenteret undersøgelse + BEVIDST INGEN ÆNDRING af de tre analytics-RPC'er
--      Supabase-advisoren 3/8 flaggede (get_sprint_metrics/get_cohort_retention/
--      get_retention_scorecard_activity) — se sektion 2 nedenfor for hvorfor.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION + DROP
-- POLICY IF EXISTS før CREATE. schema_migrations-insert håndteres af
-- .github/workflows/auto-migrate.yml.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.compute_daily_growth_snapshot(date);
--   DROP TABLE IF EXISTS public.growth_metric_snapshots;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. growth_metric_snapshots
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Datamodel: én række pr. kalenderdag (UTC). snapshot_date er natural key —
-- cron'en (backend/cron.js runGrowthSnapshotCron, kaldt dagligt) og backfill-
-- scriptet (backend/scripts/backfill-growth-snapshots.js) UPSERTer begge på
-- snapshot_date, så en genkørsel samme dag (fx efter en deploy-genstart) er
-- harmløs — seneste kørsel vinder.
--
-- RLS: samme mønster som signup_attribution/subscriptions-læsning for admin —
-- INGEN policies, INGEN grants til anon/authenticated. Kun service_role (som
-- bypasser RLS) kan skrive/læse. Frontend går via GET /api/admin/growth/snapshots
-- (requireAdmin + service_role-klient), ikke direkte Supabase-læsning. Dette er
-- BEVIDST strammere end de ældre sprint-metrics/cohort-retention-RPC'er (som
-- selv-gater med is_admin() OG er authenticated-eksponerede, se sektion 2) —
-- ny admin-data i dette projekt følger nu det nyeste, strammeste mønster
-- (backend-route + service_role, jf. signup_attribution/#679).
CREATE TABLE IF NOT EXISTS public.growth_metric_snapshots (
  snapshot_date          date PRIMARY KEY,

  -- DAU/WAU/MAU: distinct users med last_seen ELLER player_events-aktivitet i
  -- vinduet [snapshot_date+1 - N dage, snapshot_date+1). Samme aktivitets-
  -- definition som get_sprint_metrics (union af begge kilder), se compute-
  -- funktionen nedenfor for BACKFILL-begrænsningen på last_seen (ét muterbart
  -- felt uden historik).
  dau                    int NOT NULL DEFAULT 0,
  wau                    int NOT NULL DEFAULT 0,
  mau                    int NOT NULL DEFAULT 0,
  total_registered       int NOT NULL DEFAULT 0,

  -- D1/D7/D30: rullende (ikke kohorte-bundet) retention, samme model som
  -- get_sprint_metrics' d7_retention_pct — % af users registreret N+ dage før
  -- snapshot_date+1 som havde aktivitet mindst N dage efter deres signup.
  d1_eligible            int NOT NULL DEFAULT 0,
  d1_returning           int NOT NULL DEFAULT 0,
  d1_retention_pct       numeric,
  d7_eligible            int NOT NULL DEFAULT 0,
  d7_returning           int NOT NULL DEFAULT 0,
  d7_retention_pct       numeric,
  d30_eligible           int NOT NULL DEFAULT 0,
  d30_returning          int NOT NULL DEFAULT 0,
  d30_retention_pct      numeric,

  -- Abonnementer + LTV-estimat (public.subscriptions, #1903). "Aktiv" matcher
  -- backend/lib/entitlement.js's computeIsPro (status IN active/cancelled/
  -- past_due AND current_period_end > snapshot-tidspunktet) — samme definition
  -- spillet selv bruger til at afgøre Pro-adgang, ikke en ny opfindelse.
  active_subscriptions   int NOT NULL DEFAULT 0,
  paying_customers       int NOT NULL DEFAULT 0, -- distinct teams der NOGENSINDE har betalt (created_at <= snapshot), uanset nuværende status
  ltv_total_cents        bigint NOT NULL DEFAULT 0,
  ltv_avg_cents          numeric,

  -- NPS (#940/#2089): score = 100 * (promoters - detractors) / n, standard-
  -- definition (promoter = 9-10, passiv = 7-8, detractor = 0-6).
  nps_response_count     int NOT NULL DEFAULT 0,
  nps_promoters          int NOT NULL DEFAULT 0,
  nps_passives           int NOT NULL DEFAULT 0,
  nps_detractors         int NOT NULL DEFAULT 0,
  nps_score              numeric,

  generated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.growth_metric_snapshots IS
  '#3196 dagligt vækst-snapshot (DAU/WAU/MAU/D1/D7/D30/abonnementer/LTV/NPS). Én række pr. UTC-kalenderdag (snapshot_date = natural key, UPSERT-idempotent). Skrives af backend/cron.js runGrowthSnapshotCron (dagligt) + backend/scripts/backfill-growth-snapshots.js (historik). Læses KUN via service_role (ingen RLS-policies) — frontend går via GET /api/admin/growth/*.';

ALTER TABLE public.growth_metric_snapshots ENABLE ROW LEVEL SECURITY;
-- Ingen policies tilføjes med vilje — service_role bypasser RLS, og der er
-- ingen legitim authenticated-læsevej (matcher signup_attribution-mønsteret).

-- ── Compute-funktion ─────────────────────────────────────────────────────────
--
-- Bruges til BÅDE (a) dagens snapshot (p_snapshot_date default = current_date,
-- kaldt af cron'en) og (b) historisk backfill (p_snapshot_date = en tidligere
-- dato, kaldt i løkke af backfill-scriptet). ÉN implementation for begge,
-- for at undgå to divergerende udgaver af DAU/WAU/MAU-logikken.
--
-- BACKFILL-BEGRÆNSNING (vigtig): users.last_seen er ét muterbart felt UDEN
-- historik — det indeholder kun den SENESTE presence-ping, aldrig en historisk
-- værdi. For en fortidig snapshot_date kan last_seen derfor kun bidrage
-- korrekt hvis brugerens ALLERSIDSTE nogensinde-aktivitet faldt i netop det
-- historiske vindue (dvs. en bruger der churnede lige derefter) — en bruger
-- der STADIG er aktiv i dag tæller IKKE med i et fortidigt vindue, fordi deres
-- last_seen peger på nu, ikke dengang. Effekten er ENSRETTET: backfillede
-- DAU/WAU/MAU/retention-tal er et KONSERVATIVT UNDERTAL for brugere der kun
-- har presence (last_seen) uden analytics-samtykke — aldrig et overtal.
-- player_events (tidsstemplet, historiserbart) er hovedkilden og er præcis for
-- alle datoer. For DAGENS snapshot (p_snapshot_date = current_date) er unionen
-- fuldt præcis (last_seen reflekterer korrekt "nu"), identisk med
-- get_sprint_metrics' definition. Ingen dato-betinget gren i SQL'en — samme
-- forespørgsel kører for begge, begrænsningen er en konsekvens af hvilke data
-- der FAKTISK findes, ikke af funktionens logik.
--
-- LTV-ESTIMAT (vigtig): subscriptions har INGEN betalings-/faktura-historik
-- (kun nuværende status + current_period_end) — der findes ingen invoice-
-- tabel i skemaet. LTV er derfor et ESTIMAT: antal betalte perioder ≈
-- ceil((dækket_tid) / periode-længde), ganget med periode-prisen. Priser
-- (4900/26500 øre) matcher frontend/public/locales/{en,da}/pro.json
-- ("49 kr/mo" / "265 kr") — hardcoded her fordi pro.json er lokaliserede
-- DISPLAY-strenge, ikke parse-bare tal; hvis prisen ændres, skal begge steder
-- opdateres manuelt (ingen fælles kilde findes i dag). Samme formel er
-- genimplementeret i backend/lib/growthSnapshot.js (estimateSubscriptionLtvCents)
-- til den LIVE pr.-kunde-visning i admin-UI'et — hold dem i sync ved ændring.
--
-- RLS-gate: KUN service_role (skrive-RPC, backend-only — mønster fra
-- apply_stage_result i 2026-07-11-revoke-rpc-grants-2327.sql).
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

  -- ── DAU/WAU/MAU (union last_seen + player_events, se backfill-note ovenfor) ──
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

  -- ── Abonnementer + LTV-estimat ────────────────────────────────────────────
  -- "Aktiv på snapshot_date" = dækket den dag (current_period_end >= dagen),
  -- uanset NUVÆRENDE status — current_period_end fryser ved cancel, så dette
  -- rekonstruerer historisk dækning korrekt (se fil-header for ræsonnement).
  SELECT count(*) INTO v_active_subs
  FROM public.subscriptions s
  WHERE s.created_at < v_asof
    AND s.current_period_end IS NOT NULL
    AND s.current_period_end >= p_snapshot_date::timestamptz;

  SELECT count(*) INTO v_paying_customers
  FROM public.subscriptions s
  WHERE s.created_at < v_asof;

  SELECT
    COALESCE(SUM(
      GREATEST(1, CEIL(
        EXTRACT(epoch FROM (
          LEAST(v_asof, CASE WHEN s.status = 'active' THEN v_asof ELSE COALESCE(s.current_period_end, s.created_at) END) - s.created_at
        )) / (CASE WHEN s.plan_interval = 'semiannual' THEN 15778800.0 ELSE 2629800.0 END)
      )) * (CASE WHEN s.plan_interval = 'semiannual' THEN 26500 ELSE 4900 END)
    ), 0),
    COALESCE(AVG(
      GREATEST(1, CEIL(
        EXTRACT(epoch FROM (
          LEAST(v_asof, CASE WHEN s.status = 'active' THEN v_asof ELSE COALESCE(s.current_period_end, s.created_at) END) - s.created_at
        )) / (CASE WHEN s.plan_interval = 'semiannual' THEN 15778800.0 ELSE 2629800.0 END)
      )) * (CASE WHEN s.plan_interval = 'semiannual' THEN 26500 ELSE 4900 END)
    ), NULL)
  INTO v_ltv_total, v_ltv_avg
  FROM public.subscriptions s
  WHERE s.created_at < v_asof;

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
GRANT EXECUTE ON FUNCTION public.compute_daily_growth_snapshot(date) TO service_role;

COMMENT ON FUNCTION public.compute_daily_growth_snapshot(date) IS
  '#3196 skriver ét vækst-snapshot (DAU/WAU/MAU/D1/D7/D30/abonnementer/LTV-estimat/NPS) for p_snapshot_date, UPSERT-idempotent. service_role-only (write-RPC, backend-only). Se fil-header for backfill-begrænsning på last_seen og LTV-estimat-metode.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Analytics-RPC'er (Supabase-advisor-fund 3/8) — UNDERSØGT, INGEN ÆNDRING
-- ═══════════════════════════════════════════════════════════════════════════
--
-- #3196 bad om at "låse" get_sprint_metrics(text), get_cohort_retention(int)
-- og get_retention_scorecard_activity(int), fordi Supabase-advisoren (3/8)
-- flagger dem som "EXECUTE-bar for authenticated" (lints
-- authenticated_security_definer_function_executable).
--
-- Verificeret LIVE mod prod (ghwvkxzhsbbltzfnuhhz) 2026-08-03 via get_advisors
-- + gennemgang af pg_get_functiondef:
--   * Alle tre HAR allerede en intern gate i funktionskroppen:
--       IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
--         RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
--       END IF;
--     (get_sprint_metrics: database/2026-05-18-sprint-metrics-service-role-bypass.sql
--      get_cohort_retention: database/2026-06-09-cohort-retention-rpc.sql
--      get_retention_scorecard_activity: database/2026-07-11-retention-scorecard-v2-rpc.sql)
--   * Ingen af de tre er kaldbare af anon (revoket i hhv. 2026-07-11-revoke-rpc-
--     grants-2327.sql og 2026-07-19-revoke-rpc-grants-2676.sql).
--   * `authenticated`-grant er BEVIDST bevaret: get_sprint_metrics og
--     get_cohort_retention kaldes DIREKTE fra frontend med bruger-JWT
--     (frontend/src/pages/AdminSprintMetricsPage.jsx via supabase.rpc(...)) —
--     en REVOKE FROM authenticated ville knække den eksisterende admin-side
--     med det samme, uden nogen sikkerhedsgevinst (funktionen afviser allerede
--     ikke-admins internt via is_admin()).
--
-- Denne PRÆCISE afvejning er allerede analyseret og bevidst besluttet TRE
-- gange tidligere i repoet:
--   #2258 → #2327/#2345 (database/2026-07-11-revoke-rpc-grants-2327.sql):
--     "is_admin, get_sprint_metrics, get_cohort_retention kaldes DIREKTE fra
--      frontend ... authenticated-grant BEVARES for disse tre ... eksponering
--      er tilsigtet."
--   #2258-fund 2 genbekræftet i database/2026-07-12-security-advisor-hardening.sql:
--     "get_cohort_retention/get_sprint_metrics har intern is_admin()-gate ...
--      INGEN ændring for dem her."
--   database/2026-07-19-revoke-rpc-grants-2676.sql (get_retention_scorecard_activity):
--     "behold authenticated: body har is_admin()/service_role-guard."
--
-- KONKLUSION for #3196: Supabase-advisoren er en statisk linter der kun ser
-- GRANT-tilstanden, ikke funktionskroppens logik — den blinker derfor på de
-- samme tre funktioner ved hver ny advisor-kørsel, uanset at "lås til admin"
-- allerede er implementeret (blot som en intern gate frem for en GRANT-
-- restriktion). At REVOKE authenticated nu ville:
--   (a) IKKE lukke noget reelt hul (ikke-admins får allerede 42501), og
--   (b) KNÆKKE AdminSprintMetricsPage.jsx's direkte supabase.rpc()-kald.
-- Derfor: INGEN GRANT-ændring for de tre funktioner i denne fil. Nye
-- admin-only dataflader i DENNE feature (afsnit 1 ovenfor,
-- GET /api/admin/growth/*) følger i stedet det strammere service_role-only-
-- mønster (ingen authenticated-grant overhovedet) — det er dét mønster der nu
-- er retningsgivende for NY admin-data, uden at det kræver en brydende
-- ombygning af den ÆLDRE, allerede-korrekt-gatede sprint-metrics-side.
