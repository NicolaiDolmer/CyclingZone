import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLAG_CACHE_TTL_MS,
  FRESH_FLAG_KEYS,
  clearFlagStageCache,
  evaluateFlagStage,
  readFlagStage,
} from "./featureStage.js";

test("evaluateFlagStage: on/true → alle", () => {
  assert.equal(evaluateFlagStage("on"), true);
  assert.equal(evaluateFlagStage(true), true);
  assert.equal(evaluateFlagStage("on", { isBetaTester: false }), true);
});

test("evaluateFlagStage: beta → kun beta-testere", () => {
  assert.equal(evaluateFlagStage("beta", { isBetaTester: true }), true);
  assert.equal(evaluateFlagStage("beta", { isBetaTester: false }), false);
  assert.equal(evaluateFlagStage("beta"), false);
});

test("evaluateFlagStage: off/false/ukendt → ingen", () => {
  for (const v of ["off", false, null, undefined, "garbage"]) {
    assert.equal(evaluateFlagStage(v, { isBetaTester: true }), false, `v=${v}`);
  }
});

test("readFlagStage: fail-safe null + happy path", async () => {
  assert.equal(await readFlagStage(null, "k"), null);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await readFlagStage(errClient, "k"), null);
  const onClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await readFlagStage(onClient, "k"), "beta");
});

// ── #4839: skrive-gate vs. læse-gate ─────────────────────────────────────────

test("evaluateFlagStage: beta + engineWrite → true (motoren skriver for alle)", () => {
  assert.equal(evaluateFlagStage("beta", { engineWrite: true }), true);
  assert.equal(evaluateFlagStage("beta", { engineWrite: true, isBetaTester: false }), true);
});

test("evaluateFlagStage: off + engineWrite → false (kill-switchen stopper ALT)", () => {
  for (const v of ["off", false, null, undefined, "garbage"]) {
    assert.equal(evaluateFlagStage(v, { engineWrite: true }), false, `v=${v}`);
    assert.equal(evaluateFlagStage(v, { engineWrite: true, isBetaTester: true }), false, `v=${v}`);
  }
});

test("evaluateFlagStage: beta uden engineWrite → læse-gaten er uændret", () => {
  assert.equal(evaluateFlagStage("beta", { engineWrite: false }), false);
  assert.equal(evaluateFlagStage("beta", { engineWrite: false, isBetaTester: true }), true);
});

// ── #7663: kort cache på opslaget ────────────────────────────────────────────

// AGENTS.md regel 16: testene læser aldrig vægur-tiden. Alle opslag får et
// fast ur; testene der rykker tiden har deres eget.
const fixedNow = () => 1_000;

/**
 * Fake klient der tæller opslag. `values` kan ændres undervejs (et flip), og
 * `fail` får næste opslag til at fejle (som supabase-js: { error }) eller kaste.
 */
function countingClient(values) {
  const state = { reads: 0, fail: null, values };
  const client = {
    from: () => ({
      select: () => ({
        eq: (_col, key) => ({
          maybeSingle: async () => {
            state.reads++;
            if (state.fail === "error") return { data: null, error: { message: "db nede" } };
            if (state.fail === "throw") throw new TypeError("fetch failed");
            return key in state.values
              ? { data: { value: state.values[key] }, error: null }
              : { data: null, error: null };
          },
        }),
      }),
    }),
  };
  return { client, state };
}

test("#7663 et vellykket opslag genbruges inden for TTL'en", async () => {
  clearFlagStageCache();
  const { client, state } = countingClient({ ui_flag: "on" });
  assert.equal(await readFlagStage(client, "ui_flag", { now: fixedNow }), "on");
  assert.equal(await readFlagStage(client, "ui_flag", { now: fixedNow }), "on");
  assert.equal(await readFlagStage(client, "ui_flag", { now: fixedNow }), "on");
  assert.equal(state.reads, 1, "tre visninger må koste ét DB-opslag");
});

test("#7663 TTL'en er inden for issuets 30-60 s", () => {
  assert.ok(FLAG_CACHE_TTL_MS >= 30_000 && FLAG_CACHE_TTL_MS <= 60_000);
});

test("#7663 cachen udløber, så et flip slår igennem af sig selv", async () => {
  clearFlagStageCache();
  let clock = 1_000;
  const now = () => clock;
  const { client, state } = countingClient({ ui_flag: "on" });
  assert.equal(await readFlagStage(client, "ui_flag", { now }), "on");
  state.values.ui_flag = "off";
  clock += FLAG_CACHE_TTL_MS - 1;
  assert.equal(await readFlagStage(client, "ui_flag", { now }), "on", "stadig inden for TTL");
  clock += 2;
  assert.equal(await readFlagStage(client, "ui_flag", { now }), "off", "efter TTL ses flippet");
  assert.equal(state.reads, 2);
});

test("#7663 samtidige opslag af samme nøgle deler ét DB-kald", async () => {
  clearFlagStageCache();
  const { client, state } = countingClient({ ui_flag: "beta" });
  const values = await Promise.all(Array.from({ length: 20 }, () => readFlagStage(client, "ui_flag", { now: fixedNow })));
  assert.equal(state.reads, 1, "20 samtidige requests må give ét opslag");
  for (const v of values) assert.equal(v, "beta");
});

test("#7663 en manglende række caches som null (= off) ligesom en rigtig værdi", async () => {
  clearFlagStageCache();
  const { client, state } = countingClient({});
  assert.equal(await readFlagStage(client, "absent", { now: fixedNow }), null);
  assert.equal(await readFlagStage(client, "absent", { now: fixedNow }), null);
  assert.equal(state.reads, 1);
});

// Regel 1: et opslagsfejl må aldrig blive til "tændt".
for (const mode of ["error", "throw"]) {
  test(`#7663 opslagsfejl (${mode}) efter et cachet "on" giver null, ikke den gamle værdi`, async () => {
    clearFlagStageCache();
    let clock = 1_000;
    const now = () => clock;
    const { client, state } = countingClient({ ui_flag: "on" });
    assert.equal(await readFlagStage(client, "ui_flag", { now }), "on");
    clock += FLAG_CACHE_TTL_MS + 1; // udløbet: næste kald skal spørge DB
    state.fail = mode;
    assert.equal(await readFlagStage(client, "ui_flag", { now }), null, "fejl → off, aldrig det gamle on");
    assert.equal(evaluateFlagStage(await readFlagStage(client, "ui_flag", { now })), false);
  });

  test(`#7663 opslagsfejl (${mode}) caches ikke: næste kald prøver igen`, async () => {
    clearFlagStageCache();
    const { client, state } = countingClient({ ui_flag: "on" });
    state.fail = mode;
    assert.equal(await readFlagStage(client, "ui_flag", { now: fixedNow }), null);
    state.fail = null;
    assert.equal(await readFlagStage(client, "ui_flag", { now: fixedNow }), "on", "fejlen hang ikke ved");
    assert.equal(state.reads, 2);
  });
}

test("#7663 motor-kontakter læses friskt hver gang (én gang pr. afvikling, som før)", async () => {
  clearFlagStageCache();
  const { client, state } = countingClient({ race_engine_v4: "on", stage_scheduler_enabled: "on" });
  assert.equal(await readFlagStage(client, "race_engine_v4", { now: fixedNow }), "on");
  state.values.race_engine_v4 = "off"; // ejeren slukker motoren
  assert.equal(await readFlagStage(client, "race_engine_v4", { now: fixedNow }), "off", "nødstoppet virker straks");
  state.values.stage_scheduler_enabled = "off";
  assert.equal(await readFlagStage(client, "stage_scheduler_enabled", { now: fixedNow }), "off");
  assert.equal(state.reads, 3, "ingen af motor-opslagene kom fra cachen");
});

test("#7663 { fresh: true, now: fixedNow } springer cachen over for ét opslag", async () => {
  clearFlagStageCache();
  const { client, state } = countingClient({ ui_flag: "on" });
  await readFlagStage(client, "ui_flag", { now: fixedNow });
  state.values.ui_flag = "off";
  assert.equal(await readFlagStage(client, "ui_flag", { fresh: true, now: fixedNow }), "off");
  assert.equal(state.reads, 2);
});

test("#7663 cachen er pr. klient: to klienter deler aldrig værdier", async () => {
  clearFlagStageCache();
  const a = countingClient({ ui_flag: "on" });
  const b = countingClient({ ui_flag: "off" });
  assert.equal(await readFlagStage(a.client, "ui_flag", { now: fixedNow }), "on");
  assert.equal(await readFlagStage(b.client, "ui_flag", { now: fixedNow }), "off");
});

test("#7663 clearFlagStageCache kan rydde én nøgle på én klient", async () => {
  clearFlagStageCache();
  const { client, state } = countingClient({ ui_flag: "on", other: "on" });
  await readFlagStage(client, "ui_flag", { now: fixedNow });
  await readFlagStage(client, "other", { now: fixedNow });
  state.values.ui_flag = "off";
  state.values.other = "off";
  clearFlagStageCache({ client, key: "ui_flag" });
  assert.equal(await readFlagStage(client, "ui_flag", { now: fixedNow }), "off", "den ryddede nøgle læses igen");
  assert.equal(await readFlagStage(client, "other", { now: fixedNow }), "on", "den anden er stadig cachet");
});

// ── Forward-guard: en ny motor-kontakt kan ikke glide ind i cachen ───────────
//
// Scanner motorens rodfiler og deres DIREKTE imports for
// readFlagStage(<klient>, <nøgle>) og kræver at hver nøgle står i
// FRESH_FLAG_KEYS. Tilføjer nogen et nyt motor-flag-modul, fejler testen her,
// indtil nøglen er sat på listen.

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
// Uden filendelse: modulerne flyttes løbende fra .js til .ts (#7582), og
// rødderne findes under begge.
const ENGINE_ROOTS = [
  "trainingDayCloseTrigger",
  "trainingSweep",
  "raceRunner",
  "raceSimulator",
  "dailyTrainingEngine",
  "stageSchedulerFlag",
  "autoPrizeFlag",
];

function readIfExists(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

function resolveImport(fromFile, spec) {
  const target = path.resolve(path.dirname(fromFile), spec);
  if (readIfExists(target) !== null) return target;
  const asTs = target.replace(/\.js$/, ".ts");
  if (readIfExists(asTs) !== null) return asTs;
  return null;
}

function engineFiles() {
  const files = new Set();
  for (const root of ENGINE_ROOTS) {
    const rootFile = resolveImport(path.join(LIB_DIR, "x"), `./${root}.js`);
    assert.ok(rootFile !== null, `motor-roden ${root} findes ikke længere; opdatér ENGINE_ROOTS`);
    const src = fs.readFileSync(rootFile, "utf8");
    files.add(rootFile);
    const importRe = /(?:import|export)[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    let m;
    while ((m = importRe.exec(src))) {
      const resolved = resolveImport(rootFile, m[1] || m[2]);
      if (resolved && resolved.startsWith(LIB_DIR)) files.add(resolved);
    }
  }
  return files;
}

let libSourceCache = null;
function allLibSource() {
  if (libSourceCache) return libSourceCache;
  libSourceCache = fs.readdirSync(LIB_DIR)
    .filter((f) => /\.(js|ts)$/.test(f) && !/\.test\.(js|ts|mjs)$/.test(f))
    .map((f) => fs.readFileSync(path.join(LIB_DIR, f), "utf8"))
    .join("\n");
  return libSourceCache;
}

function resolveKeyExpression(expr) {
  const literal = expr.match(/^["']([^"']+)["']$/);
  if (literal) return literal[1];
  const name = expr.split(".").pop();
  const re = new RegExp(`\\b${name}\\s*(?::\\s*\\w+\\s*)?[=:]\\s*["']([^"']+)["']`, "g");
  const values = new Set([...allLibSource().matchAll(re)].map((m) => m[1]));
  if (values.size === 1) return [...values][0];
  return null;
}

test("#7663 forward-guard: hver kontakt motoren læser står i FRESH_FLAG_KEYS", () => {
  const missing = [];
  const unresolved = [];
  let scanned = 0;
  for (const file of engineFiles()) {
    if (path.basename(file) === "featureStage.js") continue;
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/readFlagStage\(\s*[\w.]+\s*,\s*([^,)]+?)\s*[,)]/g)) {
      scanned++;
      const key = resolveKeyExpression(m[1].trim());
      if (key === null) unresolved.push(`${path.basename(file)}: ${m[1].trim()}`);
      else if (!FRESH_FLAG_KEYS.has(key)) missing.push(`${path.basename(file)}: ${key}`);
    }
  }
  assert.ok(scanned >= 10, `scanneren fandt kun ${scanned} opslag; er mønsteret ændret?`);
  assert.deepEqual(unresolved, [], "nøglen kunne ikke slås op statisk; skriv den som konstant eller tilføj den til FRESH_FLAG_KEYS");
  assert.deepEqual(missing, [], "motor-kontakt mangler i FRESH_FLAG_KEYS og ville blive cachet");
});
