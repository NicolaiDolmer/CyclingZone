-- #2187: selvhelende AI-trim ved signup — marker-kolonne for udskudt AI-hold-fjernelse.
--
-- ROD-ÅRSAG (#2187, #2377): teamProfileEngine trimmer ét AI-hold pr. nyt rigtigt
-- signup (reconcileAiTeamsForPool → removeAiTeams), men er AI-holdets ryttere i et
-- IGANGVÆRENDE etapeløb (låst felt, block_rider_delete_with_inflight_entries-guarden
-- fra #2074), kan holdet ikke slettes NU. #2269 gjorde valget af kandidat sikkert
-- (springer blokerede hold over i stedet for at kaste), men intet huskede at et trim
-- stod tilbage — næste chance for at fuldføre trimmet var et NYT signup i SAMME
-- pulje, hvilket ofte aldrig sker → puljen blev hængende på 25/26 hold i stedet for
-- 24 (ejer-krav: PRÆCIS 24 hold/gruppe). Prod-evidens 12/7: Division 4 B+C, 2
-- fejlede/udskudte trims hver, aldrig selv-helet.
--
-- HVAD DENNE KOLONNE GØR
--   Markerer "dette AI-hold BURDE være trimmet, men blev udskudt pga. inflight-
--   entries" — sat første gang removeAiTeams ikke kan slette holdet. En ny
--   heal-sweep (backend/lib/aiTeamTrimHealSweep.js) retryer periodisk alle
--   markerede hold; lykkes sletningen forsvinder rækken (ingen oprydning af
--   kolonnen nødvendig — markøren lever kun så længe rækken gør).
--
-- Service-role-only (samme mønster som starter_squad_allocated_at /
-- academy_intake_seeded_at) — ikke player-facing, ingen klient-GRANT nødvendig.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Ingen backfill
-- (NULL = ikke udskudt, korrekt for alle eksisterende hold — ingen kendte udskudte
-- trims eksisterer FØR denne migration; de 9 nuværende overskudshold repareres
-- separat under ejer-go, #2377).
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_teams_pending_removal;
--   ALTER TABLE public.teams DROP COLUMN IF EXISTS pending_removal_at;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS pending_removal_at timestamptz;

-- Sweep-forespørgslen filtrerer is_ai=true AND pending_removal_at IS NOT NULL;
-- en partial index holder den billig selv når teams-tabellen vokser.
CREATE INDEX IF NOT EXISTS idx_teams_pending_removal
  ON public.teams (pending_removal_at)
  WHERE pending_removal_at IS NOT NULL;
