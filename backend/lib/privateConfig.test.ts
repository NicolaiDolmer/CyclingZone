// #7390: læseren for private_config. Alle værdier er syntetiske testværdier
// (ingen balance-tal i repoet, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRIVATE_CONFIG_KEYS, PRIVATE_CONFIG_CACHE_MS, canonicalJson, changedPaths, clearPrivateConfigCache,
  isPrivateConfigKey, privateConfigHash, readPrivateConfig, readPrivateConfigEntry, validatePrivateConfigValue,
} from "./privateConfig.ts";
import { DRIFT_GROUPS, DRIFT_MEASURE_KEYS, parseWeeklyEngineDriftThresholds } from "./weeklyEngineDriftThresholds.ts";

// Fast ur: tests laeser aldrig vaegur-tid (AGENTS.md), heller ikke cache og reserve-advarsel.
const FIXED_NOW = () => 1_700_000_000_000;

const CURVE = {
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.5, 0.6, 0.7, 0.8, 0.9, 1],
};
const DRIFT = { minStages: 3, groups: { gt: { minStages: 5, breakawayWinShare: { min: 0.1, max: 0.2 } }, one_day: { crashShare: { max: 0.3 } } } };

function client(rows: Record<string, unknown>, { error = null as string | null, throws = false } = {}) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      assert.equal(table, "private_config");
      return {
        select: (cols: string) => {
          assert.equal(cols, "value");
          return {
            eq: (col: string, key: string) => {
              assert.equal(col, "key");
              return {
                maybeSingle: async () => {
                  reads.push(key);
                  if (throws) throw new Error("socket hang up");
                  if (error) return { data: null, error: { message: error } };
                  return Object.hasOwn(rows, key) ? { data: { value: rows[key] }, error: null } : { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const quiet = () => { const warnings: string[] = []; return { warnings, log: { warn: (m: string) => { warnings.push(m); } } }; };

test("registret: de tre kendte nøgler er private og har en parser", () => {
  assert.deepEqual(Object.keys(PRIVATE_CONFIG_KEYS).sort(), ["development_curve_b_params", "race_day_role_yield_params", "weekly_engine_drift_thresholds"]);
  for (const spec of Object.values(PRIVATE_CONFIG_KEYS)) {
    assert.equal(spec.private, true);
    assert.equal(typeof spec.parse, "function");
  }
  assert.ok(isPrivateConfigKey("development_curve_b_params"));
  assert.ok(!isPrivateConfigKey("toString"), "prototype-navne er ikke nøgler");
  assert.ok(!isPrivateConfigKey("race_engine_v4"));
});

test("læs: gyldig værdi returneres parset; mangler = null uden advarsel", async () => {
  clearPrivateConfigCache();
  const { warnings, log } = quiet();
  const db = client({ development_curve_b_params: CURVE });
  const value = await readPrivateConfig(db, "development_curve_b_params", { now: FIXED_NOW, log });
  assert.equal((value as { rate: number }).rate, CURVE.rate);
  assert.ok(Object.isFrozen(value), "kurve B-params er frosne (samme validering som før)");
  const entry = await readPrivateConfigEntry(client({}), "weekly_engine_drift_thresholds", { now: FIXED_NOW, log });
  assert.deepEqual(entry, { status: "missing", value: null });
  assert.equal(warnings.length, 0);
});

test("læs: ugyldig værdi = null + tydelig advarsel uden værdier; strict kaster", async () => {
  clearPrivateConfigCache();
  const { warnings, log } = quiet();
  const bad = { ...CURVE, rate: -12345 };
  const db = client({ development_curve_b_params: bad });
  const entry = await readPrivateConfigEntry(db, "development_curve_b_params", { now: FIXED_NOW, log });
  assert.deepEqual(entry, { status: "invalid", value: null });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /development_curve_b_params har en ugyldig vaerdi/);
  assert.ok(!warnings[0].includes("12345"), "værdien logges aldrig");
  clearPrivateConfigCache();
  await assert.rejects(() => readPrivateConfig(client({ development_curve_b_params: bad }), "development_curve_b_params", { now: FIXED_NOW, strict: true, log }), /ugyldig vaerdi \(strict\)/);
  // Også fra cachen: en ikke-strict læsning efterfulgt af en strict kaster stadig.
  const cached = client({ development_curve_b_params: bad });
  await readPrivateConfig(cached, "development_curve_b_params", { now: FIXED_NOW, log });
  await assert.rejects(() => readPrivateConfig(cached, "development_curve_b_params", { now: FIXED_NOW, strict: true, log }), /strict/);
});

test("læs: databasefejl = null + advarsel; strict kaster; fejl caches aldrig", async () => {
  clearPrivateConfigCache();
  const { warnings, log } = quiet();
  const failing = client({ development_curve_b_params: CURVE }, { error: "timeout" });
  assert.deepEqual(await readPrivateConfigEntry(failing, "development_curve_b_params", { now: FIXED_NOW, log }), { status: "error", value: null });
  assert.match(warnings[0], /timeout/);
  await assert.rejects(() => readPrivateConfig(failing, "development_curve_b_params", { now: FIXED_NOW, strict: true, log }), /timeout/);
  await assert.rejects(() => readPrivateConfig(client({}, { throws: true }), "development_curve_b_params", { now: FIXED_NOW, strict: true, log }), /socket hang up/);
  assert.equal(failing.reads.length, 2, "anden læsning gik til databasen igen");
});

test("cache: 60 s pr. klient; derefter læses igen; egen klient har egen cache", async () => {
  clearPrivateConfigCache();
  let t = 1_000;
  const now = () => t;
  const db = client({ weekly_engine_drift_thresholds: DRIFT });
  await readPrivateConfig(db, "weekly_engine_drift_thresholds", { now });
  t += PRIVATE_CONFIG_CACHE_MS - 1;
  await readPrivateConfig(db, "weekly_engine_drift_thresholds", { now });
  assert.equal(db.reads.length, 1, "inden for 60 s: fra cachen");
  t += 2;
  await readPrivateConfig(db, "weekly_engine_drift_thresholds", { now });
  assert.equal(db.reads.length, 2, "efter 60 s: ny læsning");
  const other = client({});
  assert.equal(await readPrivateConfig(other, "weekly_engine_drift_thresholds", { now }), null);
  assert.equal(other.reads.length, 1);
  // Mangler caches også (ingen tæppebombning af tabellen).
  await readPrivateConfig(other, "weekly_engine_drift_thresholds", { now });
  assert.equal(other.reads.length, 1);
});

test("schema: egen parser; ukendt nøgle uden schema er en programmeringsfejl", async () => {
  clearPrivateConfigCache();
  const db = client({ some_test_key: { a: 1 } });
  assert.deepEqual(await readPrivateConfig(db, "some_test_key", { now: FIXED_NOW, schema: (raw) => raw as { a: number } }), { a: 1 });
  assert.equal(await readPrivateConfig(db, "some_test_key", { now: FIXED_NOW, schema: () => null, log: quiet().log }), null, "anden parser = ingen cache-genbrug");
  await assert.rejects(() => readPrivateConfig(db, "unknown_key"), /ukendt noegle/);
});

test("validatePrivateConfigValue: kaster aldrig, giver værdi-fri begrundelse", () => {
  assert.deepEqual(validatePrivateConfigValue(PRIVATE_CONFIG_KEYS.weekly_engine_drift_thresholds.parse, DRIFT).ok, true);
  const res = validatePrivateConfigValue(PRIVATE_CONFIG_KEYS.weekly_engine_drift_thresholds.parse, { minStages: -1 });
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /minStages/);
  assert.equal(validatePrivateConfigValue(PRIVATE_CONFIG_KEYS.development_curve_b_params.parse, "x").ok, false);
});

test("drift-grænser: samme regler og output-form som parseThresholds (#7279)", () => {
  assert.deepEqual(parseWeeklyEngineDriftThresholds(DRIFT), {
    minStages: 3,
    groups: { gt: { minStages: 5, bands: { breakawayWinShare: { min: 0.1, max: 0.2 } } }, one_day: { bands: { crashShare: { max: 0.3 } } } },
  });
  assert.deepEqual(parseWeeklyEngineDriftThresholds({ minStages: 0 }), { minStages: 0, groups: {} });
  assert.equal(DRIFT_GROUPS.length, 6);
  assert.equal(DRIFT_MEASURE_KEYS.length, 9);
  const bad: Array<[unknown, RegExp]> = [
    [null, /objekt/],
    [{}, /minStages/],
    [{ minStages: -1 }, /minStages/],
    [{ minStages: 1, groups: { tour: {} } }, /ukendt loebsgruppe/],
    [{ minStages: 1, groups: { gt: { minStages: "x" } } }, /minStages/],
    [{ minStages: 1, groups: { gt: { speed: { min: 1 } } } }, /ukendt maal/],
    [{ minStages: 1, groups: { gt: { crashShare: {} } } }, /mangler baade/],
    [{ minStages: 1, groups: { gt: { crashShare: { min: "lav" } } } }, /ikke er et tal/],
    [{ minStages: 1, groups: { gt: { crashShare: { min: 0.5, max: 0.1 } } } }, /min stoerre end max/],
  ];
  for (const [raw, re] of bad) assert.throws(() => parseWeeklyEngineDriftThresholds(raw), re, JSON.stringify(raw));
});

test("hash og ændrede felter: værdi-frie, stabile på tværs af nøgle-rækkefølge", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(privateConfigHash({ a: 1, b: 2 }), privateConfigHash({ b: 2, a: 1 }));
  assert.notEqual(privateConfigHash({ a: 1 }), privateConfigHash({ a: 2 }));
  assert.match(privateConfigHash(CURVE), /^[0-9a-f]{12}$/);
  assert.equal(privateConfigHash(null), "(ingen)");
  const after = { ...CURVE, load: { ...CURVE.load, floor: 0.6 }, potentialCeiling: [0.5, 0.6, 0.75, 0.8, 0.9, 1], aboveCeilingFloor: 0.2 } as Record<string, unknown>;
  delete after.capExponent;
  assert.deepEqual(changedPaths(CURVE, after), ["+aboveCeilingFloor", "-capExponent", "load.floor", "potentialCeiling[2]"]);
  assert.deepEqual(changedPaths(CURVE, structuredClone(CURVE)), []);
  assert.deepEqual(changedPaths(null, CURVE), ["(hele vaerdien)"]);
  assert.deepEqual(changedPaths([1, 2], [1, 2, 3]), ["+[2]"]);
});

test("#5950: race_day_role_yield_params parser afviser ugyldige værdier", () => {
  const { parse } = PRIVATE_CONFIG_KEYS.race_day_role_yield_params;
  assert.throws(() => parse({ stageBonus: -1, leadShare: 0.5 }));
  assert.throws(() => parse(null));
  assert.deepEqual(parse({ stageBonus: 1, leadShare: 0.5 }), { stageBonus: 1, leadShare: 0.5 });
});
