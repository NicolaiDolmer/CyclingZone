// #7685: kontakten for skrivningen af gemte potentiale-skøn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { POTENTIAL_ESTIMATE_WRITES_FLAG_KEY, isPotentialEstimateWritesEnabled } from "./potentialEstimateWritesFlag.js";
import { PLAYER_VISIBLE_BINARY_FLAG_KEYS, PLAYER_VISIBLE_FLAG_KEYS, isStageFlagKey } from "./stageFlagCatalog.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const client = (value) => createFakeSupabase({
  app_config: value === undefined ? [] : [{ key: POTENTIAL_ESTIMATE_WRITES_FLAG_KEY, value }],
});

test("#7685 flag: kun on tænder; beta, off og manglende række er slukket", async () => {
  assert.equal(POTENTIAL_ESTIMATE_WRITES_FLAG_KEY, "potential_estimate_writes");
  assert.equal(await isPotentialEstimateWritesEnabled(client("on")), true);
  assert.equal(await isPotentialEstimateWritesEnabled(client("beta")), false);
  assert.equal(await isPotentialEstimateWritesEnabled(client("off")), false);
  assert.equal(await isPotentialEstimateWritesEnabled(client(undefined)), false);
});

test("#7685 flag: en opslagsfejl er slukket", async () => {
  const failing = createFakeSupabase({ app_config: [] }, { errors: { app_config: { select: "boom" } } });
  assert.equal(await isPotentialEstimateWritesEnabled(failing), false);
  assert.equal(await isPotentialEstimateWritesEnabled({ from() { throw new Error("boom"); } }), false);
});

test("#7685 flag: står i kataloget og er ikke spiller-synligt", () => {
  assert.equal(isStageFlagKey(POTENTIAL_ESTIMATE_WRITES_FLAG_KEY), true);
  assert.equal([...PLAYER_VISIBLE_FLAG_KEYS].includes(POTENTIAL_ESTIMATE_WRITES_FLAG_KEY), false);
  assert.equal(PLAYER_VISIBLE_BINARY_FLAG_KEYS.includes(POTENTIAL_ESTIMATE_WRITES_FLAG_KEY), false);
});

test("#7685 flag: migrationen seeder off og overskriver aldrig ejerens stadie", () => {
  const sql = readFileSync(new URL("../../database/2026-11-05-6110-potential-estimate-writes-flag.sql", import.meta.url), "utf8");
  assert.match(sql, /'potential_estimate_writes',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});
