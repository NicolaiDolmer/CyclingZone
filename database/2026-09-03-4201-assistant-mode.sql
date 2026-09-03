-- [#4201] Assistentens udtagelses-tilstand: sen-udfyldning / opt-in som valgbar
-- tilstand ved siden af dagens proaktive adfaerd.
--
-- Fem spillere bad 24/8 om at vende auto-udtagelsen om (assistenten skal udfylde
-- det spilleren ikke naaede, ikke fylde alt paa forhaand). Denne migration
-- FORBEREDER kun: den tilfoejer noeglerne og kolonnen med defaults der giver
-- praecis dagens adfaerd. Den flipper INTET.
--
-- app_config.assistant_selection_mode:
--   "proactive" (default) = som i dag: sweepen roerer kun hold uden bruger.
--   "late_fill"           = manager-hold faar en tom trup udfyldt foerst naar
--                           loebet starter inden for assistant_late_fill_hours.
--   "opt_in"              = kun manager-hold med assistant_autopick_enabled=true.
-- Fail-safe i koden (backend/lib/assistantSelectionMode.js): ukendt/manglende
-- vaerdi eller DB-fejl → "proactive".
--
-- teams.assistant_autopick_enabled: default TRUE, saa et flip til "opt_in" ikke
-- i sig selv slukker assistenten for nogen. Spilleren styrer den selv paa
-- Profil-siden (kun synlig naar tilstanden er "opt_in").
--
-- Idempotent. Applies af Claude POST-merge under #2642-rammerne. Denne PR
-- applier IKKE mod prod og flipper IKKE flaget.
--
-- Post-verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'assistant_autopick_enabled';
--   SELECT key, value FROM public.app_config
--   WHERE key IN ('assistant_selection_mode', 'assistant_late_fill_hours');

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS assistant_autopick_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.teams.assistant_autopick_enabled IS
  '#4201: spillerens eget valg af om assistenten maa udtage for holdet. Laeses KUN naar app_config.assistant_selection_mode = "opt_in". Default true, saa et mode-flip aldrig slukker assistenten bag om nogen.';

-- value er JSONB i app_config (2026-05-16-app-config.sql) → seed JSON-strengen
-- via '"proactive"'::jsonb, saa featureStage.readFlagStage returnerer JS-strengen.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'assistant_selection_mode',
  '"proactive"'::jsonb,
  '#4201: assistentens udtagelses-tilstand. proactive (default) = som i dag, sweepen roerer kun hold uden bruger. late_fill = manager-hold faar en TOM trup udfyldt foerst inden for assistant_late_fill_hours foer start. opt_in = kun manager-hold med teams.assistant_autopick_enabled = true. Ukendt vaerdi → proactive.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'assistant_late_fill_hours',
  '24'::jsonb,
  '#4201: hvor mange timer foer foerste etape assistenten maa udfylde en TOM manager-trup, naar assistant_selection_mode = late_fill. Default 24. Uden for 1-168 → 24.'
)
ON CONFLICT (key) DO NOTHING;
