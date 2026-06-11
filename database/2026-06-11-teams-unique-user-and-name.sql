-- #1264 · Signup-bootstrap race-conditions: DB-håndhævet unikhed på teams.
-- =====================================================================================
-- Load-testen 2026-06-11 (docs/audits/2026-06-11-load-test.md, #1174) bekræftede
-- empirisk to races i signup-bootstrap (PUT /api/teams/my):
--   1. 20 samtidige signups med samme holdnavn → 3 hold med samme navn
--      (check-then-insert i teamProfileEngine uden DB-constraint).
--   2. 5 samtidige bootstrap-kald for samme bruger → 2 hold til én bruger,
--      hvorefter requireAuths .single()-lookup fejler stille → "hold-løs" konto.
-- Disse indexes gør Postgres til autoriteten; 23505-håndteringen i
-- backend/lib/teamProfileEngine.js gør bootstrap idempotent ovenpå.
--
-- Backwards-check (prod, 2026-06-11 09:05, read-only): 0 duplikerede holdnavne
-- (case-insensitive, ALLE hold inkl. AI/bank/test) og 0 brugere med >1 hold —
-- begge indexes kan oprettes uden data-oprydning.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS. teams er lille (~29 rækker),
-- så ikke-CONCURRENT index-build er et no-op-lås-vindue.

-- 1) Én bruger = max ét hold. Partial (user_id IS NOT NULL) fordi AI-/bank-hold
--    ikke har nogen bruger, og ON DELETE SET NULL kan efterlade flere
--    user_id=NULL-rækker (frosne ex-hold) — NULL'er må aldrig kollidere.
CREATE UNIQUE INDEX IF NOT EXISTS teams_user_id_unique_idx
  ON public.teams (user_id)
  WHERE user_id IS NOT NULL;

-- 2) Case-insensitivt unikke holdnavne for alle ikke-AI-hold (manager-, test-,
--    bank- og frosne hold). AI-peloton-hold er undtaget: de seedes bulk fra
--    PCM-kilden/fiktiv-generatoren (#1262) udenom bootstrap-flowet, og en
--    fremtidig re-seed/relaunch skal ikke kunne blokeres af et navnesammenfald
--    med et historisk AI-hold. Applikations-tjekket (ensureUniqueTeamName,
--    ilike mod ALLE hold) beskytter fortsat spillere mod at tage et AI-holds
--    navn i den normale sti — dette index lukker race-vinduet for de hold
--    spillere faktisk kan oprette.
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_lower_unique_idx
  ON public.teams (lower(name))
  WHERE is_ai = false;

COMMENT ON INDEX public.teams_user_id_unique_idx IS
  '#1264: max ét hold pr. bruger — lukker dobbelt-bootstrap-racet (to samtidige PUT /api/teams/my → 2 hold → hold-løs konto).';
COMMENT ON INDEX public.teams_name_lower_unique_idx IS
  '#1264: case-insensitivt unikke holdnavne for ikke-AI-hold — lukker duplikatnavne-racet ved samtidige signups. AI-hold undtaget (bulk-seed udenom bootstrap).';
