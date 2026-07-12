// Race Engine v3 (#2224), slice S3 (#2034) — roller + effort PR. ETAPE.
//
// race_stage_roles (S1-forward-scaffold, database/2026-07-12-race-v3-s1-work-cost.sql)
// lader en manager overstyre en rytters race_role/effort for en SPECIFIK etape —
// oven på basis-rollen sat ved udtagelsen (race_entries.race_role). Fallback-kæde
// (spec §11.1): stage-række → race_entries.race_role → ingen rolle. effort mangler
// altid en per-rytter-basis (race_entries har intet effort-felt) → fallback 'normal'.
//
// Ren lib (denne fil): ingen DB. loadStageRoleOverrides (I/O) bor her af co-location,
// men selve resolution/serialization er ren og testbar uden supabase-mock.
//
// KRITISK INVARIANT (raceRunner.js's ansvar, ikke denne fils): overrides må KUN
// anvendes når race_engine_v3_scoring er ON — flag-off skal forblive bit-identisk
// med motoren før S3 (samme mønster som S1/S2's øvrige v3-seams).

/**
 * Indlæs ALLE race_stage_roles-rækker for et løb, grupperet stage → rider → {race_role, effort}.
 * Ubetinget hentning (ingen team-filtrering) — motoren skal se HELE feltets overrides,
 * ikke kun ét holds (i modsætning til API-laget i raceStageRolesApi.js, der scoper til
 * det kaldende holds egne ryttere).
 *
 * @param {{supabase, raceId: string}} args
 * @returns {Promise<Map<number, Map<string, {race_role: string, effort: string}>>>}
 */
export async function loadStageRoleOverrides({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_stage_roles")
    .select("stage_number, rider_id, race_role, effort")
    .eq("race_id", raceId);
  if (error) throw new Error(`race_stage_roles: ${error.message}`);

  const byStage = new Map();
  for (const row of data || []) {
    if (!byStage.has(row.stage_number)) byStage.set(row.stage_number, new Map());
    byStage.get(row.stage_number).set(row.rider_id, { race_role: row.race_role, effort: row.effort });
  }
  return byStage;
}

/**
 * Resolvér en entrants EFFEKTIVE race_role + effort for ÉN etape, givet den etapes
 * override-kort (fra loadStageRoleOverrides().get(stageNumber) — kan være undefined,
 * en tom/manglende etape har ingen overrides). Ren, ingen DB.
 *
 * Fallback-kæde (spec §11.1): stage-override.race_role → entrant.race_role
 * (race_entries-basisrollen, allerede på entranten) → ingen rolle.
 * effort: stage-override.effort → 'normal' (ingen per-rytter-basis findes).
 *
 * @param {{rider_id: string, race_role?: string}} entrant  ORIGINAL entrant (base race_role fra race_entries) — ikke en allerede-mutéret sim-entrant
 * @param {Map<string, {race_role:string, effort:string}>} [overridesForStage]  KUN denne etapes overrides
 * @returns {{race_role?: string, effort: 'protect'|'normal'|'save'}} nyt objekt (spread af entrant + resolveret role/effort)
 */
export function resolveStageEntrant(entrant, overridesForStage) {
  const override = overridesForStage?.get(entrant.rider_id);
  const race_role = override?.race_role || entrant.race_role || null;
  const effort = override?.effort || "normal";
  const resolved = { ...entrant, effort };
  if (race_role) resolved.race_role = race_role;
  else delete resolved.race_role;
  return resolved;
}

/**
 * Per-etape effort-sekvens for ÉN rytter, i etape-rækkefølge — til
 * raceFatigue.stageEnteringFatigues({efforts}) (whole-race-stien, #2034 punkt 4a).
 * null når der slet ingen overrides findes for løbet (kald-stedet falder da tilbage
 * til den gamle enkelt-effort-signatur, bit-identisk).
 *
 * @param {Map<number, Map<string, {race_role:string, effort:string}>>|undefined} stageRoleOverrides
 * @param {string} riderId
 * @param {number[]} stageNumbers  etape-numre i etape-rækkefølge (samme længde/orden som stageProfiles)
 * @returns {string[]|null}
 */
export function effortsSequenceForRider(stageRoleOverrides, riderId, stageNumbers) {
  if (!stageRoleOverrides?.size) return null;
  return stageNumbers.map((sn) => stageRoleOverrides.get(sn)?.get(riderId)?.effort || "normal");
}

/**
 * effort pr. rytter for ÉN specifik etape — til applyRaceFatigue({effortByRider})
 * (#2034 punkt 4b). null når etapen ingen overrides har (kald-stedet falder tilbage
 * til multiplikator 1.0, bit-identisk med før S3).
 *
 * @param {Map<number, Map<string, {race_role:string, effort:string}>>|undefined} stageRoleOverrides
 * @param {number} stageNumber
 * @returns {Map<string,string>|null}
 */
export function effortByRiderForStage(stageRoleOverrides, stageNumber) {
  const overridesForStage = stageRoleOverrides?.get(stageNumber);
  if (!overridesForStage?.size) return null;
  const out = new Map();
  for (const [riderId, o] of overridesForStage) out.set(riderId, o.effort || "normal");
  return out;
}

/**
 * Deterministisk, sorteret fladliste af ALLE overrides for et løb — til
 * input_checksum (#2034 punkt 3): [[stage_number, rider_id, race_role, effort], ...].
 * Bruges kun når v3=true OG stageRoleOverrides ikke er tom (kald-stedet gater),
 * så checksum-payloaden er bagudkompatibel når der ingen overrides er.
 *
 * @param {Map<number, Map<string, {race_role:string, effort:string}>>} stageRoleOverrides
 * @returns {Array<[number, string, string, string]>}
 */
export function serializeStageRoleOverrides(stageRoleOverrides) {
  const out = [];
  for (const [stageNumber, ridersMap] of stageRoleOverrides) {
    for (const [riderId, o] of ridersMap) {
      out.push([stageNumber, riderId, o.race_role, o.effort]);
    }
  }
  out.sort((a, b) => (a[0] - b[0]) || String(a[1]).localeCompare(String(b[1])));
  return out;
}
