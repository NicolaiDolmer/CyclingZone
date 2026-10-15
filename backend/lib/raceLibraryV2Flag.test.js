// #6514 · gaten for kalenderens løbskort + Løbshistorik. Dækker:
//   1) SELVE GATEN: off/beta/on + fail-safe (ukendt/fejl = nuværende visning).
//   2) RUTEN: svarer en bar boolean, aldrig stadiet; fejl giver enabled:false.
//   3) WIRINGEN: ruten er mountet i api.js, flaget står i STAGE_FLAGS, og
//      migrationen seeder 'off' idempotent.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { isStageFlagKey } from "./stageFlagCatalog.js";
import { RACE_LIBRARY_V2_FLAG_KEY, isRaceLibraryV2Enabled, createRaceLibraryV2Router } from "./raceLibraryV2Flag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
const migration = readFileSync(resolve(__dirname, "../../database/2026-10-15-6514-race-library-v2-flag.sql"), "utf8");

function supabaseWith(value, { fail = false } = {}) {
  return {
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          if (fail) return { data: null, error: { message: "boom" } };
          return { data: value === undefined ? null : { value }, error: null };
        },
      };
      return q;
    },
  };
}

test("#6514: nøglen er race_library_v2 og står i STAGE_FLAGS", () => {
  assert.equal(RACE_LIBRARY_V2_FLAG_KEY, "race_library_v2");
  assert.ok(isStageFlagKey(RACE_LIBRARY_V2_FLAG_KEY));
});

test("#6514: off/beta/on evalueres som de øvrige stadie-flag", async () => {
  assert.equal(await isRaceLibraryV2Enabled(supabaseWith("off"), { isBetaTester: true }), false);
  assert.equal(await isRaceLibraryV2Enabled(supabaseWith("beta"), { isBetaTester: false }), false);
  assert.equal(await isRaceLibraryV2Enabled(supabaseWith("beta"), { isBetaTester: true }), true);
  assert.equal(await isRaceLibraryV2Enabled(supabaseWith("on"), { isBetaTester: false }), true);
});

test("#6514: manglende række, ukendt værdi og læsefejl = nuværende visning", async () => {
  assert.equal(await isRaceLibraryV2Enabled(supabaseWith(undefined), { isBetaTester: true }), false);
  assert.equal(await isRaceLibraryV2Enabled(supabaseWith("maybe"), { isBetaTester: true }), false);
  assert.equal(await isRaceLibraryV2Enabled(supabaseWith("on", { fail: true }), { isBetaTester: true }), false);
});

async function callRoute({ value, beta, betaThrows = false }) {
  const app = express();
  const reported = [];
  app.use(createRaceLibraryV2Router({
    supabase: supabaseWith(value),
    requireAuth: (_req, _res, next) => next(),
    isViewerBetaTester: async () => { if (betaThrows) throw new Error("lookup failed"); return beta; },
    readLimiter: (_req, _res, next) => next(),
    reportError: (e) => reported.push(e),
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/races/race-library-v2`);
    return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control"), reported };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("#6514: ruten svarer { enabled } som bar boolean, uden stadiet", async () => {
  const beta = await callRoute({ value: "beta", beta: true });
  assert.equal(beta.status, 200);
  assert.deepEqual(beta.body, { enabled: true });
  assert.equal(beta.cache, "no-store");
  const notBeta = await callRoute({ value: "beta", beta: false });
  assert.deepEqual(notBeta.body, { enabled: false });
});

test("#6514: fejl i beta-opslaget giver enabled:false og rapporteres", async () => {
  const r = await callRoute({ value: "on", beta: true, betaThrows: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enabled: false });
  assert.equal(r.reported.length, 1);
});

test("#6514: ruten er mountet i api.js", () => {
  assert.match(apiSource, /import \{ createRaceLibraryV2Router \} from "\.\.\/lib\/raceLibraryV2Flag\.js"/);
  assert.match(apiSource, /router\.use\(createRaceLibraryV2Router\(\{/);
});

test("#6514: migrationen seeder 'off' idempotent", () => {
  assert.match(migration, /'race_library_v2'/);
  assert.match(migration, /'"off"'::jsonb/);
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING/);
  assert.doesNotMatch(migration, /DO UPDATE/i);
});
