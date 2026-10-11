// Flag for Udvikling 2.0 del 1: tilbagegangen ved sæsonskiftet (#6499, epic #6110).
//
// ON  → sæsonskiftet bruger developRiderSeasonV2 (riderProgression.js): ingen
//       sæsonvækst for nogen, plateau og derefter fald kun i de fysiske evner +
//       brosten, bremset af den afsluttede sæsons løbsdage og hårde træningsdage.
// OFF → (default, fail-safe) sæsonskiftet er bit-identisk med før #6499.
//
// KUN "on" (eller boolean true) tænder. "beta" betyder i featureStage at en motor
// må skrive SKYGGEDATA for alle mens UI'et er skjult; her findes ingen skygge:
// tilbagegangen er selve rytternes evner. Derfor kaldes evalueringen uden
// engineWrite, så "beta" opfører sig som "off" for sæsonskiftet.
//
// Tænding er ejer-only (D7: tændes til sæsonskiftet efter ejeren har set
// prøvekørslen backend/scripts/dev/agingV2DryRun6110.mjs).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const DEVELOPMENT_V2_AGING_FLAG_KEY = "development_v2_aging_enabled";

export async function isDevelopmentV2AgingEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, DEVELOPMENT_V2_AGING_FLAG_KEY), opts);
}
