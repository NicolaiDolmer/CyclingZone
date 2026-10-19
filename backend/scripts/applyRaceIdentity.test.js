import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs, validateSeed, applyRaceIdentity } from "./applyRaceIdentity.js";

const entry = (external_id = "tour") => ({ external_id, race_identity_type: "hilly", signature: null, authored_route: null });
const seed = (entries = [entry()]) => ({ version: 1, entries });
const catalog = () => [{ id: "id-tour", external_id: "tour", race_type: "stage_race", race_class: "Class1", race_identity_type: null, signature: null, authored_route: null }];
function client(rows = catalog(), result = { data: [{ id: "id-tour" }], error: null }) {
  const writes = [];
  const db = { from(table) {
    assert.equal(table, "race_pool");
    return {
      select() { return { order() { return { range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null }) }; } }; },
      update(patch) { return { eq(key, id) { writes.push({ patch, key, id }); return { select: async () => result }; } }; },
    };
  } };
  return { db, writes };
}

test("CLI defaults to dry-run and rejects ambiguous/unknown arguments", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(["--apply"]).apply, true);
  assert.equal(parseArgs(["--file", "input.json"]).file, "input.json");
  for (const args of [["--aply"], ["--file"], ["--apply", "--dry-run"], ["--apply", "--apply"]]) assert.throws(() => parseArgs(args));
});

test("seed rejects unknown keys, duplicate ids and missing explicit nullable fields", () => {
  assert.equal(validateSeed(seed()).length, 1);
  for (const doc of [[], { ...seed(), version: 2 }, { ...seed(), entires: [] }, seed([entry(), entry()]), seed([{ external_id: "tour" }]), seed([{ ...entry(), race_identity_type: "unknown" }])]) assert.throws(() => validateSeed(doc));
});

test("dry-run plans writes but never performs them; explicit apply updates only identity columns", async () => {
  const { db, writes } = client();
  assert.deepEqual(await applyRaceIdentity(seed(), { supabase: db }), { mode: "dry-run", entries: 1, changes: 1, written: 0 });
  assert.equal(writes.length, 0);
  assert.deepEqual(await applyRaceIdentity(seed(), { supabase: db, apply: true }), { mode: "apply", entries: 1, changes: 1, written: 1 });
  assert.deepEqual(writes, [{ key: "id", id: "id-tour", patch: { race_identity_type: "hilly", signature: null, authored_route: null } }]);
});

test("invalid last input or catalog row cannot produce partial writes", async () => {
  for (const doc of [seed([entry(), { ...entry("bad"), signature: {} }]), seed([entry(), entry("missing")])]) {
    const { db, writes } = client();
    await assert.rejects(applyRaceIdentity(doc, { supabase: db, apply: true }));
    assert.equal(writes.length, 0);
  }
  for (const rows of [[...catalog(), ...catalog()], [{ ...catalog()[0], race_type: "single" }]]) {
    const { db, writes } = client(rows);
    await assert.rejects(applyRaceIdentity(seed(), { supabase: db, apply: true }));
    assert.equal(writes.length, 0);
  }
});

test("no-op is idempotent and failed/zero-row mutations are errors", async () => {
  const noOp = client([{ ...catalog()[0], race_identity_type: "hilly" }]);
  assert.equal((await applyRaceIdentity(seed(), { supabase: noOp.db, apply: true })).changes, 0);
  assert.equal(noOp.writes.length, 0);
  for (const result of [{ data: null, error: { message: "denied" } }, { data: [], error: null }]) {
    const { db } = client(catalog(), result);
    await assert.rejects(applyRaceIdentity(seed(), { supabase: db, apply: true }), /tour/);
  }
});

test("authored route accepts the catalog's Monuments class and rejects other races", async () => {
  const doc = JSON.parse(readFileSync(new URL("../../database/seed/race_identity.json", import.meta.url), "utf8"));
  const monument = { ...doc.examples[2], external_id: "tour" };
  const good = client([{ ...catalog()[0], race_type: "single", race_class: "Monuments" }]);
  assert.equal((await applyRaceIdentity(seed([monument]), { supabase: good.db })).changes, 1);
  const bad = client();
  await assert.rejects(applyRaceIdentity(seed([monument]), { supabase: bad.db, apply: true }), /Monuments/);
  assert.equal(bad.writes.length, 0);
});

test("checked-in skeleton has valid isolated examples and applies nothing without a client", async () => {
  const doc = JSON.parse(readFileSync(new URL("../../database/seed/race_identity.json", import.meta.url), "utf8"));
  assert.equal(validateSeed(doc).length, 0);
  assert.ok(doc.examples.length >= 2 && doc.examples.length <= 3);
  assert.equal(validateSeed({ version: 1, entries: doc.examples }).length, doc.examples.length);
  assert.equal((await applyRaceIdentity(doc, { apply: true })).written, 0);
});
