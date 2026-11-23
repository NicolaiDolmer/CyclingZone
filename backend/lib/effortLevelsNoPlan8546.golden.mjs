// #8546 frossen golden: ryttere uden plan (og kun gammel ugerytme) faar det koerte niveau paa
// score-raekken, saa aldringsbremsen ikke taeller sessionens tabel-niveau.
//
// Filen koeres to steder med SAMME input (#7587):
//   1. paa merge-basen i et separat, read-only worktree, hvor den skrev effortLevelsNoPlan8546.golden.json.
//      Basen laeser kun kontakten training_effort_levels med programceller eller en plan paa andet niveau.
//   2. af effortLevelsNoPlan8546.test.js paa denne branch.
// Fixturen genereres aldrig med den nye kode.
//
// Kun fingeraftryk (sha-praefikser) forlader filen: ingen motortal (regel 17).
//
// Holdene har INGEN programceller og kun standardpar som planer (sessionens eget niveau), praecis
// det tilfaelde hvor basen aldrig laeste kontakten:
//   noPlanAndRhythm : ryttere uden plan, holdets gamle ugerytme, en rytter med egen gammel
//                     ugerytme, traethedsregler, en skadet rytter og en etape paa datoen.
//   noPlanOnly      : hele holdet uden plan, ingen ugeplan og ingen regler (assistentens fokus paa Mellem).
//   noPlanPress     : som noPlanOnly, men trykket ("Traen nu") foer aftenkoerslen.
//   standardOnly    : alle ryttere med en plan paa sessionens eget niveau, ingen ugerytme, ingen regler.
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { seedState, createFake, sweep, press, digest } from "./trainNowSameResult7982.harness.js";
import { sessionIntensityFor, SESSION_INTENSITY_V3 } from "./trainingDayTypes.js";
import { planRunsOffStandard } from "./trainingWeekPlanCells.js";

export const FLAG_VARIANTS = Object.freeze({
  missing: {},
  off: { training_effort_levels: "off" },
  on: { training_effort_levels: "on" },
});

const SEEDS = {
  noPlanAndRhythm: { count: 12, entered: [3, 7], injured: [5], tired: [2, 9], noPlan: [4, 8, 9, 10], weekPlan: true, fatigueRules: true, staff: true, stageRun: true },
  noPlanOnly: { count: 8, entered: [1], noPlan: [0, 1, 2, 3, 4, 5, 6, 7], stageRun: true },
  noPlanPress: { count: 8, entered: [1], noPlan: [0, 1, 2, 3, 4, 5, 6, 7], stageRun: true },
  standardOnly: { count: 8, entered: [1], stageRun: true },
};
export const SCENARIOS = Object.freeze(Object.keys(SEEDS));

// Alle planer bliver standardpar (samme greb som #8537's opslagsproeve), saa basen ikke laeser kontakten.
function standardPlans(state) {
  const standard = sessionIntensityFor({ catalogV3: false });
  for (const plan of state.training_plans ?? []) {
    if (planRunsOffStandard(plan)) plan.intensity = standard[plan.focus] ?? plan.intensity;
  }
  if ((state.training_plans ?? []).some(planRunsOffStandard)) throw new Error("golden 8546: en plan er stadig paa andet niveau");
}

export async function runScenario(name, flags) {
  const state = seedState({ ...SEEDS[name], flags });
  standardPlans(state);
  const fake = createFake(state);
  const answers = [];
  if (name === "noPlanPress") answers.push(await press(state, fake).then((r) => ({ status: r?.status ?? null }), (err) => ({ error: String(err.message) })));
  answers.push(await sweep(state, fake));
  return { state, answers, fake };
}

// Bremsens klassifikation af en score-raekke (samme regel som seasonDevelopmentLoad.executedLevel):
// det koerte niveau, ellers sessionens tabel-niveau. Generatorens egen kopi, saa den ogsaa koerer paa basen.
export const brakeLevel = (row) => row.intensity ?? (row.session ? SESSION_INTENSITY_V3[row.session] ?? null : null);

const OUTPUT_EXCLUDED = new Set(["app_config", "training_week_plans", "training_plans"]);
function tablesOf(state, { withoutExecutedLevel }) {
  const tables = Object.fromEntries(Object.keys(state).filter((t) => !t.startsWith("__") && !OUTPUT_EXCLUDED.has(t)).sort().map((t) => [t, state[t]]));
  if (withoutExecutedLevel && tables.rider_training_scores) {
    tables.rider_training_scores = tables.rider_training_scores.map(({ intensity: _level, ...row }) => row);
  }
  return tables;
}

/** Fingeraftryk for et scenarie: hele udfaldet, udfaldet uden koert niveau, og bremsens klassifikation pr. rytter. */
export function fingerprint({ state, answers }) {
  const byRider = {};
  for (const row of state.rider_training_scores ?? []) {
    (byRider[row.rider_id] ??= []).push([row.game_day, row.tick_date, row.day_type, row.was_race_day, row.session, brakeLevel(row)]);
  }
  const brake = Object.fromEntries(Object.keys(byRider).sort().map((id) => [id, digest(byRider[id])]));
  return {
    full: digest({ tables: tablesOf(state, { withoutExecutedLevel: false }), answers }),
    training: digest({ tables: tablesOf(state, { withoutExecutedLevel: true }), answers }),
    brake,
  };
}

export async function goldenFromThisCode() {
  const out = {};
  for (const name of SCENARIOS) {
    out[name] = {};
    for (const [variant, flags] of Object.entries(FLAG_VARIANTS)) out[name][variant] = fingerprint(await runScenario(name, flags));
  }
  return out;
}

// Kun paa merge-basen: `node lib/effortLevelsNoPlan8546.golden.mjs <ud.json>`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { warn, log } = console;
  console.warn = () => {}; console.log = () => {};
  let scenarios;
  try { scenarios = await goldenFromThisCode(); } finally { console.warn = warn; console.log = log; }
  const mergeBase = execSync("git rev-parse HEAD").toString().trim();
  writeFileSync(process.argv[2], `${JSON.stringify({ mergeBase, scenarios }, null, 2)}\n`);
  console.log(`golden 8546 skrevet fra ${mergeBase}`);
}
