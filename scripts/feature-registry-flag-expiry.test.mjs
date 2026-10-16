import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { REGISTRY_PATH, parseRegistry, validate } from "./generate-feature-status.mjs";
import {
  BASELINE_PATH,
  needsExpiry,
  hasExpiry,
  missingExpiry,
  overdue,
  checkExpiry,
  baselineGrowth,
  parseBaseline,
  serializeBaseline,
  formatResult,
  parseArgs,
} from "./feature-registry-flag-expiry.mjs";

const e = (o) => ({ id: "x", area: "training", state: "dormant", ...o });
const TODAY = "2026-10-16";

test("building/dormant/beta kraever felterne, med eller uden flag; live/retired/spec/idea ikke", () => {
  for (const state of ["building", "dormant", "beta"]) assert.equal(needsExpiry(e({ state })), true);
  assert.equal(needsExpiry(e({ state: "dormant", flag: "f" })), true);
  for (const state of ["live", "retired", "spec", "idea"]) assert.equal(needsExpiry(e({ state })), false);
});

test("begge felter skal vaere sat", () => {
  assert.equal(hasExpiry(e({ decision: "taend", decide_by: "2026-11-01" })), true);
  assert.equal(hasExpiry(e({ decision: "taend" })), false);
  assert.equal(hasExpiry(e({ decide_by: "2026-11-01" })), false);
});

test("missingExpiry er sorteret og springer live over", () => {
  const entries = [
    e({ id: "b" }),
    e({ id: "a", state: "building" }),
    e({ id: "c", state: "live" }),
    e({ id: "d", decision: "fjern", decide_by: "2026-12-01" }),
  ];
  assert.deepEqual(missingExpiry(entries), ["a", "b"]);
});

test("overskredet frist er strengt foer i dag og sorteres aeldste foerst", () => {
  const entries = [
    e({ id: "today", decision: "taend", decide_by: TODAY }),
    e({ id: "late-b", decision: "fjern", decide_by: "2026-10-01" }),
    e({ id: "late-a", decision: "taend", decide_by: "2026-10-01" }),
    e({ id: "older", decision: "noedbremse", decide_by: "2026-09-01" }),
    e({ id: "future", decision: "taend", decide_by: "2026-12-01" }),
    e({ id: "live", state: "live", decision: "taend", decide_by: "2026-01-01" }),
  ];
  assert.deepEqual(overdue(entries, TODAY).map((o) => o.id), ["older", "late-a", "late-b"]);
});

test("ny post uden felter fejler; baselinet er tilladt; udfyldt baseline-post er forældet", () => {
  const entries = [
    e({ id: "new" }),
    e({ id: "old" }),
    e({ id: "done", decision: "taend", decide_by: "2026-12-01" }),
  ];
  const r = checkExpiry(entries, ["old", "done", "gone"], TODAY);
  assert.deepEqual(r.missing, ["new"]);
  assert.deepEqual(r.baselined, ["old"]);
  assert.deepEqual(r.stale, ["done", "gone"]);
});

test("overskredne frister er advarsel, aldrig fejl", () => {
  const entries = [e({ id: "late", decision: "taend", decide_by: "2026-01-01" })];
  const r = checkExpiry(entries, [], TODAY);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.stale, []);
  assert.equal(r.overdue.length, 1);
  assert.match(formatResult(r), /frist overskredet \(1\)[\s\S]*late: taend, decide_by 2026-01-01/);
});

test("baseline-vaekst findes mod base-ref", () => {
  assert.deepEqual(baselineGrowth(["a", "b", "c"], ["a"]), ["b", "c"]);
  assert.deepEqual(baselineGrowth(["a"], ["a", "b"]), []);
});

test("parseBaseline/serializeBaseline roundtripper og afviser forkert form", () => {
  assert.deepEqual(parseBaseline(serializeBaseline(["b", "a"], "c")), ["a", "b"]);
  assert.throws(() => parseBaseline('{"ids":[1]}'));
  assert.throws(() => parseBaseline("{}"));
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs([]), { baseRef: null, update: false });
  assert.deepEqual(parseArgs(["--base-ref", "origin/main"]), { baseRef: "origin/main", update: false });
  assert.deepEqual(parseArgs(["--base-ref=x", "--update-baseline"]), { baseRef: "x", update: true });
  assert.throws(() => parseArgs(["--nope"]));
});

test("validate afviser halve eller ugyldige decision/decide_by-felter", () => {
  const base = { id: "x", area: "ops", title_en: "t", title_da: "t", state: "building", verified: "2026-10-16" };
  assert.deepEqual(validate([{ ...base, decision: "taend", decide_by: "2026-11-01" }]), []);
  assert.match(validate([{ ...base, decision: "taend" }]).join("\n"), /saettes sammen/);
  assert.match(validate([{ ...base, decision: "maaske", decide_by: "2026-11-01" }]).join("\n"), /decision skal vaere/);
  assert.match(validate([{ ...base, decision: "taend", decide_by: "1/11" }]).join("\n"), /decide_by skal vaere/);
});

test("det rigtige register: ingen ny post mangler felterne, og baseline er ikke forældet", () => {
  const entries = parseRegistry(readFileSync(REGISTRY_PATH, "utf8"));
  assert.deepEqual(validate(entries), []);
  const r = checkExpiry(entries, parseBaseline(readFileSync(BASELINE_PATH, "utf8")), TODAY);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.stale, []);
});
