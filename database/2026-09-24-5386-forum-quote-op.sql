-- database/2026-09-24-5386-forum-quote-op.sql
-- #5386 · Forum: traadens foerste indlaeg kan nu ogsaa citeres, ikke kun svar.
--
-- Problem: #3517 introducerede citér-svar (quoted_reply_id, kun svar kan
-- citeres). Ejeren observerede 18/9 (Discord-gennemgang) at aabningsindlaegget
-- i en traad IKKE kan citeres — kun de efterfoelgende svar.
--
-- Loesning: forum_replies.quotes_post (boolean) markerer at et svar citerer
-- traadens EGET aabningsindlaeg i stedet for et andet svar. Bevidst IKKE en
-- quoted_post_id-FK: et svars post_id ER allerede en reference til den
-- (eneste mulige) aabningspost i traaden, saa en boolean er nok. Mutex med
-- quoted_reply_id haandhaeves BAADE i backend (createForumReply afviser
-- begge sat samtidig, 400 forum_invalid_quote) OG i en CHECK-constraint her
-- (defence-in-depth mod fremtidige direkte skriv til tabellen).
--
-- getForumPost shaper citatet af aabningsindlaegget med SAMME excerpt-logik
-- som svar-citater (backend/lib/forum.js). Den kan aldrig vise
-- { removed: true } for et post-citat: getForumPost returnerer allerede 404
-- for hele traaden hvis post.deleted_at er sat, saa de svar der refererer
-- til den (quotes_post = true) er per definition ikke synlige naar posten
-- ikke findes.
--
-- Apply: post-merge under #2642-rammer (idempotent + post-verify). IKKE
-- applied endnu ved denne PR — ejer/orkestrator koerer den efter merge.
-- Rollback:
--   ALTER TABLE forum_replies DROP CONSTRAINT IF EXISTS forum_replies_quote_target_check;
--   ALTER TABLE forum_replies DROP COLUMN IF EXISTS quotes_post;

ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS quotes_post BOOLEAN NOT NULL DEFAULT FALSE;

-- Et svar citerer ENTEN et andet svar (quoted_reply_id) ELLER aabningsindlaegget
-- (quotes_post) — aldrig begge samtidig.
ALTER TABLE forum_replies DROP CONSTRAINT IF EXISTS forum_replies_quote_target_check;
ALTER TABLE forum_replies ADD CONSTRAINT forum_replies_quote_target_check
  CHECK (NOT (quotes_post AND quoted_reply_id IS NOT NULL));

COMMENT ON COLUMN forum_replies.quotes_post IS
  '#5386: valgfri "citér"-markering — dette svar citerer traadens eget aabningsindlaeg (post_id) i stedet for et andet svar. Mutex med quoted_reply_id (haandhaevet i backend + CHECK-constraint). Shapes serverside i getForumPost (backend/lib/forum.js) med samme excerpt-logik som svar-citater; kan aldrig blive "removed" fordi hele traaden 404''er naar aabningsindlaegget er slettet.';

-- PostgREST cacher skemaet: uden reload ser backendens Supabase-klient ikke
-- den nye kolonne foer naeste genstart (hard rule 9).
NOTIFY pgrst, 'reload schema';

-- Post-verify (koer efter apply):
--   1. information_schema.columns bekraefter forum_replies.quotes_post eksisterer (boolean, not null, default false).
--   2. pg_constraint bekraefter forum_replies_quote_target_check eksisterer.
--   3. Et citat af aabningsindlaegget fra spillerfladen rammer kolonnen —
--      select count(*) from forum_replies where quotes_post;
