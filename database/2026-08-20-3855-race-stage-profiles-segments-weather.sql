-- #3855 F1 (race engine v4, rute-model v2 — docs/superpowers/specs/2026-08-20-race-engine-v4-
-- intra-stage-design.md §3.1): to nye additiv-kolonner på race_stage_profiles.
--
-- segments jsonb: ordnet, [0,distance_km]-dækkende segmentliste
--   ({ kind: 'flat'|'rolling'|'climb'|'descent'|'cobbles', from_km, to_km, ... }).
-- weather jsonb:  seeded vejr-lag pr. etape ({ kind, wind_exposure }).
--
-- distance_km FINDES ALLEREDE på tabellen (tilføjet af #2769-migrationen) — ingen ny
-- kolonne nødvendig her (verificeret mod database/schema-snapshot.json 2026-08-20).
--
-- Idempotent (IF NOT EXISTS): kan køres flere gange uden fejl. Bagudkompatibelt: NULL på
-- alle eksisterende rækker indtil en fremtidig backfill/regen sætter dem — INTET
-- eksisterende aftager-kald ændrer adfærd (kolonnerne læses ikke af nogen kørende kode
-- før v4-motoren (F2+) wires ind).
--
-- IKKE anvendt under implementeringen af #3855 F1 (ejer-mandat 18/7, #2642: migrationer
-- appliceres af Claude EFTER merge, aldrig under selve PR-arbejdet).

ALTER TABLE public.race_stage_profiles
  ADD COLUMN IF NOT EXISTS segments jsonb,
  ADD COLUMN IF NOT EXISTS weather jsonb;
