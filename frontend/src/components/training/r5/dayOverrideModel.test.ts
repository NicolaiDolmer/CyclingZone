// #8592 + #8819 · "Kun denne dag": den rene model bag dagsvælgerens valg.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dayOverridesOf, hasDayOverrides, outcomeLineKey, overrideReplaced, overrideSessionGroups, recentByDate, ruleMarksOf, selectedRiderIds, todayOverrides,
} from "./dayOverrideModel.ts";
import { futureFields } from "./dayPickerModel.ts";

test("datoens valg læses fra ugens svar; uden kontakten er der intet", () => {
  assert.deepEqual(dayOverridesOf({ date: "2026-11-27", weekday: "fri", available: true, races: [] }), {});
  assert.equal(hasDayOverrides(null), false);
  const day = { date: "2026-11-27", weekday: "fri", available: true, races: [], dayOverrides: { r1: { session: "rest" } } };
  assert.equal(hasDayOverrides(day), true);
  assert.deepEqual(dayOverridesOf(day).r1, { session: "rest" });
});

test("et løb vinder: alle felter taget = erstattet, nogle felter = løbet går forud (ejer punkt 4)", () => {
  assert.equal(overrideReplaced({ raceSlots: [], restSlots: [] }), null);
  assert.equal(overrideReplaced({ raceSlots: [2], restSlots: [] }), "some");
  assert.equal(overrideReplaced({ raceSlots: [0, 1, 2, 3, 4], restSlots: [] }), "all");
  assert.equal(overrideReplaced({ raceSlots: [], restSlots: [0, 1, 2, 3, 4] }), "rest");
  assert.equal(overrideReplaced({ raceSlots: [2], restSlots: [0, 1, 3, 4] }), "all");
});

test("valget vises i de frie felter, løbsfeltet bliver løb", () => {
  const fields = futureFields({ programSlot: () => "rest", planSession: "tempo", fields: { raceSlots: [2], restSlots: [] } });
  assert.equal(fields.length, 5);
  assert.equal(fields[0], "rest");
  assert.notEqual(fields[2], "rest");
});

test("flere ryttere og grupper giver hver rytter én gang, kun holdets egne (ejer punkt 6)", () => {
  const roster = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const groups = [{ id: "g", members: [{ riderId: "b" }, { riderId: "c" }, { riderId: "z" }] }];
  assert.deepEqual(selectedRiderIds({ riderIds: ["a", "b"], groupIds: ["g"], groups, roster }), ["a", "b", "c"]);
  assert.deepEqual(selectedRiderIds({ riderIds: [], groupIds: [], groups, roster }), []);
});

test("pas-listen har hele dage først, så færdighed og træning", () => {
  const groups = overrideSessionGroups({ skill: ["technique"], byLevel: { easy: ["endurance"], hard: ["sprint"] } });
  assert.deepEqual(groups.map((g) => g.key), ["wholeDay", "skill", "easy", "hard"]);
  assert.deepEqual(groups[0].sessions, ["rest", "recovery"]);
});

test("#8819 DO-10: grænsens markering læses kun fra dagen, der har den (i morgen)", () => {
  assert.deepEqual(ruleMarksOf(null), {});
  const day = { date: "2026-11-27", weekday: "fri", available: true, races: [], fatigueRuleAhead: { r1: { kind: "fatigue" as const, fallback: "rest" as const } } };
  assert.deepEqual(ruleMarksOf(day).r1, { kind: "fatigue", fallback: "rest" });
});

test("#8819 DO-12: linjen siger, hvad der tog valget; som valgt siger intet, medmindre valget slog grænsen", () => {
  assert.equal(outcomeLineKey({ outcome: "race" }), "dayOverride.outcome.race");
  assert.equal(outcomeLineKey({ outcome: "race", some: true }), "dayOverride.outcome.raceSome");
  assert.equal(outcomeLineKey({ outcome: "fatigue_rule" }), "dayOverride.outcome.fatigue_rule");
  assert.equal(outcomeLineKey({ outcome: "unavailable" }), "dayOverride.outcome.unavailable");
  assert.equal(outcomeLineKey({ outcome: "trained" }), null);
  assert.equal(outcomeLineKey({ outcome: "trained", beatsRule: true }), "dayOverride.outcome.beatsRule");
  assert.equal(outcomeLineKey({ outcome: "nonsense" }), null);
  assert.equal(outcomeLineKey(null), null);
});

test("#8819 DO-12: dagens valg i trupens rækkefølge, og de seneste dage nyeste først, kun egne ryttere", () => {
  const roster = [{ id: "a" }, { id: "b" }];
  const today = todayOverrides({ b: { dateOverride: { session: "rest", outcome: "race" } }, a: { dateOverride: null }, z: { dateOverride: { session: "rest" } } }, roster);
  assert.deepEqual(today, [{ riderId: "b", session: "rest", outcome: "race" }]);
  const recent = recentByDate([
    { date: "2026-11-24", riderId: "b", session: "rest", outcome: "trained" },
    { date: "2026-11-25", riderId: "b", session: "rest", outcome: "race" },
    { date: "2026-11-25", riderId: "a", session: "tempo", outcome: "fatigue_rule" },
    { date: "2026-11-25", riderId: "z", session: "tempo", outcome: "trained" },
  ], roster);
  assert.deepEqual(recent.map((d) => [d.date, d.entries.map((e) => e.riderId)]), [["2026-11-25", ["a", "b"]], ["2026-11-24", ["b"]]]);
});

test("hver dayOverride-nøgle, I dag og dagsvælgeren bruger, findes på alle fem sprog (pastHeading manglede)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const used = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))) {
    for (const m of fs.readFileSync(path.join(dir, file), "utf8").matchAll(/["'`](dayOverride\.[A-Za-z0-9_.]+)["'`]/g)) used.add(m[1]);
  }
  assert.ok(used.has("dayOverride.pastHeading"));
  const get = (obj: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, "../../../../public/locales", lang, "trainingR5.json"), "utf8"));
    assert.deepEqual([...used].filter((key) => typeof get(json, key) !== "string"), [], lang);
  }
});