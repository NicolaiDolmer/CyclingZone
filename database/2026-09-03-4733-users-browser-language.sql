-- #4733 (#4110 Trin 1, punkt 4 — "Måling ved signup"): gemmer browsersprog
-- (navigator.language, rå værdi fx "nl-BE") på public.users ved signup, så
-- sprogklynger (hvor mange potentielle spillere har hvilket browser-sprog)
-- kan aflæses uden Clarity — kobles senere med nationalitet fra #3984 til at
-- prioritere trigger-rækkefølgen for et 3. sprog (#4110: fransk → hollandsk →
-- italiensk → spansk).
--
-- LÆSES ALDRIG AF SPILLET — udelukkende måling/analyse. `language`
-- (users_language_check-styret UI-sprog) er fortsat den eneste kolonne
-- spillet selv bruger.
--
-- Skrives KUN ved signup (handle_new_user-triggeren nedenfor, som allerede
-- læser `language` fra auth.users.raw_user_meta_data — udvidet her til også
-- at læse `browser_language`). ALDRIG ved login eller efterfølgende opdatering
-- — frontend sender kun værdien i options.data ved selve
-- supabase.auth.signUp()-kaldet.
--
-- RLS/GRANT: ingen ændring nødvendig. Kolonnen skrives udelukkende af
-- handle_new_user() (SECURITY DEFINER-trigger på auth.users, EXECUTE allerede
-- revoket fra anon/authenticated siden 2026-05-21-security-hardening-phase-a.sql)
-- — ALDRIG via en direkte frontend `.update()`. Den eksisterende kolonne-
-- scopede UPDATE-grant til authenticated på public.users (language,
-- consent_preferences, discord_id, nps_last_prompted_at — se
-- 2026-07-23-rls-write-lockdown-users-transfers-bids-swaps.sql) udvides
-- BEVIDST IKKE med browser_language, da ingen frontend-flow skriver den efter
-- signup.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION, sikkert
-- at re-køre (auto-migrate.yml).
--
-- Rollback:
--   -- (gendan handle_new_user() til versionen i 2026-05-17-users-language-i18n.sql
--   --  hvis browser_language-læsningen skal fjernes fra selve triggeren)
--   ALTER TABLE public.users DROP COLUMN IF EXISTS browser_language;

-- ── 1. Kolonne ────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS browser_language text;

COMMENT ON COLUMN public.users.browser_language IS
  'Rå navigator.language ved signup (fx "nl-BE"), max ~16 tegn — sprogklynge-måling til trigger-rækkefølgen på #4110 (#4733). Skrives KUN ved signup via handle_new_user(); læses ALDRIG af spillet. Forveksl ikke med `language` (UI-sprog, spiller-styret).';

-- ── 2. handle_new_user-trigger: læs også browser_language fra signup-meta ──
-- Al eksisterende logik (username-fallback, role, language-default) er
-- BEVARET uændret — kun browser_language-feltet er nyt. Spejlet 1:1 fra
-- prods aktuelle definition (verificeret med pg_get_functiondef 3/9), inkl.
-- `SET search_path TO 'public', 'pg_catalog'` — sat af
-- 2026-05-21-security-hardening-phase-a.sql (function_search_path_mutable-
-- hærdning). CREATE OR REPLACE uden denne klausul ville nulstille
-- funktionens search_path-lås (Postgres bevarer IKKE proconfig på tværs af
-- CREATE OR REPLACE, medmindre klausulen gentages) — klausulen SKAL derfor
-- være med i denne og enhver fremtidig CREATE OR REPLACE af funktionen.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  INSERT INTO public.users (id, email, username, role, language, browser_language)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    'manager',
    COALESCE(NEW.raw_user_meta_data->>'language', 'en'),
    NULLIF(left(NEW.raw_user_meta_data->>'browser_language', 16), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger eksisterer allerede (on_auth_user_created) — vi har bare opdateret funktionen.
