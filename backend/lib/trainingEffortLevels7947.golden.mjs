// #7947 frossen golden: "kontakten off = bit-identisk med i dag" bevist mod merge-basens kode (#7587).
//
// Filen koeres to steder med SAMME input:
//   1. paa merge-basen (foer kontakten fandtes), hvor den skrev trainingEffortLevels7947.golden.json.
//      Basen kender ikke indsats-argumenterne og -noeglerne; den ignorerer dem, saa facit er dagens regel.
//   2. af trainingEffortLevels.test.js paa denne branch, med kontakten off og on.
//
// Kun fingeraftryk forlader filen (sha256-praefikser): ingen motortal (regel 17).
//
// Matricen daekker de fire lib-funktioner (programForChoice, normalizeProgram, resolveDayProgram,
// setProgramCell) plus validatoren, for alle sessioner x katalog (v2/v3) x felter (slot 0-4).
// "standard"-delmaengden er de tilfaelde, hvor kontakten on SKAL give dagens svar: ingen gyldig
// indsats, indsats lig sessionens standardniveau, eller en plads der ignorerer indsatsen (hvile,
// restitution, gammel raekke, eksplicit plan). Klassifikationen bruger kun basens funktioner.
//
// Motoren: hele datoen (fem loebsdage) gennem den rigtige aftenkoersel (runTeamTrainingDay via
// dommerens stedfortraeder, trainNowSameResult7982.harness.js, uroert).
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { programForChoice, normalizeProgram, DAY_TYPES } from "./trainingDayTypes.js";
import {
  resolveDayProgram, setProgramCell, isValidProgramWeekDays, intensityForSession, PROGRAM_SESSIONS,
  TRAINING_PROGRAM_KEYS, programWeekDaysFor,
} from "./trainingPrograms.js";
import { V3_NEW_HARD_SESSIONS } from "./trainingCatalogV3.js";
import { WEEKDAY_KEYS } from "./training.js";
import { seedState, createFake, sweep, digest, rider } from "./trainNowSameResult7982.harness.js";

const LEVELS = ["easy", "normal", "hard"];
const isLevel = (v) => LEVELS.includes(v);
const enc = (v) => (v === undefined ? "__undefined__" : v);
export const hashOf = (list) => createHash("sha256").update(JSON.stringify(list.map(enc))).digest("hex").slice(0, 24);

export const SESSIONS = Object.freeze([...PROGRAM_SESSIONS, ...V3_NEW_HARD_SESSIONS]);
const EFFORTS = [undefined, null, "easy", "normal", "hard", "bogus"];
const CATALOGS = [false, true];
const SLOTS = [0, 1, 2, 3, 4];

// Den indsats, et felt laeser (slottets egen, ellers dagens). Generatorens egen kopi af reglen, saa
// klassifikationen ogsaa kan koere paa basen, hvor trainingEffortLevels.js ikke findes.
function cellEffort(entry, slotIndex) {
  const slot = Array.isArray(entry?.slotEfforts) ? entry.slotEfforts[slotIndex] : null;
  if (isLevel(slot)) return slot;
  return isLevel(entry?.effort) ? entry.effort : null;
}

// ── 1. programForChoice ──────────────────────────────────────────────────────────────────────
export function programForChoiceCases({ effortLevels = false } = {}) {
  const out = [];
  for (const dayType of [...DAY_TYPES, "bogus"]) {
    for (const session of [null, ...SESSIONS, "bogus"]) {
      for (const catalogV3 of CATALOGS) {
        for (const previousFocus of [null, "sprint", "long_climbs"]) {
          for (const effort of EFFORTS) {
            const result = programForChoice({ dayType, session, previousFocus, catalogV3, effort, effortLevels });
            const off = programForChoice({ dayType, session, previousFocus, catalogV3 });
            const standard = !isLevel(effort) || !off.ok || off.intensity === "rest" || off.intensity === "recovery"
              || off.intensity === effort;
            out.push({ id: `pfc|${dayType}|${session}|${catalogV3}|${previousFocus}|${enc(effort)}`, standard, effort, result });
          }
        }
      }
    }
  }
  return out;
}

// ── 2. normalizeProgram ──────────────────────────────────────────────────────────────────────
export function normalizeProgramCases({ effortLevels = false } = {}) {
  const out = [];
  for (const focus of [null, ...SESSIONS, "restitution", "bogus"]) {
    for (const intensity of [null, "rest", "recovery", ...LEVELS, "bogus"]) {
      for (const catalogV3 of CATALOGS) {
        const program = { focus, intensity };
        const result = normalizeProgram(program, { catalogV3, effortLevels });
        const off = normalizeProgram(program, { catalogV3 });
        const standard = !isLevel(intensity) || off.dayType === "rest" || off.dayType === "recovery"
          || off.session !== focus || off.intensity === intensity;
        out.push({ id: `np|${focus}|${intensity}|${catalogV3}`, standard, program, result });
      }
    }
  }
  return out;
}

// ── 3. resolveDayProgram ─────────────────────────────────────────────────────────────────────
const SLOT_VARIANTS = Object.freeze({
  none: {},
  slots: { slots: [null, "sprint", null, "rest", "long_climbs"], slotEfforts: [null, "easy", "hard", "normal", "normal"] },
});

function weekWith(monEntry) {
  const days = {};
  for (const weekday of WEEKDAY_KEYS) days[weekday] = weekday === "mon" ? monEntry : { session: "tempo", intensity: "normal" };
  return days;
}

function cellEntry(session, effort, variant) {
  const entry = { session, intensity: intensityForSession(session) };
  if (effort !== undefined) entry.effort = effort;
  const v = SLOT_VARIANTS[variant];
  if (v.slots) entry.slots = [...v.slots];
  if (v.slotEfforts && effort !== undefined) entry.slotEfforts = [...v.slotEfforts];
  return entry;
}

export function resolveDayProgramCases({ effortLevels = false } = {}) {
  const out = [];
  const program = { focus: "threshold", intensity: "normal" };
  for (const session of SESSIONS) {
    for (const effort of [undefined, ...LEVELS]) {
      for (const variant of Object.keys(SLOT_VARIANTS)) {
        const entry = cellEntry(session, effort, variant);
        const days = weekWith(entry);
        const legacyDays = weekWith({ intensity: "easy" });
        const layers = {
          rider: { riderOverrideDays: days, teamWeekDays: null, hasExplicitPlan: false, winner: entry },
          team: { riderOverrideDays: null, teamWeekDays: days, hasExplicitPlan: false, winner: entry },
          teamExplicit: { riderOverrideDays: null, teamWeekDays: days, hasExplicitPlan: true, winner: null },
          riderLegacyTeam: { riderOverrideDays: legacyDays, teamWeekDays: days, hasExplicitPlan: false, winner: null },
        };
        for (const [layer, args] of Object.entries(layers)) {
          for (const programsOn of [false, true]) {
            for (const catalogV3 of CATALOGS) {
              for (const slotIndex of SLOTS) {
                const call = {
                  weekday: "mon", slotIndex, riderOverrideDays: args.riderOverrideDays, teamWeekDays: args.teamWeekDays,
                  program: { ...program }, hasExplicitPlan: args.hasExplicitPlan, programsOn, catalogV3,
                };
                const result = resolveDayProgram({ ...call, effortLevels });
                const off = resolveDayProgram(call);
                const chosen = args.winner ? cellEffort(args.winner, slotIndex) : null;
                const standard = chosen == null || off.source !== "program" || off.intensity === "rest"
                  || off.intensity === "recovery" || off.intensity === chosen;
                out.push({
                  id: `rdp|${session}|${enc(effort)}|${variant}|${layer}|${programsOn}|${catalogV3}|${slotIndex}`,
                  standard, chosen, off, result,
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

// ── 4. setProgramCell + validatoren (kun raekker uden indsats-noegler: basen afviser dem) ──
export function setProgramCellCases() {
  const out = [];
  for (const key of TRAINING_PROGRAM_KEYS) {
    const days = programWeekDaysFor(key);
    for (const weekday of ["mon", "fri", "bogus"]) {
      for (const slotIndex of [null, 0, 2, 4, 7]) {
        for (const session of [...SESSIONS, "bogus"]) {
          out.push({ id: `spc|${key}|${weekday}|${slotIndex}|${session}`, result: setProgramCell(days, { weekday, slotIndex, session }) });
        }
      }
    }
  }
  return out;
}

export function validatorCases() {
  const out = [];
  const push = (id, days) => out.push({ id: `valid|${id}`, result: isValidProgramWeekDays(days) });
  for (const key of TRAINING_PROGRAM_KEYS) {
    const days = programWeekDaysFor(key);
    push(`${key}|plain`, days);
    push(`${key}|slots`, { ...days, mon: { ...days.mon, slots: [null, "sprint", null] } });
    push(`${key}|tooManySlots`, { ...days, mon: { ...days.mon, slots: [null, null, null, null, null, null] } });
    push(`${key}|wrongIntensity`, { ...days, mon: { ...days.mon, intensity: days.mon.intensity === "hard" ? "easy" : "hard" } });
    push(`${key}|extraKey`, { ...days, mon: { ...days.mon, note: "x" } });
    push(`${key}|missingDay`, Object.fromEntries(Object.entries(days).filter(([w]) => w !== "sun")));
  }
  push("legacy", Object.fromEntries(WEEKDAY_KEYS.map((w) => [w, { intensity: "normal" }])));
  push("null", null);
  push("array", []);
  return out;
}

export function libDigests() {
  const pick = (cases, keep = () => true) => hashOf(cases.filter(keep).map((c) => [c.id, c.result]));
  const pfc = programForChoiceCases();
  const np = normalizeProgramCases();
  const rdp = resolveDayProgramCases();
  return {
    programForChoice: { all: pick(pfc), standard: pick(pfc, (c) => c.standard), count: pfc.length },
    normalizeProgram: { all: pick(np), standard: pick(np, (c) => c.standard), count: np.length },
    resolveDayProgram: { all: pick(rdp), standard: pick(rdp, (c) => c.standard), count: rdp.length },
    setProgramCell: { all: pick(setProgramCellCases()) },
    isValidProgramWeekDays: { all: pick(validatorCases()) },
  };
}

// ── 5. Motoren: hele datoen ──────────────────────────────────────────────────────────────────
// Rytter 0-7 har egne raekker, 8-11 foelger holdets (ingen egen plan). 3 og 7 koerer etapen paa
// datoens tredje loebsdag (slot 2), 5 er skadet, 2 og 9 er traette, og holdets traethedsregel
// (og rytter 2's egen) er taendt.
const ENGINE_SEED = { count: 12, entered: [3, 7], injured: [5], tired: [2, 9], noPlan: [8, 9, 10, 11], stageRun: true, fatigueRules: true, staff: true };
const RIDER_MON = ["sprint", "endurance", "threshold", "technique", "rest", "recovery", "long_climbs", "cobbled_sectors"];
const TEAM_MON = { session: "vo2max", intensity: "hard", slots: [null, "endurance", null, "recovery", null] };

const SPECS = {
  // Ingen indsats-noegler.
  plain: () => ({ team: {}, riders: RIDER_MON.map(() => ({})) }),
  // Indsats lig standardniveauet overalt (og indsats paa hvile/restitution, som ignoreres).
  standard: () => ({
    team: { effort: "hard", slotEfforts: [null, "easy", null, "hard", null] },
    // Rytter 1's felter har egne sessioner; dagens indsats gaelder ogsaa dem (slotEfforts ?? effort),
    // saa standard kraever feltets eget standardniveau dér.
    riders: RIDER_MON.map((s, n) => ({
      effort: s === "rest" || s === "recovery" ? "hard" : intensityForSession(s),
      ...(n === 1 ? { slotEfforts: [null, "hard", "easy", null, "normal"] } : {}),
    })),
  }),
  // Andre niveauer end standard.
  other: () => ({
    team: { effort: "easy", slotEfforts: [null, "hard", "normal", null, null] },
    riders: RIDER_MON.map((s, n) => ({ effort: LEVELS[(LEVELS.indexOf(intensityForSession(s)) + 1 + (n % 2)) % 3] ?? "hard" })),
  }),
  // Kun indsats dér, hvor den ignoreres: hvile, restitution og de koerende rytteres loebsfelt.
  ignored: () => ({
    team: { slotEfforts: [null, null, null, "hard", null] },
    riders: RIDER_MON.map((s, n) => {
      if (s === "rest" || s === "recovery") return { effort: "hard" };
      if (n === 3 || n === 7) return { slotEfforts: [null, null, "hard", null, null] };
      return {};
    }),
  }),
};

function weekPlanRows(spec) {
  const rows = [{ team_id: "__TEAM__", rider_id: null, days: weekWith({ ...TEAM_MON, ...spec.team }) }];
  RIDER_MON.forEach((session, n) => {
    const mon = { session, intensity: intensityForSession(session), ...spec.riders[n] };
    if (n === 1) mon.slots = [null, "sprint", "rest", null, "tempo"];
    rows.push({ team_id: "__TEAM__", rider_id: rider(n), days: weekWith(mon) });
  });
  return rows;
}

const OUTPUT_EXCLUDED = new Set(["app_config", "training_week_plans", "training_plans"]);
// #7947 PR 4: `withoutExecutedLevel` fjerner det koerte niveau (rider_training_scores.intensity,
// kun skrevet med kontakten on) foer fingeraftrykket. Saa kan "on + standardniveau = basens dato"
// stadig sammenlignes med basen, mens niveauet selv proeves for sig (engineScoreRows).
function outputDigest(state, answers, { withoutExecutedLevel = false } = {}) {
  const tables = Object.fromEntries(Object.keys(state).filter((t) => !t.startsWith("__") && !OUTPUT_EXCLUDED.has(t)).sort().map((t) => [t, state[t]]));
  if (withoutExecutedLevel && tables.rider_training_scores) {
    tables.rider_training_scores = tables.rider_training_scores.map(({ intensity: _level, ...row }) => row);
  }
  return digest({ tables, answers });
}

async function runEngine(specName, flags) {
  const state = seedState({ ...ENGINE_SEED, flags });
  const team = state.teams[0].id;
  state.training_week_plans = weekPlanRows(SPECS[specName]()).map((row) => ({ ...row, team_id: team }));
  const fake = createFake(state);
  const answers = await sweep(state, fake);
  return { state, answers };
}

/** Hele datoen for et scenarie. `flags` er app_config-overstyringer (basen ignorerer kontakten). */
export async function engineDigest(specName, { flags = {}, withoutExecutedLevel = false } = {}) {
  const { state, answers } = await runEngine(specName, flags);
  return outputDigest(state, answers, { withoutExecutedLevel });
}

/** #7947 PR 4: datoens score-raekker for et scenarie (det koerte niveau proeves direkte). */
export async function engineScoreRows(specName, { flags = {} } = {}) {
  return (await runEngine(specName, flags)).state.rider_training_scores ?? [];
}

// Det raa par (session, indsats) for rytter 0-7, to veje: (A) en egen programraekke med indsats,
// kontakten on; (B) ingen ugeplan, en eksplicit training_plans-raekke med parret. Motoren skal give
// samme udfald (kun den nye kode; basen kender ikke A).
export const RAW_PAIRS = Object.freeze([
  ["sprint", "easy"], ["endurance", "hard"], ["threshold", "easy"], ["technique", "hard"],
  ["vo2max", "normal"], ["tempo", "hard"], ["aero", "hard"], ["cobbled_sectors", "easy"],
]);

export async function rawPairDigest(way, { flags = {}, withoutExecutedLevel = false } = {}) {
  const { state, answers } = await runRawPair(way, flags);
  return outputDigest(state, answers, { withoutExecutedLevel });
}

/** #7947 PR 4: score-raekkerne og kvitteringerne for de raa par (begge veje). */
export async function rawPairScoreRows(way, { flags = {} } = {}) {
  const { state } = await runRawPair(way, flags);
  return { scores: state.rider_training_scores ?? [], receipts: state.training_rider_ticks ?? [] };
}

async function runRawPair(way, flags) {
  const state = seedState({ ...ENGINE_SEED, flags });
  const team = state.teams[0].id;
  state.training_plans = state.training_plans.filter((row) => !RAW_PAIRS.some((_, n) => row.rider_id === rider(n)));
  RAW_PAIRS.forEach(([focus, intensity], n) => {
    state.training_plans.push({ rider_id: rider(n), team_id: team, season_id: state.seasons[0].id, focus, intensity });
  });
  state.training_week_plans = way === "cells"
    ? RAW_PAIRS.map(([session, effort], n) => ({
      team_id: team, rider_id: rider(n),
      days: Object.fromEntries(WEEKDAY_KEYS.map((w) => [w, { session, intensity: intensityForSession(session), effort }])),
    }))
    : [];
  const fake = createFake(state);
  const answers = await sweep(state, fake);
  return { state, answers };
}

export const ENGINE_SPECS = Object.freeze(Object.keys(SPECS));

export async function goldenFromThisCode() {
  const engine = {};
  for (const name of ENGINE_SPECS) engine[name] = await engineDigest(name);
  return { lib: libDigests(), engine };
}

// `node backend/lib/trainingEffortLevels7947.golden.mjs` skriver facit til stdout (koeres paa basen).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  goldenFromThisCode().then((golden) => process.stdout.write(`${JSON.stringify(golden, null, 2)}\n`));
}
