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
//      ungdom/hold-klassementer. EMISSION matcher pcmResultsImport.js PRÆCIST:
//        single        → gc + team
//        mellem-etape  → stage + leader/points_day/mountain_day/young_day (rank 1)
//        slut-etape    → stage + fulde gc/points/mountain/young + team
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
import { simulateStage, stableSeed, ENGINE_VERSION, ABILITY_KEYS } from "./raceSimulator.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { applyRaceFatigue, stageEnteringFatigues } from "./raceFatigue.js";
import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";

// Intern klassements-point (grøn/bjerg) — afgør KUN rækkefølgen i de respektive
// trøje-konkurrencer; selve præmie-pointene kommer fra race_points via rank.
// Top-15 aftagende (samme form som rigtige point/bjerg-konkurrencer). Tunbar ÉT sted.
const CLASSIFICATION_POINTS = Object.freeze([25, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
function classPointsForRank(rank) {
  return CLASSIFICATION_POINTS[rank - 1] || 0;
}

// Bjerg-point uddeles kun på klatre-egnede etaper (KOM-logik).
const CLIMB_PROFILES = new Set(["mountain", "high_mountain", "hilly"]);

// "+M:SS" tids-gab til display (F3). 0 → "+0:00".
function formatGap(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `+${m}:${String(s % 60).padStart(2, "0")}`;
}

// GC: kumulativ tid asc. Tids-ties brydes på countback (sum af etapeplaceringer),
// så etapevinderen leder efter en felt-finish (flad etape: alle gap=0). Til sidst
// rider_id for fuld determinisme.
function rankByCumTimeAsc(entrants, cumTime, posSum) {
  return entrants
    .map((e) => ({
      rider_id: e.rider_id,
      team_id: e.team_id,
      time: cumTime.get(e.rider_id) || 0,
      pos: posSum.get(e.rider_id) || 0,
    }))
    .sort((a, b) =>
      a.time - b.time ||
      a.pos - b.pos ||
      String(a.rider_id).localeCompare(String(b.rider_id))
    )
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

function rankByCompDesc(entrants, compMap) {
  return entrants
    .map((e) => ({ rider_id: e.rider_id, team_id: e.team_id, score: compMap.get(e.rider_id) || 0 }))
    .sort((a, b) => b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id)))
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// Holdklassement: sum af holdets BEDSTE 3 rytteres kumulative tid, lavest vinder.
function teamClassification(entrants, cumTime) {
  const byTeam = new Map();
  for (const e of entrants) {
    if (!e.team_id) continue;
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
    byTeam.get(e.team_id).push(cumTime.get(e.rider_id) || 0);
  }
  const rows = [];
  for (const [team_id, times] of byTeam) {
    times.sort((a, b) => a - b);
    rows.push({ team_id, time: times.slice(0, 3).reduce((s, t) => s + t, 0) });
  }
  return rows
    .sort((a, b) => a.time - b.time || String(a.team_id).localeCompare(String(b.team_id)))
    .map((r, i) => ({ ...r, rank: i + 1 }));
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
  if (!race?.id) throw new Error("race.id kræves");
  if (!stages.length) throw new Error("ingen stage-profiler");
  if (!entrants.length) throw new Error("ingen entrants");

  const isStageRace = race.race_type === "stage_race";
  const stagesSorted = [...stages].sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));

  const cumTime = new Map();
  const posSum = new Map();   // sum af etapeplaceringer → GC-countback-tiebreaker
  const pointsComp = new Map();
  const komComp = new Map();
  const byId = new Map();
  for (const e of entrants) {
    cumTime.set(e.rider_id, 0);
    posSum.set(e.rider_id, 0);
    pointsComp.set(e.rider_id, 0);
    komComp.set(e.rider_id, 0);
    byId.set(e.rider_id, e);
  }
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  const resultRows = [];
  const runs = [];

  const pushIndiv = ({ result_type, rank, rider_id, stage_number, finish_time = null }) => {
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
      team_name: null,
      finish_time,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
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
      team_name: null,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
    });
  };

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
      for (const g of gc) pushIndiv({ result_type: "gc", rank: g.rank, rider_id: g.rider_id, stage_number: 1, finish_time: gcFinish(g) });
      for (const t of teamClassification(entrants, cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: 1 });
      break;
    }

    // ETAPELØB: stage-resultater hver etape.
    for (const r of ranked) {
      pushIndiv({ result_type: "stage", rank: r.rank, rider_id: r.rider_id, stage_number: stageNumber, finish_time: formatGap(r.stageGap) });
    }

    if (!isFinal) {
      // Mellem-etape: trøje-LEDERE (rank 1) for "at holde trøjen".
      const young = rankByCumTimeAsc(entrants.filter((e) => e.is_u25), cumTime, posSum);
      const pointsCls = rankByCompDesc(entrants, pointsComp);
      const komCls = rankByCompDesc(entrants, komComp);
      if (gc[0]) pushIndiv({ result_type: "leader", rank: 1, rider_id: gc[0].rider_id, stage_number: stageNumber });
      if (pointsCls[0]) pushIndiv({ result_type: "points_day", rank: 1, rider_id: pointsCls[0].rider_id, stage_number: stageNumber });
      if (komCls[0]) pushIndiv({ result_type: "mountain_day", rank: 1, rider_id: komCls[0].rider_id, stage_number: stageNumber });
      if (young[0]) pushIndiv({ result_type: "young_day", rank: 1, rider_id: young[0].rider_id, stage_number: stageNumber });
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

// #1307: per-hold autopick. For hvert egnet hold (ikke test/frosset) UDEN entries
// for løbet: assistenten udtager 6-8 bedst egnede + kaptajn (spec 8.1 — "vælger du
// ikke, vælger assistenten fornuftigt; ingen straf for fravær"). Hold MED entries
// (manager-udtagne) røres ikke. Skadede (injured_until >= i dag) udelades (#1306 6.5).
async function fillMissingTeamEntries({ supabase, race, stages, existingEntries, persist = true }) {
  const { data: teams, error: teamErr } = await supabase
    .from("teams")
    .select("id, is_test_account, is_frozen")
    .or("is_test_account.is.null,is_test_account.eq.false");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  const teamsWithEntries = new Set((existingEntries || []).map((e) => e.team_id));
  const missingTeamIds = (teams || [])
    .filter((t) => !t.is_frozen && !teamsWithEntries.has(t.id))
    .map((t) => t.id);
  if (!missingTeamIds.length) return [];

  const { data: riders, error: riderErr } = await selectInChunks({
    supabase, table: "riders", columns: "id, team_id",
    inColumn: "team_id", ids: missingTeamIds,
    extra: (q) => q.or("is_retired.is.null,is_retired.eq.false"),
  });
  if (riderErr) throw new Error(`riders: ${riderErr.message}`);

  // Spec 6.5 (#1306): skadede ryttere (injured_until >= i dag) må ikke auto-fyldes i startfeltet.
  const todayStr = copenhagenDateString();
  const { data: injured, error: injErr } = await supabase
    .from("rider_condition")
    .select("rider_id")
    .gte("injured_until", todayStr);
  if (injErr) throw new Error(`rider_condition (injured): ${injErr.message}`);
  const injuredIds = new Set((injured || []).map((r) => r.rider_id));
  const candidates = (riders || []).filter((r) => !injuredIds.has(r.id));
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
  for (const [teamId, teamRiders] of byTeam) {
    for (const pick of autopickTeamSelection({ riders: teamRiders, stages, sizeRule })) {
      rows.push({ race_id: race.id, rider_id: pick.rider_id, team_id: teamId, race_role: pick.race_role, is_auto_filled: true });
    }
  }

  if (persist && rows.length) {
    const { error: insErr } = await supabase.from("race_entries").insert(rows);
    if (insErr) throw new Error(`race_entries insert: ${insErr.message}`);
  }
  return rows.map((r) => ({ rider_id: r.rider_id, team_id: r.team_id, race_role: r.race_role }));
}

// Indlæs startfeltet (race_entries → per-hold autopick for hold UDEN entries) beriget
// med navn, is_u25, abilities + race_role. Hold MED manager-udtagne entries røres ikke.
// persist=false (#1102 dryRun): auto-fill beregnes i hukommelsen — ingen DB-insert.
// stages bruges af autopick til egnethedsscore (suitabilityScore pr. terrain).
export async function loadEntrantsForRace({ supabase, race, stages = [], persist = true }) {
  const { data: existing, error } = await supabase
    .from("race_entries")
    .select("rider_id, team_id, race_role")
    .eq("race_id", race.id);
  if (error) throw new Error(`race_entries: ${error.message}`);

  const existingEntries = existing || [];
  // #1307: autopick for hold UDEN entries — ALTID kaldt (ikke kun når feltets tomt).
  // Returnerer kun nyindsat; hold med eksisterende entries røres ikke.
  const autopicked = await fillMissingTeamEntries({ supabase, race, stages, existingEntries, persist });
  const entries = [...existingEntries, ...autopicked];
  if (!entries.length) return [];

  const teamByRider = new Map(entries.map((e) => [e.rider_id, e.team_id]));
  const roleByRider = new Map(entries.map((e) => [e.rider_id, e.race_role]));
  const riderIds = entries.map((e) => e.rider_id);

  const { data: riders, error: rErr } = await selectInChunks({
    supabase, table: "riders", columns: "id, firstname, lastname, is_u25",
    inColumn: "id", ids: riderIds,
  });
  if (rErr) throw new Error(`riders: ${rErr.message}`);

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

  const entrants = [];
  for (const r of riders || []) {
    const ab = abilityByRider.get(r.id);
    if (!ab) continue; // uden abilities kan rytteren ikke scores → udelad (defensivt)
    const entrant = {
      rider_id: r.id,
      team_id: teamByRider.get(r.id) ?? null,
      rider_name: [r.firstname, r.lastname].filter(Boolean).join(" ") || null,
      is_u25: !!r.is_u25,
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

async function persistRuns({ supabase, race, runs }) {
  if (!runs.length) return;
  const rows = runs.map((r) => ({
    race_id: race.id,
    stage_number: r.stage_number,
    seed: r.seed,
    engine_version: r.engine_version,
    entrant_snapshot: r.entrant_snapshot,
    input_checksum: r.input_checksum,
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
  applyFatigue = applyRaceFatigue,
}) {
  if (!supabase?.from) throw new Error("supabase client kræves");
  if (!race?.id || !race?.season_id) throw new Error("race {id, season_id} kræves");

  // #1187 · race_days_completed FØR afviklingen — checkpoint-udgangspunkt for
  // board-weekend-wiring nedenfor. Defensiv: manglende række → null (ingen
  // checkpoint-evaluering, satisfaction opdateres stadig).
  const { data: seasonBefore } = await supabase
    .from("seasons")
    .select("id, number, status, race_days_completed, race_days_total")
    .eq("id", race.season_id)
    .maybeSingle();

  const stages = await loadStageProfiles(supabase, race.id);
  if (!stages.length) throw new Error(`Ingen race_stage_profiles for løb ${race.id} — kør backfill`);

  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: !dryRun });
  if (!entrants.length) throw new Error(`Intet startfelt for løb ${race.id}`);

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
      console.error(`  ⚠️  race fatigue upsert fejlede (etape ${stage.stage_number}, ${stage.profile_type}): ${err.message}`);
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

  return {
    rowsImported: applied.rowsImported,
    rows: resultRows.length,
    stages: stages.length,
    entrants: entrants.length,
    runs: runs.length,
  };
}
