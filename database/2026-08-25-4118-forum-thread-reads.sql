-- database/2026-08-25-4118-forum-thread-reads.sql
-- #4118/#3451 · Forum L1 "puls": pr.-tråd ulæst-tilstand + gul prik i nav.
--
-- Problem: forummet (#3199, live 6/8) har intet aktivitetssignal — 12 opslag/
-- 75 svar/15 skribenter ud af 90 aktive spillere på 19 dage. Ejer-diagnose
-- 25/8: forummet er usynligt, ikke dødt. Denne tabel bærer "har spilleren set
-- denne tråds seneste aktivitet" pr. (bruger, tråd) — kilden til både
-- ulæst-markeringen i trådlisten (GET /api/forum/posts) og den gule prik ved
-- "Forum" i navigationen (GET /api/forum/unread-status), samme visuelle
-- prik-mekanik som Patch Notes (#3811).
--
-- Design:
-- - PK (user_id, post_id): én "sidst læst"-tid pr. tråd pr. bruger, upsert
--   ved hver tråd-visning (samme "single upsert-target"-mønster som
--   forum_poll_votes). Ulæst = coalesce(forum_posts.last_reply_at,
--   forum_posts.created_at) > last_read_at, ELLER ingen række overhovedet.
-- - RLS: MODSAT forum_posts/forum_replies (backend-only skrivning, deny for
--   klienten) må en bruger her se/skrive SIN EGEN læse-tilstand direkte —
--   ingen andens læsehistorik er synlig, og en bruger kan aldrig skrive en
--   andens række (user_id = auth.uid() på både USING og WITH CHECK).
--   Nuværende backend (backend/lib/forum.js) bruger fortsat udelukkende
--   service-role til at læse/skrive denne tabel — RLS-policyen er den
--   korrekte "mindste privilegium"-model uanset klient, ikke en aktiv
--   client-side skrivevej i denne PR.
--
-- Apply: post-merge under #2642-rammer (idempotent + post-verify). IKKE
-- applied endnu ved denne PR — ejer/orkestrator kører den efter merge.
-- Rollback: DROP TABLE IF EXISTS forum_thread_reads;

CREATE TABLE IF NOT EXISTS forum_thread_reads (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS forum_thread_reads_post_id_idx ON forum_thread_reads (post_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE forum_thread_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forum_thread_reads_own_rows" ON forum_thread_reads;
CREATE POLICY "forum_thread_reads_own_rows" ON forum_thread_reads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE forum_thread_reads FROM anon;
REVOKE ALL ON TABLE forum_thread_reads FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE forum_thread_reads TO authenticated;

-- ── Kommentarer ─────────────────────────────────────────────────────────────

COMMENT ON TABLE forum_thread_reads IS
  '#4118/#3451: pr.-tråd "sidst læst"-tidsstempel pr. bruger. Ulæst = coalesce(forum_posts.last_reply_at, forum_posts.created_at) > last_read_at, eller ingen række for (user_id, post_id). RLS: bruger ser/skriver kun egne rækker; backend (forum.js) skriver i dag via service-role.';
COMMENT ON COLUMN forum_thread_reads.last_read_at IS
  '#4118: opdateres (upsert) hver gang brugeren åbner GET /api/forum/posts/:id.';

-- PostgREST cacher skemaet: uden reload ser backendens Supabase-klient ikke
-- den nye tabel før næste genstart (hard rule 9 — ny tabel tilgået via
-- supabase-js/PostgREST).
NOTIFY pgrst, 'reload schema';

-- Post-verify (kør efter apply):
--   1. information_schema.tables bekræfter forum_thread_reads eksisterer.
--   2. pg_policies bekræfter "forum_thread_reads_own_rows" med
--      qual/with_check = (user_id = auth.uid()).
--   3. En upsert fra backend (fx åbn en tråd i spillet) rammer tabellen —
--      select count(*) from forum_thread_reads;
