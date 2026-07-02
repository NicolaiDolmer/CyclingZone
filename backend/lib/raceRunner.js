// Race Engine light-motor (#1102), slice 2 — raceRunner: broen mellem den rene
// single-stage simulator (raceSimulator.js) og den UÆNDREDE resultat-pipeline
// (raceResultsEngine.applyRaceResults).
//
// Ansvar:
//   1. Hent etape-profiler (race_stage_profiles) + startfelt (race_entries, med
//      per-hold autopick for hold UDEN entries — F1=B-strategi udvidet i #1307;
//      hold med manager-udtagne entries røres ikke).
//   2. Simulér hver etape (seed = stableSeed(`${race.id}:${stage}`)).
//   3. Aggregér på tværs af etaper: GC efter kumulativ tid (F3=B), + point/bjerg/
//      ungdom/hold-klassementer. Emission (superset af pcmResultsImport.js — #2081
//      udvidede mellem-etaperne fra rank-1-trøjeholdere til FULDE klassementer;
//      rank 2+ har ingen race_points-rækker → points_earned 0, payout uændret):
//        single        → gc + team
//        mellem-etape  → stage + fulde leader/points_day/mountain_day/young_day
//        slut-etape    → stage + fulde gc/points/mountain/young + team
//      #2072: stage-by-stage-stien (simulateStageByIndex) simulerer KUN dagens
//      etape og AKKUMULERER klassementerne fra de persisterede race_results-
//      etaperækker (buildStageRowsAccumulated) — kørte etaper re-simuleres ALDRIG,
//      så slut-GC kan ikke modsige de publicerede etape-gaps (Vuelta Burgalesa).
//   4. Idempotent delete-then-insert pr. (race_id, stage_number) → applyRaceResults
//      (UÆNDRET) → standings/prize. + recomputeSeasonRaceDays + status=completed
//      + import_log (paritet med PCM-stien, undgår #804-regression).
//   5. persistRun → race_simulation_runs (F4=C: seed + entrant-snapshot pr. run;
//      per-rytter dekomponering returneres in-memory, ikke persisteret).
//
// points_earned/prize_money UDLEDES af (result_type, rank) via den delte
// buildRacePointsLookup — motoren opfinder ALDRIG point. finish_time er display-
// only (gc-RANK driver points); standings/schema er uændret.

import {
  applyRaceResults as applyRaceResultsShared,
  buildRacePointsLookup,
  PRIZE_PER_POINT,
} from "./raceResultsEngine.js";
import { recomputeSeasonRaceDays } from "./seasonRaceDays.js";
import { processBoardWeekendFinalization as processBoardWeekendFinalizationShared } from "./boardWeekendFinalization.js";
import { simulateStage, stableSeed, ENGINE_VERSION, ABILITY_KEYS, deriveBreakawayStatus } from "./raceSimulator.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { applyRaceFatigue, stageEnteringFatigues } from "./raceFatigue.js";
import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";
import { applyStageResultAtomic } from "./stageResultRpc.js";
import { POOL_TARGET_SIZE } from "./economyConstants.js";
import { loadWithdrawnTeamIds } from "./raceWithdrawal.js";
import { raceBindingWindow } from "./raceBinding.js";
import { freezeEntrantsToStartField, excludeBoundRiders, filterEntriesToRaceDivision } from "./raceFieldIntegrity.js";
import { applyRiderEligibilityFilter, filterEligibleEntries } from "./riderEligibility.js";
import { loadEligibleEntries, loadLoanedOutRiderIds } from "./raceEntriesLoader.js";
// #2072: klassements-kernen (ranking, tie-breaks, gap-parsing, akkumulering) er
// udtrukket til raceClassifications.js så helt-løb-stien og stage-by-stage-
// akkumuleringsstien deler PRÆCIS samme semantik.
import {
  classPointsForRank,
  CLIMB_PROFILES,
  formatGap,
  rankByCumTimeAsc,
  rankByCompDesc,
  teamClassification,
  accumulateStageRows,
  filterCompletedEntrants,
} from "./raceClassifications.js";

// Fælles race_results-række-byggere — definerer rækkens form ét sted (deles af
// buildRaceResults og buildStageRowsAccumulated). points_earned/prize_money
// udledes ALTID af (result_type, rank) via pointsLookup — motoren opfinder aldrig point.
// #1499: in_breakaway/breakaway_caught er DESKRIPTIVE udbruds-etiketter (ren read
// af motorens egne tal — påvirker IKKE rang/point/finish_time). Default false, så
// alle ikke-etape-rækker (gc/points/trøjer/team) bærer dem som false.
function makeResultRowPushers({ race, byId, teamNameByTeam, pointsLookup, resultRows }) {
  const pushIndiv = ({ result_type, rank, rider_id, stage_number, finish_time = null, in_breakaway = false, breakaway_caught = false }) => {
    const e = byId.get(rider_id);
    const pts = pointsLookup[`${result_type}__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number,
      result_type,
      rank,
      rider_id,
      rider_name: e?.rider_name ?? null,
      team_id: e?.team_id ?? null,
      team_name: e?.team_name ?? null,
      finish_time,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      in_breakaway,
      breakaway_caught,
    });
  };
  const pushTeam = ({ rank, team_id, stage_number }) => {
    const pts = pointsLookup[`team__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number,
      result_type: "team",
      rank,
      rider_id: null,
      rider_name: null,
      team_id,
      team_name: teamNameByTeam.get(team_id) ?? null,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      in_breakaway: false,
      breakaway_caught: false,
    });
  };
  return { pushIndiv, pushTeam };
}

/**
 * REN kerne: simulér et helt løb og byg race_results-kompatible rækker + run-metadata.
 * Ingen DB. Determinisk givet (race.id, stages, entrants).
 *
 * @param {{race, stages, entrants, pointsLookup}} args
 *   race: { id, race_type }  (race_type 'stage_race' ellers behandlet som endagsløb)
 *   stages: [{ stage_number, profile_type, demand_vector }]  (usorteret ok)
 *   entrants: [{ rider_id, team_id, rider_name?, is_u25?, abilities:{...10}, form?, fatigue?, race_role? }]
 *   pointsLookup: fra buildRacePointsLookup (result_type__rank → point)
 * @returns {{ resultRows, runs }}
 */
export function buildRaceResults({ race, stages = [], entrants = [], pointsLookup = {} }) {
  if (!race?.id) throw new Error("race.id required");
  if (!stages.length) throw new Error("no stage profiles");
  if (!entrants.length) throw new Error("no entrants");

  const isStageRace = race.race_type === "stage_race";
  const stagesSorted = [...stages].sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));

  const cumTime = new Map();
  const posSum = new Map();   // sum af etapeplaceringer → GC-countback-tiebreaker
  const pointsComp = new Map();
  const komComp = new Map();
  const byId = new Map();
  // #1993: holdnavn-snapshot pr. team_id (fra de berigede entrants). Bruges til hold-
  // rækker (pushTeam), der ikke har en enkelt entrant at læse navnet fra.
  const teamNameByTeam = new Map();
  for (const e of entrants) {
    cumTime.set(e.rider_id, 0);
    posSum.set(e.rider_id, 0);
    pointsComp.set(e.rider_id, 0);
    komComp.set(e.rider_id, 0);
    byId.set(e.rider_id, e);
    if (e?.team_id != null && e?.team_name != null && !teamNameByTeam.has(e.team_id)) {
      teamNameByTeam.set(e.team_id, e.team_name);
    }
  }
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  const resultRows = [];
  const runs = [];

  const { pushIndiv, pushTeam } = makeResultRowPushers({ race, byId, teamNameByTeam, pointsLookup, resultRows });

  // #1306-fix + #1307: form/fatigue/race_role SKAL med ind i simulatoren — det er
  // præcis condition-berigelsen og rollerne der adskiller prod-stien fra rå abilities.
  // #1021-hybrid (ejer-valgt 2026-06-17): træthed AKKUMULERER mellem etaper — en
  // 21-etapers tour bliver en udmattelseskamp. Hver rytters start-træthed
  // (rider_condition.fatigue, eller 0) + summen af tidligere etapers belastning.
  // Fylder seamen raceSimulator.js:74 beskriver, uden at røre simulateStage-kontrakten.
  const stageProfiles = stagesSorted.map((s) => s.profile_type);
  const fatigueSeqById = new Map(
    entrants.map((e) => [e.rider_id, stageEnteringFatigues(e.fatigue, stageProfiles)])
  );

  const simEntrants = entrants.map((e) => ({
    rider_id: e.rider_id,
    team_id: e.team_id,
    abilities: e.abilities,
    ...(e.form != null ? { form: e.form } : {}),
    // fatigue sættes per etape i loopet (akkumulerende); start = etape 0's entering.
    fatigue: fatigueSeqById.get(e.rider_id)[0],
    ...(e.race_role ? { race_role: e.race_role } : {}),
  }));

  for (let i = 0; i < stagesSorted.length; i++) {
    const stage = stagesSorted[i];
    // Akkumuleret træthed gående ind til DENNE etape (idx i).
    for (const se of simEntrants) se.fatigue = fatigueSeqById.get(se.rider_id)[i];
    const stageNumber = stage.stage_number || 1;
    const isFinal = i === stagesSorted.length - 1;
    const seed = stableSeed(`${race.id}:${stageNumber}`);
    const { ranked } = simulateStage({ entrants: simEntrants, stageProfile: stage, seed });
    // #1499: deskriptive udbruds-etiketter for denne etapes finish-order (ren read).
    const breakawayStatus = deriveBreakawayStatus(ranked);
    const bwOf = (riderId) => breakawayStatus.get(riderId) || { in_breakaway: false, breakaway_caught: false };

    runs.push({
      stage_number: stageNumber,
      seed,
      engine_version: ENGINE_VERSION,
      entrant_snapshot: simEntrants.map((e) => e.rider_id).sort(),
      input_checksum: stableSeed(JSON.stringify({
        ids: simEntrants.map((e) => e.rider_id).sort(),
        roles: simEntrants.filter((e) => e.race_role).map((e) => [e.rider_id, e.race_role]).sort(),
        demand: stage.demand_vector,
        profile: stage.profile_type,
      })),
    });

    for (const r of ranked) {
      add(cumTime, r.rider_id, r.stageGap);
      add(posSum, r.rider_id, r.rank);
      add(pointsComp, r.rider_id, classPointsForRank(r.rank));
      if (CLIMB_PROFILES.has(stage.profile_type)) add(komComp, r.rider_id, classPointsForRank(r.rank));
    }

    const gc = rankByCumTimeAsc(entrants, cumTime, posSum);
    const leaderTime = gc.length ? gc[0].time : 0;
    const gcFinish = (entry) => formatGap(entry.time - leaderTime);

    if (!isStageRace) {
      // ENDAGSLØB: gc(all) + team. Ingen 'stage' (= dobbelttælling, jf. PCM).
      // gc-finish-order = denne ene etapes finish-order → udbruds-etiketten gælder direkte.
      for (const g of gc) pushIndiv({ result_type: "gc", rank: g.rank, rider_id: g.rider_id, stage_number: 1, finish_time: gcFinish(g), ...bwOf(g.rider_id) });
      for (const t of teamClassification(entrants, cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: 1 });
      break;
    }

    // ETAPELØB: stage-resultater hver etape.
    for (const r of ranked) {
      pushIndiv({ result_type: "stage", rank: r.rank, rider_id: r.rider_id, stage_number: stageNumber, finish_time: formatGap(r.stageGap), ...bwOf(r.rider_id) });
    }

    if (!isFinal) {
      // Mellem-etape (#2081): FULDE løbende klassementer under dag-typerne — rank 1
      // beholder "holder trøjen"-pointet (race_points har KUN rank 1 for dag-typerne);
      // rank 2+ har intet opslag → points_earned 0, også under rederiveSeasonRacePoints.
      // leader-rækker bærer GC-gap (display af løbende samlet stilling).
      const young = rankByCumTimeAsc(entrants.filter((e) => e.is_u25), cumTime, posSum);
      const pointsCls = rankByCompDesc(entrants, pointsComp);
      const komCls = rankByCompDesc(entrants, komComp);
      for (const g of gc) pushIndiv({ result_type: "leader", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
      for (const p of pointsCls) pushIndiv({ result_type: "points_day", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
      for (const k of komCls) pushIndiv({ result_type: "mountain_day", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
      for (const y of young) pushIndiv({ result_type: "young_day", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
    } else {
      // Slut-etape: hele klassementet udbetales.
      const young = rankByCumTimeAsc(entrants.filter((e) => e.is_u25), cumTime, posSum);
      const pointsCls = rankByCompDesc(entrants, pointsComp);
      const komCls = rankByCompDesc(entrants, komComp);
      for (const g of gc) pushIndiv({ result_type: "gc", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
      for (const p of pointsCls) pushIndiv({ result_type: "points", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
      for (const k of komCls) pushIndiv({ result_type: "mountain", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
      for (const y of young) pushIndiv({ result_type: "young", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
      for (const t of teamClassification(entrants, cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber });
    }
  }

  // Træthed ved start af sidste etape pr. rytter (peak de reelt kørte på) — in-memory
  // observability + simulér-før-ship-verifikation. Persisteres ikke (intet DB-skema rørt).
  const lastIdx = stagesSorted.length - 1;
  const finalFatigue = Object.fromEntries(
    entrants.map((e) => [e.rider_id, fatigueSeqById.get(e.rider_id)[lastIdx]])
  );

  return { resultRows, runs, finalFatigue };
}

// ── I/O: indlæsning ───────────────────────────────────────────────────────────

// PostgREST .in() encoder id-listen i URL'en — ved relaunch-skala (600-800 UUID'er)
// rammer det 414/proxy-grænser. Batch derfor alle id-opslag i bidder. (#1307-review)
const IN_CHUNK_SIZE = 200;
async function selectInChunks({ supabase, table, columns, inColumn, ids, extra = null }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    let q = supabase.from(table).select(columns).in(inColumn, ids.slice(i, i + IN_CHUNK_SIZE));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

async function loadStageProfiles(supabase, raceId) {
  const { data, error } = await supabase
    .from("race_stage_profiles")
    .select("stage_number, profile_type, finale_type, demand_vector")
    .eq("race_id", raceId)
    .order("stage_number", { ascending: true });
  if (error) throw new Error(`race_stage_profiles: ${error.message}`);
  return data || [];
}

// Range-pagineret fetch (PostgREST default-cap = 1000 rækker → tavs trunkering; #1839).
const PAGE_SIZE = 1000;
async function fetchAllPaged(query) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}

// #1845: binding-kontekst for runtime auto-fill — dette løbs CET-dag-vindue + hvert holds
// ryttere udtaget i ANDRE løb (med deres vinduer), så excludeBoundRiders kan udelukke en
// rytter der allerede er bundet i et tidsoverlappende løb (inkl. igangværende). Tynd I/O.
async function loadFieldBindingContext({ supabase, race, teamIds }) {
  const empty = { thisWindow: null, otherRacesByTeam: new Map() };
  if (!teamIds?.length) return empty;

  const { data: thisSched, error: e0 } = await supabase
    .from("race_stage_schedule").select("scheduled_at").eq("race_id", race.id);
  if (e0) throw new Error(`race_stage_schedule (binding this): ${e0.message}`);
  const thisWindow = raceBindingWindow(thisSched);
  if (!thisWindow) return empty; // dette løb har intet vindue → kan ikke binde

  // Holdenes entries i ANDRE løb (range-pagineret mod 1000-cap'en). #1906: gennem den
  // delte eligibility-loader, så en ghost/udlånt rytter ikke phantom-låser en ægte
  // rytter væk fra det aktuelle løbs felt under runtime auto-fill (excludeBoundRiders).
  const { data: entries, error: e1 } = await loadEligibleEntries({
    supabase, paged: true,
    baseQuery: () =>
      supabase.from("race_entries").select("race_id, team_id, rider_id").in("team_id", teamIds).neq("race_id", race.id),
  });
  if (e1) throw new Error(`race_entries (binding others): ${e1.message}`);
  if (!entries.length) return { thisWindow, otherRacesByTeam: new Map() };

  const otherRaceIds = [...new Set(entries.map((e) => e.race_id))];
  const scheds = [];
  for (let i = 0; i < otherRaceIds.length; i += 200) {
    const chunk = otherRaceIds.slice(i, i + 200);
    const { data, error } = await fetchAllPaged(() =>
      supabase.from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", chunk)
    );
    if (error) throw new Error(`race_stage_schedule (binding others): ${error.message}`);
    scheds.push(...data);
  }
  const schedByRace = new Map();
  for (const s of scheds) {
    if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
    schedByRace.get(s.race_id).push(s);
  }
  const windowByRace = new Map();
  for (const rid of otherRaceIds) windowByRace.set(rid, raceBindingWindow(schedByRace.get(rid)));

  const byTeamRace = new Map(); // teamId → Map(raceId → [rider_id])
  for (const e of entries) {
    if (!byTeamRace.has(e.team_id)) byTeamRace.set(e.team_id, new Map());
    const m = byTeamRace.get(e.team_id);
    if (!m.has(e.race_id)) m.set(e.race_id, []);
    m.get(e.race_id).push(e.rider_id);
  }
  const otherRacesByTeam = new Map();
  for (const [teamId, raceMap] of byTeamRace) {
    const arr = [];
    for (const [rid, riderIds] of raceMap) {
      const w = windowByRace.get(rid);
      if (w) arr.push({ window: w, riderIds });
    }
    otherRacesByTeam.set(teamId, arr);
  }
  return { thisWindow, otherRacesByTeam };
}

// #1844: rider_ids fra et løbs FØRSTE etape-simulering (race_simulation_runs) = det
// frosne start-felt. Bruges til at låse senere etapers felt. Legacy/single-løb uden
// snapshot → null (ingen frysning). Håndterer både string-array og {rider_id}-objekter.
async function loadStartFieldRiderIds({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_simulation_runs").select("stage_number, entrant_snapshot")
    .eq("race_id", raceId).order("stage_number", { ascending: true }).limit(1);
  if (error) throw new Error(`race_simulation_runs (start field): ${error.message}`);
  const snap = data?.[0]?.entrant_snapshot;
  if (!Array.isArray(snap)) return null;
  return snap.map((x) => (typeof x === "string" ? x : x?.rider_id)).filter(Boolean);
}

// #1307: per-hold autopick. For hvert egnet hold (ikke test/frosset) UDEN entries
// for løbet: assistenten udtager 6-8 bedst egnede + kaptajn (spec 8.1 — "vælger du
// ikke, vælger assistenten fornuftigt; ingen straf for fravær"). Hold MED entries
// (manager-udtagne) røres ikke. Skadede (injured_until >= i dag) udelades (#1306 6.5).
//
// #1688 (forever-relaunch race-scale): to additive felt-garantier oven på #1307:
//   1. PULJE-FILTER — når løbet har en pulje (race.league_division_id), auto-fyldes
//      KUN hold i den pulje. Et løb hører til én pulje (race/standings-gruppe, #1608);
//      hold fra andre puljer hører ikke i feltet. Bærer løbet endnu ingen pulje
//      (pre-per-pool-race-virkelighed — `races` har ingen pulje-kolonne i dag, og
//      parallelle pulje-løb-instanser er bevidst out-of-scope), springes filteret
//      over og hele feltet behandles som én pulje (uændret #1307-adfærd) — men
//      felt-cap'et nedenfor beskytter stadig mod et urealistisk stort startfelt.
//   2. FELT-CAP — feltet cappes til POOL_TARGET_SIZE (24, = pulje-target). Er flere
//      end 24 hold egnede, beholdes de 24 STÆRKESTE målt på aggregeret roster-
//      base_value (markedsværdi-proxy). Det forener race-feltets størrelse med
//      pulje-kapaciteten (#1608: pulje-target = race-feltcap = 24).
export async function fillMissingTeamEntries({ supabase, race, stages, existingEntries, persist = true }) {
  const { data: teams, error: teamErr } = await supabase
    .from("teams")
    .select("id, is_test_account, is_frozen, league_division_id")
    .or("is_test_account.is.null,is_test_account.eq.false");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  const teamsWithEntries = new Set((existingEntries || []).map((e) => e.team_id));
  // Fase 0b: hold der har trukket sig fra løbet (frivillig deltagelse) udelades.
  const withdrawnTeams = await loadWithdrawnTeamIds({ supabase, raceId: race.id });

  // #1688 pulje-filter: kun hold i løbets pulje (når løbet har en). NB: DB-eq på
  // league_division_id kunne gøre dette server-side, men selectInChunks-/teams-stien
  // henter alle hold; vi filtrerer i app-koden så logikken er testbar og pulje-
  // semantikken er eksplicit (service_role/bulk bypasser desuden RLS).
  const racePoolId = race?.league_division_id ?? null;
  let eligibleTeams = (teams || []).filter(
    (t) => !t.is_frozen && !teamsWithEntries.has(t.id) && !withdrawnTeams.has(t.id)
  );
  if (racePoolId != null) {
    eligibleTeams = eligibleTeams.filter((t) => t.league_division_id === racePoolId);
  }
  let missingTeamIds = eligibleTeams.map((t) => t.id);
  if (!missingTeamIds.length) return [];

  const { data: riders, error: riderErr } = await selectInChunks({
    supabase, table: "riders", columns: "id, team_id, base_value",
    // Rod B: delt eligibility-filter (ikke-akademi + ikke-pensioneret). Manglede
    // is_academy → akademiryttere kunne sim-tids-autofyldes (#1742/#1800).
    inColumn: "team_id", ids: missingTeamIds,
    extra: (q) => applyRiderEligibilityFilter(q),
  });
  if (riderErr) throw new Error(`riders: ${riderErr.message}`);

  // #1688 felt-cap: er der flere end POOL_TARGET_SIZE egnede hold, behold de 24
  // stærkeste på aggregeret roster-base_value. Beregnes FØR skade-/abilities-
  // filtrering, så cap'et følger holdets reelle styrke (ikke det tilfældige antal
  // skadede den dag). Deterministisk tie-break på team_id, så samme felt hver gang.
  if (missingTeamIds.length > POOL_TARGET_SIZE) {
    const strengthByTeam = new Map(missingTeamIds.map((id) => [id, 0]));
    for (const r of riders || []) {
      if (strengthByTeam.has(r.team_id)) {
        strengthByTeam.set(r.team_id, strengthByTeam.get(r.team_id) + (r.base_value || 0));
      }
    }
    const keptIds = new Set(
      [...missingTeamIds]
        .sort((a, b) => {
          const diff = (strengthByTeam.get(b) || 0) - (strengthByTeam.get(a) || 0);
          return diff !== 0 ? diff : (a < b ? -1 : a > b ? 1 : 0);
        })
        .slice(0, POOL_TARGET_SIZE),
    );
    missingTeamIds = missingTeamIds.filter((id) => keptIds.has(id));
  }
  const keptTeamSet = new Set(missingTeamIds);

  // Spec 6.5 (#1306): skadede ryttere (injured_until >= i dag) må ikke auto-fyldes i startfeltet.
  const todayStr = copenhagenDateString();
  const { data: injured, error: injErr } = await supabase
    .from("rider_condition")
    .select("rider_id")
    .gte("injured_until", todayStr);
  if (injErr) throw new Error(`rider_condition (injured): ${injErr.message}`);
  const injuredIds = new Set((injured || []).map((r) => r.rider_id));
  // #1688: riders blev hentet for hele pre-cap-sættet — behold kun ryttere på de
  // hold der overlevede felt-cap'et, så cappede hold ikke smutter ind i feltet.
  const candidates = (riders || []).filter((r) => !injuredIds.has(r.id) && keptTeamSet.has(r.team_id));
  if (!candidates.length) return [];

  const candidateIds = candidates.map((r) => r.id);
  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const { data: abilities, error: aErr } = await selectInChunks({
    supabase, table: "rider_derived_abilities", columns: abilityCols,
    inColumn: "rider_id", ids: candidateIds,
  });
  if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
  const abilityByRider = new Map((abilities || []).map((a) => [a.rider_id, a]));

  // Træthed (let dæmpning i autopick) — degraderer til 0 ved fejl, mirror B2.
  let fatigueByRider = new Map();
  const { data: conditions, error: condErr } = await selectInChunks({
    supabase, table: "rider_condition", columns: "rider_id, fatigue",
    inColumn: "rider_id", ids: candidateIds,
  });
  if (!condErr) fatigueByRider = new Map((conditions || []).map((c) => [c.rider_id, c.fatigue]));

  const sizeRule = selectionSizeForRace(race);
  const rows = [];
  const byTeam = new Map();
  for (const r of candidates) {
    const abRow = abilityByRider.get(r.id);
    if (!abRow) continue; // uden abilities kan rytteren ikke scores (defensivt, som entrants)
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push({ rider_id: r.id, abilities: abRow, fatigue: fatigueByRider.get(r.id) });
  }
  // #1845: cross-race binding — runtime auto-fill MÅ ikke vælge en rytter der allerede
  // er bundet i et tidsoverlappende løb (samme CET-dag, inkl. IGANGVÆRENDE løb). Uden
  // dette fyldte fx Tour des Alpes Suisses med den igangværende La Corsas ryttere
  // (142 dobbeltbookinger 25/6). Spejler raceEntryGenerator.assignTeamAcrossRaces.
  const { thisWindow, otherRacesByTeam } = await loadFieldBindingContext({
    supabase, race, teamIds: [...byTeam.keys()],
  });
  for (const [teamId, teamRiders] of byTeam) {
    const available = excludeBoundRiders({
      riders: teamRiders, thisWindow, otherRaces: otherRacesByTeam.get(teamId) || [],
    });
    for (const pick of autopickTeamSelection({ riders: available, stages, sizeRule })) {
      rows.push({ race_id: race.id, rider_id: pick.rider_id, team_id: teamId, race_role: pick.race_role, is_auto_filled: true });
    }
  }

  if (persist && rows.length) {
    const { error: insErr } = await supabase.from("race_entries").insert(rows);
    if (insErr) throw new Error(`race_entries insert: ${insErr.message}`);
  }
  return rows.map((r) => ({ rider_id: r.rider_id, team_id: r.team_id, race_role: r.race_role }));
}

// U25 afledt SÆSON-korrekt fra birthdate (#109/#2073). Den lagrede riders.is_u25-
// kolonne er statisk (DEFAULT FALSE) og re-deriveres aldrig → 16-18-årige oprettet
// uden flag (akademi/intake/generatorer) forblev false for evigt og manglede i
// ungdomsklassementet. Konventionen matcher fictionalRiderGenerator + import_riders.py:
//   U25 = fødselsår > referenceår - 25  ⇔  (referenceår − fødselsår) < 25.
// referenceåret er SÆSONENS år (seasons.start_date), ikke wall-clock — så gaten er
// sæson-drevet. Manglende birthdate/ugyldigt referenceår → false (kan ikke bekræftes).
export function deriveIsU25FromBirthdate(birthdate, seasonYear) {
  if (!birthdate || !Number.isFinite(seasonYear)) return false;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return false;
  return birthYear > seasonYear - 25;
}

// Sæsonens referenceår = året for seasons.start_date. Additiv/degraderende opslag
// (som condition-/team_name-berigelsen): fejler det, falder vi tilbage til at bruge
// det lagrede is_u25-flag frem for at blokere finalization. race.season_id er
// garanteret af kalderne (runRaceFinalization/finalizeRaceStage kaster uden det).
async function loadSeasonReferenceYear({ supabase, seasonId }) {
  if (!seasonId) return null;
  try {
    // Await query-builderen direkte (thenable) frem for .maybeSingle() — så
    // opslaget virker mod både den ægte klient og de minimale test-mocks, og
    // enhver uventet throw degraderer til null (fallback til lagret is_u25).
    const { data, error } = await supabase
      .from("seasons")
      .select("start_date")
      .eq("id", seasonId);
    if (error) {
      console.error(`season-referenceår-opslag fejlede (falder til lagret is_u25): ${error.message}`);
      return null;
    }
    const startDate = Array.isArray(data) ? data[0]?.start_date : data?.start_date;
    if (!startDate) return null;
    const year = new Date(startDate).getFullYear();
    return Number.isFinite(year) ? year : null;
  } catch (e) {
    console.error(`season-referenceår-opslag kastede (falder til lagret is_u25): ${e.message}`);
    return null;
  }
}

// Indlæs startfeltet (race_entries → per-hold autopick for hold UDEN entries) beriget
// med navn, is_u25, abilities + race_role. Hold MED manager-udtagne entries røres ikke.
// persist=false (#1102 dryRun): auto-fill beregnes i hukommelsen — ingen DB-insert.
// stages bruges af autopick til egnethedsscore (suitabilityScore pr. terrain).
export async function loadEntrantsForRace({ supabase, race, stages = [], persist = true, allowAutofill = true }) {
  const { data: existing, error } = await supabase
    .from("race_entries")
    .select("rider_id, team_id, race_role")
    .eq("race_id", race.id);
  if (error) throw new Error(`race_entries: ${error.message}`);

  let existingEntries = existing || [];
  // #1846: drop stale cross-division entries — et hold der har skiftet division (op/nedrykning)
  // efterlod entries i den gamle divisions løb. Kun hold i løbets EGEN division må være i feltet.
  if (race.league_division_id != null && existingEntries.length) {
    const teamIds = [...new Set(existingEntries.map((e) => e.team_id).filter(Boolean))];
    const { data: teamDivs } = await supabase.from("teams").select("id, league_division_id").in("id", teamIds);
    const teamDivisionById = new Map((teamDivs || []).map((t) => [t.id, t.league_division_id]));
    existingEntries = filterEntriesToRaceDivision({ entries: existingEntries, teamDivisionById, raceDivisionId: race.league_division_id });
  }
  // Rod B (#1742/#1800): drop committede ghost-entries — rytter solgt/fyret (off-team),
  // blevet akademi eller pensioneret EFTER udtagelse. Krydses mod rytterens NUVÆRENDE
  // tilstand, så en fremmed/uegnet rytter aldrig kører for et hold han har forladt
  // (forbrugs-punkt-gyldighed; spejler #1846-divisions-filteret ovenfor). Ingen query-
  // eligibility-filter her — vi henter netop akademi/pensioneret-rækkerne for at se dem.
  if (existingEntries.length) {
    const entryRiderIds = [...new Set(existingEntries.map((e) => e.rider_id))];
    const { data: entryRiders, error: erErr } = await selectInChunks({
      supabase, table: "riders", columns: "id, team_id, is_academy, is_retired",
      inColumn: "id", ids: entryRiderIds,
    });
    if (erErr) throw new Error(`riders (eligibility): ${erErr.message}`);
    const ridersById = new Map((entryRiders || []).map((r) => [r.id, r]));
    // #1906 loan-aware: en udlånt rytter kører for låneren — han må ikke stå i ejer-
    // holdets faktiske startfelt (ellers kører han for det forkerte hold / dobbelt).
    const { data: loanedOutRiderIds, error: loErr } = await loadLoanedOutRiderIds({ supabase, riderIds: entryRiderIds });
    if (loErr) throw new Error(`loan_agreements (eligibility): ${loErr.message}`);
    existingEntries = filterEligibleEntries({ entries: existingEntries, ridersById, loanedOutRiderIds });
  }
  // #1307: autopick for hold UDEN entries. #1844: KUN ved etape 1 (allowAutofill) — et
  // igangværende etapeløb må ikke få nye ryttere fyldt ind mellem etaper (feltet er låst).
  const autopicked = allowAutofill
    ? await fillMissingTeamEntries({ supabase, race, stages, existingEntries, persist })
    : [];
  const entries = [...existingEntries, ...autopicked];
  if (!entries.length) return [];

  const teamByRider = new Map(entries.map((e) => [e.rider_id, e.team_id]));
  const roleByRider = new Map(entries.map((e) => [e.rider_id, e.race_role]));
  const riderIds = entries.map((e) => e.rider_id);

  const { data: riders, error: rErr } = await selectInChunks({
    supabase, table: "riders", columns: "id, firstname, lastname, is_u25, birthdate",
    inColumn: "id", ids: riderIds,
  });
  if (rErr) throw new Error(`riders: ${rErr.message}`);

  // #109/#2073: U25 afledes sæson-korrekt fra birthdate frem for det stale
  // riders.is_u25-flag. Referenceåret hentes fra sæsonen (additivt/degraderende:
  // fejler opslaget, falder vi tilbage til det lagrede flag pr. rytter nedenfor).
  const seasonRefYear = await loadSeasonReferenceYear({ supabase, seasonId: race.season_id });

  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const { data: abilities, error: aErr } = await selectInChunks({
    supabase, table: "rider_derived_abilities", columns: abilityCols,
    inColumn: "rider_id", ids: riderIds,
  });
  if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
  const abilityByRider = new Map((abilities || []).map((a) => [a.rider_id, a]));

  // Berig entrants med form/træthed fra rider_condition i ét batched opslag (spec #1306 B2).
  // Berigelsen er additiv: fejler opslaget, degraderer vi til neutral (undefined) frem for
  // at blokere race-finalization — modsat skade-eksklusionen i fillMissingTeamEntries, der SKAL fejle hårdt.
  let conditionByRider = new Map();
  const { data: conditions, error: condErr } = await selectInChunks({
    supabase, table: "rider_condition", columns: "rider_id, form, fatigue",
    inColumn: "rider_id", ids: riderIds,
  });
  if (condErr) {
    console.error(`rider_condition-berigelse fejlede (degraderer til neutral): ${condErr.message}`);
  } else {
    conditionByRider = new Map((conditions || []).map((c) => [c.rider_id, c]));
  }

  // #1993: snapshot holdnavnet på løbstidspunktet ind på hver entrant, så
  // buildRaceResults kan skrive et immutabelt team_name på race_results. Navnet
  // hentes fra teams ud fra entry'ens (frosne) team_id — IKKE fra rytterens
  // nuværende hold (team_id-snapshottet i race_entries er #1844-beskyttet).
  const teamIds = [...new Set([...teamByRider.values()].filter(Boolean))];
  let teamNameById = new Map();
  if (teamIds.length) {
    const { data: teamRows, error: teamErr } = await selectInChunks({
      supabase, table: "teams", columns: "id, name",
      inColumn: "id", ids: teamIds,
    });
    if (teamErr) {
      // Additiv berigelse: degradér til null frem for at blokere finalization.
      console.error(`team_name-berigelse fejlede (degraderer til null): ${teamErr.message}`);
    } else {
      teamNameById = new Map((teamRows || []).map((t) => [t.id, t.name]));
    }
  }

  const entrants = [];
  for (const r of riders || []) {
    const ab = abilityByRider.get(r.id);
    if (!ab) continue; // uden abilities kan rytteren ikke scores → udelad (defensivt)
    const teamId = teamByRider.get(r.id) ?? null;
    const entrant = {
      rider_id: r.id,
      team_id: teamId,
      team_name: teamId != null ? (teamNameById.get(teamId) ?? null) : null,
      rider_name: [r.firstname, r.lastname].filter(Boolean).join(" ") || null,
      // #109/#2073: sæson-afledt U25 (referenceår − fødselsår < 25). Kun hvis
      // sæson-referenceåret kunne læses; ellers fald tilbage til det lagrede flag
      // (degraderende — blokerer aldrig finalization).
      is_u25: seasonRefYear != null ? deriveIsU25FromBirthdate(r.birthdate, seasonRefYear) : !!r.is_u25,
      abilities: ab,
    };
    const role = roleByRider.get(r.id);
    if (role) entrant.race_role = role;
    const cond = conditionByRider.get(r.id);
    if (cond !== undefined) {
      entrant.form = cond.form;
      entrant.fatigue = cond.fatigue;
    }
    // Ryttere uden condition-række: form/fatigue sættes IKKE (undefined → neutral i simulatoren).
    entrants.push(entrant);
  }
  return entrants;
}

async function loadRacePoints(supabase, raceClass) {
  if (!raceClass) return [];
  const { data, error } = await supabase
    .from("race_points")
    .select("result_type, rank, points")
    .eq("race_class", raceClass);
  if (error) throw new Error(`race_points: ${error.message}`);
  return data || [];
}

// source: diskriminator til stage-schedulerens daglige cap (FIX 4). 'scheduler' →
// tælles i cap'en; null (admin-fuld-sim / manuel afvikling) → tælles ikke.
async function persistRuns({ supabase, race, runs, source = null }) {
  if (!runs.length) return;
  const rows = runs.map((r) => ({
    race_id: race.id,
    stage_number: r.stage_number,
    seed: r.seed,
    engine_version: r.engine_version,
    entrant_snapshot: r.entrant_snapshot,
    input_checksum: r.input_checksum,
    source,
  }));
  // Idempotent: slet tidligere runs for de samme etaper før insert.
  await supabase.from("race_simulation_runs").delete().eq("race_id", race.id)
    .in("stage_number", [...new Set(rows.map((r) => r.stage_number))]);
  const { error } = await supabase.from("race_simulation_runs").insert(rows);
  if (error) throw new Error(`race_simulation_runs: ${error.message}`);
}

/**
 * I/O-orchestrator: afvikl ét løb via motoren og skriv via den UÆNDREDE
 * applyRaceResults. Spejler pcmResultsImport's idempotens + efter-orkestrering.
 * Bør kun kaldes når RACE_ENGINE_V2_ENABLED er ON (se raceEngineFlag.js).
 */
export async function simulateRace({
  supabase,
  race,
  dryRun = false,
  applyRaceResults = applyRaceResultsShared,
  ensureSeasonStandings = async () => {},
  updateStandings = async () => {},
  recomputeRaceDays = recomputeSeasonRaceDays,
  processBoardWeekend = processBoardWeekendFinalizationShared,
  notifyDiscord = null,
  notifyInApp = null,
  applyFatigue = applyRaceFatigue,
}) {
  if (!supabase?.from) throw new Error("supabase client required");
  if (!race?.id || !race?.season_id) throw new Error("race {id, season_id} required");

  // #1187 · race_days_completed FØR afviklingen — checkpoint-udgangspunkt for
  // board-weekend-wiring nedenfor. Defensiv: manglende række → null (ingen
  // checkpoint-evaluering, satisfaction opdateres stadig).
  const { data: seasonBefore } = await supabase
    .from("seasons")
    .select("id, number, status, race_days_completed, race_days_total")
    .eq("id", race.season_id)
    .maybeSingle();

  const stages = await loadStageProfiles(supabase, race.id);
  if (!stages.length) throw new Error(`No race_stage_profiles for race ${race.id} — run backfill`);

  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: !dryRun });
  if (!entrants.length) throw new Error(`No start list for race ${race.id}`);

  const racePoints = await loadRacePoints(supabase, race.race_class);
  const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });

  const { resultRows, runs } = buildRaceResults({ race, stages, entrants, pointsLookup });

  // Dry-run-preview (#1102 runtime-wiring): alt loades og beregnes som ved en
  // ægte afvikling, men INTET skrives — admin kan inspicere udfaldet før flip.
  if (dryRun) {
    const stageWinners = resultRows
      .filter((r) => r.result_type === "stage" && r.rank === 1)
      .map((r) => ({ stage: r.stage_number, rider: r.rider_name }));
    const gcPodium = resultRows
      .filter((r) => r.result_type === "gc" && r.rank <= 3)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ rank: r.rank, rider: r.rider_name }));
    return {
      dryRun: true,
      rows: resultRows.length, stages: stages.length, entrants: entrants.length,
      stageWinners, gcPodium,
    };
  }

  // Idempotent PR. ETAPE — spejler pcmResultsImport: slet kun de etaper denne
  // afvikling faktisk dækker, så en gen-afvikling ikke wiper andre etaper.
  const stagesInRun = [...new Set(resultRows.map((r) => r.stage_number))];
  if (stagesInRun.length) {
    await supabase.from("race_results").delete().eq("race_id", race.id).in("stage_number", stagesInRun);
  }

  const applied = await applyRaceResults({
    supabase,
    race: { ...race },
    resultRows,
    ensureSeasonStandings,
    updateStandings,
  });

  await persistRuns({ supabase, race, runs });
  await supabase.from("races").update({ status: "completed" }).eq("id", race.id);

  // #1306 spec 6.4: løbsdage bygger træthed — én batch pr. simuleret etape, kun ved
  // persist (dry-run returnerer allerede ovenfor). Fejl sluges: træthed er additiv
  // berigelse; et upsert-problem må ikke vælte finalization (mirror B2-beslutningen
  // for condition-berigelse i loadEntrantsForRace).
  const riderIds = entrants.map((e) => e.rider_id);
  for (const stage of stages) {
    try {
      await applyFatigue({ supabase, riderIds, profileType: stage.profile_type });
    } catch (err) {
      console.error(`  ⚠️  race fatigue upsert failed (stage ${stage.stage_number}, ${stage.profile_type}): ${err.message}`);
    }
  }

  const newRaceDaysCompleted = await recomputeRaceDays({ supabase, seasonId: race.season_id });

  // #1187 · Løbende bestyrelses-tilfredshed efter afviklet løb. Fejl må ikke
  // vælte afviklingen — resultaterne ER allerede skrevet.
  if (seasonBefore?.id) {
    try {
      await processBoardWeekend({
        supabase,
        season: {
          ...seasonBefore,
          race_days_completed: Number.isFinite(Number(newRaceDaysCompleted))
            ? newRaceDaysCompleted
            : seasonBefore.race_days_completed,
        },
        previousRaceDaysCompleted: seasonBefore.race_days_completed ?? null,
        race: { id: race.id, name: race.name },
      });
    } catch (error) {
      console.error("  ⚠️  board weekend update failed after race simulation:", error.message);
    }
  }

  if (notifyDiscord) {
    try {
      await notifyDiscord({ race, resultRows });
    } catch {
      // Discord-fejl må ikke vælte afviklingen.
    }
  }

  // #1952 · In-app resultat-notifikation til hver deltagende menneske-manager.
  // Samme fejl-isolation som Discord: en notif-fejl må ikke vælte afviklingen.
  if (notifyInApp) {
    try {
      await notifyInApp({ race });
    } catch {
      // In-app notif-fejl må ikke vælte afviklingen.
    }
  }

  return {
    rowsImported: applied.rowsImported,
    rows: resultRows.length,
    stages: stages.length,
    entrants: entrants.length,
    runs: runs.length,
  };
}

// ── #2072: stage-by-stage klassements-akkumulering ────────────────────────────

// Persisterede etaperækker fra tidligere etaper — SSOT for klassementerne.
// Range-pagineret (startfelter på 100-200 ryttere × mange etaper overstiger
// PostgREST's 1000-cap). Defensivt client-side-filter oveni query-filtrene:
// akkumuleringen må KUN se 'stage'-rækker fra FØR dagens etape.
async function loadPriorStageRows({ supabase, raceId, beforeStageNumber }) {
  const { data, error } = await fetchAllPaged(() =>
    supabase
      .from("race_results")
      .select("stage_number, result_type, rank, rider_id, team_id, finish_time")
      .eq("race_id", raceId)
      .eq("result_type", "stage")
      .lt("stage_number", beforeStageNumber)
      .order("id", { ascending: true })
  );
  if (error) throw new Error(`race_results (prior stages): ${error.message}`);
  return (data || []).filter(
    (r) => r.result_type === "stage" && (r.stage_number || 1) < beforeStageNumber && r.rider_id
  );
}

/**
 * #2072-kerne (etapeløb, stage-by-stage): simulér PRÆCIS dagens etape og AKKUMULÉR
 * klassementerne (GC/point/bjerg/ungdom/hold) fra de persisterede race_results-
 * etaperækker + dagens resultat. Slut-GC og alle klassementer er dermed ALTID
 * summen af de publicerede etape-gaps — aldrig en frisk re-simulation med dagens
 * felt/form/træthed (rod-årsagen bag Vuelta Burgalesa: etape-resultater og slut-GC
 * kom fra 4-5 forskellige simulationer, og spillerne kunne regne modstriden ud).
 *
 * Træthed: dagens sim kører på rytterens NUVÆRENDE rider_condition.fatigue — den
 * indeholder allerede tidligere etapers belastning (applyRaceFatigue efter hver
 * etape) plus evt. restitution mellem etapedage. stageEnteringFatigues-re-
 * akkumulering oveni ville dobbelt-tælle de kørte etaper (del af #2072).
 *
 * Feltændringer håndteres af data-formen selv: en rytter der forlod feltet
 * (solgt/slettet/udlånt) beholder sine persisterede etaperækker og præmier, men
 * mangler en etape → udgår af klassementerne (filterCompletedEntrants).
 *
 * priorStageRows injiceres af kalderen (I/O adskilt fra beregning — testbar kerne).
 * Ren + deterministisk givet (race.id, stagesSorted, entrants, priorStageRows).
 *
 * @returns {{ resultRows, runs }}  alle rækker bærer stage_number = dagens etape,
 *   så apply_stage_result-RPC'ens idempotente delete-then-insert dækker dem.
 */
export function buildStageRowsAccumulated({ race, stagesSorted, stageIndex, entrants = [], pointsLookup = {}, priorStageRows = [] }) {
  if (!race?.id) throw new Error("race.id required");
  if (!stagesSorted?.length) throw new Error("no stage profiles");
  if (!entrants.length) throw new Error("no entrants");
  const thisStage = stagesSorted[stageIndex];
  if (!thisStage) throw new Error(`stageIndex ${stageIndex} out of range`);
  const stageNumber = thisStage.stage_number || stageIndex + 1;
  const isFinal = stageIndex === stagesSorted.length - 1;

  const byId = new Map();
  const teamNameByTeam = new Map();
  for (const e of entrants) {
    byId.set(e.rider_id, e);
    if (e?.team_id != null && e?.team_name != null && !teamNameByTeam.has(e.team_id)) {
      teamNameByTeam.set(e.team_id, e.team_name);
    }
  }

  const resultRows = [];
  const { pushIndiv, pushTeam } = makeResultRowPushers({ race, byId, teamNameByTeam, pointsLookup, resultRows });

  const simEntrants = entrants.map((e) => ({
    rider_id: e.rider_id,
    team_id: e.team_id,
    abilities: e.abilities,
    ...(e.form != null ? { form: e.form } : {}),
    fatigue: Math.max(0, Math.min(100, Number(e.fatigue) || 0)),
    ...(e.race_role ? { race_role: e.race_role } : {}),
  }));

  const seed = stableSeed(`${race.id}:${stageNumber}`);
  const { ranked } = simulateStage({ entrants: simEntrants, stageProfile: thisStage, seed });
  // #1499: deskriptive udbruds-etiketter for dagens finish-order (ren read).
  const breakawayStatus = deriveBreakawayStatus(ranked);
  const bwOf = (riderId) => breakawayStatus.get(riderId) || { in_breakaway: false, breakaway_caught: false };

  const runs = [{
    stage_number: stageNumber,
    seed,
    engine_version: ENGINE_VERSION,
    entrant_snapshot: simEntrants.map((e) => e.rider_id).sort(),
    input_checksum: stableSeed(JSON.stringify({
      ids: simEntrants.map((e) => e.rider_id).sort(),
      roles: simEntrants.filter((e) => e.race_role).map((e) => [e.rider_id, e.race_role]).sort(),
      demand: thisStage.demand_vector,
      profile: thisStage.profile_type,
    })),
  }];

  // Dagens etaperækker (samme form som buildRaceResults' stage-emission).
  for (const r of ranked) {
    pushIndiv({ result_type: "stage", rank: r.rank, rider_id: r.rider_id, stage_number: stageNumber, finish_time: formatGap(r.stageGap), ...bwOf(r.rider_id) });
  }

  // Klassementer akkumuleres fra persisterede + dagens rækker — dagens gap går
  // igennem formatGap FØRST, så klassementet bygger på PRÆCIS de afrundede gaps
  // spillerne ser publiceret (sum af etape-gaps = GC, altid).
  const todayStageRows = ranked.map((r) => ({
    stage_number: stageNumber,
    result_type: "stage",
    rank: r.rank,
    rider_id: r.rider_id,
    team_id: byId.get(r.rider_id)?.team_id ?? null,
    finish_time: formatGap(r.stageGap),
  }));
  const profileTypeByStage = new Map(stagesSorted.map((s) => [s.stage_number || 1, s.profile_type]));
  const acc = accumulateStageRows({ stageRows: [...priorStageRows, ...todayStageRows], profileTypeByStage });
  const classified = filterCompletedEntrants(entrants, acc.stagesByRider, acc.stageNumbers);
  if (!classified.length && entrants.length) {
    console.error(`  ⚠️  race ${race.id} stage ${stageNumber}: no riders completed all ${acc.stageNumbers.size} ridden stages — classifications omitted`);
  }

  const gc = rankByCumTimeAsc(classified, acc.cumTime, acc.posSum);
  const leaderTime = gc.length ? gc[0].time : 0;
  const gcFinish = (entry) => formatGap(entry.time - leaderTime);
  const young = rankByCumTimeAsc(classified.filter((e) => e.is_u25), acc.cumTime, acc.posSum);
  const pointsCls = rankByCompDesc(classified, acc.pointsComp);
  const komCls = rankByCompDesc(classified, acc.komComp);

  if (!isFinal) {
    // Mellem-etape (#2081): fulde løbende klassementer under dag-typerne (se
    // buildRaceResults for payout-noten: kun rank 1 har race_points-opslag).
    for (const g of gc) pushIndiv({ result_type: "leader", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
    for (const p of pointsCls) pushIndiv({ result_type: "points_day", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
    for (const k of komCls) pushIndiv({ result_type: "mountain_day", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
    for (const y of young) pushIndiv({ result_type: "young_day", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
  } else {
    // Slut-etape: hele klassementet udbetales — fra AKKUMULERINGEN, ikke en re-sim.
    for (const g of gc) pushIndiv({ result_type: "gc", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
    for (const p of pointsCls) pushIndiv({ result_type: "points", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
    for (const k of komCls) pushIndiv({ result_type: "mountain", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
    for (const y of young) pushIndiv({ result_type: "young", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
    for (const t of teamClassification(classified, acc.cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber });
  }

  return { resultRows, runs };
}

/**
 * Stage-by-stage afvikling (WS1 Fase 3): afvikl PRÆCIS én etape (0-indekseret
 * stageIndex). #2072: dagens etape simuleres ISOLERET (seed = stableSeed(
 * `${race.id}:${stageNumber}`) er uændret); klassementerne akkumuleres fra de
 * persisterede etaperækker via buildStageRowsAccumulated. Etape 1..N-1's DB-rækker
 * røres ikke — den idempotente delete-then-insert er afgrænset til denne etape.
 *
 * KORREKTHED:
 *  - applyFatigue kaldes KUN for DENNE etapes profil (ikke 1..N — de kørte i
 *    tidligere invokationer; ellers dobbelt-akkumulering).
 *  - Finalization (status=completed, recomputeRaceDays, processBoardWeekend,
 *    notifyDiscord) fyrer KUN på final-etapen. Mellem-etaper afslører resultater
 *    men finaliserer ikke. Discord-embed på final = HELE løbets race_results
 *    genlæst fra DB (alle etaper, ikke kun final-etapens nybyggede rækker).
 *  - loadEntrantsForRace.persist = (stageIndex === 0) — entries auto-fyldes kun
 *    ved første etape; senere etaper rører ikke startfeltet.
 *
 * @returns {{ stageNumber, isFinalStage, rowsImported, entrants, stages }}
 */
export async function simulateStageByIndex({
  supabase,
  race,
  stageIndex,
  dryRun = false,
  runSource = null,
  // #1598: result-write (counter + race_results delete+insert) går nu via den atomære
  // apply_stage_result-RPC (applyStageResult). ensureSeasonStandings/updateStandings
  // kører EFTER RPC'en committer (standings = idempotent re-derivation, ej desync-følsom).
  ensureSeasonStandings = async () => {},
  updateStandings = async () => {},
  recomputeRaceDays = recomputeSeasonRaceDays,
  processBoardWeekend = processBoardWeekendFinalizationShared,
  notifyDiscord = null,
  notifyInApp = null,
  applyFatigue = applyRaceFatigue,
  applyStageResult = applyStageResultAtomic,
}) {
  if (!supabase?.from) throw new Error("supabase client required");
  if (!race?.id || !race?.season_id) throw new Error("race {id, season_id} required");
  if (!Number.isInteger(stageIndex) || stageIndex < 0) throw new Error("stageIndex must be a non-negative integer");

  // Checkpoint FØR afviklingen — board-weekend bruger previous-vs-new race_days.
  const { data: seasonBefore } = await supabase
    .from("seasons")
    .select("id, number, status, race_days_completed, race_days_total")
    .eq("id", race.season_id)
    .maybeSingle();

  const stages = await loadStageProfiles(supabase, race.id);
  if (!stages.length) throw new Error(`No race_stage_profiles for race ${race.id} — run backfill`);
  if (stageIndex > stages.length - 1) {
    throw new Error(`stageIndex ${stageIndex} out of range (race has ${stages.length} stages)`);
  }

  const stagesSorted = [...stages].sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));
  const thisStage = stagesSorted[stageIndex];
  const stageNumber = thisStage.stage_number || stageIndex + 1;
  const isFinalStage = stageIndex === stagesSorted.length - 1;
  const totalStages = stagesSorted.length;
  const completedBefore = Number(race.stages_completed) || 0;

  // ── FIX 1 (re-entrant recovery): et løb hvis ALLE etaper er afviklet
  // (stages_completed >= stages) men status ENDNU ikke er 'completed' sidder fast i
  // "finalization pending" (et crash mellem stages_completed-bump og status-flip, eller
  // mellem finalization-trin). Det skal kunne genoptages idempotent → kør KUN finalization
  // (resultater/standings ER allerede skrevet; vi rør dem ikke igen). isFinalStage SKAL
  // gælde her — recovery giver kun mening for final-etapen.
  const finalizationPending = !dryRun
    && isFinalStage
    && completedBefore >= totalStages
    && race.status !== "completed";

  // ── FIX 3 (status-guard, defense-in-depth): et FÆRDIGT løb (status='completed')
  // må ikke gen-afvikles via denne sti — finalization er per definition allerede kørt.
  // Recovery-tilfældet ovenfor er det modsatte (status != completed), så de udelukker hinanden.
  if (!dryRun && race.status === "completed") {
    throw new Error(`Race ${race.id} already simulated (status=completed) — re-simulation blocked`);
  }

  // Entries auto-fyldes KUN ved første etape (persist=false fra etape 2). I recovery
  // springer vi entrants/resultatberegning helt over — intet skal genberegnes.
  const persistEntries = !dryRun && !finalizationPending && stageIndex === 0;

  let entrants = [];
  let resultRows = [];
  let runs = [];
  let applied = { rowsImported: 0 };

  if (!finalizationPending) {
    // #1844: auto-fyld KUN ved etape 1. Senere etaper må ikke tilføje nye ryttere.
    entrants = await loadEntrantsForRace({ supabase, race, stages, persist: persistEntries, allowAutofill: stageIndex === 0 });

    // #1844: frys feltet til etape-1-snapshot. Et igangværende etapeløbs felt MÅ ikke
    // ændre sig mellem etaper — en rytter der kom ind midt i løbet (manuelt edit pre-#1838,
    // rytter-tilføjelse, eller anden drift) blev ellers simuleret retroaktivt gennem alle
    // etaper og kunne vinde GC (Boucles Mayennaises). Etape 1 / legacy-løb uden snapshot
    // → loadStartFieldRiderIds=null → ingen frysning.
    if (stageIndex > 0) {
      const startField = await loadStartFieldRiderIds({ supabase, raceId: race.id });
      const { frozen, added, missing } = freezeEntrantsToStartField(entrants, startField);
      if (added.length) {
        console.error(`  ⚠️  race ${race.id} etape ${stageNumber}: ${added.length} mid-race-rytter(e) ekskluderet fra GC (#1844): ${added.slice(0, 5).join(",")}${added.length > 5 ? "…" : ""}`);
      }
      if (missing.length) {
        console.error(`  ⚠️  race ${race.id} etape ${stageNumber}: ${missing.length} start-felt-rytter(e) forsvundet (#1844/#1847): ${missing.slice(0, 5).join(",")}${missing.length > 5 ? "…" : ""}`);
      }
      entrants = frozen;
    }
    // #2103: skeln datakorruption fra tomt felt. Et løb midt i afviklingen
    // (stages_completed > 0) UDEN entries betyder at en anden skriver har bumpet
    // counteren/resultaterne uden om motoren (La Corsa dei Due Mari 30/6: to
    // fantom-etaper med arketype-ryttere, ingen race_entries/sim-runs) — det kan
    // ikke self-heale (autofill er bevidst låst efter etape 1, #1844) og kræver
    // data-reparation: slet fantom-resultater + nulstil stages_completed.
    if (!entrants.length) {
      if (stageIndex > 0) {
        throw new Error(
          `No start list for race ${race.id} at stage ${stageNumber} — `
          + `${completedBefore} stage(s) marked completed but race_entries is empty `
          + `(data integrity: results written outside the engine? Reset the race — see #2103)`
        );
      }
      throw new Error(`No start list for race ${race.id}`);
    }

    const racePoints = await loadRacePoints(supabase, race.race_class);
    const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });

    if (race.race_type === "stage_race") {
      // #2072: simulér KUN dagens etape; klassementer akkumuleres fra de
      // persisterede etaperækker — slut-GC kan aldrig modsige publicerede gaps.
      const priorStageRows = stageIndex > 0
        ? await loadPriorStageRows({ supabase, raceId: race.id, beforeStageNumber: stageNumber })
        : [];
      ({ resultRows, runs } = buildStageRowsAccumulated({
        race, stagesSorted, stageIndex, entrants, pointsLookup, priorStageRows,
      }));
    } else {
      // Endagsløb (1 etape): buildRaceResults ER allerede én selv-konsistent
      // simulation af præcis denne dag — ingen akkumulering at hente.
      const { resultRows: allRows, runs: allRuns } = buildRaceResults({ race, stages, entrants, pointsLookup });
      resultRows = allRows.filter((r) => r.stage_number === stageNumber);
      runs = allRuns.filter((r) => r.stage_number === stageNumber);
    }

    if (dryRun) {
      const stageWinner = resultRows.find((r) => r.result_type === "stage" && r.rank === 1);
      const gcPodium = resultRows
        .filter((r) => r.result_type === "gc" && r.rank <= 3)
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ rank: r.rank, rider: r.rider_name }));
      return {
        dryRun: true,
        stageNumber, isFinalStage,
        rows: resultRows.length, stages: totalStages, entrants: entrants.length,
        stageWinner: stageWinner ? stageWinner.rider_name : null,
        gcPodium,
      };
    }

    // ── #1598: atomær per-etape-skrivning (counter-bump + race_results delete+insert)
    // i ÉN Postgres-transaktion via apply_stage_result-RPC. Lukker det skarpe crash-
    // vindue #1574 efterlod: et HÅRDT proces-kill mellem counter-bump og result-write
    // på en mellem-etape kunne efterlade stages_completed FORAN tomme race_results.
    // RPC'en committer de tre trin samlet eller ruller ALT tilbage — ingen partial state.
    //
    // FIX 5-lås (uændret prædikat): RPC'en bumper kun stages_completed WHERE
    // stages_completed = stageIndex. To næsten-samtidige runs (dobbelt-klik, eller
    // admin + scheduler) for samme løb beregner begge SAMME stageIndex; kun den FØRSTE
    // vinder. Taberen ser lockWon=false → afbryd FØR standings, så standings/præmier
    // ikke dobbelt-anvendes. status sættes IKKE her (FIX 1: status flippes sidst).
    //
    // resultRows er allerede afgrænset til DENNE etape (linje ~691), og rækkerne har
    // points_earned/prize_money udledt via buildRacePointsLookup — RPC'en persisterer
    // dem 1:1 (samme normaliserede kolonne-mapping som applyRaceResults). Balance-NEUTRAL.
    const { lockWon, rowsImported } = await applyStageResult(supabase, {
      raceId: race.id,
      stageIndex,
      stageNumber,
      totalStages,
      resultRows,
    });
    if (!lockWon) {
      // Konkurrerende run vandt (eller stages_completed er allerede forbi denne etape).
      // RPC'en kørte INGEN side-effekter → sikkert at afbryde uden dobbelt-anvendelse.
      return {
        stageNumber, isFinalStage, skipped: "concurrent_lock_lost",
        rowsImported: 0, rows: 0, entrants: entrants.length, stages: totalStages,
      };
    }
    applied = { rowsImported };

    // Standings-recompute kører EFTER den atomære result-write committer. updateStandings
    // er en fuld re-derivation fra race_results (alle etaper) — inhærent idempotent og
    // self-healing, og var aldrig en del af counter↔results-desync'en. Et crash her
    // efterlader korrekte race_results + counter; en næste afvikling/recompute re-deriverer
    // standings. persistRuns (run-snapshot) er ligeledes additiv enrichment.
    await ensureSeasonStandings(race.season_id);
    await updateStandings(race.season_id, race.id);

    await persistRuns({ supabase, race, runs, source: runSource });

    // #1306 spec 6.4: træthed bygges af DENNE etapes belastning — PRÆCIS ét kald
    // (ikke 1..N: de tidligere etaper akkumulerede deres last i tidligere invokationer).
    try {
      await applyFatigue({ supabase, riderIds: entrants.map((e) => e.rider_id), profileType: thisStage.profile_type });
    } catch (err) {
      console.error(`  ⚠️  race fatigue upsert failed (stage ${stageNumber}, ${thisStage.profile_type}): ${err.message}`);
    }

    // ── Mellem-etape: INGEN finalization. status forbliver scheduled (binær enum). ──
    if (!isFinalStage) {
      return { stageNumber, isFinalStage, rowsImported: applied.rowsImported, rows: resultRows.length, entrants: entrants.length, stages: totalStages };
    }
  }

  // ── FINALIZATION (final-etape ELLER recovery) ───────────────────────────────
  // FIX 1: kør finalization FØR status='completed'. recomputeSeasonRaceDays er idempotent
  // og processBoardWeekend er sikker at gen-køre; et crash her efterlader status != completed
  // → recovery-stien ovenfor genoptager. status flippes KUN hvis finalization lykkes.
  const newRaceDaysCompleted = await recomputeRaceDays({ supabase, seasonId: race.season_id });

  if (seasonBefore?.id) {
    try {
      await processBoardWeekend({
        supabase,
        season: {
          ...seasonBefore,
          race_days_completed: Number.isFinite(Number(newRaceDaysCompleted))
            ? newRaceDaysCompleted
            : seasonBefore.race_days_completed,
        },
        previousRaceDaysCompleted: seasonBefore.race_days_completed ?? null,
        race: { id: race.id, name: race.name },
      });
    } catch (error) {
      console.error("  ⚠️  board weekend update failed after stage simulation:", error.message);
    }
  }

  if (notifyDiscord) {
    try {
      // Embed = HELE løbets race_results (alle etaper) genlæst fra DB, ikke kun
      // final-etapens nybyggede rækker — så GC-vinder + alle etapevindere vises.
      const { data: wholeRaceRows } = await supabase
        .from("race_results")
        .select("result_type, rank, rider_name, stage_number")
        .eq("race_id", race.id);
      // FIX 1: undgå dobbelt-send ved re-finalization. Et discord_sent-flag i admin_log
      // ville kræve en CHECK-constraint-migration (uden for scope); i stedet er denne
      // notifyDiscord-callback selv idempotent (cron-laget de-duper på løb), OG recovery
      // sker kun efter et crash hvor en embed sjældent allerede nåede ud. Vi sender derfor
      // KUN hvis dette IKKE er en recovery-genkørsel — den normale final-etape sender én gang.
      if (!finalizationPending) {
        await notifyDiscord({ race, resultRows: wholeRaceRows || resultRows });
      }
    } catch {
      // Discord-fejl må ikke vælte afviklingen.
    }
  }

  // #1952 · In-app resultat-notifikation til hver deltagende menneske-manager,
  // KUN på den faktiske final-etape (samme finalizationPending-guard som Discord:
  // undgå dobbelt-send ved recovery-genkørsel; notifyUser dedup'er desuden 24t).
  if (notifyInApp && !finalizationPending) {
    try {
      await notifyInApp({ race });
    } catch {
      // In-app notif-fejl må ikke vælte afviklingen.
    }
  }

  // FIX 1: status='completed' sættes SIDST — efter al finalization er lykkedes. Idempotent
  // (en recovery-genkørsel sætter samme værdi). stages_completed sættes også (recovery-sti
  // hvor låsen ikke kørte; normal-sti har allerede sat den via låsen, så dette er en no-op-værdi).
  await supabase
    .from("races")
    .update({ status: "completed", stages_completed: totalStages })
    .eq("id", race.id);

  return {
    stageNumber, isFinalStage,
    rowsImported: applied.rowsImported, rows: resultRows.length,
    entrants: entrants.length, stages: totalStages,
    ...(finalizationPending ? { recovered: true } : {}),
  };
}
