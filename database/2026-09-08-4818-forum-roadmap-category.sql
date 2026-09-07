-- database/2026-09-08-4818-forum-roadmap-category.sql
-- #4818 (ejer-direktiv 4/9, ordret: "Inde på forummet vil jeg have en
-- roadmap/roadbook kategori... Skal kun være mig, der kan slå noget op det
-- sted i forummet") + ejer-afklaring 8/9 ("kun jeg opretter, alle svarer").
--
-- HVAD:
--   1. Ny forum-kategori `roadmap` (CHECK-constraint udvidet).
--   2. Ny tabel `forum_category_post_roles` — GENEREL skrive-rettighed pr.
--      kategori (`everyone` | `admin`), ikke et hardcodet bruger-id.
--   3. Trigger på forum_posts der håndhæver rettigheden i databasen.
--   Svar (forum_replies) er UÆNDREDE: alle må svare i alle kategorier.
--
-- HVORFOR EN TABEL + TRIGGER, IKKE EN RLS-POLICY:
--   forum_posts har med vilje INGEN insert-policy (2026-08-06-3199-forum.sql):
--   al skrivning sker med service-role fra backend, og service-role bypasser
--   RLS. En INSERT-policy ville derfor være dekoration — den ville aldrig
--   blive evalueret på den eneste skrivevej der findes. En BEFORE INSERT-
--   trigger evalueres derimod OGSÅ for service-role, så DB-laget holder selv
--   hvis en fremtidig rute glemmer backend-tjekket i backend/lib/forum.js.
--   Rettigheden slås op i en tabel frem for at stå i triggeren, så #4268's
--   rollemodel (Admin/Moderator/Beta tester) kan udvide `post_role` uden en
--   ny migration af selve trigger-logikken.
--
-- ADMIN-DEFINITIONEN er den samme som overalt ellers: public.users.role =
--   'admin' (jf. public.is_admin() i 2026-06-15-launch-waitlist.sql).
--   Triggeren kan IKKE kalde is_admin(): den læser auth.uid(), som er NULL
--   når backend skriver med service-role. Rollen slås derfor op på
--   NEW.user_id — den bruger opslaget faktisk tilskrives.
--
-- SORT ORDER: kategori-rækkefølgen bor i koden (FORUM_CATEGORIES i
--   backend/lib/forum.js + FORUM_CATEGORY_ORDER i frontend), ikke i DB —
--   der har aldrig været en sort_order-kolonne, og at indføre to sandheder
--   om rækkefølgen ville være værre end at holde den ét sted. `roadmap`
--   ligger først begge steder.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS + ADD, CREATE TABLE IF NOT EXISTS,
--   INSERT ... ON CONFLICT DO NOTHING, CREATE OR REPLACE FUNCTION,
--   DROP TRIGGER IF EXISTS før CREATE TRIGGER. Ingen eksisterende rækker
--   muteres.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS forum_posts_enforce_category_post_role ON public.forum_posts;
--   DROP FUNCTION IF EXISTS public.enforce_forum_category_post_role();
--   DROP TABLE IF EXISTS public.forum_category_post_roles;
--   ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_category_check;
--   ALTER TABLE public.forum_posts ADD CONSTRAINT forum_posts_category_check
--     CHECK (category IN ('general','feedback_ideas','questions','tactics','transfers','off_topic'));
--   (Kun sikkert hvis ingen tråde ligger i 'roadmap' endnu.)
--
-- POST-VERIFY (kør efter merge):
--   -- 1) constraint indeholder roadmap:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'public.forum_posts'::regclass
--       AND conname = 'forum_posts_category_check';
--   -- forventet: CHECK ((category = ANY (ARRAY['general'...,'roadmap'...])))
--
--   -- 2) rettigheds-tabellen er seedet (forventet: 7 rækker, roadmap = admin):
--   SELECT category, post_role FROM public.forum_category_post_roles ORDER BY category;
--
--   -- 3) triggeren sidder på tabellen (forventet: 1 række):
--   SELECT tgname FROM pg_trigger
--     WHERE tgrelid = 'public.forum_posts'::regclass
--       AND tgname = 'forum_posts_enforce_category_post_role';
--
--   -- 4) ingen tråde er havnet i roadmap fra en ikke-admin (forventet: 0):
--   SELECT count(*) FROM public.forum_posts p
--     JOIN public.users u ON u.id = p.user_id
--     WHERE p.category = 'roadmap' AND u.role IS DISTINCT FROM 'admin';

-- ── 1. Kategori-værdien ─────────────────────────────────────────────────────

ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_category_check;

ALTER TABLE public.forum_posts
  ADD CONSTRAINT forum_posts_category_check
    CHECK (category IN (
      'roadmap', 'general', 'feedback_ideas', 'questions', 'tactics', 'transfers', 'off_topic'
    ));

COMMENT ON COLUMN public.forum_posts.category IS
  'Forum-kategori. Gyldige værdier styres af forum_posts_category_check, som SKAL matche FORUM_CATEGORIES i backend/lib/forum.js (#4492/#4818) — udvid begge sammen. Hvem der må OPRETTE en tråd i kategorien styres af forum_category_post_roles (#4818). "archive" findes IKKE her: det er et beregnet visningsfilter (60 dage uden aktivitet), ikke en lagret kategori.';

-- ── 2. Skrive-rettighed pr. kategori ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.forum_category_post_roles (
  category TEXT PRIMARY KEY,
  post_role TEXT NOT NULL DEFAULT 'everyone'
    CHECK (post_role IN ('everyone', 'admin'))
);

-- Seed: alle kendte kategorier, så tabellen er selvbeskrivende. En manglende
-- række betyder 'everyone' (se triggeren) — nye kategorier er altså åbne som
-- default og skal låses eksplicit.
INSERT INTO public.forum_category_post_roles (category, post_role) VALUES
  ('roadmap',        'admin'),
  ('general',        'everyone'),
  ('feedback_ideas', 'everyone'),
  ('questions',      'everyone'),
  ('tactics',        'everyone'),
  ('transfers',      'everyone'),
  ('off_topic',      'everyone')
ON CONFLICT (category) DO NOTHING;

ALTER TABLE public.forum_category_post_roles ENABLE ROW LEVEL SECURITY;

-- Læsbar for indloggede spillere: hvem der må slå op i en kategori er ikke en
-- hemmelighed — det står på fladen. Skrivning sker kun via migrationer
-- (service-role bypasser RLS); ingen insert/update/delete-policy.
DROP POLICY IF EXISTS "forum_category_post_roles_select_authenticated"
  ON public.forum_category_post_roles;
CREATE POLICY "forum_category_post_roles_select_authenticated"
  ON public.forum_category_post_roles
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.forum_category_post_roles FROM anon;
REVOKE ALL ON TABLE public.forum_category_post_roles FROM authenticated;
GRANT SELECT ON TABLE public.forum_category_post_roles TO authenticated;

COMMENT ON TABLE public.forum_category_post_roles IS
  '#4818: hvem der må OPRETTE tråde i en forum-kategori. everyone = alle indloggede spillere, admin = kun public.users.role = ''admin''. Håndhæves af triggeren forum_posts_enforce_category_post_role (også for service-role) og spejlet i backend/lib/forum.js (403 forum_category_admin_only) + frontend (knappen skjules). Svar i forum_replies er ALDRIG begrænset — ejer-afklaring 8/9: "kun jeg opretter, alle svarer". Manglende række = everyone.';

-- ── 3. Håndhævelse i databasen ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_forum_category_post_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  required_role TEXT;
  author_role TEXT;
BEGIN
  SELECT post_role INTO required_role
    FROM public.forum_category_post_roles
    WHERE category = NEW.category;

  -- Ukendt kategori (endnu ikke seedet) er åben — CHECK-constrainten er den
  -- der afviser ugyldige værdier, ikke denne trigger.
  IF required_role IS NULL OR required_role = 'everyone' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO author_role FROM public.users WHERE id = NEW.user_id;

  IF author_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION
      'forum_category_admin_only: category % only accepts threads from an admin', NEW.category
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_forum_category_post_role() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_forum_category_post_role() IS
  '#4818: trigger-funktion. Afviser INSERT i forum_posts hvis kategorien kræver admin (forum_category_post_roles.post_role = ''admin'') og forfatteren ikke er det. SECURITY DEFINER fordi public.users ikke er klient-læsbar for andre end brugeren selv. Rollen slås op på NEW.user_id, IKKE via is_admin()/auth.uid() — backend skriver med service-role, hvor auth.uid() er NULL.';

DROP TRIGGER IF EXISTS forum_posts_enforce_category_post_role ON public.forum_posts;
CREATE TRIGGER forum_posts_enforce_category_post_role
  BEFORE INSERT ON public.forum_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_forum_category_post_role();
