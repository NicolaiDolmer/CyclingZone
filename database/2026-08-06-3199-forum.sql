-- database/2026-08-06-3199-forum.sql
-- #3199/#3201 · Forum v1: in-game forum med opslag, svar, ejer-polls, rapportering
--
-- Problem: Al spiller-kommunikation foregår i dag på Discord, som kun ~25 % af
-- holdene er koblet til. Ejer-direktiv 3/8 (Discord #feedback-from-dolmer):
-- simpelt forum i spillet + ejer-afstemninger. Plan låst 6/8 (mockup godkendt):
-- to kategorier (General · Feedback & ideas), svar-tråde, ejer-opslag kan pinnes
-- og indeholde afstemninger, rapportér-knap + admin-sletning, ejer notificeres
-- ved nye opslag/svar (#3201, via Discord ops-webhook — ingen ny notif-type).
--
-- Design:
-- - seq BIGSERIAL keyset-cursor på posts/replies/reports — samme begrundelse som
--   player_feedback (#2842): total orden, ingen OFFSET, cursor taber/gentager aldrig.
-- - Soft delete (deleted_at/deleted_by): admin-sletning skal kunne auditeres og
--   fortrydes; hårde deletes ville også kaskade-slette svar-tråde under opslag.
-- - reply_count/last_reply_at denormaliseret på posts, vedligeholdt af backend
--   (service-role, single-writer) — listevisning uden N+1 mod forum_replies.
-- - Polls: kun admin kan oprette (håndhæves i backend — service-role er eneste
--   writer). Single choice; genafstemning = upsert på (post_id, user_id).
--
-- RLS (to niveauer, begge med service-role backend som eneste writer):
-- - forum_posts + forum_replies: SELECT-policy for authenticated (kun ikke-
--   slettede rækker). Læsning sker via backend-API, men policyen er NØDVENDIG
--   for at Supabase Realtime (postgres_changes) leverer events til klienten —
--   uden SELECT-adgang fyrer subscriptionen aldrig (learning 2026-05-30).
--   Indholdet er per design synligt for alle indloggede spillere — ingen
--   personoplysninger ud over det spillerne selv poster offentligt.
--   INGEN insert/update/delete-policies: al skrivning via backend service-role.
-- - forum_reports + forum_poll_votes + forum_poll_options: deny-all-policy +
--   REVOKE ALL (samme mønster som fairplay_flags/player_feedback) — hvem der
--   rapporterer hvem og hvem der stemmer hvad er ikke klient-læsbart; backend
--   serverer aggregater (stemmetal) og admin-indbakken (rapporter).
--
-- Apply: post-merge under #2642-rammer (idempotent + post-verify).
-- IDEMPOTent: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS før
--   CREATE POLICY, DO-blokke med pg_publication_tables/pg_constraint-tjek.
-- Rollback:
--   DROP TABLE IF EXISTS forum_poll_votes, forum_poll_options, forum_reports,
--     forum_replies, forum_posts CASCADE;
--   (Realtime-publikationen renses automatisk når tabellerne droppes.)

-- ── forum_posts ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forum_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('general', 'feedback_ideas')),
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 120),
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_reply_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS forum_posts_seq_idx ON forum_posts (seq DESC);
CREATE INDEX IF NOT EXISTS forum_posts_category_seq_idx ON forum_posts (category, seq DESC);
CREATE INDEX IF NOT EXISTS forum_posts_user_id_idx ON forum_posts (user_id);

-- ── forum_replies ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forum_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS forum_replies_seq_idx ON forum_replies (seq);
CREATE INDEX IF NOT EXISTS forum_replies_post_id_seq_idx ON forum_replies (post_id, seq);
CREATE INDEX IF NOT EXISTS forum_replies_user_id_idx ON forum_replies (user_id);

-- ── forum_reports ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forum_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reporter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'reply')),
  target_id UUID NOT NULL,
  reason TEXT CHECK (reason IS NULL OR (length(btrim(reason)) > 0 AND length(reason) <= 500)),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (reporter_user_id, target_type, target_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS forum_reports_seq_idx ON forum_reports (seq DESC);
CREATE INDEX IF NOT EXISTS forum_reports_status_seq_idx ON forum_reports (status, seq DESC);

-- ── forum_poll_options + forum_poll_votes ───────────────────────────────────

CREATE TABLE IF NOT EXISTS forum_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  idx SMALLINT NOT NULL,
  label TEXT NOT NULL CHECK (length(btrim(label)) > 0 AND length(label) <= 100),
  UNIQUE (post_id, idx)
);

CREATE INDEX IF NOT EXISTS forum_poll_options_post_id_idx ON forum_poll_options (post_id);

CREATE TABLE IF NOT EXISTS forum_poll_votes (
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES forum_poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS forum_poll_votes_option_id_idx ON forum_poll_votes (option_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_poll_votes ENABLE ROW LEVEL SECURITY;

-- posts/replies: SELECT for authenticated (ikke-slettede) — kræves for Realtime.
DROP POLICY IF EXISTS "forum_posts_select_authenticated" ON forum_posts;
CREATE POLICY "forum_posts_select_authenticated" ON forum_posts
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "forum_replies_select_authenticated" ON forum_replies;
CREATE POLICY "forum_replies_select_authenticated" ON forum_replies
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

REVOKE ALL ON TABLE forum_posts FROM anon;
REVOKE ALL ON TABLE forum_posts FROM authenticated;
GRANT SELECT ON TABLE forum_posts TO authenticated;

REVOKE ALL ON TABLE forum_replies FROM anon;
REVOKE ALL ON TABLE forum_replies FROM authenticated;
GRANT SELECT ON TABLE forum_replies TO authenticated;

-- reports/votes/options: ingen klient-adgang overhovedet (samme mønster som
-- fairplay_flags). service_role bypasser.
DROP POLICY IF EXISTS "forum_reports_no_client_access" ON forum_reports;
CREATE POLICY "forum_reports_no_client_access" ON forum_reports
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "forum_poll_options_no_client_access" ON forum_poll_options;
CREATE POLICY "forum_poll_options_no_client_access" ON forum_poll_options
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "forum_poll_votes_no_client_access" ON forum_poll_votes;
CREATE POLICY "forum_poll_votes_no_client_access" ON forum_poll_votes
  FOR ALL USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE forum_reports FROM anon;
REVOKE ALL ON TABLE forum_reports FROM authenticated;
REVOKE ALL ON TABLE forum_poll_options FROM anon;
REVOKE ALL ON TABLE forum_poll_options FROM authenticated;
REVOKE ALL ON TABLE forum_poll_votes FROM anon;
REVOKE ALL ON TABLE forum_poll_votes FROM authenticated;

-- ── Realtime-publikation (posts + replies) ──────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'forum_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.forum_posts;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'forum_replies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.forum_replies;
  END IF;
END $$;

-- ── Kommentarer ─────────────────────────────────────────────────────────────

COMMENT ON TABLE forum_posts IS
  '#3199: forum-opslag (General / Feedback & ideas). Skrives KUN via backend service-role (POST /api/forum/posts). SELECT-policy for authenticated findes udelukkende for Realtime-events; klient-læsning sker via backend-API. Soft delete via deleted_at (admin).';
COMMENT ON TABLE forum_replies IS
  '#3199: svar på forum-opslag. Samme adgangsmodel som forum_posts.';
COMMENT ON TABLE forum_reports IS
  '#3199: spiller-rapporteringer af opslag/svar. Deny-all RLS + REVOKE ALL — læses kun i admin-indbakken (GET /api/admin/forum/reports, requireAdmin). UNIQUE pr. (reporter, target) gør gen-rapportering idempotent.';
COMMENT ON TABLE forum_poll_options IS
  '#3199: svarmuligheder for ejer-afstemninger knyttet til et forum-opslag. Kun admin kan oprette (håndhæves i backend). Deny-all RLS; backend serverer options + stemmetal.';
COMMENT ON TABLE forum_poll_votes IS
  '#3199: afgivne stemmer (single choice; PK (post_id, user_id), genafstemning = upsert). Deny-all RLS — hvem der stemmer hvad er ikke klient-læsbart; backend serverer aggregater.';
COMMENT ON COLUMN forum_posts.reply_count IS
  '#3199: denormaliseret svar-tæller (ekskl. slettede svar), vedligeholdt af backend som single-writer.';
COMMENT ON COLUMN forum_posts.seq IS
  '#3199: monotont voksende keyset-cursor (samme mønster som player_feedback.seq, #2842). Ingen OFFSET.';
