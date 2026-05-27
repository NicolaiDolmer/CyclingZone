-- Refs #706 · backfill teams.ai_source_id for de sidste 2 manager-hold (Chris Machines + Vestas - Vov Vov Cycling)
--
-- Baggrund: PR #703 leverede mapping for 17/19 manager-hold. De 2 sidste hold
-- afventede manager-svar fra brugeren. Bruger bekræftede 2026-05-27 (eftermiddag):
--   Chris Machines           → PCM-team 25 (TotalEnergies)
--   Vestas - Vov Vov Cycling → PCM-team 95 (Team UKYO)
--
-- Sanity-check (pre-migration): teams.ai_source_id = 25 / 95 var begge ledige.
-- Begge hold har 10 hhv. 9 ryttere med pcm_id i CZ (ready til sheet-sync).
--
-- Idempotent: UPDATE ... WHERE id matcher højst én række pr. team.

BEGIN;

UPDATE teams SET ai_source_id = 25 WHERE id = '4124444f-cb87-4b50-82a2-be51a75d30fc'; -- Chris Machines (TotalEnergies)
UPDATE teams SET ai_source_id = 95 WHERE id = '197db0ff-d5c9-4a87-aaca-265886f83184'; -- Vestas - Vov Vov Cycling (Team UKYO)

-- Sanity: før commit, bekræft at vi nu har 19 manager-hold med PCM-mapping.
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM teams
  WHERE ai_source_id IS NOT NULL
    AND is_ai = false
    AND user_id IS NOT NULL;
  IF v_count <> 19 THEN
    RAISE EXCEPTION 'Forventede 19 manager-hold med PCM-mapping post-patch, fandt %', v_count;
  END IF;
END $$;

COMMIT;

INSERT INTO schema_migrations (filename, applied_at) VALUES
  ('database/2026-05-27-teams-ai-source-id-chris-vestas.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
