-- database/2026-09-08-5013-forum-category-mutes.sql
-- #5013/#4751 · Abonnér/afmeld pr. forum-kategori.
--
-- Problem (ejer-direktiv 3/9, #4751, ordret): "Det skal vaere muligt at
-- abonere eller fjerne abonoment paa bestemte kategorier i forum, saadan at
-- man kan slaa til/fra hvilke kategorier hvor man overhovedet faar afvide, at
-- der er nye beskeder i dem." Forummet har seks kategorier (#4492) og fik i
-- #3451 en pr.-tråd ulæst-markering + gul prik i navigationen. Uden et
-- kategori-valg rammer prikken alle kategorier, også dem spilleren ikke
-- følger, og prikken bliver dermed støj i stedet for signal.
--
-- Design — hvorfor OPT-OUT (mute), ikke opt-in (subscription):
-- - Default skal være "følger alle" (issue-krav). Med opt-in-rækker skulle
--   hver eksisterende bruger backfilles med én række pr. kategori, OG hver
--   fremtidig kategori (fx Roadmap, #4818/#5020) ville kræve en ny backfill,
--   ellers ville en ny kategori være tavs for alle eksisterende spillere.
-- - Med opt-out er "ingen række = følger" sandt for evigt: nye kategorier
--   følges automatisk, ingen backfill, og tabellen indeholder kun de få
--   rækker hvor en spiller aktivt har fravalgt noget.
-- - Kolonnenavnet er category_id (issue-ordlyd), men vaerdien er selve
--   kategori-nøglen som TEXT — der findes ingen forum_categories-tabel;
--   kategorierne er konstanter i backend/lib/forum.js (FORUM_CATEGORIES) og
--   gemmes som text på forum_posts.category. En FK ville kræve en ny
--   opslags-tabel uden nogen fordel her.
--
-- Hvad dæmpes (og hvad gør IKKE):
-- - Dæmpes: kategori-brede signaler — pr.-tråd is_unread i trådlisten
--   (GET /api/forum/posts) og den gule forum-prik i navigationen
--   (GET /api/forum/unread-status).
-- - Dæmpes IKKE: direkte notifikationer til personen selv (svar på egen tråd,
--   forum_thread_reply i notificationService.js). Et svar til DIG er ikke et
--   kategori-signal, og en spiller der har slået "Off-topic" fra forventer
--   stadig svar på sin egen tråd dér.
--
-- RLS: samme mindste-privilegium-model som forum_thread_reads
-- (2026-08-25-3451): brugeren ser/skriver KUN egne rækker; backend
-- (backend/lib/forum.js) læser/skriver i dag udelukkende via service-role.
--
-- Apply: post-merge under #2642-rammer (idempotent + post-verify).
-- Rollback: DROP TABLE IF EXISTS forum_category_mutes;

CREATE TABLE IF NOT EXISTS forum_category_mutes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category_id)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE forum_category_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forum_category_mutes_own_rows" ON forum_category_mutes;
CREATE POLICY "forum_category_mutes_own_rows" ON forum_category_mutes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE forum_category_mutes FROM anon;
REVOKE ALL ON TABLE forum_category_mutes FROM authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE forum_category_mutes TO authenticated;

-- ── Kommentarer ─────────────────────────────────────────────────────────────

COMMENT ON TABLE forum_category_mutes IS
  '#5013/#4751: opt-out pr. (bruger, forum-kategori). Ingen raekke = spilleren foelger kategorien, saa nye kategorier foelges automatisk uden backfill. Daemper kategori-brede signaler (is_unread i traadlisten + nav-prikken), ALDRIG direkte notifikationer til personen selv (svar paa egen traad). RLS: bruger ser/skriver kun egne raekker; backend (forum.js) skriver i dag via service-role.';
COMMENT ON COLUMN forum_category_mutes.category_id IS
  '#5013: kategori-noeglen som text (FORUM_CATEGORIES i backend/lib/forum.js), samme vaerdirum som forum_posts.category. Ingen FK - der findes ingen forum_categories-tabel.';

-- PostgREST cacher skemaet: uden reload ser backendens Supabase-klient ikke
-- den nye tabel før næste genstart (hard rule 9 — ny tabel tilgået via
-- supabase-js/PostgREST).
NOTIFY pgrst, 'reload schema';

-- Post-verify (kør efter apply):
--   1. select 1 from information_schema.tables where table_name = 'forum_category_mutes';
--   2. select policyname, qual, with_check from pg_policies
--        where tablename = 'forum_category_mutes';
--      -> "forum_category_mutes_own_rows", begge = (user_id = auth.uid()).
--   3. select count(*) from forum_category_mutes;  -- 0 lige efter apply
--   4. Slå en kategori fra i spillet -> count(*) = 1, og trådlistens
--      is_unread for den kategori er false.
