import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pendingRaceFromQuote, isPendingReleaseResult, pendingRaceLabel, pendingReleasesByRider,
} from "./pendingReleaseModel8153.ts";

// #8153: skaermdelen af "frigivelse midt i et etapeloeb venter til loebets slut".

test("8153: quote uden pendingRace = frigivelsen sker straks (kontakten slukket eller intet aktivt loeb)", () => {
  assert.equal(pendingRaceFromQuote({ fee: 100, balance: 500, affordable: true }), null);
  assert.equal(pendingRaceFromQuote({ fee: 100, pendingRace: null }), null);
  assert.equal(pendingRaceFromQuote(null), null);
  assert.equal(pendingRaceFromQuote({ pendingRace: { name: "uden id" } }), null);
});

test("8153: quote med pendingRace = frigivelsen venter paa netop det loeb", () => {
  assert.deepEqual(pendingRaceFromQuote({ fee: 0, pendingRace: { id: "r1", name: "Tour A" } }), { id: "r1", name: "Tour A" });
  assert.deepEqual(pendingRaceFromQuote({ pendingRace: { id: "r1" } }), { id: "r1", name: null });
});

test("8153: kun { pending: true } er en bestilling; en almindelig frigivelse er ikke", () => {
  assert.equal(isPendingReleaseResult({ pending: true, race: { id: "r1", name: "Tour A" }, fee: 10 }), true);
  assert.equal(isPendingReleaseResult({ id: "rider", team_id: null }), false);
  assert.equal(isPendingReleaseResult({ pending: "true" }), false);
  assert.equal(isPendingReleaseResult(undefined), false);
});

test("8153: loebsnavnet bruges, ellers den oversatte reserve", () => {
  assert.equal(pendingRaceLabel({ name: " Tour A " }, "the stage race"), "Tour A");
  assert.equal(pendingRaceLabel({ raceName: "Tour B" }, "the stage race"), "Tour B");
  assert.equal(pendingRaceLabel({ name: "" }, "the stage race"), "the stage race");
  assert.equal(pendingRaceLabel(null, "etapeløbet"), "etapeløbet");
});

test("8153: holdets ventende frigivelser bliver et opslag pr. rytter; skrald giver tomt opslag", () => {
  assert.deepEqual(
    pendingReleasesByRider([
      { riderId: "a", raceId: "r1", raceName: "Tour A" },
      { riderId: "b", raceId: "r2", raceName: null },
      { raceId: "r3" },
    ]),
    { a: { raceId: "r1", raceName: "Tour A" }, b: { raceId: "r2", raceName: null } },
  );
  assert.deepEqual(pendingReleasesByRider({ error: "nope" }), {});
  assert.deepEqual(pendingReleasesByRider(null), {});
});

// Teksterne er ejer-godkendt 14/11 (docs/superpowers/specs/2026-11-14-8153-frigivelse-venter-design.md).
const read = (lang: string) => JSON.parse(readFileSync(new URL(`../../public/locales/${lang}/rider.json`, import.meta.url), "utf8"));

test("8153: de godkendte tekster staar ordret i EN og DA", () => {
  const en = read("en").manage.release;
  const da = read("da").manage.release;
  assert.equal(en.pendingLine, "He is riding {race}. He leaves your team after the final stage. The fee is charged now and the release cannot be undone.");
  assert.equal(da.pendingLine, "Han kører {race}. Han forlader dit hold efter sidste etape. Gebyret trækkes nu, og frigivelsen kan ikke fortrydes.");
  assert.equal(en.pendingSuccess, "{rider} will be released after {race}. The fee of {fee} CZ$ has been charged.");
  assert.equal(da.pendingSuccess, "{rider} frigives efter {race}. Gebyret på {fee} CZ$ er trukket.");
  assert.equal(read("en").badges.leavesAfter, "Leaves after {race}");
  assert.equal(read("da").badges.leavesAfter, "Forlader holdet efter {race}");
});

test("8153: alle sprog har noeglerne (ingen raa noegle paa skaermen)", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const ns = read(lang);
    for (const key of ["pendingLine", "pendingSuccess"]) {
      assert.ok(ns.manage.release[key]?.includes("{race}"), `${lang}: manage.release.${key}`);
    }
    assert.ok(ns.manage.release.pendingRaceFallback?.trim(), `${lang}: manage.release.pendingRaceFallback`);
    assert.ok(ns.badges.leavesAfter?.includes("{race}"), `${lang}: badges.leavesAfter`);
  }
});
