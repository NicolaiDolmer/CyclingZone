-- #4578 · Kvitterings-events mangler maal-kobling: Last movement, medlems-
-- stemning og ejer-stemme i referatet er begraensede.
-- ============================================================================
-- board_satisfaction_events linker i dag KUN til mandate_id/milestone_id, ikke
-- til det enkelte mandat-maal. Uden en maal-kobling kan backend/lib/boardRoom.js
-- (Boardroom-payloaden, GET /board/room) ikke levere:
--   1. "Last movement" pr. maal (receipt.lastMovementAt er altid null)
--   2. Medlems-stemning ud fra ALLE maal-events (kun milepaels-events i dag)
--   3. Referat-raekker i maalets EJERS stemme (mandat-niveau falder altid til
--      formanden, fordi en raekke ikke kan siges at tilhoere ét bestemt maal)
--
-- Denne migration laegger DATA-KROGEN: en ny nullable JSONB-kolonne der baerer
-- et snapshot af alle maal-tilstande PAA DET TIDSPUNKT kvitteringen blev
-- skrevet. Selve skrivningen (boardMandateEngine.js::buildGoalStatesFromEvaluation)
-- og laesningen (boardRoom.js::deriveGoalMovements) er separate, rene
-- funktioner i samme PR — denne fil aendrer KUN skemaet.
--
-- Formen pr. element i arrayet (se boardMandateEngine.js):
--   {
--     goal_key:   string  — boardGoals.js::buildGoalKey(goal), indholdsbaseret
--                           (type|target|nationality_code|race_scope|cumulative),
--                           IKKE et id (maal i board_mandates.goals[] har aldrig
--                           haft id'er, prod-fund 2/9).
--     type:       string  — maalets type (samme som goal.type).
--     status:     string  — evaluateGoalProgress's status ("ahead"/"on_track"/
--                           "near_miss"/"watch"/"behind"/"awaiting_data"/"neutral").
--     met:        boolean — evaluateGoalProgress's autoritative "naaet"-flag.
--     score_pct:  number|null
--     actual:     number|null
--     target:     number|null
--   }
--
-- Prod-fund (verificeret 2/9): 0 raekker med mandate_id skrevet endnu (motoren
-- skriver foerst ved fuld aktivering af mandat-modellen, som stadig er bag
-- kill-switchen board_mandate_model_enabled='off'/'beta'). Feltet udfyldes
-- derfor UDELUKKENDE fremadrettet — INGEN backfill af eksisterende raekker.
--
-- INERT: kolonnen er nullable uden default, ingen eksisterende raekke aendrer
-- vaerdi ved denne migration. Idempotent (add column if not exists). Samme
-- kill-switch-status som database/2026-08-18-3514-mandate-model.sql — 'off'
-- er stadig bit-for-bit uaendret adfaerd (motoren skriver kun til skygge-
-- tabellernes egne kolonner, board_satisfaction_events er allerede én af dem).

alter table public.board_satisfaction_events
  add column if not exists goal_states jsonb;

comment on column public.board_satisfaction_events.goal_states is
  '#4578 · Snapshot af maal-tilstande paa kvitterings-tidspunktet, ét element pr. maal i evaluationen: {goal_key, type, status, met, score_pct, actual, target}. goal_key er boardGoals.js::buildGoalKey(goal) (indholdsbaseret, IKKE et id). Nullable, ingen backfill — udfyldes kun fremadrettet af boardMandateEngine.js::buildGoalStatesFromEvaluation via computeRelationUpdateFromEvaluation. Laeses af boardRoom.js::deriveGoalMovements til Last movement/stemning/ejer-stemme i referatet.';
