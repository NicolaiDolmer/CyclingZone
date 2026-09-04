-- #4492 (ejer-beslutning 4/9, ordret: "kategorier skal vi have flere af") —
-- Forummet udvides fra to til fem kategorier. Kilde: Discord
-- #feedback-and-ideas, @knud_r_flink 30/8 ("Maybe add some more topics.
-- Could be 'Q&A', 'Off-topic' etc."). Åbner den tidligere lås i
-- docs/FORUM_RULES.md §1 (kategorier var gatet til #4235 15/9-læsningen) —
-- se opdateret §1-note i samme PR.
--
-- Nye kategorier: questions (Q&A), tactics (taktik/strategi), off_topic.
-- general + feedback_ideas er uændrede. "archive" er IKKE en DB-værdi — det
-- er et beregnet visnings-filter i backend/lib/forum.js (tråde uden aktivitet
-- i 60 dage), ingen ny kolonne, ingen constraint-ændring for det.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT er trygt at re-køre
-- (auto-migrate.yml). Ingen rækker muteres, ingen RLS/GRANT-ændring.
--
-- Rollback (kun sikkert hvis ingen rækker bruger de nye kategorier endnu):
--   ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_category_check;
--   ALTER TABLE public.forum_posts
--     ADD CONSTRAINT forum_posts_category_check
--       CHECK (category IN ('general', 'feedback_ideas'));
--
-- POST-VERIFY (kør efter merge, forventet: 0 rækker + constraint-def matcher):
--   SELECT category, count(*) FROM public.forum_posts
--     WHERE category NOT IN ('general','feedback_ideas','questions','tactics','off_topic')
--     GROUP BY category;
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'public.forum_posts'::regclass AND conname = 'forum_posts_category_check';

ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_category_check;

ALTER TABLE public.forum_posts
  ADD CONSTRAINT forum_posts_category_check
    CHECK (category IN ('general', 'feedback_ideas', 'questions', 'tactics', 'off_topic'));

COMMENT ON COLUMN public.forum_posts.category IS
  'Forum-kategori. Gyldige værdier styres af forum_posts_category_check, som SKAL matche FORUM_CATEGORIES i backend/lib/forum.js (#4492) — udvid begge sammen. "archive" findes IKKE her: det er et beregnet visningsfilter (60 dage uden aktivitet), ikke en lagret kategori.';
