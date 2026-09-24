// #5327 — kontakten for rytter-generatorens primære type-kilde.
//
// Tre fejlklasser dækkes:
//   1) SELVE LÆSEREN: on → "distribution", alt andet (off, beta, ukendt,
//      manglende række, læsefejl) → "tier". En fejl her ville flytte
//      type-fordelingen for alle nye ryttere uden ejer-go.
//   2) WIRINGEN: at kontakten faktisk når generatoren ved AI-holdene og
//      relaunch-populationen (start-trup-stien er dækket ved sin egen allokator).
//   3) SLUKKET = BYTE-IDENTISK: launch-populationen er låst (seed + params), og
//      en ny parameter må ikke flytte én eneste rytter mens kontakten er slukket.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRIMARY_TYPE_MODE_FLAG_KEY,
  isPrimaryTypeFromDistributionEnabled,
  readPrimaryTypeMode,
} from "./primaryTypeModeFlag.js";
import {
  PRIMARY_TYPE_FROM_DISTRIBUTION_FLAG_KEY,
  generateFictionalRiders,
} from "./fictionalRiderGenerator.js";
import { generateLaunchPopulation, LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";
import { generateAndInsertPopulation } from "./relaunchOrchestrator.js";
import { __testables as aiTestables } from "./aiTeamGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, "../../database/2026-09-24-5327-primary-type-flag.sql"),
  "utf8",
);

// Fake klient: app_config slås op på nøgle (`undefined` = rækken findes ikke),
// riders svarer med en tom navneliste, og et riders-insert stopper kørslen med
// en kendt fejl — så wiring-testene kan måle generator-kaldene uden en fuld
// derive-kæde bagved.
const INSERT_STOP = "wiring-test: stop ved insert";
function fakeSupabase(appConfig = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      if (table === "app_config") {
        let key;
        const api = {
          select() { return api; },
          eq(_col, val) { key = val; return api; },
          maybeSingle() {
            reads.push(key);
            return Promise.resolve({ data: key in appConfig ? { value: appConfig[key] } : null, error: null });
          },
        };
        return api;
      }
      if (table === "riders") {
        const api = {
          select() { return api; },
          order() { return api; },
          range() { return Promise.resolve({ data: [], error: null }); },
          insert() {
            return { select() { return Promise.resolve({ data: null, error: { message: INSERT_STOP } }); } };
          },
        };
        return api;
      }
      throw new Error(`uventet tabel i wiring-test: ${table}`);
    },
  };
}

const ON = { [PRIMARY_TYPE_MODE_FLAG_KEY]: "on" };

function spyGenerate(inner, seen) {
  return (...args) => {
    seen.push(args);
    return inner(...args);
  };
}

// ── 1) Læseren ───────────────────────────────────────────────────────────────

test("#5327: nøglen er identisk med generatorens eksporterede nøgle", () => {
  assert.equal(PRIMARY_TYPE_MODE_FLAG_KEY, "rider_primary_type_from_distribution");
  assert.equal(PRIMARY_TYPE_MODE_FLAG_KEY, PRIMARY_TYPE_FROM_DISTRIBUTION_FLAG_KEY);
});

test("#5327: on og legacy true → distribution", async () => {
  assert.equal(await readPrimaryTypeMode(fakeSupabase(ON)), "distribution");
  assert.equal(await readPrimaryTypeMode(fakeSupabase({ [PRIMARY_TYPE_MODE_FLAG_KEY]: true })), "distribution");
  assert.equal(await isPrimaryTypeFromDistributionEnabled(fakeSupabase(ON)), true);
});

test("#5327: off, beta, false, ukendt og manglende række → tier", async () => {
  for (const value of ["off", "beta", false, "maybe", 1]) {
    assert.equal(
      await readPrimaryTypeMode(fakeSupabase({ [PRIMARY_TYPE_MODE_FLAG_KEY]: value })),
      "tier",
      `app_config = ${JSON.stringify(value)}`,
    );
  }
  assert.equal(await readPrimaryTypeMode(fakeSupabase({})), "tier");
});

test("#5327 fail-safe: ingen klient, kastende klient eller DB-fejl → tier", async () => {
  assert.equal(await readPrimaryTypeMode(null), "tier");
  assert.equal(await readPrimaryTypeMode({ from() { throw new Error("nede"); } }), "tier");
  const erroring = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { value: "on" }, error: { message: "timeout" } }) }),
      }),
    }),
  };
  assert.equal(await readPrimaryTypeMode(erroring), "tier", "en fejlet læsning må aldrig give distribution");
});

test("#5327 migration: rækken oprettes som off og overskriver aldrig et flyttet stadie", () => {
  assert.match(migration, /'rider_primary_type_from_distribution',\s*'"off"'::jsonb/);
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING/);
});

// ── 2) Wiring: AI-hold ───────────────────────────────────────────────────────

async function allocateAiWith(appConfig, pool) {
  const seen = [];
  const supabase = fakeSupabase(appConfig);
  await assert.rejects(
    aiTestables.defaultAllocateSquadForTeam(supabase, "ai-wiring", {
      pool, baseSeed: 2026, ordinal: 0, generate: spyGenerate(generateFictionalRiders, seen),
    }),
    new RegExp(INSERT_STOP),
  );
  return { modes: seen.map(([opts]) => opts.primaryTypeMode), reads: supabase.reads };
}

test("#5327 AI-hold tier 1 (cap-batchen): kontakten on → distribution i hver runde, læst én gang", async () => {
  const { modes, reads } = await allocateAiWith(ON, { id: "pool-t1", tier: 1 });
  assert.ok(modes.length > 0, "generatoren blev aldrig kaldt");
  assert.ok(modes.every((m) => m === "distribution"), `fik ${modes}`);
  assert.equal(reads.filter((k) => k === PRIMARY_TYPE_MODE_FLAG_KEY).length, 1);
});

test("#5327 AI-hold tier 4 (kerne + hale): kontakten on → distribution til begge kald", async () => {
  const { modes } = await allocateAiWith(ON, { id: "pool-t4", tier: 4 });
  assert.deepEqual(modes, ["distribution", "distribution"]);
});

test("#5327 AI-hold: kontakten slukket → tier ved begge stier", async () => {
  const t1 = await allocateAiWith({}, { id: "pool-t1", tier: 1 });
  assert.ok(t1.modes.length > 0 && t1.modes.every((m) => m === "tier"), `fik ${t1.modes}`);
  const t4 = await allocateAiWith({ [PRIMARY_TYPE_MODE_FLAG_KEY]: "off" }, { id: "pool-t4", tier: 4 });
  assert.deepEqual(t4.modes, ["tier", "tier"]);
});

// ── 2) Wiring: relaunch-populationen ─────────────────────────────────────────

test("#5327 relaunch: kontakten on → generateLaunchPopulation får distribution, og tørkørslen viser det", async () => {
  const seen = [];
  const result = await generateAndInsertPopulation(fakeSupabase(ON), {
    dryRun: true, generate: spyGenerate(() => ({ riders: [] }), seen),
  });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0][1], { primaryTypeMode: "distribution" });
  assert.equal(result.primaryTypeMode, "distribution");
});

test("#5327 relaunch: kontakten slukket → tier, med den ægte population", async () => {
  const result = await generateAndInsertPopulation(fakeSupabase({}), { dryRun: true });
  assert.equal(result.primaryTypeMode, "tier");
  assert.equal(result.generated, LAUNCH_POPULATION.count);
});

// ── 3) Slukket = byte-identisk ───────────────────────────────────────────────

test("#5327: launch-populationen er byte-identisk med kaldformen før kontakten", () => {
  const before = generateFictionalRiders({ ...LAUNCH_POPULATION, existingFoldedNames: new Set() });
  assert.deepEqual(generateLaunchPopulation(), before, "uden options");
  assert.deepEqual(generateLaunchPopulation(new Set(), { primaryTypeMode: "tier" }), before, "eksplicit tier");

  const after = generateLaunchPopulation(new Set(), { primaryTypeMode: "distribution" });
  assert.notDeepEqual(
    after.riders.map((r) => r._meta.archetype),
    before.riders.map((r) => r._meta.archetype),
    "distribution skal faktisk ændre de primære typer",
  );
});
