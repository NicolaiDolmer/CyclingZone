import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { REGISTRY_PATH, parseRegistry, validate } from "./generate-feature-status.mjs";
import {
  BASELINE_PATH,
  isPlayerFacingFlag,
  requiresRoadmapText,
  missingRoadmapText,
  upcomingWithoutText,
  checkRoadmapText,
  baselineGrowth,
  parseBaseline,
  serializeBaseline,
  formatResult,
  parseArgs,
} from "./feature-registry-roadmap-check.mjs";

const e = (o) => ({ id: "x", area: "training", state: "beta", flag: "x_flag", ...o });

test("spillervendt = flag + ikke ops + building/dormant/beta", () => {
  assert.equal(isPlayerFacingFlag(e({})), true);
  assert.equal(isPlayerFacingFlag(e({ state: "building" })), true);
  assert.equal(isPlayerFacingFlag(e({ state: "dormant" })), true);
  assert.equal(isPlayerFacingFlag(e({ flag: undefined })), false);
  assert.equal(isPlayerFacingFlag(e({ area: "ops" })), false);
  assert.equal(isPlayerFacingFlag(e({ state: "live" })), false);
  assert.equal(isPlayerFacingFlag(e({ state: "retired" })), false);
  assert.equal(isPlayerFacingFlag(e({ state: "idea" })), false);
});

test("teksten kraeves kun i beta; building/dormant er spillervendte, men kraever den ikke endnu", () => {
  assert.equal(requiresRoadmapText(e({})), true);
  assert.equal(requiresRoadmapText(e({ state: "building" })), false);
  assert.equal(requiresRoadmapText(e({ state: "dormant" })), false);
  assert.equal(requiresRoadmapText(e({ area: "ops" })), false);
});

test("et nyt spillervendt flag i beta uden roadmap-tekst fejler", () => {
  const r = checkRoadmapText([e({ id: "new-beta" })], []);
  assert.deepEqual(r.missing, ["new-beta"]);
  assert.match(formatResult(r), /i beta uden roadmap-tekst \(1\)/);
});

test("et flag under byg uden tekst giver kun en advarsel, aldrig en fejl", () => {
  const entries = [e({ id: "wip", state: "building" }), e({ id: "parked", state: "dormant" }), e({ id: "ok", state: "building", roadmap_en: "A", roadmap_da: "B" })];
  const r = checkRoadmapText(entries, []);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.warnings, ["parked", "wip"]);
  assert.deepEqual(upcomingWithoutText(entries), ["parked", "wip"]);
  const text = formatResult(r);
  assert.match(text, /^Roadmap-tekst OK/);
  assert.match(text, /Advarsel \(fejler ikke\)/);
});

test("en baselinet post der rykker tilbage fra beta til building er foraeldet i baseline", () => {
  const r = checkRoadmapText([e({ id: "moved", state: "building" })], ["moved"]);
  assert.deepEqual(r.stale, ["moved"]);
  assert.deepEqual(r.warnings, ["moved"]);
});

test("flag med tekst passerer; halv tekst taeller som manglende", () => {
  assert.deepEqual(missingRoadmapText([e({ roadmap_en: "A", roadmap_da: "B" })]), []);
  assert.deepEqual(missingRoadmapText([e({ roadmap_en: "A" })]), ["x"]);
});

test("baseline undtager eksisterende huller, men forældede id'er fejler", () => {
  const entries = [e({ id: "old-gap" }), e({ id: "fixed", roadmap_en: "A", roadmap_da: "B" })];
  const r = checkRoadmapText(entries, ["old-gap", "fixed", "deleted"]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.baselined, ["old-gap"]);
  assert.deepEqual(r.stale, ["deleted", "fixed"]);
  assert.match(formatResult(r), /--update-baseline/);
});

test("baselineGrowth: nye id'er i forhold til base-ref fejler, faerre er fint", () => {
  assert.deepEqual(baselineGrowth(["a", "b", "c"], ["a", "b"]), ["c"]);
  assert.deepEqual(baselineGrowth(["a"], ["a", "b"]), []);
  const text = formatResult({ missing: [], baselined: [], stale: [], growth: ["c"] });
  assert.match(text, /kun skrumpe/);
});

test("parseBaseline/serializeBaseline round-trip og afviser forkert form", () => {
  assert.deepEqual(parseBaseline(serializeBaseline(["b", "a"], "c")), ["a", "b"]);
  assert.throws(() => parseBaseline("[]"), /baseline skal/);
  assert.throws(() => parseBaseline('{"ids":[1]}'), /baseline skal/);
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs([]), { baseRef: null, update: false });
  assert.deepEqual(parseArgs(["--base-ref", "origin/main"]), { baseRef: "origin/main", update: false });
  assert.deepEqual(parseArgs(["--base-ref=x", "--update-baseline"]), { baseRef: "x", update: true });
  assert.throws(() => parseArgs(["--nope"]), /Ukendt argument/);
});

test("roadmap-felterne valideres af registrets validate()", () => {
  const base = { id: "a", area: "training", title_en: "A", title_da: "A", state: "beta", verified: "2026-10-15" };
  assert.deepEqual(validate([{ ...base, roadmap_en: "A", roadmap_da: "B", roadmap_horizon: "later" }]), []);
  assert.match(validate([{ ...base, roadmap_en: "A" }]).join("\n"), /saettes sammen/);
  assert.match(validate([{ ...base, roadmap_en: "A", roadmap_da: "B", roadmap_horizon: "soon" }]).join("\n"), /next eller later/);
  assert.match(validate([{ ...base, roadmap_horizon: "next" }]).join("\n"), /kraever roadmap_en/);
});

test("det committede register er groent mod den committede baseline", () => {
  const entries = parseRegistry(readFileSync(REGISTRY_PATH, "utf8"));
  const r = checkRoadmapText(entries, parseBaseline(readFileSync(BASELINE_PATH, "utf8")));
  assert.deepEqual(r.missing, [], formatResult(r));
  assert.deepEqual(r.stale, [], formatResult(r));
});
