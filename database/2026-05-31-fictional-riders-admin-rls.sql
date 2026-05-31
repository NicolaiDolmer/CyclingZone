-- #669 — Admin-gate for fiktive ryttere (RLS)
--
-- Kontekst: RidersPage (og øvrige rytter-lister) henter klient-side direkte via
-- supabase-js, så synlighed styres af RLS — IKKE af backend-endpoints. For at
-- skjule fiktive ryttere (pcm_id IS NULL) fra ikke-admin under test/gradvis
-- udrulning ændrer vi den eneste SELECT-policy fra `true` til at slippe alle
-- ikke-fiktive igennem + alt for admin (via den eksisterende is_admin()).
--
-- Effekt:
--   • Ikke-admin / anonym: ser kun pcm_id IS NOT NULL (de rigtige PCM-ryttere).
--   • Admin: is_admin() = true → ser ALLE, inkl. fiktive, i den normale UI.
--   • Backend (service-role): bypasser RLS uændret.
--
-- Sikkerhed: ALLE nuværende ryttere har pcm_id NOT NULL, så de passerer filteret
-- uændret — ingen regression for eksisterende data. Kun fremtidige fiktive
-- (pcm_id NULL) skjules. ALTER (ikke DROP+CREATE) → atomisk, intet deny-all-vindue.
--
-- Midlertidigt test-/udrulnings-gate. Fjernes (tilbage til USING (true)) når
-- fiktive ryttere skal vises for alle ved PCM-udfasning (#676).

ALTER POLICY "Public read riders" ON public.riders
  USING (pcm_id IS NOT NULL OR public.is_admin());

-- Den gamle USING(true) kaldte ikke is_admin(), men det gør den nye policy — og
-- anon-rollen manglede EXECUTE på funktionen, så anonyme læsninger fejlede med
-- "permission denied for function is_admin" (fanget via rolle-impersonation
-- 2026-05-31, før reel brugerpåvirkning). Granten er sikker: is_admin()
-- returnerer false for anon (auth.uid() er NULL → intet users-opslag).
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
