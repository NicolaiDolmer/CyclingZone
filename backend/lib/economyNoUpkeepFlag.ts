// #6936: fjern tre løbende udgifter fra og med sæsonskiftet til sæson 5
// (ejer-beslutning 20/10, låst, ingen kompensation):
//   1. rejse og personale pr. seniorløbsdag (travel_staff) + det flade
//      sæsonstart-upkeep (upkeep), hvis det stadig trækkes,
//   2. akademi-/ungdomsdrift (academy_drift),
//   3. facilitets-upkeep ved sæsonstart (facility_upkeep).
// IKKE omfattet: facilitetskøb, scout-rejser, rytterløn og stabsløn.
//
// Bor i app_config (samme mønster som upkeepPerRaceDayFlag.ts) → flippes
// runtime uden re-deploy, og kan slås fra igen.
//
// Nøglen styrer alle steder der opkræver eller forudsiger de tre udgifter, og
// de skal altid følges ad:
//   - economyEngine.processTeamSeasonPayroll (trin 4, 5 og 6a) ved sæsonskiftet,
//   - upkeepPerRaceDay.chargeRaceDayTravelStaffToDate (via autoPrizeSweep),
//   - financeForecast (prognose, sæsonskifte-kvittering, admin-preview),
//   - /api/club/facilities (drift-linjen på Klub-siden).
//
// Fail-safe: fejl/fravær → false (OFF = udgifterne opkræves som i dag).
// "beta" læses som OFF: der findes ingen viewer at gate en opkrævning på, og
// "nogle hold betaler, andre gør ikke" er ikke en tilstand vi vil have.
// Kun "on" (eller boolean true) slukker for udgifterne.
//
// Flippet sker på ejer-go FØR sæsonskiftets "Udfør sæsonskifte" (12c) og
// EFTER at sæsonens sidste seniorløb er afregnet (ellers trækkes rejse og
// personale ikke for de sidste løbsdage i den gamle sæson).
// Rollback (OFF igen) bør ske ved et sæsonskifte: slås flaget fra midt i en
// sæson, trækker den næste afregning rejse og personale for ALLE sæsonens
// afsluttede seniorløbsdage på én gang (nøglerne findes ikke endnu).
import { readFlagStage } from "./featureStage.js";

export const ECONOMY_NO_UPKEEP_FLAG_KEY = "economy_no_upkeep_v1";

type ReadFlagStageClient = Parameters<typeof readFlagStage>[0];

/** Ren evaluering af app_config-værdien — kun "on"/true slukker udgifterne. */
export function evaluateEconomyNoUpkeep(raw: unknown): boolean {
  return raw === true || raw === "on";
}

export async function isEconomyNoUpkeepEnabled(supabase: ReadFlagStageClient): Promise<boolean> {
  return evaluateEconomyNoUpkeep(await readFlagStage(supabase, ECONOMY_NO_UPKEEP_FLAG_KEY));
}
