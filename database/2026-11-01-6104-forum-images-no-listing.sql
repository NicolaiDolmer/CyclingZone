-- database/2026-11-01-6104-forum-images-no-listing.sql
-- #6104 (ejer-go 1/11): luk bred listing af bucketen forum-images.
--
-- HVAD: policyen "forum_images_read" gav anon + authenticated SELECT paa ALLE
-- objekter i bucketen, saa alle kunne liste filerne (Supabase-advisor
-- public_bucket_allows_listing). Den erstattes af en SELECT der kun daekker
-- brugerens egen mappe og admin.
--
-- HVORFOR det ikke bryder noget:
--   * Visning: bucketen er public = true. getPublicUrl()-links serveres af
--     Storage uden RLS, saa billeder i traade vises som foer for alle.
--   * Upload: upload(..., { upsert: false }) kraever kun INSERT (uaendret).
--   * Sletning: frontendens remove() (forumImages.js) kraever SELECT + DELETE paa
--     raekken; egen mappe er stadig laeselig. Backendens remove() koerer som
--     service_role og er upaavirket. Admin beholder SELECT via public.is_admin().
--
-- IDEMPOTENT: DROP POLICY IF EXISTS + CREATE. Ingen raekker muteres.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "forum_images_read_own_or_admin" ON storage.objects;
--   CREATE POLICY "forum_images_read" ON storage.objects FOR SELECT
--     TO anon, authenticated USING (bucket_id = 'forum-images');
--
-- POST-VERIFY (forventet resultat ved hver linje):
--   -- 1) kun den nye SELECT-policy for bucketen (1 raekke, roles {authenticated})
--   SELECT policyname, roles FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'forum_images%' AND cmd = 'SELECT';
--   -- 2) et eksisterende billede svarer stadig 200 via public-URL'en
--   --    (/storage/v1/object/public/forum-images/<path>)

DROP POLICY IF EXISTS "forum_images_read" ON storage.objects;

DROP POLICY IF EXISTS "forum_images_read_own_or_admin" ON storage.objects;
CREATE POLICY "forum_images_read_own_or_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'forum-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );
