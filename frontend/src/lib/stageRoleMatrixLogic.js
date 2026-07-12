// Race Engine v3 (#2224), slice S3 (#2034) — ren logik for etape-taktik-matrixen
// (StageRoleMatrix.jsx). Ingen React, ingen I/O — testbar med node --test.
//
// Matrix-repræsentation (kun REDIGERBARE etaper, dvs. stage_number >
// stages_completed): { [stageNumber]: { [riderId]: { race_role, effort } } }.
// Kørte etaper vises separat (read-only) af komponenten via resolveCell — de
// indgår ALDRIG i draft-matrixen, så et gem kan aldrig røre dem (spejler
// backendens .gt("stage_number", stagesCompleted)-scope i raceStageRolesApi.js).
//
// "Default = løbs-roller kopieres, kun afvigelser redigeres": en celle uden
// override viser rytterens BASIS-rolle (race_entries.race_role, fallback
// 'helper' — den almindelige domestik-rolle) + effort 'normal'. diffToOverrides
// sender KUN celler der afviger fra dette (REPLACE-semantik, #2034 kontrakt).

export const DEFAULT_ROLE = "helper";
export const DEFAULT_EFFORT = "normal";

// Rytterens basis-rolle (race_entries.race_role via GET .riders[].race_role).
// Ingen basis-rolle sat ved udtagelsen → 'helper' (almindelig domestik) er den
// sensible UI-default; matcher backendens fallback-kæde-ånd (spec §11.1) uden
// at vise "ingen rolle" som en fjerde, forvirrende tilstand i matrixen.
export function baseRoleForRider(rider) {
  return rider?.race_role || DEFAULT_ROLE;
}

// Map "stageNumber:riderId" → {race_role, effort} for hurtigt opslag.
export function overridesIndex(overrides) {
  const map = new Map();
  for (const o of overrides || []) {
    map.set(`${o.stage_number}:${o.rider_id}`, { race_role: o.race_role, effort: o.effort });
  }
  return map;
}

// Resolvér ÉN celles effektive værdi (override → basis-rolle/normal). Bruges
// BÅDE til at vise låste (kørte) etaper og til at seede draft-matrixen.
export function resolveCell({ rider, stageNumber, overridesMap }) {
  const ov = overridesMap.get(`${stageNumber}:${rider.rider_id}`);
  return {
    race_role: ov?.race_role || baseRoleForRider(rider),
    effort: ov?.effort || DEFAULT_EFFORT,
  };
}

// Bygger den redigerbare draft-matrix for alle KOMMENDE etaper (stage_number >
// stagesCompleted), seedet fra basis-roller + eksisterende overrides.
export function buildDraftMatrix({ riders, overrides, stageNumbers, stagesCompleted }) {
  const overridesMap = overridesIndex(overrides);
  const editableStages = (stageNumbers || []).filter((n) => n > stagesCompleted);
  const matrix = {};
  for (const sn of editableStages) {
    matrix[sn] = {};
    for (const rider of riders || []) {
      matrix[sn][rider.rider_id] = resolveCell({ rider, stageNumber: sn, overridesMap });
    }
  }
  return matrix;
}

// Afviger cellen fra rytterens basis-rolle/normal-effort? Driver den synlige
// afvigelses-markør ("default kopieret, kun afvigelser redigeret" skal være
// tydelig i UI'et).
export function isCellOverridden(cell, rider) {
  if (!cell) return false;
  return cell.race_role !== baseRoleForRider(rider) || cell.effort !== DEFAULT_EFFORT;
}

// Ren opdatering af én celle — returnerer en NY matrix (muterer aldrig input).
export function setCell(matrix, stageNumber, riderId, patch) {
  const stageCells = matrix[stageNumber] || {};
  const current = stageCells[riderId] || { race_role: DEFAULT_ROLE, effort: DEFAULT_EFFORT };
  return {
    ...matrix,
    [stageNumber]: {
      ...stageCells,
      [riderId]: { ...current, ...patch },
    },
  };
}

// Diff draft-matrixen → PUT-payloadens overrides-array. REPLACE-semantik: kun
// celler der afviger fra basis-rolle/normal-effort sendes (#2034 kontrakt —
// "send KUN afvigelser"). Deterministisk sortering (stage asc, rider_id asc)
// for et stabilt payload/testbart output.
export function diffToOverrides({ matrix, riders }) {
  const ridersById = new Map((riders || []).map((r) => [String(r.rider_id), r]));
  const out = [];
  for (const stageNumberStr of Object.keys(matrix || {})) {
    const stageNumber = Number(stageNumberStr);
    const riderCells = matrix[stageNumberStr];
    for (const riderIdStr of Object.keys(riderCells || {})) {
      const cell = riderCells[riderIdStr];
      const rider = ridersById.get(riderIdStr);
      if (!rider) continue; // defensiv — rytter forsvundet fra holdet siden load
      if (isCellOverridden(cell, rider)) {
        out.push({
          stage_number: stageNumber,
          rider_id: rider.rider_id,
          race_role: cell.race_role,
          effort: cell.effort,
        });
      }
    }
  }
  out.sort((a, b) => a.stage_number - b.stage_number || String(a.rider_id).localeCompare(String(b.rider_id)));
  return out;
}

// Dirty-check: sammenligner to draft-matricer celle for celle (robust mod
// nøgle-rækkefølge, i modsætning til en simpel JSON.stringify-sammenligning).
export function isDirty(draftMatrix, initialMatrix) {
  const a = draftMatrix || {};
  const b = initialMatrix || {};
  const stages = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const sn of stages) {
    const stageA = a[sn] || {};
    const stageB = b[sn] || {};
    const riderIds = new Set([...Object.keys(stageA), ...Object.keys(stageB)]);
    for (const rid of riderIds) {
      const cellA = stageA[rid];
      const cellB = stageB[rid];
      if (!cellA || !cellB) return true;
      if (cellA.race_role !== cellB.race_role || cellA.effort !== cellB.effort) return true;
    }
  }
  return false;
}

// Førertrøje-genvej (#2034 punkt 4): GC-føreren efter seneste kørte etape, KUN
// hvis han er en af mine ryttere i løbet (ellers ingen genvej at vise).
// gcRows = klassement-rækker med {rank, rider_id} (fra raceLiveStandings/
// raceStageClassifications — rank 1 = føreren).
export function jerseyLeaderId({ gcRows, myRiderIds }) {
  const leader = (gcRows || []).find((r) => (r.rank ?? 9999) === 1);
  if (!leader?.rider_id) return null;
  const mine = new Set((myRiderIds || []).map(String));
  return mine.has(String(leader.rider_id)) ? leader.rider_id : null;
}

// Anvender genvejen på draft-matrixen: sætter captain-override for `leaderId`
// på ALLE kommende etaper, og demoterer en evt. anden resolved captain til
// helper på de samme etaper (kun rolle — effort røres ikke for de demoterede,
// så en 'protect'/'save'-indstilling ikke nulstilles ved siden af). Ren — ny
// matrix returneres, input muteres aldrig. Lander i draft-state; brugeren
// trykker selv Gem (#2034 punkt 4 — ingen implicit persistering).
export function applyJerseyCaptainShortcut({ matrix, leaderId, stageNumbers, stagesCompleted }) {
  const editableStages = (stageNumbers || []).filter((n) => n > stagesCompleted);
  const leaderKey = String(leaderId);
  let next = matrix;
  for (const sn of editableStages) {
    const stageCells = next[sn] || {};
    for (const [riderId, cell] of Object.entries(stageCells)) {
      if (riderId !== leaderKey && cell.race_role === "captain") {
        next = setCell(next, sn, riderId, { race_role: "helper" });
      }
    }
    const leaderCell = next[sn]?.[leaderKey];
    next = setCell(next, sn, leaderKey, { race_role: "captain", effort: leaderCell?.effort || DEFAULT_EFFORT });
  }
  return next;
}
