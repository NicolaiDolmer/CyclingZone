// Løbssidens intentions-logik (#4613) — ren logik, ingen React, ingen I/O.
// (Overblik-fanen er fjernet med den gamle etapeside, #6570; kun stageHasIntention bruges nu.)
//
// FOG OF WAR: kun "sat" / "ikke sat" — aldrig hvad et valg er værd, aldrig et
// loft, aldrig en anbefaling.

import { DEFAULT_EFFORT } from "./stageRoleMatrixLogic.js";

/**
 * Har holdet sat en intention på etapen? En override der lander på 'normal'
 * tæller ikke — den ER rollens standard.
 *
 * @param {{overrides?: Array<{stage_number:number, rider_id:string, effort?:string}>, stageNumber:number}} args
 */
export function stageHasIntention({ overrides, stageNumber }) {
  return (overrides || []).some(
    (o) => o.stage_number === stageNumber && (o.effort || DEFAULT_EFFORT) !== DEFAULT_EFFORT,
  );
}
