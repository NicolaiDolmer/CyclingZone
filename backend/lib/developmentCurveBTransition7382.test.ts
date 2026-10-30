// #7382: blød overgang når kurve B tændes.
//
// PARAMS er syntetiske testværdier, ikke kalibreringen (den er privat, hard rule 17).
// Rytteren er et alias: en signatur-evne over sit bløde loft, de øvrige evner under.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURVE_B_IGNITED_AT_CONFIG_KEY, CURVE_B_TRANSITION_DAYS, CURVE_B_TRANSITION_MEMBERS_TABLE,
  blendCurveBTransition, calendarDaysBetween, curveBTransitionAbilities, curveBTransitionForDate,
  ensureCurveBIgnition, ignitedOnFromConfigValue, loadCurveBTransitionRoster, readCurveBIgnitedOn,
  buildCurveBTransitionSnapshot, CURVE_B_IGNITE_RPC,
} from "./developmentCurveBTransition7382.ts";
import { curveBSoftCeiling, validateDevelopmentCurveBParams } from "./developmentCurveB.ts";
import { applyDailyTick, dailyAbilityDelta } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buildCapsForRider } from "./riderProgression.js";
import { ageForSeason } from "./riderSeasonAge.js";

const PARAMS = validateDevelopmentCurveBParams({
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.2, 0.3, 0.4, 0.5, 0.6, 1],
})!;
const CAP = 93;
const at = (v: number) => Object.fromEntries(VISIBLE_ABILITIES.map((k: string) => [k, v]));
const MAIN = "punch";
const POT = 4.5;
// Rytterens overgang med hovedevnen låst ind på tændingsdagen.
const tr = (weight: number, abilities: string[] = [MAIN]) => ({ weight, abilities });

function tick(over: Record<string, unknown> = {}) {
  return applyDailyTick({
    riderId: "rider-A", dateStr: "2026-10-31", age: 27,
    abilities: { ...at(20), [MAIN]: 80 }, caps: at(CAP), progress: {},
    program: { focus: "vo2max_punch", intensity: "hard" }, conditionMult: 1, potentiale: POT,
    primaryType: "puncheur", secondaryType: null, hardDailyCap: 1, ...over,
  });
}
const prog = (r: { progress: Record<string, number> }, k: string) => Number(r.progress[k] ?? 0);

test("fixturen: hovedevnen står over det bløde loft, de andre under (ellers tester vi intet)", () => {
  const soft = curveBSoftCeiling(CAP, POT, PARAMS);
  assert.ok(80 >= soft && 80 < CAP);
  assert.ok(20 < soft);
});

test("kalenderdage: hele dage, dansk dato ind, ugyldigt = null", () => {
  assert.equal(calendarDaysBetween("2026-10-30", "2026-10-30"), 0);
  assert.equal(calendarDaysBetween("2026-10-30", "2026-11-13"), 14);
  assert.equal(calendarDaysBetween("2026-10-24", "2026-10-26"), 2, "hen over sommertidens slutning");
  assert.equal(calendarDaysBetween("2026-10-31", "2026-10-30"), -1);
  assert.equal(calendarDaysBetween(null, "2026-10-30"), null);
  assert.equal(calendarDaysBetween("30/10", "2026-10-30"), null);
});

test("vinduet: 0 på startdagen, lineært, slut efter 14 dage; intet stempel = ingen overgang", () => {
  assert.equal(CURVE_B_TRANSITION_DAYS, 14);
  assert.equal(curveBTransitionForDate({ ignitedOn: null, tickDate: "2026-10-31" }), null);
  assert.deepEqual(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-30" }),
    { weight: 0, ignitedOn: "2026-10-30" });
  assert.deepEqual(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-06" }),
    { weight: 0.5, ignitedOn: "2026-10-30" });
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-12" })?.weight, 13 / 14);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-13" }), null, "dag 14 = kun kurve B");
  const before = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-29" });
  assert.equal(before?.weight, 0, "dato før start = gamle fart");
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-31", days: 0 }), null);
});

test("vinduet: 14 daglige ticks fra og med den første aktive dag, den første med den gamle models fulde fart", () => {
  const start = "2026-10-30";
  const weights: number[] = [];
  for (let d = 0; d < 30; d++) {
    const tickDate = new Date(Date.parse(`${start}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    const t = curveBTransitionForDate({ ignitedOn: start, tickDate });
    if (t) weights.push(t.weight);
  }
  assert.equal(weights.length, CURVE_B_TRANSITION_DAYS);
  assert.equal(weights[0], 0);
  assert.ok(weights.every((w, i) => i === 0 || w > weights[i - 1]), "stigende");
  assert.ok(weights.every((w) => w < 1));
});

test("medlemskabet: evnerne på eller over det bløde loft, sorteret; uden loft eller ugyldig evne ikke med", () => {
  assert.deepEqual(curveBTransitionAbilities({ abilities: { ...at(20), [MAIN]: 80 }, caps: at(CAP), potentiale: POT, curveB: PARAMS }), [MAIN]);
  const soft = curveBSoftCeiling(CAP, POT, PARAMS);
  assert.deepEqual(curveBTransitionAbilities({ abilities: { sprint: soft, climbing: soft - 1e-9, [MAIN]: 80 }, caps: at(CAP), potentiale: POT, curveB: PARAMS }),
    [MAIN, "sprint"].sort(), "på loftet tæller som over");
  assert.deepEqual(curveBTransitionAbilities({ abilities: { [MAIN]: "x" }, caps: at(CAP), potentiale: POT, curveB: PARAMS }), []);
  assert.deepEqual(curveBTransitionAbilities({ abilities: null, caps: null, potentiale: POT, curveB: PARAMS }), []);
});

test("blanding: kun låste evner, lineær, aldrig negativ, gammel model regnes kun når den bruges", () => {
  const half = tr(0.5);
  let calls = 0;
  const old = () => { calls++; return 1; };
  assert.equal(blendCurveBTransition({ ability: "sprint", curveBDelta: 0.2, oldDelta: old, transition: half }), 0.2);
  assert.equal(calls, 0, "ikke låst ind: gamle model regnes ikke");
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: old, transition: null }), 0.2);
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: 1, transition: tr(0) }), 1);
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: 1, transition: half }), 0.6);
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: -1, oldDelta: -1, transition: half }), 0);
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: Number.NaN, transition: half }), 0.2, "ugyldig gammel = kurve B");
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: 0.05, transition: tr(0) }), 0.2,
    "gamle model langsommere: kurve B, overgangen bremser aldrig");
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: 1, transition: tr(1) }), 0.2);
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: 1, transition: tr(Number.NaN) }), 0.2);
  assert.equal(blendCurveBTransition({ ability: MAIN, curveBDelta: 0.2, oldDelta: 1, transition: { weight: 0.5 } as never }), 0.2, "uden låst liste = kurve B");
});

test("stemplet: motorens danske dato læses uændret, et tidsstempel bliver dansk kalenderdato", () => {
  assert.equal(ignitedOnFromConfigValue("2026-10-31"), "2026-10-31");
  assert.equal(ignitedOnFromConfigValue("2026-02-30"), null, "ikke en rigtig dato");
  assert.equal(ignitedOnFromConfigValue("2026-10-30T20:15:00+00:00"), "2026-10-30");
  assert.equal(ignitedOnFromConfigValue("2026-10-30T23:30:00Z"), "2026-10-31", "efter midnat dansk tid");
  assert.equal(ignitedOnFromConfigValue(null), null);
  assert.equal(ignitedOnFromConfigValue("ikke en dato"), null);
  assert.equal(ignitedOnFromConfigValue(true), null);
});

function fakeConfig(result: { data?: unknown; error?: unknown }) {
  const seen: string[] = [];
  return {
    seen,
    from(table: string) {
      seen.push(table);
      const q = {
        select: () => q,
        eq: (col: string, val: string) => { seen.push(`${col}=${val}`); return q; },
        maybeSingle: async () => result,
      };
      return q;
    },
  };
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test("læsning: nøglen fra app_config; fejl = ingen overgang, men kaster på den strikse sti", async () => {
  const ok = fakeConfig({ data: { value: "2026-10-30T20:15:00+00:00" }, error: null });
  assert.equal(await readCurveBIgnitedOn(ok), "2026-10-30");
  assert.deepEqual(ok.seen, ["app_config", `key=${CURVE_B_IGNITED_AT_CONFIG_KEY}`]);
  assert.equal(await readCurveBIgnitedOn(fakeConfig({ data: null, error: null })), null);
  assert.equal(await quiet(() => readCurveBIgnitedOn(fakeConfig({ data: null, error: { message: "nede" } }))), null);
  await assert.rejects(readCurveBIgnitedOn(fakeConfig({ data: null, error: { message: "nede" } }), { strict: true }));
});

// En lille database: app_config, teams, riders, rider_derived_abilities og medlemstabellen.
// upsert med ignoreDuplicates = insert ... on conflict do nothing. `fail` = { "tabel:op": besked }.
type Row = Record<string, any>;
const CONFLICT: Record<string, string[]> = { app_config: ["key"], [CURVE_B_TRANSITION_MEMBERS_TABLE]: ["rider_id", "ignited_on"] };
// rpc = database-funktionen: under laasen skriver den raekker + stempel, eller intet hvis stemplet staar der.
function fakeDb(tables: Record<string, Row[]>, { fail = {} as Record<string, string>, beforeRpc = null as null | (() => void) } = {}) {
  const log: string[] = [];
  const db = {
    tables, log, fail,
    async rpc(fn: string, args: Row) {
      log.push(`rpc:${fn}`);
      beforeRpc?.();
      if (fail.rpc) return { data: null, error: { message: fail.rpc } };
      assert.equal(fn, CURVE_B_IGNITE_RPC);
      tables.app_config ??= [];
      tables[CURVE_B_TRANSITION_MEMBERS_TABLE] ??= [];
      const existing = tables.app_config.find((r) => r.key === CURVE_B_IGNITED_AT_CONFIG_KEY);
      if (existing) return { data: existing.value, error: null };
      for (const m of args.p_members) {
        if (!(tables.riders ?? []).some((r) => r.id === m.rider_id)) continue;
        if (tables[CURVE_B_TRANSITION_MEMBERS_TABLE].some((x) => x.rider_id === m.rider_id && x.ignited_on === args.p_ignited_on)) continue;
        tables[CURVE_B_TRANSITION_MEMBERS_TABLE].push({ rider_id: m.rider_id, ignited_on: args.p_ignited_on, abilities: m.abilities });
      }
      tables.app_config.push({ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: args.p_ignited_on });
      return { data: args.p_ignited_on, error: null };
    },
    from(table: string) {
      tables[table] ??= [];
      const filters: Array<(r: Row) => boolean> = [];
      let range: [number, number] | null = null;
      const run = () => {
        log.push(`${table}:select`);
        if (fail[`${table}:select`]) return { data: null, error: { message: fail[`${table}:select`] } };
        let rows = tables[table].filter((r) => filters.every((f) => f(r)));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return { data: rows.map((r) => ({ ...r })), error: null };
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        in: (c: string, v: unknown[]) => { log.push(`${table}:in:${v.length}`); filters.push((r) => v.includes(r[c])); return q; },
        order: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q; },
        maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(run()).then(resolve, reject),
        upsert: async (input: Row | Row[], opts: Row) => {
          const batch = [input].flat();
          log.push(`${table}:upsert:${batch.length}`);
          if (fail[`${table}:upsert`]) return { error: { message: fail[`${table}:upsert`] } };
          assert.equal(opts?.ignoreDuplicates, true, "on conflict do nothing");
          const keys = CONFLICT[table];
          for (const r of batch) if (!tables[table].some((x) => keys.every((k) => x[k] === r[k]))) tables[table].push({ ...r });
          return { error: null };
        },
      };
      return q;
    },
  };
  return db;
}

const stampOf = (db: { tables: Record<string, Row[]> }) => db.tables.app_config?.find((r) => r.key === CURVE_B_IGNITED_AT_CONFIG_KEY)?.value ?? null;
const membersOf = (db: { tables: Record<string, Row[]> }) => db.tables[CURVE_B_TRANSITION_MEMBERS_TABLE] ?? [];
const SEASON = 1;
const HIGH = at(85);
const LOW = at(10);
const abilityRow = (rider_id: string, values: Record<string, number>) => ({ rider_id, ...values });
const rider = (id: string, team_id: string | null, extra: Row = {}) => ({ id, team_id, potentiale: 4, birthdate: "2003-01-01", primary_type: "climber", secondary_type: null, is_retired: false, ...extra });
// Managerhold-reglen (samme som motorens isManagerTeamForDevelopment).
const isManagerTeam = (t: Row) => t.user_id != null && t.is_ai !== true && t.is_bank !== true && t.is_test_account !== true;
// Hold M1 (manager), AI, bank, testkonto og et hold uden manager.
function world(extra: Partial<Record<string, Row[]>> = {}) {
  return {
    app_config: [] as Row[],
    teams: [
      { id: "M1", user_id: "u1", is_ai: false, is_bank: false, is_test_account: false },
      { id: "AI", user_id: "u-ai", is_ai: true, is_bank: false, is_test_account: false },
      { id: "BANK", user_id: "u-bank", is_ai: false, is_bank: true, is_test_account: false },
      { id: "TEST", user_id: "u-test", is_ai: null, is_bank: null, is_test_account: true },
      { id: "FREE", user_id: null, is_ai: false, is_bank: false, is_test_account: false },
    ],
    riders: [rider("A", "M1"), rider("B", "M1"), rider("R", "M1", { is_retired: true }),
      rider("X", "AI"), rider("Y", "BANK"), rider("Z", "TEST"), rider("F", "FREE"), rider("N", null)],
    rider_derived_abilities: ["A", "R", "X", "Y", "Z", "F", "N"].map((id) => abilityRow(id, HIGH)).concat([abilityRow("B", LOW)]),
    [CURVE_B_TRANSITION_MEMBERS_TABLE]: [] as Row[],
    ...extra,
  } as Record<string, Row[]>;
}
const ignite = (db: ReturnType<typeof fakeDb>, over: Row = {}) =>
  ensureCurveBIgnition(db, { now: NOW_7382, curveB: PARAMS, seasonNumber: SEASON, isManagerTeam, ...over } as never);
// 30/10 kl. 23:30 UTC = 31/10 dansk tid.
const NOW_7382 = new Date("2026-10-30T23:30:00Z");
const TODAY_7382 = "2026-10-31";

test("fixturen: rytter A står over loftet med motorens loft, rytter B under (ellers tester vi intet)", async () => {
  const db = fakeDb(world());
  const rows = await buildCurveBTransitionSnapshot(db, { curveB: PARAMS, seasonNumber: SEASON, isManagerTeam });
  assert.ok(!db.log.some((l) => l.includes("upsert") || l.startsWith("rpc")), "billedet beregnes uden at skrive");
  const byId = new Map(rows.map((r) => [r.rider_id, r.abilities]));
  assert.ok(byId.get("A").length > 0);
  assert.deepEqual(byId.get("B"), []);
});

test("tændingen: stempler dagens danske dato ud fra now (ingen tick-dato), og øjebliksbilledet nøgles på den", async () => {
  const db = fakeDb(world());
  assert.equal(await ignite(db), TODAY_7382);
  assert.equal(stampOf(db), TODAY_7382, "efter midnat dansk tid = næste dato");
  assert.ok(membersOf(db).every((r) => r.ignited_on === TODAY_7382));
  assert.deepEqual(Object.keys(membersOf(db)[0]).sort(), ["abilities", "ignited_on", "rider_id"], "ingen measured_on");
});

test("øjebliksbilledet: alle ryttere på managerhold (også tomme rækker), ingen AI/bank/test/uden manager/pensionerede", async () => {
  const db = fakeDb(world());
  await ignite(db);
  assert.deepEqual(membersOf(db).map((r) => r.rider_id).sort(), ["A", "B"]);
  const a = membersOf(db).find((r) => r.rider_id === "A");
  const caps = buildCapsForRider({ ...HIGH }, { potentiale: 4, age: ageForSeason("2003-01-01", SEASON) }, "climber", null);
  assert.deepEqual(a.abilities, curveBTransitionAbilities({ abilities: HIGH, caps, potentiale: 4, curveB: PARAMS }), "samme loft som motoren");
});

test("øjebliksbilledet tages én gang: står stemplet der, læses intet andet end nøglen", async () => {
  const db = fakeDb(world());
  await ignite(db);
  const before = db.log.length;
  db.tables.rider_derived_abilities.push(abilityRow("B2", HIGH));
  db.tables.riders.push(rider("B2", "M1"));
  assert.equal(await ignite(db, { now: new Date("2026-11-05T10:00:00Z") }), TODAY_7382, "næste dag: samme start");
  assert.deepEqual(db.log.slice(before), ["app_config:select"]);
  assert.ok(!membersOf(db).some((r) => r.rider_id === "B2"), "tilkommen rytter får ingen række");
  const hand = fakeDb(world({ app_config: [{ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "ikke en dato" }] }));
  assert.equal(await ignite(hand), null);
  assert.deepEqual(hand.log, ["app_config:select"], "en ugyldig værdi i hånden overskrives ikke, og intet billede");
});

test("atomart: billede og stempel skrives i ét kald, efter at billedet er beregnet", async () => {
  const db = fakeDb(world());
  await ignite(db);
  assert.equal(db.log.filter((l) => l.startsWith("rpc:")).length, 1);
  assert.ok(db.log.indexOf(`rpc:${CURVE_B_IGNITE_RPC}`) > db.log.lastIndexOf("rider_derived_abilities:select"));
  assert.ok(!db.log.some((l) => l.includes("upsert")), "ingen løse skrivninger uden for funktionen");
});

test("atomart (Codex 30/10): en samtidig kørsel der tændte imens, lukker billedet; en tilkommen rytter kommer ikke med", async () => {
  const db = fakeDb(world(), { beforeRpc: () => {
    // Den anden kørsel nåede først: den har tændt med sit billede (kun A og B).
    if (stampOf(db) == null) {
      db.tables.app_config.push({ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "2026-10-30" });
      db.tables[CURVE_B_TRANSITION_MEMBERS_TABLE].push({ rider_id: "A", ignited_on: "2026-10-30", abilities: [MAIN] }, { rider_id: "B", ignited_on: "2026-10-30", abilities: [] });
    }
  } });
  db.tables.riders.push(rider("NEW", "M1"));
  db.tables.rider_derived_abilities.push(abilityRow("NEW", HIGH));
  assert.equal(await ignite(db, { strict: true }), "2026-10-30", "det stempel der står, gælder");
  assert.deepEqual(membersOf(db).map((r) => r.rider_id).sort(), ["A", "B"], "intet tilføjet til et lukket billede");
});

for (const failAt of ["teams:select", "riders:select", "rider_derived_abilities:select", "rpc"]) {
  test(`tændingen: fejl i billedet (${failAt}) efterlader intet stempel; strict kaster; næste kørsel prøver igen`, async () => {
    const db = fakeDb(world(), { fail: { [failAt]: "nede" } });
    assert.equal(await quiet(() => ignite(db)), null, "uden strict: ingen overgang i kørslen");
    assert.equal(stampOf(db), null);
    await assert.rejects(ignite(db, { strict: true }), /nede/);
    assert.equal(stampOf(db), null);
    delete db.fail[failAt];
    assert.equal(await ignite(db, { strict: true }), TODAY_7382, "næste kørsel tager billedet og stempler");
    assert.deepEqual(membersOf(db).map((r) => r.rider_id).sort(), ["A", "B"]);
  });
}

test("tændingen: fejl i nøglens læsning = intet billede; strict kaster", async () => {
  const read = fakeDb(world(), { fail: { "app_config:select": "nede" } });
  assert.equal(await quiet(() => ignite(read)), null);
  assert.ok(!read.log.includes("teams:select"), "en fejlet læsning tager aldrig et billede");
  await assert.rejects(ignite(read, { strict: true }), /nede/);
  await assert.rejects(ignite(fakeDb(world()), { seasonNumber: Number.NaN, strict: true }), /seasonNumber/);
});

test("øjebliksbilledet: .in()-lister i bidder af højst 100 (URL-grænsen), alle ryttere kommer med", async () => {
  const many = Array.from({ length: 250 }, (_, i) => rider(`m${String(i).padStart(3, "0")}`, "M1"));
  const db = fakeDb(world({ riders: many, rider_derived_abilities: many.map((r) => abilityRow(r.id, HIGH)) }));
  await ignite(db);
  assert.equal(membersOf(db).length, 250);
  const inSizes = db.log.filter((l) => l.startsWith("rider_derived_abilities:in:")).map((l) => Number(l.split(":")[2]));
  assert.ok(inSizes.length >= 3 && inSizes.every((n) => n <= 100), inSizes.join(","));
});

const DAY7 = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-06" })!;

test("roster: kun rækken i øjebliksbilledet tæller; ingen eller tom række = kurve B", async () => {
  const db = fakeDb({ [CURVE_B_TRANSITION_MEMBERS_TABLE]: [
    { rider_id: "A", ignited_on: "2026-10-30", abilities: [MAIN] },
    { rider_id: "B", ignited_on: "2026-10-30", abilities: [] },
    { rider_id: "C", ignited_on: "2026-09-01", abilities: [MAIN] },
  ] });
  const roster = await loadCurveBTransitionRoster(db, { transition: DAY7, riderIds: ["A", "B", "C", "D"] });
  assert.deepEqual(roster.forRider("A"), { weight: 0.5, abilities: [MAIN] });
  assert.equal(roster.forRider("B"), null, "tom række (krydser loftet senere): kurve B");
  assert.equal(roster.forRider("C"), null, "en række fra en tidligere tænding tæller ikke");
  assert.equal(roster.forRider("D"), null, "tilkommen rytter uden række: kurve B hele vejen");
  assert.ok(!db.log.some((l) => l.includes("upsert")), "roster skriver aldrig");
  const BEFORE = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-28" })!;
  const early = await loadCurveBTransitionRoster(db, { transition: BEFORE, riderIds: ["A"] });
  assert.deepEqual(early.forRider("A"), { weight: 0, abilities: [MAIN] }, "efterslæb før tændingen: vægt 0");
});

test("roster: læser i bidder af højst 100; en fejlet læsning = kurve B fuldt, strict kaster", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `r${i}`);
  const db = fakeDb({ [CURVE_B_TRANSITION_MEMBERS_TABLE]: [] });
  await loadCurveBTransitionRoster(db, { transition: DAY7, riderIds: ids });
  assert.deepEqual(db.log.filter((l) => l.includes(":in:")), [`${CURVE_B_TRANSITION_MEMBERS_TABLE}:in:100`, `${CURVE_B_TRANSITION_MEMBERS_TABLE}:in:100`, `${CURVE_B_TRANSITION_MEMBERS_TABLE}:in:50`]);
  const failing = fakeDb({ [CURVE_B_TRANSITION_MEMBERS_TABLE]: [{ rider_id: "A", ignited_on: "2026-10-30", abilities: [MAIN] }] },
    { fail: { [`${CURVE_B_TRANSITION_MEMBERS_TABLE}:select`]: "nede" } });
  const roster = await quiet(() => loadCurveBTransitionRoster(failing, { transition: DAY7, riderIds: ["A"] }));
  assert.equal(roster.forRider("A"), null);
  await assert.rejects(loadCurveBTransitionRoster(failing, { transition: DAY7, riderIds: ["A"], strict: true }), /nede/);
});

test("tick: en evne der krydser loftet inde i vinduet, får kurve B (ingen spring op til den gamle fart)", () => {
  const b = tick({ curveB: PARAMS });
  const crossed = tick({ curveB: PARAMS, curveBTransition: tr(0.5, []) });
  assert.deepEqual(crossed, b, "ikke låst ind = kurve B, bit for bit");
  const other = tick({ curveB: PARAMS, curveBTransition: tr(0.5, ["sprint"]) });
  assert.equal(prog(other, MAIN), prog(b, MAIN), "kun de låste evner blandes");
});


test("flag off: overgangen ignoreres uden kurve B (bit-identisk)", () => {
  assert.deepEqual(tick({ curveBTransition: tr(0) }), tick());
});

test("kurve B uden overgang (null) er bit-identisk med før #7382", () => {
  assert.deepEqual(tick({ curveB: PARAMS, curveBTransition: null }), tick({ curveB: PARAMS }));
});

test("tændingsdagen: den låste evne får den gamle models fart, de andre evner kurve B", () => {
  const old = tick();
  const b = tick({ curveB: PARAMS });
  const day0 = tick({ curveB: PARAMS, curveBTransition: tr(0) });
  assert.ok(prog(old, MAIN) > prog(b, MAIN), "fixturen: gamle model er hurtigere over loftet");
  assert.equal(prog(day0, MAIN), prog(old, MAIN));
  for (const k of VISIBLE_ABILITIES) {
    if (k === MAIN) continue;
    assert.equal(prog(day0, k), prog(b, k), `${k} under loftet: kurve B fra dag 1`);
  }
});

test("over 14 dage glider hovedevnen jævnt ned til kurve B, aldrig negativ", () => {
  const old = prog(tick(), MAIN);
  const b = prog(tick({ curveB: PARAMS }), MAIN);
  let prev = Infinity;
  for (let d = 0; d < CURVE_B_TRANSITION_DAYS; d++) {
    const w = d / CURVE_B_TRANSITION_DAYS;
    const v = prog(tick({ curveB: PARAMS, curveBTransition: tr(w) }), MAIN);
    assert.ok(v > 0, `dag ${d}`);
    assert.ok(v < prev, `dag ${d}: aftagende`);
    assert.ok(Math.abs(v - ((1 - w) * old + w * b)) < 1e-12, `dag ${d}: lineær`);
    prev = v;
  }
  assert.ok(prev > b, "sidste dag i vinduet er stadig lidt over kurve B");
});

test("overgangen giver aldrig mindre end kurve B, for alle aldre og potentialer", () => {
  for (const age of [17, 21, 25, 29, 33, 36]) {
    for (const potentiale of [1, 2.5, 4.5, 6]) {
      const b = tick({ age, potentiale, curveB: PARAMS });
      for (const weight of [0, 0.5, 13 / 14]) {
        const t = tick({ age, potentiale, curveB: PARAMS, curveBTransition: tr(weight, [...VISIBLE_ABILITIES]) });
        for (const k of VISIBLE_ABILITIES) assert.ok(prog(t, k) >= prog(b, k) - 1e-12, `alder ${age}, pot ${potentiale}, ${k}`);
      }
    }
  }
});

test("ingen loft-mur: evnen på det hårde loft får intet, heller ikke i overgangen", () => {
  const r = tick({ curveB: PARAMS, curveBTransition: tr(0), abilities: { ...at(20), [MAIN]: CAP } });
  assert.equal(prog(r, MAIN), 0);
  assert.equal(r.gains[MAIN] ?? 0, 0);
});

test("gamle model i overgangen = tick uden kurve, med den alders-afhængige score (alle aldre)", () => {
  const day0 = (age: number) => prog(tick({ age, curveB: PARAMS, curveBTransition: tr(0) }), MAIN);
  const old = (age: number) => prog(tick({ age }), MAIN);
  for (const age of [19, 27, 34]) assert.equal(day0(age), old(age), `alder ${age}`);
  assert.notEqual(old(19), old(34), "kontrol: den gamle models fart afhænger af alderen (ikke alders-neutral)");
});

test("fixturen for blandingen: gamle model er hurtigere end kurve B over loftet", () => {
  const program = { focus: "vo2max_punch", intensity: "hard" };
  const args = { ability: MAIN, current: 80, cap: CAP, age: 27, program, conditionMult: 1, noise: 1,
    potentiale: POT, primaryType: "puncheur", secondaryType: null };
  const old = dailyAbilityDelta(args);
  const b = dailyAbilityDelta({ ...args, curveB: PARAMS });
  assert.ok(old > b && b > 0);
});

test("Udviklingsscore B: den gamle model i overgangen bruger scorens led, som uden kurve B", () => {
  const developmentScore = { score: 60, devMult: 1.3, kind: "training" };
  const old = tick({ developmentScore });
  const b = tick({ developmentScore, curveB: PARAMS });
  const day0 = tick({ developmentScore, curveB: PARAMS, curveBTransition: tr(0) });
  assert.notEqual(prog(old, MAIN), prog(tick(), MAIN), "kontrol: scoren B ændrer den gamle model");
  assert.ok(prog(old, MAIN) > prog(b, MAIN), "kontrol: gamle model hurtigere over loftet");
  assert.equal(prog(day0, MAIN), prog(old, MAIN), "dag 0 = den gamle model med scorens led");
  const half = tick({ developmentScore, curveB: PARAMS, curveBTransition: tr(0.5) });
  assert.ok(Math.abs(prog(half, MAIN) - (prog(old, MAIN) + prog(b, MAIN)) / 2) < 1e-12, "lineær blanding");
  for (const k of VISIBLE_ABILITIES) {
    if (k === MAIN) continue;
    assert.equal(prog(day0, k), prog(b, k), `${k} under loftet: kurve B`);
  }
});
