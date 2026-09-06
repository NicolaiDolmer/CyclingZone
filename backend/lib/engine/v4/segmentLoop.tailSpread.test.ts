// backend/lib/engine/v4/segmentLoop.tailSpread.test.ts
// #4885: property-tests for de to led der giver feltet en hale — udmattelsen i
// tærsklen (physiology.wprimeDepletionCpMultiplier) og det relative styrke-led
// i fart-modellen (segmentLoop.groupStrengthSpeedFactor + referenceCpByKind).
//
// Samme form som segmentLoop.groupDraft.test.ts (#4604): funktionerne er
// eksporteret netop for at kunne testes direkte, fordi en ende-til-ende-test
// ikke kan skelne "leddet er koblet fra" fra "leddet er koblet til og flyttede
// ingenting".

import { test } from "node:test";
import assert from "node:assert/strict";

import { groupStrengthSpeedFactor, referenceCpByKind } from "./segmentLoop.ts";
import { wprimeDepletionCpMultiplier, deriveCp } from "./physiology.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, SegmentKind } from "./types.ts";

const KINDS: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function entrant(riderId: string, level: number): Entrant {
  const abilities = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) abilities[key] = level;
  return { rider_id: riderId, abilities, role: "free_role", effort: "normal", condition: 1 };
}

// ── Udmattelsen i tærsklen ──────────────────────────────────────────────────

test("#4885: en fuld reserve koster ingenting, en tom koster mest", () => {
  assert.equal(wprimeDepletionCpMultiplier(1, 1), 1, "fuld reserve => multiplikator 1");
  const empty = wprimeDepletionCpMultiplier(0, 1);
  assert.ok(empty < 1, "tom reserve skal koste tærskel");
  assert.ok(empty > 0, "udmattelsen maa aldrig nulstille tærsklen");
});

test("#4885: udmattelses-multiplikatoren er monotont ikke-faldende i reserve-andelen", () => {
  let previous = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const value = wprimeDepletionCpMultiplier(i / 20, 1);
    assert.ok(value >= previous, `reserve-andel ${i / 20}: ${value} < ${previous} — styrke straffes`);
    previous = value;
  }
});

test("#4885: udmattelsen har ingen evne-akse — samme reserve-andel giver samme straf", () => {
  // Invariant 3 (§3): to ryttere med samme udtoemning skal rammes identist,
  // uanset hvor stor deres reserve er i absolutte tal.
  const halfSmall = wprimeDepletionCpMultiplier(0.1, 0.2);
  const halfLarge = wprimeDepletionCpMultiplier(0.5, 1);
  assert.equal(halfSmall, halfLarge, "halv reserve skal koste det samme uanset kapacitetens stoerrelse");
});

test("#4885: ingen anaerob kapacitet overhovedet giver fuld straf, ikke immunitet", () => {
  // Samme holdning som climbSelection.energyDeficit01, hvor #4604 rettede
  // praecis den modsatte guard.
  assert.equal(wprimeDepletionCpMultiplier(0, 0), wprimeDepletionCpMultiplier(0, 1));
});

test("#4885: udmattelsen kan aldrig vende to rytteres indbyrdes CP-orden ved samme udtoemning", () => {
  const strongCp = deriveCp(entrant("a", 80).abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
  const weakCp = deriveCp(entrant("b", 20).abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const factor = wprimeDepletionCpMultiplier(fraction, 1);
    assert.ok(strongCp * factor > weakCp * factor, `reserve-andel ${fraction}: den staerkeste skal blive staerkest`);
  }
});

// ── Det relative styrke-led i fart-modellen ─────────────────────────────────

test("#4885: en gruppe der matcher feltets reference koerer praecis basishastigheden", () => {
  for (const kind of KINDS) {
    assert.equal(groupStrengthSpeedFactor(0.25, 0.25, kind, RACE_V4_TUNING), 0, `${kind}: reference => faktor 0`);
  }
});

test("#4885: styrke-leddet er monotont ikke-faldende i gruppens kollektive CP", () => {
  for (const kind of KINDS) {
    let previous = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const value = groupStrengthSpeedFactor((i / 40) * 0.5, 0.25, kind, RACE_V4_TUNING);
      assert.ok(value >= previous, `${kind}: en staerkere gruppe blev langsommere (${value} < ${previous})`);
      previous = value;
    }
  }
});

test("#4885: en svagere gruppe end referencen er altid langsommere, en staerkere altid hurtigere", () => {
  for (const kind of KINDS) {
    assert.ok(groupStrengthSpeedFactor(0.1, 0.25, kind, RACE_V4_TUNING) < 0, `${kind}: underskud skal koste fart`);
    assert.ok(groupStrengthSpeedFactor(0.4, 0.25, kind, RACE_V4_TUNING) > 0, `${kind}: overskud skal give fart`);
  }
});

test("#4885: styrke omsaettes mest til fart op ad bakke og mindst nedad", () => {
  // Samme rangorden som work.draftFactor's terraen-ordning, af samme fysiske
  // grund: op ad bakke er farten naer proportional med baeredygtig effekt,
  // nedad koerer tyngdekraften.
  const deficitAt = (kind: SegmentKind) => -groupStrengthSpeedFactor(0.1, 0.25, kind, RACE_V4_TUNING);
  assert.ok(deficitAt("climb") > deficitAt("cobbles"));
  assert.ok(deficitAt("cobbles") > deficitAt("rolling"));
  assert.ok(deficitAt("rolling") > deficitAt("flat"));
  assert.ok(deficitAt("flat") > deficitAt("descent"));
});

test("#4885: en reference paa 0 degenererer sikkert til ingen effekt", () => {
  for (const kind of KINDS) {
    assert.equal(groupStrengthSpeedFactor(0.3, 0, kind, RACE_V4_TUNING), 0);
  }
});

test("#4885: reference-CP'en er feltets staerkeste andel og er skala-invariant i feltets stoerrelse", () => {
  const small = [entrant("a", 90), entrant("b", 10), entrant("c", 10), entrant("d", 10), entrant("e", 10)];
  const reference = referenceCpByKind(small, RACE_V4_TUNING);
  const strongestClimbCp = deriveCp(small[0].abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
  // 5 ryttere x frontFraction 0,2 => netop 1 rytter i front-skiven.
  assert.equal(reference.climb, strongestClimbCp, "front-skiven skal vaere feltets staerkeste");

  // Et ensartet felt har sin egen CP som reference, uanset niveau — det er
  // hele pointen med relativiseringen (population-uafhaengighed, #4604).
  for (const level of [5, 30, 99]) {
    const uniform = Array.from({ length: 20 }, (_, i) => entrant(`r${i}`, level));
    const ref = referenceCpByKind(uniform, RACE_V4_TUNING);
    const own = deriveCp(uniform[0].abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
    assert.ok(Math.abs(ref.climb - own) < 1e-12, `niveau ${level}: et ensartet felt er sin egen reference`);
    assert.equal(groupStrengthSpeedFactor(own, ref.climb, "climb", RACE_V4_TUNING), 0);
  }
});

test("#4885: reference-CP'en daekker alle terraen-typer", () => {
  const field = Array.from({ length: 10 }, (_, i) => entrant(`r${i}`, 40 + i));
  const reference = referenceCpByKind(field, RACE_V4_TUNING);
  for (const kind of KINDS) {
    assert.ok(Number.isFinite(reference[kind]), `${kind} skal have en reference`);
    assert.ok(reference[kind] > 0, `${kind}: reference skal vaere positiv for et felt med evner`);
  }
});
