// #7884/#8828: motorens dommer-scenarier M1-M8 (docs/superpowers/specs/2026-11-26-7884-taktik-klager-og-angreb-paa-stigning.md,
// afsnit 6), skrevet foer koden. Hvert scenarie fejler uden sin regel.
import test from "node:test";
import assert from "node:assert/strict";
import type { RaceGroup } from "../types.ts";
import {
  LONG_ATTACK_7884_AFTER_CAUGHT_TASK,
  allOutGainEligible7884,
  launchLongAttack7884,
  longAttackCaught7884,
  longAttackGroupId7884,
  longAttackStep7884,
} from "./longAttack7884.ts";
import { LONG_ATTACK_7884_TUNING } from "../tuning.ts";

const g = (id: string, rider_ids: string[], gap_seconds: number, extra: Partial<RaceGroup> = {}): RaceGroup => ({ id, kind: "peloton", rider_ids, gap_seconds, cohesion: 1, ...extra });

test("M1: afsaet fra foden med samme hul som gruppen, ingen flytning frem; alene i gruppen = intet", () => {
  const groups = [g("brk", ["b1", "b2"], 0, { kind: "breakaway", origin: "breakaway" }), g("pel", ["a", "p1", "p2"], 90)];
  const out = launchLongAttack7884(groups, "a", 4);
  const attack = out.find((x) => x.rider_ids.includes("a"))!;
  assert.equal(attack.id, longAttackGroupId7884("a", 4));
  assert.equal(attack.kind, "solo");
  assert.equal(attack.gap_seconds, 90);
  assert.equal(attack.origin, undefined);
  assert.deepEqual(out.find((x) => x.id === "pel")!.rider_ids, ["p1", "p2"]);
  assert.deepEqual(groups[1].rider_ids, ["a", "p1", "p2"], "input uaendret");
  // Fra udbruddet arves oprindelsen.
  assert.equal(launchLongAttack7884(groups, "b1", 4).find((x) => x.rider_ids.includes("b1"))!.origin, "breakaway");
  // Alene, eller ukendt rytter: samme array.
  const solo = [g("s", ["x"], 10), g("pel", ["p1"], 30)];
  assert.equal(launchLongAttack7884(solo, "x", 1), solo);
  assert.equal(launchLongAttack7884(solo, "nobody", 1), solo);
});

test("M2: tillaegget betales af reserven; tom reserve = intet tillaeg", () => {
  const full = longAttackStep7884({ wprime: 1, wprimeMax: 1, dtSeconds: 60 });
  assert.ok(full.cpMultiplier > 1);
  assert.ok(full.wprimeAfter < 1);
  assert.equal(full.bonusSeconds, 60);
  const empty = longAttackStep7884({ wprime: 0, wprimeMax: 1, dtSeconds: 60 });
  assert.deepEqual(empty, { cpMultiplier: 1, wprimeAfter: 0, bonusSeconds: 0 });
  // Intet gratis: uden pris findes tillaegget ikke.
  assert.equal(longAttackStep7884({ wprime: 1, wprimeMax: 1, dtSeconds: 60 }, { ...LONG_ATTACK_7884_TUNING, reserveSharePerHour: 0 }).cpMultiplier, 1);
  // Reserven loeber toer paa et langt skridt, og tillaegget holder kun saa laenge.
  const long = longAttackStep7884({ wprime: 0.05, wprimeMax: 1, dtSeconds: 3600 });
  assert.equal(long.wprimeAfter, 0);
  assert.ok(long.bonusSeconds < 3600);
});

test("M3: en traet rytter (mindre reserve) faar maalbart mindre ud af angrebet end en frisk", () => {
  const fresh = longAttackStep7884({ wprime: 0.9, wprimeMax: 1, dtSeconds: 1800 });
  const tired = longAttackStep7884({ wprime: 0.2, wprimeMax: 1, dtSeconds: 1800 });
  assert.ok(tired.cpMultiplier < fresh.cpMultiplier);
  assert.ok(tired.bonusSeconds < fresh.bonusSeconds);
});

test("M4: ingen ny tilfaeldighed; samme input giver samme output", () => {
  const args = { wprime: 0.4, wprimeMax: 1, dtSeconds: 420 };
  assert.deepEqual(longAttackStep7884(args), longAttackStep7884(args));
  const groups = [g("pel", ["a", "b", "c"], 12)];
  assert.deepEqual(launchLongAttack7884(groups, "b", 2), launchLongAttack7884(groups, "b", 2));
  assert.equal(longAttackStep7884.length <= 2 && launchLongAttack7884.length === 3, true);
});

test("M5: hentet = gruppen rummer ryttere bagfra; saa er angrebet slut, og leddet koeres som Foelg med", () => {
  const before = [g("att", ["a"], 30, { kind: "solo" }), g("pel", ["p1", "p2"], 45)];
  const after = [g("pel", ["a", "p1", "p2"], 30)];
  assert.equal(longAttackCaught7884(before, after, "a"), true);
  assert.equal(LONG_ATTACK_7884_AFTER_CAUGHT_TASK, "follow_moves");
  // Stadig alene foran: ikke hentet.
  assert.equal(longAttackCaught7884(before, [g("att", ["a"], 20, { kind: "solo" }), g("pel", ["p1", "p2"], 45)], "a"), false);
});

test("M6: at koere op til en gruppe foran er ikke at blive hentet", () => {
  const before = [g("brk", ["b1", "b2"], 0, { kind: "breakaway" }), g("att", ["a"], 25, { kind: "solo" }), g("pel", ["p1"], 80)];
  const after = [g("brk", ["b1", "b2", "a"], 0, { kind: "breakaway" }), g("pel", ["p1"], 70)];
  assert.equal(longAttackCaught7884(before, after, "a"), false);
  assert.equal(longAttackCaught7884(before, [], "a"), false);
});

test("M7: uden en angrebsordre goer mekanikken intet (samme objekter)", () => {
  const groups = [g("pel", ["p1", "p2"], 0)];
  assert.equal(launchLongAttack7884(groups, "a", 0), groups);
  assert.equal(allOutGainEligible7884("p1", undefined), true);
});

test("M8: én ejer af gevinsten: en rytter paa langt angreb faar ikke ogsaa Alt ud-gevinsten", () => {
  assert.equal(allOutGainEligible7884("a", new Set(["a"])), false);
  assert.equal(allOutGainEligible7884("b", new Set(["a"])), true);
});
