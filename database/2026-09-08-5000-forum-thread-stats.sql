-- database/2026-09-08-5000-forum-thread-stats.sql
-- #5000 · Forum-statistik: visningstal pr. traad, seneste svars forfatter i
-- traadlisten, og indlaegstal paa managerprofilen.
--
-- Ejer-bestilling 7/9 (#5000), tre dele:
--   1. "Vis hvor mange gange en traad er aabnet" — taelles server-side.
--   2. "Vis seneste indlaegs forfatter i traadlisten" — uden at aabne traaden.
--   3. "Vis antal forumindlaeg paa managerens profil" — traade + svar.
--
-- ── 1. Visningstal ──────────────────────────────────────────────────────────
--
-- Hvorfor IKKE forum_thread_reads (#3451)? Den tabel ligner en gratis kilde til
-- visningstal (én raekke pr. bruger pr. traad), men markAllForumThreadsRead
-- ("Markér alle som laest", backend/lib/forum.js) upserter en raekke for HVER
-- traad uden at brugeren har aabnet nogen af dem. Et visningstal udledt derfra
-- ville hoppe til "alle spillere" i samme sekund én spiller trykker paa knappen.
-- Den er laese-STATUS, ikke visnings-LOG.
--
-- Valgt model: samme praecedens som rider_profile_views (#963) — én taellelig
-- raekke pr. (bruger, traad, UTC-kalenderdag) via en GENERATED STORED view_date
-- i en navngiven UNIQUE-constraint. Det er den enkleste robuste dedup:
--   * reload-spam og re-mounts taeller aldrig mere end én gang pr. dag,
--   * ingen rate-guard/tidsvindue-logik i applikationskoden at holde ved lige,
--   * dedup'en haandhaeves af databasen, ikke af en race-udsat JS-kontrol.
--
-- forum_posts.view_count er en denormaliseret taeller (samme rolle som det
-- eksisterende reply_count): traadlisten skal vise tallet for ~45 traade ad
-- gangen, og en bounded scan over visnings-loggen ville vokse med brugstiden.
-- Taelleren opdateres KUN inde i record_forum_thread_view() — insert og
-- increment sker i én transaktion, saa to samtidige visninger ikke kan tabe et
-- taelle-skridt (read-modify-write i JS kunne). Klienten har ingen UPDATE-
-- policy paa forum_posts (kun SELECT for Realtime, #3199), saa taelleren kan
-- ikke skrives udenom.
--
-- ── 2. Seneste svars forfatter ──────────────────────────────────────────────
--
-- last_reply_user_id/last_reply_team_id staar ved siden af det eksisterende
-- last_reply_at og vedligeholdes af den SAMME backend-funktion (recountReplies
-- i backend/lib/forum.js), som allerede er selvhelende: den genberegner ud fra
-- de ikke-slettede svar i stedet for at inkrementere. Sletter admin det seneste
-- svar, falder feltet tilbage til det forrige svar — eller til NULL i en traad
-- uden svar. Alternativet (slaa seneste svar op pr. traad ved listevisning)
-- ville vaere N+1 eller endnu en bounded scan; kolonnen koster to UUID'er.
--
-- ── 3. Indlaegstal paa profilen ─────────────────────────────────────────────
--
-- Ingen skema-aendring: forum_posts_user_id_idx og forum_replies_user_id_idx
-- findes allerede (#3199), og backend taeller pr. bruger over dem.
--
-- Apply: post-merge via auto-migrate.yml (#2642-rammer). IKKE applied haand.
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS,
--   DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION, backfill'en er en
--   ren UPDATE der kan koeres igen uden at flytte noget.
-- Rollback:
--   DROP FUNCTION IF EXISTS public.record_forum_thread_view(uuid, uuid);
--   DROP TABLE IF EXISTS public.forum_thread_views;
--   ALTER TABLE public.forum_posts
--     DROP COLUMN IF EXISTS view_count,
--     DROP COLUMN IF EXISTS last_reply_user_id,
--     DROP COLUMN IF EXISTS last_reply_team_id;

-- ── forum_posts: nye kolonner ───────────────────────────────────────────────

ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS last_reply_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS last_reply_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.forum_posts.view_count IS
  '#5000: antal unikke (bruger, UTC-dag)-visninger af traaden. Skrives KUN af record_forum_thread_view(); klienten har ingen UPDATE-policy paa tabellen.';
COMMENT ON COLUMN public.forum_posts.last_reply_user_id IS
  '#5000: forfatter af seneste ikke-slettede svar (NULL i en traad uden svar). Vedligeholdes af recountReplies i backend/lib/forum.js sammen med reply_count/last_reply_at.';
COMMENT ON COLUMN public.forum_posts.last_reply_team_id IS
  '#5000: hold bag seneste ikke-slettede svar — bruges til holdnavn/Founder-maerke i traadlisten uden et ekstra opslag.';

-- Backfill: seneste ikke-slettede svar pr. traad. DISTINCT ON (post_id) med
-- seq DESC er den samme "seneste svar"-definition som backend bruger (seq er
-- en total orden, i modsaetning til created_at der kan deles).
UPDATE public.forum_posts p
SET last_reply_user_id = r.user_id,
    last_reply_team_id = r.team_id
FROM (
  SELECT DISTINCT ON (post_id) post_id, user_id, team_id
  FROM public.forum_replies
  WHERE deleted_at IS NULL
  ORDER BY post_id, seq DESC
) r
WHERE r.post_id = p.id
  AND (p.last_reply_user_id IS DISTINCT FROM r.user_id
    OR p.last_reply_team_id IS DISTINCT FROM r.team_id);

-- ── forum_thread_views ──────────────────────────────────────────────────────
--
-- AT TIME ZONE 'UTC' paa en timestamptz er IMMUTABLE og derfor lovlig i en
-- GENERATED STORED kolonne (samme konstruktion som rider_profile_views).

CREATE TABLE IF NOT EXISTS public.forum_thread_views (
  id BIGSERIAL PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  view_date DATE NOT NULL GENERATED ALWAYS AS ((viewed_at AT TIME ZONE 'UTC')::date) STORED,
  CONSTRAINT forum_thread_views_daily_uniq UNIQUE (user_id, post_id, view_date)
);

CREATE INDEX IF NOT EXISTS forum_thread_views_post_id_viewed_at_idx
  ON public.forum_thread_views (post_id, viewed_at DESC);

-- ── RLS: deny-all for klienter ──────────────────────────────────────────────
--
-- Samme klasse som forum_reports/forum_poll_votes (#3199): hvem der har laest
-- hvad maa aldrig naa en spiller-flade. Ingen policies = ingen adgang for
-- anon/authenticated; backend laeser/skriver via service_role, som bypasser
-- RLS. REVOKE'en er defense-in-depth mod Supabase' default table-grants.

ALTER TABLE public.forum_thread_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forum_thread_views_deny_all" ON public.forum_thread_views;
CREATE POLICY "forum_thread_views_deny_all" ON public.forum_thread_views
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.forum_thread_views FROM anon;
REVOKE ALL ON TABLE public.forum_thread_views FROM authenticated;
REVOKE ALL ON SEQUENCE public.forum_thread_views_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.forum_thread_views_id_seq FROM authenticated;

COMMENT ON TABLE public.forum_thread_views IS
  '#5000: visnings-log pr. forum-traad. Én raekke pr. (bruger, traad, UTC-dag) via forum_thread_views_daily_uniq. Skrives af record_forum_thread_view() bag GET /api/forum/posts/:id. Deny-all for klienter — kun aggregatet (forum_posts.view_count) naar spiller-fladen.';
COMMENT ON COLUMN public.forum_thread_views.view_date IS
  'Genereret UTC-dag af viewed_at. Indgaar i daglig dedup-UNIQUE — dét er rate-guarden.';

-- ── record_forum_thread_view() ──────────────────────────────────────────────
--
-- SECURITY INVOKER (default) med vilje: backend kalder den med service_role,
-- som allerede bypasser RLS. En SECURITY DEFINER ville give funktionen flere
-- rettigheder end kalderen har brug for — og ville kraeve REVOKE-disciplinen
-- fra #2858/#3765 for ikke at vaere anon-kaldbar. Vi revoker alligevel
-- eksplicit fra anon/authenticated, saa /rest/v1/rpc/-fladen ikke eksponerer
-- en skrivevej mod taelleren.
--
-- Returnerer traadens view_count EFTER kaldet, saa routen kan vise det rigtige
-- tal med det samme (inkl. den visning der lige er registreret) uden et ekstra
-- opslag. NULL hvis traaden ikke findes.

CREATE OR REPLACE FUNCTION public.record_forum_thread_view(
  p_post_id UUID,
  p_user_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_count INTEGER;
BEGIN
  IF p_post_id IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.forum_thread_views (post_id, user_id)
  VALUES (p_post_id, p_user_id)
  ON CONFLICT ON CONSTRAINT forum_thread_views_daily_uniq DO NOTHING;

  -- ROW_COUNT er 0 naar ON CONFLICT DO NOTHING slugte raekken (traaden var
  -- allerede set af denne bruger i dag) og 1 ved en ny visning.
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    UPDATE public.forum_posts
    SET view_count = view_count + 1
    WHERE id = p_post_id
    RETURNING view_count INTO v_count;
  ELSE
    SELECT view_count INTO v_count FROM public.forum_posts WHERE id = p_post_id;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_forum_thread_view(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_forum_thread_view(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.record_forum_thread_view(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_forum_thread_view(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.record_forum_thread_view(UUID, UUID) IS
  '#5000: registrer én traad-visning (dedup pr. bruger/traad/UTC-dag) og returnér traadens view_count efter kaldet. Insert + increment i én transaktion, saa samtidige visninger ikke taber taelle-skridt.';

-- PostgREST cacher skemaet: uden reload ser backendens Supabase-klient hverken
-- de nye kolonner eller den nye RPC foer naeste genstart (hard rule 9).
NOTIFY pgrst, 'reload schema';

-- ── POST-VERIFY (koer efter merge) ──────────────────────────────────────────
--
-- 1. Kolonnerne findes med de rigtige defaults (forventet: 3 raekker,
--    view_count NOT NULL default 0):
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'forum_posts'
--         AND column_name IN ('view_count','last_reply_user_id','last_reply_team_id')
--       ORDER BY column_name;
--
-- 2. Backfill'en er komplet (forventet: 0 raekker — ingen traad med svar
--    mangler en seneste-forfatter):
--      SELECT p.id, p.reply_count
--        FROM public.forum_posts p
--       WHERE p.reply_count > 0 AND p.last_reply_user_id IS NULL
--         AND EXISTS (SELECT 1 FROM public.forum_replies r
--                      WHERE r.post_id = p.id AND r.deleted_at IS NULL);
--
-- 3. Tabel + dedup-constraint + RLS staar (forventet: 1 constraint,
--    relrowsecurity = true, 1 policy med qual = false):
--      SELECT conname FROM pg_constraint
--       WHERE conrelid = 'public.forum_thread_views'::regclass
--         AND conname = 'forum_thread_views_daily_uniq';
--      SELECT relrowsecurity FROM pg_class WHERE oid = 'public.forum_thread_views'::regclass;
--      SELECT policyname, qual, with_check FROM pg_policies
--       WHERE tablename = 'forum_thread_views';
--
-- 4. RPC'en er ikke klient-kaldbar (forventet: 0 raekker):
--      SELECT grantee FROM information_schema.role_routine_grants
--       WHERE routine_name = 'record_forum_thread_view'
--         AND grantee IN ('anon','authenticated');
--
-- 5. Roegtest efter foerste traad-aabning i spillet (forventet: >= 1, og
--    summen af visnings-raekker matcher taelleren pr. traad):
--      SELECT count(*) FROM public.forum_thread_views;
--      SELECT p.id, p.view_count, count(v.id) AS logged
--        FROM public.forum_posts p
--        LEFT JOIN public.forum_thread_views v ON v.post_id = p.id
--       GROUP BY p.id, p.view_count
--      HAVING p.view_count <> count(v.id);
