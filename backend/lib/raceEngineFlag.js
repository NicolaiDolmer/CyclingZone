// Race Engine light-motor (#1102), slice 2 — feature-flag.
//
// RACE_ENGINE_V2_ENABLED bor i app_config (key/value-tabellen), så den kan flippes
// runtime UDEN re-deploy — afgørende for en launch-sikker nød-fallback: kan motoren
// opføre sig forkert, slukkes den øjeblikkeligt og den uændrede PCM-import-sti er
// igen eneste resultat-kilde.
//
// flag-off (default) = PCM-stien er præcis uændret. Race-afvikling er en sjælden
// admin-handling, så ét DB-opslag pr. kald er gratis. Returnerer ALTID boolean —
// fejl/fravær → false (fail-safe mod utilsigtet aktivering).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RACE_ENGINE_V2_FLAG_KEY = "race_engine_v2_enabled";

export async function isRaceEngineV2Enabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_ENGINE_V2_FLAG_KEY), opts);
}

// Race Engine v3 (#2224) — dominans/varians-dybden (roller-med-pris S1,
// dagsform S2, ...). Selvstændig kill-switch OVEN PÅ race_engine_v2_enabled
// (v2 skal være ON for at motoren overhovedet kører; v3 styrer om den kører
// med de NYE score-komponenter). Ejer-politik (spec §5): "on for alle, jf.
// ejer-politik om ingen beta-gates" — 'beta'-tilstanden findes teknisk (samme
// tre-tilstands-maskine som v2), men bruges ikke i praksis for v3.
// flag-off (default) = raceSimulator.simulateStage kaldes med v3=false →
// BIT-IDENTISK med motoren før S1.
export const RACE_ENGINE_V3_SCORING_FLAG_KEY = "race_engine_v3_scoring";

export async function isRaceEngineV3ScoringEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_ENGINE_V3_SCORING_FLAG_KEY), opts);
}
