// backend/lib/engine/v4/mechanics/allOutCrack6641.test.ts
// #6641/#7280: Alt ud efter ejerens design 27/10 (spec 2026-10-27-6641-alt-ud-design.md).
// Laaser retningerne (ikke tallene): gevinsten vokser med evne og reserve, tom reserve
// giver ingen gevinst, risikoen for at knaekke er 0 over taersklen og vokser under den,
// og aeldre revisioner er uroerte (kodekontakten er fjernet, krav 5). Ingen balance-tal i asserts (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { allOutCrackProbability, allOutGainLoss, allOutLevel01, allOutReserve01, climbBlockOf, segmentCrackProbability } from "./allOutCrack6641.ts";
import { ALL_OUT_7280_TUNING, setAllOut7280TuningForBench } from "./effortCost.ts";
import { simulateStageV4 } from "../index.ts";
import { validateTimelineEvents } from "../timeline.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, RouteV2, StageInput, StageOutput } from "../types.ts";

const T = ALL_OUT_7280_TUNING;

test("reserven: friskhed x vaegtet W'-andel; traet og tom giver mindst", () => {
  assert.equal(allOutReserve01(10, 10, 1, T.reserveWprimeWeight), 1);
  assert.ok(allOutReserve01(0, 10, 1, T.reserveWprimeWeight) > 0, "en frisk rytter med tom W' har stadig noget");
  assert.ok(allOutReserve01(5, 10, 0.6, T.reserveWprimeWeight) < allOutReserve01(5, 10, 0.9, T.reserveWprimeWeight), "traethed taerer paa reserven");
  assert.equal(allOutReserve01(0, 10, 1, 1), 0, "kun W' (vaegt 1): tom = 0");
  assert.equal(allOutReserve01(5, 0, 1, 1), 0, "ingen W'-kapacitet = tom");
});

test("gevinsten: vokser med evnen (mest de staerke) og reserven; tom reserve = ingen gevinst", () => {
  assert.equal(allOutLevel01(0, T.levelPower), 1);
  assert.ok(allOutLevel01(0.05, T.levelPower) > allOutLevel01(0.3, T.levelPower));
  assert.ok(allOutGainLoss(0.05, 1, T) > allOutGainLoss(0.3, 1, T), "staerk > midt");
  assert.ok(allOutGainLoss(0.3, 1, T) > 0, "alle vinder");
  assert.ok(allOutGainLoss(0.1, 1, T) > allOutGainLoss(0.1, 0.5, T));
  assert.equal(allOutGainLoss(0.1, 0, T), 0);
  for (const d of [0, 0.2, 0.6, 1, Number.NaN]) for (const r of [0, 0.5, 1, Number.NaN]) assert.ok(allOutGainLoss(d, r, T) >= 0);
});

test("knaek: 0 over taersklen, voksende under den, aldrig over loftet; segmenterne summer til stigningens risiko", () => {
  assert.equal(allOutCrackProbability(1, T), 0);
  assert.equal(allOutCrackProbability(T.crackReserve, T), 0);
  const lo = allOutCrackProbability(T.crackReserve * 0.8, T);
  const hi = allOutCrackProbability(T.crackReserve * 0.3, T);
  assert.ok(lo > 0 && hi > lo, "lavere reserve = stoerre risiko");
  assert.ok(allOutCrackProbability(0, T) <= T.crackMaxProbability);
  const p = 0.3;
  const two = 1 - (1 - segmentCrackProbability(p, 0.4)) * (1 - segmentCrackProbability(p, 0.6));
  assert.ok(Math.abs(two - p) < 1e-12, "to segmenter = hele stigningen");
  assert.equal(segmentCrackProbability(0, 1), 0);
});

test("climbBlockOf: den sammenhaengende stigningsblok", () => {
  const segs = [{ kind: "flat", from_km: 0, to_km: 10 }, { kind: "climb", from_km: 10, to_km: 14 }, { kind: "climb", from_km: 14, to_km: 20 }, { kind: "descent", from_km: 20, to_km: 30 }];
  assert.deepEqual(climbBlockOf(segs, 2), { start: 1, end: 2, lengthKm: 10 });
  assert.equal(climbBlockOf(segs, 0), null);
});

// ── Motoren: topankomst under s5_profiles_v3 ────────────────────────────────

const KEYS: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
const ab = (level: number, climbing: number): Record<AbilityKey, number> => Object.fromEntries(KEYS.map((k) => [k, k === "climbing" ? climbing : level])) as Record<AbilityKey, number>;

const ROUTE: RouteV2 = {
  distance_km: 160,
  profile_type: "mountain",
  finale_type: "long_climb",
  segments: [
    { kind: "flat", from_km: 0, to_km: 60 },
    { kind: "climb", from_km: 60, to_km: 80, category: "1", avg_gradient: 7, top_elevation_m: 1500 },
    { kind: "descent", from_km: 80, to_km: 100, technicality: 3 },
    { kind: "rolling", from_km: 100, to_km: 140 },
    { kind: "climb", from_km: 140, to_km: 150, category: "HC", avg_gradient: 8.5, top_elevation_m: 2000 },
    { kind: "climb", from_km: 150, to_km: 160, category: "HC", avg_gradient: 8.5, top_elevation_m: 2400 },
  ],
  weather: { kind: "sun", wind_exposure: 0.2 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160 }],
};

function field(effort: Entrant["effort"], condition = 1): Entrant[] {
  const riders: Entrant[] = Array.from({ length: 50 }, (_, i) => ({ rider_id: `r${String(i).padStart(2, "0")}`, abilities: ab(40, 30 + ((i * 7) % 60)), role: "free_role", effort: "normal", condition: 1 }));
  for (const lv of [55, 70, 82]) riders.push({ rider_id: `ao${lv}`, abilities: ab(50, lv), role: "free_role", effort, condition });
  return riders;
}

function run(effort: Entrant["effort"], seed: string, condition = 1, rules_revision = "s5_profiles_v3"): StageOutput {
  const input: StageInput = { route: ROUTE, startlist: field(effort, condition), orders: [], seed, tuning: RACE_V4_TUNING, rules_revision };
  return simulateStageV4(input);
}

const SEEDS = Array.from({ length: 8 }, (_, i) => `ao7280-${i}`);
const aoEvents = (out: StageOutput) => out.timeline.events.filter((e) => e.type === "all_out_gain" || e.type === "all_out_cracked");

test("aeldre revision: ingen alt ud-events, og alt ud koerer som foer", () => {
  for (const seed of SEEDS.slice(0, 3)) assert.equal(aoEvents(run("all_out", seed, 1, "s5_profiles_v2")).length, 0);
});

test("s5_profiles_v3: alt ud vinder paa den afgoerende stigning, deterministisk og med gyldig tidslinje", () => {
  try {
    let gains = 0;
    let saved = 0;
    for (const seed of SEEDS) {
      const out = run("all_out", seed);
      const again = run("all_out", seed);
      assert.deepEqual(aoEvents(out), aoEvents(again), "samme seed = samme udfald");
      const ids = new Set(out.results.map((r) => r.rider_id));
      assert.deepEqual(validateTimelineEvents(out.timeline.events, { distanceKm: ROUTE.distance_km, knownRiderIds: ids }), []);
      for (const e of aoEvents(out)) {
        assert.ok(String(e.params.rider_id).startsWith("ao"), "kun alt ud-ryttere faar linjen");
        if (e.type === "all_out_gain") { gains++; assert.equal("seconds" in e.params, false, "ingen sekunder i linjen"); }
      }
      // Samme felt og seed uden gevinst og knaek (kontrafaktisk): alt ud-rytterne er hurtigere.
      setAllOut7280TuningForBench({ gainLoss: 0, crackMaxProbability: 0 });
      const without = run("all_out", seed);
      setAllOut7280TuningForBench(null);
      const t = (o: StageOutput) => o.results.filter((r) => String(r.rider_id).startsWith("ao") && r.status === "finished").reduce((s, r) => s + Number(r.time_seconds), 0);
      saved += t(without) - t(out);
    }
    assert.ok(gains > 0, "mindst én alt ud-linje over froeene");
    assert.ok(saved > 0, "alt ud vinder samlet tid paa topankomsten");
  } finally {
    setAllOut7280TuningForBench(null);
  }
});

test("s5_profiles_v3: en traet rytter knaekker oftere end en frisk (traethed der hober sig op)", () => {
  const cracks = (condition: number) => SEEDS.reduce((n, seed) => n + run("all_out", seed, condition).timeline.events.filter((e) => e.type === "all_out_cracked").length, 0);
  assert.ok(cracks(0.3) > cracks(1), "lav reserve = flere knaek");
});

test('s5_profiles_v3: ogsaa en alt ud-rytter ALENE paa den sidste stigning kan knaekke og taber tid (Codex-fund)', () => {
  const solo = (seed: string, tuning = {}) => {
    setAllOut7280TuningForBench(tuning);
    const input: StageInput = { route: ROUTE, startlist: [{ rider_id: 'solo', abilities: ab(50, 70), role: 'free_role', effort: 'all_out', condition: 0.2 }], orders: [], seed, tuning: RACE_V4_TUNING, rules_revision: 's5_profiles_v3' };
    return simulateStageV4(input);
  };
  try {
    let cracked = 0;
    for (const seed of SEEDS) {
      const out = solo(seed);
      if (out.timeline.events.some((e) => e.type === 'all_out_cracked')) {
        cracked++;
        const calm = solo(seed, { crackMaxProbability: 0 });
        const time = (o: StageOutput) => Number(o.results[0]?.time_seconds);
        assert.ok(time(out) > time(calm), 'knaekket alene = langsommere');
      }
    }
    assert.ok(cracked > 0, 'lav reserve alene giver knaek over froeene');
  } finally {
    setAllOut7280TuningForBench(null);
  }
});
