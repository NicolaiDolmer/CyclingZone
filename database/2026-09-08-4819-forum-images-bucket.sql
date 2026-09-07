-- database/2026-09-08-4819-forum-images-bucket.sql
-- #4819 (ejer-direktiv 4/9, ordret: "Det skal være muligt at indsætte billeder
-- i forummet") + ejer-valg 8/9 (grænser og moderation).
--
-- HVAD: en Storage-bucket `forum-images` + en `images`-kolonne på
-- forum_posts og forum_replies, så et indlæg kan bære op til 3 billeder.
--
-- HVORFOR denne form (og ikke markdown i body):
--   Forum-body rendres i dag som REN TEKST (`whitespace-pre-wrap`, se
--   ForumPostPage.jsx) — der findes ingen markdown-/HTML-renderer på fladen.
--   At indføre en billed-syntaks i body ville kræve netop den renderer, og
--   dermed åbne den XSS-flade forummet ikke har i dag. En separat
--   `images`-kolonne holder body som ren tekst: billederne er strukturerede
--   data (path + dimensioner), URL'en bygges klient-side af den faste
--   Storage-origin, og der parses aldrig bruger-tekst som markup.
--
-- GRÆNSER (ejer-valg 8/9 — spejlet i backend/lib/forum.js, frontend/src/lib/
-- forumImages.js og docs/GAME_INVARIANTS.md; ret ALLE fire sammen):
--   · 2 MB pr. billede EFTER browser-nedskalering (længste side 1600 px)
--   · kun image/jpeg, image/png, image/webp
--   · højst 3 billeder pr. indlæg (tråd eller svar)
--
-- BUCKET-POLITIK:
--   public = true. Forum-billeder er per definition offentlige — forummet er
--   synligt for alle indloggede, og repoet/spillet er publicly viewable. En
--   privat bucket ville kræve signerede URL'er med udløb pr. billede pr.
--   visning uden at skjule noget reelt.
--
--   Fil-stien er `<user_id>/<uuid>.<ext>`. Første mappeniveau ER ejerskabet:
--   INSERT-policyen tvinger `(storage.foldername(name))[1] = auth.uid()`, så
--   en bruger aldrig kan lægge filer i en andens mappe. DELETE tillades til
--   filens ejer (egen mappe) og til admin (public.is_admin(), samme funktion
--   som resten af admin-RLS'en) — ejer-valget 8/9: "admin kan slette et
--   billede (og dermed fjerne det fra indlægget)".
--
-- IDEMPOTENT: bucket-INSERT er ON CONFLICT DO NOTHING; kolonnerne er ADD
-- COLUMN IF NOT EXISTS; hver policy er DROP POLICY IF EXISTS + CREATE.
-- Ingen rækker muteres. Sikker at køre om (auto-migrate.yml).
--
-- ROLLBACK (kun sikkert hvis ingen indlæg har billeder endnu):
--   DROP POLICY IF EXISTS "forum_images_read" ON storage.objects;
--   DROP POLICY IF EXISTS "forum_images_insert_own_folder" ON storage.objects;
--   DROP POLICY IF EXISTS "forum_images_delete_own_or_admin" ON storage.objects;
--   ALTER TABLE public.forum_posts DROP COLUMN IF EXISTS images;
--   ALTER TABLE public.forum_replies DROP COLUMN IF EXISTS images;
--   DELETE FROM storage.buckets WHERE id = 'forum-images';
--
-- POST-VERIFY (kør efter merge — forventet resultat står ved hver linje):
--   -- 1) bucket findes med de rigtige grænser (1 række: public=t,
--   --    file_size_limit=2097152, mime = {image/jpeg,image/png,image/webp})
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'forum-images';
--
--   -- 2) de tre policies findes (3 rækker)
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'forum_images%' ORDER BY policyname;
--
--   -- 3) kolonnerne findes som jsonb med '[]'-default (2 rækker)
--   SELECT table_name, column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'images'
--      AND table_name IN ('forum_posts', 'forum_replies');
--
--   -- 4) ingen række bryder 3-billed-loftet (0 rækker)
--   SELECT 'post' AS kind, id FROM public.forum_posts
--    WHERE jsonb_array_length(images) > 3
--   UNION ALL
--   SELECT 'reply', id FROM public.forum_replies
--    WHERE jsonb_array_length(images) > 3;

-- ── 1. Bucket ────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'forum-images',
  'forum-images',
  true,
  2097152, -- 2 MB, håndhæves også klient-side efter nedskalering
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Genkørsel på en bucket der allerede findes skal stadig lande grænserne
-- (fx hvis den blev oprettet manuelt i dashboardet før denne migration).
UPDATE storage.buckets
   SET public = true,
       file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'forum-images'
   AND (public IS DISTINCT FROM true
        OR file_size_limit IS DISTINCT FROM 2097152
        OR allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/png', 'image/webp']);

-- ── 2. RLS på storage.objects ────────────────────────────────────────────────
-- storage.objects har RLS slået til af Supabase selv; her tilføjes kun de tre
-- policies der er scopet til denne ene bucket.

DROP POLICY IF EXISTS "forum_images_read" ON storage.objects;
CREATE POLICY "forum_images_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'forum-images');

DROP POLICY IF EXISTS "forum_images_insert_own_folder" ON storage.objects;
CREATE POLICY "forum_images_insert_own_folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'forum-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "forum_images_delete_own_or_admin" ON storage.objects;
CREATE POLICY "forum_images_delete_own_or_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'forum-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- ── 3. images-kolonnen på indlæg og svar ─────────────────────────────────────
-- Formen er et array af { path, width, height }. `path` er relativ til
-- bucketen (`<user_id>/<uuid>.<ext>`) — ALDRIG en fuld URL: origin'en bygges
-- klient-side af Supabase-klienten, så et indlæg aldrig kan pege et <img> mod
-- et fremmed domæne.

ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.forum_replies
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_images_check;
ALTER TABLE public.forum_posts
  ADD CONSTRAINT forum_posts_images_check
    CHECK (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) <= 3);

ALTER TABLE public.forum_replies DROP CONSTRAINT IF EXISTS forum_replies_images_check;
ALTER TABLE public.forum_replies
  ADD CONSTRAINT forum_replies_images_check
    CHECK (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) <= 3);

COMMENT ON COLUMN public.forum_posts.images IS
  'Op til 3 billeder på indlægget: [{ "path": "<user_id>/<uuid>.webp", "width": 1600, "height": 900 }]. path er relativ til Storage-bucketen forum-images, aldrig en fuld URL. Grænserne (3 stk., 2 MB, jpeg/png/webp) spejles i backend/lib/forum.js + frontend/src/lib/forumImages.js (#4819).';

COMMENT ON COLUMN public.forum_replies.images IS
  'Som forum_posts.images: op til 3 billeder på svaret, paths relative til bucketen forum-images (#4819).';
