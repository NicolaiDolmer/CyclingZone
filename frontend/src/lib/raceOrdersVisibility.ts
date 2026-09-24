// #5059 · Ren gate-logik for ordre-kolonnen + holdplanen paa Taktik-fanen.
//
// Foer denne fil sendte RaceDetailPage den raa build-variabel TACTICS_V4_PREVIEW
// (import.meta.env.DEV || import.meta.env.VITE_PREVIEW_MOCK) direkte som
// showOrders. Det virkede for udviklerens egen maskine og for preview-mock, men
// en almindelig spiller med det server-styrede flag race_engine_v4 taendt saa
// ALDRIG ordrerne - build-variablen er jo altid false i prod. Samme fail-safe-
// mekanisme som helpFlagGates.js/isHelpSectionVisible: kun et strengt `true` for
// race_engine_v4 taeller som "on"; alt andet (false, en anden stage-vaerdi som
// "beta", manglende noegle, null mens svaret hentes, eller et fejlsvar) er
// skjult.
//
// Rent modul uden imports, saa det kan testes direkte med node --test.

/** Svaret fra GET /api/feature-flags (fetchPlayerFeatureFlags), eller null mens det hentes. */
export type PlayerFeatureFlags = Record<string, unknown> | null | undefined;

/**
 * @param previewFlag Build-tids-flaget (dev/preview-mock) - uaendret fra foer #5059.
 * @param flags Spillerens flag-svar. null/undefined mens det hentes eller ved fejl.
 */
export function computeShowOrders(previewFlag: boolean, flags: PlayerFeatureFlags): boolean {
  if (previewFlag) return true;
  if (!flags || typeof flags !== "object") return false;
  return flags.race_engine_v4 === true;
}
