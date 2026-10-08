// backend/lib/engine/v4/finale.levelScale.test.ts
// #6049: dagens modifikatorer i finalen (reserve, dagsform, indsats) foelger
// puljens niveau og en fast kandidat-gruppe. Prod-felterne ligger langt under
// fixtures'enes evne-skala og er ensartede inden for en division; et fast,
// absolut tillaeg ordnede derfor hele den midterste del af feltet tilfaeldigt.
// Egen fil, saa den ikke kolliderer med andre spors aendringer i finale.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  computeFinaleAbilityScore,
  finaleAbilityTerm,
  finaleCandidateReference,
  finaleHook,
  finaleLevelScale,
  finaleModifierScale,
} from "./finale.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { FINALE_EXTRA_TUNING, RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, EngineState, RiderState, RouteV2, Segment } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];
const SPRINT: Partial<Record<AbilityKey, number>> = RACE_V4_TUNING.finale.demandVectorByFinaleType.bunch_sprint ?? {};
const EXTRA = FINALE_EXTRA_TUNING;

function abilities(base: number, overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = base;
  return { ...out, ...overrides };
}

test("finaleLevelScale: fuld ved og over referencen, proportional under, neutral uden reference", () => {
  assert.equal(finaleLevelScale(0.5, 0.5), 1);
  assert.equal(finaleLevelScale(0.8, 0.5), 1);
  assert.equal(finaleLevelScale(0.25, 0.5), 0.5);
  assert.equal(finaleLevelScale(0, 0.5, 0.1), 0.2, "gulvet holder skalaen over 0");
  assert.equal(finaleLevelScale(0.2, 0), 1, "reference 0 = det gamle opgoer");
  assert.equal(finaleLevelScale(0.2, Number.NaN), 1);
  assert.equal(finaleLevelScale(Number.NaN, 0.5), 0);
});

test("finaleCandidateReference: hoejeste af andelen af den bedste og den N-bedste", () => {
  const terms = [0.4, 0.38, 0.37, 0.36, 0.1, 0.05];
  assert.equal(finaleCandidateReference(terms, 0.4, 0), 0.4 * 0.4, "N = 0: kun andelen (#5957-opgoeret)");
  assert.equal(finaleCandidateReference(terms, 0.4, 3), 0.37, "ensartet top: den tredjebedste");
  assert.equal(finaleCandidateReference(terms, 0.4, 6), 0.4 * 0.4, "andelen slaar en svag N-te");
  assert.equal(finaleCandidateReference(terms, 0.4, 50), 0.4 * 0.4, "faerre ryttere end N: kun andelen");
  assert.equal(finaleCandidateReference([], 0.4, 3), 0);
});

// Den skala finaleHook giver rytter `i` i puljen `terms`.
function hookScale(terms: number[], i: number): number {
  const best = Math.max(...terms);
  const level = finaleLevelScale(best, EXTRA.modifierReferenceAbilityTerm, EXTRA.modifierScaleFloor);
  const ref = finaleCandidateReference(terms, EXTRA.modifierFullScaleShare, EXTRA.modifierCandidateCount);
  return level * finaleModifierScale(terms[i], ref, EXTRA.modifierScaleFloor, 1);
}

test("#6049 monotoni: mere evne giver aldrig en lavere finale-score, ogsaa naar puljens referencer flytter sig", () => {
  const efforts = ["grupetto", "save", "normal", "protect", "all_out"] as const;
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 25, maxLength: 40 }),
      fc.nat({ max: 24 }),
      fc.integer({ min: 1, max: 40 }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: -0.1, max: 0.1, noNaN: true }),
      fc.constantFrom(...efforts),
      (sprints, idx, delta, reserve, form, effort) => {
        const scoreAt = (sprint: number): number => {
          const pool = sprints.map((s, j) => abilities(20, { sprint: j === idx ? sprint : s }));
          const terms = pool.map((ab) => finaleAbilityTerm(ab, SPRINT));
          return computeFinaleAbilityScore(
            pool[idx], reserve, SPRINT, EXTRA.wprimeReserveWeight, effort, form,
            EXTRA.dayformScoreWeight, EXTRA.dayformScoreClamp, hookScale(terms, idx),
          );
        };
        const lo = sprints[idx];
        const hi = Math.min(99, lo + delta);
        return scoreAt(hi) >= scoreAt(lo) - 1e-12;
      },
    ),
    { numRuns: 300, seed: 6049 },
  );
});

// ── Hele finalen: et ensartet, svagt felt maa ikke vaere mere tilfaeldigt end
// det samme felt paa fixtures'enes skala ─────────────────────────────────────

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    idx.forEach(([, i], k) => { r[i] = k + 1; });
    return r;
  };
  const a = rank(xs);
  const b = rank(ys);
  const n = xs.length;
  const m = (n + 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - m) * (b[i] - m);
    da += (a[i] - m) ** 2;
    db += (b[i] - m) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** Massespurt med `n` ryttere i én gruppe; evnerne er `base`-skaleret. Spearman(sprint, placering). */
function bunchSprintCorrelation(scale: number, seed: number): number {
  const rnd = lcg(seed);
  const n = 100;
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  const ids: string[] = [];
  const sprint: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = `r${String(i).padStart(3, "0")}`;
    // Ensartet divisionsfelt: alle evner i et smalt baand (prod-lignende).
    const s = 8 + rnd() * 17;
    const ab = abilities(Math.round(12 * scale), {
      sprint: Math.round(s * scale),
      acceleration: Math.round((8 + rnd() * 15) * scale),
      positioning: Math.round((8 + rnd() * 15) * scale),
      flat: Math.round((10 + rnd() * 15) * scale),
    });
    entrants[id] = { rider_id: id, abilities: ab, role: "free_role", effort: "normal", condition: 1 };
    // Samme dagsform og reserve for hvert felt (samme seed), uafhaengigt af evnen.
    const dayform = (rnd() - 0.5) * 0.08;
    const wprime = 0.3 + rnd() * 0.7;
    riders[id] = {
      rider_id: id, group_id: "peloton-0", cp: 0.5, wprimeMax: 1, wprime, dayform,
      seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
    } as RiderState;
    ids.push(id);
    sprint.push(ab.sprint);
  }
  const segment: Segment = { kind: "flat", from_km: 140, to_km: 150 } as Segment;
  const route: RouteV2 = {
    distance_km: 150,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [segment],
    weather: { kind: "sun", wind_exposure: 0.1 },
    waypoints: [],
  } as RouteV2;
  const ctx = makeHookCtx({ segment, segmentIndex: 0, route, entrants, tuning: RACE_V4_TUNING, seed: `6049-${seed}` });
  const state: EngineState = {
    km: 140,
    groups: [{ id: "peloton-0", kind: "peloton", rider_ids: ids, gap_seconds: 0, cohesion: 1 }],
    riders,
    virtual_gc: Object.fromEntries(ids.map((id) => [id, 0])),
  };
  const order = finaleHook(state, ctx).state.finish_order ?? [];
  const place = new Map(order.map((id, i) => [id, i + 1]));
  return spearman(sprint.map((s) => -s), ids.map((id) => place.get(id) ?? n));
}

test("#6049: et svagt, ensartet felt ordnes efter evnen naesten lige saa godt som samme felt paa fixtures'enes skala", () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const weak = mean(seeds.map((s) => bunchSprintCorrelation(1, s)));
  const strong = mean(seeds.map((s) => bunchSprintCorrelation(3, s)));
  assert.ok(weak >= 0.6, `svagt felt: ${weak.toFixed(3)} (evnen skal ordne feltet, ikke dagsformen)`);
  assert.ok(weak >= strong - 0.1, `svagt felt ${weak.toFixed(3)} maa ikke vaere meget mere tilfaeldigt end det staerke ${strong.toFixed(3)}`);
});
