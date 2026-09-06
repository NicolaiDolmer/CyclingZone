// Løbsdagens intention (#4632) — ren logik for intentions-fladen
// (RaceIntentionPanel.jsx). Ingen React, ingen I/O — testbar med node --test.
//
// Datamodellen er UÆNDRET fra etape-taktik-matrixen (stageRoleMatrixLogic.js):
// { [stageNumber]: { [riderId]: { race_role, effort } } } for KUN redigerbare
// etaper. Variant B ændrer kun HVAD spilleren rører: rollen gælder hele løbet
// (vises som standard, redigeres ikke pr. etape), og `effort` er dagens
// intention pr. rytter på den etape der er åben.
//
// FOG OF WAR: intet her kender multiplikatorer eller tal. Trinnene kommer fra
// serverens `valid_efforts` (GET /api/races/:raceId/stage-roles), og denne fil
// gør intet andet end at lægge dem i skala-rækkefølge.

import {
  DEFAULT_EFFORT,
  baseRoleForRider,
  setCell,
  isCellOverridden,
} from "./stageRoleMatrixLogic.js";

export { DEFAULT_EFFORT };

// Skala-rækkefølgen (letteste → hårdeste), spejler backendens
// VALID_EFFORTS_FIVE_STEP (raceRoles.js). Bruges KUN til at sortere det
// vokabular serveren sender — aldrig som kilde til hvilke trin der findes.
export const EFFORT_SCALE = Object.freeze([
  "grupetto", "save", "normal", "protect", "all_out",
]);

/**
 * Trinnene fladen skal vise, i skala-rækkefølge. Input er serverens
 * `valid_efforts` (tre værdier når race_day_intention_enabled er OFF, fem når
 * ON) — fladen hardkoder ALDRIG listen, så et flag-flip alene ændrer hvad
 * spilleren kan vælge. Ukendte værdier (et fremtidigt trin serveren kender og
 * denne build ikke) beholdes bagest frem for at blive tabt lydløst.
 *
 * @param {readonly string[]|null|undefined} validEfforts
 * @returns {string[]}
 */
export function orderedEfforts(validEfforts) {
  const valid = Array.isArray(validEfforts) && validEfforts.length
    ? validEfforts
    : [DEFAULT_EFFORT];
  const known = EFFORT_SCALE.filter((e) => valid.includes(e));
  const unknown = valid.filter((e) => !EFFORT_SCALE.includes(e));
  return [...known, ...unknown];
}

/** Rytterens valgte intention på en etape (falder tilbage til 'normal'). */
export function intentionFor({ matrix, stageNumber, riderId }) {
  return matrix?.[stageNumber]?.[riderId]?.effort || DEFAULT_EFFORT;
}

/**
 * Sæt dagens intention for ÉN rytter på ÉN etape. Rollen røres aldrig — den
 * gælder hele løbet (ejer-beslutning 6/9). Ren: ny matrix returneres.
 */
export function setIntention({ matrix, stageNumber, riderId, effort }) {
  return setCell(matrix, stageNumber, riderId, { effort });
}

/**
 * Kopiér én etapes intentioner til en anden etape (mockup'ens "Copy to stage
 * N"). Kun `effort` kopieres; rollen er løbs-bred og må ikke rejse med.
 * Udgåede ryttere springes over — de kan ikke få ny taktik (backend afviser
 * dem med stage_roles_rider_abandoned).
 */
export function copyStageIntentions({ matrix, fromStage, toStage, riders }) {
  const source = matrix?.[fromStage];
  if (!source || matrix?.[toStage] == null) return matrix;
  const skip = new Set((riders || []).filter((r) => r.abandoned).map((r) => String(r.rider_id)));
  let next = matrix;
  for (const [riderId, cell] of Object.entries(source)) {
    if (skip.has(String(riderId))) continue;
    next = setCell(next, toStage, riderId, { effort: cell?.effort || DEFAULT_EFFORT });
  }
  return next;
}

/** Næste redigerbare etape efter `stageNumber`, eller null. */
export function nextEditableStage({ editableStages, stageNumber }) {
  return (editableStages || []).find((sn) => sn > stageNumber) ?? null;
}

/**
 * Fodlinjens tal for ÉN etape: hvor mange ryttere har en intention sat, og hvor
 * mange kører rollens standard. Udgåede ryttere tælles ikke med — de kører
 * ingen af delene.
 */
export function stageIntentionCounts({ matrix, riders, stageNumber }) {
  let set = 0;
  let onDefault = 0;
  for (const rider of riders || []) {
    if (rider.abandoned) continue;
    const effort = intentionFor({ matrix, stageNumber, riderId: rider.rider_id });
    if (effort === DEFAULT_EFFORT) onDefault += 1;
    else set += 1;
  }
  return { set, onDefault };
}

/**
 * De ANDRE redigerbare etaper hvor ingen rytter har en intention sat
 * ("stages 4 and 5 untouched"). En etape hvor rollen afviger, men ingen
 * intention er valgt, tæller stadig som urørt — linjen handler om dagens
 * intention, ikke om rollen.
 */
export function untouchedStages({ matrix, riders, editableStages, exceptStage }) {
  return (editableStages || []).filter((sn) => {
    if (sn === exceptStage) return false;
    return (riders || []).every(
      (rider) => rider.abandoned
        || intentionFor({ matrix, stageNumber: sn, riderId: rider.rider_id }) === DEFAULT_EFFORT,
    );
  });
}

/**
 * Er nogen celle i draften ændret i forhold til rytterens basis (rolle fra
 * udtagelsen + 'normal')? Genbruges til "urørt"-visningen af en rytterrække.
 */
export function hasIntention({ matrix, stageNumber, rider }) {
  const cell = matrix?.[stageNumber]?.[rider?.rider_id];
  return isCellOverridden(cell, rider) && cell?.effort !== DEFAULT_EFFORT;
}

export { baseRoleForRider };
