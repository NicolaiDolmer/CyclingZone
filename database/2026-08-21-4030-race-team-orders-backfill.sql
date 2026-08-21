-- 2026-08-21 · #4030 #3855 — Backfill: race_stage_roles → race_team_orders.
--
-- Kopierer race_stage_roles(race_id, stage_number, rider_id, race_role, effort)
-- ind i race_team_orders, grupperet pr. (team_id, race_id, stage_number) som
-- et riders-jsonb-array. team_id slås op via race_entries (race_id, rider_id)
-- — det ENESTE sted den kobling findes i dag (race_stage_roles har intet
-- team_id). try_break sættes til false (koncept findes ikke i race_stage_roles);
-- breakaway_stance rammes IKKE af denne fil (forbliver table-default 'neutral'
-- på nye rækker — se database/2026-08-21-4030-race-team-orders.sql).
--
-- FORUDSÆTNING: database/2026-08-21-4030-race-team-orders.sql er kørt først.
--
-- MÅLT LIVE 21/8 (aftenen, session #4030): race_stage_roles har 7.060 rækker
-- (tidligere ejer-estimat "~6.959" — feltet er vokset siden estimatet blev
-- skrevet tidligere samme dag; tallet DRIVER IKKE denne migration, kun
-- post-verify-tjekket nedenfor, som regner dynamisk på de faktiske rækker ved
-- KØRETIDSPUNKTET, ikke et hardkodet literal). 463 af de 7.060 rækker har INGEN
-- matchende race_entries-række (rytter fjernet fra holdet siden rolle-override
-- blev sat) — de kan ikke få et team_id og udelades bevidst (ikke en fejl:
-- samme "forældreløs override"-tilstand som race_stage_roles altid har haft
-- stille tålt, jf. resolveStageEntrant's fallback-kæde). Forventet resultat ved
-- kørsel: 7.060 - <antal_forældreløse> rækker migreret, grupperet i færre
-- race_team_orders-rækker (flere ryttere pr. (team, race, stage)).
--
-- IDEMPOTENT: ON CONFLICT (team_id, race_id, stage_number) DO NOTHING — re-run
-- rører ALDRIG en race_team_orders-række der allerede findes (uanset om den kom
-- fra denne backfill eller fra en managers efterfølgende PUT via det nye
-- CRUD-endpoint). Bevidst valg over DO UPDATE: en gentaget kørsel må ikke kunne
-- overskrive taktik en spiller allerede har gemt via API'et efter cutover.
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER/CLAUDE POST-MERGE under #2642-rammer.
-- Ingen apply_migration er kørt af agenten.

BEGIN;

INSERT INTO public.race_team_orders (team_id, race_id, stage_number, riders)
SELECT
  re.team_id,
  rsr.race_id,
  rsr.stage_number,
  jsonb_agg(
    jsonb_build_object(
      'rider_id', rsr.rider_id,
      'race_role', rsr.race_role,
      'effort', rsr.effort,
      'try_break', false
    )
    ORDER BY rsr.rider_id
  ) AS riders
FROM public.race_stage_roles rsr
JOIN public.race_entries re
  ON re.race_id = rsr.race_id AND re.rider_id = rsr.rider_id
GROUP BY re.team_id, rsr.race_id, rsr.stage_number
ON CONFLICT (team_id, race_id, stage_number) DO NOTHING;

COMMIT;

-- ── Post-verify (kør manuelt efter COMMIT, ikke en del af transaktionen) ─────
-- Dynamisk optælling — sammenligner faktiske kilde-rækker (med matchende
-- race_entries) mod summen af riders-array-længder i de migrerede rækker.
-- Skal give 0 i "diff" hvis alle matchbare race_stage_roles-rækker landede.
-- Forældreløse rækker (ingen race_entries-match) tælles hverken i kilde- eller
-- mål-tallet her — de er en KENDT, accepteret udeladelse (se kommentar ovenfor).
DO $$
DECLARE
  matchable_source_rows bigint;
  migrated_rider_entries bigint;
  migrated_group_rows bigint;
BEGIN
  SELECT count(*) INTO matchable_source_rows
  FROM public.race_stage_roles rsr
  JOIN public.race_entries re
    ON re.race_id = rsr.race_id AND re.rider_id = rsr.rider_id;

  SELECT count(*), coalesce(sum(jsonb_array_length(riders)), 0)
    INTO migrated_group_rows, migrated_rider_entries
  FROM public.race_team_orders;

  RAISE NOTICE 'race_stage_roles matchbare kilde-rækker: %', matchable_source_rows;
  RAISE NOTICE 'race_team_orders grupperede rækker:       %', migrated_group_rows;
  RAISE NOTICE 'race_team_orders rytter-entries (sum):     %', migrated_rider_entries;
  RAISE NOTICE 'diff (kilde - migreret rytter-entries):    %', matchable_source_rows - migrated_rider_entries;
  IF matchable_source_rows <> migrated_rider_entries THEN
    RAISE NOTICE 'ADVARSEL: diff <> 0 — enten en delvis re-run (DO NOTHING sprang eksisterende rækker over) eller manager-writes via CRUD-endpointet er sket mellem backfill og dette tjek. Undersøg før flip, blokerer IKKE denne fil.';
  END IF;
END $$;
