-- #2529 — Kollaps trænings-chef-niveaubåndene "youth" + "junior" til ÉT "u23"-bånd.
-- Ejer-beslutning (Discord 16/7): spillere kunne ikke finde forklaringen på de tre
-- bånd, og koden matchede ikke ejerens egen beskrivelse af dem (bekræftet uklarhed).
-- riderLevelBand() er ændret tilsvarende: alder ≤25 = u23, 26+ = senior
-- (backend/lib/staffAbilityConstants.js).
--
-- Migrerer staff_derived_abilities.levels fra { youth, junior, senior } til
-- { u23, senior }. u23-værdien = MAX(youth, junior) pr. staff-række (IKKE
-- gennemsnit): en trænings-chef der allerede var stærk på ÉN af de to gamle
-- alders-faser (fx en ren "junior"-specialist) skal ikke straffes for ikke også
-- at have været stærk på den anden — chefens BEDSTE alders-affinitet er den
-- reelle kompetence, båndet blot var for finmasket til at spilleren kunne se
-- den. Alternativ overvejet: AVG(youth, junior) — afvist, fordi det ville
-- SÆNKE specialister der bevidst havde investeret i kun én af de to gamle
-- bånd (kontrast-skew i staffAbilityDerivation.js garanterer typisk netop
-- dét mønster: én specialisering rager op, resten trækkes ned).
--
-- Rows uden youth/junior-nøgler (allerede migreret, eller en fremtidig
-- indsættelse efter kode-deploy som allerede skriver u23/senior direkte)
-- rammes ikke af WHERE-clausen — idempotent, kan køres flere gange.
--
-- KOMMENTAR (kode-tilstand ved commit-tidspunkt): FACILITIES_ENABLED = false
-- (backend/lib/facilityConstants.js) → staff kan endnu ikke rent faktisk
-- ansættes i prod, så staff_derived_abilities forventes tomt/næsten tomt i
-- praksis. Migrationen er alligevel skrevet generisk (ikke antaget tom), da
-- tabellen kan indeholde test-/admin-ansatte rækker fra FØR flippet.
--
-- Committes, men APPLIES ALDRIG automatisk (AGENTS.md: migrationer anvendes
-- kun når ejeren merger PR'en). Koden (staffAbilityConstants.normalizeLevelBands)
-- tåler BEGGE tilstande i vinduet mellem merge og apply — se PR-body.
--
-- Rollback: ingen ren invers (MAX er lossy — det gamle youth/junior-split kan
-- ikke genskabes). Hvis rollback er nødvendig: gendan fra en pre-migration
-- backup af staff_derived_abilities, eller (nødløsning) sæt både youth og
-- junior = den nuværende u23-værdi (ikke bit-identisk med originalen).

BEGIN;

UPDATE staff_derived_abilities
SET levels = jsonb_build_object(
      'u23', GREATEST(
        COALESCE((levels->>'youth')::smallint, 1),
        COALESCE((levels->>'junior')::smallint, 1)
      ),
      'senior', COALESCE((levels->>'senior')::smallint, 1)
    ),
    updated_at = now()
WHERE (levels ? 'youth') OR (levels ? 'junior');

COMMENT ON COLUMN staff_derived_abilities.levels IS '{ u23, senior } niveau-affiniteter 1..99 (#2529: youth+junior kollapset til u23).';

COMMIT;
