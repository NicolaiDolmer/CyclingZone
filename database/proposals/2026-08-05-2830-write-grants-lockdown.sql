-- =============================================================================
-- 2026-08-05 — #2830: systematisk write-grant-audit + default-privileges-guard
-- Refs #2830, #2802, #2803, #2814, #2259
-- =============================================================================
-- STATUS: IKKE KØRT — forberedt til ejer-review (jf. database/proposals/
-- README.md). Ligger BEVIDST i database/proposals/, IKKE database/-topniveau,
-- så auto-migrate.yml (matcher kun `database/2026-*.sql` via `find -maxdepth 1`)
-- IKKE plukker den op ved merge. Flyt til database/-topniveau i en SEPARAT PR
-- når ejeren har godkendt scope nedenfor (Claude applier derefter selv,
-- idempotent + post-verify, jf. #2642-rammerne — denne klasse er ikke
-- destruktiv: REVOKE på et privilegie fjerner aldrig data).
--
-- ─── Baggrund ────────────────────────────────────────────────────────────────
-- #2802 lukkede fire tabeller (users/transfer_offers/auction_bids/swap_offers)
-- hvor Supabase' schema-level default privileges (nye public-tabeller arver
-- automatisk INSERT/UPDATE/DELETE/TRUNCATE til BÅDE anon og authenticated,
-- fordi Supabase's sikkerhedsmodel forudsætter at RLS — ikke table-grants —
-- er håndhævelses-laget) kombineret med en RLS-policy uden kolonne-/værdi-
-- begrænsning gav reelle skrivehuller. #2830 er den lovede opfølgning:
-- samme audit-metode kørt mod HELE public-schemaet.
--
-- ─── Kortlægning (read-only mod prod, 2026-08-05, Supabase MCP execute_sql) ──
-- 137 public-relationer (133 tabeller + 4 views) har anon og/eller
-- authenticated med bred INSERT/UPDATE/DELETE(/TRUNCATE). Alle 133 base-
-- tabeller har RLS enabled (verificeret: 0 tabeller med relrowsecurity=false
-- blandt dem — der er IKKE en "RLS slukket helt"-instans i denne audit, i
-- modsætning til hvad #2830-issue-teksten antog kunne være tilfældet).
-- Klassificeret i tre kategorier (jf. issue-krav):
--
--   (a) RLS beskytter reelt — enten en dækkende INSERT/UPDATE/DELETE-policy
--       med korrekt række-scoping (ejer-check eller is_admin()), eller INGEN
--       dækkende policy overhovedet (= Postgres default-deny: grantet er
--       katalogført, men enhver skriveforsøg afvises alligevel).
--   (b) Grant er bred OG RLS er svag/mangler — den brændende kategori.
--       **0 tabeller** matcher dette efter gennemgang (se "Policy-review"
--       nedenfor) — de fire huller #2802/#2803/#2814 fandt er allerede
--       lukket, og ingen nye af samme klasse blev fundet ved manuel review
--       af samtlige 34 tabeller med en reelt dækkende write-policy.
--   (c) Bør aldrig være skrivbar fra klienten — de resterende 99 tabeller
--       (heraf 31 backup_*-tabeller, jf. #2259) har INGEN legitim klient-sti
--       og er kun i praksis beskyttet af Postgres' default-deny. Grantet er
--       "dødt" (intet skriveforsøg kan lykkes i dag), men efterlader en
--       skrøbelig afhængighed af at ingen fremtidig policy nogensinde
--       tilføjes uden at tænke på klient-adgang (samme rodårsag som
--       #2830-issuets bekymring). REVOKE her er ren hygiejne — nul
--       funktionel risiko, da intet virker i dag på den vej der lukkes.
--
-- ─── Policy-review (kategori b-tjek, alle 34 tabeller med dækkende policy) ──
-- Gennemgået enkeltvis (qual + with_check for hver INSERT/UPDATE/DELETE-
-- policy, + kolonneliste for ejer-scopede tabeller):
--   - Admin-gated (is_admin() eller "users.role='admin'"-subquery på BÅDE
--     qual og with_check): app_config, countries, discord_settings,
--     race_classes, race_entries, race_incidents, race_points,
--     race_simulation_rider_scores, race_simulation_runs, race_stage_moments,
--     race_stage_profiles, race_stage_roles, race_stage_schedule,
--     rider_derived_abilities, rider_peak_plans, rider_physiology_profiles,
--     roadmap_items. Sikkerheden her afhænger 100% af at users.role IKKE er
--     klient-skrivbar — verificeret LIVE (2026-08-05): kun
--     consent_preferences/discord_id/language/nps_last_prompted_at har
--     UPDATE-grant for authenticated på users, `role` er IKKE blandt dem
--     (#2802-fixet er live). is_admin()-gaten er derfor til at stole på.
--   - Eksplicit "ingen klient-adgang" (qual=false, with_check=false):
--     identity_events, ops_alert_state, race_balance_drift_daily.
--   - Ejer-/række-scopet (auth.uid()=user_id eller team_id via
--     teams.user_id), verificeret mod kolonnelisten at ingen "system"-kolonne
--     (fx en modpart-bekræftelses-flag) er eksponeret: founder_supporter_
--     waitlist, launch_waitlist (INSERT only, kræver consent_given_at),
--     notifications (UPDATE/DELETE egen row, INSERT kun service_role),
--     nps_responses, pending_race_result_rows, pending_race_results (admin
--     ELLER submitted_by=egen), player_events, rider_profile_views,
--     rider_watchlist, roadmap_votes (kræver desuden at target-item er
--     approved+active), scout_actions, training_plans, training_week_plans,
--     transfer_listings (kolonner: id, rider_id, seller_team_id,
--     asking_price, status, created_at — ingen modpart-felt at misbruge).
--   - Frontend-verifikation (grep frontend/src for `.from('<table>')` +
--     `.insert(/.update(/.delete(`): rider_watchlist, notifications,
--     player_events, roadmap_votes, launch_waitlist, founder_supporter_
--     waitlist, nps_responses, users(kun nps_last_prompted_at) har AKTIVE
--     frontend-callers. roadmap_items har admin-brug via RoadmapPage.jsx
--     (insert+update, is_admin()-gated, ikke backend-rute). scout_actions/
--     training_plans/training_week_plans/transfer_listings/pending_race_
--     results/pending_race_result_rows/rider_profile_views viste INGEN
--     direkte frontend .insert/.update/.delete i denne grep-pasning — deres
--     policies er reelt UBRUGTE i dag (skrivning går gennem backend/
--     service_role for disse), men IKKE inkluderet i denne migrations REVOKE
--     (se "IKKE inkluderet" nedenfor — kræver bredere verifikation end én
--     grep-pasning kan give med sikkerhed).
--
-- Konklusion: INGEN af de 34 policy-dækkede tabeller viser #2802-mønstret
-- (række-check uden kolonne-/værdi-begrænsning der lækker noget farligt).
-- Denne migration ÆNDRER DERFOR IKKE på deres INSERT/UPDATE/DELETE-grants.
--
-- ─── Bonus-fund: 4 views med klient-write-grant ─────────────────────────────
-- ai_active_season_status, ai_race_import_blockers, ai_recent_import_health,
-- roadmap_item_scores (AI-dashboard/rapporterings-views) har alle anon/
-- authenticated INSERT/UPDATE/DELETE/TRUNCATE. Views har ikke selv RLS —
-- skriv-gennem afhænger af om Postgres opfatter dem som "auto-updatable"
-- (information_schema.views.is_insertable_into/is_updatable):
--   - ai_race_import_blockers, ai_recent_import_health, roadmap_item_scores:
--     is_insertable_into='NO' — JOIN/GROUP BY/aggregat/LIMIT diskvalificerer
--     dem. Et forsøg på INSERT/UPDATE fejler i selve SQL-laget uanset grant.
--   - ai_active_season_status: is_insertable_into='YES' (single-table FROM
--     seasons, kun WHERE, ingen aggregat/LIMIT på øverste niveau — subqueries
--     i select-listen diskvalificerer IKKE auto-updatability). Et skriveforsøg
--     her ville rewrite'es til `UPDATE public.seasons ...` og derefter
--     rammes af `seasons`'s EGEN RLS — som INGEN dækkende write-policy har
--     for anon/authenticated (bekræftet: seasons er i 99-tabel-listen nedenfor)
--     → transitivt beskyttet af default-deny i dag. Men grantet på selve
--     VIEWET er en unødvendig ekstra indgang, der kun forbliver sikker så
--     længe `seasons` aldrig får en permissiv write-policy uden at nogen
--     husker at også views ind i den kan skrive med. Revokes her sammen med
--     de tre andre views — nul funktionel risiko (kun rapporterings-views,
--     ingen frontend-skriver til nogen af dem).
--
-- ─── IKKE inkluderet (foreslået, kræver yderligere verifikation) ────────────
-- scout_actions, training_plans, training_week_plans, transfer_listings,
-- pending_race_results, pending_race_result_rows, rider_profile_views:
-- grep fandt ingen direkte frontend-skrivning, hvilket ligner swap_offers-
-- mønstret fra #2802 (grant uden reel klient-bruger, hygiejne-kandidat). IKKE
-- inkluderet i denne migrations REVOKE, fordi (1) de allerede er sikre —
-- ejer-/team-scopet RLS, ikke #2802-mønstret, og (2) at bekræfte "helt sikkert
-- ingen legitim brug" for 7 forskellige spiller-funktioner (scouting,
-- træningsplaner, transfer-marked, pending-resultat-indsendelse) ud fra én
-- grep-pasning er ikke nok sikkerhed til at fjerne noget der kan vise sig at
-- være en fremtidig eller delvist udrullet klient-skrive-sti. Overlades til
-- ejer-beslutning + en selvstændig, grundigere gennemgang pr. tabel.
--
-- ─── Backend upåvirket ───────────────────────────────────────────────────────
-- Al backend-skrivning bruger service_role (SUPABASE_SERVICE_KEY,
-- backend/routes/api.js) — BYPASSRLS, ramt af INGEN af nedenstående REVOKEs.
--
-- ─── Idempotens / destruktivitet ─────────────────────────────────────────────
-- REVOKE på et allerede-manglende privilegium er en no-op. ALTER DEFAULT
-- PRIVILEGES er ligeledes idempotent (gentaget REVOKE ændrer intet nyt).
-- INGEN rækker muteres, INGEN tabeller droppes eller omdøbes — kun
-- kataloggrants. Ikke-destruktiv.
--
-- ─── Forward-guard: ALTER DEFAULT PRIVILEGES ────────────────────────────────
-- Root cause (jf. .claude/learnings/2026-07-23-rls-broad-write-grants.md):
-- to default-ACL-entries i public-schemaet grantede historisk INSERT/UPDATE/
-- DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN til anon+authenticated på ALLE
-- nye tabeller, for grantor-rollerne 'postgres' OG 'supabase_admin'
-- (verificeret via pg_default_acl 2026-08-05). Denne migration retter KUN
-- 'postgres' — den rolle dette repos migrationer rent faktisk kører som
-- (hard rule 9, #2642). Repoets 'postgres'-rolle er IKKE medlem af
-- 'supabase_admin' (verificeret via pg_auth_members) og kan derfor ikke
-- ændre dén rolles defaults herfra — hvis Supabase-managed tooling nogensinde
-- opretter en public-tabel som supabase_admin, arver den stadig hullet. Det
-- kan kun rettes af Supabase support/dashboard med den rolle. I praksis er
-- 'postgres' den rolle ALLE tabeller i dette schema hidtil er oprettet som
-- (bekræftet ved at 'postgres' ejer samtlige 133+4 relationer i denne audit),
-- så denne fix dækker den reelle kanal.
-- =============================================================================

BEGIN;

-- ── 1. 99 tabeller UDEN legitim klient-skrivesti (default-deny i dag) ───────
-- Fuldt REVOKE — nul funktionel risiko, intet skriveforsøg lykkes i dag på
-- nogen af disse (bekræftet: ingen dækkende INSERT/UPDATE/DELETE-policy for
-- anon/authenticated/public på nogen af de 99). REFERENCES/TRIGGER/MAINTAIN
-- inkluderet som gratis defense-in-depth (samme princip som #2802's
-- REFERENCES+TRIGGER-revoke; MAINTAIN er en PG17-privilegie #2802 ikke havde
-- at forholde sig til — bekræftet granted her, aldrig brugt af PostgREST).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.academy_graduation, public.academy_intake, public.academy_intake_ticks,
     public.academy_season_intake_runs, public.achievements, public.activity_feed,
     public.admin_log, public.ai_recovery_runs, public.auction_proxy_bids,
     public.auction_timing_config, public.auctions,
     public.backup_2407_20260715_pending_removal, public.backup_2456_derived_20260715,
     public.backup_2456_free_youth_20260715, public.backup_2456_watchlist_20260715,
     public.backup_2590_season_budget_20260719, public.backup_3048_20260727_sprints,
     public.backup_academy_freeagent_fix_20260628, public.backup_academy_salary_2083_20260703,
     public.backup_auction_push_24h_20260719, public.backup_boardgoals_formation_20260630,
     public.backup_chronrebuild_20260628_entries, public.backup_chronrebuild_20260628_profiles,
     public.backup_chronrebuild_20260628_races, public.backup_chronrebuild_20260628_schedule,
     public.backup_chronrebuild_20260628_withdrawals, public.backup_fairplay_20260722_orphan_entries,
     public.backup_fairplay_20260722_race_entries, public.backup_fairplay_20260722_riders,
     public.backup_fairplay_20260722_teams, public.backup_fairplay_20260722_transfer_offers,
     public.backup_fairplay_20260722_users, public.backup_fairplay_2221_20260706_listings,
     public.backup_fairplay_2221_20260706_race_entries, public.backup_fairplay_2221_20260706_riders,
     public.backup_fairplay_2221_20260706_sponsors, public.backup_fairplay_2221_20260706_standings,
     public.backup_fairplay_2221_20260706_strategy, public.backup_fairplay_2221_20260706_teams,
     public.backup_ghost_auctions_fix_20260628, public.backup_italiensk_klassiker_monument_goal_fix_20260731,
     public.backup_race_results_2103_20260702, public.backup_seedfix_20260628_race_stage_profiles,
     public.backup_team_csc_board_2104_20260702, public.board_consequences,
     public.board_plan_snapshots, public.board_profiles, public.board_request_log,
     public.board_satisfaction_events, public.discord_dm_outbox, public.finance_transactions,
     public.global_rank_season_start_snapshot, public.global_rank_weekly_snapshot,
     public.hall_of_fame, public.import_log, public.league_divisions, public.loan_config,
     public.loans, public.manager_achievements, public.matview_refresh_heartbeat,
     public.prize_tables, public.race_entry_clears, public.race_point_cascade,
     public.race_point_master, public.race_point_template, public.race_pool,
     public.race_results, public.race_stage_passages, public.race_withdrawals, public.races,
     public.rider_condition, public.rider_derived_ability_history, public.rider_development_log,
     public.rider_stat_history, public.rider_uci_history, public.riders, public.schema_migrations,
     public.scout_assignments, public.scout_sweep_runs, public.season_form_reset_runs,
     public.season_standings, public.seasons, public.signup_attribution, public.sponsor_contracts,
     public.staff_derived_abilities, public.subscriptions, public.team_board_members,
     public.team_dna, public.team_facilities, public.team_global_rank_points,
     public.team_race_strategy, public.team_rider_role_rules, public.team_staff, public.teams,
     public.traffic_events, public.training_day_runs, public.transfer_windows,
     public.wage_daily_runs, public.xp_log
  FROM anon, authenticated;

-- ── 2. 4 rapporterings-views ────────────────────────────────────────────────
-- Samme fulde REVOKE — 3 af de 4 er ikke engang auto-updatable (DML fejler i
-- SQL-laget uanset grant), den fjerde (ai_active_season_status) er transitivt
-- beskyttet af seasons' egen RLS-default-deny (se header). Ingen legitim
-- klient-bruger af nogen af de fire.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.ai_active_season_status, public.ai_race_import_blockers,
     public.ai_recent_import_health, public.roadmap_item_scores
  FROM anon, authenticated;

-- ── 3. 34 policy-dækkede tabeller: KUN TRUNCATE/MAINTAIN fjernes ───────────
-- INSERT/UPDATE/DELETE beholdes uændret (legitim brug, se Policy-review i
-- headeren). TRUNCATE er ALDRIG legitimt for en klient-rolle uanset RLS —
-- Postgres har ingen TRUNCATE-policy-kommando, så RLS filtrerer den slet
-- ikke, og PostgREST eksponerer intet REST-verb der mapper til den. MAINTAIN
-- (VACUUM/ANALYZE/REINDEX/REFRESH MATERIALIZED VIEW) har samme "aldrig
-- legitimt for en klient"-egenskab.
REVOKE TRUNCATE, MAINTAIN
  ON public.app_config, public.countries, public.discord_settings,
     public.founder_supporter_waitlist, public.identity_events, public.launch_waitlist,
     public.notifications, public.nps_responses, public.ops_alert_state,
     public.pending_race_result_rows, public.pending_race_results, public.player_events,
     public.race_balance_drift_daily, public.race_classes, public.race_entries,
     public.race_incidents, public.race_points, public.race_simulation_rider_scores,
     public.race_simulation_runs, public.race_stage_moments, public.race_stage_profiles,
     public.race_stage_roles, public.race_stage_schedule, public.rider_derived_abilities,
     public.rider_peak_plans, public.rider_physiology_profiles, public.rider_profile_views,
     public.rider_watchlist, public.roadmap_items, public.roadmap_votes, public.scout_actions,
     public.training_plans, public.training_week_plans, public.transfer_listings
  FROM anon, authenticated;

-- ── 4. Forward-guard: nye public-tabeller arver IKKE længere bredt write ────
-- Kun for grantor-rollen 'postgres' — se header for hvorfor supabase_admin's
-- tilsvarende default-ACL-entry ikke kan rettes herfra.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;

COMMIT;

-- PostgREST henter schema-cache på ny så grant-ændringerne slår igennem med det samme.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
-- 1) De 99 default-deny-tabeller + 4 views har INGEN write-grant tilbage:
--
--   SELECT table_name, grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND grantee IN ('anon','authenticated')
--     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
--     AND table_name IN ('riders','teams','races','race_results','finance_transactions',
--       'admin_log','import_log','schema_migrations','xp_log','seasons',
--       'ai_active_season_status','roadmap_item_scores' /* ... repræsentativ delmængde */);
--   -- Forventet: 0 rows.
--
-- 2) De 34 policy-dækkede tabeller beholder INSERT/UPDATE/DELETE, mister TRUNCATE:
--
--   SELECT table_name, grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND grantee IN ('anon','authenticated')
--     AND table_name IN ('roadmap_items','rider_watchlist','notifications','transfer_listings')
--     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
--   ORDER BY table_name, grantee, privilege_type;
--   -- Forventet: INSERT/UPDATE/DELETE til stede hvor det matcher policy-reviewet
--   -- ovenfor, ALDRIG TRUNCATE.
--
-- 3) Default-privileges er rettet for fremtidige tabeller (kør som postgres):
--
--   SELECT * FROM public.audit_default_privileges();
--   -- Forventet: 0 rows (kræver database/proposals/2026-08-05-audit-write-
--   -- grants-helper.sql anvendt først).
--
--   -- Rå fallback uden helper-RPC:
--   SELECT pg_get_userbyid(d.defaclrole) AS grantor, a.grantee::regrole, a.privilege_type
--   FROM pg_default_acl d
--   JOIN pg_namespace n ON n.oid=d.defaclnamespace
--   CROSS JOIN LATERAL aclexplode(d.defaclacl) a
--   WHERE d.defaclobjtype='r' AND n.nspname='public'
--     AND pg_get_userbyid(d.defaclrole)='postgres'
--     AND a.grantee::regrole::text IN ('anon','authenticated')
--     AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
--   -- Forventet: 0 rows.
--
-- 4) Audit-scriptet bekræfter: node backend/scripts/audit-rls-coverage.js
--    → "OK" på write-grant-delen (kræver helper-RPC'erne anvendt).
--
-- 5) Backend-smoke (service_role, upåvirket af REVOKE):
--    - Admin-panel: rediger app_config, godkend roadmap-item, ret race_classes
--    - Auktioner: bud, watchlist-toggle (rider_watchlist — klient-skrivning,
--      uændret grant)
--    - Notifikationer: markér som læst / slet (klient-skrivning, uændret)
--    - Roadmap: afgiv/opdatér stemme (roadmap_votes — klient-skrivning, uændret)
-- =============================================================================
