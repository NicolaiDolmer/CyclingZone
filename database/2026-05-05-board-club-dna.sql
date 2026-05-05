-- S-02f · Klub-DNA (håndlavede klub-identiteter)
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md (Q-batch 1B Q10 + Appendix D)
--
-- Tilføjer:
--   1. team_dna — reference-tabel med 5 håndlavede DNA-arketyper (seedet inline her)
--   2. teams.team_dna_key — manageren's valgte DNA (NULL indtil valgt i sæson 2)
--   3. teams.team_dna_chosen_at — timestamp for valg (sporing + drift-baseline senere)
--
-- Q-bekræftelser (2026-05-05 session):
--   - 5 DNA-arketyper låst (Appendix D): skandinavisk_udvikling, italiensk_klassiker,
--     sprint_kommerciel, fransk_klatrer, britisk_allrounder
--   - Tildeles ved sæson-2-onboarding (efter season_1_identity_basis er observeret)
--   - 3 forslag computed algoritmisk fra national_core + primary_specialization
--   - Manager vælger frit fra de 3 — DNA er final indtil drift-mekanik leveres (S-02f.1)
--
-- AI/bank/frozen teams får IKKE DNA (Q-batch 1A Q8 — manager-only).
-- Drift-mekanik (gradvis udvikling over 5 sæsoner) defereres til opfølgnings-slice.

BEGIN;

CREATE TABLE IF NOT EXISTS team_dna (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  emoji TEXT NOT NULL,
  short_description TEXT NOT NULL,
  long_description TEXT NOT NULL,
  policy_axes JSONB NOT NULL,
  national_affinity TEXT[] NOT NULL DEFAULT '{}',
  specialization_affinity TEXT[] NOT NULL DEFAULT '{}',
  member_alignment_bonus JSONB NOT NULL DEFAULT '{}',
  goal_weighting JSONB NOT NULL DEFAULT '{}',
  tradition_goal JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE team_dna IS
  'S-02f: 5 håndlavede klub-DNA-arketyper. Reference-data — kode-konsulteret via boardClubDna.js, men persisteret i DB så frontend kan render uden klient-import. policy_axes matcher boardArchetypes.policy_axes for friction-detection. member_alignment_bonus og goal_weighting bruges af engines til subtil bias.';

INSERT INTO team_dna (key, label, emoji, short_description, long_description, policy_axes, national_affinity, specialization_affinity, member_alignment_bonus, goal_weighting, tradition_goal) VALUES
  ('skandinavisk_udvikling',
   'Skandinavisk udviklingshold',
   '🌲',
   'Ungdom, balance og nordisk arv',
   'Vi bygger ryttere op fra grunden — tålmodighed, struktur og nordisk arbejdsmoral. Sponsorerne forventer udvikling, ikke fyrværkeri.',
   '{"results_pressure":"low","financial_caution":"high","debt_aversion":"high","youth_focus":"high","national_identity":"medium","classics_focus":"low","gc_focus":"low","sponsor_growth_demand":"low"}'::jsonb,
   ARRAY['NO','DK','SE','FI','IS'],
   ARRAY['youth','balanced'],
   '{"talentspejderen":3,"ungdomsidealisten":3,"sponsoraten":-1,"resultatjaegeren":-2}'::jsonb,
   '{"u25_development_delta":1.4,"signature_rider":0.8,"min_national_riders":1.2,"profitable_transfers":1.1}'::jsonb,
   '{"type":"u25_development_delta","target":3,"label":"Udvikl talenterne — gnsn. +3 stat-pts/sæson på U25"}'::jsonb
  ),
  ('italiensk_klassiker',
   'Italiensk klassiker-traditionalist',
   '🪨',
   'Foråret er hellig — monumenter er målet',
   'Klubben er bygget på asfalt fra Lombardiet og Strade Bianche. Vores fans drømmer om Sanremo og Lombardia — ikke om Tour de France-podier.',
   '{"results_pressure":"high","financial_caution":"medium","debt_aversion":"medium","youth_focus":"low","national_identity":"high","classics_focus":"high","gc_focus":"low","sponsor_growth_demand":"medium"}'::jsonb,
   ARRAY['IT'],
   ARRAY['classics','breakaway'],
   '{"klassiker_purist":4,"traditionalisten":2,"resultatjaegeren":1,"gc_elsker":-2}'::jsonb,
   '{"monument_podium":1.6,"jersey_wins":1.0,"min_national_riders":1.2,"u25_development_delta":0.7}'::jsonb,
   '{"type":"monument_podium","target":1,"label":"Mindst ét Monument-podie pr. plan-cyklus"}'::jsonb
  ),
  ('sprint_kommerciel',
   'Sprint-fokuseret kommerciel',
   '⚡',
   'Sejre i mål — sponsorer i ryggen',
   'Vores rytter skal være den første over stregen og foran kameraerne. Sponsorvækst kommer fra synlighed, og synlighed kommer fra etapesejre.',
   '{"results_pressure":"high","financial_caution":"low","debt_aversion":"low","youth_focus":"low","national_identity":"low","classics_focus":"low","gc_focus":"low","sponsor_growth_demand":"high"}'::jsonb,
   ARRAY[]::TEXT[],
   ARRAY['sprint'],
   '{"sponsoraten":3,"resultatjaegeren":3,"klassiker_purist":-1,"ungdomsidealisten":-2}'::jsonb,
   '{"jersey_wins":1.5,"signature_rider":1.3,"profitable_transfers":1.1,"u25_development_delta":0.6}'::jsonb,
   '{"type":"jersey_wins","target":2,"label":"Vind mindst 2 etape-trøjer pr. sæson (sprint-mæssigt fokus)"}'::jsonb
  ),
  ('fransk_klatrer',
   'Fransk klatrer-arv',
   '⛰️',
   'Tour-bjerge er klubbens hjem',
   'Vi har klatret med Anquetil, Hinault og Pinot. Bjergene definerer os — og Tour de France er stadig kalenderens vigtigste søndag.',
   '{"results_pressure":"high","financial_caution":"medium","debt_aversion":"medium","youth_focus":"medium","national_identity":"high","classics_focus":"low","gc_focus":"high","sponsor_growth_demand":"medium"}'::jsonb,
   ARRAY['FR'],
   ARRAY['gc','breakaway'],
   '{"gc_elsker":4,"traditionalisten":2,"nationalist_purist":2,"sponsoraten":-1}'::jsonb,
   '{"signature_rider":1.3,"min_national_riders":1.4,"jersey_wins":1.0,"monument_podium":0.7}'::jsonb,
   '{"type":"min_national_riders","target":4,"nationality_code":"FR","label":"Min. 4 franske ryttere i truppen"}'::jsonb
  ),
  ('britisk_allrounder',
   'Britisk all-rounder',
   '🎯',
   'Disciplin på tværs — datadrevet og bredt',
   'Sky-skolen lever videre. Vi vinder på struktur, marginal gains og bredde — fra Roubaix til Andorra. Ingen disciplin er klubbens, men alle er.',
   '{"results_pressure":"medium","financial_caution":"medium","debt_aversion":"medium","youth_focus":"medium","national_identity":"medium","classics_focus":"medium","gc_focus":"medium","sponsor_growth_demand":"medium"}'::jsonb,
   ARRAY['GB','IE'],
   ARRAY['balanced','gc','classics'],
   '{"pragmatikeren":4,"talentspejderen":1,"resultatjaegeren":1,"klassiker_purist":1}'::jsonb,
   '{"relative_rank":1.3,"profitable_transfers":1.2,"signature_rider":1.0,"u25_development_delta":1.0}'::jsonb,
   '{"type":"relative_rank","target":3,"label":"Top-3 i division (bred præstation)"}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS team_dna_key TEXT REFERENCES team_dna(key) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_dna_chosen_at TIMESTAMPTZ;

COMMENT ON COLUMN teams.team_dna_key IS
  'S-02f: Manageren''s valgte klub-DNA. NULL indtil valgt i sæson 2-onboarding. Tildeles via POST /api/board/dna-choose efter season_1_identity_basis er observeret. AI/bank/frozen teams får ALDRIG DNA.';

COMMENT ON COLUMN teams.team_dna_chosen_at IS
  'S-02f: Tidspunkt for DNA-valg — bruges senere som drift-baseline (S-02f.1).';

CREATE INDEX IF NOT EXISTS idx_teams_team_dna_key
  ON teams(team_dna_key) WHERE team_dna_key IS NOT NULL;

COMMIT;
