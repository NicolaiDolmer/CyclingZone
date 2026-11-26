// #8180: formtoppens optakt laeser alle traeningsraekker for alle hold, kun i loeb stemplet ved start.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/peakLeadupAllRows8180OffBase.json
// er skrevet af merge-basens racePeakPlans.js (mergeBase i filen) med de samme scenarier
// (__fixtures__/peakLeadupAllRows8180Scenarios.js) og genereres aldrig med den nye kode.
// Kun hashes; syntetiske raekker, ingen prod-data.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as peak from "./racePeakPlans.js";
import {
  PEAK_LEADUP_ALL_ROWS_8180_FLAG_KEY, evaluatePeakLeadupAllRows8180Flag, isPeakLeadupAllRows8180Enabled,
  resolvePeakLeadupAllRows8180,
} from "./peakLeadupAllRows8180Flag.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { PLAYER_VISIBLE_FLAG_KEYS, findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { TRAINING_PEAK_FROM_TICKS_6490_FLAG_KEY } from "./trainingHistoryFromTicks6490.js";
import { ROW_CAP_8180, buildScenario8180, runScenario8180, runScenarios8180 } from "./__fixtures__/peakLeadupAllRows8180Scenarios.js";
import { RACE_7733, runStage7733 } from "./__fixtures__/startedFieldLock7733Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/peakLeadupAllRows8180OffBase.json", import.meta.url), "utf8"));
const KEY = PEAK_LEADUP_ALL_ROWS_8180_FLAG_KEY;

const countByTeam = (runs) => {
  const out = {};
  for (const r of runs) out[r.team_id] = (out[r.team_id] || 0) + 1;
  return out;
};
const qualitiesOfTeam = (qualities, team) => qualities.filter(([rider]) => rider.startsWith(`${team}-`));

// ── Kontakten ──────────────────────────────────────────────────────────────

test("kun den eksakte streng on taender", () => {
  assert.equal(evaluatePeakLeadupAllRows8180Flag("on"), true);
  for (const value of ["off", "beta", "stop", true, "ON", "on ", null, undefined, 1]) {
    assert.equal(evaluatePeakLeadupAllRows8180Flag(value), false, String(value));
  }
});

test("kontakten staar i kataloget, caches aldrig og er ikke spillersynlig", async () => {
  assert.equal(KEY, "peak_leadup_all_rows_8180");
  assert.ok(isStageFlagKey(KEY));
  assert.equal(findStageFlag(KEY).area, "race-engine");
  assert.ok(FRESH_FLAG_KEYS.has(KEY));
  assert.ok(![...PLAYER_VISIBLE_FLAG_KEYS].includes(KEY));
  const config = (value) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value == null ? null : { value }, error: null }) }) }) }) });
  assert.equal(await isPeakLeadupAllRows8180Enabled(config("on")), true);
  assert.equal(await isPeakLeadupAllRows8180Enabled(config(null)), false);
});

test("migrationen er additiv, seeder off og overskriver aldrig et stadie", () => {
  const sql = readFileSync(new URL("../../database/2026-11-26-8180-peak-leadup-all-rows.sql", import.meta.url), "utf8");
  const live = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.match(live, /ADD COLUMN IF NOT EXISTS peak_leadup_all_rows_8180 boolean/);
  assert.match(live, /'peak_leadup_all_rows_8180',\s*'"off"'::jsonb/);
  assert.match(live, /ON CONFLICT \(key\) DO NOTHING/);
  assert.doesNotMatch(live, /\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
});

// ── Scenariet er det issuet beskriver ──────────────────────────────────────

test("scenariet: over loftet i alt, fordelt paa 14 hold, og det sidste hold fik 0 raekker paa main", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = buildScenario8180(seed);
    assert.equal(s.teams.length, 14);
    assert.ok(s.rows.length > ROW_CAP_8180, `seed ${seed}: ${s.rows.length} raekker`);
    const { runs } = await runScenario8180(peak, seed);
    const counts = countByTeam(runs);
    assert.equal(runs.length, ROW_CAP_8180, "main's kald stopper ved loftet");
    assert.equal(counts[s.teams.at(-1)] ?? 0, 0, `seed ${seed}: det sidste hold faar intet`);
  }
});

// ── Slukket: bit-identisk med merge-basen ──────────────────────────────────

test("fixturen kommer fra merge-basen og daekker alle seeds", () => {
  assert.match(FROZEN.mergeBase, /^[0-9a-f]{40}$/);
  assert.deepEqual(FROZEN.results.map((r) => r.seed), [1, 2, 3, 4, 5, 6]);
});

for (const value of [null, "off", "beta", "stop", "on"]) {
  test(`slukket (ingen allRows, app_config ${JSON.stringify(value)}): kvaliteter og raekker er merge-basens`, async () => {
    // Kontakten alene goer intet: kun et stempel paa loebet (allRows fra raceRunner) aendrer laesningen.
    const flags = { [KEY]: value };
    assert.deepEqual(await runScenarios8180(peak, { flags }), FROZEN.results);
  });
}

test("slukket: loaderen faar praecis de samme argumenter som foer", async () => {
  const seen = [];
  const s = buildScenario8180(1);
  await peak.resolvePeakTrainingQualities({
    supabase: {}, entrants: s.entrants, peakPlansByRider: new Map([...s.windows].map(([k, v]) => [k, v.map((w) => ({ ...w }))])),
    loadTeamTrainingRuns: async (args) => { seen.push(Object.keys(args).sort()); return []; },
    loadRiderConditions: async () => new Map(), loadTargetRaceDemands: async () => new Map(),
  });
  assert.deepEqual(seen, [["endDate", "startDate", "supabase", "teamIds"]]);
});

// ── Taendt: de afkortede hold faar deres raekker ───────────────────────────

test("taendt: alle hold faar alle deres raekker, laest side for side i en fast raekkefoelge", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = buildScenario8180(seed);
    const { runs, runsCalls } = await runScenario8180(peak, seed, { allRows: true });
    const expected = countByTeam(s.rows.filter((r) => r.tick_date >= "2026-10-01" && r.tick_date < "2026-11-15"));
    assert.deepEqual(countByTeam(runs), expected, `seed ${seed}`);
    assert.ok(runs.length > ROW_CAP_8180);
    assert.ok(runsCalls.length >= 2 && runsCalls.every((c) => c.startsWith("page:")), runsCalls.join(","));
    const order = runs.map((r) => `${r.team_id}|${String(r.ord).padStart(8, "0")}`);
    assert.deepEqual(order, [...order].sort(), "sorteret paa hold og dato");
  }
});

test("taendt: det sidste hold faar en ny traeningskvalitet; hold under loftet beholder deres", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = buildScenario8180(seed);
    const off = await runScenario8180(peak, seed);
    const on = await runScenario8180(peak, seed, { allRows: true });
    const last = s.teams.at(-1);
    assert.notDeepEqual(qualitiesOfTeam(on.qualities, last), qualitiesOfTeam(off.qualities, last), `seed ${seed}`);
    // Hold der laa helt under loftet: samme raekker, samme kvalitet (kun summeringsraekkefoelgen kan flytte sidste bit).
    const offCounts = countByTeam(off.runs);
    const onCounts = countByTeam(on.runs);
    const untouched = s.teams.filter((t) => offCounts[t] === onCounts[t]);
    assert.ok(untouched.length >= 8, `seed ${seed}: ${untouched.length} hold under loftet`);
    for (const t of untouched) {
      const a = qualitiesOfTeam(off.qualities, t);
      const b = qualitiesOfTeam(on.qualities, t);
      assert.equal(a.length, b.length);
      a.forEach(([rider, ws], i) => {
        assert.equal(b[i][0], rider);
        ws.forEach((q, j) => assert.ok(Math.abs(q - b[i][1][j]) < 1e-12, `${rider}: ${q} mod ${b[i][1][j]}`));
      });
    }
  }
});

test("taendt sammen med kvitteringskontakten (#6490): den vej er allerede pagineret og uaendret", async () => {
  const calls = [];
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "on" }, error: null }) }) }) }),
    rpc: () => {
      const chain = { select: () => chain, order: () => chain, range: () => { calls.push("rpc-page"); return Promise.resolve({ data: [], error: null }); } };
      return chain;
    },
  };
  await peak.loadTeamTrainingRuns({ supabase, teamIds: ["team-01"], startDate: "2026-10-01", endDate: "2026-10-15", allRows: true });
  assert.deepEqual(calls, ["rpc-page"]);
  assert.equal(TRAINING_PEAK_FROM_TICKS_6490_FLAG_KEY, "training_peak_from_ticks_6490");
});

test("taendt: en fejl paa en side kaster, saa etapen venter i stedet for at koere paa en halv optakt", async () => {
  const supabase = {
    from(table) {
      if (table === "app_config") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      const chain = {
        select: () => chain, in: () => chain, gte: () => chain, lt: () => chain, order: () => chain,
        range: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
      };
      return chain;
    },
  };
  await assert.rejects(
    peak.loadTeamTrainingRuns({ supabase, teamIds: ["team-01"], startDate: "2026-10-01", endDate: "2026-10-15", allRows: true }),
    /training_day_runs \(peak leadup\)/,
  );
});

// ── Stemplet: kun loeb der ikke er startet ─────────────────────────────────

/** races-tabellen med kun de kald stemplet bruger, plus app_config til kontakten. */
function raceWorld(row, { flag = null, readError = null } = {}) {
  const calls = { updates: 0 };
  return {
    calls,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: flag == null ? null : { value: flag }, error: null }) }) }) };
      }
      assert.equal(table, "races");
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => (readError ? { data: null, error: readError } : { data: { ...row }, error: null }) }) }),
        update: (patch) => {
          const chain = {
            eq: () => chain, is: () => chain,
            then: (done) => {
              calls.updates += 1;
              if (row[KEY] == null && row.stages_completed === 0) Object.assign(row, patch);
              return Promise.resolve({ error: null }).then(done);
            },
          };
          return chain;
        },
      };
    },
  };
}

test("stempel: foerste claim med kontakten slukket stempler intet", async () => {
  for (const flag of [null, "off", "beta", "stop"]) {
    const row = { id: "race-1", stages_completed: 0, [KEY]: null };
    const db = raceWorld(row, { flag });
    assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: true }), false);
    assert.equal(db.calls.updates, 0);
  }
});

test("stempel: foerste claim med kontakten taendt stempler et ikke-startet loeb", async () => {
  const row = { id: "race-1", stages_completed: 0, [KEY]: null };
  const db = raceWorld(row, { flag: "on" });
  assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: true }), true);
  assert.equal(row[KEY], true);
});

test("stempel: dryRun svarer som taendt men skriver aldrig", async () => {
  const row = { id: "race-1", stages_completed: 0, [KEY]: null };
  const db = raceWorld(row, { flag: "on" });
  assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: true, dryRun: true }), true);
  assert.equal(db.calls.updates, 0);
  assert.equal(row[KEY], null);
});

test("stempel: et loeb der allerede koerer, skifter aldrig input, ogsaa med kontakten taendt", async () => {
  const row = { id: "race-1", stages_completed: 2, [KEY]: null };
  const db = raceWorld(row, { flag: "on" });
  assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: false }), false);
  // Selv en fejlagtig "foerste claim" paa et startet loeb binder ikke.
  assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: true }), false);
  assert.equal(row[KEY], null);
});

test("stempel: et stemplet loeb koerer faerdigt med hele optakten, ogsaa naar kontakten slukkes", async () => {
  for (const flag of [null, "off", "beta", "on"]) {
    const db = raceWorld({ id: "race-1", stages_completed: 3, [KEY]: true }, { flag });
    assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: false }), true, String(flag));
  }
});

test("stempel (Fable 26/11): genkoersel af etape 1 paa et stemplet loeb beholder hele optakten, ogsaa med kontakten slukket eller opslagsfejl", async () => {
  for (const flag of [null, "off", "beta"]) {
    const db = raceWorld({ id: "race-1", stages_completed: 0, [KEY]: true }, { flag });
    assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: true }), true, String(flag));
  }
  const failing = raceWorld({ id: "race-1", stages_completed: 0, [KEY]: true }, { flag: "on" });
  const result = await resolvePeakLeadupAllRows8180({
    supabase: failing, race: { id: "race-1" }, firstStageClaim: true,
    checkEnabled: async () => { throw new Error("opslag fejlede"); },
  });
  assert.equal(result, true);
});

test("stempel: stop er ejerens noedstop for stemplede loeb", async () => {
  const db = raceWorld({ id: "race-1", stages_completed: 3, [KEY]: true }, { flag: "stop" });
  assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: false }), false);
});

test("stempel: mangler kolonnen (migrationen ikke applied), er loebet ikke stemplet", async () => {
  const missing = { code: "42703", message: `column races.${KEY} does not exist` };
  for (const firstStageClaim of [true, false]) {
    const db = raceWorld({ id: "race-1", stages_completed: 0 }, { flag: "on", readError: missing });
    assert.equal(await resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim }), false);
  }
});

test("stempel: en anden laesefejl kaster, saa etapen venter", async () => {
  const db = raceWorld({ id: "race-1", stages_completed: 3 }, { readError: { code: "57014", message: "statement timeout" } });
  await assert.rejects(resolvePeakLeadupAllRows8180({ supabase: db, race: { id: "race-1" }, firstStageClaim: false }), /peak_leadup_all_rows_8180/);
});

// ── raceRunner: stemplet naar frem til optakten ────────────────────────────

for (const method of ["log", "warn", "error"]) mock.method(console, method, () => {});

async function stageWiring({ stageIndex, stamped }) {
  const seen = { resolve: [], tq: [] };
  const race = stageIndex === 0 ? { ...RACE_7733, stages_completed: 0 } : RACE_7733;
  await runStage7733({
    race,
    stageIndex,
    extraDeps: {
      resolvePeakLeadupAllRows8180: async (args) => { seen.resolve.push({ firstStageClaim: args.firstStageClaim, raceId: args.race?.id }); return stamped; },
      resolvePeakTrainingQualities: async (args) => { seen.tq.push(Object.keys(args).sort()); },
    },
  }).catch(() => {});
  return seen;
}

test("raceRunner: etape 2 laeser stemplet (ikke foerste claim) og sender allRows kun naar loebet er stemplet", async () => {
  const on = await stageWiring({ stageIndex: 1, stamped: true });
  assert.deepEqual(on.resolve, [{ firstStageClaim: false, raceId: RACE_7733.id }]);
  assert.deepEqual(on.tq, [["allRows", "entrants", "peakPlansByRider", "supabase"]]);
  const off = await stageWiring({ stageIndex: 1, stamped: false });
  assert.deepEqual(off.tq, [["entrants", "peakPlansByRider", "supabase"]], "slukket: samme argumenter som foer");
});

test("raceRunner: etape 1 i et ikke-startet loeb er foerste claim", async () => {
  const first = await stageWiring({ stageIndex: 0, stamped: true });
  assert.deepEqual(first.resolve, [{ firstStageClaim: true, raceId: RACE_7733.id }]);
  assert.deepEqual(first.tq, [["allRows", "entrants", "peakPlansByRider", "supabase"]]);
});

test("raceRunner: begge afviklingsveje binder optakten foer peak-konteksten", () => {
  const src = readFileSync(new URL("./raceRunner.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const binds = src.match(/const peakLeadupAllRows = v3 && await resolvePeakLeadupAllRowsFn\(\{ supabase, race, firstStageClaim(: true)?, dryRun \}\) === true;\n\s*if \(v3\) await attachPeakContext\(\{[^}]*peakLeadupAllRows \}\);/g) || [];
  assert.equal(binds.length, 2, "helt-løb-stien og etape-stien");
  assert.match(binds.join("\n"), /firstStageClaim: true, dryRun/, "helt-løb-stien er første claim");
});
