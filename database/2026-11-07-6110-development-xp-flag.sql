-- #6110 trin 2 (spec docs/superpowers/specs/2026-11-06-6110-xp-udvikling-design.md §7, §11):
-- kontakten for XP-modellen (én fælles prisliste, potentialet giver XP pr. dag).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende række ændres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' tænder (beta tæller som slukket: balanceændring for hele
-- ligaen). Startdatoen `development_xp_from_date` oprettes IKKE her: uden den kører
-- motoren dagens model, også hvis kontakten er on. Begge sættes af ejeren på
-- tænd-kortet (spec §7.2). Tallene ligger IKKE her (hard rule 17), men i
-- private_config under `development_xp_params`.
--
-- Evalueres af backend/lib/developmentXpFlag.ts. ON CONFLICT DO NOTHING: overskriver
-- aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'development_xp_model',
  '"off"'::jsonb,
  'Stage flag (off|on) for the #6110 XP model (spec 2026-11-06): one shared price list per ability level, potential sets XP per day. Applies from the Copenhagen date in development_xp_from_date (tick date decides). Params in private_config (development_xp_params). Off = today''s model, bit-identical. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
