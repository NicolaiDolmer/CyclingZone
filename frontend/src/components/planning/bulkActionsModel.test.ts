// #7535 design-spor: modellen bag de tre handlinger (kun preview-mocken, ?actions=a|b|c).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_DRAFT,
  actionTargets,
  addToDraft,
  assistantFill,
  draftSummary,
  entriesWithDraft,
  parseActionsVariant,
  scopeRaces,
  withdrawnWithDraft,
} from "./bulkActionsModel.ts";
import type { SeasonEntry, SeasonRace } from "../../lib/planningWorkbench.ts";

const race = (id: string, start: number, end: number, sizeMax = 3, extra: Partial<SeasonRace> = {}): SeasonRace => ({
  id,
  name: id,
  raceClass: "Class1",
  stages: end - start + 1,
  status: "scheduled",
  stagesCompleted: 0,
  lineupLocked: false,
  gameDayStart: start,
  gameDayEnd: end,
  sizeMin: sizeMax,
  sizeMax,
  ...extra,
});
const entry = (raceId: string, riderId: string, raceRole: string | null = null): SeasonEntry => ({ raceId, riderId, raceRole });

const A = race("a", 1, 1);
const B = race("b", 1, 2); // deler loebsdag 1 med A
const C = race("c", 5, 5);
const PAST = race("past", 0, 0, 3, { status: "finished" });
const LOCKED = race("locked", 3, 3, 3, { lineupLocked: true });
const ALL = [PAST, A, B, LOCKED, C];

test("varianten virker kun i preview-mocken og kun for a|b|c", () => {
  assert.equal(parseActionsVariant("a", true), "a");
  assert.equal(parseActionsVariant("c", true), "c");
  assert.equal(parseActionsVariant("a", false), null);
  assert.equal(parseActionsVariant("d", true), null);
  assert.equal(parseActionsVariant(null, true), null);
});

test("omfang: naeste loeb springer forbi, laaste og afmeldte over; saesonen er alle kommende", () => {
  const ctx = { allRaces: ALL, listRaces: [A, B], checked: new Set(["c", "past"]), withdrawn: new Set(["a"]) };
  assert.deepEqual(scopeRaces("next", ctx).map((r) => r.id), ["b"]);
  assert.deepEqual(scopeRaces("season", ctx).map((r) => r.id), ["a", "b", "locked", "c"]);
  assert.deepEqual(scopeRaces("checked", ctx).map((r) => r.id), ["c"]);
  assert.deepEqual(scopeRaces("shown", ctx).map((r) => r.id), ["a", "b"]);
});

test("handlingernes taellere: assistenten kun hvor der mangler, fjern kun hvor der er ryttere", () => {
  const entries = [entry("a", "r1"), entry("a", "r2"), entry("a", "r3"), entry("b", "r4")];
  const ctx = { entries, withdrawn: new Set<string>() };
  const races = [A, B, LOCKED, C];
  assert.deepEqual(actionTargets("auto", races, ctx).map((r) => r.id), ["b", "c"]);
  assert.deepEqual(actionTargets("clear", races, ctx).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(actionTargets("withdraw", races, ctx).map((r) => r.id), ["a", "b", "c"]);
});

test("assistenten fylder op, beholder spillerens valg og bruger ingen rytter to gange paa samme loebsdag", () => {
  const riders = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map((id, i) => ({ id, abilities: { sprint: 70 - i, flat: 70 - i }, injured: id === "r2" }));
  const entries = [entry("a", "r1", "captain")];
  const fill = assistantFill({ races: [B, A], allRaces: ALL, entries, withdrawn: new Set(), riders, terrain: new Map() });
  const a = fill.get("a")!.map((e) => e.riderId);
  const b = fill.get("b")!.map((e) => e.riderId);
  assert.equal(a[0], "r1", "spillerens eget valg bliver");
  assert.equal(a.length, 3);
  assert.equal(b.length, 3);
  assert.ok(!a.includes("r2") && !b.includes("r2"), "skadede springes over");
  assert.equal(a.filter((id) => b.includes(id)).length, 0, "A og B deler loebsdag 1");
  assert.equal(fill.get("a")!.filter((e) => e.raceRole === "captain").length, 1);
  assert.equal(fill.get("b")!.filter((e) => e.raceRole === "captain").length, 1, "et tomt loeb faar en kaptajn");
});

test("kladden: sidste handling paa et loeb vinder, og intet aendres foer den anvendes", () => {
  const entries = [entry("a", "r1", "captain"), entry("b", "r4")];
  const auto = new Map([["b", [entry("b", "r4"), entry("b", "r5", "captain")]]]);
  let draft = addToDraft(EMPTY_DRAFT, "auto", ["b"], auto);
  draft = addToDraft(draft, "clear", ["a"]);
  draft = addToDraft(draft, "withdraw", ["c"]);
  assert.deepEqual(entriesWithDraft(entries, draft).map((e) => `${e.raceId}:${e.riderId}`).sort(), ["b:r4", "b:r5"]);
  assert.deepEqual([...withdrawnWithDraft(new Set(), draft)], ["c"]);
  assert.deepEqual(draftSummary(draft, entries), { auto: 1, added: 1, clear: 1, withdraw: 1 });
  draft = addToDraft(draft, "withdraw", ["b"]);
  assert.equal(draft.kinds.get("b"), "withdraw");
  assert.equal(draft.auto.has("b"), false);
  assert.deepEqual(entries.length, 2, "de gemte entries roeres aldrig");
});
