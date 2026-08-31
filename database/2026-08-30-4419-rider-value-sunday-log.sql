-- #4419 · Dedup-anker for søndagens værdi-pipeline (backend/lib/sundayValueSweep.js).
--
-- Ejer-beslutning 30/8: rytterværdier opdateres søndag fra kl. 06 dansk tid, i
-- et selvstændigt job i stedet for som efterhængt trin i trænings-sweepen kl. 22.
--
-- Hvorfor en tabel og ikke en in-memory-guard: pipelinen er
--   1) v4-refresh (skriver base_value RENT fra modellen), derefter
--   2) markedsblendet (#3448, skriver et blend oven på samme kolonne).
-- En Railway-genstart senere samme søndag ville med en in-memory-guard køre
-- trin 1 igen, og dermed skrive dagens blend væk, mens blendets EGET dato-claim
-- (market_value_sunday_sweep_log) blokerede en genberegning. Claim'et her dækker
-- derfor HELE pipelinen, ikke kun blendet. Samme mønster som
-- market_value_sunday_sweep_log (2026-08-06) og discord_race_digest_log
-- (2026-08-05): UNIQUE på dagen, claim FØR første mutation.
--
-- ⚠️ LIVSCYKLUS, LÆS FØR MERGE: filer i database/2026-*.sql KØRER AUTOMATISK
--    mod prod ved merge til main (.github/workflows/auto-migrate.yml, AGENTS.md
--    hard rule 9). Merge ER applikationen. Derfor merger EJEREN denne PR manuelt,
--    og post-apply-verifikationen (information_schema-tjek af tabellen) noteres i
--    PR-/issue-tråden.
--    Migrationen er ikke-destruktiv (CREATE TABLE IF NOT EXISTS) og additiv: den
--    opretter kun et log-anker. Indtil tabellen findes, no-op'er jobbet bevidst
--    (skipped: "log_table_missing"), en værdi-mutation af hele populationen
--    uden dedup-anker er farligere end en søndag uden opdatering.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.rider_value_sunday_log;

CREATE TABLE IF NOT EXISTS public.rider_value_sunday_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date             DATE NOT NULL UNIQUE,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  -- v4-refresh (trin 1). Ingen "failed"-kolonne: fejler trin 1, FRIGIVES dagens
  -- claim igen (DELETE), så næste times tick kan prøve forfra — en færdig række
  -- betyder derfor altid at trin 1 lykkedes. Se sundayValueSweep.js.
  scanned              INTEGER,
  changed              INTEGER,
  written              INTEGER,
  -- markedsblend (trin 2), ran=false så længe market_value_sweep_enabled er 'off'
  market_sweep_ran     BOOLEAN NOT NULL DEFAULT false,
  market_sweep_written INTEGER
);

COMMENT ON TABLE public.rider_value_sunday_log IS
  '#4419: ét claim pr. dansk søndag for HELE værdi-pipelinen (v4-refresh + markedsblend). UNIQUE(run_date) er mutexen; claimes FØR første rytter-skrivning.';

-- service-role only: ingen policies, RLS slået til (samme som
-- market_value_sunday_sweep_log). Ingen spiller-vendt læsning af denne log.
ALTER TABLE public.rider_value_sunday_log ENABLE ROW LEVEL SECURITY;
