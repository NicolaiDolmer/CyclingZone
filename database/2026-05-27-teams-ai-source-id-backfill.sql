-- Refs #667 · backfill teams.ai_source_id for de 17 verificerede manager-hold.
--
-- Baggrund: dyn_cyclist-arket i PCM bruger fkIDteam-kolonnen til at angive hvilket
-- PCM-team en rytter hører til. Når en rytter skifter hold i CZ (auction, trade,
-- pension), skal arket opdateres før næste PCM-import. Mapping mellem CZ-team
-- (UUID) og PCM-team-ID (int) ligger fra nu af i teams.ai_source_id som source
-- of truth, så sync-scriptet kan join'e direkte uden hardkodet config.
--
-- Idempotent: UPDATE ... WHERE id matcher højst én række pr. team.
--
-- AI-team har allerede ai_source_id=119 (bank/AI/retired-bucket); ikke rørt her.
-- Chris Machines + Vestas - Vov Vov Cycling mangler PCM-mapping (afventer manager-
-- afklaring 2026-05-27); fkIDteam for deres 19 ryttere lades urørt af sync-scriptet
-- indtil ai_source_id er sat. Tilføj senere via:
--   UPDATE teams SET ai_source_id = <N> WHERE id = '4124444f-cb87-4b50-82a2-be51a75d30fc'; -- Chris Machines
--   UPDATE teams SET ai_source_id = <N> WHERE id = '197db0ff-d5c9-4a87-aaca-265886f83184'; -- Vestas - Vov Vov

BEGIN;

-- 17 manager-hold med verificeret PCM-team-ID (fra Holdnavne.txt 2026-05-27).
UPDATE teams SET ai_source_id =   3 WHERE id = '80ee8b58-d59e-45a4-872b-dd58f8da909e'; -- Decathlon CMA CGM Team
UPDATE teams SET ai_source_id =   6 WHERE id = 'ae2c888a-5ee4-454f-b409-f935af43756f'; -- Groupama-FDJ United
UPDATE teams SET ai_source_id =  10 WHERE id = '3a6a93a4-6b21-40c4-a257-84771a67a4ae'; -- Soudal Quick-Step
UPDATE teams SET ai_source_id =  13 WHERE id = '5e3a5763-cedb-423e-9cc8-ba0029e74af7'; -- Bahrain Victorious
UPDATE teams SET ai_source_id =  14 WHERE id = '814b9df1-e2b9-4a3c-9ac1-ac33d7439bc4'; -- Team Visma | Lease a Bike
UPDATE teams SET ai_source_id =  26 WHERE id = '992f67c2-abd7-428e-a952-2111ddef759b'; -- Modern Adventure Pro Cycling
UPDATE teams SET ai_source_id =  33 WHERE id = '4671579d-c248-4cbd-8d4a-e6a95a9f030a'; -- Red Bull - BORA-Hansgrohe
UPDATE teams SET ai_source_id =  70 WHERE id = '8353e396-ed52-490e-a6b4-c5c9bb8fa841'; -- Equipo Kern Pharma
UPDATE teams SET ai_source_id = 176 WHERE id = '3ae82adf-d079-4e2d-bb69-f05544748626'; -- Solution Tech NIPPO Rali
UPDATE teams SET ai_source_id = 265 WHERE id = '8ef2fe62-7515-4d21-ad3b-c9340ac24e61'; -- Camp Cycling Team
UPDATE teams SET ai_source_id = 398 WHERE id = 'e34576db-849f-45c1-91dd-a1660197e4fb'; -- Vega - Vitalcare - Dynatek
UPDATE teams SET ai_source_id = 409 WHERE id = '563b28b9-b481-4482-baa7-62a1a1b3ce90'; -- Team WolkerWessels (PCM: VolkerWessels)
UPDATE teams SET ai_source_id = 522 WHERE id = '8740a569-3590-4988-bfb6-0049a565e783'; -- Above & Beyond Cancer Cycling
UPDATE teams SET ai_source_id = 533 WHERE id = '0c7ea19c-2227-44a1-a6be-5098c3264240'; -- Trululu La Guacamaya
UPDATE teams SET ai_source_id = 603 WHERE id = '439995bf-99aa-4651-9e49-afbc96bd87b2'; -- Hopplà Team
UPDATE teams SET ai_source_id = 624 WHERE id = '8073fb4a-aee0-4d87-a90d-9472bd72c9fc'; -- Team Give Steel
UPDATE teams SET ai_source_id = 649 WHERE id = '960491ad-2e4f-4979-9f0f-23010362044e'; -- Swatt Team

-- Sanity: før commit, bekræft at vi opdaterede præcis 17 rækker.
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM teams
  WHERE ai_source_id IN (3, 6, 10, 13, 14, 26, 33, 70, 176, 265, 398, 409, 522, 533, 603, 624, 649)
    AND is_ai = false
    AND user_id IS NOT NULL;
  IF v_count <> 17 THEN
    RAISE EXCEPTION 'Forventede 17 manager-hold med PCM-mapping, fandt %', v_count;
  END IF;
END $$;

COMMIT;

-- Registrer migration i auto-migrate state-table.
INSERT INTO schema_migrations (filename, applied_at) VALUES
  ('database/2026-05-27-teams-ai-source-id-backfill.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
