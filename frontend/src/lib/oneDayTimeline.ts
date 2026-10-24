// #6512: loebsfilm til endagsloeb. Et endagsloeb gemmer sit individuelle
// resultat som `gc`-raekker (etapeloeb: `stage`), saa filmens egne-ryttere-
// opslag (ownRiderIdsForStage, kun `stage`) skal fodres med begge former.
import { ownRiderIdsForStage } from "./stageSplitTimes.ts";

type ResultRow = Record<string, any>;

/** Holdets egne ryttere i et endagsloeb, uanset om resultatet ligger som `gc` eller `stage`. */
export function ownRiderIdsForOneDay(
  results: ReadonlyArray<ResultRow> | null | undefined,
  teamId: unknown,
): string[] {
  const dayRows = (results || [])
    .filter((r) => r?.result_type === "gc" || r?.result_type === "stage")
    .map((r) => ({ ...r, result_type: "stage", stage_number: 1 }));
  return ownRiderIdsForStage(dayRows, 1, teamId);
}
