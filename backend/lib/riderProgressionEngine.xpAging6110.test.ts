// #6110 dommer-fund F2 (19/11): den rigtige læser af XP-kontakten ved sæsonskiftet
// (loadXpAgingCfg) og en motor-kørsel med standard-læseren. Tallene er syntetiske.
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadXpAgingCfg, developRidersForSeason } from "./riderProgressionEngine.js";
import { DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY } from "./developmentXpFlag.ts";
import { XP_TEST_PARAMS } from "./__fixtures__/developmentXpOffScenarios.js";
import { AGING_V2_CONFIG } from "./riderProgression.js";

const START = "2026-11-20";
const AGING = Object.freeze({
  plateauThroughAge: 26,
  declineByYearsPastPlateau: [{ maxYears: 99, drop: 2 }],
  late: { fromAge: 32, drop: 0.5 },
});
const B_PARAMS = Object.freeze({ ...XP_TEST_PARAMS, price: { ...XP_TEST_PARAMS.price, top: 140 }, aging: AGING });
const ON = { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: START };
// Dansk dato: 20/11 kl. 00:30 dansk tid er 19/11 23:30 UTC.
const DK_MIDNIGHT_START = new Date("2026-11-19T23:30:00Z");
const DK_BEFORE_START = new Date("2026-11-19T22:30:00Z");

function fakeDb({ app = {}, priv = {}, fail = null }: { app?: Record<string, unknown>; priv?: Record<string, unknown>; fail?: string | null } = {}) {
  return {
    from(table: string) {
      let key: string | null = null;
      const chain = {
        select() { return chain; },
        eq(_c: string, k: string) { key = k; return chain; },
        async maybeSingle() {
          if (fail === table || fail === "both") return { data: null, error: { message: `${table} nede` } };
          const src = table === "app_config" ? app : priv;
          return { data: key !== null && key in src ? { value: src[key] } : null, error: null };
        },
      };
      return chain;
    },
  };
}
const quiet = { warn() {}, error() {} };
const load = (db: ReturnType<typeof fakeDb>, now: Date) => loadXpAgingCfg({ supabase: db, now });

test("F2: kontakt off, beta eller uden række = dagens aldring (null)", async () => {
  for (const flag of ["off", "beta", undefined]) {
    const app = flag === undefined ? { [DEVELOPMENT_XP_FROM_DATE_KEY]: START } : { ...ON, [DEVELOPMENT_XP_FLAG_KEY]: flag };
    assert.equal(await load(fakeDb({ app, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: B_PARAMS } }), DK_MIDNIGHT_START), null, `kontakt ${flag}`);
  }
});

test("F2: kontakt on uden startdato eller før startdatoen (dansk tid) = dagens aldring", async () => {
  const origWarn = console.warn; console.warn = quiet.warn;
  try {
    assert.equal(await load(fakeDb({ app: { [DEVELOPMENT_XP_FLAG_KEY]: "on" }, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: B_PARAMS } }), DK_MIDNIGHT_START), null, "uden startdato");
  } finally { console.warn = origWarn; }
  assert.equal(await load(fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: B_PARAMS } }), DK_BEFORE_START), null, "dagen før (dansk tid)");
});

test("F2: på startdatoen (dansk midnat) med kandidat B-talfil = XP-aldringen", async () => {
  const cfg = await load(fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: B_PARAMS } }), DK_MIDNIGHT_START) as Record<string, unknown> | null;
  assert.ok(cfg);
  assert.equal(cfg.plateauThroughAge, 26);
  assert.equal(cfg.brakeLoadDays, AGING_V2_CONFIG.brakeLoadDays);
  assert.deepEqual(cfg.late, AGING.late);
});

test("F2: talfil uden aldring eller manglende talfil = dagens aldring", async () => {
  const origErr = console.error; console.error = quiet.error;
  try {
    for (const priv of [{ [DEVELOPMENT_XP_PARAMS_KEY]: XP_TEST_PARAMS }, {}]) {
      assert.equal(await load(fakeDb({ app: ON, priv }), DK_MIDNIGHT_START), null, JSON.stringify(Object.keys(priv)));
    }
  } finally { console.error = origErr; }
});

test("F2: kontakt on med ugyldig talfil kaster (strict), så skiftet venter i stedet for en halv model", async () => {
  await assert.rejects(load(fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: { ...B_PARAMS, aging: { ...AGING, plateauThroughAge: 5 } } } }), DK_MIDNIGHT_START));
});

test("F2: databasefejl kaster (strict), så skiftet prøves igen i stedet for at ælde forkert", async () => {
  for (const fail of ["app_config", "private_config", "both"]) {
    await assert.rejects(load(fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: B_PARAMS }, fail }), DK_MIDNIGHT_START), undefined, fail);
  }
});

test("F2: sæsonskiftet med standard-læseren og kontakten slukket ælder efter dagens regel", async () => {
  // Minimal database: én 28-årig managerrytter (sæson 2 = 2027, født 1999). Dagens plateau til og med 30.
  const state: Record<string, Record<string, unknown>[]> = {
    app_config: [{ key: DEVELOPMENT_XP_FLAG_KEY, value: "off" }],
    private_config: [{ key: DEVELOPMENT_XP_PARAMS_KEY, value: B_PARAMS }],
    teams: [{ id: "human-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    riders: [{ id: "r1", primary_type: "sprinter", potentiale: 5, birthdate: "1999-01-01", is_u25: false, is_retired: false, team_id: "human-1", firstname: "Midt", lastname: "Rytter" }],
    rider_derived_abilities: [{ rider_id: "r1", sprint: 80, acceleration: 75, ability_caps: null }],
    rider_development_log: [],
  };
  let rpcCalls = 0;
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => (state[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const chain: Record<string, unknown> = {
        select() { return chain; },
        eq(c: string, v: unknown) { filters.push([c, v]); return chain; },
        order() { return chain; },
        range() { return Promise.resolve({ data: rows(), error: null }); },
        is() { return chain; },
        in() { return chain; },
        maybeSingle() { const r = rows()[0]; return Promise.resolve({ data: r ?? null, error: null }); },
        then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(res); },
      };
      return chain;
    },
    rpc() { rpcCalls++; return Promise.resolve({ data: null, error: null }); },
  };
  let summary: Record<string, unknown> | null = null;
  try {
    summary = await developRidersForSeason({ supabase: db, seasonId: "s2", seasonNumber: 2, notify: false, now: DK_MIDNIGHT_START, seasonLoadByRider: new Map() });
  } catch (e) {
    // Mock'en dækker ikke hele skrivestien; vi tester kun reglens valg, som sættes før skrivning.
    assert.fail(`skiftet fejlede: ${(e as Error).message}`);
  }
  assert.equal((summary?.aging_v2 as Record<string, unknown>)?.rule, "v2", "kontakt off = dagens aldring");
  assert.ok(rpcCalls >= 0);
});
