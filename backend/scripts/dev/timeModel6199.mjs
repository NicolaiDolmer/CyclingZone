// #6199 + #6200: maaling af tidsmodellen (stigning + nedkoersel) pr. regel-revision.
//
// Fire maalinger, alle READ-ONLY og deterministiske (ingen DB):
//  1. Replay-ankre paa to genskabte etaper fra loebet i #6199 (det anonymiserede
//     Giro-felt fra #6088 som felt, ingen navne eller id'er; prod-eksporten er
//     ikke i repoet, saa rutens kendte kendetegn genskabes):
//       - "uphill": rullende etape med maal paa en kat. 3 (5,8 km a 5,8 %).
//       - "descent": tre kat. 1 og 8 km nedkoersel til maal.
//  2. Scorecardets to tidsankre paa samme felt/seeds som v4FlipReadiness
//     (bjergetape nr. 10, kort afslutning opad nr. 10/30/50).
//  3. Hale-gaten (ren p90) paa bjerg/hoejbjerg, samme seeds som scorecardet.
//  4. #5951's tidsdel: andel indhentede udbrydere over 10 min efter feltet.
// Tal skrives kun til stdout/--out (balance-internals/, gitignoreret).
//
// Koer:
//   node backend/scripts/dev/timeModel6199.mjs [--rules=orders_gc_v2,orders_gc_v3] [--seeds=8] [--only=replay,anchors,giro,tail,break] [--out=balance-internals/6199/x.json]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture } from "./giroCaptainTimeLoss6088.mjs";
import { standingsBefore } from "./ownRiderAhead6187.mjs";
import { isShortUphillFinish } from "../lib/headToHeadAnchors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");

export function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function round1(x) {
  return x === null || x === undefined ? null : Math.round(x * 10) / 10;
}

// ── Genskabte etaper (kun rutens kendetegn, ingen prod-data) ─────────────────

function climbSeg(fromKm, toKm, category, gradient, topM) {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category, avg_gradient: gradient, top_elevation_m: topM };
}

/** Rullende etape med maal paa en kat. 3 (5,8 km a 5,8 %), to smaa bakker undervejs. */
export function uphillReplayProfile() {
  const segments = [
    { kind: "flat", from_km: 0, to_km: 40 },
    { kind: "rolling", from_km: 40, to_km: 68 },
    climbSeg(68, 70, "4", 4.5, 420),
    { kind: "descent", from_km: 70, to_km: 73, technicality: 2 },
    { kind: "rolling", from_km: 73, to_km: 112 },
    climbSeg(112, 115.5, "3", 5.0, 610),
    { kind: "descent", from_km: 115.5, to_km: 120, technicality: 2 },
    { kind: "rolling", from_km: 120, to_km: 154.2 },
    climbSeg(154.2, 160, "3", 5.8, 720),
  ];
  return {
    id: "r6199-uphill", race_id: "race-6199", stage_number: 2, profile_type: "rolling", finale_type: "reduced_sprint",
    demand_vector: { flat: 0.12, punch: 0.12, tempo: 0.08, sprint: 0.08, tactics: 0.06, climbing: 0.04, recovery: 0.04, endurance: 0.18, randomness: 0.2, positioning: 0.08 },
    distance_km: 160, elevation_gain_m: 1500,
    climbs: [
      { category: "4", crest_km: 70, length_km: 2, avg_gradient: 4.5, summit_finish: false },
      { category: "3", crest_km: 115.5, length_km: 3.5, avg_gradient: 5.0, summit_finish: false },
      { category: "3", crest_km: 160, length_km: 5.8, avg_gradient: 5.8, summit_finish: true },
    ],
    sprints: [{ km: 95, kind: "intermediate" }, { km: 160, kind: "finish" }],
    sectors: [], segments, weather: { kind: "sun", wind_exposure: 0.3 },
  };
}

/** Bjergetape med tre kat. 1 og 8 km nedkoersel til maal. */
export function descentReplayProfile() {
  const segments = [
    { kind: "rolling", from_km: 0, to_km: 38 },
    climbSeg(38, 49, "1", 6.8, 1650),
    { kind: "descent", from_km: 49, to_km: 62, technicality: 2 },
    { kind: "rolling", from_km: 62, to_km: 84 },
    climbSeg(84, 96, "1", 7.0, 1800),
    { kind: "descent", from_km: 96, to_km: 110, technicality: 3 },
    { kind: "rolling", from_km: 110, to_km: 136 },
    climbSeg(136, 147, "1", 7.2, 1750),
    { kind: "descent", from_km: 147, to_km: 155, technicality: 2 },
  ];
  return {
    id: "r6199-descent", race_id: "race-6199", stage_number: 5, profile_type: "mountain", finale_type: "descent",
    demand_vector: { punch: 0.04, tempo: 0.12, tactics: 0.02, climbing: 0.5, recovery: 0.06, endurance: 0.14, randomness: 0.1, positioning: 0.02 },
    distance_km: 155, elevation_gain_m: 3900,
    climbs: [
      { category: "1", crest_km: 49, length_km: 11, avg_gradient: 6.8, summit_finish: false },
      { category: "1", crest_km: 96, length_km: 12, avg_gradient: 7.0, summit_finish: false },
      { category: "1", crest_km: 147, length_km: 11, avg_gradient: 7.2, summit_finish: false },
    ],
    sprints: [{ km: 72, kind: "intermediate" }, { km: 155, kind: "finish" }],
    sectors: [], segments, weather: { kind: "sun", wind_exposure: 0.3 },
  };
}

function fixtureEntrants(data, inRace) {
  const aiByTeam = new Map(data.teams.map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  return data.entries.filter((e) => abilitiesById.has(e.rider_id) && (!inRace || inRace.has(e.rider_id))).map((e) => {
    const { rider_id: _r, ...abilities } = abilitiesById.get(e.rider_id);
    return { rider_id: e.rider_id, team_id: e.team_id ?? null, team_is_ai: aiByTeam.get(e.team_id) === true, race_role: e.race_role ?? null, effort: "normal", abilities };
  });
}

/** Tidsafstand til vinderen for nr. 10/30/50 i en resultatliste. */
export function gapsAtRanks(results, ranks = [10, 30, 50]) {
  const times = results.filter((r) => r.status === "finished").map((r) => r.time_seconds).sort((a, b) => a - b);
  const out = {};
  for (const n of ranks) out[n] = times.length >= n ? times[n - 1] - times[0] : null;
  return out;
}

function snapshotAt(snapshots, km) {
  let hit = null;
  for (const s of snapshots ?? []) if (s.km <= km + 1e-6) hit = s;
  return hit;
}

/** Nedkoerselsfinalen: hvem var foerst over sidste top, hvor endte vinderen, hvor meget lukkede nedkoerslen. */
export function descentFinaleStats(out, lastCrestKm) {
  const fin = out.results.filter((r) => r.status === "finished").sort((a, b) => a.rank - b.rank);
  const rankOf = new Map(fin.map((r) => [r.rider_id, r.rank]));
  const lastKom = (out.passages ?? []).filter((p) => p.kind === "kom").sort((a, b) => b.km - a.km)[0];
  const firstOver = lastKom?.results?.find((r) => r.passage_rank === 1)?.rider_id ?? null;
  const snap = snapshotAt(out.groupSnapshots, lastCrestKm);
  const groups = [...(snap?.groups ?? [])].sort((a, b) => a.gap_seconds - b.gap_seconds);
  const lead = groups[0]?.rider_ids ?? [];
  const winner = fin[0]?.rider_id ?? null;
  const crestGapOf = new Map();
  for (const g of groups) for (const id of g.rider_ids) crestGapOf.set(id, g.gap_seconds);
  const winT = fin[0]?.time_seconds ?? 0;
  // Hvor meget af hullet ved toppen der er lukket ved maal, for ryttere bag toppens forreste gruppe der kom med i top 10.
  let closedMax = 0;
  for (const r of fin.slice(0, 10)) {
    const crest = crestGapOf.get(r.rider_id);
    if (crest === undefined || crest <= 0) continue;
    closedMax = Math.max(closedMax, crest - (r.time_seconds - winT));
  }
  return {
    firstOverFinishRank: firstOver ? rankOf.get(firstOver) ?? null : null,
    winnerInLeadOverTop: winner ? lead.includes(winner) : false,
    leadSizeOverTop: lead.length,
    within20s: fin.filter((r) => r.time_seconds - winT <= 20).length,
    descentClosedMaxTop10: closedMax,
  };
}

export function runReplay({ v4, data, revisions, seeds }) {
  const stages = data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
  const standings = standingsBefore({ v4, data, stageNumber: 7 });
  const inRace = new Set(standings.map((s) => s.rider_id));
  const entrants = fixtureEntrants(data, inRace);
  const profiles = { uphill: uphillReplayProfile(), descent: descentReplayProfile() };
  const result = {};
  for (const rules of revisions) {
    const row = {};
    for (const [name, profile] of Object.entries(profiles)) {
      const per = [];
      for (let s = 1; s <= seeds; s++) {
        const out = v4.simulateStage({
          entrants, stageProfile: profile, seedString: `race-6199:${name}:r${s}`, stageNumber: profile.stage_number,
          teamOrderRows: [], isStageRace: true, raceStages: [...stages, profile], squad: data.race.squad ?? null,
          rulesRevision: rules, gcStandings: standings,
        }).v4Output;
        const gaps = gapsAtRanks(out.results);
        per.push(name === "descent" ? { ...gaps, ...descentFinaleStats(out, 147) } : gaps);
      }
      const agg = { n10: round1(median(per.map((p) => p[10]))), n30: round1(median(per.map((p) => p[30]))), n50: round1(median(per.map((p) => p[50]))) };
      if (name === "descent") {
        agg.firstOverFinishRankMedian = median(per.map((p) => p.firstOverFinishRank));
        agg.winnerInLeadOverTopShare = per.filter((p) => p.winnerInLeadOverTop).length / per.length;
        agg.within20sMedian = median(per.map((p) => p.within20s));
        agg.descentClosedMaxTop10Median = round1(median(per.map((p) => p.descentClosedMaxTop10)));
      }
      row[name] = agg;
    }
    result[rules] = row;
  }
  return result;
}

// ── Scorecardets tidsankre (samme felt/seeds som v4FlipReadiness) ────────────

// Samme klassifikation som scorecardets anker (headToHeadAnchors.isShortUphillFinish).
export { isShortUphillFinish };

export async function runAnchors({ revisions, seeds = ["s1", "s2", "s3", "s4", "s5"] }) {
  const { simulateStageV4 } = await import("../../lib/engine/v4/index.ts");
  const { RACE_V4_TUNING } = await import("../../lib/engine/v4/tuning.ts");
  const { routeFromStageProfileRow } = await import("../../lib/engine/v4/adapters/routeAdapter.ts");
  const { v4EntrantsFromPopulation } = await import("../headToHeadV4.js");
  const { sampleField } = await import("../lib/headToHeadStats.js");
  const { makeRng } = await import("../../lib/fictionalRiderGenerator.js");
  const { stableSeed } = await import("../../lib/raceSimulator.js");
  const { POPULATION_FILE, STAGES_FILE, FIELD_SIZE } = await import("../v4FlipReadiness.mjs");
  const population = JSON.parse(readFileSync(path.join(REPO_ROOT, POPULATION_FILE), "utf8"));
  const sf = JSON.parse(readFileSync(path.join(REPO_ROOT, STAGES_FILE), "utf8"));
  const all = Array.isArray(sf) ? sf : sf.stages;
  const pick = all.map((row) => ({ row, route: routeFromStageProfileRow(row) }));
  const mountain = pick.filter(({ route }) => (route.profile_type === "mountain" || route.profile_type === "high_mountain") && route.finale_type === "long_climb");
  const shortUp = pick.filter(({ route }) => isShortUphillFinish(route));
  const wanted = new Set([...mountain, ...shortUp].map((x) => x.row));
  const result = {};
  for (const rules of revisions) {
    const mt = [];
    const mtGc = [];
    const su = { 10: [], 30: [], 50: [] };
    for (const seed of seeds) {
      for (const { row, route } of pick) {
        if (!wanted.has(row)) continue;
        const stageSeedStr = `${seed}:${row.stage_number ?? 1}`;
        const field = sampleField(makeRng(stableSeed(`${stageSeedStr}:field`)), population.riders, FIELD_SIZE);
        const out = simulateStageV4({ route, startlist: v4EntrantsFromPopulation(field), orders: [], seed: stageSeedStr, tuning: RACE_V4_TUNING, ...(rules === "legacy" ? {} : { rules_revision: rules }) });
        const gaps = gapsAtRanks(out.results.map((r) => ({ ...r, status: "finished" })));
        if (mountain.some((m) => m.row === row)) {
          mt.push(gaps[10]);
          if (!escapeWon(out)) mtGc.push(gaps[10]);
        }
        if (shortUp.some((m) => m.row === row)) for (const n of [10, 30, 50]) su[n].push(gaps[n]);
      }
    }
    const mean = (xs) => xs.filter(Number.isFinite).reduce((a, b) => a + b, 0) / Math.max(1, xs.filter(Number.isFinite).length);
    result[rules] = {
      mountainTop10Mean: round1(mean(mt)), mountainN: mt.length,
      mountainTop10GcDecidedMean: round1(mean(mtGc)), mountainGcDecidedN: mtGc.length,
      shortUphill: { n10: round1(mean(su[10])), n30: round1(mean(su[30])), n50: round1(mean(su[50])), n: su[10].length },
    };
  }
  return result;
}

export async function runTail({ revisions }) {
  const { runTailSpread, evaluateTailGate } = await import("../v4TailSpread.js");
  const { POPULATION_FILE, STAGES_FILE, FIELD_SIZE, TAIL_GATE_SEEDS } = await import("../v4FlipReadiness.mjs");
  const population = JSON.parse(readFileSync(path.join(REPO_ROOT, POPULATION_FILE), "utf8"));
  const sf = JSON.parse(readFileSync(path.join(REPO_ROOT, STAGES_FILE), "utf8"));
  const stages = (Array.isArray(sf) ? sf : sf.stages).filter((s) => s.profile_type === "mountain" || s.profile_type === "high_mountain" || s.profile_type === "flat");
  const result = {};
  for (const rules of revisions) {
    const gate = evaluateTailGate(runTailSpread({ population, stages, seeds: TAIL_GATE_SEEDS, fieldSize: FIELD_SIZE, rulesRevision: rules === "legacy" ? undefined : rules }));
    result[rules] = Object.fromEntries(gate.gatedRows.map((r) => [r.profileType, { value: round1(r.value * 100) / 100, status: r.status }]));
  }
  return result;
}

/** Vandt dagens udbrud (vinderen sad i morgenudbruddet og blev aldrig hentet)? */
export function escapeWon(out) {
  const formed = new Set(out.timeline.events.filter((e) => e.type === "breakaway_formed").flatMap((e) => e.params?.rider_ids ?? []));
  const caught = new Set(out.timeline.events.filter((e) => e.type === "breakaway_caught").flatMap((e) => e.params?.rider_ids ?? []));
  const winner = [...out.results].filter((r) => r.status === "finished").sort((a, b) => a.time_seconds - b.time_seconds)[0]?.rider_id;
  return winner !== undefined && formed.has(winner) && !caught.has(winner);
}

/**
 * Bjergetaperne i det rigtige felt (Giro-fixturet, med holdordrer og
 * klassement foer etape 11, koert under samme revision): nr. 10 til vinderen,
 * samlet og for etaper hvor udbruddet ikke vandt.
 */
export function runGiroMountain({ v4, data, revisions, seeds }) {
  const stages = data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
  const targets = stages.filter((p) => (p.profile_type === "mountain" || p.profile_type === "high_mountain") && p.finale_type === "long_climb");
  const result = {};
  for (const rules of revisions) {
    const standings = standingsBefore({ v4, data, stageNumber: 11, rules });
    const inRace = new Set(standings.map((s) => s.rider_id));
    const entrants = fixtureEntrants(data, inRace);
    const all = [];
    const gc = [];
    let escapeWins = 0;
    for (let s = 1; s <= seeds; s++) {
      for (const profile of targets) {
        const out = v4.simulateStage({
          entrants, stageProfile: profile, seedString: `${data.race.id}:${profile.stage_number}:m6199-${s}`, stageNumber: profile.stage_number,
          teamOrderRows: data.orders, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null,
          rulesRevision: rules, gcStandings: standings,
        }).v4Output;
        const n10 = gapsAtRanks(out.results)[10];
        all.push(n10);
        if (escapeWon(out)) escapeWins += 1;
        else gc.push(n10);
      }
    }
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    result[rules] = { n10Mean: round1(mean(all)), n10Median: round1(median(all)), gcDecidedN10Mean: round1(mean(gc)), escapeWins, n: all.length };
  }
  return result;
}

/** #5951: andel indhentede udbrydere der kommer mere end 10 min efter feltet (stoerste gruppe paa samme tid). */
export function caughtEscapeeLate(out, thresholdSeconds = 600) {
  const formed = new Set(out.timeline.events.filter((e) => e.type === "breakaway_formed").flatMap((e) => e.params?.rider_ids ?? []));
  const caught = new Set(out.timeline.events.filter((e) => e.type === "breakaway_caught").flatMap((e) => e.params?.rider_ids ?? []).filter((id) => formed.has(id)));
  const fin = out.results.filter((r) => r.status === "finished");
  const byTime = new Map();
  for (const r of fin) {
    const k = Math.round(r.time_seconds);
    byTime.set(k, (byTime.get(k) ?? 0) + 1);
  }
  let fieldT = null;
  let best = 0;
  for (const [t, n] of byTime) if (n > best || (n === best && t < fieldT)) { best = n; fieldT = t; }
  let late = 0;
  let total = 0;
  for (const r of fin) {
    if (!caught.has(r.rider_id)) continue;
    total += 1;
    if (r.time_seconds - fieldT > thresholdSeconds) late += 1;
  }
  return { late, total };
}

export function runBreakLate({ v4, data, revisions, seeds }) {
  const stages = data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number).filter((p) => !["itt", "itt_hilly", "ttt"].includes(p.profile_type));
  const entrants = fixtureEntrants(data);
  const result = {};
  for (const rules of revisions) {
    let late = 0;
    let total = 0;
    for (let s = 1; s <= seeds; s++) {
      for (const profile of stages) {
        const out = v4.simulateStage({
          entrants, stageProfile: profile, seedString: `${data.race.id}:${profile.stage_number}:b5951-${s}`, stageNumber: profile.stage_number,
          teamOrderRows: data.orders, isStageRace: true, raceStages: data.profiles, squad: data.race.squad ?? null,
          rulesRevision: rules, gcStandings: null,
        }).v4Output;
        const r = caughtEscapeeLate(out);
        late += r.late;
        total += r.total;
      }
    }
    result[rules] = { late, total, share: total ? Math.round((late / total) * 1000) / 10 : null };
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : fallback;
  };
  const revisions = arg("rules", "orders_gc_v2,orders_gc_v3").split(",");
  const seeds = Number(arg("seeds", "8"));
  const only = new Set(arg("only", "replay,anchors,giro,tail,break").split(","));
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const data = loadFixture();
  const out = {};
  if (only.has("replay")) out.replay = runReplay({ v4, data, revisions, seeds });
  if (only.has("anchors")) out.anchors = await runAnchors({ revisions });
  if (only.has("giro")) out.giroMountain = runGiroMountain({ v4, data, revisions, seeds: Math.min(seeds, 4) });
  if (only.has("tail")) out.tail = await runTail({ revisions });
  if (only.has("break")) out.breakLate = runBreakLate({ v4, data, revisions, seeds: Math.min(seeds, 3) });
  const text = JSON.stringify(out, null, 2);
  console.log(text);
  const file = arg("out", null);
  if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
}
