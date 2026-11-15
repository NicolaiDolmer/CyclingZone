-- #8153 · Frigivelse midt i et etapeloeb venter til loebets slut.
--
-- Problemet: en rytter, der frigives midt i et etapeloeb, forsvinder fra loebet
-- fra naeste etape uden resultatraekke og uden "udgaaet". Ejerens valg (14/11):
-- frigivelsen bestilles, gebyret traekkes straks, rytteren koerer loebet faerdigt
-- og taeller i truppen, og han forlader holdet foerst efter sidste etape. En
-- bestilling er endelig. Design: docs/superpowers/specs/2026-11-14-8153-frigivelse-venter-design.md
-- (med rettelserne i docs/drafts/spec-natboelge-2026-11-15.md, afsnit S6).
--
-- Fem dele:
--   1. Kontakten release_defer_8153 (binaer, seed "off"). Slukket opretter backenden
--      aldrig en raekke, og alt er som i dag.
--   2. public.pending_rider_releases: een aktiv raekke ('pending') pr. rytter.
--      status: pending -> executed (rytteren er frigivet) eller cancelled_by_system
--      (rytteren forlod holdet ad en anden vej, foer bestillingen blev udfoert).
--      Gebyret er allerede betalt ved bestillingen; det refunderes ikke (ejer:
--      bestillingen er endelig).
--   3. order_rider_release_8153(...): i EEN transaktion under holdlaasen og
--      raekkelaasen paa rytteren: afvis ved pending_team_id, aktiv auktion eller
--      aktiv raekke, tjek saldo minus bundne penge, tjek truppens gulv med de
--      ventende frigivelser som afgaaende, indsaet raekken, luk aabne
--      salgsopslag og tilbud paa rytteren, og traek gebyret med en
--      idempotensnoegle pr. raekke (rider_release_pending:<raekke-id>).
--      team_id roeres ikke: rytteren er holdets, til loebet er slut.
--   4. execute_pending_rider_release_8153(...): idempotent udfoerelse. Raekken
--      markeres executed, rytteren frigives som ved en almindelig frigivelse
--      (team_id, kontraktfelter), og aabne salgsopslag lukkes. Ejerskabsloggen
--      skrives af den eksisterende trigger trg_record_rider_team_exit ('release').
--      Backenden rydder bagefter fremtidige loebstilmeldinger og sender beskeden.
--   5. Vagt paa riders: et holdskifte (team_id eller pending_team_id) og et
--      trupskifte (is_academy eller squad) afvises, mens rytteren har en aktiv
--      raekke. Det er det faelles stop for salg, bytte, auktion og nedrykning til
--      akademiet (demote_rider_to_academy, /academy/demote, /riders/:id/squad),
--      uanset hvilken RPC eller backend-sti der proever; backenden afviser
--      allerede ved indgangen med en forklaring (409). Udfoerelsen markerer
--      raekken executed i samme transaktion, foer rytteren flyttes, saa vagten
--      slipper den igennem. Med slukket kontakt findes ingen raekker, og vagten
--      finder intet.
--
-- Laaseraekkefoelge (samme som auto_accept_release_rider og settle_sale_escrow):
-- holdlaasen (pg_advisory_xact_lock, samme noegle som increment_balance_with_audit),
-- saa rytter-raekken, til sidst bestillings-raekken.
--
-- Ingen FK til teams/riders/races med vilje: beta-reset sletter hold, og raekken
-- er et revisionsspor. betaResetService.js rydder tabellen.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642). Ingen
-- eksisterende data roeres; tabellen er tom, til kontakten taendes.
--
-- RLS: enabled, INGEN policy, kun service_role. Klienten laeser ventende
-- frigivelser via GET /api/me/pending-releases.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT value FROM public.app_config WHERE key = 'release_defer_8153';  -- "off"
--   2. SELECT count(*) FROM public.pending_rider_releases;  -- 0
--   3. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pending_rider_releases'::regclass;  -- true
--   4. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'pending_rider_releases';  -- kun service_role (+ postgres)
--   5. SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--        FROM pg_proc p WHERE p.proname IN ('order_rider_release_8153','execute_pending_rider_release_8153','pending_rider_release_guard_8153');
--      -- anon=false, auth=false for alle tre
--   6. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.riders'::regclass AND tgname = 'riders_pending_release_guard_8153';  -- 1 raekke
--
-- Rollback (kun mens tabellen er tom):
--   DROP TRIGGER IF EXISTS riders_pending_release_guard_8153 ON public.riders;
--   DROP FUNCTION IF EXISTS public.pending_rider_release_guard_8153();
--   DROP FUNCTION IF EXISTS public.execute_pending_rider_release_8153(uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.order_rider_release_8153(uuid, uuid, uuid, bigint, jsonb, uuid, timestamptz, integer, uuid[]);
--   DROP TABLE IF EXISTS public.pending_rider_releases;
--   DELETE FROM public.app_config WHERE key = 'release_defer_8153';
--
-- Refs #8153
-- data-api-access: {"table":"public.pending_rider_releases","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Ordered rider releases waiting for the end of a stage race; only the backend writes them through order_rider_release_8153/execute_pending_rider_release_8153, beta reset deletes them"}

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Kontakten -------------------------------------------------------------
INSERT INTO public.app_config (key, value, description)
VALUES (
  'release_defer_8153',
  '"off"'::jsonb,
  'Binary flag (off|on) for #8153: with on, releasing a rider in an ongoing stage race is ordered now (fee charged) and executed after the final stage. Read server-side as binary; beta counts as off.'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Tabellen --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pending_rider_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  team_id uuid NOT NULL,
  race_id uuid NOT NULL,
  fee bigint NOT NULL CHECK (fee >= 0),
  ordered_at timestamptz NOT NULL DEFAULT now(),
  ordered_by uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'cancelled_by_system')),
  executed_at timestamptz,
  CONSTRAINT pending_rider_releases_done_shape CHECK ((status = 'pending') = (executed_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_rider_releases_one_active_per_rider
  ON public.pending_rider_releases (rider_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS pending_rider_releases_active_team_idx
  ON public.pending_rider_releases (team_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS pending_rider_releases_active_race_idx
  ON public.pending_rider_releases (race_id) WHERE status = 'pending';

ALTER TABLE public.pending_rider_releases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pending_rider_releases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pending_rider_releases TO service_role;

COMMENT ON TABLE public.pending_rider_releases IS
  '#8153: a rider release ordered while the rider rides a stage race. The fee is charged at order time; the rider leaves the team when the race is finalized (execute_pending_rider_release_8153). service_role only.';

-- 5. Vagten paa riders (foer funktionerne, saa den ogsaa gaelder for dem) ----
-- SECURITY DEFINER, saa en sti uden rettigheder paa tabellen faar den rigtige
-- afvisning og ikke en rettighedsfejl.
CREATE OR REPLACE FUNCTION public.pending_rider_release_guard_8153()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pending_rider_releases p
              WHERE p.rider_id = NEW.id AND p.status = 'pending') THEN
    IF OLD.team_id IS DISTINCT FROM NEW.team_id OR OLD.pending_team_id IS DISTINCT FROM NEW.pending_team_id THEN
      RAISE EXCEPTION 'rider_pending_release_8153: rider % is leaving his team after a stage race', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
    -- Trupskifte (fx nedrykning til akademiet): han skal koere loebet faerdigt som
    -- seniorrytter, og udfoerelsen maa ikke efterlade en akademirytter uden hold.
    RAISE EXCEPTION 'rider_pending_release_8153: rider % is leaving his team after a stage race and cannot change squad', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pending_rider_release_guard_8153() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS riders_pending_release_guard_8153 ON public.riders;
CREATE TRIGGER riders_pending_release_guard_8153
  BEFORE UPDATE OF team_id, pending_team_id, is_academy, squad ON public.riders
  FOR EACH ROW
  WHEN (OLD.team_id IS DISTINCT FROM NEW.team_id OR OLD.pending_team_id IS DISTINCT FROM NEW.pending_team_id
        OR OLD.is_academy IS DISTINCT FROM NEW.is_academy OR OLD.squad IS DISTINCT FROM NEW.squad)
  EXECUTE FUNCTION public.pending_rider_release_guard_8153();

-- 3. Bestillingen ----------------------------------------------------------
-- p_finance_payload: samme audit-payload som dagens frigivelse (type transfer_out,
-- amount -p_fee, reason_code rider_release_buyout). Noeglen saettes her.
-- p_min_riders / p_at_risk_rider_ids: truppens gulv som i auto_accept_release_rider;
-- ventende frigivelser taeller som afgaaende. Med gulvet 0 er tjekket en no-op.
CREATE OR REPLACE FUNCTION public.order_rider_release_8153(
  p_rider_id uuid,
  p_team_id uuid,
  p_race_id uuid,
  p_fee bigint,
  p_finance_payload jsonb,
  p_ordered_by uuid,
  p_now timestamptz,
  p_min_riders integer DEFAULT 0,
  p_at_risk_rider_ids uuid[] DEFAULT '{}'
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  r public.riders;
  v_existing public.pending_rider_releases;
  v_balance bigint;
  v_locked bigint := 0;
  v_count integer;
  v_pending integer;
  v_risk integer;
  v_id uuid;
BEGIN
  IF p_rider_id IS NULL OR p_team_id IS NULL OR p_race_id IS NULL OR p_now IS NULL
     OR p_fee IS NULL OR p_fee < 0 THEN
    RAISE EXCEPTION 'order_rider_release_8153: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF p_fee > 0 AND (p_finance_payload->>'type' IS DISTINCT FROM 'transfer_out'
     OR (p_finance_payload->>'amount')::bigint IS DISTINCT FROM -p_fee
     OR p_finance_payload->>'reason_code' IS DISTINCT FROM 'rider_release_buyout') THEN
    RAISE EXCEPTION 'order_rider_release_8153: invalid release audit' USING ERRCODE = '22023';
  END IF;

  PERFORM public.auto_accept_lock_teams(p_team_id, p_team_id);
  SELECT * INTO r FROM public.riders WHERE id = p_rider_id FOR UPDATE;
  IF NOT FOUND OR r.team_id IS DISTINCT FROM p_team_id OR r.pending_team_id IS NOT NULL
     OR r.is_academy OR coalesce(r.is_retired, false) THEN
    RETURN jsonb_build_object('status', 'rider_state_changed');
  END IF;

  SELECT * INTO v_existing FROM public.pending_rider_releases
   WHERE rider_id = r.id AND status = 'pending';
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_pending', 'race_id', v_existing.race_id);
  END IF;

  IF EXISTS (SELECT 1 FROM public.auctions a
              WHERE a.rider_id = r.id AND a.status IN ('active', 'extended')) THEN
    RETURN jsonb_build_object('status', 'rider_on_auction');
  END IF;

  SELECT balance INTO v_balance FROM public.teams WHERE id = p_team_id;
  IF coalesce(v_balance, 0) < p_fee THEN
    RETURN jsonb_build_object('status', 'cannot_afford_release', 'balance', coalesce(v_balance, 0), 'fee', p_fee);
  END IF;
  IF public.market_scope_2176(p_team_id, NULL) THEN
    v_locked := coalesce(public.team_market_commitment(p_team_id, NULL), 0);
  END IF;
  IF v_balance - v_locked < p_fee THEN
    RETURN jsonb_build_object('status', 'insufficient_available_balance',
      'available', greatest(v_balance - v_locked, 0), 'locked', v_locked, 'fee', p_fee);
  END IF;

  IF coalesce(p_min_riders, 0) > 0 THEN
    SELECT count(*) INTO v_count
      FROM public.riders x
     WHERE x.team_id = p_team_id AND x.pending_team_id IS NULL
       AND x.squad = 'senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired, false);
    SELECT count(*) INTO v_pending
      FROM public.pending_rider_releases p
     WHERE p.team_id = p_team_id AND p.status = 'pending';
    SELECT count(*) INTO v_risk
      FROM public.riders x
     WHERE x.id = ANY (coalesce(p_at_risk_rider_ids, '{}'))
       AND x.id <> r.id AND x.team_id = p_team_id AND x.pending_team_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.pending_rider_releases p
                        WHERE p.rider_id = x.id AND p.status = 'pending');
    IF v_count - 1 - v_pending - v_risk < p_min_riders THEN
      RETURN jsonb_build_object('status', 'squad_floor', 'min_riders', p_min_riders);
    END IF;
  END IF;

  INSERT INTO public.pending_rider_releases (rider_id, team_id, race_id, fee, ordered_at, ordered_by)
  VALUES (r.id, p_team_id, p_race_id, p_fee, p_now, p_ordered_by)
  RETURNING id INTO v_id;

  -- Rytteren kan ikke handles, mens han venter: luk det, der allerede staar aabent.
  UPDATE public.transfer_listings SET status = 'withdrawn'
   WHERE rider_id = r.id AND status IN ('open', 'negotiating');
  UPDATE public.transfer_offers SET status = 'withdrawn'
   WHERE rider_id = r.id AND status IN ('pending', 'countered', 'awaiting_confirmation');
  UPDATE public.swap_offers SET status = 'withdrawn'
   WHERE (offered_rider_id = r.id OR requested_rider_id = r.id)
     AND status IN ('pending', 'countered', 'awaiting_confirmation');

  IF p_fee > 0 THEN
    PERFORM public.increment_balance_with_audit(
      p_team_id,
      -p_fee,
      p_finance_payload || jsonb_build_object(
        'idempotency_key', 'rider_release_pending:' || v_id::text,
        'related_entity_type', 'transfer',
        'related_entity_id', r.id
      )
    );
  END IF;

  RETURN jsonb_build_object('status', 'pending', 'release_id', v_id, 'race_id', p_race_id, 'fee', p_fee);
END;
$$;

REVOKE ALL ON FUNCTION public.order_rider_release_8153(uuid, uuid, uuid, bigint, jsonb, uuid, timestamptz, integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_rider_release_8153(uuid, uuid, uuid, bigint, jsonb, uuid, timestamptz, integer, uuid[]) TO service_role;

-- 4. Udfoerelsen -----------------------------------------------------------
-- Idempotent: en raekke, der ikke laengere er 'pending', roeres ikke igen.
CREATE OR REPLACE FUNCTION public.execute_pending_rider_release_8153(
  p_release_id uuid,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  p public.pending_rider_releases;
  r public.riders;
BEGIN
  IF p_release_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'execute_pending_rider_release_8153: invalid argument' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO p FROM public.pending_rider_releases WHERE id = p_release_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  PERFORM public.auto_accept_lock_teams(p.team_id, p.team_id);
  SELECT * INTO r FROM public.riders WHERE id = p.rider_id FOR UPDATE;
  SELECT * INTO p FROM public.pending_rider_releases WHERE id = p_release_id FOR UPDATE;
  IF p.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('status', 'already_done', 'release_status', p.status);
  END IF;

  -- Rytteren har forladt holdet ad en anden vej (fx admin). Bestillingen er
  -- betalt og endelig; den lukkes uden at roere rytteren.
  IF r.id IS NULL OR r.team_id IS DISTINCT FROM p.team_id THEN
    UPDATE public.pending_rider_releases
       SET status = 'cancelled_by_system', executed_at = p_now
     WHERE id = p.id;
    RETURN jsonb_build_object('status', 'cancelled_by_system', 'rider_id', p.rider_id, 'team_id', p.team_id);
  END IF;

  -- Foerst raekken, saa rytteren: vagten paa riders ser ingen aktiv raekke.
  UPDATE public.pending_rider_releases
     SET status = 'executed', executed_at = p_now
   WHERE id = p.id;

  -- Som dagens frigivelser (auto_accept_release_rider + akademi-frigivelsen):
  -- holdet og kontrakten ryddes, og en fri rytter er altid senior uden akademi
  -- (squad og is_academy sammen, som seniorSquadPatch og graduerings-frigivelsen).
  UPDATE public.riders
     SET team_id = NULL, pending_team_id = NULL, salary = NULL,
         contract_length = NULL, contract_end_season = NULL, acquired_at = NULL,
         is_academy = false, squad = 'senior'
   WHERE id = r.id;

  UPDATE public.transfer_listings SET status = 'withdrawn'
   WHERE rider_id = r.id AND status IN ('open', 'negotiating');

  RETURN jsonb_build_object('status', 'executed', 'rider_id', r.id, 'team_id', p.team_id, 'race_id', p.race_id);
END;
$$;

REVOKE ALL ON FUNCTION public.execute_pending_rider_release_8153(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_pending_rider_release_8153(uuid, timestamptz) TO service_role;

COMMIT;
