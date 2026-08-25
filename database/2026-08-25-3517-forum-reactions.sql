-- database/2026-08-25-3517-forum-reactions.sql
-- #3517 · Forum L1 del 2: opbakning (single counter) + citér-svar.
--
-- Problem: spillerne bad om reaktioner (Discords #feedback-and-ideas). Ejer-
-- designvalg 25/8: ÉN opbakning-tæller pr. opslag/svar, ikke en emoji-palet —
-- matcher upvote-vanen fra Discord og holder forum-fladen fri for
-- emoji-støj (anti-slop-standarden, docs/design/PAGE_TEMPLATES.md).
--
-- Design:
-- - forum_reactions(target_type, target_id, user_id): polymorfisk target
--   (post/reply), SAMME mønster som forum_reports — target_id har bevidst
--   INGEN FK (kan pege på enten forum_posts.id eller forum_replies.id, ingen
--   enkelt tabel at referere). Toggle pr. bruger pr. mål: PK (target_type,
--   target_id, user_id) gør et andet opbaknings-klik fra samme bruger på
--   samme mål til enten "fjern" (findes rækken) eller "tilføj" (findes den
--   ikke) — håndteres i backend/lib/forum.js (toggleForumReaction), ikke i
--   SQL. Tælleren hentes MED det eksisterende trådkald (GET
--   /api/forum/posts/:id) — aldrig N+1 pr. indlæg.
-- - quoted_reply_id på forum_replies: et svar kan citere et andet svar i
--   SAMME tråd (håndhævet i backend, ikke i DB — kolonnen alene tillader
--   enhver forum_replies.id). ON DELETE SET NULL: forum_replies har i dag
--   kun SOFT delete (deleted_at), så denne gren rammer aldrig i praksis via
--   admin-fladen, men er korrekt defensiv SQL hvis en fremtidig hård
--   oprydning nogensinde rammer tabellen. Slettede svar viser ALDRIG deres
--   indhold gennem et citat — backend'en tjekker `deleted_at` på den citerede
--   række og returnerer kun `{ id, removed: true }` til klienten, aldrig
--   body/forfatter.
--
-- RLS (forum_reactions): SAMME "egne rækker"-mønster som forum_thread_reads
-- (2026-08-25-3451) — MODSAT forum_reports/forum_poll_votes (deny-all).
-- Begrundelse: en brugers egen opbakning er ikke følsom (den er per design
-- synlig i tælleren for alle), og "kan se/skrive egen række" er den korrekte
-- mindste-privilegium-model uanset klient. Nuværende backend
-- (backend/lib/forum.js) bruger fortsat udelukkende service-role til at
-- læse/skrive denne tabel (aggregering af tælleren kræver andres rækker,
-- hvilket kun service-role kan) — RLS-policyen er ikke en aktiv client-side
-- skrivevej i denne PR.
--
-- Apply: post-merge under #2642-rammer (idempotent + post-verify). IKKE
-- applied endnu ved denne PR — ejer/orkestrator kører den efter merge.
-- Rollback:
--   ALTER TABLE forum_replies DROP COLUMN IF EXISTS quoted_reply_id;
--   DROP TABLE IF EXISTS forum_reactions;

-- ── forum_reactions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forum_reactions (
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'reply')),
  target_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_type, target_id, user_id)
);

CREATE INDEX IF NOT EXISTS forum_reactions_target_idx ON forum_reactions (target_type, target_id);

ALTER TABLE forum_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forum_reactions_own_rows" ON forum_reactions;
CREATE POLICY "forum_reactions_own_rows" ON forum_reactions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE forum_reactions FROM anon;
REVOKE ALL ON TABLE forum_reactions FROM authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE forum_reactions TO authenticated;

COMMENT ON TABLE forum_reactions IS
  '#3517: opbakning (single counter, ingen emoji-palet — ejer-designvalg 25/8) på et opslag eller svar. PK (target_type, target_id, user_id) — toggle pr. bruger pr. mål, håndteret i backend/lib/forum.js (toggleForumReaction). RLS: bruger ser/skriver kun egne rækker (samme mønster som forum_thread_reads); backend læser/skriver i dag udelukkende via service-role, tælleren kræver aggregering på tværs af brugere.';
COMMENT ON COLUMN forum_reactions.target_id IS
  '#3517: peger på enten forum_posts.id eller forum_replies.id afhængig af target_type — bevidst ingen FK (polymorfisk target, samme mønster som forum_reports.target_id).';

-- ── forum_replies.quoted_reply_id (citér-svar) ──────────────────────────────

ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS quoted_reply_id UUID REFERENCES forum_replies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS forum_replies_quoted_reply_id_idx ON forum_replies (quoted_reply_id) WHERE quoted_reply_id IS NOT NULL;

COMMENT ON COLUMN forum_replies.quoted_reply_id IS
  '#3517: valgfri "citér"-reference til et andet svar i SAMME tråd (håndhævet i backend/lib/forum.js: createForumReply afviser en quoted_reply_id der ikke hører til den aktuelle post_id). Slettede svar (deleted_at) lækker ALDRIG indhold gennem citatet — backend returnerer kun { id, removed: true } til klienten.';

-- PostgREST cacher skemaet: uden reload ser backendens Supabase-klient hverken
-- den nye tabel eller kolonnen før næste genstart (hard rule 9).
NOTIFY pgrst, 'reload schema';

-- Post-verify (kør efter apply):
--   1. information_schema.tables bekræfter forum_reactions eksisterer.
--   2. information_schema.columns bekræfter forum_replies.quoted_reply_id eksisterer.
--   3. pg_policies bekræfter "forum_reactions_own_rows" med
--      qual/with_check = (user_id = auth.uid()).
--   4. En opbakning fra spillerfladen rammer tabellen —
--      select count(*) from forum_reactions;
