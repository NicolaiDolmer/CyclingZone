// #6110 tænding: prøven Fable-dommen 17/11 manglede. En talfil (development_xp_params i
// private_config), der mangler eller er ugyldig på startdatoen, skal:
//   · logges som FEJL (console.error), ikke som en stille advarsel, så tændingsnatten
//     aldrig glider forbi uden udbetaling uden at nogen ser det
//   · få motoren til at falde tilbage til dagens model, bit for bit som den frosne
//     merge-base-golden (developmentXpOffGolden.json, aldrig genereret med ny kode)
// Tallene er syntetiske (hard rule 17); loggen må aldrig vise talfilens indhold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY, loadDevelopmentXp,
} from "./developmentXpFlag.ts";
import { validateDevelopmentXpParams } from "./developmentXp.ts";
import {
  ENGINE_SCENARIOS, XP_OFF_OVERLAYS, XP_TEST_PARAMS, engineSeed, gameState, runEngine,
} from "./__fixtures__/developmentXpOffScenarios.js";
import { createHash } from "node:crypto";

const GOLDEN = JSON.parse(readFileSync(new URL("./__fixtures__/developmentXpOffGolden.json", import.meta.url), "utf8"));
const FIXED_NOW = () => 1_700_000_000_000;
const START = "2026-11-15";

type Row = { value: unknown };
function fakeDb({ app = {}, priv = {}, failPriv = false }: {
  app?: Record<string, unknown>; priv?: Record<string, unknown>; failPriv?: boolean;
} = {}) {
  const reads: { table: string; key: string | null }[] = [];
  return {
    reads,
    from(table: string) {
      let key: string | null = null;
      const chain = {
        select() { return chain; },
        eq(_col: string, k: string) { key = k; return chain; },
        async maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
          reads.push({ table, key });
          const source = table === "app_config" ? app : priv;
          if (table !== "app_config" && failPriv) return { data: null, error: { message: "boom" } };
          return { data: key !== null && key in source ? { value: source[key] } : null, error: null };
        },
      };
      return chain;
    },
  };
}

function recordingLog() {
  const errors: string[] = [];
  const warnings: string[] = [];
  return { errors, warnings, log: { warn: (m: unknown) => warnings.push(String(m)), error: (m: unknown) => errors.push(String(m)) } };
}

const ON = { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: START };
const BAD_PARAMS = { ...XP_TEST_PARAMS, offFocusShare: 2 };
const BAD_TALFILES: Record<string, { priv?: Record<string, unknown>; failPriv?: boolean; status: string }> = {
  missing: { priv: {}, status: "missing" },
  nullValue: { priv: { [DEVELOPMENT_XP_PARAMS_KEY]: null }, status: "missing" },
  emptyObject: { priv: { [DEVELOPMENT_XP_PARAMS_KEY]: {} }, status: "invalid" },
  outOfRange: { priv: { [DEVELOPMENT_XP_PARAMS_KEY]: BAD_PARAMS }, status: "invalid" },
  readError: { failPriv: true, status: "error" },
};

// Talfilens værdier må aldrig stå i loggen (hard rule 17): tjek hver tal-/nøgle-værdi i den.
function leaksParams(message: string): boolean {
  const flat = JSON.stringify(XP_TEST_PARAMS);
  const numbers = new Set(flat.match(/\d+\.\d+/g) ?? []);
  for (const n of numbers) if (message.includes(n)) return true;
  return /potentialXp|exponent|typeShare|offFocusShare|ageShare/.test(message);
}

test("#6110 tænding: manglende eller ugyldig talfil på startdatoen logges som FEJL og giver dagens model", async () => {
  for (const [name, { priv, failPriv, status }] of Object.entries(BAD_TALFILES)) {
    const { errors, warnings, log } = recordingLog();
    const db = fakeDb({ app: ON, priv, failPriv });
    const result = await loadDevelopmentXp({ supabase: db, tickDate: START, log, now: FIXED_NOW });
    assert.equal(result, null, `${name}: dagens model`);
    const xpErrors = errors.filter((m) => m.startsWith("[development-xp]"));
    assert.equal(xpErrors.length, 1, `${name}: præcis én fejl-linje fra XP-kontakten`);
    assert.ok(xpErrors[0].includes(START), `${name}: fejlen nævner datoen`);
    assert.ok(xpErrors[0].includes(DEVELOPMENT_XP_PARAMS_KEY), `${name}: fejlen nævner nøglen`);
    assert.ok(xpErrors[0].includes(` is ${status} `), `${name}: fejlen siger hvorfor (${status})`);
    assert.ok(!warnings.some((m) => m.startsWith("[development-xp]")), `${name}: ikke nedgraderet til en advarsel`);
    for (const m of [...errors, ...warnings]) assert.ok(!leaksParams(m), `${name}: loggen viser aldrig talfilens tal`);
  }
});

test("#6110 tænding: på dato-stien (strict) giver en manglende talfil også fejl + dagens model; en ugyldig kaster, så datoen prøves igen", async () => {
  const missing = recordingLog();
  assert.equal(await loadDevelopmentXp({ supabase: fakeDb({ app: ON }), tickDate: START, strict: true, log: missing.log, now: FIXED_NOW }), null);
  assert.equal(missing.errors.filter((m) => m.startsWith("[development-xp]")).length, 1);
  const invalid = recordingLog();
  await assert.rejects(
    loadDevelopmentXp({ supabase: fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: BAD_PARAMS } }), tickDate: START, strict: true, log: invalid.log, now: FIXED_NOW }),
    (error: Error) => !leaksParams(error.message),
  );
});

test("#6110 tænding: ingen falsk alarm. Før startdatoen, slukket kontakt og gyldig talfil logger ingen fejl", async () => {
  const cases = [
    { db: fakeDb({ app: ON }), tickDate: "2026-11-14", expectXp: false },
    { db: fakeDb({ app: { ...ON, [DEVELOPMENT_XP_FLAG_KEY]: "off" } }), tickDate: START, expectXp: false },
    { db: fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: XP_TEST_PARAMS } }), tickDate: START, expectXp: true },
  ];
  for (const { db, tickDate, expectXp } of cases) {
    const { errors, log } = recordingLog();
    const result = await loadDevelopmentXp({ supabase: db, tickDate, log, now: FIXED_NOW });
    if (expectXp) assert.deepEqual(result, validateDevelopmentXpParams(XP_TEST_PARAMS));
    else {
      assert.equal(result, null);
      assert.ok(!db.reads.some((r) => r.table === "private_config"), "talfilen læses ikke, når XP ikke gælder datoen");
    }
    assert.deepEqual(errors, [], `${tickDate}: ingen fejl`);
  }
});

test("#6110 tænding: en logger uden error-metode får stadig beskeden som advarsel (ingen stille fejl)", async () => {
  const warnings: string[] = [];
  assert.equal(await loadDevelopmentXp({ supabase: fakeDb({ app: ON }), tickDate: START, log: { warn: (m: unknown) => warnings.push(String(m)) }, now: FIXED_NOW }), null);
  assert.ok(warnings.some((m) => m.startsWith("[development-xp]") && m.includes(DEVELOPMENT_XP_PARAMS_KEY)));
});

// ── Hele motoren: startdatoen med dårlig talfil ──────────────────────────────
// Scenariernes tick-dato er overlay'enes startdato (onNoParams/onBadParams). Motoren læser
// med console som logger, så fejlen fanges der. Udfaldet sammenlignes med den FROSNE
// merge-base-golden: dagens model, bit for bit.

// Samme kanoniske hash som fixturen (kommatal til faste betydende cifre, så Windows og
// Linux giver samme hash); ellers kan golden-sammenligningen ikke genskabes.
const canonical = (_key: string, v: unknown) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)
  ? Number(v.toPrecision(10)) : v);
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value, canonical)).digest("hex");

test("#6110 tænding: motoren på startdatoen med manglende/ugyldig talfil = dagens model (frossen golden) + fejl i loggen", async () => {
  for (const overlayName of ["onNoParams", "onBadParams"] as const) {
    for (const raced of [false, true]) {
      const key = `cap|${raced ? "race" : "train"}|vo2max|${overlayName}`;
      const state = engineSeed({ flags: ENGINE_SCENARIOS.cap.flags, raced, overlay: XP_OFF_OVERLAYS[overlayName], plan: "vo2max" });
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
      let result;
      try {
        result = await runEngine(state);
      } finally {
        console.error = originalError;
      }
      assert.equal(sha(gameState(state, result)), GOLDEN.engine[key], `${key}: identisk med merge-basen`);
      const xpErrors = errors.filter((m) => m.startsWith("[development-xp]") && m.includes(DEVELOPMENT_XP_PARAMS_KEY));
      assert.equal(xpErrors.length, 1, `${key}: præcis én fejl-linje`);
      for (const m of errors) assert.ok(!leaksParams(m), `${key}: loggen viser aldrig talfilens tal`);
    }
  }
});
