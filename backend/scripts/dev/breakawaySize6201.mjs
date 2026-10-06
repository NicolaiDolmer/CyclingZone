// #6201: maaling af morgenudbruddets stoerrelse pr. etapeprofil, pr. regel-revision.
//
// Ejer-beslutning 5/10 (#6201): trappen pr. profil (flad < kuperet/rullende <
// bjerg/hoejfjeld), AI-hold uden klassementschance sender en klatrer paa bjerg,
// og farten foelger antallet (1-3 mand holder sjaeldnere hjem end 6+).
//
// To kilder, begge READ-ONLY og deterministiske (ingen DB):
//  - "proxy": scorecardets pinnede population + proxy-etaper (samme felt 180 og
//    seeds som v4FlipReadiness), med AI-ordrer for ALLE hold bygget gennem
//    prod-adapterens egen vej (buildStageOrderPlan) under den maalte revision.
//  - "giro": det anonymiserede Giro-felt fra #6088 (rigtige roller og
//    holdordrer, en blanding af menneske- og AI-hold), klassement foer hver
//    etape koert i raekkefoelge under samme revision.
//
// Pr. profilgruppe: antal etaper, median og typisk spaend (p10-p90) af
// udbruddets stoerrelse (0 = intet udbrud), max, andel 0-2 mand, andel paa
// loftet, og hvor ofte udbruddet holder hjem pr. stoerrelse (1-3, 4-5, 6+).
// Tal skrives kun til stdout/--out (balance-internals/, gitignoreret; hard rule 17).
//
// Koer:
//   node backend/scripts/dev/breakawaySize6201.mjs [--rules=orders_gc_v2,orders_gc_v3] [--seeds=s1,s2,s3] [--mode=proxy|giro|scorecard|both|all] [--out=balance-internals/6201/x.md]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");

export const PROFILE_GROUPS = Object.freeze({
  flat: ["flat"],
  hilly_rolling: ["hilly", "rolling"],
  mountain: ["mountain", "high_mountain"],
  cobbles_classic: ["cobbles", "classic", "gravel"],
});
const TIME_TRIALS = new Set(["itt", "itt_hilly", "ttt"]);

export function groupOf(profileType) {
  for (const [group, types] of Object.entries(PROFILE_GROUPS)) if (types.includes(profileType)) return group;
  return "other";
}

export function quantile(xs, q) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/**
 * Morgenudbruddet i én etapes tidslinje: stoerrelse ved dannelsen (0 = intet),
 * antal forsoeg, og om gruppen holdt hjem (breakaway_survived paa sidste segment).
 */
export function morningBreakOf(events) {
  const formed = events.find((e) => e.type === "breakaway_formed");
  const attempt = events.find((e) => e.type === "breakaway_attempt");
  const attempts = attempt ? (attempt.params?.rider_ids ?? []).length : null;
  if (!formed) return { size: 0, attempts, survived: false };
  const groupId = formed.params?.group_id;
  const survived = events.some((e) => e.type === "breakaway_survived" && e.params?.group_id === groupId);
  return { size: (formed.params?.rider_ids ?? []).length, attempts, survived };
}

export function summarize(samples) {
  const byGroup = {};
  for (const s of samples) (byGroup[s.group] ??= []).push(s);
  const out = {};
  for (const [group, list] of Object.entries(byGroup)) {
    const sizes = list.map((s) => s.size);
    const max = Math.max(...sizes);
    const bucket = (lo, hi) => {
      const xs = list.filter((s) => s.size >= lo && s.size <= hi);
      return { n: xs.length, survived: xs.filter((s) => s.survived).length };
    };
    out[group] = {
      stages: list.length,
      median: quantile(sizes, 0.5),
      p10: quantile(sizes, 0.1),
      p25: quantile(sizes, 0.25),
      p75: quantile(sizes, 0.75),
      p90: quantile(sizes, 0.9),
      max,
      share0to2: list.filter((s) => s.size <= 2).length / list.length,
      atMax: list.filter((s) => s.size === max).length / list.length,
      attemptsMedian: quantile(list.map((s) => s.attempts).filter((a) => a !== null), 0.5),
      survive1to3: bucket(1, 3),
      survive4to5: bucket(4, 5),
      survive6plus: bucket(6, 99),
      histogram: Object.fromEntries([...new Set(sizes)].sort((a, b) => a - b).map((k) => [k, sizes.filter((x) => x === k).length])),
    };
  }
  return out;
}

async function engine() {
  const { simulateStageV4 } = await import("../../lib/engine/v4/index.ts");
  const { RACE_V4_TUNING } = await import("../../lib/engine/v4/tuning.ts");
  const { routeFromStageProfileRow } = await import("../../lib/engine/v4/adapters/routeAdapter.ts");
  const { buildStageOrderPlan } = await import("../../lib/engine/v4/orders/teamOrdersAdapter.ts");
  const { v4EntrantsFromPopulation, buildRaceContexts } = await import("../headToHeadV4.js");
  const { assignFieldRoles } = await import("../lib/headToHeadOrders.js");
  const { sampleField } = await import("../lib/headToHeadStats.js");
  const { makeRng } = await import("../../lib/fictionalRiderGenerator.js");
  const { stableSeed } = await import("../../lib/raceSimulator.js");
  const { POPULATION_FILE, STAGES_FILE, FIELD_SIZE } = await import("../v4FlipReadiness.mjs");
  return { simulateStageV4, RACE_V4_TUNING, routeFromStageProfileRow, buildStageOrderPlan, v4EntrantsFromPopulation, buildRaceContexts, assignFieldRoles, sampleField, makeRng, stableSeed, POPULATION_FILE, STAGES_FILE, FIELD_SIZE };
}

export const TEAMS_PER_FIELD = 22;
export const RIDERS_PER_TEAM = 8;

/** Populationens hold med mindst RIDERS_PER_TEAM ryttere, sorteret (deterministisk). */
export function teamsOf(riders) {
  const byTeam = new Map();
  for (const r of riders) {
    if (!r.team_id) continue;
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push(r);
  }
  return [...byTeam.entries()]
    .filter(([, list]) => list.length >= RIDERS_PER_TEAM)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([, list]) => list.sort((a, b) => String(a.id).localeCompare(String(b.id))));
}

function pickK(rng, list, k) {
  const pool = [...list];
  const out = [];
  while (out.length < k && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/**
 * Et startfelt som et rigtigt etapeloeb: TEAMS_PER_FIELD hold med RIDERS_PER_TEAM
 * ryttere hver (scorecardets eget sample traekker enkeltryttere fra hele
 * populationen, saa et hold sjaeldent har mere end én mand og alle bliver fri
 * rolle; det kan ikke maale AI-holdenes udbrudsforsoeg).
 */
export function teamField(rng, teams) {
  return pickK(rng, teams, TEAMS_PER_FIELD).flatMap((team) => pickK(rng, team, RIDERS_PER_TEAM));
}

/** Proxy-etaperne med AI-ordrer for alle hold under `rules` (prod-adapterens vej). */
export async function runProxy({ revisions, seeds }) {
  const e = await engine();
  const population = JSON.parse(readFileSync(path.join(REPO_ROOT, e.POPULATION_FILE), "utf8"));
  const sf = JSON.parse(readFileSync(path.join(REPO_ROOT, e.STAGES_FILE), "utf8"));
  const stages = (Array.isArray(sf) ? sf : sf.stages).filter((s) => !TIME_TRIALS.has(s.profile_type));
  const contexts = e.buildRaceContexts(stages);
  const teams = teamsOf(population.riders);
  const result = {};
  for (const rules of revisions) {
    const samples = [];
    for (const seed of seeds) {
      for (const row of stages) {
        const stageSeedStr = `${seed}:${row.stage_number ?? 1}`;
        const field = teamField(e.makeRng(e.stableSeed(`${stageSeedStr}:field`)), teams);
        const route = e.routeFromStageProfileRow(row);
        const roles = e.assignFieldRoles(field);
        const plan = e.buildStageOrderPlan({
          rows: [],
          stageNumber: 1,
          roster: field.map((r) => ({ team_id: r.team_id ?? null, rider_id: r.id, role: roles.get(r.id) ?? "free_role", is_ai: true, abilities: r.abilities })),
          context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, race: contexts.get(row), ...(rules === "legacy" ? {} : { rules_revision: rules }) },
        });
        const out = e.simulateStageV4({
          route,
          startlist: e.v4EntrantsFromPopulation(field, roles, plan.aiEffortByRider),
          orders: plan.orders,
          seed: stageSeedStr,
          tuning: e.RACE_V4_TUNING,
          ...(rules === "legacy" ? {} : { rules_revision: rules }),
        });
        samples.push({ group: groupOf(route.profile_type), profile: route.profile_type, ...morningBreakOf(out.timeline.events) });
      }
    }
    result[rules] = summarize(samples);
  }
  return result;
}

/** Scorecardets egne betingelser (v4FlipReadiness): felt 180 fra hele populationen, ingen ordrer. */
export async function runScorecard({ revisions, seeds }) {
  const e = await engine();
  const population = JSON.parse(readFileSync(path.join(REPO_ROOT, e.POPULATION_FILE), "utf8"));
  const sf = JSON.parse(readFileSync(path.join(REPO_ROOT, e.STAGES_FILE), "utf8"));
  const stages = (Array.isArray(sf) ? sf : sf.stages).filter((s) => !TIME_TRIALS.has(s.profile_type));
  const result = {};
  for (const rules of revisions) {
    const samples = [];
    for (const seed of seeds) {
      for (const row of stages) {
        const stageSeedStr = `${seed}:${row.stage_number ?? 1}`;
        const field = e.sampleField(e.makeRng(e.stableSeed(`${stageSeedStr}:field`)), population.riders, e.FIELD_SIZE);
        const route = e.routeFromStageProfileRow(row);
        const out = e.simulateStageV4({ route, startlist: e.v4EntrantsFromPopulation(field), orders: [], seed: stageSeedStr, tuning: e.RACE_V4_TUNING, ...(rules === "legacy" ? {} : { rules_revision: rules }) });
        samples.push({ group: groupOf(route.profile_type), profile: route.profile_type, ...morningBreakOf(out.timeline.events) });
      }
    }
    result[rules] = summarize(samples);
  }
  return result;
}

/** Giro-feltet (#6088): rigtige roller og ordrer, klassement foer hver etape. */
export async function runGiro({ revisions, seeds }) {
  const { loadFixture } = await import("./giroCaptainTimeLoss6088.mjs");
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const data = loadFixture();
  const stages = data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
  const aiByTeam = new Map(data.teams.map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  const entrantsOf = (inRace) => data.entries.filter((en) => abilitiesById.has(en.rider_id) && inRace.has(en.rider_id)).map((en) => {
    const { rider_id: _r, ...abilities } = abilitiesById.get(en.rider_id);
    return { rider_id: en.rider_id, team_id: en.team_id ?? null, team_is_ai: aiByTeam.get(en.team_id) === true, race_role: en.race_role ?? null, effort: "normal", abilities };
  });
  const sim = (st, rules, inRace, standings, tag) => v4.simulateStage({
    entrants: entrantsOf(inRace), stageProfile: stages.find((p) => p.stage_number === st), seedString: `${data.race.id}:${st}:${tag}`, stageNumber: st,
    teamOrderRows: data.orders, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null, rulesRevision: rules, gcStandings: standings,
  }).v4Output;
  const result = {};
  for (const rules of revisions) {
    // Klassement foer hver etape: etaperne i raekkefoelge med ét fast seed.
    const before = new Map();
    let inRace = new Set(data.entries.map((en) => en.rider_id));
    const gc = new Map([...inRace].map((id) => [id, 0]));
    for (const p of stages) {
      const standings = [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
      before.set(p.stage_number, { standings: p.stage_number === 1 ? [] : standings, inRace: new Set(inRace) });
      const out = sim(p.stage_number, rules, inRace, p.stage_number === 1 ? [] : standings, "gc6201");
      const fin = out.results.filter((r) => r.status === "finished");
      const bonus = new Map((out.passage_totals ?? []).map((t) => [t.rider_id, t.bonus_seconds ?? 0]));
      for (const r of fin) gc.set(r.rider_id, (gc.get(r.rider_id) ?? 0) + r.time_seconds - (bonus.get(r.rider_id) ?? 0));
      const finIds = new Set(fin.map((r) => r.rider_id));
      for (const id of [...gc.keys()]) if (!finIds.has(id)) gc.delete(id);
      inRace = finIds;
    }
    const samples = [];
    for (const seed of seeds) {
      for (const p of stages) {
        if (TIME_TRIALS.has(p.profile_type)) continue;
        const b = before.get(p.stage_number);
        const out = sim(p.stage_number, rules, b.inRace, b.standings, seed);
        samples.push({ group: groupOf(p.profile_type), profile: p.profile_type, ...morningBreakOf(out.timeline.events) });
      }
    }
    result[rules] = summarize(samples);
  }
  return result;
}

function pct(x) {
  return `${Math.round(x * 1000) / 10} %`;
}

function rate(b) {
  return b.n ? `${b.survived}/${b.n} (${pct(b.survived / b.n)})` : "-";
}

export function renderMarkdown(title, result) {
  const lines = [`## ${title}`, "", "| Revision | Profil | Etaper | Median | p10-p90 | p25-p75 | Max | 0-2 mand | Paa max | Forsoeg (median) | Hjem 1-3 | Hjem 4-5 | Hjem 6+ |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const [rules, byGroup] of Object.entries(result)) {
    for (const group of Object.keys(PROFILE_GROUPS)) {
      const g = byGroup[group];
      if (!g) continue;
      lines.push(`| ${rules} | ${group} | ${g.stages} | ${g.median} | ${g.p10}-${g.p90} | ${g.p25}-${g.p75} | ${g.max} | ${pct(g.share0to2)} | ${pct(g.atMax)} | ${g.attemptsMedian} | ${rate(g.survive1to3)} | ${rate(g.survive4to5)} | ${rate(g.survive6plus)} |`);
    }
  }
  lines.push("", "Fordeling (stoerrelse: antal etaper):", "");
  for (const [rules, byGroup] of Object.entries(result)) {
    for (const group of Object.keys(PROFILE_GROUPS)) {
      const g = byGroup[group];
      if (g) lines.push(`- ${rules} ${group}: ${Object.entries(g.histogram).map(([k, v]) => `${k}:${v}`).join(" ")}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const revisions = arg("rules", "orders_gc_v2,orders_gc_v3").split(",").filter(Boolean);
  const seeds = arg("seeds", "s1,s2,s3").split(",").filter(Boolean);
  const mode = arg("mode", "both");
  const outPath = arg("out", null);
  const parts = [`# #6201 udbrudsstoerrelse pr. profil (PRIVAT, hard rule 17)`, "", `Seeds ${seeds.join(",")} · revisioner ${revisions.join(",")}`, ""];
  if (mode === "proxy" || mode === "both" || mode === "all") {
    const proxy = await runProxy({ revisions, seeds });
    parts.push(renderMarkdown("Proxy-etaper, 22 hold x 8, AI-ordrer for alle hold", proxy), "");
  }
  if (mode === "scorecard" || mode === "all") {
    const sc = await runScorecard({ revisions, seeds });
    parts.push(renderMarkdown("Scorecardets felt (180 fra hele populationen, ingen ordrer: alle fri rolle)", sc), "");
  }
  if (mode === "giro" || mode === "both" || mode === "all") {
    const giro = await runGiro({ revisions, seeds });
    parts.push(renderMarkdown("Giro-feltet (#6088), rigtige roller og ordrer", giro), "");
  }
  const text = parts.join("\n");
  console.log(text);
  if (outPath) {
    const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text + "\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
