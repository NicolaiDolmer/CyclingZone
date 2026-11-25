// #4948 · Klient til GET /api/feature-flags: det globale, allowlistede svar paa
// "er denne funktion taendt for mig?" (backend/api/featureFlagsApi.js).
//
// Virker ogsaa uden login (/help er offentlig): uden session sendes kaldet
// uden Authorization-header og besvares som for en anonym spiller. Med session
// sendes tokenet, saa en beta-tester ogsaa ser beta-stadiet.
//
// Aldrig blokerende og aldrig kastende: ethvert fejlsvar giver {} = alt off,
// samme fail-safe som serverens evaluateFlagStage.
import { readPlayerFeatureFlags } from "./featureFlagRequests.ts";
import { authHeaders } from "./supabase";

/** @returns {Promise<Record<string, boolean>>} */
export async function fetchPlayerFeatureFlags() {
  try {
    const headers = (await authHeaders({ json: false })) ?? {};
    return (await readPlayerFeatureFlags(headers)) ?? {};
  } catch {
    return {};
  }
}
