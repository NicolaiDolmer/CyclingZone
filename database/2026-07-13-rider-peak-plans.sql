-- Race Engine v3 (#2224), slice S5 — form-peaks som spillerens våben.
-- Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md (§10/§11.4)
--   + docs/superpowers/specs/2026-07-13-s5-peak-planner-cockpit-addendum.md (§4).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/
-- execute_sql er kørt af agenten. Idempotent (CREATE TABLE IF NOT EXISTS,
-- DROP POLICY IF EXISTS + genskab).

-- ── rider_peak_plans — op til 2 peak-vinduer pr. (rytter, sæson) ──────────────
-- Manageren udpeger et mål-løb; window_start/end afledes (snap ~5 dage om løbet,
-- addendum §2). Motoren (backend/lib/racePeaks.js) sammenligner etape-dato mod
-- vinduet og lægger peak-komponenten på finalScore; payback i N dage efter.
-- target_race_id bevares til UI (race-fokus) + story-tag `perfect_peak` (S6).
-- window_start/end er DATOER (kalenderen mapper game-day→ISO-dato server-side,
-- /api/races/calendar), konsistent med parent §11.4.
-- locked_at sættes 3 dage før window_start (håndhæves i API); NULL = redigerbar.
-- Maks 2 pr. (rider, season): håndhæves i API (count-check) + harness-oracle —
-- IKKE en DB-constraint (samme mønster som andre bløde kapacitets-grænser).
CREATE TABLE IF NOT EXISTS public.rider_peak_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  target_race_id uuid REFERENCES public.races(id) ON DELETE SET NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end >= window_start),
  UNIQUE (rider_id, season_id, target_race_id)
);

CREATE INDEX IF NOT EXISTS idx_rider_peak_plans_rider ON public.rider_peak_plans(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_peak_plans_season ON public.rider_peak_plans(season_id);

ALTER TABLE public.rider_peak_plans ENABLE ROW LEVEL SECURITY;

-- RLS: peak-planer er PRIVATE pr. hold (strategisk, som race_stage_roles' taktik
-- — IKKE offentlige som race_incidents). SELECT for rytterens holdejer (join
-- riders.team_id → teams.user_id = auth.uid()); rival-neutraliserings-tælleren i
-- cockpittet er et server-side AGGREGAT (service_role), ikke eksponering af
-- individuelle rival-planer. Write = service_role (backend bypasser RLS; maks-2
-- + snap-vindue + lås-3-dage-før håndhæves i API) + admin.
DROP POLICY IF EXISTS "rider_peak_plans_owner_select" ON public.rider_peak_plans;
CREATE POLICY "rider_peak_plans_owner_select"
  ON public.rider_peak_plans FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      JOIN public.teams t ON t.id = r.team_id
      WHERE r.id = rider_peak_plans.rider_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rider_peak_plans_admin_write" ON public.rider_peak_plans;
CREATE POLICY "rider_peak_plans_admin_write"
  ON public.rider_peak_plans FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.rider_peak_plans IS
  '#2224 (S5): op til 2 form-peak-vinduer pr. (rytter, sæson), hvert rettet mod et mål-løb. Motoren (backend/lib/racePeaks.js) lægger peak-komponenten på finalScore i vinduet (realiseret = PEAK_MAX x traeningskvalitet, addendum §2) + payback efter. Skrives KUN naar race_engine_v3_scoring er ON. Privat pr. hold (RLS ejer-scoped SELECT).';
