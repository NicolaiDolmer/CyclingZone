// #6462 (ejer 16/10): maaling af togreglen, official_times_v4 (den aktuelle) mod
// official_times_v5 (v4 + togreglen) paa SAMME etaper, felter og seeds.
//
// Spoergsmaalet: aendrer v5 KUN togvalget? Tre ting maales pr. etape, begge
// revisioner, uden DB (READ-ONLY og deterministisk):
//   1. Ordrerne (prod-adapterens egen vej, buildStageOrderPlan, blandet felt af
//      menneske- og AI-hold uden gemte valg = rollernes standard): fjernes
//      tog-flag og tog-ordrer, skal resten vaere identisk ("andre ordre-forskelle").
//      AI-holdenes indsats skal ogsaa vaere identisk.
//   2. Motoren: samme ordrer under v4 og v5 skal give identisk StageOutput
//      ("motor-forskelle"); reglen bor kun i adapteren.
//   3. Foer/efter for maalepunktet (nye loeb under den aktuelle revision): antal
//      tog og hjaelpere i tog pr. profilgruppe, og hvor mange etaper hvis
//      resultat flytter sig, naar toget forsvinder fra standarden.
//
// Kun taellinger (ingen evner eller tider) skrives til stdout/--out.
//
// Koer:
//   node backend/scripts/dev/sprintTrainDefault6462.mjs [--seeds=s1,s2] [--out=balance-internals/6462/bench.md]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { groupOf, teamField, teamsOf } from "./breakawaySize6201.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");

export const BEFORE = "official_times_v4";
export const AFTER = "official_times_v5";
const GROUPS = ["flat", "hilly_rolling", "mountain", "time_trial", "cobbles_classic"];
const TIME_TRIALS = new Set(["itt", "itt_hilly", "ttt"]);

async function engine() {
  const { simulateStageV4 } = await import("../../lib/engine/v4/index.ts");
  const { RACE_V4_TUNING } = await import("../../lib/engine/v4/tuning.ts");
  const { routeFromStageProfileRow } = await import("../../lib/engine/v4/adapters/routeAdapter.ts");
  const { buildStageOrderPlan } = await import("../../lib/engine/v4/orders/teamOrdersAdapter.ts");
  const { LEADOUT_ORDER_KIND } = await import("../../lib/engine/v4/mechanics/leadout.ts");
  const { TEAM_TACTICS_ORDER_KIND } = await import("../../lib/engine/v4/mechanics/breakaway.ts");
  const { v4EntrantsFromPopulation, buildRaceContexts } = await import("../headToHeadV4.js");
  const { assignFieldRoles } = await import("../lib/headToHeadOrders.js");
  const { makeRng } = await import("../../lib/fictionalRiderGenerator.js");
  const { stableSeed } = await import("../../lib/raceSimulator.js");
  const { POPULATION_FILE, STAGES_FILE } = await import("../v4FlipReadiness.mjs");
  return { simulateStageV4, RACE_V4_TUNING, routeFromStageProfileRow, buildStageOrderPlan, LEADOUT_ORDER_KIND, TEAM_TACTICS_ORDER_KIND, v4EntrantsFromPopulation, buildRaceContexts, assignFieldRoles, makeRng, stableSeed, POPULATION_FILE, STAGES_FILE };
}

const benchGroup = (profileType) => (TIME_TRIALS.has(profileType) ? "time_trial" : groupOf(profileType));

/** Ordrerne uden tog: tog-ordrer fjernet, tog-flag sat til false. Ny liste. */
export function withoutTrains(orders, e) {
  return orders
    .filter((o) => o.kind !== e.LEADOUT_ORDER_KIND)
    .map((o) => (o.kind === e.TEAM_TACTICS_ORDER_KIND
      ? { ...o, params: { ...o.params, riders: (o.params?.riders ?? []).map((r) => ({ ...r, leadout: false })) } }
      : o));
}

function trainCounts(orders, e) {
  const trains = orders.filter((o) => o.kind === e.LEADOUT_ORDER_KIND);
  const helpers = trains.reduce((n, o) => n + (o.params?.leadout_rider_ids?.length ?? 0), 0);
  return { trains: trains.length, helpers };
}

const finishOrder = (out) => out.results.map((r) => `${r.rider_id}:${r.rank}:${r.time_seconds}:${r.status}`).join("|");

export async function runBench({ seeds }) {
  const e = await engine();
  const population = JSON.parse(readFileSync(path.join(REPO_ROOT, e.POPULATION_FILE), "utf8"));
  const sf = JSON.parse(readFileSync(path.join(REPO_ROOT, e.STAGES_FILE), "utf8"));
  const stages = Array.isArray(sf) ? sf : sf.stages;
  const contexts = e.buildRaceContexts(stages);
  const teams = teamsOf(population.riders);
  const rows = Object.fromEntries(GROUPS.map((g) => [g, {
    stages: 0, trainsBefore: 0, trainsAfter: 0, helpersBefore: 0, helpersAfter: 0,
    resultChanged: 0, otherOrderDiffs: 0, effortDiffs: 0, engineDiffs: 0,
  }]));
  for (const seed of seeds) {
    for (const row of stages) {
      const stageSeedStr = `${seed}:${row.stage_number ?? 1}`;
      const field = teamField(e.makeRng(e.stableSeed(`${stageSeedStr}:field`)), teams);
      // Blandet felt: hvert andet hold er et menneskehold (rollens standard, ingen gemte valg).
      const teamIds = [...new Set(field.map((r) => r.team_id))].sort();
      const human = new Set(teamIds.filter((_, i) => i % 2 === 0));
      const route = e.routeFromStageProfileRow(row);
      const roles = e.assignFieldRoles(field);
      const roster = field.map((r) => ({ team_id: r.team_id ?? null, rider_id: r.id, role: roles.get(r.id) ?? "free_role", is_ai: !human.has(r.team_id), abilities: r.abilities }));
      const plan = (rules_revision) => e.buildStageOrderPlan({
        rows: [], stageNumber: 1, roster,
        context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, race: contexts.get(row), rules_revision },
      });
      const before = plan(BEFORE);
      const after = plan(AFTER);
      const sim = (orders, aiEffort, rules_revision) => e.simulateStageV4({
        route, startlist: e.v4EntrantsFromPopulation(field, roles, aiEffort), orders, seed: stageSeedStr, tuning: e.RACE_V4_TUNING, rules_revision,
      });
      const outBefore = sim(before.orders, before.aiEffortByRider, BEFORE);
      const outAfter = sim(after.orders, after.aiEffortByRider, AFTER);
      // Motoren alene: v4's ordrer koert under v5 skal give v4's etape.
      const outEngineOnly = sim(before.orders, before.aiEffortByRider, AFTER);
      const g = rows[benchGroup(route.profile_type)];
      const cb = trainCounts(before.orders, e);
      const ca = trainCounts(after.orders, e);
      g.stages += 1;
      g.trainsBefore += cb.trains;
      g.trainsAfter += ca.trains;
      g.helpersBefore += cb.helpers;
      g.helpersAfter += ca.helpers;
      if (!isDeepStrictEqual(withoutTrains(before.orders, e), withoutTrains(after.orders, e))) g.otherOrderDiffs += 1;
      if (!isDeepStrictEqual([...before.aiEffortByRider].sort(), [...after.aiEffortByRider].sort())) g.effortDiffs += 1;
      if (!isDeepStrictEqual(outEngineOnly, outBefore)) g.engineDiffs += 1;
      if (finishOrder(outBefore) !== finishOrder(outAfter)) g.resultChanged += 1;
    }
  }
  return rows;
}

export function renderMarkdown(rows, seeds) {
  const lines = [
    `# #6462 togreglen: ${BEFORE} (foer) mod ${AFTER} (efter)`,
    "",
    `Proxy-etaper, 22 hold x 8 (hvert andet hold menneske, rollens standard), seeds ${seeds.join(",")}.`,
    "",
    "| Profilgruppe | Etaper | Tog foer | Tog efter | Hjaelpere i tog foer | efter | Etaper med flyttet resultat | Andre ordre-forskelle | Indsats-forskelle | Motor-forskelle |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  const total = { stages: 0, trainsBefore: 0, trainsAfter: 0, helpersBefore: 0, helpersAfter: 0, resultChanged: 0, otherOrderDiffs: 0, effortDiffs: 0, engineDiffs: 0 };
  for (const [group, r] of Object.entries(rows)) {
    if (!r.stages) continue;
    for (const k of Object.keys(total)) total[k] += r[k];
    lines.push(`| ${group} | ${r.stages} | ${r.trainsBefore} | ${r.trainsAfter} | ${r.helpersBefore} | ${r.helpersAfter} | ${r.resultChanged} | ${r.otherOrderDiffs} | ${r.effortDiffs} | ${r.engineDiffs} |`);
  }
  lines.push(`| **i alt** | ${total.stages} | ${total.trainsBefore} | ${total.trainsAfter} | ${total.helpersBefore} | ${total.helpersAfter} | ${total.resultChanged} | ${total.otherOrderDiffs} | ${total.effortDiffs} | ${total.engineDiffs} |`);
  return lines.join("\n");
}

async function main() {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const seeds = arg("seeds", "s1,s2").split(",").filter(Boolean);
  const outPath = arg("out", null);
  const rows = await runBench({ seeds });
  const text = renderMarkdown(rows, seeds);
  console.log(text);
  if (outPath) {
    const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text + "\n");
  }
  const leaks = Object.values(rows).reduce((n, r) => n + r.otherOrderDiffs + r.effortDiffs + r.engineDiffs, 0);
  if (leaks > 0) {
    console.error(`#6462: ${leaks} etaper hvor v5 aendrer mere end togvalget`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
