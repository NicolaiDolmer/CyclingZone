-- #4733 (#4110 Trin 1, punkt 4): users.language CHECK-constraint samlet med
-- den ene frontend-konfigurationsfil (frontend/src/i18n/languages.js).
--
-- INGEN indholdsændring: listen er stadig ('en','da') — konstanten fra
-- 2026-07-23-rls-write-lockdown-users-transfers-bids-swaps.sql (der selv
-- overtog den fra 2026-05-17-users-language-i18n.sql) genskrives blot med en
-- kommentar der peger fremad. Når et nyt sprog tilføjes til LANGUAGES i
-- frontend/src/i18n/languages.js, SKAL denne CHECK udvides i samme PR
-- (samme liste begge steder, ellers afviser DB'en en gyldig frontend-værdi).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT er trygt at re-køre
-- (auto-migrate.yml). Ingen rækker muteres, ingen RLS/GRANT-ændring.
--
-- Rollback:
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_language_check;
--   ALTER TABLE public.users
--     ADD CONSTRAINT users_language_check CHECK (language IN ('en','da'));

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_language_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_language_check
    CHECK (language IN ('en','da'));

COMMENT ON COLUMN public.users.language IS
  'UI-sprog (ISO 639-1). Gyldige værdier styres af users_language_check, som SKAL matche SUPPORTED_LANGS i frontend/src/i18n/languages.js (#4733) — udvid begge sammen når et nyt sprog tilføjes. Source-of-truth — synces til auth.users.raw_user_meta_data.language via trigger sync_user_language_to_auth_meta (se database/2026-05-17-users-language-i18n.sql) så Edge Functions kan læse uden JOIN.';
