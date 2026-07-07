-- 2026-07-07 — Denormaliseret riders.owner_is_ai til rytter-side-toggle (#2238)
--
-- Kontekst: RidersPage + alle rytter-lister henter klient-side direkte via
-- supabase-js (PostgREST) og er server-pagineret. Vi vil kunne skjule ryttere på
-- AI-hold fra listen (default), men BEVARE fri-agenter (team_id IS NULL) — de er
-- netop de mest købbare. PostgREST kan ikke rent udtrykke "team_id IS NULL ELLER
-- team.is_ai = false" i én pagineret query: et !inner-join på team.is_ai=false
-- taber fri-agenterne, og en IN-liste på ~260 AI-hold i URL'en er ikke
-- fremtidssikker. Derfor denormaliserer vi ejerens is_ai ned på rytteren, så
-- filteret bliver et trivielt, indekserbart `owner_is_ai = false`.
--
-- Semantik: owner_is_ai = COALESCE(teams.is_ai, false). Fri-agenter (intet hold)
-- => false => vises altid. Kun ryttere på is_ai=true-hold får true.
--
-- Vedligehold via triggers (samme mønster som cleanup_ineligible_future_entries,
-- #1906): DB-niveau, så INGEN app-vej (auktion/transfer/swap/lån/release/
-- gælds-tvangssalg/akademi/sæson-generering/admin) kan efterlade flaget stale.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION +
-- DROP/CREATE TRIGGER + CREATE INDEX IF NOT EXISTS.
--
-- VERIFIKATION FØR MERGE (kør mod prod-klon eller branch-DB):
--   1) Backfill-korrekthed:
--        SELECT owner_is_ai, count(*) FROM riders GROUP BY 1;   -- ~3984 true / ~2514 false
--        SELECT count(*) FROM riders r JOIN teams t ON t.id=r.team_id
--          WHERE t.is_ai=true AND r.owner_is_ai=false;          -- = 0 (ingen AI-ejet misset)
--        SELECT count(*) FROM riders WHERE team_id IS NULL AND owner_is_ai=true; -- = 0
--   2) Trigger: flyt en test-rytter til/fra et AI-hold og bekræft owner_is_ai følger.

-- ── Kolonne ──────────────────────────────────────────────────────────────────
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS owner_is_ai boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.riders.owner_is_ai IS
  'Denormaliseret: true hvis rytterens ejende hold har is_ai=true (#2238). '
  'Fri-agenter (team_id NULL) = false. Vedligeholdt af trg_set_rider_owner_is_ai '
  '(riders) + trg_sync_riders_owner_is_ai (teams). Driver rytter-side-toggle.';

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Kolonnen fik false på alle rækker ved ADD COLUMN (fri-agenter korrekt allerede).
-- Sæt de AI-ejede til true.
UPDATE public.riders r
  SET owner_is_ai = true
  FROM public.teams t
  WHERE r.team_id = t.id
    AND t.is_ai = true
    AND r.owner_is_ai = false;

-- ── Trigger 1: hold owner_is_ai synkront når en rytter skifter hold ───────────
-- BEFORE INSERT/UPDATE OF team_id => vi kan sætte NEW direkte (ingen ekstra write).
-- Fyrer kun når team_id er target for UPDATE (eller ved INSERT) — urelaterede
-- rytter-opdateringer (form/værdi/løn) rører den ikke.
CREATE OR REPLACE FUNCTION public.set_rider_owner_is_ai()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  NEW.owner_is_ai := COALESCE(
    (SELECT t.is_ai FROM public.teams t WHERE t.id = NEW.team_id),
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_rider_owner_is_ai ON public.riders;
CREATE TRIGGER trg_set_rider_owner_is_ai
  BEFORE INSERT OR UPDATE OF team_id ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_rider_owner_is_ai();

-- ── Trigger 2: re-sync hvis et holds is_ai-flag selv ændrer sig (sjældent) ────
-- Opdaterer kun owner_is_ai (ikke team_id) => udløser IKKE trigger 1 (ingen rekursion).
CREATE OR REPLACE FUNCTION public.sync_riders_owner_is_ai()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  UPDATE public.riders
    SET owner_is_ai = NEW.is_ai
    WHERE team_id = NEW.id
      AND owner_is_ai IS DISTINCT FROM NEW.is_ai;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_riders_owner_is_ai ON public.teams;
CREATE TRIGGER trg_sync_riders_owner_is_ai
  AFTER UPDATE OF is_ai ON public.teams
  FOR EACH ROW
  WHEN (NEW.is_ai IS DISTINCT FROM OLD.is_ai)
  EXECUTE FUNCTION public.sync_riders_owner_is_ai();

-- ── Index ────────────────────────────────────────────────────────────────────
-- Default-visningen (skjul AI) filtrerer owner_is_ai=false + is_retired=false.
-- Partial index dækker netop den hyppige sti uden at fylde på fuld-visningen.
CREATE INDEX IF NOT EXISTS idx_riders_tradeable
  ON public.riders (market_value DESC)
  WHERE owner_is_ai = false AND is_retired = false;

-- PostgREST schema-cache reload (ny kolonne).
NOTIFY pgrst, 'reload schema';
