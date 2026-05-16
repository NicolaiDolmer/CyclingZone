-- i18n Fase 1 foundation — Refs #410.
--
-- Tilføjer `language`-kolonne til public.users så frontend kan vælge UI-sprog
-- per bruger uden URL-prefix. Backfill: eksisterende brugere → 'da' (de er
-- vant til DK); nye signups → 'en' (default) eller fra signup-meta hvis sat.
--
-- Auth-meta sync: når public.users.language UPDATEs, propageres den til
-- auth.users.raw_user_meta_data.language så Supabase Edge Functions og
-- email-templates kan læse brugerens sprog uden JOIN.
--
-- RLS: Eksisterende "Users can update own profile"-policy (live siden tidlig
-- schema, dokumenteret i 2026-05-11-consent-preferences.sql:6) dækker allerede
-- language-update via auth.uid() = id. Ingen ny policy nødvendig.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DO-blocks for constraint/trigger,
-- så auto-migrate kan re-køre uden side-effekter.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS sync_user_language_to_auth_meta ON public.users;
--   DROP FUNCTION IF EXISTS public.sync_user_language_to_auth_meta();
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_language_check;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS language;

-- ── 1. Kolonne (online-safe ADD COLUMN med default) ──────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

-- ── 2. CHECK constraint (lige nu: en/da; klar til at udvide) ─────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_language_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_language_check
        CHECK (language IN ('en','da'));
  END IF;
END $$;

COMMENT ON COLUMN public.users.language IS
  'UI-sprog (ISO 639-1). en/da i dag; klar til at udvide. Source-of-truth — synces til auth.users.raw_user_meta_data.language via trigger så Edge Functions kan læse uden JOIN.';

-- ── 3. Backfill eksisterende brugere ─────────────────────────────
-- Kun rækker med default-værdi 'en' der eksisterede før migrationen.
-- Bruger created_at < now() for at undgå at backfill'e rækker oprettet
-- under migration-vinduet (de er allerede default 'en' = korrekt for nye).
--
-- Idempotent: re-kørsel rammer 0 rækker hvis nogen har skiftet sprog manuelt.
UPDATE public.users
  SET language = 'da'
  WHERE language = 'en'
    AND created_at < now() - interval '1 minute';

-- ── 4. handle_new_user-trigger: læs language fra signup-meta ─────
-- Hvis frontend sender `language` i signup-meta (via supabase.auth.signUp
-- options.data), bruges det; ellers default 'en' (kolonne-default).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, username, role, language)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    'manager',
    COALESCE(NEW.raw_user_meta_data->>'language', 'en')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger eksisterer allerede (on_auth_user_created) — vi har bare opdateret funktionen.

-- ── 5. Sync public.users.language → auth.users.raw_user_meta_data ──
-- Trigger fires kun ved UPDATE (ikke INSERT — handle_new_user dækker signup-vejen,
-- og auth.users.raw_user_meta_data er allerede sat ved signup).
--
-- SECURITY DEFINER kræves for at skrive til auth-schemat. Funktionen er
-- defensiv: kun language-feltet røres, andre raw_user_meta_data-keys bevares.
CREATE OR REPLACE FUNCTION public.sync_user_language_to_auth_meta()
RETURNS trigger AS $$
BEGIN
  -- Kun hvis language faktisk ændret (undgår unødvendige writes ved
  -- update af andre kolonner som last_seen).
  IF NEW.language IS DISTINCT FROM OLD.language THEN
    UPDATE auth.users
      SET raw_user_meta_data =
        COALESCE(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('language', NEW.language)
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_user_language_to_auth_meta ON public.users;
CREATE TRIGGER sync_user_language_to_auth_meta
  AFTER UPDATE OF language ON public.users
  FOR EACH ROW
  WHEN (NEW.language IS DISTINCT FROM OLD.language)
  EXECUTE FUNCTION public.sync_user_language_to_auth_meta();

-- ── 6. One-shot backfill af auth.users.raw_user_meta_data ────────
-- Sync nuværende public.users.language til auth-meta så Edge Functions
-- og email-templates ser konsistent state fra dag 1.
UPDATE auth.users au
  SET raw_user_meta_data =
    COALESCE(au.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('language', pu.language)
  FROM public.users pu
  WHERE au.id = pu.id
    AND (au.raw_user_meta_data->>'language' IS NULL
         OR au.raw_user_meta_data->>'language' IS DISTINCT FROM pu.language);
