-- Seed til destruktiv relaunch-rehearsal (#1191) — køres KUN mod en disposabel
-- Supabase-branch (ALDRIG prod). Spejler prods kardinalitet pr. 2026-06-11:
--   30 users (heraf 1 admin) · 29 teams (22 beta-managers, 1 AI, 1 bank,
--   2 frosne, 3 test-konti) · 8.964 aktive legacy-ryttere (pcm_id 1..8964)
--   + 30 allerede-pensionerede · sæson 0-3 (2 aktiv) · marked/board/finans-rows.
-- Stat-fordelinger er groundet i prod-aggregater (avg/median/max via read-only
-- SQL), men værdierne er syntetiske — ingen persondata kopieres.
--
-- Deterministiske UUID'er: users 00000000-0000-4000-8000-0000000000NN,
-- teams 00000000-0000-4000-9000-0000000000NN (NN = 01..30 hex).

-- ── A0 · form-frys-struktur (#1608/#1685) — 4-tier/15-pulje pyramide ─────────
-- Seeden er fra FØR form-frysen; disse idempotente statements sikrer at puljerne
-- + pulje-kolonnerne findes på branchen, så orchestrator-trin 5.5 (allocateLeague-
-- Pools) + 5.6 (AI-fyld, #1688) kan køre. Spejler database/2026-06-21-league-
-- divisions-pyramid.sql (idempotent → harmløs hvis branch-skemaet allerede har dem).
CREATE TABLE IF NOT EXISTS league_divisions (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3, 4)),
  pool_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  UNIQUE (tier, pool_index)
);
INSERT INTO league_divisions (tier, pool_index, label) VALUES
  (1, 0, 'Division 1'),
  (2, 0, 'Division 2 — A'), (2, 1, 'Division 2 — B'),
  (3, 0, 'Division 3 — A'), (3, 1, 'Division 3 — B'), (3, 2, 'Division 3 — C'), (3, 3, 'Division 3 — D'),
  (4, 0, 'Division 4 — A'), (4, 1, 'Division 4 — B'), (4, 2, 'Division 4 — C'), (4, 3, 'Division 4 — D'),
  (4, 4, 'Division 4 — E'), (4, 5, 'Division 4 — F'), (4, 6, 'Division 4 — G'), (4, 7, 'Division 4 — H')
ON CONFLICT (tier, pool_index) DO NOTHING;
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_division_check;
ALTER TABLE teams ADD CONSTRAINT teams_division_check CHECK (division IN (1, 2, 3, 4));
ALTER TABLE teams ADD COLUMN IF NOT EXISTS league_division_id INTEGER REFERENCES league_divisions(id);
ALTER TABLE season_standings ADD COLUMN IF NOT EXISTS league_division_id INTEGER REFERENCES league_divisions(id);

-- ── A1 · auth.users (kræves af xp_log/player_events-FK'er) ──────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000',
  ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
  'authenticated', 'authenticated',
  'rehearsal-user-' || i || '@example.test', '',
  now() - (i || ' days')::interval, now() - (i || ' days')::interval, now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb, '', '', '', ''
FROM generate_series(1, 30) i;

-- ── A2 · public.users (30; user 1 = admin) ───────────────────────────────────
INSERT INTO public.users (id, email, username, role, xp, level, last_seen, login_streak, language)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
  'rehearsal-user-' || i || '@example.test', 'rehearsal_mgr_' || i,
  CASE WHEN i = 1 THEN 'admin' ELSE 'manager' END,
  100 + i * 137, 1 + (i % 9), now() - (i || ' hours')::interval, i % 14,
  CASE WHEN i % 3 = 0 THEN 'da' ELSE 'en' END
FROM generate_series(1, 30) i;

-- ── A3 · teams (29: 1-22 beta-managers, 23 AI, 24 bank, 25-26 frosne, 27-29 test)
INSERT INTO public.teams (id, user_id, name, is_ai, is_bank, is_frozen, is_test_account,
  division, balance, sponsor_income, manager_name, consecutive_low_satisfaction_expirations)
SELECT ('00000000-0000-4000-9000-' || lpad(to_hex(i), 12, '0'))::uuid,
  CASE WHEN i <= 22 THEN ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid
       WHEN i IN (25, 26) THEN ('00000000-0000-4000-8000-' || lpad(to_hex(i - 2), 12, '0'))::uuid
       WHEN i >= 27 THEN ('00000000-0000-4000-8000-' || lpad(to_hex(i - 2), 12, '0'))::uuid
       ELSE NULL END,
  CASE WHEN i = 23 THEN 'AI Peloton' WHEN i = 24 THEN 'Bank CZ'
       WHEN i IN (25, 26) THEN 'Frozen Team ' || i
       WHEN i >= 27 THEN 'Test Account ' || i
       ELSE 'Rehearsal Team ' || i END,
  i = 23, i = 24, i IN (25, 26), i >= 27,
  CASE WHEN i <= 20 THEN 1 ELSE CASE WHEN i <= 22 THEN 2 ELSE 3 END END,
  CASE WHEN i <= 22 THEN 45368 + (i * 121317) % 2656575 ELSE 500000 END,
  240000,
  CASE WHEN i <= 22 THEN 'Manager ' || i ELSE NULL END,
  CASE WHEN i <= 2 THEN 1 ELSE 0 END
FROM generate_series(1, 29) i;

-- Backfill league_division_id (spejler migrationens backfill, #1608): map heltals-
-- division til tier-puljens pulje 0 for ALLE hold — inkl. AI-holdet. Uden dette står
-- seedens AI-hold uden pulje og overlever relaunchen som et stray AI-hold (usynligt
-- for AI-fyld'ens pulje-iteration). Prod-AI-holdet HAR en pulje (backfill kørte i
-- migrationen), så dette gør seeden prod-tro; AI-fyld'ens reconcile rydder så det
-- pulje-placerede AI-hold korrekt (tier-3-pulje uden manager → 0 AI).
UPDATE public.teams t SET league_division_id = ld.id
  FROM public.league_divisions ld
  WHERE ld.tier = t.division AND ld.pool_index = 0 AND t.league_division_id IS NULL;

-- ── A4 · team_dna + tildeling (verificerer nulling i reset) ──────────────────
INSERT INTO public.team_dna (key, label, emoji, short_description, long_description, policy_axes)
VALUES ('attack_dna', 'Attack', '🔥', 'Attack first', 'Attack-minded club DNA', '{}'::jsonb),
       ('youth_dna', 'Youth', '🌱', 'Youth first', 'Youth-development club DNA', '{}'::jsonb);
UPDATE public.teams SET team_dna_key = 'attack_dna', team_dna_chosen_at = now(),
  season_1_identity_basis = '{"basis":"rehearsal"}'::jsonb
WHERE id = '00000000-0000-4000-9000-000000000001';
UPDATE public.teams SET team_dna_key = 'youth_dna', team_dna_chosen_at = now()
WHERE id = '00000000-0000-4000-9000-000000000002';

-- ── A5 · seasons 0-3 (spejler prod: 0/1 completed, 2 active, 3 upcoming) ─────
INSERT INTO public.seasons (id, number, status, start_date, end_date) VALUES
  (gen_random_uuid(), 0, 'completed', '2026-05-08', '2026-05-21'),
  (gen_random_uuid(), 1, 'completed', '2026-05-21', '2026-06-08'),
  (gen_random_uuid(), 2, 'active',    '2026-06-08', NULL),
  (gen_random_uuid(), 3, 'upcoming',  NULL, NULL);

-- ── A6 · transfer_windows (lukket vindue pr. afsluttet/aktiv sæson) ──────────
INSERT INTO public.transfer_windows (id, season_id, status, opened_at, closed_at, board_negotiation_state)
SELECT gen_random_uuid(), s.id, 'closed', s.start_date::timestamptz,
       COALESCE(s.end_date::timestamptz, now()), 'complete'
FROM public.seasons s WHERE s.number IN (0, 1, 2);

-- ── A7 · loan_config (strict_fair_v1 short/long-loft 1.2M/900k/600k; emergency 1.5M) + auction_timing_config ──
INSERT INTO public.loan_config (division, loan_type, origination_fee_pct, interest_rate_pct, seasons, debt_ceiling) VALUES
  (1, 'short', 0.03, 0.08, 3, 1200000), (1, 'long', 0.05, 0.12, 5, 1200000), (1, 'emergency', 0.10, 0.20, 1, 1200000),
  (2, 'short', 0.03, 0.08, 3, 900000),  (2, 'long', 0.05, 0.12, 5, 900000),  (2, 'emergency', 0.10, 0.20, 1, 900000),
  (3, 'short', 0.03, 0.08, 3, 600000),  (3, 'long', 0.05, 0.12, 5, 600000),  (3, 'emergency', 0.10, 0.20, 1, 600000);
INSERT INTO public.auction_timing_config (id) VALUES (1);

-- ── A8 · achievements (45 defs som prod; founder_badge findes IKKE endnu) ────
INSERT INTO public.achievements (id, category, title, description)
SELECT id,
  CASE WHEN id LIKE 'auction%' THEN 'auktioner' WHEN id LIKE 'transfer%' THEN 'transfers'
       WHEN id LIKE 'team%' THEN 'hold' WHEN id LIKE 'season%' THEN 'sæson' ELSE 'hemmelig' END,
  initcap(replace(id, '_', ' ')), 'Rehearsal seed def for ' || id
FROM unnest(ARRAY[
 'auction_first_bid','auction_first_win','auction_5_wins','auction_10_wins','auction_25_wins',
 'auction_50_wins','auction_sniper','auction_last_second','auction_high_roller','auction_5_streak',
 'transfer_first','transfer_5','transfer_15','transfer_30','transfer_seller_10','transfer_buyer_10',
 'transfer_negotiator','transfer_bargain','team_15_riders','team_20_riders','team_25_riders',
 'team_30_riders','team_youth','team_promotion','team_relegation','team_survived','team_5_achievements',
 'team_star','season_first_result','season_top10','season_top5','season_top3','season_winner',
 'season_3_top3','season_div3_winner','season_div1_winner','season_grand_tour_rider','season_board_100',
 'season_2_seasons','season_5_seasons','secret_rival','secret_heartbreak','secret_streak_7',
 'secret_streak_30','secret_watchlist_50']) AS id;

-- ── A9 · manager_achievements (pre-relaunch unlocks — skal RYDDES af reset,
--         kun founder_badge må overleve) ─────────────────────────────────────
INSERT INTO public.manager_achievements (user_id, achievement_id)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, a
FROM generate_series(1, 20) i, unnest(ARRAY['auction_first_bid','auction_first_win']) a;
INSERT INTO public.manager_achievements (user_id, achievement_id)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, 'secret_streak_7'
FROM generate_series(1, 16) i;

-- ── B1 · 8.964 aktive legacy-ryttere (pcm_id 1..8964) ────────────────────────
-- Stats groundet i prod-aggregater; ~20% har height/weight=0 (spejler prods
-- PCM-import-huller). 258 ryttere starter på hold (242 manager + 16 AI) som prod.
INSERT INTO public.riders (id, pcm_id, firstname, lastname, birthdate, nationality_code,
  height, weight, popularity, uci_points, team_id, ai_team_id,
  stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl, stat_bro, stat_sp,
  stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr,
  is_u25, potentiale, base_value, is_retired)
SELECT gen_random_uuid(), i, 'Legacy', 'Rider ' || i,
  date '1992-01-01' + ((i * 7919) % 6000), (ARRAY['FR','IT','BE','ES','NL','DK','DE','US','GB','CO'])[1 + i % 10],
  CASE WHEN i % 5 = 0 THEN 0 ELSE 165 + (i * 31) % 31 END,
  CASE WHEN i % 5 = 0 THEN 0 ELSE 55 + (i * 17) % 31 END,
  (i * 13) % 100, 1 + (i * 37) % 3000,
  CASE WHEN i <= 242 THEN ('00000000-0000-4000-9000-' || lpad(to_hex(1 + (i - 1) % 22), 12, '0'))::uuid
       WHEN i <= 258 THEN '00000000-0000-4000-9000-000000000017'::uuid
       ELSE NULL END,
  CASE WHEN i <= 258 AND i % 2 = 0 THEN '00000000-0000-4000-9000-000000000017'::uuid ELSE NULL END,
  45 + (i * 3) % 40, 40 + (i * 5) % 45, 40 + (i * 7) % 45, 42 + (i * 11) % 42,
  40 + (i * 13) % 44, 40 + (i * 17) % 40, 40 + (i * 19) % 45, 40 + (i * 23) % 46,
  42 + (i * 29) % 42, 45 + (i * 31) % 38, 42 + (i * 37) % 42, 45 + (i * 41) % 38,
  42 + (i * 43) % 42, 40 + (i * 47) % 44,
  (date '1992-01-01' + ((i * 7919) % 6000)) > date '2001-06-11',
  round((1.0 + (i % 41) / 10.0)::numeric, 1),
  2295 + floor(power((i * 2654435761 % 1000000) / 1000000.0, 10) * 40000000)::int,
  false
FROM generate_series(1, 8964) i;

-- ── B2 · 30 allerede-pensionerede legacy-ryttere (spejler prods 30 retired) ──
INSERT INTO public.riders (pcm_id, firstname, lastname, birthdate, height, weight,
  potentiale, base_value, is_retired,
  stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl, stat_bro, stat_sp,
  stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr)
SELECT 9000 + i, 'Retired', 'Rider ' || i, date '1980-01-01' + (i * 100), 180, 70,
  2.0, 10000, true, 50,50,50,50,50,50,50,50,50,50,50,50,50,50
FROM generate_series(1, 30) i;

-- ── B3 · Eksisterende physiology + abilities for legacy (upsert-on-existing
--         stien i backfillen rammes, som den vil i prod) ─────────────────────
INSERT INTO public.rider_physiology_profiles (rider_id, ftp_wkg, ftp_watts, vo2max_power_wkg,
  zone2_power_wkg, pmax_watts, power_5s_wkg, power_15s_wkg, power_1m_wkg, power_5m_wkg,
  high_intensity_energy_kj, time_to_exhaustion_ftp_min, fatigue_resistance, recovery_rate,
  height_cm, weight_kg)
SELECT id, 4.50, 315, 5.80, 3.20, 1100, 18.50, 15.20, 8.10, 6.20, 28.0, 45, 0.850, 0.800, 180, 70
FROM public.riders WHERE pcm_id IS NOT NULL AND pcm_id <= 8964;
INSERT INTO public.rider_derived_abilities (rider_id, climbing, time_trial, sprint, punch,
  endurance, cobblestone, acceleration, recovery, tactics, positioning)
SELECT id, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60
FROM public.riders WHERE pcm_id IS NOT NULL AND pcm_id <= 8964;

-- ── C1 · races/resultater/standings i sæson 1+2 ──────────────────────────────
INSERT INTO public.races (id, season_id, name, race_type, stages, status, race_class)
SELECT gen_random_uuid(), s.id, 'Rehearsal Race S' || s.number || '-' || r, 'single', 1,
  CASE WHEN r <= 4 THEN 'completed' ELSE 'scheduled' END, 'Class1'
FROM public.seasons s, generate_series(1, 6) r WHERE s.number = 2;
INSERT INTO public.race_results (race_id, result_type, rank, rider_id, rider_name, team_id, points_earned, prize_money)
SELECT ra.id, 'stage', ri.rnk, ri.id, ri.nm, ri.team_id, 50 - ri.rnk::int, 1000 * GREATEST(1, 11 - ri.rnk::int)
FROM (SELECT id, row_number() OVER (ORDER BY name) AS rn FROM public.races WHERE status = 'completed') ra
JOIN LATERAL (
  SELECT id, firstname || ' ' || lastname AS nm, team_id, row_number() OVER (ORDER BY pcm_id) AS rnk
  FROM public.riders WHERE team_id IS NOT NULL ORDER BY pcm_id LIMIT 10 OFFSET (ra.rn - 1) * 10
) ri ON true;
INSERT INTO public.season_standings (season_id, team_id, division, total_points, rank_in_division)
SELECT s.id, t.id, t.division, 500 - (row_number() OVER (ORDER BY t.id))::int * 7,
  row_number() OVER (PARTITION BY t.division ORDER BY t.id)
FROM public.seasons s CROSS JOIN public.teams t
WHERE s.number IN (1, 2) AND t.is_ai = false AND t.is_bank = false AND t.is_frozen = false AND t.is_test_account = false;
INSERT INTO public.pending_race_results (race_id, status)
SELECT id, 'pending' FROM public.races LIMIT 1;
UPDATE public.riders SET prize_earnings_bonus = 5000 WHERE pcm_id IS NOT NULL AND pcm_id <= 50;

-- ── C2 · Aktivt marked (skal annulleres/slettes af reset) ────────────────────
INSERT INTO public.auctions (id, rider_id, seller_team_id, starting_price, current_price,
  requested_start, calculated_end, status)
SELECT gen_random_uuid(), r.id, NULL, 1000, 1000 + 500 * rn, now() - interval '2 hours',
  now() + interval '6 hours', 'active'
FROM (SELECT id, row_number() OVER (ORDER BY pcm_id) AS rn FROM public.riders
      WHERE team_id IS NULL AND pcm_id IS NOT NULL AND is_retired = false LIMIT 3) r;
INSERT INTO public.auction_bids (auction_id, team_id, amount, bid_time)
SELECT a.id, '00000000-0000-4000-9000-000000000001', a.current_price, now() - interval '1 hour'
FROM public.auctions a;
INSERT INTO public.auction_proxy_bids (auction_id, team_id, max_amount)
SELECT a.id, '00000000-0000-4000-9000-000000000002', 50000 FROM public.auctions a LIMIT 1;
INSERT INTO public.transfer_listings (rider_id, seller_team_id, asking_price, status)
SELECT r.id, r.team_id, 100000, 'open' FROM public.riders r
WHERE r.team_id = '00000000-0000-4000-9000-000000000003' LIMIT 2;
INSERT INTO public.transfer_offers (listing_id, buyer_team_id, offer_amount, status, rider_id, seller_team_id)
SELECT l.id, '00000000-0000-4000-9000-000000000004', 90000, 'pending', l.rider_id, l.seller_team_id
FROM public.transfer_listings l;
INSERT INTO public.swap_offers (offered_rider_id, requested_rider_id, proposing_team_id, receiving_team_id, status)
SELECT r1.id, r2.id, r1.team_id, r2.team_id, 'pending'
FROM (SELECT id, team_id FROM public.riders WHERE team_id = '00000000-0000-4000-9000-000000000005' LIMIT 1) r1,
     (SELECT id, team_id FROM public.riders WHERE team_id = '00000000-0000-4000-9000-000000000006' LIMIT 1) r2;
-- #1994: rider-loan seed (loan_agreements) fjernet — featuren er afviklet og
-- tabellen droppet (database/2026-07-11-drop-loan-agreements-table.sql).
INSERT INTO public.loans (team_id, loan_type, principal, origination_fee, interest_rate,
  seasons_total, seasons_remaining, amount_remaining, status)
VALUES ('00000000-0000-4000-9000-000000000009', 'short', 200000, 6000, 0.08, 3, 2, 140000, 'active'),
       ('00000000-0000-4000-9000-00000000000a', 'long', 400000, 20000, 0.12, 5, 4, 350000, 'active');

-- ── C3 · finans-historik, notifikationer, xp, boards, admin_log ──────────────
INSERT INTO public.finance_transactions (team_id, type, amount, season_id, description)
SELECT t.id, x.type, x.amount, s.id, 'Rehearsal seed ' || x.type
FROM public.teams t
CROSS JOIN (SELECT id FROM public.seasons WHERE number = 2) s
CROSS JOIN LATERAL (VALUES ('sponsor', 240000::bigint), ('salary', -120000::bigint)) AS x(type, amount)
WHERE t.is_ai = false AND t.is_bank = false AND t.is_frozen = false AND t.is_test_account = false;
INSERT INTO public.notifications (user_id, type, title, message)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, 'season_started',
  'Rehearsal note ' || i, 'Seeded notification'
FROM generate_series(1, 22) i;
INSERT INTO public.xp_log (user_id, amount, reason)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(1 + i % 22), 12, '0'))::uuid, 25, 'rehearsal_seed'
FROM generate_series(1, 40) i;
INSERT INTO public.board_profiles (team_id, plan_type, focus, satisfaction, budget_modifier,
  season_id, negotiation_status, plan_start_season_number, plan_end_season_number)
SELECT t.id, '1yr', 'balanced', 55, 1.0, s.id, 'completed', 2, 2
FROM public.teams t CROSS JOIN (SELECT id FROM public.seasons WHERE number = 2) s
WHERE t.is_ai = false AND t.is_bank = false AND t.is_frozen = false AND t.is_test_account = false;
INSERT INTO public.team_board_members (team_id, archetype_key, selection_kind, is_chairman)
SELECT t.id, 'archetype_' || m, 'identity', m = 1
FROM (SELECT id FROM public.teams WHERE is_ai = false AND is_bank = false AND is_frozen = false
      AND is_test_account = false LIMIT 3) t, generate_series(1, 5) m;
INSERT INTO public.board_plan_snapshots (team_id, board_id, season_id, season_number, season_within_plan)
SELECT b.team_id, b.id, b.season_id, 2, 1 FROM public.board_profiles b LIMIT 2;
INSERT INTO public.board_request_log (team_id, board_id, season_number, request_type, outcome, title, summary)
SELECT b.team_id, b.id, 2, 'more_youth_focus', 'approved', 'Rehearsal request', 'Seeded'
FROM public.board_profiles b LIMIT 2;
INSERT INTO public.board_consequences (team_id, layer, status, severity, payload)
VALUES ('00000000-0000-4000-9000-000000000001', 5, 'active', 800, '{"kind":"sponsor_pullout"}'::jsonb);
INSERT INTO public.admin_log (admin_user_id, action_type, description)
VALUES ('00000000-0000-4000-8000-000000000001', 'beta_reset', 'Rehearsal seed: historisk reset-logline'),
       ('00000000-0000-4000-8000-000000000001', 'season_started', 'Rehearsal seed: historisk season-start');
