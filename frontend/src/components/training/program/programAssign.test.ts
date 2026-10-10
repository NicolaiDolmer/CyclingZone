// #6035: Program-fanen vendt - rytter eller gruppe foerst, saa programmet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentProgramFor, currentProgramKey, resolveTarget, sectionsForTarget } from "./programAssignModel.ts";
import type { CatalogProgram } from "../../../lib/trainingPrograms.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const program = (key: string, targetTypes: string[]): CatalogProgram => ({
  key,
  name: { en: key, da: key },
  tagline: { en: "", da: "" },
  targetTypes,
  audience: null,
  days: {},
});
const catalog = [program("base", []), program("climb", ["climber"]), program("sprint", ["sprinter"]), program("hills", ["climber", "puncheur"])];
const riders = [
  { id: "r1", name: "A Rider", type: "climber" },
  { id: "r2", name: "B Rider", type: null },
];
const groups = [{ value: "group:g1", label: "Group: Climbers" }];

test("ingen modtager ved start; squad, gruppe og rytter genkendes", () => {
  assert.deepEqual(resolveTarget("", riders, groups), { kind: "none" });
  assert.deepEqual(resolveTarget("squad", riders, groups), { kind: "squad" });
  assert.deepEqual(resolveTarget("group:g1", riders, groups), { kind: "group", value: "group:g1" });
  assert.equal(resolveTarget("r1", riders, groups).kind, "rider");
  // En rytter der er forladt holdet, falder tilbage til intet valg.
  assert.deepEqual(resolveTarget("gone", riders, groups), { kind: "none" });
});

test("rytterens type: passende programmer i egen sektion, katalog-raekkefoelgen bevares", () => {
  const { fits, others } = sectionsForTarget(catalog, resolveTarget("r1", riders, groups));
  assert.deepEqual(fits.map((p) => p.key), ["climb", "hills"]);
  assert.deepEqual(others.map((p) => p.key), ["base", "sprint"]);
});

test("uden type (hold, gruppe, rytter uden type): een liste, ingen sektion", () => {
  for (const value of ["squad", "group:g1", "r2", ""]) {
    const { fits, others } = sectionsForTarget(catalog, resolveTarget(value, riders, groups));
    assert.equal(fits.length, 0, value);
    assert.equal(others.length, catalog.length, value);
  }
});

test("nuvaerende program kun for en rytter", () => {
  const assigned = { r1: "climb" };
  assert.equal(currentProgramKey(resolveTarget("r1", riders, groups), assigned), "climb");
  assert.equal(currentProgramKey(resolveTarget("r2", riders, groups), assigned), null);
  assert.equal(currentProgramKey(resolveTarget("squad", riders, groups), assigned), null);
  assert.equal(currentProgramKey(resolveTarget("r1", riders, groups), null), null);
});

test("fladen: vaelgeren foerst, ingen gold, samme API og gammel sti bevaret", () => {
  const src = read("TrainingProgramAssign.tsx");
  assert.doesNotMatch(src, /variant="primary"/);
  assert.ok(src.indexOf('data-testid="training-program-target"') < src.indexOf("<ul"), "vaelgeren staar over listen");
  // Kun "intet valgt" slaar fra; det nuvaerende program kan laegges paa igen
  // og nulstiller saa rettede felter til katalogets uge.
  assert.match(src, /disabled=\{busy \|\| target\.kind === "none"\}/);
  assert.match(src, /onApply\(program\.key, targetValue\)/);
  // Ingen select pr. programraekke laengere.
  assert.equal((src.match(/<select/g) ?? []).length, 1);
  assert.match(read("../TrainingProgramList.tsx"), /export \{ default \} from "\.\/program\/TrainingProgramAssign\.tsx";/);
});

test("i18n: EN og DA har de nye noegler, uden em-dash", () => {
  const en = JSON.parse(read("../../../../public/locales/en/training.json"));
  const da = JSON.parse(read("../../../../public/locales/da/training.json"));
  for (const key of ["pickTarget", "fitsType", "otherPrograms", "current", "browse", "closeCatalog"]) {
    assert.ok(en.programs[key] && da.programs[key], key);
    assert.doesNotMatch(`${en.programs[key]}${da.programs[key]}`, /—/, key);
  }
  assert.match(en.programs.fitsType, /\{type\}/);
  assert.match(da.programs.fitsType, /\{type\}/);
});

test("#5825 nuvaerende program som katalogobjekt (kun rytter, ellers null)", () => {
  const assigned = { r1: "climb" };
  assert.equal(currentProgramFor(resolveTarget("r1", riders, groups), assigned, catalog)?.key, "climb");
  assert.equal(currentProgramFor(resolveTarget("r2", riders, groups), assigned, catalog), null);
  assert.equal(currentProgramFor(resolveTarget("squad", riders, groups), assigned, catalog), null);
  // Et program der er ude af kataloget, giver ingen linje frem for en fejl.
  assert.equal(currentProgramFor(resolveTarget("r1", riders, groups), { r1: "gone" }, catalog), null);
});

test("#5825 telefonens fold: kun under sm, aria-expanded, valg lukker, desktop uaendret", () => {
  const src = read("TrainingProgramAssign.tsx");
  assert.match(src, /aria-expanded=\{catalogOpen\}/);
  assert.match(src, /aria-controls="training-program-catalog"/);
  assert.match(src, /className=\{catalogOpen \? "" : "hidden sm:block"\}/);
  assert.match(src, /if \(result\.ok\) setCatalogOpen\(false\)/);
  assert.match(src, /data-testid="training-program-close"/);
  // Ingen ny primary og ingen ny onApply-vej.
  assert.doesNotMatch(src, /variant="primary"/);
  assert.equal((src.match(/await onApply\(/g) ?? []).length, 1);
});
