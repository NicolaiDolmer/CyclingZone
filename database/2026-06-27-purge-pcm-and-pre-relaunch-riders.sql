-- Oprydning: slet gamle PCM-import-ryttere + pre-relaunch/test-ryttere.
-- Ejer-direktiv 2026-06-27: "vi skal ikke have gammel ligegyldig historik gemt."
--
-- BAGGRUND
--   riders-tabellen indeholder 13.347 ryttere, men kun 2.928 er det levende spil.
--   Resten er pre-relaunch-cruft der aldrig blev slettet ved den fiktive relaunch:
--
--   | Kohorte                         | Antal | Skabt           | På hold | Refs        |
--   |---------------------------------|-------|-----------------|---------|-------------|
--   | PCM-import (pcm_id sat)          | 8.969 | 15. apr–2. jun  | 0       | 22 admin_log|
--   | Retired fiktiv (relaunch-seed)  | 1.450 | 18.–22. jun     | 0       | 0           |
--   | AKTIV fiktiv (BEHOLDES)          | 2.928 | 22.–26. jun     | 2.151   | live-spil   |
--
--   Verificeret read-only mod prod 2026-06-27: ingen rytter i slet-sættet er på et
--   spiller-hold (team_id) eller AI-hold (ai_team_id), og slet-sættet har 0 rækker
--   i race_results / race_entries / auctions / transfer_listings / transfer_offers.
--
-- HVAD SLETTES
--   Alt der IKKE er det levende spil: pcm_id IS NOT NULL OR is_retired = true (10.419).
--   BEHOLDER kun pcm_id IS NULL AND is_retired = false (2.928 aktive fiktive ryttere).
--
-- FK-FALLOUT
--   De fleste rider-FK'er er CASCADE (rider_derived_abilities, rider_condition,
--   rider_physiology_profiles, rider_stat_history, rider_watchlist, academy_*,
--   training_plans, ...) og rydder selv slet-rytternes afledte rækker.
--   race_results / activity_feed er SET NULL. De to NO ACTION-FK'er:
--     • admin_log.target_rider_id (nullable) — 22 rækker, nulles i trin 1.
--     • transfer_offers.rider_id — 0 referencer i slet-sættet.
--
-- ⚠️ DESTRUKTIV migration. Auto-applies i prod ved merge — EJEREN merger PR'en.
--    Verificér FØRST mod en disposabel Supabase-branch hvis i tvivl.
--
-- IDEMPOTENT: efter første kørsel er der ingen PCM/retired tilbage → re-run = no-op.
--
-- ROLLBACK: ingen automatisk down-migration (destruktiv, forward-only). Gendannelse
--   kræver DB-backup fra før kørslen.

BEGIN;

-- 1. Ryd NO ACTION-FK der ellers blokerer DELETE'en (nuller kun rytter-pegeren,
--    bevarer selve admin-log-rækken).
UPDATE admin_log
SET target_rider_id = NULL
WHERE target_rider_id IN (
  SELECT id FROM riders WHERE pcm_id IS NOT NULL OR is_retired = true
);

-- 2. Slet alle ikke-levende ryttere. CASCADE rydder afledte tabeller.
DELETE FROM riders
WHERE pcm_id IS NOT NULL OR is_retired = true;

COMMIT;
