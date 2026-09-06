// Løbssidens Overblik-fane (#4613) — ren logik, ingen React, ingen I/O.
//
// Overblikket er en landingsside, ikke en mur: den svarer på hvad der stadig er
// ÅBENT at beslutte, og peger på den ene fane hvor beslutningen tages. Denne
// fil regner listen ud af det stage-roles-svaret allerede bærer.
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

/**
 * De etaper der stadig kan sættes taktik på, med om der er sat noget.
 * Rækkefølge = etapenummer. Tom liste = intet tilbage at beslutte.
 *
 * @param {{overrides?: Array, stageCount?: number, stagesCompleted?: number}} args
 * @returns {Array<{stageNumber: number, hasIntention: boolean}>}
 */
export function openStageDecisions({ overrides = [], stageCount = 0, stagesCompleted = 0 }) {
  const out = [];
  for (let sn = (Number(stagesCompleted) || 0) + 1; sn <= (Number(stageCount) || 0); sn++) {
    out.push({ stageNumber: sn, hasIntention: stageHasIntention({ overrides, stageNumber: sn }) });
  }
  return out;
}

/**
 * "Før flaget"-tjeklisten: hvad er på plads, og hvad står stadig åbent.
 * Hvert punkt er {key, done, params} — kaldstedet oversætter, denne fil
 * formulerer intet.
 *
 * @param {{riders?: Array, overrides?: Array, stageCount?: number, squadMax?: number|null}} args
 */
export function beforeFlagChecklist({ riders = [], overrides = [], stageCount = 1, squadMax = null }) {
  const picked = riders.length;
  const hasCaptain = riders.some((r) => r.race_role === "captain");
  const namedRoles = riders
    .filter((r) => r.race_role && r.race_role !== "helper")
    .map((r) => r.race_role);
  const firstStageSet = stageHasIntention({ overrides, stageNumber: 1 });
  const laterStages = Math.max(0, (Number(stageCount) || 1) - 1);
  return [
    { key: "teamPicked", done: picked > 0, params: { count: picked, max: squadMax ?? picked } },
    { key: "rolesSet", done: hasCaptain, params: { roles: namedRoles } },
    { key: "firstStage", done: firstStageSet, params: {} },
    ...(laterStages > 0 ? [{ key: "laterStages", done: false, params: { from: 2, to: stageCount } }] : []),
  ];
}

/**
 * Dine ryttere i en klassement-liste, som "top N + dine egne" — mockuppens
 * "Where you stand". Rækkerne der ALLEREDE er i toppen duplikeres ikke.
 *
 * @param {{rows?: Array<{rank?: number, rider_id?: string, team_id?: string}>, myTeamId?: string|null, top?: number}} args
 */
export function standingsWithMine({ rows = [], myTeamId = null, top = 6 }) {
  const sorted = [...rows].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const head = sorted.slice(0, top);
  if (myTeamId == null) return head;
  const seen = new Set(head.map((r) => r.id ?? `${r.rank}:${r.rider_id}`));
  const mine = sorted.filter(
    (r) => String(r.team_id ?? r.rider?.team?.id) === String(myTeamId)
      && !seen.has(r.id ?? `${r.rank}:${r.rider_id}`),
  );
  return [...head, ...mine];
}
