-- #6181 + #2176 · Pengelaas M1: laaste salgspenge (sale_escrows) og de to RPC'er
-- der holder og afregner dem. INGEN kaldere i denne PR: koden bruger dem foerst
-- i PR 3 bag flaget sale_escrow_enabled (ejer-go kraeves til flippet).
--
-- Problemet (ejer-beslutning 1, 7/11): naar et holdskifte parkeres (rytteren
-- koerer et etapeloeb faerdigt for saelger), krediteres saelger i dag med det
-- samme og kan bruge pengene, foer koeberen har faaet rytteren. Med M1 betaler
-- koeberen stadig ved handlen, men beloebet ligger i sale_escrows, og saelger
-- krediteres foerst naar rytteren faktisk skifter hold. Ved oejeblikkeligt skifte
-- bruges escrow ikke; den sti er uaendret.
--
-- Fire dele:
--   1. public.sale_escrows: en raekke pr. parkeret handel (transfer, auktion,
--      bytte med kontanter). UNIQUE (deal_type, deal_id) goer oprettelsen
--      idempotent. En rytter kan hoejst vaere i een holdt escrow ad gangen
--      (haandhaeves i hold_sale_escrow under raekkelaas paa rytterne).
--   1b. Varigt leveringsbevis: en trigger paa riders noterer i
--      delivered_rider_ids, naar en rytter i en holdt escrow faar sit maalhold
--      som team_id, uanset hvilken sti der flyttede ham. Saa kan en senere
--      parkering eller et videresalg aldrig skjule, at koeberen fik rytteren,
--      og en refusion afvises.
--   2. public.hold_sale_escrow(...): i EEN transaktion opretter den escrow'en
--      og traekker koeberen. Rytterne skal allerede vaere parkeret mod deres
--      maalhold (pending_team_id). Koeberens finance-noegle er den samme som i
--      dag (transfer_buyer:, auction_winner:, swap_payer:), saa en gentagelse
--      eller en halvfaerdig handel fra den gamle sti aldrig traekker to gange.
--      Er saelgeren allerede krediteret efter den gamle sti, oprettes ingen
--      escrow (ellers kunne en senere refusion skabe penge).
--   3. public.settle_sale_escrow(...): i EEN transaktion afregnes escrow'en.
--      release: alle ryttere skal vaere parkeret mod maalholdet eller allerede
--      ankommet; de parkerede flyttes (team_id, acquired_at), og saelger
--      krediteres med samme noegle som i dag (transfer_seller:, auction_seller:,
--      swap_receiver:). Et bytte frigives derfor foerst, naar begge ryttere er
--      flyttet. refund: ingen rytter maa vaere leveret; parkeringen ryddes, og
--      koeberen faar beloebet tilbage (noegle sale_escrow_refund:<escrow-id>).
--      Ny reason_code: sale_escrow_refund (laeses kun af de kommende kaldere).
--
-- Kaldernes ansvar (PR 3): beslutte HVORNAAR en rytter maa flyttes (samme regel
-- som flushen i stageRaceTransferDefer.js), samt sideeffekterne efter en
-- release/refund: ryd fremtidige loebstilmeldinger, ejerskabslog, beskeder og
-- trup-gendannelse ved refusion. RPC'en returnerer de flyttede ryttere.
--
-- Laaseraekkefoelge (deadlock-fri, samme som de eksisterende RPC'er, fx
-- demote_rider_to_academy): foerst holdlaasene (pg_advisory_xact_lock paa begge
-- hold i fast raekkefoelge), saa rytter-raekkerne (sorteret), til sidst
-- escrow-raekken. Leverings-triggeren laaser ogsaa rytter foer escrow.
-- increment_balance_with_audit tager en holdlaas, transaktionen allerede har.
--
-- Ingen FK til teams/riders med vilje: beta-reset sletter hold (reset-fk-audit
-- #1471), og en escrow er et revisionsspor, der hverken maa blokere eller
-- kaskade-slettes. betaResetService laeres escrow i PR 3.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- Ingen data roeres; tabellen er tom indtil PR 3.
--
-- RLS: enabled, INGEN policy, kun service_role. Klienten laeser/skriver aldrig
-- tabellen direkte (visning af laaste penge gaar via backend, PR 4).
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT count(*) FROM public.sale_escrows;  -- 0
--   2. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sale_escrows'::regclass;  -- true
--   3. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'sale_escrows';  -- kun service_role (+ postgres)
--   4. SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--        FROM pg_proc p WHERE p.proname IN ('hold_sale_escrow','settle_sale_escrow','sale_escrow_finance_key','sale_escrow_mark_delivery','sale_escrow_lock_teams');
--      -- anon=false, auth=false for alle fem
--   5. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.riders'::regclass AND tgname = 'riders_sale_escrow_delivery';  -- 1 raekke
--
-- Rollback (kun mens tabellen er tom):
--   DROP TRIGGER IF EXISTS riders_sale_escrow_delivery ON public.riders;
--   DROP FUNCTION IF EXISTS public.sale_escrow_mark_delivery();
--   DROP FUNCTION IF EXISTS public.settle_sale_escrow(uuid, text, jsonb, timestamptz);
--   DROP FUNCTION IF EXISTS public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.sale_escrow_lock_teams(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.sale_escrow_finance_key(text, text, uuid);
--   DROP TABLE IF EXISTS public.sale_escrows;
--
-- Refs #6181 #2176
-- data-api-access: {"table":"public.sale_escrows","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE"]},"reason":"Locked sale proceeds; only the backend writes them through hold_sale_escrow/settle_sale_escrow, never deleted (audit trail)"}

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.sale_escrows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_type text NOT NULL CHECK (deal_type IN ('transfer', 'auction', 'swap')),
  deal_id uuid NOT NULL,
  payer_team_id uuid NOT NULL,
  payee_team_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  rider_ids uuid[] NOT NULL,
  target_team_ids uuid[] NOT NULL,
  payee_payload jsonb NOT NULL,
  delivered_rider_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT sale_escrows_deal_unique UNIQUE (deal_type, deal_id),
  CONSTRAINT sale_escrows_distinct_teams CHECK (payer_team_id <> payee_team_id),
  CONSTRAINT sale_escrows_rider_shape CHECK (
    cardinality(rider_ids) BETWEEN 1 AND 2
    AND cardinality(target_team_ids) = cardinality(rider_ids)
    AND array_position(rider_ids, NULL) IS NULL
    AND array_position(target_team_ids, NULL) IS NULL
  ),
  CONSTRAINT sale_escrows_settled_shape CHECK ((status = 'held') = (settled_at IS NULL))
);

CREATE INDEX IF NOT EXISTS sale_escrows_held_riders_idx
  ON public.sale_escrows USING gin (rider_ids) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS sale_escrows_held_payee_idx
  ON public.sale_escrows (payee_team_id) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS sale_escrows_held_payer_idx
  ON public.sale_escrows (payer_team_id) WHERE status = 'held';

ALTER TABLE public.sale_escrows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sale_escrows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sale_escrows TO service_role;

COMMENT ON TABLE public.sale_escrows IS
  '#6181: locked sale proceeds for a parked team change. The buyer has paid; the seller is credited by settle_sale_escrow when the rider actually moves (or the buyer is refunded). Written only through hold_sale_escrow/settle_sale_escrow. service_role only.';

-- Finance-noeglerne er de samme som de nuvaerende stier bruger, saa escrow og
-- den gamle sti aldrig kan bogfoere den samme betaling to gange.
CREATE OR REPLACE FUNCTION public.sale_escrow_finance_key(p_deal_type text, p_side text, p_deal_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_deal_type || ':' || p_side
    WHEN 'transfer:payer' THEN 'transfer_buyer:'
    WHEN 'transfer:payee' THEN 'transfer_seller:'
    WHEN 'auction:payer'  THEN 'auction_winner:'
    WHEN 'auction:payee'  THEN 'auction_seller:'
    WHEN 'swap:payer'     THEN 'swap_payer:'
    WHEN 'swap:payee'     THEN 'swap_receiver:'
  END || p_deal_id::text
$$;

-- Holdlaase i fast raekkefoelge. Samme noegle som increment_balance_with_audit,
-- saa en escrow-afregning og enhver anden pengebevaegelse paa holdet serialiseres.
CREATE OR REPLACE FUNCTION public.sale_escrow_lock_teams(p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(least(p_a, p_b)::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(greatest(p_a, p_b)::text, 0));
END;
$$;

-- Varigt leveringsbevis (se 1b i headeren). Koerer under raekkelaasen paa
-- rytteren og laaser derefter escrow-raekken: samme raekkefoelge som settle.
-- SECURITY DEFINER, saa en sti der flytter ryttere uden rettigheder paa
-- sale_escrows aldrig fejler paa grund af triggeren.
CREATE OR REPLACE FUNCTION public.sale_escrow_mark_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.sale_escrows e
     SET delivered_rider_ids = array_append(e.delivered_rider_ids, NEW.id)
   WHERE e.status = 'held'
     AND e.rider_ids @> ARRAY[NEW.id]
     AND NOT (e.delivered_rider_ids @> ARRAY[NEW.id])
     AND e.target_team_ids[array_position(e.rider_ids, NEW.id)] = NEW.team_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS riders_sale_escrow_delivery ON public.riders;
CREATE TRIGGER riders_sale_escrow_delivery
  AFTER UPDATE OF team_id ON public.riders
  FOR EACH ROW
  WHEN (NEW.team_id IS NOT NULL AND OLD.team_id IS DISTINCT FROM NEW.team_id)
  EXECUTE FUNCTION public.sale_escrow_mark_delivery();

CREATE OR REPLACE FUNCTION public.hold_sale_escrow(
  p_deal_type text,
  p_deal_id uuid,
  p_payer_team_id uuid,
  p_payee_team_id uuid,
  p_amount bigint,
  p_rider_ids uuid[],
  p_target_team_ids uuid[],
  p_payer_payload jsonb,
  p_payee_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_n integer := coalesce(cardinality(p_rider_ids), 0);
  v_existing public.sale_escrows;
  v_id uuid;
  v_payer_key text;
  v_payee_key text;
  v_parked integer;
  v_payer_already boolean := false;
BEGIN
  -- Programmeringsfejl hos kalderen kastes; tilstandskonflikter returneres som status.
  IF p_deal_type IS NULL OR p_deal_type NOT IN ('transfer', 'auction', 'swap') THEN
    RAISE EXCEPTION 'hold_sale_escrow: unknown deal_type %', p_deal_type USING ERRCODE = '22023';
  END IF;
  IF p_deal_id IS NULL OR p_payer_team_id IS NULL OR p_payee_team_id IS NULL THEN
    RAISE EXCEPTION 'hold_sale_escrow: deal_id, payer and payee are required' USING ERRCODE = '22023';
  END IF;
  IF p_payer_team_id = p_payee_team_id THEN
    RAISE EXCEPTION 'hold_sale_escrow: payer and payee must differ' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'hold_sale_escrow: amount must be positive' USING ERRCODE = '22023';
  END IF;
  IF v_n NOT BETWEEN 1 AND 2
     OR coalesce(cardinality(p_target_team_ids), 0) <> v_n
     OR array_position(p_rider_ids, NULL) IS NOT NULL
     OR array_position(p_target_team_ids, NULL) IS NOT NULL
     OR (p_deal_type = 'swap') <> (v_n = 2) THEN
    RAISE EXCEPTION 'hold_sale_escrow: rider/target shape does not match deal_type %', p_deal_type USING ERRCODE = '22023';
  END IF;
  IF p_deal_type <> 'swap' AND p_target_team_ids[1] <> p_payer_team_id THEN
    RAISE EXCEPTION 'hold_sale_escrow: the rider must go to the payer' USING ERRCODE = '22023';
  END IF;
  IF p_deal_type = 'swap' AND (
       p_rider_ids[1] = p_rider_ids[2]
    OR p_target_team_ids[1] = p_target_team_ids[2]
    OR NOT (p_target_team_ids <@ ARRAY[p_payer_team_id, p_payee_team_id])) THEN
    RAISE EXCEPTION 'hold_sale_escrow: a swap moves two riders between payer and payee' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payer_payload) IS DISTINCT FROM 'object' OR p_payer_payload->>'type' IS DISTINCT FROM 'transfer_out' THEN
    RAISE EXCEPTION 'hold_sale_escrow: payer payload must be a transfer_out object' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payee_payload) IS DISTINCT FROM 'object' OR p_payee_payload->>'type' IS DISTINCT FROM 'transfer_in' THEN
    RAISE EXCEPTION 'hold_sale_escrow: payee payload must be a transfer_in object' USING ERRCODE = '22023';
  END IF;

  v_payer_key := public.sale_escrow_finance_key(p_deal_type, 'payer', p_deal_id);
  v_payee_key := public.sale_escrow_finance_key(p_deal_type, 'payee', p_deal_id);

  -- Holdlaase foerst, saa rytter-raekkerne i fast raekkefoelge (se headeren):
  -- to samtidige hold paa samme rytter (eller en settle) serialiseres her.
  PERFORM public.sale_escrow_lock_teams(p_payer_team_id, p_payee_team_id);
  PERFORM 1 FROM public.riders WHERE id = ANY (p_rider_ids) ORDER BY id FOR UPDATE;

  SELECT * INTO v_existing FROM public.sale_escrows
   WHERE deal_type = p_deal_type AND deal_id = p_deal_id;
  IF FOUND THEN
    IF v_existing.payer_team_id <> p_payer_team_id
       OR v_existing.payee_team_id <> p_payee_team_id
       OR v_existing.amount <> p_amount
       OR v_existing.rider_ids <> p_rider_ids
       OR v_existing.target_team_ids <> p_target_team_ids THEN
      RAISE EXCEPTION 'hold_sale_escrow: % % already has a different escrow', p_deal_type, p_deal_id USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('status', 'exists', 'escrow_id', v_existing.id, 'escrow_status', v_existing.status);
  END IF;

  SELECT count(*) INTO v_parked
    FROM unnest(p_rider_ids, p_target_team_ids) AS t(rider_id, target_team_id)
    JOIN public.riders r ON r.id = t.rider_id
   WHERE r.pending_team_id = t.target_team_id
     AND r.team_id IS DISTINCT FROM t.target_team_id;
  IF v_parked <> v_n THEN
    RETURN jsonb_build_object('status', 'not_parked');
  END IF;

  IF EXISTS (SELECT 1 FROM public.sale_escrows WHERE status = 'held' AND rider_ids && p_rider_ids) THEN
    RETURN jsonb_build_object('status', 'rider_already_escrowed');
  END IF;

  -- Den gamle sti har allerede betalt saelger: en escrow her ville kunne
  -- refundere koeberen oven i saelgers penge.
  IF EXISTS (SELECT 1 FROM public.finance_transactions WHERE idempotency_key = v_payee_key) THEN
    RETURN jsonb_build_object('status', 'payee_already_credited');
  END IF;

  INSERT INTO public.sale_escrows (deal_type, deal_id, payer_team_id, payee_team_id, amount, rider_ids, target_team_ids, payee_payload)
  VALUES (p_deal_type, p_deal_id, p_payer_team_id, p_payee_team_id, p_amount, p_rider_ids, p_target_team_ids, p_payee_payload)
  RETURNING id INTO v_id;

  -- Koeberen traekkes med den eksisterende noegle. Findes posten allerede (fx en
  -- handel, den gamle sti naaede at debitere), traekkes der ikke igen.
  BEGIN
    PERFORM public.increment_balance_with_audit(
      p_payer_team_id,
      -p_amount,
      p_payer_payload || jsonb_build_object(
        'amount', -p_amount,
        'idempotency_key', v_payer_key,
        'related_entity_type', p_deal_type,
        'related_entity_id', p_deal_id
      )
    );
  EXCEPTION WHEN unique_violation THEN
    v_payer_already := true;
  END;

  RETURN jsonb_build_object('status', 'held', 'escrow_id', v_id, 'payer_already_debited', v_payer_already);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_sale_escrow(
  p_escrow_id uuid,
  p_outcome text,
  p_refund_payload jsonb DEFAULT NULL,
  p_settled_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  e public.sale_escrows;
  v_n integer;
  v_parked integer;
  v_arrived integer;
  v_riders uuid[];
  v_key text;
  v_already boolean := false;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('release', 'refund') THEN
    RAISE EXCEPTION 'settle_sale_escrow: outcome must be release or refund' USING ERRCODE = '22023';
  END IF;
  IF p_settled_at IS NULL THEN
    RAISE EXCEPTION 'settle_sale_escrow: settled_at is required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'refund' AND (jsonb_typeof(p_refund_payload) IS DISTINCT FROM 'object'
                               OR p_refund_payload->>'type' IS DISTINCT FROM 'transfer_in') THEN
    RAISE EXCEPTION 'settle_sale_escrow: refund payload must be a transfer_in object' USING ERRCODE = '22023';
  END IF;

  -- Laaseraekkefoelge (se headeren): hold, ryttere, escrow. Hold og ryttere i en
  -- escrow aendres aldrig, saa de kan laeses foer laasene; status laeses igen
  -- under raekkelaasen.
  SELECT * INTO e FROM public.sale_escrows WHERE id = p_escrow_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  PERFORM public.sale_escrow_lock_teams(e.payer_team_id, e.payee_team_id);
  PERFORM 1 FROM public.riders WHERE id = ANY (e.rider_ids) ORDER BY id FOR UPDATE;
  SELECT * INTO e FROM public.sale_escrows WHERE id = p_escrow_id FOR UPDATE;
  IF e.status <> 'held' THEN
    RETURN jsonb_build_object('status', 'already_settled', 'escrow_status', e.status);
  END IF;

  v_n := cardinality(e.rider_ids);

  -- Leveret = varigt bevis fra triggeren ELLER rytteren staar paa maalholdet nu
  -- (ogsaa hvis koeberen allerede har parkeret ham videre).
  SELECT count(*) FILTER (WHERE NOT (t.rider_id = ANY (e.delivered_rider_ids) OR r.team_id = t.target_team_id)
                            AND r.pending_team_id = t.target_team_id),
         count(*) FILTER (WHERE t.rider_id = ANY (e.delivered_rider_ids) OR r.team_id = t.target_team_id)
    INTO v_parked, v_arrived
    FROM unnest(e.rider_ids, e.target_team_ids) AS t(rider_id, target_team_id)
    -- LEFT JOIN (Codex #7853): en leveret rytter, hvis raekke siden er slettet
    -- (fx deleteRiderWithCleanup), taeller stadig som leveret via beviset.
    LEFT JOIN public.riders r ON r.id = t.rider_id;

  IF p_outcome = 'release' THEN
    -- Hver rytter skal kunne leveres: parkeret mod maalholdet eller allerede leveret.
    IF v_parked + v_arrived <> v_n THEN
      RETURN jsonb_build_object('status', 'not_deliverable');
    END IF;

    -- Kun ryttere, der aldrig er leveret, flyttes: en leveret rytter, der siden
    -- er parkeret i en ny handel, tilhoerer den handel.
    WITH moved AS (
      UPDATE public.riders r
         SET team_id = t.target_team_id, pending_team_id = NULL, acquired_at = p_settled_at
        FROM unnest(e.rider_ids, e.target_team_ids) AS t(rider_id, target_team_id)
       WHERE r.id = t.rider_id AND r.pending_team_id = t.target_team_id
         AND r.team_id IS DISTINCT FROM t.target_team_id
         AND NOT (t.rider_id = ANY (e.delivered_rider_ids))
      RETURNING r.id
    )
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_riders FROM moved;

    v_key := public.sale_escrow_finance_key(e.deal_type, 'payee', e.deal_id);
    BEGIN
      PERFORM public.increment_balance_with_audit(
        e.payee_team_id,
        e.amount,
        e.payee_payload || jsonb_build_object(
          'amount', e.amount,
          'idempotency_key', v_key,
          'related_entity_type', e.deal_type,
          'related_entity_id', e.deal_id
        )
      );
    EXCEPTION WHEN unique_violation THEN
      v_already := true;
    END;

    UPDATE public.sale_escrows SET status = 'released', settled_at = p_settled_at WHERE id = e.id;
    RETURN jsonb_build_object('status', 'released', 'escrow_id', e.id, 'moved_rider_ids', to_jsonb(v_riders),
                              'payee_already_credited', v_already);
  END IF;

  -- refund: koeberen maa aldrig faa baade rytter og penge.
  IF v_arrived > 0 THEN
    RETURN jsonb_build_object('status', 'already_delivered');
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_transactions
              WHERE idempotency_key = public.sale_escrow_finance_key(e.deal_type, 'payee', e.deal_id)) THEN
    RETURN jsonb_build_object('status', 'payee_already_credited');
  END IF;

  -- Ingen rytter er leveret (tjekket ovenfor), saa en parkering mod maalholdet
  -- tilhoerer denne handel.
  WITH unparked AS (
    UPDATE public.riders r
       SET pending_team_id = NULL
      FROM unnest(e.rider_ids, e.target_team_ids) AS t(rider_id, target_team_id)
     WHERE r.id = t.rider_id AND r.pending_team_id = t.target_team_id
    RETURNING r.id
  )
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_riders FROM unparked;

  v_key := 'sale_escrow_refund:' || e.id::text;
  BEGIN
    PERFORM public.increment_balance_with_audit(
      e.payer_team_id,
      e.amount,
      p_refund_payload || jsonb_build_object(
        'amount', e.amount,
        'reason_code', 'sale_escrow_refund',
        'idempotency_key', v_key,
        'related_entity_type', e.deal_type,
        'related_entity_id', e.deal_id
      )
    );
  EXCEPTION WHEN unique_violation THEN
    v_already := true;
  END;

  UPDATE public.sale_escrows SET status = 'refunded', settled_at = p_settled_at WHERE id = e.id;
  RETURN jsonb_build_object('status', 'refunded', 'escrow_id', e.id, 'unparked_rider_ids', to_jsonb(v_riders),
                            'payer_already_refunded', v_already);
END;
$$;

REVOKE ALL ON FUNCTION public.sale_escrow_finance_key(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_escrow_finance_key(text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sale_escrow_lock_teams(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_escrow_lock_teams(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sale_escrow_mark_delivery() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.settle_sale_escrow(uuid, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_sale_escrow(uuid, text, jsonb, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
