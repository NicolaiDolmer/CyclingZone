-- #7664 · Faerdig-signal for skyggens genopbygning (Codex P1 paa PR #8140).
--
-- Problemet: naar ranking_shadow_enabled taendes (eller taendes igen), sletter
-- ranking_shadow_flag_changed() koeen og laegger en frisk 'rebuild'-markoer.
-- apply_ranking_deltas folder markoeren ud til en 'race'-post pr. loeb (+ en
-- 'season'-post pr. saeson, der allerede har raekker) og behandler dem i mange
-- omgange. De udfoldede poster faar ny enqueued_at, saa koeens alder er naer
-- nul hele vejen igennem. Koe-alder alene beviser derfor ikke, at
-- skyggetabellerne er faerdige: de kan vaere tomme (foerste taending), have
-- forældede tal fra en slukket periode eller vaere halvt genopbygget.
--
-- Signalet her er sandt uden at roere apply_ranking_deltas eller resultat-
-- skrivningens varme vej:
--   1. En 'rebuild'-markoer i koeen (fra kontaktskift, TRUNCATE eller
--      foerste installation) nulstiller tilstanden til "ikke faerdig" via en
--      raekke-trigger med WHEN (kun markoerer kalder funktionen).
--   2. Markoeren og hele dens udfoldning slettes/indsaettes i SAMME
--      transaktion (apply_ranking_deltas). Ser en laesning markoeren vaek, er
--      alle udfoldede poster derfor synlige, og de har id <= koeens max(id) i
--      det oejeblik. Det id gemmes som vandmaerke.
--   3. Genopbygningen er faerdig, naar ingen post med id <= vandmaerket er
--      tilbage. Saa saettes ready_at, og laeserne maa skifte.
-- Ny markoer (fx slukket og taendt igen) starter forfra fra punkt 1.
--
-- Kun backenden kalder get_ranking_shadow_read_ready() (kildevalget i
-- backend/lib/rankingRead7664.js, husket 10 s). Fejl eller manglende funktion
-- = laeserne bliver paa matviews.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- Ingen data aendres; den nye tilstand starter som "ikke bekraeftet" og
-- bekraeftes ved foerste kald, naar alt, der laa i koeen ved det kald, er
-- behandlet (normalt inden for et minut).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer migrationen; RPC'en mangler
-- da, kildevalget fejler sikkert, og alle laesere bliver paa matviews.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT relrowsecurity FROM pg_class WHERE oid='public.ranking_shadow_rebuild_state'::regclass; -- true
--   2. SELECT count(*) FROM pg_trigger WHERE tgname='ranking_shadow_rebuild_marker' AND NOT tgisinternal; -- 1
--
-- Rollback: DROP TRIGGER IF EXISTS ranking_shadow_rebuild_marker ON public.ranking_dirty_log;
--   DROP FUNCTION IF EXISTS public.get_ranking_shadow_read_ready();
--   DROP FUNCTION IF EXISTS public.ranking_shadow_rebuild_requested();
--   DROP TABLE IF EXISTS public.ranking_shadow_rebuild_state;
--
-- Refs #7664
-- data-api-access: {"table":"public.ranking_shadow_rebuild_state","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Internal ranking shadow processor: rebuild completion for the read switch"}
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.ranking_shadow_rebuild_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  watermark_id bigint,
  ready_at timestamptz
);
ALTER TABLE public.ranking_shadow_rebuild_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ranking_shadow_rebuild_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.ranking_shadow_rebuild_state TO service_role;
-- Foerste installation: ikke bekraeftet endnu (se punkt 2-3 ovenfor).
INSERT INTO public.ranking_shadow_rebuild_state(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ranking_shadow_rebuild_requested() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='2s' AS $$
BEGIN
  INSERT INTO public.ranking_shadow_rebuild_state(id,requested_at,watermark_id,ready_at)
    VALUES (1,clock_timestamp(),NULL,NULL)
  ON CONFLICT (id) DO UPDATE SET requested_at=EXCLUDED.requested_at,watermark_id=NULL,ready_at=NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ranking_shadow_rebuild_requested() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_shadow_rebuild_requested() TO service_role;
CREATE OR REPLACE TRIGGER ranking_shadow_rebuild_marker AFTER INSERT ON public.ranking_dirty_log
  FOR EACH ROW WHEN (NEW.kind = 'rebuild') EXECUTE FUNCTION public.ranking_shadow_rebuild_requested();

CREATE OR REPLACE FUNCTION public.get_ranking_shadow_read_ready()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp SET lock_timeout='2s' AS $$
DECLARE s public.ranking_shadow_rebuild_state%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.ranking_shadow_rebuild_state WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.ranking_shadow_rebuild_state(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO s FROM public.ranking_shadow_rebuild_state WHERE id=1 FOR UPDATE;
  END IF;
  IF s.ready_at IS NOT NULL THEN
    RETURN jsonb_build_object('ready',true,'requested_at',s.requested_at,'ready_at',s.ready_at);
  END IF;
  -- Markoeren venter stadig: intet er udfoldet endnu.
  IF EXISTS(SELECT 1 FROM public.ranking_dirty_log WHERE kind='rebuild') THEN
    RETURN jsonb_build_object('ready',false,'requested_at',s.requested_at,'stage','queued');
  END IF;
  -- Markoeren er vaek, saa hele dens udfoldning er synlig: vandmaerke nu.
  IF s.watermark_id IS NULL THEN
    s.watermark_id := coalesce((SELECT max(id) FROM public.ranking_dirty_log),0);
    UPDATE public.ranking_shadow_rebuild_state SET watermark_id=s.watermark_id WHERE id=1;
  END IF;
  IF EXISTS(SELECT 1 FROM public.ranking_dirty_log WHERE id<=s.watermark_id) THEN
    RETURN jsonb_build_object('ready',false,'requested_at',s.requested_at,'stage','rebuilding',
      'watermark_id',s.watermark_id::text);
  END IF;
  UPDATE public.ranking_shadow_rebuild_state SET ready_at=clock_timestamp() WHERE id=1
    RETURNING ready_at INTO s.ready_at;
  RETURN jsonb_build_object('ready',true,'requested_at',s.requested_at,'ready_at',s.ready_at);
END;
$$;
REVOKE ALL ON FUNCTION public.get_ranking_shadow_read_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_shadow_read_ready() TO service_role;

DO $verify$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.ranking_shadow_rebuild_state WHERE id=1) THEN
    RAISE EXCEPTION '7664 verify: rebuild state row missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname='ranking_shadow_rebuild_marker' AND NOT tgisinternal)<>1 THEN
    RAISE EXCEPTION '7664 verify: rebuild marker trigger missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_ranking_shadow_read_ready')<>1 THEN
    RAISE EXCEPTION '7664 verify: ambiguous get_ranking_shadow_read_ready overloads';
  END IF;
END
$verify$;
COMMIT;
NOTIFY pgrst,'reload schema';
