// #4522 — programsektionen i assistent-panelet: ren afledning.
import test from "node:test";
import assert from "node:assert/strict";

import {
  programForRiderType, buildProgramSuggestionGroups, acceptableGroupRiderIds,
} from "./assistantProgramSuggestions.ts";
import type { CatalogProgram } from "./trainingPrograms.ts";

const prog = (key: string, targetTypes: string[], audience: string | null = null): CatalogProgram => ({
  key, name: { en: key, da: key }, tagline: { en: "", da: "" }, targetTypes, audience, days: {},
});
const CATALOG = [
  prog("sprinter", ["sprinter"]),
  prog("hill_climber", ["climber"]),
  prog("classics", ["brostensrytter", "puncheur"]),
  prog("puncheur", ["puncheur"]),
  prog("build_base", [], "all"),
];
const rider = (id: string, primary_type: string | null, name = id) => ({
  id, firstname: name, lastname: "X", primary_type,
});

test("programForRiderType: et program kun til typen vinder over et delt; uden match = null", () => {
  assert.equal(programForRiderType(CATALOG, "sprinter")?.key, "sprinter");
  assert.equal(programForRiderType(CATALOG, "puncheur")?.key, "puncheur", "ikke classics, selvom classics staar foer");
  assert.equal(programForRiderType(CATALOG, "brostensrytter")?.key, "classics", "faldback: delt program");
  assert.equal(programForRiderType(CATALOG, "tt"), null);
  assert.equal(programForRiderType(CATALOG, null), null);
  assert.equal(programForRiderType(null, "sprinter"), null);
});

test("programmer uden type (audience) foreslaas aldrig", () => {
  const groups = buildProgramSuggestionGroups({ riders: [rider("a", "rouleur")], catalog: CATALOG });
  assert.deepEqual(groups, []);
});

test("grupperer efter primary_type, stoerste gruppe foerst, navne bevares", () => {
  const groups = buildProgramSuggestionGroups({
    riders: [rider("a", "climber", "Ann"), rider("b", "sprinter", "Bo"), rider("c", "sprinter", "Cy"), rider("d", null)],
    catalog: CATALOG,
  });
  assert.deepEqual(groups.map((g) => [g.riderType, g.programKey, g.riderIds]), [
    ["sprinter", "sprinter", ["b", "c"]],
    ["climber", "hill_climber", ["a"]],
  ]);
  assert.deepEqual(groups[0].names, ["Bo X", "Cy X"]);
});

test("ryttere med egen ugeplan eller som foelger en gruppe udelades; tom gruppe forsvinder", () => {
  const groups = buildProgramSuggestionGroups({
    riders: [rider("a", "sprinter"), rider("b", "sprinter"), rider("c", "sprinter"), rider("d", "climber")],
    catalog: CATALOG,
    ownPlanIds: new Set(["a"]),
    groupFollowerIds: new Set(["b", "d"]),
  });
  assert.deepEqual(groups.map((g) => g.riderIds), [["c"]]);
});

test("acceptableGroupRiderIds fjerner dem der har faaet en plan siden forslaget", () => {
  const group = { riderIds: ["a", "b", "c"] };
  assert.deepEqual(acceptableGroupRiderIds(group), ["a", "b", "c"]);
  assert.deepEqual(acceptableGroupRiderIds(group, new Set(["a"]), new Set(["c"])), ["b"]);
});

test("tomme input giver ingen forslag", () => {
  assert.deepEqual(buildProgramSuggestionGroups({ riders: null, catalog: null }), []);
  assert.deepEqual(buildProgramSuggestionGroups({ riders: [rider("a", "sprinter")], catalog: [] }), []);
});
