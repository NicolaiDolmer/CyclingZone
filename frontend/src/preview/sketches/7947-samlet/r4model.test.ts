import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDateOverride, quickPattern, resolveDate, type R4Field } from "./r4model.ts";

const base = (): R4Field[] => [
  { kind: "train", session: "endurance", source: "program" },
  { kind: "train", session: "endurance", source: "program" },
  { kind: "stage", label: "Etape 3", source: "stage" },
  { kind: "train", session: "recovery", source: "program" },
  { kind: "train", session: "recovery", source: "program" },
];

test("uden hurtigvalg og manuelt felt er datoen programmets", () => {
  assert.deepEqual(resolveDate(base(), null, {}), base());
});

test("hurtigvalg fylder de aabne felter i raekkefoelge og roerer aldrig etapen", () => {
  const out = resolveDate(base(), { kind: "effort", effort: "hard", type: "Klatrer" }, {});
  assert.equal(out[2].kind, "stage");
  const open = out.filter((f) => f.kind === "train");
  assert.deepEqual(open.map((f) => f.kind === "train" && f.session), ["vo2max_climb", "threshold", "vo2max_climb", "tempo"]);
  assert.ok(open.every((f) => f.kind === "train" && f.source === "quick"));
});

test("et manuelt felt vinder over hurtigvalget", () => {
  const out = resolveDate(base(), { kind: "effort", effort: "let", type: "Sprinter" }, { 1: "sprint" });
  assert.deepEqual(out[1], { kind: "train", session: "sprint", source: "manual" });
  assert.equal(out[0].kind === "train" && out[0].source, "quick");
});

test("hvile er sit eget valg, ikke en indsats sammen med en type", () => {
  assert.deepEqual(quickPattern({ kind: "rest", rest: "recovery" }), Array(5).fill("recovery"));
});

test("koerte felter roeres ikke af et senere valg", () => {
  const done: R4Field[] = base().map((f) => (f.kind === "train" ? { ...f, done: true } : f));
  assert.deepEqual(resolveDate(done, { kind: "rest", rest: "rest" }, { 0: "sprint" }), done);
});

test("datoen har en overstyring kun ved hurtigvalg eller manuelt felt", () => {
  assert.equal(hasDateOverride(null, {}), false);
  assert.equal(hasDateOverride(null, { 4: "tempo" }), true);
});
