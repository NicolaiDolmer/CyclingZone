-- 2026-09-06 · #4246 #4030 #3855 — race_team_orders: rollen UD af ordren,
-- sprint-toget IND. Ejer-beslutninger 27/8 ("rollen maa aldrig overskrives af
-- taktik-kortet") og 2/9 ("rollen ER standardordren, taktik-kortet er etape-
-- overlay"), jf. docs/superpowers/specs/2026-09-06-race-engine-v4-flip-and-
-- tactics-design.md og docs/RACE_ENGINE_RULES.md §1.
--
-- INGEN SKEMAAENDRING. `riders` er jsonb og shapen haandhaeves i API-laget
-- (backend/lib/raceTeamOrdersApi.js's validateTeamOrder + motorens
-- backend/lib/engine/v4/ai/teamOrderContract.ts), ikke som DB-CHECK — samme
-- konvention som race_simulation_rider_scores.components. Det nye felt
-- (`leadout`) og det fjernede felt (`race_role`) kraever derfor hverken kolonne,
-- constraint eller datamigration:
--
--   · `race_role` i EKSISTERENDE raekker laeses ikke laengere af nogen (adapteren
--     tager rollen fra race_entries.race_role). Feltet ryddes IKKE her —
--     datasletning er destruktiv klasse og ejer-gated. Det bliver blot inert og
--     forsvinder af sig selv naeste gang holdet gemmer sin taktik.
--   · `leadout` er VALGFRIT (fravaer = false), saa hver eneste raekke der
--     allerede ligger i tabellen er stadig en gyldig ordre.
--
-- Denne fil retter derfor kun de to KOLONNE-KOMMENTARER, som auditten 5/9
-- fandt stale ("Rollefeltet ... staar stadig i API'et, i adapteren og i
-- databasekommentaren").
--
-- COMMITTES SOM .sql — koeres af auto-migrate.yml ved merge. Idempotent:
-- COMMENT ON er en ren erstatning og kan koeres vilkaarligt mange gange.

BEGIN;

COMMENT ON TABLE public.race_team_orders IS
  '#4030/#3855/#4246: etapens TAKTIK-OVERLAY pr. (team, race, stage) — indsats, udbruds-holdning og sprint-tog. Rollen bor IKKE her: den staar i race_entries.race_role, gaelder hele loebet og ER standardordren (ejer 2/9); denne raekke laegges oven paa den. GET/PUT: backend/routes/api.js /races/:raceId/team-orders?stage=N. Kontrakt (delt af API, adapter og AI): backend/lib/engine/v4/ai/teamOrderContract.ts. Adapter til motoren: backend/lib/engine/v4/orders/teamOrdersAdapter.ts.';

COMMENT ON COLUMN public.race_team_orders.riders IS
  'Per-rytter etape-overlay: [{rider_id, effort: grupetto|save|normal|protect|all_out, try_break: bool, leadout: bool}]. `leadout` = rytteren koerer i holdets sprint-tog (M6; togets maal er rollen sprint_captain og kan ikke saettes herfra). `race_role` er IKKE et gyldigt felt (ejer 27/8, #4246) — PUT afviser det med 400, og gamle raekker der baerer det ignoreres af adapteren. Validering i API-laget, ikke DB-CHECK.';

COMMIT;

-- ── Post-apply sanity (kør manuelt, ikke en del af transaktionen) ────────────
-- select obj_description('public.race_team_orders'::regclass);            -- forventes den nye tekst
-- select count(*) from public.race_team_orders
--   where riders @> '[{"race_role": null}]'::jsonb;                       -- inerte legacy-felter, ikke en fejl
