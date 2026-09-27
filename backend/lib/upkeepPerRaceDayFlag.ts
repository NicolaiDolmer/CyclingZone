// #4385: upkeep som løbende rejse-/personaleudgift pr. seniorløbsdag i stedet
// for ét fladt træk ved sæsonstart (ejer-beslutning 26/9, fire låste valg).
// Bor i app_config (samme mønster som academyDriftFlag.ts) → flippes runtime
// uden re-deploy.
//
// Nøglen styrer TO steder, og de skal altid følges ad:
//   1. economyEngine.processTeamSeasonPayroll trin 5 — med flaget ON trækkes
//      det flade UPKEEP_BY_DIVISION-beløb IKKE ved sæsonstart.
//   2. upkeepPerRaceDay.chargeRaceDayTravelStaffToDate (via autoPrizeSweep) —
//      med flaget ON trækkes UPKEEP_PER_RACE_DAY_BY_DIVISION pr. seniorløbsdag
//      holdet havde mindst én rytter til start på.
//
// Fail-safe: fejl/fravær → false (OFF = den gamle model, uændret adfærd).
// "beta" læses som OFF: der findes ingen viewer at gate på, og halvvejs-
// tilstanden "nogle hold betaler pr. løbsdag, andre ved sæsonstart" ville give
// dobbelt- eller nul-træk. Kun "on" (eller boolean true) tænder modellen.
//
// Flippet er EJER-ONLY og skal ske FØR sæsonskiftets processSeasonStart
// (12c "Udfør sæsonskifte"), ellers har holdene allerede betalt det flade beløb
// for sæsonen. Dobbelt-træk er dog blokeret i koden: løbsdags-trækket springer
// ethvert hold over der allerede har en 'upkeep'-post i samme sæson.
import { readFlagStage } from "./featureStage.js";

export const UPKEEP_PER_RACE_DAY_FLAG_KEY = "upkeep_per_race_day";

type ReadFlagStageClient = Parameters<typeof readFlagStage>[0];

/** Ren evaluering af app_config-værdien — kun "on"/true tænder modellen. */
export function evaluateUpkeepPerRaceDay(raw: unknown): boolean {
  return raw === true || raw === "on";
}

export async function isUpkeepPerRaceDayEnabled(supabase: ReadFlagStageClient): Promise<boolean> {
  return evaluateUpkeepPerRaceDay(await readFlagStage(supabase, UPKEEP_PER_RACE_DAY_FLAG_KEY));
}
