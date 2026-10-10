// backend/lib/engine/v4/formCleanRevision.test.ts
// #6156 (ren motor-revision, spor 2): rytterens form (Entrant.form) virker to
// steder i kernen - jour sans' sandsynlighed og et lille, begraenset led paa
// baereevnen - og er byte-identisk med foer, naar feltet mangler. Broen saetter
// feltet kun under official_times_v3 og uden formtoppens tillaeg (toppe kommer
// foerst ved S5); se raceEngineV4Bridge.formCleanRevision.test.js.
//
// Effektens stoerrelse ("kan maerkes, afgoer ikke loebet alene") testes som
// baand paa parrede koersler: samme rytter-par, samme seed, pladserne byttet,
// saa holdets og rytter-id'ets eget bidrag gaar ud.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { initRiderStates } from "./groups.ts";
import { simulateStageV4 } from "./index.ts";
import { dayformComponent, FORM_CP_TUNING, formCpModifier, jourSansComponent, jourSansProbability } from "./physiology.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { routeFromStageProfileRow } from "./adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "./orders/teamOrdersAdapter.ts";
import { digestOf, frozenField, frozenStages } from "./testUtils/oldRevisionDigests6199.ts";
import type { AbilityKey, Entrant, StageInput, StageOutput, StageResult } from "./types.ts";

const V3 = "official_times_v3";

function abilities(level = 50): Record<AbilityKey, number> {
  return {
    climbing: level, time_trial: level, flat: level, tempo: level, sprint: level, acceleration: level,
    punch: level, endurance: level, recovery: level, durability: level, descending: level,
    cobblestone: level, positioning: level, aggression: level, tactics: level,
  };
}

function entrant(id: string, extra: Partial<Entrant> = {}): Entrant {
  return { rider_id: id, abilities: abilities(), role: "free_role", effort: "normal", condition: 1, ...extra };
}

// ── formCpModifier ──────────────────────────────────────────────────────────

test("#6156 formCpModifier: manglende/ugyldig form er neutral, middel form er neutral", () => {
  for (const f of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formCpModifier(f as number), 0);
  assert.equal(formCpModifier(FORM_CP_TUNING.neutralForm), 0);
});

test("#6156 formCpModifier: monoton i formen og begraenset af loftet, ogsaa uden for skalaen", () => {
  fc.assert(
    fc.property(fc.double({ min: -500, max: 500, noNaN: true }), fc.double({ min: -500, max: 500, noNaN: true }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      assert.ok(formCpModifier(lo) <= formCpModifier(hi));
      assert.ok(Math.abs(formCpModifier(a)) <= FORM_CP_TUNING.maxCp + 1e-12);
    }),
  );
  assert.equal(formCpModifier(100), FORM_CP_TUNING.maxCp);
  assert.equal(formCpModifier(0), -FORM_CP_TUNING.maxCp);
  assert.equal(formCpModifier(250), formCpModifier(100), "over skalaen = loftet");
});

// ── initRiderStates ─────────────────────────────────────────────────────────

test("#6156 initRiderStates: uden Entrant.form er dagsformen praecis den gamle (dagsform + jour sans med form=null)", () => {
  const field = Array.from({ length: 40 }, (_, i) => entrant(`r${i}`));
  const riders = initRiderStates(field, RACE_V4_TUNING, "seed-6156");
  for (const e of field) {
    const expected = dayformComponent({ seed: "seed-6156", riderId: e.rider_id, tuning: RACE_V4_TUNING.dayform })
      + jourSansComponent({ seed: "seed-6156", riderId: e.rider_id, form: null, tuning: RACE_V4_TUNING.dayform });
    assert.equal(Object.is(riders[e.rider_id].dayform, expected), true, e.rider_id);
  }
  // form: null er det samme som et udeladt felt.
  const withNull = initRiderStates(field.map((e) => ({ ...e, form: null })), RACE_V4_TUNING, "seed-6156");
  assert.deepEqual(withNull, riders);
});

test("#6156 initRiderStates: med Entrant.form faar jour sans den rigtige form og baereevnen leddet", () => {
  const seed = "seed-6156-b";
  for (const form of [5, 35, 50, 72, 100]) {
    const state = initRiderStates([entrant("x", { form })], RACE_V4_TUNING, seed).x;
    const expected = dayformComponent({ seed, riderId: "x", tuning: RACE_V4_TUNING.dayform })
      + jourSansComponent({ seed, riderId: "x", form, tuning: RACE_V4_TUNING.dayform })
      + formCpModifier(form);
    assert.equal(state.dayform, expected, `form ${form}`);
  }
});

test("#6156 doktrin: leddet har ingen evne-akse - samme form flytter en svag og en staerk rytter lige meget", () => {
  const seed = "seed-6156-c";
  const delta = (level: number) => {
    const base = initRiderStates([{ ...entrant("x"), abilities: abilities(level) }], RACE_V4_TUNING, seed).x.dayform;
    const inForm = initRiderStates([{ ...entrant("x"), abilities: abilities(level), form: 90 }], RACE_V4_TUNING, seed).x.dayform;
    return inForm - base;
  };
  assert.equal(delta(30), delta(85));
});

test("#6156 jour sans: hoejere form giver faerre daarlige dage over mange etaper", () => {
  const hits = (form: number) => {
    let n = 0;
    for (let s = 0; s < 4000; s++) {
      if (jourSansComponent({ seed: `stage-${s}`, riderId: "x", form, tuning: RACE_V4_TUNING.dayform }) < 0) n++;
    }
    return n;
  };
  assert.ok(jourSansProbability(80, RACE_V4_TUNING.dayform) < jourSansProbability(30, RACE_V4_TUNING.dayform));
  assert.ok(hits(80) < hits(30));
});

// ── Hele etaper under official_times_v3 ────────────────────────────────────

const SEEDS = Array.from({ length: 12 }, (_, i) => `6156-clean-${i}`);
const MOUNTAIN_ROWS = frozenStages().filter((row) => row.profile_type === "mountain" || row.profile_type === "high_mountain");
// To frie ryttere paa hvert sit hold i det varierede, frosne felt.
const A = "t0r4";
const B = "t1r4";

function climber(climbing: number): Record<AbilityKey, number> {
  return { ...abilities(62), climbing, tempo: climbing - 4, endurance: climbing - 4, recovery: climbing - 6 };
}

type Rider = { abilities: Record<AbilityKey, number>; form?: number | null };

function runStage(row: (typeof MOUNTAIN_ROWS)[number], seed: string, riders: Record<string, Rider>): Map<string, StageResult> {
  return new Map(runStageOutput(row, seed, riders).results.map((r) => [r.rider_id, r]));
}

function runStageOutput(row: (typeof MOUNTAIN_ROWS)[number], seed: string, riders: Record<string, Rider>): StageOutput {
  const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
  const field = frozenField().map((e) => (riders[e.rider_id] ? { ...e, ...riders[e.rider_id] } : e));
  const plan = buildStageOrderPlan({
    rows: [],
    stageNumber: 1,
    roster: field.map((r) => ({ team_id: r.team_id as string, rider_id: r.rider_id, role: r.role, is_ai: true, abilities: r.abilities })),
    context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, rules_revision: V3 },
  } as Parameters<typeof buildStageOrderPlan>[0]);
  const startlist = field.map((r) => ({ ...r, effort: plan.aiEffortByRider.get(r.rider_id) ?? r.effort }));
  const input = { route, startlist, orders: plan.orders, seed: `${seed}:${row.stage_number ?? 1}`, tuning: RACE_V4_TUNING, rules_revision: V3 } as StageInput;
  return simulateStageV4(input);
}

/**
 * Parret head-to-head: rytter X (evner+form) mod rytter Y paa alle bjergetaper
 * x 12 seeds, med pladserne byttet, saa hold- og id-bidraget gaar ud.
 */
function headToHead(x: Rider, y: Rider) {
  let xAhead = 0;
  let n = 0;
  let timeAdvantage = 0;
  for (const row of MOUNTAIN_ROWS) {
    for (const seed of SEEDS) {
      for (const swap of [false, true]) {
        const res = runStage(row, seed, swap ? { [A]: y, [B]: x } : { [A]: x, [B]: y });
        const rx = res.get(swap ? B : A) as StageResult;
        const ry = res.get(swap ? A : B) as StageResult;
        if (rx.rank < ry.rank) xAhead++;
        timeAdvantage += ry.time_seconds - rx.time_seconds;
        n++;
      }
    }
  }
  return { share: xAhead / n, meanTimeAdvantage: timeAdvantage / n, n };
}

test("#6156 v3: to ens ryttere - form 80 ender i snit foran form 40 paa bjergetaper (12 seeds)", () => {
  assert.ok(MOUNTAIN_ROWS.length >= 2, "fixturet har bjergetaper");
  const twin = climber(76);
  const r = headToHead({ abilities: twin, form: 80 }, { abilities: twin, form: 40 });
  assert.ok(r.share > 0.5, `form 80 foran i ${(r.share * 100).toFixed(0)} % af ${r.n} parrede koersler`);
  assert.ok(r.meanTimeAdvantage > 0, `gennemsnitlig tidsfordel ${r.meanTimeAdvantage.toFixed(1)} s`);
});

// FORESLAAET BAAND (vises ejeren foer taending, spec 2026-10-04 §3.6): en klart
// staerkere klatrer (klatring +10, resten ens) skal stadig vinde det parrede
// head-to-head, ogsaa naar den svage er i topform (95) og den staerke i middel
// form (50): den svage maa vaere foran i hoejst 40 % af koerslerne, og formen
// maa hoejst flytte den svages andel 20 procentpoint i forhold til ens form.
// Maalte tal: balance-internals/clean-revision/form/ (gitignoreret).
const FORM_UPSET_MAX_SHARE = 0.4;
const FORM_UPSET_MAX_SHIFT = 0.2;

test("#6156 v3 baand: en svag rytter i topform slaar ikke en klart staerkere rytter i middel form", () => {
  const weak = climber(71);
  const strong = climber(81);
  const even = headToHead({ abilities: weak, form: 50 }, { abilities: strong, form: 50 });
  const inForm = headToHead({ abilities: weak, form: 95 }, { abilities: strong, form: 50 });
  assert.ok(inForm.share >= even.share, "formen hjaelper den svage (kan maerkes)");
  assert.ok(inForm.share <= FORM_UPSET_MAX_SHARE, `svag i topform foran i ${(inForm.share * 100).toFixed(0)} %`);
  assert.ok(inForm.share - even.share <= FORM_UPSET_MAX_SHIFT, `formen flyttede ${((inForm.share - even.share) * 100).toFixed(0)} procentpoint`);
  assert.ok(inForm.meanTimeAdvantage < 0, "den staerke er stadig i snit foran i tid");
});

test("#6156 v3: et felt uden form-data (feltet udeladt eller null) giver byte-identisk etape-output", () => {
  for (const row of MOUNTAIN_ROWS.slice(0, 2)) {
    for (const seed of SEEDS.slice(0, 2)) {
      const omitted = runStageOutput(row, seed, {});
      const nulls = Object.fromEntries(frozenField().map((e) => [e.rider_id, { abilities: e.abilities, form: null }]));
      const withNull = runStageOutput(row, seed, nulls);
      assert.equal(digestOf(withNull), digestOf(omitted), `${row.profile_type}@${seed}`);
    }
  }
});
