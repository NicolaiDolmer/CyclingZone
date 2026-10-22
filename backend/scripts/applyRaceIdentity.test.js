import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs, validateSeed, applyRaceIdentity } from "./applyRaceIdentity.js";
import { TIER_IDENTITY_DISTRIBUTION } from "../lib/raceIdentityTypes.js";

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

test("checked-in seed: valid, isolated examples, and never writes without a client", async () => {
  const doc = JSON.parse(readFileSync(new URL("../../database/seed/race_identity.json", import.meta.url), "utf8"));
  assert.ok(doc.examples.length >= 2 && doc.examples.length <= 3);
  assert.equal(validateSeed({ version: 1, entries: doc.examples }).length, doc.examples.length);
  const exampleIds = new Set(doc.examples.map(row => row.external_id));
  assert.ok(validateSeed(doc).every(row => !exampleIds.has(row.external_id)), "examples are documentation, never entries");
  await assert.rejects(applyRaceIdentity(doc, { apply: true }), /Supabase client is required/);
});

// #6930 (L4): 65 short S5 stage races carry a type + signature, 5 monuments an authored route.
// Per-division placement is checked against prod in the dry-run; here the totals of owner table A.
test("checked-in seed: type totals match table A and every monument has an authored route", () => {
  const doc = JSON.parse(readFileSync(new URL("../../database/seed/race_identity.json", import.meta.url), "utf8"));
  const typed = doc.entries.filter(row => row.race_identity_type !== null);
  const authored = doc.entries.filter(row => row.authored_route !== null);
  assert.equal(typed.length, 65);
  assert.equal(authored.length, 5);
  assert.equal(typed.length + authored.length, doc.entries.length);
  for (const row of typed) assert.ok(row.signature?.features.length >= 1 && row.authored_route === null, row.external_id);
  for (const row of authored) assert.ok(row.signature === null, row.external_id);
  const want = {};
  for (const tier of Object.values(TIER_IDENTITY_DISTRIBUTION)) for (const [type, n] of Object.entries(tier)) want[type] = (want[type] ?? 0) + n;
  const got = {};
  for (const row of typed) got[row.race_identity_type] = (got[row.race_identity_type] ?? 0) + 1;
  assert.deepEqual(got, want);
  // An uphill finale only exists in the derived profile when a climb reaches the line
  // (authored sprints cannot carry a finish ramp), so the route must encode it.
  for (const row of authored) {
    const route = row.authored_route;
    const summit = route.climbs.some(climb => climb.summit_finish && climb.crest_km === route.distance_km);
    if (["uphill_sprint", "wall_finish", "long_climb"].includes(route.finale_type)) assert.ok(summit, `${row.external_id}: uphill finale needs a summit-finish climb`);
    if (route.finale_type === "descent") assert.ok(!summit && route.climbs.length, `${row.external_id}: descent finale needs a last top before the line`);
  }
});
