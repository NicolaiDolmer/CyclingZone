-- [#4983] Synlig paamindelse foer trup-udtagelsesfristen: spillerens til/fra.
--
-- To spillere bad 7/9 om baade en synlig varsling (gul markering ved
-- "Planlaegning", tydelig boks paa siden, roed eskalering taet paa fristen) OG
-- at man selv kan styre om man vil paamindes (@thelamba: "Der skal vaere en
-- indstilling for hvordan/om man vil paamindes"). GDD-beslutning D-034 gjorde
-- den synlige paamindelse til retningen.
--
-- Denne migration tilfoejer KUN spillerens kontakt. Default TRUE, saa ingen
-- eksisterende manager mister paamindelsen ved merge, og en manglende kolonne
-- (foer apply) laeses i koden som "til" (backend/routes/api.js:
-- req.team?.selection_reminder_enabled !== false).
--
-- Paamindelsen selv opfinder ingen frist og ingen ny tabel: fristen er foerste
-- etapes scheduled_at (race_stage_schedule) og "trup mangler" er antal
-- race_entries < selectionSizeForRace(race).max — samme kilder som #2180's
-- indbakke-varsel og #4038's rettelse. Der skrives INTET til race_entries,
-- assistant_selection_mode eller notifications.
--
-- Idempotent. Applies af CI (auto-migrate.yml) ved merge; denne PR applier
-- IKKE mod prod.
--
-- Post-verify:
--   SELECT column_name, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'selection_reminder_enabled';
--   SELECT count(*) FILTER (WHERE selection_reminder_enabled) AS paa,
--          count(*) FILTER (WHERE NOT selection_reminder_enabled) AS fra
--   FROM public.teams;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS selection_reminder_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.teams.selection_reminder_enabled IS
  '#4983: spillerens eget valg af om den synlige paamindelse foer trup-udtagelsesfristen vises (gul markering i navigationen + boks paa planlaegningssiden, roed under assistant_late_fill_hours). Default true. Ren UI-tilstand — paavirker hverken assistenten, race_entries eller indbakken.';
