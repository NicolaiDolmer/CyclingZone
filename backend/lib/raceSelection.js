// backend/lib/raceSelection.js
// #1307: manager-udtagelse — ren validering + DB-operationer (kaldes fra api.js).
// Fejl returneres som snake_case-koder (frontend oversætter; mønster fra training-ruterne).

import { selectionSizeForRace, suitabilityScore, stageSuitabilityScores } from "./raceAutopick.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { applyRiderEligibilityFilter, isRiderInjured } from "./riderEligibility.js";
import { assertLineupMutationAllowed } from "./raceActiveGuard.js";
import { isRiderDayInvariantViolation, teamInRacePool, findRiderBindingConflicts, windowsOverlap } from "./raceBinding.js";

export function validateSelection({
  riderIds = [], captainId = null, sprintCaptainId = null, hunterId = null, freeRoleIds = [],
  teamRiderIds, injuredRiderIds, sizeRule,
}) {
  const errors = [];
  // Fejlrækkefølge (errors[0] vises til brugeren): duplikat → størrelse → fremmed → skadet → kaptajn → roller.
  // (Overlap-binding håndhæves separat i PUT /selection-handleren og returnerer sin egen 409, ikke en errors[]-kode.)
  const unique = new Set(riderIds);
  if (unique.size !== riderIds.length) errors.push("selection_duplicate_rider");

  // Delvis trup TILLADT (ejer 28/6, afløser #1906): manageren gemmer sine egne picks frit;
  // er truppen ikke fuld ved race-tid, top-fylder raceEntryGenerator gabet automatisk fra
  // holdets ledige ryttere. Derfor afvises KUN for-mange (over feltstørrelsen) ved gem.
  if (riderIds.length > sizeRule.max) errors.push("selection_wrong_size");

  for (const id of riderIds) {
    if (!teamRiderIds.has(id)) { errors.push("selection_rider_not_on_team"); break; }
  }
  for (const id of riderIds) {
    if (injuredRiderIds.has(id)) { errors.push("selection_rider_injured"); break; }
  }

  // Kaptajn kræves kun når der ER manuelt udtagne ryttere (en tom trup = ren auto-udtagelse).
  // En tom trup må dog ikke bære en forældet kaptajn-reference uden for trupperne (input-hul).
  if (riderIds.length === 0) {
    if (captainId) errors.push("selection_captain_not_selected");
  } else {
    if (!captainId) errors.push("selection_captain_required");
    else if (!unique.has(captainId)) errors.push("selection_captain_not_selected");
  }

  for (const roleId of [sprintCaptainId, hunterId]) {
    if (roleId && !unique.has(roleId)) errors.push("selection_role_not_selected");
  }
  // free_role_ids (#2376): flere ryttere kan dele rollen (additiv udvidelse af den ellers
  // én-rytter-pr-rolle-kontrakt) — dedupliceres ved indgang så en dublet-id i inputtet aldrig
  // selv tæller som et overlap. Hver id skal være i den valgte trup, ligesom de øvrige roller.
  const freeRoleIdSet = new Set(freeRoleIds);
  for (const id of freeRoleIdSet) {
    if (!unique.has(id)) { errors.push("selection_role_not_selected"); break; }
  }
  const roleIds = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roleIds).size !== roleIds.length) errors.push("selection_role_overlap");
  // free_role må ikke overlappe captain/sprint_captain/hunter — én rolle pr. rytter.
  for (const id of freeRoleIdSet) {
    if (roleIds.includes(id)) { errors.push("selection_role_overlap"); break; }
  }

  return { ok: errors.length === 0, errors };
}

// #1146: eksporteret så bulk-endpointets rpcChanges-bygger (api.js) kan genbruge PRÆCIS
// samme rolle-mapping som saveSelection nedenfor — ingen anden kopi af denne switch.
export function roleFor(riderId, { captainId, sprintCaptainId, hunterId, freeRoleIdSet }) {
  if (riderId === captainId) return "captain";
  if (riderId === sprintCaptainId) return "sprint_captain";
  if (riderId === hunterId) return "hunter";
  if (freeRoleIdSet?.has(riderId)) return "free_role";
  return "helper";
}

// Gem udtagelsen atomisk: erstat holdets entries for løbet i ÉN transaktion via
// replace_race_selection-RPC'en (#2173). Enten gemmes hele truppen, eller intet
// ændres — ingen delete-uden-insert-degradering, ingen delvist gemt trup.
export async function saveSelection({ supabase, race, teamId, riderIds, captainId, sprintCaptainId = null, hunterId = null, freeRoleIds = [], removalOnly = false }) {
  // Forward-guard (#2074): nægt delete-then-insert hvis løbets felt er LÅST
  // (stages_completed>0). Rute-laget gater allerede, men guarden gør invarianten lokal
  // til mutationen så en fremtidig kalder ikke kan nulstille et aktivt startfelt.
  // #2637: `removalOnly` (rute-laget har allerede verificeret at riderIds er en ægte
  // delmængde af den gemte trup — ingen tilføjelser) lader en skadet rytter fjernes
  // selv midt i et aktivt etapeløb; se assertLineupMutationAllowed.
  await assertLineupMutationAllowed({ supabase, raceId: race?.id, race, label: "saveSelection", allowRemovalOnly: removalOnly });
  // #2173: atomisk erstat via RPC. Tidligere var det en delete-then-insert UDEN
  // transaktion ("accepteret degradering") — fejlede insert efter delete, stod
  // løbet med 0 entries (tavst tab). replace_race_selection kører delete+insert i
  // ÉN transaktion under advisory-lås på holdet, så et gem enten lykkes fuldt
  // eller ruller helt tilbage (og en samtidig PUT til samme hold serialiseres).
  // #2376: free_role_ids flyder igennem som almindelige race_role-værdier — RPC'en tager
  // parallelle rider_id/role-arrays uden at kende roller specifikt, så ingen RPC-ændring.
  const freeRoleIdSet = new Set(freeRoleIds);
  const rows = riderIds.map((rider_id) => ({
    race_id: race.id, rider_id, team_id: teamId,
    race_role: roleFor(rider_id, { captainId, sprintCaptainId, hunterId, freeRoleIdSet }),
    is_auto_filled: false,
  }));
  const { error: rpcErr } = await supabase.rpc("replace_race_selection", {
    p_team_id: teamId,
    p_race_id: race.id,
    p_rider_ids: riderIds,
    p_roles: rows.map((r) => r.race_role),
  });
  if (rpcErr) {
    // #2256: RPC'ens binding-guard (overlap-tjek UNDER advisory-låsen) afviser med
    // 'selection_rider_bound'. Markér fejlen med en kode så ruten kan svare 409 med
    // den eksisterende i18n-nøgle i stedet for en opak 500 (TOCTOU-taberen skal se
    // samme besked som pre-flight-tjekket giver).
    const err = new Error(`replace_race_selection: ${rpcErr.message}`);
    // #4283: RPC'ens egen guard matcher kun dette løbs FAKTISKE etape-dage — en konflikt
    // der alene rammer en hvile-/pausedag i #4217-spændet slipper forbi guarden og fanges
    // først af no_rider_double_booking_day-constrainten (rå 23505, ingen
    // 'selection_rider_bound' i beskeden). Klassificér den ens, så TOCTOU-taberen får den
    // navngivne 409 i stedet for en opak 500.
    if (String(rpcErr.message || "").includes("selection_rider_bound") || isRiderDayInvariantViolation(rpcErr)) {
      err.code = "selection_rider_bound";
    }
    throw err;
  }
  return rows;
}

// #1146: fælles pr.-løb-validering — udtrukket af PUT /:raceId/selection (api.js) så
// bulk-endpointet (PUT /races/selection/bulk) kan genbruge PRÆCIS samme regler i stedet
// for at kopiere/divergere dem. Rører IKKE binding-konflikt-tjekket (loadTeamBindingContext
// m.fl.) — det kræver kendskab til de ANDRE løb i et bulk-kald (peer-konflikter) og bliver
// derfor liggende i kalder-laget (api.js), for begge endpoints.
//
// Returnerer { ok:false, status, error, errors? } ved afvisning (samme fejlkoder/rækkefølge
// som den oprindelige inline-blok), ellers { ok:true, riderIds, captainId, sprintCaptainId,
// hunterId, freeRoleIds, isRemovalOnly, ctx }.
export async function prepareSelectionChange({ supabase, race, teamId, teamDivisionId, body }) {
  if (race.status !== "scheduled") return { ok: false, status: 409, error: "selection_race_not_open" };

  // Race-hub pulje-binding: et hold må kun udtage til løb i sin egen pulje (se #1146-
  // kommentaren i api.js for den fulde begrundelse — uændret her).
  if (!teamInRacePool({ teamDivisionId, racePoolId: race.league_division_id })) {
    return { ok: false, status: 409, error: "selection_wrong_pool" };
  }

  const { rider_ids: riderIdsBody = [], captain_id: captainId = null, sprint_captain_id: sprintCaptainId = null, hunter_id: hunterId = null, free_role_ids: freeRoleIds = [] } = body || {};
  if (!Array.isArray(riderIdsBody) || !Array.isArray(freeRoleIds)) {
    return { ok: false, status: 400, error: "selection_invalid_body" };
  }
  const riderIds = riderIdsBody;

  const ctx = await getSelectionContext({ supabase, race, teamId });

  // Frys (#1825), undtagen ren fjernelse (#2637) — se den fulde begrundelse i api.js.
  const currentRiderIds = new Set(ctx.selection?.rider_ids || []);
  const isRemovalOnly = riderIds.length < currentRiderIds.size && riderIds.every((id) => currentRiderIds.has(id));
  if ((race.stages_completed ?? 0) > 0 && !isRemovalOnly) {
    return { ok: false, status: 409, error: "selection_race_started" };
  }

  const result = validateSelection({
    riderIds, captainId, sprintCaptainId, hunterId, freeRoleIds,
    teamRiderIds: new Set(ctx.riders.map((r) => r.id)),
    injuredRiderIds: new Set(ctx.riders.filter((r) => r.injured).map((r) => r.id)),
    sizeRule: ctx.size,
    availableCount: ctx.availableCount,
  });
  if (!result.ok) return { ok: false, status: 400, error: result.errors[0], errors: result.errors };

  return { ok: true, riderIds, captainId, sprintCaptainId, hunterId, freeRoleIds, isRemovalOnly, ctx };
}

// #1146/#4310-refutation: binding-konflikt-klassifikationen for EN HEL bulk-batch — ren
// funktion (ingen DB), udtrukket af PUT /races/selection/bulk (api.js) hvor den lå inline
// i route-handleren og derfor kun var dækket af kildetekst-regex (FUND 3: nul reel
// adfærdsdækning af selve "en swap er rækkefølge-uafhængig"-garantien). Dette er PRÆCIS
// den logik der gør en peer-swap (to celler i samme batch bytter en rytter) lovlig og
// en ægte peer-kollision (samme rytter ønsket i to overlappende løb i samme batch)
// ulovlig — se raceSelection.test.js for testene der beviser rækkefølge-uafhængigheden.
//
// `changes`: [{ raceId, riderIds, window }] — window er raceBindingWindow-resultatet for
// løbet (samme form som findRiderBindingConflicts/windowsOverlap forventer).
// `otherRacesByRace`: Map<raceId, DB-otherRaces MED batch-fæller udelukket> (fra
// loadTeamBindingContext i api.js, uændret af denne udtrækning).
//
// Returnerer ÉT resultat pr. race i `changes` (samme rækkefølge som input), af typen:
//   { race_id, kind: "peer_conflict", conflicts: [{rider_id, race_id, conflict_race_id}] }
//   { race_id, kind: "db_conflict", boundRiderIds: [uuid,...] }  — kalderen slår selv op
//     om disse er resolvable (#2637 auto-release) eller blocking via
//     resolveBindingConflictDetails (DB-kald, forbliver i api.js — ikke rent).
//   { race_id, kind: "clear" }
//
// Rækkefølge-uafhængighed: peerRaces bygges ÉN gang for HELE `changes`-arrayet før nogen
// klassificering sker, og hvert races eget peer-tjek udelukker kun SIG SELV (peerOthers) —
// aldrig baseret på hvor i arrayet det andet race optræder. Resultatet for et givet race
// afhænger dermed kun af MÆNGDEN af (raceId, window, riderIds)-tripler i `changes`, ikke
// af deres rækkefølge.
export function classifyBulkSelectionConflicts({ changes, otherRacesByRace }) {
  const peerRaces = changes.map((c) => ({ raceId: c.raceId, window: c.window, riderIds: c.riderIds }));

  return changes.map((change) => {
    const { raceId, riderIds, window: thisWindow } = change;

    // Peer (mod en ANDEN ændring i SAMME batch): altid blokerende — en ægte kollision
    // mellem to samtidige manuelle ønsker kan ikke auto-løses (ingen af de to har
    // forrang), i modsætning til en LOVLIG swap (den fjernede rytter optræder simpelthen
    // ikke i den anden celles NYE riderIds og udløser derfor ingen konflikt her).
    const peerOthers = peerRaces.filter((p) => p.raceId !== raceId);
    const peerBound = findRiderBindingConflicts({ riderIds, thisWindow, otherRaces: peerOthers });
    if (peerBound.length) {
      const conflicts = peerBound.map((riderId) => {
        const other = peerOthers.find(
          (p) => windowsOverlap(thisWindow, p.window) && (p.riderIds || []).includes(riderId)
        );
        return { rider_id: riderId, race_id: raceId, conflict_race_id: other?.raceId ?? null };
      });
      return { race_id: raceId, kind: "peer_conflict", conflicts };
    }

    // DB (mod et løb UDENFOR denne batch): klassificeres akkurat som single-endpointet
    // (#2637) — auto-udtaget+ikke-startet løb frigives automatisk, alt andet afvises
    // navngivet. Selve resolvable/blocking-opdelingen kræver et DB-opslag
    // (resolveBindingConflictDetails) og forbliver derfor i kalderen (api.js).
    const dbOthers = otherRacesByRace.get(raceId) || [];
    const dbBound = findRiderBindingConflicts({ riderIds, thisWindow, otherRaces: dbOthers });
    if (dbBound.length) {
      return { race_id: raceId, kind: "db_conflict", boundRiderIds: dbBound };
    }

    return { race_id: raceId, kind: "clear" };
  });
}

// #1146: atomisk bulk-gem via replace_race_selection_bulk-RPC'en (database/2026-08-27-
// 1146-selection-bulk-rpc.sql). ÉN transaktion, advisory-lås pr. hold, dobbeltbooking-
// checket UDSKUDT til batchens afslutning (samme mønster som apply_race_entry_unit_batch,
// #3934) — en lovlig swap mellem to `changes`-løb er rækkefølge-uafhængig, i modsætning til
// at kalde saveSelection (replace_race_selection) N gange i separate kald.
//
// `changes`: [{ race_id, rider_ids, roles }] — pr.-løb-payloaden api.js allerede har bygget
// via prepareSelectionChange + roleFor. `autoReleases`: [{ race_id, rider_id }] — #2637-
// frigivelser i løb UDENFOR denne batch (klassificeret af api.js via
// resolveBindingConflictDetails), udført i SAMME transaktion som selve erstatningen.
export async function saveSelectionBulk({ supabase, teamId, changes, autoReleases = [] }) {
  const { error: rpcErr } = await supabase.rpc("replace_race_selection_bulk", {
    p_team_id: teamId,
    p_changes: changes,
    p_auto_releases: autoReleases,
  });
  if (rpcErr) {
    // #2256/#4283-mønsteret: RPC'ens deferred binding-backstop tabte kapløbet for os (en
    // SAMTIDIG skriver fra en anden session) — samme klassifikation som saveSelection.
    const err = new Error(`replace_race_selection_bulk: ${rpcErr.message}`);
    const msg = String(rpcErr.message || "");
    if (msg.includes("selection_rider_bound") || isRiderDayInvariantViolation(rpcErr)) {
      err.code = "selection_rider_bound";
    } else if (msg.includes("selection_race_started")) {
      // #2074/#4310: RPC'ens egen SQL-niveau forward-guard (database/2026-08-27-1146-
      // selection-bulk-rpc.sql) tabte et TOCTOU-kapløb mod løbets stages_completed/status
      // — løbet blev frosset/afsluttet MELLEM app-lagets prepareSelectionChange-læsning og
      // denne transaktions commit. Samme fejlkode som prepareSelectionChange returnerer
      // for den almindelige (ikke-TOCTOU) sti, så klienten ser én kontrakt uanset hvilken
      // af de to steder der fangede det.
      err.code = "selection_race_started";
    } else if (msg.includes("selection_race_not_open")) {
      // Samme kontrakt-argument som grenen ovenfor, for RPC'ens ANDEN forward-guard-regel
      // (status <> 'scheduled', rpc.sql:186). Koden manglede her, saa et loeb der blev
      // FINALISERET i TOCTOU-vinduet gav err.code = undefined -> api.js's catch faldt
      // igennem til captureException + 500, i stedet for den 409 de tre oevrige call-sites
      // (api.js:5011, api.js:5329, raceSelection.js:132) allerede svarer for praecis den
      // tilstand. Spilleren fik en generisk serverfejl + en stoej-alarm i Sentry for noget
      // der er en normal, forklarlig afvisning.
      err.code = "selection_race_not_open";
    }
    throw err;
  }
}

// Ren mapping af evner+kondition+profiler → riderRows (testbar uden DB).
// suitability = løb-snit (0-100); stageSuitability = per-etape (0-100) til S4 rute-match.
// Ingen evner → begge null (graceful degrade på klienten).
export function buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr }) {
  return riders.map((r) => {
    const cond = conditionByRider.get(r.id);
    const ab = abilityByRider.get(r.id);
    const hasFit = ab && stages.length;
    return {
      id: r.id,
      name: [r.firstname, r.lastname].filter(Boolean).join(" "),
      // #1747: ryttertype (top-2) til visning i udtagelses-panelet. null = endnu ikke beregnet.
      primaryType: r.primary_type ?? null,
      secondaryType: r.secondary_type ?? null,
      suitability: hasFit ? Math.round(suitabilityScore(ab, stages) * 100) : null,
      stageSuitability: hasFit ? stageSuitabilityScores(ab, stages) : null,
      // S5: aggression (0-99) — driver udbruds-CHANCEN i motoren (raceSimulator.aggressionScore).
      // Surfaces så HunterExplainer kan rangere jæger-kandidater. null = endnu ikke beregnet.
      aggression: ab?.aggression ?? null,
      // #3115 Gap 1b (ejer-forslag 3/8): tactics (0-99) — vægtes i visse etapers
      // DEMAND_VECTORS (raceStageProfileGenerator.js: rolling/mountain/high_mountain/
      // classic/ttt) og er dermed en del af rute-match-scoren for de profiler. Surfaces
      // rå her (samme mønster som aggression ovenfor); frontend BÅNDER altid værdien
      // (selectionDrivers.js tacticsFitBand) før visning — fog-gate, aldrig rå tal i UI.
      tactics: ab?.tactics ?? null,
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
      // #3896: kanonisk skades-predikat (riderEligibility.isRiderInjured) — ensrettet
      // mod udtagelses-endpointet og race-motoren, så holdside/udtagelse/motor viser
      // og håndhæver PRÆCIS samme skadesstatus.
      injured: isRiderInjured(cond?.injured_until ?? null, todayStr),
      // #3809: alle 15 rå evne-værdier — driver holdudtagelsens "Evner"-visning
      // (toggle mellem nuværende kolonner og attributter, samme rå tal som
      // Mit Hold's evne-tilstand, #2906). Egne ryttere → ingen fog-of-war på
      // disse tal (fog gælder kun scouting af ANDRES ryttere/potentiale).
      // Nested objekt (ikke fladt spredt på rækken) så feltet er selvforklarende
      // og ikke kan forveksles med aggression/tactics-felterne ovenfor.
      abilities: ab ? Object.fromEntries(ABILITY_KEYS.map((k) => [k, ab[k] ?? null])) : null,
    };
  });
}

// Kontekst til GET-endpointet: holdets ryttere (raske/skadede markeret, suitability
// pr. løbets profiler), nuværende udtagelse, størrelses-regel.
// Holdet har maks ~30 ryttere, så plain .in() er tilstrækkeligt her
// (ingen chunking nødvendig — i modsætning til raceRunner's full-field-opslag).
export async function getSelectionContext({ supabase, race, teamId }) {
  const [ridersRes, profilesRes, entriesRes] = await Promise.all([
    // #1307/#1308: akademiryttere er ikke løbs-berettigede. Rod B: delt eligibility-filter.
    // #1747: ryttertype (primary/secondary) med så fronten kan vise typen ved udtagelsen.
    applyRiderEligibilityFilter(
      supabase.from("riders").select("id, firstname, lastname, primary_type, secondary_type").eq("team_id", teamId)
    ),
    supabase.from("race_stage_profiles").select("stage_number, profile_type, demand_vector")
      .eq("race_id", race.id).order("stage_number", { ascending: true }),
    supabase.from("race_entries").select("rider_id, race_role, is_auto_filled")
      .eq("race_id", race.id).eq("team_id", teamId),
  ]);
  for (const [name, res] of [["riders", ridersRes], ["race_stage_profiles", profilesRes], ["race_entries", entriesRes]]) {
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
  }
  const riders = ridersRes.data || [];
  const stages = profilesRes.data || [];
  const riderIds = riders.map((r) => r.id);

  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const [abilitiesRes, conditionRes] = await Promise.all([
    supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", riderIds),
    supabase.from("rider_condition").select("rider_id, form, fatigue, injured_until").in("rider_id", riderIds),
  ]);
  const abilityByRider = new Map((abilitiesRes.data || []).map((a) => [a.rider_id, a]));
  const conditionByRider = new Map((conditionRes.data || []).map((c) => [c.rider_id, c]));
  const todayStr = copenhagenDateString();

  const riderRows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr });

  // Rod B (#1800/#1742): kryds committede entries mod den gyldige roster. En ghost
  // (rytter udtaget FØR han blev solgt/fyret/akademi/pensioneret) er ikke i `riders`
  // (eligibility-filtreret ovenfor) og må hverken vises eller tælle med — ellers
  // renderer den blank i kolonnen (intet ×), tæller i 6/6, og låser redigeringen.
  const eligibleIds = new Set(riderRows.map((r) => r.id));
  const entries = (entriesRes.data || []).filter((e) => eligibleIds.has(e.rider_id));
  const selection = entries.length
    ? {
        rider_ids: entries.map((e) => e.rider_id),
        captain_id: entries.find((e) => e.race_role === "captain")?.rider_id ?? null,
        sprint_captain_id: entries.find((e) => e.race_role === "sprint_captain")?.rider_id ?? null,
        hunter_id: entries.find((e) => e.race_role === "hunter")?.rider_id ?? null,
        // #2376: free_role kan gælde FLERE ryttere → array (additiv, ikke ét *_id-felt).
        free_role_ids: entries.filter((e) => e.race_role === "free_role").map((e) => e.rider_id),
        is_auto_filled: entries.every((e) => e.is_auto_filled),
        // #3041: kun de MANUELT udtagne af rider_ids — bruges til at bygge binding-map'et,
        // så et auto-udtaget pick (der viger automatisk ved gem, #2637) heller ikke låser
        // rytteren i UI'et for et andet overlappende løb. rider_ids ovenfor forbliver ALT
        // (auto+manuelt) — den bruges til "allerede i denne kolonne"-tjek, som skal se begge.
        manual_rider_ids: entries.filter((e) => !e.is_auto_filled).map((e) => e.rider_id),
      }
    : null;

  return {
    size: selectionSizeForRace(race),
    riders: riderRows,
    selection,
    availableCount: riderRows.filter((r) => !r.injured).length,
  };
}
