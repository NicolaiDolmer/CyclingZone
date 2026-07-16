-- Season Planner assistant-forslag (#2455) — persistér "nulstil til blank".
-- Spec: docs/superpowers/specs/2026-07-13-s5-peak-planner-cockpit-addendum.md (§2/§4)
--   + issue #2455 (ejer-ønske 13/7): assistenten udfylder form-programmerne som
--   FORSLAG fra start; manageren kan acceptere, justere, eller nulstille til blank.
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/
-- execute_sql er kørt af agenten. Idempotent (ADD COLUMN IF NOT EXISTS).
--
-- Forslagene selv er ALDRIG persisterede rækker (de ville ellers påvirke
-- trænings-kvalitets-prognosen/rival-optællingen FØR manageren har accepteret
-- noget — game-design-fejl). De beregnes RENT on-demand i GET /peak-plans/board
-- (backend/lib/peakSuggestions.js) hver gang en rytter har 0 ægte peak-planer.
-- Det ENESTE der mangler en beregnings-kilde er "manageren har aktivt nulstillet
-- til blank" — uden persistering ville forslaget dukke op igen ved næste besøg.
-- Season-scoped (uuid FK, ikke en bool) så et nyt sæson-skifte automatisk
-- nulstiller nulstillingen (nye sæson = nyt forslag, ingen cron/rollover-job
-- nødvendig). NULL = ikke nulstillet (default/normal-sti).
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS peak_suggestions_dismissed_season_id uuid
    REFERENCES public.seasons(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.riders.peak_suggestions_dismissed_season_id IS
  '#2455: sæson-id hvis manageren aktivt har nulstillet assistent-forslaget til blank for denne rytter i den sæson (NULL = ikke nulstillet). Læses/skrives graceful degradation-sikkert i backend/routes/api.js (kolonnen findes muligvis ikke endnu før ejer anvender denne migration) — er kolonnen fraværende, opfører featuren sig som om intet nogensinde er nulstillet (forslag vises altid for ryttere uden ægte peak-planer).';
