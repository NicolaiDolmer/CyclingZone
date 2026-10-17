-- #6836: fr/es/nl registreres som skjulte beta-sprog i
-- frontend/src/i18n/languages.js. users.language-CHECK'en SKAL udvides i samme
-- PR (samme liste begge steder, ellers afviser DB'en et sprogvalg som
-- sprogvaelgeren tilbyder en beta-tester; se #4733 og docs/i18n/README.md
-- "Tilfoej et sprog", trin 3).
--
-- Kun CHECK-listen aendres: ('en','da') -> ('en','da','fr','es','nl').
-- Ingen raekker muteres, ingen RLS/GRANT-aendring. Beta-sprogene er kun valgbare
-- for ejer + beta-testere (lib/languageAccess.js); almindelige spillere kan ikke
-- vaelge dem i UI'et, og browser-detektionen vaelger dem aldrig.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT er trygt at re-koere
-- (auto-migrate.yml).
--
-- Rollback (kun hvis ingen raekke har fr/es/nl; ellers saet dem til 'en' foerst):
--   UPDATE public.users SET language = 'en' WHERE language IN ('fr','es','nl');
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_language_check;
--   ALTER TABLE public.users
--     ADD CONSTRAINT users_language_check CHECK (language IN ('en','da'));

-- LAASE (#6342, samme moenster som races_engine_rules_revision_check): users er en
-- varm tabel. Constrainten erstattes i EN kort transaktion som NOT VALID (ingen
-- tabelscan under ACCESS EXCLUSIVE), og VALIDATE koerer bagefter for sig under en
-- svagere laas. lock_timeout faar begge skridt til at fejle hurtigt (og kunne
-- koeres igen) i stedet for at blokere spillernes laesninger.
SET lock_timeout = '3s';

BEGIN;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_language_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_language_check
    CHECK (language IN ('en','da','fr','es','nl')) NOT VALID;
COMMIT;

ALTER TABLE public.users VALIDATE CONSTRAINT users_language_check;

-- Verify: constrainten kender alle fem sprog og er valideret.
DO $$
DECLARE
  def text;
  validated boolean;
BEGIN
  SELECT pg_get_constraintdef(oid), convalidated INTO def, validated
    FROM pg_constraint
   WHERE conname = 'users_language_check' AND conrelid = 'public.users'::regclass;
  IF def IS NULL OR position('nl' IN def) = 0 OR position('fr' IN def) = 0 OR position('es' IN def) = 0 THEN
    RAISE EXCEPTION '#6836 verify: users_language_check mangler fr/es/nl (%).', def;
  END IF;
  IF NOT validated THEN
    RAISE EXCEPTION '#6836 verify: users_language_check er ikke valideret.';
  END IF;
END $$;

RESET lock_timeout;
