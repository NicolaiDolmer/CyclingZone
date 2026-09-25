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
 * #5580 (spec motor runde 2, M1 punkt 6, "én kilde til effort"): er et
 * `orderEffortByRider`-kort givet (race_team_orders' effort for DENNE etape),
 * vinder ordren, og stage-rækkens effort er kun fallback når ordren mangler.
 * race_team_orders er "eneste sandhed for etapens overlay" (ejer 21/8,
 * raceTeamOrdersApi.js). Uden kortet (default) er resultatet bit-identisk med
 * før. raceRunner giver kun kortet når løbsmotor v4 kører (flaget
 * race_engine_v4), så v3-stien er uændret.
 *
 * @param {{rider_id: string, race_role?: string}} entrant  ORIGINAL entrant (base race_role fra race_entries) — ikke en allerede-mutéret sim-entrant
 * @param {Map<string, {race_role:string, effort:string}>} [overridesForStage]  KUN denne etapes overrides
 * @param {Map<string, string>|null} [orderEffortByRider]  #5580: ordrens effort pr. rytter for DENNE etape (orderEffortByRiderForStage)
 * @returns {{race_role?: string, effort: 'grupetto'|'save'|'normal'|'protect'|'all_out'}} nyt objekt (#4632: fem trin) (spread af entrant + resolveret role/effort)
 */
export function resolveStageEntrant(entrant, overridesForStage, orderEffortByRider = null) {
  const override = overridesForStage?.get(entrant.rider_id);
  const race_role = override?.race_role || entrant.race_role || null;
  const effort = orderEffortByRider?.get(String(entrant.rider_id)) || override?.effort || "normal";
  const resolved = { ...entrant, effort };
  if (race_role) resolved.race_role = race_role;
  else delete resolved.race_role;
  return resolved;
}

// #5223: roller der må findes HØJST ÉN gang pr. (hold, etape). Samme tre som
// holdudtagelsens partielle unique-indexes (uq_race_entries_captain/
// _sprint_captain/_hunter, database/2026-06-12-race-entries-roles.sql) og samme
// tre som gemme-guarden i raceStageRolesApi.validateStageRoleOverrides tæller.
// `helper`/`free_role` er ikke eksklusive.
export const EXCLUSIVE_STAGE_ROLES = Object.freeze(["captain", "sprint_captain", "hunter"]);
// Rollen en degraderet indehaver falder til. RACE_ENGINE_RULES.md §1 (rolle-
// vokabularet, kanonisk): `helper` = "Domestique — arbejder for kaptajnen".
// Samme degraderings-mål som entry-generatorens rolle-oprydning bruger
// (raceEntryGenerator.js:704, `.update({ race_role: "helper" })`).
export const DEMOTED_STAGE_ROLE = "helper";

/**
 * #5223 — HOLD-NIVEAU sammenfletning af basisrolle og etape-rolle for ÉN etape.
 *
 * `resolveStageEntrant` ovenfor er PR. RYTTER: den kender kun den ene rytters
 * basisrolle og hans egen override. Den kan derfor ikke se, at holdets basis-
 * sprint_captain (rytter A, `race_entries.race_role`) og en etape-override på
 * rytter B ender som TO sprint_captains i det rollesæt motoren får — netop den
 * dublet `raceSimulator.buildTeamContext` rapporterede i Sentry CYCLINGZONE-5Z
 * (#5223), hvor motoren beholdt den første og tavst ignorerede den anden.
 *
 * Gemme-guarden (`raceStageRolesApi.validateStageRoleOverrides`, #4344/#4746/
 * #5202) afviser et PUT der ville skabe dubletten, men den er et øjebliksbillede
 * af `race_entries` PÅ GEMME-TIDSPUNKTET: en senere ændring af basisrollen
 * (holdudtagelsen skriver `race_entries` uden at røre `race_stage_roles`),
 * legacy-rækker fra før guarden, og direkte DB-skrivninger kan alle lade et
 * gyldigt gem blive til en dublet bagefter. RACE_ENGINE_RULES.md §7 modsigelse
 * 12 siger det direkte om præcis samme mekanik for `hunter`: "App-lag løst 4/9
 * (#4746), DB-lag stadig åbent" — der er INGEN DB-constraint på
 * `race_stage_roles`, og 119 af 760 hold-etape-hunter-grupper stod målt 3/9 med
 * mere end én indehaver. Motoren skal derfor kunne flette et urent datasæt
 * deterministisk, ikke antage at det er rent.
 *
 * Regel (deterministisk, uafhængig af DB-rækkefølge):
 *   1. Etape-rollen VINDER over basisrollen — manageren har valgt den for netop
 *      denne dag, og basisrollen gælder "hele løbet" som standard (spec §11.1's
 *      fallback-kæde peger samme vej: stage-række FØR race_entries).
 *   2. Øvrige indehavere af samme eksklusive rolle på holdet degraderes til
 *      `helper` for DENNE etape (basisrollen i DB røres ikke).
 *   3. Er begge (eller ingen) indehavere etape-overrides — kun muligt med
 *      legacy/rå data, da hverken DB-indexet eller gemme-guarden tillader det —
 *      vinder den LAVESTE rider_id. Bevidst IKKE "første i entrants-rækkefølgen"
 *      (#4357): DB-rækkefølgen er ingen kontrakt, og simulateStage sorterer selv
 *      på rider_id for rng-determinisme. Disse tilfælde rapporteres i
 *      `conflicts` — de er en data-anomali, i modsætning til punkt 1, som er
 *      almindelig, tilsigtet taktik.
 *
 * Ingen dublet → outputtet er bit-identisk med `entrants.map(resolveStageEntrant)`.
 *
 * @param {Array<{rider_id: string, team_id?: string, race_role?: string}>} entrants ORIGINALE entrants (basisrolle fra race_entries)
 * @param {Map<string, {race_role:string, effort:string}>} [overridesForStage] KUN denne etapes overrides
 * @param {{ineligibleRiderIds?: Set<string>, orderEffortByRider?: Map<string,string>|null}} [opts]
 *   `ineligibleRiderIds`: ryttere der ikke kører DENNE
 *   etape (udgået/skadet, `race_incidents.outcome='abandon'`). De deltager ikke i
 *   konflikt-afgørelsen: en udgået rytter må hverken vinde en eksklusiv rolle
 *   (kald-stedet filtrerer ham væk bagefter, og holdet ville da stå HELT uden
 *   lederen) eller degradere en aktiv holdkammerat. Deres egen resolverede rolle
 *   er uændret — den bliver alligevel aldrig læst. Stage-by-stage-stien
 *   (simulateStageByIndex) filtrerer allerede abandons FØR den kalder motoren og
 *   behøver den ikke; hele-løbs-stien (buildRaceResults) filtrerer først EFTER
 *   resolution og sender derfor sin egen abandonedSet med.
 *   `orderEffortByRider` (#5580): se resolveStageEntrant — ordrens effort vinder.
 * @returns {{entrants: Array<object>, conflicts: Array<{teamId: string, role: string, source: "stage_override"|"base_role", keptRiderId: string, droppedRiderIds: string[]}>}}
 */
export function resolveStageEntrants(entrants = [], overridesForStage, { ineligibleRiderIds, orderEffortByRider = null } = {}) {
  const resolved = entrants.map((e) => resolveStageEntrant(e, overridesForStage, orderEffortByRider));
  const conflicts = [];

  // Indehavere pr. (hold, eksklusiv rolle) — som INDEKS i `resolved`, så vi kan
  // erstatte dem uden at lede efter dem igen.
  const holders = new Map();
  resolved.forEach((r, idx) => {
    if (!r.team_id || !r.race_role) return;
    if (ineligibleRiderIds?.has(r.rider_id)) return;
    if (!EXCLUSIVE_STAGE_ROLES.includes(r.race_role)) return;
    const key = `${r.team_id} ${r.race_role}`;
    if (!holders.has(key)) holders.set(key, []);
    holders.get(key).push(idx);
  });

  for (const [key, idxs] of holders) {
    if (idxs.length < 2) continue;
    const sep = key.indexOf(" ");
    const teamId = key.slice(0, sep);
    const role = key.slice(sep + 1);
    // Puljen der kan vinde: etape-overrides hvis der er nogen, ellers alle.
    const fromOverride = idxs.filter(
      (i) => overridesForStage?.get(resolved[i].rider_id)?.race_role === role
    );
    const pool = fromOverride.length ? fromOverride : idxs;
    const sorted = [...pool].sort((a, b) =>
      String(resolved[a].rider_id).localeCompare(String(resolved[b].rider_id))
    );
    const winner = sorted[0];
    if (pool.length > 1) {
      conflicts.push({
        teamId,
        role,
        source: fromOverride.length ? "stage_override" : "base_role",
        keptRiderId: resolved[winner].rider_id,
        droppedRiderIds: sorted.slice(1).map((i) => resolved[i].rider_id),
      });
    }
    for (const i of idxs) {
      if (i === winner) continue;
      resolved[i] = { ...resolved[i], race_role: DEMOTED_STAGE_ROLE };
    }
  }

  return { entrants: resolved, conflicts };
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

// #5580: de fem trin (#4632). Kun kendte værdier fra en ordre-række tæller;
// alt andet ignoreres, så stage-rækken (eller 'normal') er fallback — en værdi
// motoren ikke kender må aldrig blive til et indsatsvalg.
const EFFORT_LEVELS = new Set(["grupetto", "save", "normal", "protect", "all_out"]);

/**
 * #5580 (spec motor runde 2, M1 punkt 6): ordrens effort pr. rytter for ÉN
 * etape, fra race_team_orders-rækkerne (`loadTeamOrderRows`, samme rækker
 * løbsmotor v4 får). Ren, ingen DB. null når etapen ingen ordre-effort har, så
 * kald-stedet falder tilbage til stage-rækkerne præcis som før.
 *
 * @param {Array<{stage_number:number, riders?: Array<{rider_id:string, effort?:string}>}>} [teamOrderRows]
 * @param {number} stageNumber
 * @returns {Map<string,string>|null}
 */
export function orderEffortByRiderForStage(teamOrderRows, stageNumber) {
  if (!Array.isArray(teamOrderRows) || teamOrderRows.length === 0) return null;
  const out = new Map();
  for (const row of teamOrderRows) {
    if (Number(row?.stage_number) !== Number(stageNumber)) continue;
    for (const rider of Array.isArray(row.riders) ? row.riders : []) {
      if (rider?.rider_id == null || !EFFORT_LEVELS.has(rider.effort)) continue;
      out.set(String(rider.rider_id), rider.effort);
    }
  }
  return out.size ? out : null;
}

/**
 * #5580 (spec motor runde 2, M1 punkt 7, fund b 24/9): effort pr. rytter til
 * trætheden EFTER etapen, fra SAMME kilde som motoren kørte på: ordren vinder,
 * stage-rækken er fallback. null når ingen af de to har noget for etapen
 * (kald-stedet giver da multiplikator 1.0, som før).
 *
 * raceRunner bruger den kun når løbsmotor v4 kører; v3-stien bruger stadig
 * effortByRiderForStage (uændret for spillerne indtil ejeren vælger andet).
 *
 * @param {Map<number, Map<string, {race_role:string, effort:string}>>|undefined} stageRoleOverrides
 * @param {number} stageNumber
 * @param {Map<string,string>|null} orderEffortByRider  orderEffortByRiderForStage(...)
 * @returns {Map<string,string>|null}
 */
export function resolvedEffortByRiderForStage(stageRoleOverrides, stageNumber, orderEffortByRider) {
  const fromStageRoles = effortByRiderForStage(stageRoleOverrides, stageNumber);
  if (!orderEffortByRider?.size) return fromStageRoles;
  const out = new Map(fromStageRoles ?? []);
  for (const [riderId, effort] of orderEffortByRider) out.set(riderId, effort);
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
