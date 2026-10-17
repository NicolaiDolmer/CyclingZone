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

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_language_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_language_check
    CHECK (language IN ('en','da','fr','es','nl'));
