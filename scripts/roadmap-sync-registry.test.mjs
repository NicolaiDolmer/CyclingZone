import { test } from "node:test";
import assert from "node:assert/strict";

import { AREAS } from "./generate-feature-status.mjs";
import { AREA_ENGINE, itemFromEntry, planSync, formatPlan, parseArgs } from "./roadmap-sync-registry.mjs";

const ENGINES = ["races", "training", "youth", "market", "club"];
const entry = (o) => ({
  id: "stage-page",
  area: "race-day",
  state: "beta",
  flag: "stage_page_v2",
  roadmap_en: "New stage page",
  roadmap_da: "Ny etapeside",
  ...o,
});

test("AREA_ENGINE daekker alle registrets areas med et lovligt engine", () => {
  for (const area of AREAS) {
    assert.ok(ENGINES.includes(AREA_ENGINE[area]), `area ${area} mangler et lovligt engine`);
  }
});

test("itemFromEntry: skjult med publish_on_beta (ejer-gate), planned, flag_key, horizon default next, epic -> issue_ref", () => {
  assert.deepEqual(itemFromEntry(entry({ epic: "6100" }), 70), {
    engine: "races",
    sort_order: 70,
    title_en: "New stage page",
    title_da: "Ny etapeside",
    approved: false,
    publish_on_beta: true,
    status: "planned",
    horizon: "next",
    issue_ref: 6100,
    flag_key: "stage_page_v2",
  });
  const later = itemFromEntry(entry({ roadmap_horizon: "later" }));
  assert.equal(later.horizon, "later");
  assert.equal(later.issue_ref, null);
});

test("planSync: opretter kun poster med tekst og flag, som ikke allerede har et punkt", () => {
  const entries = [
    entry({ id: "a", flag: "flag_a" }),
    entry({ id: "b", flag: "flag_b" }),
    entry({ id: "c", flag: "flag_c", roadmap_en: undefined, roadmap_da: undefined }),
    entry({ id: "d", flag: undefined }),
    entry({ id: "e", flag: "flag_e", state: "retired" }),
    entry({ id: "f", flag: "flag_f", state: "live" }),
  ];
  const plan = planSync({ entries, existingFlagKeys: ["flag_b"] });
  assert.deepEqual(plan.inserts.map((p) => p.id), ["a"]);
  assert.deepEqual(plan.skipped.map((s) => s.id), ["d", "e", "f"]);
});

test("planSync: kun spillervendte pre-live poster (ikke spec/idea/ops) (#6694)", () => {
  const entries = [
    entry({ id: "b", flag: "fb", state: "building" }),
    entry({ id: "s", flag: "fs", state: "spec" }),
    entry({ id: "i", flag: "fi", state: "idea" }),
    entry({ id: "o", flag: "fo", state: "beta", area: "ops" }),
  ];
  const plan = planSync({ entries, existingFlagKeys: [] });
  assert.deepEqual(plan.inserts.map((p) => p.id), ["b"]);
  assert.deepEqual(plan.skipped.map((s) => s.id), ["s", "i", "o"]);
});

test("planSync: sync saetter aldrig approved = true, uanset registrets state", () => {
  const plan = planSync({
    entries: [entry({ id: "a", flag: "fa", state: "beta" }), entry({ id: "b", flag: "fb", state: "building" })],
    existingFlagKeys: [],
  });
  for (const p of plan.inserts) {
    assert.equal(p.row.approved, false, p.id);
    assert.equal(p.row.publish_on_beta, true, p.id);
  }
});

test("planSync: nye punkter laegges sidst i planen med 10 i afstand, i registrets raekkefoelge", () => {
  const plan = planSync({
    entries: [entry({ id: "a", flag: "fa" }), entry({ id: "b", flag: "fb" }), entry({ id: "c", flag: "fc" })],
    existingFlagKeys: ["fb"],
    maxSortOrder: 996,
  });
  assert.deepEqual(plan.inserts.map((p) => [p.id, p.row.sort_order]), [["a", 1006], ["c", 1016]]);
  const empty = planSync({ entries: [entry({ id: "a", flag: "fa" })], existingFlagKeys: [] });
  assert.equal(empty.inserts[0].row.sort_order, 10);
});

test("planSync er idempotent: anden koersel efter oprettelse planlaegger intet", () => {
  const entries = [entry({ id: "a", flag: "flag_a" }), entry({ id: "b", flag: "flag_b" })];
  const first = planSync({ entries, existingFlagKeys: [] });
  assert.equal(first.inserts.length, 2);
  const second = planSync({ entries, existingFlagKeys: first.inserts.map((p) => p.row.flag_key) });
  assert.equal(second.inserts.length, 0);
});

test("planSync: to poster med samme flag giver kun eet punkt", () => {
  const plan = planSync({
    entries: [entry({ id: "a", flag: "same" }), entry({ id: "b", flag: "same" })],
    existingFlagKeys: [],
  });
  assert.deepEqual(plan.inserts.map((p) => p.id), ["a"]);
});

test("formatPlan skelner dry-run fra apply", () => {
  const plan = planSync({ entries: [entry({})], existingFlagKeys: [] });
  assert.match(formatPlan(plan, { apply: false }), /dry-run/);
  assert.match(formatPlan(plan, { apply: false }), /--apply/);
  assert.match(formatPlan(plan, { apply: true }), /^Opretter 1/);
  assert.match(formatPlan({ inserts: [], skipped: [] }, { apply: false }), /ingen/);
});

test("parseArgs: dry-run er default, ukendte argumenter fejler", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--apply"]), { apply: true });
  assert.throws(() => parseArgs(["--force"]), /Ukendt argument/);
});
