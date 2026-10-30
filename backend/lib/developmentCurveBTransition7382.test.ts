// #7382: blød overgang når kurve B tændes.
//
// PARAMS er syntetiske testværdier, ikke kalibreringen (den er privat, hard rule 17).
// Rytteren er et alias: en signatur-evne over sit bløde loft, de øvrige evner under.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURVE_B_IGNITED_AT_CONFIG_KEY, CURVE_B_TRANSITION_DAYS, CURVE_B_TRANSITION_MEMBERS_TABLE,
  blendCurveBTransition, calendarDaysBetween, curveBTransitionAbilities, curveBTransitionForDate,
  ensureCurveBIgnitedOn, ignitedOnFromConfigValue, loadCurveBTransitionRoster, readCurveBIgnitedOn,
} from "./developmentCurveBTransition7382.ts";
import { curveBSoftCeiling, validateDevelopmentCurveBParams } from "./developmentCurveB.ts";
import { applyDailyTick, dailyAbilityDelta } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

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
    { weight: 0, ignitedOn: "2026-10-30", ignitionDay: true, tickDate: "2026-10-30" });
  assert.deepEqual(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-06" }),
    { weight: 0.5, ignitedOn: "2026-10-30", ignitionDay: false, tickDate: "2026-11-06" });
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-12" })?.weight, 13 / 14);
  assert.equal(curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-13" }), null, "dag 14 = kun kurve B");
  const before = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-29" });
  assert.equal(before?.weight, 0, "dato før start = gamle fart");
  assert.equal(before?.ignitionDay, false, "en dato før starten låser intet medlemskab");
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

// app_config som en lille tabel: upsert med ignoreDuplicates = insert ... on conflict do nothing.
function fakeConfigTable(rows: Array<{ key: string; value: unknown }>, { upsertError = null as unknown, readError = null as unknown } = {}) {
  const upserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  let reads = 0;
  return {
    rows, upserts,
    get reads() { return reads; },
    from(_table: string) {
      let key: string | undefined;
      const q = {
        select: () => q,
        eq: (_col: string, val: string) => { key = val; return q; },
        maybeSingle: async () => {
          reads++;
          if (readError) return { data: null, error: readError };
          return { data: rows.find((r) => r.key === key) ?? null, error: null };
        },
        upsert: async (row: { key: string; value: unknown }, opts: Record<string, unknown>) => {
          upserts.push({ row, opts });
          if (upsertError) return { error: upsertError };
          const i = rows.findIndex((r) => r.key === row.key);
          if (i < 0) rows.push({ key: row.key, value: row.value });
          else if (!opts?.ignoreDuplicates) rows[i] = { key: row.key, value: row.value };
          return { error: null };
        },
      };
      return q;
    },
  };
}

test("stempling: første aktive dag stemples med tick-datoen, et eksisterende stempel overskrives aldrig", async () => {
  const db = fakeConfigTable([]);
  assert.equal(await ensureCurveBIgnitedOn(db, { tickDate: "2026-10-31" }), "2026-10-31");
  assert.deepEqual(db.upserts[0].opts, { onConflict: "key", ignoreDuplicates: true });
  assert.equal(db.upserts[0].row.key, CURVE_B_IGNITED_AT_CONFIG_KEY);
  assert.equal(await ensureCurveBIgnitedOn(db, { tickDate: "2026-11-05" }), "2026-10-31", "næste dag: samme start");
  assert.deepEqual(db.rows, [{ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "2026-10-31" }]);
});

test("stempling: læser først, og skriver kun når nøglen mangler (ingen skrivning efter vinduet)", async () => {
  const db = fakeConfigTable([{ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "2026-10-01" }]);
  for (const tickDate of ["2026-10-05", "2026-10-15", "2026-12-01"]) {
    assert.equal(await ensureCurveBIgnitedOn(db, { tickDate }), "2026-10-01");
  }
  assert.equal(db.upserts.length, 0, "nøglen står der: intet upsert, heller ikke efter vinduet");
  assert.equal(db.reads, 3, "én læsning pr. kørsel");
  const fresh = fakeConfigTable([]);
  await ensureCurveBIgnitedOn(fresh, { tickDate: "2026-10-31" });
  await ensureCurveBIgnitedOn(fresh, { tickDate: "2026-11-01" });
  assert.equal(fresh.upserts.length, 1, "kun den første kørsel stempler");
  const junk = fakeConfigTable([{ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "ikke en dato" }]);
  assert.equal(await ensureCurveBIgnitedOn(junk, { tickDate: "2026-10-31" }), null);
  assert.equal(junk.upserts.length, 0, "en ugyldig værdi i hånden overskrives ikke");
});

test("stempling: fejl = ingen ny start, men kaster på den strikse sti", async () => {
  await quiet(async () => {
    const failing = fakeConfigTable([{ key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: "2026-10-30" }], { upsertError: { message: "nede" } });
    assert.equal(await ensureCurveBIgnitedOn(failing, { tickDate: "2026-10-31" }), "2026-10-30");
    assert.equal(await ensureCurveBIgnitedOn(fakeConfigTable([], { upsertError: { message: "nede" } }), { tickDate: "2026-10-31" }), null);
    const unreadable = fakeConfigTable([], { readError: { message: "nede" } });
    assert.equal(await ensureCurveBIgnitedOn(unreadable, { tickDate: "2026-10-31" }), null);
    assert.equal(unreadable.upserts.length, 0, "en fejlet læsning stempler aldrig");
    const bad = fakeConfigTable([]);
    assert.equal(await ensureCurveBIgnitedOn(bad, { tickDate: "31/10" }), null);
    assert.equal(bad.upserts.length, 0, "ugyldig dato stemples aldrig");
  });
  await assert.rejects(ensureCurveBIgnitedOn(fakeConfigTable([], { upsertError: { message: "nede" } }), { tickDate: "2026-10-31", strict: true }));
  await assert.rejects(ensureCurveBIgnitedOn(fakeConfigTable([], { readError: { message: "nede" } }), { tickDate: "2026-10-31", strict: true }));
});

// Medlemstabellen som en lille tabel med (rider_id, ignited_on) som nøgle.
type MemberRow = { rider_id: string; ignited_on: string; measured_on?: string; abilities: string[] };
function fakeMembers(rows: MemberRow[], { readError = null as unknown, writeError = null as unknown } = {}) {
  const upserts: Array<{ rows: MemberRow[]; opts: Record<string, unknown> }> = [];
  const tables: string[] = [];
  return {
    rows, upserts, tables,
    from(table: string) {
      tables.push(table);
      const f: { ignited_on?: string; ids?: string[] } = {};
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => { f.ignited_on = v; return q; },
        in: (_c: string, v: string[]) => {
          f.ids = v;
          return Promise.resolve(readError ? { data: null, error: readError }
            : { data: rows.filter((r) => r.ignited_on === f.ignited_on && f.ids!.includes(r.rider_id)), error: null });
        },
        upsert: async (batch: MemberRow[], opts: Record<string, unknown>) => {
          upserts.push({ rows: batch, opts });
          if (writeError) return { error: writeError };
          for (const r of batch) if (!rows.some((x) => x.rider_id === r.rider_id && x.ignited_on === r.ignited_on)) rows.push(r);
          return { error: null };
        },
      };
      return q;
    },
  };
}

const DAY0 = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-30" })!;
const DAY7 = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-06" })!;
const over = { ...at(20), [MAIN]: 80 };
const under = at(20);
const riderArgs = (riderId: string, abilities: Record<string, number>) => ({ riderId, abilities, caps: at(CAP), potentiale: POT });

test("roster, tændingsdagen: måler før tick'et, låser og gemmer én række pr. rytter (også tom)", async () => {
  const db = fakeMembers([]);
  const roster = await loadCurveBTransitionRoster(db, { transition: DAY0, curveB: PARAMS, riderIds: ["A", "B"] });
  assert.deepEqual(roster.forRider(riderArgs("A", over)), { weight: 0, abilities: [MAIN] });
  assert.equal(roster.forRider(riderArgs("B", under)), null, "ingen evne over loftet: kurve B fuldt");
  await roster.persist();
  assert.equal(db.upserts.length, 1);
  assert.deepEqual(db.upserts[0].opts, { onConflict: "rider_id,ignited_on", ignoreDuplicates: true });
  assert.deepEqual(db.rows, [
    { rider_id: "A", ignited_on: "2026-10-30", measured_on: "2026-10-30", abilities: [MAIN] },
    { rider_id: "B", ignited_on: "2026-10-30", measured_on: "2026-10-30", abilities: [] },
  ]);
  assert.ok(db.tables.every((t) => t === CURVE_B_TRANSITION_MEMBERS_TABLE));
  await roster.persist();
  assert.equal(db.upserts.length, 1, "intet nyt at gemme");
});

test("roster, tændingsdagens næste løbsdag: den første kørsel vinder, en evne der lige har krydset er ikke med", async () => {
  const db = fakeMembers([{ rider_id: "B", ignited_on: "2026-10-30", abilities: [] }]);
  const roster = await loadCurveBTransitionRoster(db, { transition: DAY0, curveB: PARAMS, riderIds: ["B"] });
  assert.equal(roster.forRider(riderArgs("B", over)), null, "den låste (tomme) række gælder, ikke dagens evne");
  await roster.persist();
  assert.equal(db.upserts.length, 0);
});

test("roster, inde i vinduet: kun den låste række tæller; krydser evnen loftet senere, får den kurve B", async () => {
  const db = fakeMembers([
    { rider_id: "A", ignited_on: "2026-10-30", abilities: [MAIN] },
    { rider_id: "B", ignited_on: "2026-10-30", abilities: [] },
    { rider_id: "C", ignited_on: "2026-09-01", abilities: [MAIN] },
  ]);
  const roster = await loadCurveBTransitionRoster(db, { transition: DAY7, curveB: PARAMS, riderIds: ["A", "B", "C", "D"] });
  assert.deepEqual(roster.forRider(riderArgs("A", under)), { weight: 0.5, abilities: [MAIN] }, "låst ind: blandingen, uanset dagens evne");
  assert.equal(roster.forRider(riderArgs("B", over)), null, "krydset inde i vinduet: kurve B");
  assert.equal(roster.forRider(riderArgs("C", over)), null, "en række fra en tidligere tænding tæller ikke");
  assert.equal(roster.forRider(riderArgs("D", over)), null, "ingen række (fx kommet til et managerhold efter tændingsdagen): kurve B");
  await roster.persist();
  assert.equal(db.upserts.length, 0, "et hold der blev målt, måles aldrig igen");
});

test("roster: et hold der ikke blev målt på tændingsdagen, måles på sin første dato i vinduet (og kun dér)", async () => {
  // Fx "træn nu" for hele tændingsdatoen før flaget blev tændt: ingen af holdets ryttere har en række.
  const db = fakeMembers([]);
  const roster = await loadCurveBTransitionRoster(db, { transition: DAY7, curveB: PARAMS, riderIds: ["A", "B"] });
  assert.deepEqual(roster.forRider(riderArgs("A", over)), { weight: 0.5, abilities: [MAIN] }, "målt før dagens tick");
  assert.equal(roster.forRider(riderArgs("B", under)), null);
  await roster.persist();
  assert.deepEqual(db.rows, [
    { rider_id: "A", ignited_on: "2026-10-30", measured_on: "2026-11-06", abilities: [MAIN] },
    { rider_id: "B", ignited_on: "2026-10-30", measured_on: "2026-11-06", abilities: [] },
  ]);
  // Samme dato, næste løbsdag: en rytter der ikke var med i første kørsel, måles stadig.
  const sameDate = await loadCurveBTransitionRoster(db, { transition: DAY7, curveB: PARAMS, riderIds: ["A", "B", "C"] });
  assert.equal(sameDate.forRider(riderArgs("B", over)), null, "den første kørsel vinder");
  assert.deepEqual(sameDate.forRider(riderArgs("C", over)), { weight: 0.5, abilities: [MAIN] });
  // Næste dato: holdet er målt; en ny rytter uden række får kurve B.
  const DAY8 = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-11-07" })!;
  const next = await loadCurveBTransitionRoster(db, { transition: DAY8, curveB: PARAMS, riderIds: ["A", "D"] });
  assert.equal(next.forRider(riderArgs("D", over)), null, "kommet til holdet efter målingen: kurve B");
  // En efterslæbende kørsel før startdatoen måler intet.
  const BEFORE = curveBTransitionForDate({ ignitedOn: "2026-10-30", tickDate: "2026-10-29" })!;
  const early = await loadCurveBTransitionRoster(fakeMembers([]), { transition: BEFORE, curveB: PARAMS, riderIds: ["A"] });
  assert.equal(early.forRider(riderArgs("A", over)), null);
});

test("tick: en evne der krydser loftet inde i vinduet, får kurve B (ingen spring op til den gamle fart)", () => {
  const b = tick({ curveB: PARAMS });
  const crossed = tick({ curveB: PARAMS, curveBTransition: tr(0.5, []) });
  assert.deepEqual(crossed, b, "ikke låst ind = kurve B, bit for bit");
  const other = tick({ curveB: PARAMS, curveBTransition: tr(0.5, ["sprint"]) });
  assert.equal(prog(other, MAIN), prog(b, MAIN), "kun de låste evner blandes");
});

test("roster: en fejlet læsning = kurve B fuldt og intet skrevet; kaster på den strikse sti", async () => {
  const db = fakeMembers([], { readError: { message: "nede" } });
  const roster = await quiet(() => loadCurveBTransitionRoster(db, { transition: DAY0, curveB: PARAMS, riderIds: ["A"] }));
  assert.equal(roster.forRider(riderArgs("A", over)), null);
  await roster.persist();
  assert.equal(db.upserts.length, 0);
  await assert.rejects(loadCurveBTransitionRoster(fakeMembers([], { readError: { message: "nede" } }),
    { transition: DAY0, curveB: PARAMS, riderIds: ["A"], strict: true }));
});

test("roster: en fejlet skrivning kaster på den strikse sti, ellers en advarsel", async () => {
  const strict = await loadCurveBTransitionRoster(fakeMembers([], { writeError: { message: "nede" } }),
    { transition: DAY0, curveB: PARAMS, riderIds: ["A"], strict: true });
  strict.forRider(riderArgs("A", over));
  await assert.rejects(strict.persist({ strict: true }));
  const loose = await loadCurveBTransitionRoster(fakeMembers([], { writeError: { message: "nede" } }),
    { transition: DAY0, curveB: PARAMS, riderIds: ["A"] });
  loose.forRider(riderArgs("A", over));
  await quiet(() => loose.persist({ strict: false }));
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
