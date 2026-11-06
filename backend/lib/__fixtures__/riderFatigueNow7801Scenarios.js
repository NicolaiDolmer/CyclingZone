// #7801: faste, syntetiske scenarier for motorens træthed ved etapestart. Delt af
// riderFatigueNow.test.js og generatoren af den frosne fixture (riderFatigueNow7801Base.json).
// Samme fil køres i merge-basen (før modulet fandtes) og i den nye kode; kun hashes forlader
// modulet (hard rule 17). Ingen prod-data, ingen rng uden fast frø.
//
// Kør i merge-basen for at skrive facit:
//   node backend/lib/__fixtures__/riderFatigueNow7801Scenarios.js <sti-til-json>
// Genereres ALDRIG med den nye kode.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { applySameDateEnteringFatigueV2 } from "../raceFatigue.js";
import { CONDITION_V2_CONFIG, enteringFatigueV2, recoveryV2 } from "../conditionModelV2.js";

const SCENARIO_COUNT = 600;
const STAGE_DATE = "2026-11-01";
// Dansk kalenderdato for dette tidspunkt er STAGE_DATE; lige efter midnat dansk tid, så en
// udregning på UTC-datoen ville ramme dagen før.
const STAGE_START = "2026-10-31T23:30:00Z";

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const pick = (next, values) => values[Math.floor(next() * values.length)];

// Skæve åbninger: tal, tekst, tomt og uden for skalaen. Motoren skelner mellem dem.
const OPENINGS = [0, 7, 23, 31, 48, 56, 64, 71, 83, 95, 100, 30.5, 61.25, -5, 130, "44", "", "abc", null, undefined];
const RECOVERIES = [undefined, null, 0, 35, 47, 50, 63, 78, 92, 100];
const MEDICAL = [undefined, 0, 1, 2, 3, 4, 5];
const LOADS = [0, 3.5, 7, 11.25, 16, 22.75, 31, 44, 57.5, "12", "x", null];

/** Ét scenarie: felt, sygehold, datoens ledger og etapens plads. Rent ud fra frøet. */
export function buildScenario(seed) {
  const next = rng(seed * 2654435761);
  const riderCount = seed % 97 === 0 ? 240 : Math.floor(next() * 7);
  const entrants = Array.from({ length: riderCount }, (_, i) => {
    const recovery = pick(next, RECOVERIES);
    const entrant = { rider_id: `r${seed}-${i}`, team_id: `t${i % 3}`, fatigue: pick(next, OPENINGS), name: `rytter ${i}` };
    if (next() > 0.15) entrant.abilities = { recovery };
    return entrant;
  });
  const medicalBonusByTeam = new Map();
  for (let t = 0; t < 3; t++) {
    const bonus = pick(next, MEDICAL);
    if (bonus !== undefined) medicalBonusByTeam.set(`t${t}`, bonus);
  }
  const gameDay = 20 + Math.floor(next() * 5);
  const ledger = [];
  for (const entrant of entrants) {
    const rows = Math.floor(next() * 5);
    for (let r = 0; r < rows; r++) {
      ledger.push({
        rider_id: entrant.rider_id,
        game_day: 18 + Math.floor(next() * 8),
        load: pick(next, LOADS),
        tick_date: next() > 0.15 ? STAGE_DATE : "2026-10-31",
        consumed_at: next() > 0.15 ? null : "2026-11-01T20:05:00Z",
        duplicate_of_race_id: next() > 0.15 ? null : "dublet",
      });
    }
  }
  const shape = seed % 41;
  const schedule = shape === 1 ? null
    : shape === 2 ? { game_day: null, scheduled_at: STAGE_START }
      : shape === 3 ? { game_day: gameDay, scheduled_at: null }
        : shape === 4 ? { game_day: "22", scheduled_at: STAGE_START }
          : shape === 5 ? { game_day: 21.5, scheduled_at: STAGE_START }
            : { game_day: gameDay, scheduled_at: STAGE_START };
  return {
    entrants, medicalBonusByTeam, ledger, schedule,
    stageNumber: 1 + (seed % 9),
    scheduleError: seed % 53 === 7 ? { message: "syntetisk plan-fejl" } : null,
    ledgerError: seed % 59 === 11 ? { message: "syntetisk ledger-fejl" } : null,
    reverseRows: seed % 2 === 1,
  };
}

/** Fake af supabase-kæden: logger hvert kald i rækkefølge og filtrerer som databasen. */
export function fakeSupabase(scenario, log = []) {
  return {
    from(table) {
      const filters = [];
      const note = (method, args) => log.push([table, method, ...args]);
      const q = {
        select(...args) { note("select", args); return q; },
        eq(column, value) { note("eq", [column, value]); filters.push((row) => row[column] === value); return q; },
        lt(column, value) { note("lt", [column, value]); filters.push((row) => row[column] < value); return q; },
        is(column, value) { note("is", [column, value]); filters.push((row) => row[column] === value); return q; },
        in(column, values) { note("in", [column, values.length, values[0] ?? null]); filters.push((row) => values.includes(row[column])); return q; },
        order(...args) { note("order", args); return q; },
        async maybeSingle() {
          note("maybeSingle", []);
          return scenario.scheduleError ? { data: null, error: scenario.scheduleError } : { data: scenario.schedule, error: null };
        },
        then(resolve, reject) {
          note("await", []);
          if (scenario.ledgerError) return Promise.resolve({ data: null, error: scenario.ledgerError }).then(resolve, reject);
          const rows = scenario.ledger.filter((row) => filters.every((keep) => keep(row)))
            .sort((a, b) => a.game_day - b.game_day);
          return Promise.resolve({ data: scenario.reverseRows ? rows.reverse() : rows, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

// JSON skelner ikke undefined, NaN og null; det gør motoren.
const exact = (value) => JSON.stringify(value, (_key, v) => {
  if (v === undefined) return "__undefined__";
  if (typeof v === "number" && !Number.isFinite(v)) return `__${v}__`;
  return v;
});
const sha = (value) => createHash("sha256").update(value).digest("hex");

/** Kører motorens indgang på ét scenarie og returnerer alt, der kan ses udefra. */
export async function runScenario(seed, apply = applySameDateEnteringFatigueV2) {
  const scenario = buildScenario(seed);
  const log = [];
  const { returned, thrown } = await apply({
    supabase: fakeSupabase(scenario, log), raceId: `race-${seed}`, stageNumber: scenario.stageNumber,
    entrants: scenario.entrants, medicalBonusByTeam: scenario.medicalBonusByTeam,
  }).then((value) => ({ returned: value, thrown: null }), (error) => ({ returned: undefined, thrown: error.message }));
  return { returned, thrown, entrants: scenario.entrants, log };
}

/** Fingeraftryk af det regnestykke, facit er skrevet med. Ændres det, gælder facit ikke længere. */
export function modelFingerprint() {
  const source = (fn) => fn.toString().replace(/\r\n/g, "\n");
  return sha(exact({ cfg: CONDITION_V2_CONFIG, entering: source(enteringFatigueV2), recovery: source(recoveryV2) }));
}

export async function digestScenarios(apply = applySameDateEnteringFatigueV2) {
  const results = [];
  for (let seed = 1; seed <= SCENARIO_COUNT; seed++) results.push(await runScenario(seed, apply));
  // Kaldet med tomme felter går uden om alt andet og skal stadig give nul uden en eneste læsning.
  const empty = [];
  for (const entrants of [[], null, undefined]) {
    empty.push(await apply({ supabase: { from() { throw new Error("must not read"); } }, raceId: "r", stageNumber: 1, entrants }));
  }
  return {
    scenarios: SCENARIO_COUNT,
    modelFingerprint: modelFingerprint(),
    entrants: sha(exact(results.map((r) => r.entrants))),
    returned: sha(exact(results.map((r) => r.returned))),
    thrown: sha(exact(results.map((r) => r.thrown))),
    reads: sha(exact(results.map((r) => r.log))),
    empty: sha(exact(empty)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , outPath, sourceCommit] = process.argv;
  const digest = await digestScenarios();
  writeFileSync(outPath, `${JSON.stringify({
    sourceCommit,
    note: "#7801: motorens træthed ved etapestart, skrevet fra merge-basen før riderFatigueNow.js. Kun hashes. Genereres ALDRIG med den nye kode.",
    ...digest,
  }, null, 2)}\n`);
}
