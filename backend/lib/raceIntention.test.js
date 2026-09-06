// Løbsdagens intention (#4632) — femtrins-effort-skalaen, backend-siden.
//
// SSOT: docs/superpowers/specs/2026-09-03-race-day-intention-decision.md
// (beslutning 1 = model C, beslutning 2 = A "samme felt"), ejer-beslutning 5-6/9.
// Reglen i kort form: docs/RACE_ENGINE_RULES.md §3.1.
//
// Filen samler de tre invarianter ejeren har låst, så de er ét sted at læse og
// ét sted at bryde:
//   (a) all_out koster ALTID strengt mere træthed end normal ("ingen gratis
//       all-out", spec §2).
//   (b) inden for samme gruppe kan en rytter med lavere evne på all_out ALDRIG
//       få bedre tid end en rytter med højere evne på all_out
//       (RACE_ENGINE_RULES.md §3 invariant 3, "styrke straffes aldrig").
//   (c) work-cost bliver ALDRIG en bonus for nogen kombination af rolle ×
//       profil × de fem efforts — loftet er 0 (spec §4 "loftet til maks 0").
//
// Plus: vokabular-forward-guard, flag-adfærden på begge API-skrivestier,
// grupetto's udelukkelse fra udbrud og D2-formudbytte-kroken.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  workCost,
  effortFatigueMultiplier,
  effortDevelopmentMultiplier,
  validEffortsFor,
  VALID_EFFORTS,
  VALID_EFFORTS_FIVE_STEP,
  INTENTION_EFFORTS,
  RACE_V3_TUNING,
  VALID_RACE_ROLES,
  GC_RELEVANT_PROFILES,
  FLAT_LEADOUT_PROFILES,
} from "./raceRoles.js";
import { stageEnteringFatigues } from "./raceFatigue.js";
import { simulateStage, ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { validateStageRoleOverrides } from "./raceStageRolesApi.js";
import { validateTeamOrder } from "./raceTeamOrdersApi.js";
import { applyRaceDevelopmentTick } from "./dailyTraining.js";
import { RACE_DAY_INTENTION_FLAG_KEY } from "./raceIntentionFlag.js";
import { extractStageMoments } from "./raceNarrative.js";

const FIVE = ["grupetto", "save", "normal", "protect", "all_out"];
// Profiler der optræder i motoren; dækker både GC-relevante, flade og de
// "ingen defineret pris"-profiler (itt/ttt/cobbles) — property-testen i
// invariant (c) skal ramme alle tre klasser.
const ALL_PROFILES = [
  ...GC_RELEVANT_PROFILES, ...FLAT_LEADOUT_PROFILES,
  "itt", "ttt", "cobbles", "gravel", "helt-ukendt-profil-xyz",
];

// ── Vokabular (forward-guard, samme mønster som VALID_RACE_ROLES-låsen) ───────

test("#4632: VALID_EFFORTS_FIVE_STEP er præcis de fem kanoniske trin i skala-rækkefølge", () => {
  assert.deepEqual([...VALID_EFFORTS_FIVE_STEP], FIVE);
});

test("#4632: de tre gamle værdier er UÆNDREDE og stadig med i femtrins-skalaen", () => {
  assert.deepEqual([...VALID_EFFORTS], ["protect", "normal", "save"]);
  for (const legacy of VALID_EFFORTS) {
    assert.ok(VALID_EFFORTS_FIVE_STEP.includes(legacy), legacy);
  }
});

test("#4632: kun 'grupetto' og 'all_out' er nye (ingen omdøbning af save/protect)", () => {
  assert.deepEqual([...INTENTION_EFFORTS].sort(), ["all_out", "grupetto"]);
  for (const renamed of ["conserve", "committed"]) {
    assert.ok(!VALID_EFFORTS_FIVE_STEP.includes(renamed), `${renamed} blev IKKE valgt (ejer 5-6/9)`);
  }
});

test("#4632: skalaen afviser et sjette/ukendt ord", () => {
  for (const bogus of ["all-out", "allout", "Grupetto", "grupetto ", "", "hard", "easy"]) {
    assert.ok(!VALID_EFFORTS_FIVE_STEP.includes(bogus), bogus);
  }
});

test("#4632: flag-nøglen er race_day_intention_enabled (samme mønster som race_day_development_enabled)", () => {
  assert.equal(RACE_DAY_INTENTION_FLAG_KEY, "race_day_intention_enabled");
});

// ── validEffortsFor: flaget er vokabular-switchen ────────────────────────────

test("#4632: validEffortsFor(false) = dagens tre værdier; default-argumentet er OFF", () => {
  assert.deepEqual([...validEffortsFor(false)], ["protect", "normal", "save"]);
  assert.deepEqual([...validEffortsFor()], ["protect", "normal", "save"]);
});

test("#4632: validEffortsFor(true) = alle fem", () => {
  assert.deepEqual([...validEffortsFor(true)], FIVE);
});

// ── INVARIANT (a): all_out koster ALTID strengt mere træthed end normal ───────

test("#4632 invariant (a): effortFatigueMultiplier er strengt stigende over alle fem trin", () => {
  const values = FIVE.map((e) => effortFatigueMultiplier(e));
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], `${FIVE[i]} (${values[i]}) skal koste mere end ${FIVE[i - 1]} (${values[i - 1]})`);
  }
});

test("#4632 invariant (a): grupetto < save (0.7) og all_out > protect (1.2) — de nye yderpunkter ligger UDEN OM", () => {
  assert.ok(effortFatigueMultiplier("grupetto") < RACE_V3_TUNING.FATIGUE_MULTIPLIER_SAVE);
  assert.ok(effortFatigueMultiplier("all_out") > RACE_V3_TUNING.FATIGUE_MULTIPLIER_PROTECT);
  // De tre gamle er bit-uændrede.
  assert.equal(effortFatigueMultiplier("protect"), 1.2);
  assert.equal(effortFatigueMultiplier("save"), 0.7);
  assert.equal(effortFatigueMultiplier("normal"), 1.0);
});

test("#4632 invariant (a): all_out > normal END-TO-END i trætheds-akkumuleringen (stageEnteringFatigues)", () => {
  const profiles = ["mountain", "mountain", "flat", "high_mountain"];
  const build = (effort) => stageEnteringFatigues(20, profiles, { efforts: profiles.map(() => effort) });
  const allOut = build("all_out");
  const normal = build("normal");
  const grupetto = build("grupetto");
  // Etape 1 køres altid på start-træthed (belastningen rammer først etape 2+).
  assert.equal(allOut[0], normal[0], "etape 1 = start-træthed, uafhængig af intention");
  for (let i = 1; i < profiles.length; i++) {
    assert.ok(allOut[i] > normal[i], `etape ${i + 1}: all_out (${allOut[i]}) skal være strengt mere træt end normal (${normal[i]})`);
    assert.ok(grupetto[i] < normal[i], `etape ${i + 1}: grupetto (${grupetto[i]}) skal være strengt mindre træt end normal (${normal[i]})`);
  }
});

test("#4632: ukendt/manglende effort → normal-multiplikator (defensivt, uændret fra før)", () => {
  for (const bogus of [undefined, null, "", "all-out", "noget-helt-andet"]) {
    assert.equal(effortFatigueMultiplier(bogus), 1.0, String(bogus));
  }
});

// ── INVARIANT (c): work-cost bliver ALDRIG en bonus ──────────────────────────
// Sign-konvention: work_cost er en NEGATIV score-delta (en pris). "Loftet" er
// derfor 0 — værdien må aldrig blive POSITIV (= gratis bonus oveni egen evne),
// og den må heller aldrig blive en STØRRE straf end fuld pris.

test("#4632 invariant (c): workCost ≤ 0 for ENHVER kombination af rolle × profil × de fem efforts", () => {
  let combos = 0;
  for (const role of VALID_RACE_ROLES) {
    for (const profile of ALL_PROFILES) {
      for (const effort of FIVE) {
        const cost = workCost(role, profile, effort);
        assert.ok(Number.isFinite(cost), `${role}/${profile}/${effort} gav ikke et tal: ${cost}`);
        assert.ok(cost <= 0, `${role}/${profile}/${effort} gav en POSITIV work-cost (${cost}) — loftet er 0`);
        combos += 1;
      }
    }
  }
  assert.ok(combos >= 5 * 5 * ALL_PROFILES.length - 1, `sanity: ${combos} kombinationer dækket`);
});

test("#4632 invariant (c): ingen effort gør prisen STØRRE end fuld pris (normal)", () => {
  for (const role of VALID_RACE_ROLES) {
    for (const profile of ALL_PROFILES) {
      const full = Math.abs(workCost(role, profile, "normal"));
      for (const effort of FIVE) {
        assert.ok(
          Math.abs(workCost(role, profile, effort)) <= full + 1e-12,
          `${role}/${profile}/${effort} er en større straf end fuld pris`,
        );
      }
    }
  }
});

test("#4632: all_out sætter work-cost til PRÆCIS 0 (rytteren arbejder ikke for holdet i dag)", () => {
  for (const profile of ALL_PROFILES) {
    for (const role of VALID_RACE_ROLES) {
      assert.equal(workCost(role, profile, "all_out"), 0, `${role}/${profile}`);
    }
  }
});

test("#4632: grupetto giver INGEN resultat-fordel over save — samme work-cost", () => {
  for (const profile of ALL_PROFILES) {
    for (const role of VALID_RACE_ROLES) {
      assert.equal(
        workCost(role, profile, "grupetto"),
        workCost(role, profile, "save"),
        `${role}/${profile}: grupetto må ikke være billigere end save`,
      );
    }
  }
});

test("#4632: de tre gamle efforts giver BIT-IDENTISK work-cost som før udvidelsen", () => {
  assert.equal(workCost("helper", "mountain", "normal"), RACE_V3_TUNING.WORK_COST_HELPER_GC);
  assert.equal(workCost("helper", "mountain", "protect"), RACE_V3_TUNING.WORK_COST_HELPER_GC);
  assert.equal(
    workCost("helper", "mountain", "save"),
    RACE_V3_TUNING.WORK_COST_HELPER_GC * RACE_V3_TUNING.EFFORT_COST_MULTIPLIER_SAVE,
  );
  assert.equal(workCost("helper", "flat", "normal"), RACE_V3_TUNING.WORK_COST_HELPER_FLAT);
  assert.equal(workCost("hunter", "mountain", "normal"), RACE_V3_TUNING.WORK_COST_HUNTER);
});

// ── INVARIANT (b): monotoni mod raceSimulator (styrke straffes aldrig) ───────

function rider(id, overrides = {}, extra = {}) {
  const abilities = {};
  for (const k of ABILITY_KEYS) abilities[k] = 50;
  Object.assign(abilities, overrides);
  return { rider_id: id, team_id: `team-${id}`, abilities, ...extra };
}

// Randomness 0 ⇒ noiseSd 0. v3's dagsform/jour sans er stadig aktive (de er
// per-rytter-seedede og hører til den kalibrerede motor, ikke til denne
// ændring) — derfor er evne-gabet gjort STORT nok til at ingen af dem kan
// invertere ordenen: jour sans' maks-magnitude er 0.10, dagsformens SD 0.018,
// mens terræn-gabet mellem de to ryttere nedenfor er ~0.3.
const MOUNTAIN_NO_NOISE = {
  profile_type: "mountain",
  demand_vector: { ...DEMAND_VECTORS.mountain, randomness: 0 },
};

const STRONG = { climbing: 95, endurance: 92, recovery: 85, durability: 80, tempo: 78 };
const WEAK = { climbing: 35, endurance: 38, recovery: 40, durability: 40, tempo: 38 };

test("#4632 invariant (b): to ryttere på SAMME effort — den stærkeste vinder for ALLE fem trin", () => {
  for (const effort of FIVE) {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const entrants = [
        rider("a-strong", STRONG, { race_role: "helper", effort }),
        rider("b-weak", WEAK, { race_role: "helper", effort }),
      ];
      const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN_NO_NOISE, seed, v3: true });
      const strong = ranked.find((r) => r.rider_id === "a-strong");
      const weak = ranked.find((r) => r.rider_id === "b-weak");
      assert.ok(
        strong.rank < weak.rank,
        `effort=${effort}, seed=${seed}: lavere evne (${weak.rank}) slog højere evne (${strong.rank})`,
      );
      assert.ok(
        strong.stageGap <= weak.stageGap,
        `effort=${effort}, seed=${seed}: lavere evne fik bedre tid (${weak.stageGap} < ${strong.stageGap})`,
      );
    }
  }
});

test("#4632 invariant (b): all_out kan ikke vende ordenen — svag på all_out slår ALDRIG stærk på all_out (20 seeds)", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const entrants = [
      rider("a-strong", STRONG, { race_role: "helper", effort: "all_out" }),
      rider("b-weak", WEAK, { race_role: "helper", effort: "all_out" }),
    ];
    const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN_NO_NOISE, seed, v3: true });
    assert.equal(ranked[0].rider_id, "a-strong", `seed ${seed}: all_out inverterede evne-ordenen`);
  }
});

test("#4632: intention ændrer ALDRIG fortegn — work_cost-komponenten er ≤ 0 i motorens output", () => {
  for (const effort of FIVE) {
    const entrants = [
      rider("a", STRONG, { race_role: "helper", effort }),
      rider("b", WEAK, { race_role: "helper", effort }),
      rider("c", {}, { race_role: "hunter", effort }),
      rider("d", {}, { race_role: "captain", effort }),
    ];
    const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN_NO_NOISE, seed: 11, v3: true });
    for (const r of ranked) {
      assert.ok(r.components.work_cost <= 0, `${effort}/${r.rider_id}: work_cost ${r.components.work_cost} > 0`);
    }
  }
});

// ── Grupetto: ingen egen chance (udelukket fra udbrud) ───────────────────────

function breakawayWinnersFor(effortById, seed) {
  // Feltet skal være ≥ 4 for at selectBreakawayBonuses overhovedet kører, og
  // udbruds-kandidater er ryttere UNDER top-cuttet plus hunters.
  const entrants = Object.entries(effortById).map(([id, effort], i) =>
    rider(id, { climbing: 40 + i, aggression: 90 }, { race_role: i === 0 ? "hunter" : "helper", effort }),
  );
  const { ranked } = simulateStage({ entrants, stageProfile: MOUNTAIN_NO_NOISE, seed, v3: true });
  return new Map(ranked.map((r) => [r.rider_id, r.components.breakaway]));
}

test("#4632: en grupetto-rytter får ALDRIG en udbruds-bonus (heller ikke som hunter)", () => {
  const efforts = { h1: "grupetto", r2: "grupetto", r3: "grupetto", r4: "grupetto", r5: "grupetto", r6: "grupetto" };
  for (let seed = 1; seed <= 25; seed++) {
    const bonuses = breakawayWinnersFor(efforts, seed);
    for (const [id, bonus] of bonuses) {
      assert.equal(bonus, 0, `seed ${seed}: grupetto-rytter ${id} fik udbruds-bonus ${bonus}`);
    }
  }
});

test("#4632: uden grupetto får feltet stadig udbrud (sanity: udelukkelsen er ikke en generel slukning)", () => {
  const efforts = { h1: "normal", r2: "normal", r3: "normal", r4: "normal", r5: "normal", r6: "normal" };
  let anyBreakaway = false;
  for (let seed = 1; seed <= 25 && !anyBreakaway; seed++) {
    for (const bonus of breakawayWinnersFor(efforts, seed).values()) {
      if (bonus > 0) anyBreakaway = true;
    }
  }
  assert.ok(anyBreakaway, "mindst ét seed skal producere et udbrud når ingen kører grupetto");
});

// ── API-flag: skrivestierne afviser de to nye værdier indtil flaget flippes ──

const STAGE_BASE = { stageCount: 5, stagesCompleted: 2, teamRiderIds: new Set(["r1"]) };

test("#4632: PUT /stage-roles AFVISER grupetto/all_out når flaget er off", () => {
  for (const effort of INTENTION_EFFORTS) {
    const res = validateStageRoleOverrides({
      ...STAGE_BASE,
      overrides: [{ stage_number: 3, rider_id: "r1", race_role: "helper", effort }],
      intentionEnabled: false,
    });
    assert.equal(res.ok, false, effort);
    assert.equal(res.errors[0], "stage_roles_invalid_effort", effort);
  }
});

test("#4632: PUT /stage-roles ACCEPTERER alle fem når flaget er on", () => {
  for (const effort of FIVE) {
    const res = validateStageRoleOverrides({
      ...STAGE_BASE,
      overrides: [{ stage_number: 3, rider_id: "r1", race_role: "helper", effort }],
      intentionEnabled: true,
    });
    assert.deepEqual(res, { ok: true, errors: [] }, effort);
  }
});

test("#4632: PUT /stage-roles — glemt flag-argument = OFF (fail-safe default)", () => {
  const res = validateStageRoleOverrides({
    ...STAGE_BASE,
    overrides: [{ stage_number: 3, rider_id: "r1", race_role: "helper", effort: "all_out" }],
  });
  assert.equal(res.errors[0], "stage_roles_invalid_effort");
});

const ORDER_BASE = {
  stageNumber: 3, stageCount: 5, stagesCompleted: 2,
  scheduledAt: null, teamRiderIds: new Set(["r1"]),
};

test("#4632: PUT /team-orders AFVISER grupetto/all_out når flaget er off", () => {
  for (const effort of INTENTION_EFFORTS) {
    const res = validateTeamOrder({
      ...ORDER_BASE,
      order: { breakaway_stance: "neutral", riders: [{ rider_id: "r1", effort, try_break: false }] },
      intentionEnabled: false,
    });
    assert.equal(res.ok, false, effort);
    assert.equal(res.errors[0], "team_orders_invalid_effort", effort);
  }
});

test("#4632: PUT /team-orders ACCEPTERER alle fem når flaget er on", () => {
  for (const effort of FIVE) {
    const res = validateTeamOrder({
      ...ORDER_BASE,
      order: { breakaway_stance: "neutral", riders: [{ rider_id: "r1", effort, try_break: false }] },
      intentionEnabled: true,
    });
    assert.deepEqual(res, { ok: true, errors: [] }, effort);
  }
});

test("#4632: begge skrivestier deler ÉT vokabular (ingen divergens mellem stage-roles og team-orders)", () => {
  for (const effort of ["conserve", "committed", "all-out", "MAX"]) {
    for (const on of [false, true]) {
      const a = validateStageRoleOverrides({
        ...STAGE_BASE,
        overrides: [{ stage_number: 3, rider_id: "r1", race_role: "helper", effort }],
        intentionEnabled: on,
      });
      const b = validateTeamOrder({
        ...ORDER_BASE,
        order: { breakaway_stance: "neutral", riders: [{ rider_id: "r1", effort, try_break: false }] },
        intentionEnabled: on,
      });
      assert.equal(a.ok, false, `${effort}/${on}`);
      assert.equal(b.ok, false, `${effort}/${on}`);
    }
  }
});

// ── D2-krok: formudbytte skalerer med intentionen (dormant indtil D2 tændes) ──

test("#4632: effortDevelopmentMultiplier er strengt stigende grupetto → all_out", () => {
  const values = FIVE.map((e) => effortDevelopmentMultiplier(e));
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], `${FIVE[i]} (${values[i]}) ≤ ${FIVE[i - 1]} (${values[i - 1]})`);
  }
  assert.equal(effortDevelopmentMultiplier("normal"), 1.0, "normal er neutral");
});

test("#4632: manglende/ukendt effort → multiplikator 1.0 (dormant seam)", () => {
  for (const bogus of [undefined, null, "", "conserve", 42]) {
    assert.equal(effortDevelopmentMultiplier(bogus), 1.0, String(bogus));
  }
});

function devFixture(overrides = {}) {
  return {
    riderId: "race1", dateStr: "2026-09-06", age: 27,
    abilities: { climbing: 50, endurance: 50, durability: 50, sprint: 50, flat: 50 },
    caps: { climbing: 90, endurance: 90, durability: 90, sprint: 90, flat: 90 },
    progress: {},
    program: { focus: "climbing", intensity: "normal" },
    conditionMult: 1, bonus: false, potentiale: 3,
    profileType: "mountain",
    ...overrides,
  };
}

test("#4632: applyRaceDevelopmentTick UDEN effort er bit-identisk med før (ingen adfærdsændring)", () => {
  const withoutArg = applyRaceDevelopmentTick(devFixture());
  const explicitNull = applyRaceDevelopmentTick(devFixture({ effort: null }));
  const normal = applyRaceDevelopmentTick(devFixture({ effort: "normal" }));
  assert.deepEqual(explicitNull.progress, withoutArg.progress);
  assert.deepEqual(normal.progress, withoutArg.progress, "normal = neutral ⇒ samme udbytte som uden intention");
  assert.equal(normal.score, withoutArg.score);
});

test("#4632: applyRaceDevelopmentTick — grupetto giver mindst udbytte, all_out mest", () => {
  const scores = FIVE.map((effort) => {
    const out = applyRaceDevelopmentTick(devFixture({ effort }));
    // Summér progress over løbsprofilens relevante evner — uafrundet, i modsætning
    // til `score` (2 decimaler), så små trin ikke rundes sammen.
    return Object.values(out.progress).reduce((s, v) => s + v, 0);
  });
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] > scores[i - 1], `${FIVE[i]} (${scores[i]}) ≤ ${FIVE[i - 1]} (${scores[i - 1]})`);
  }
});

// ── Narrativ: de to nye trin må ikke stille miste deres indsats-tag ──────────

test("#4632: grupetto/all_out arver de eksisterende indsats-tags (ingen tavs rytter)", () => {
  const ranked = FIVE.map((effort, i) => ({
    rider_id: `r-${effort}`, team_id: `team-${i}`, rank: i + 1, finalScore: 1 - i * 0.01, stageGap: i * 5,
    components: { terrain: 0.5, noise: 0, form: 0, fatigue: 0, team: 0, breakaway: 0, finale: 0, work_cost: 0, dayform: 0, jour_sans: 0, peak: 0, long_day: 0, incident: 0 },
  }));
  const moments = extractStageMoments({
    profileType: "mountain",
    ranked,
    roleByRider: new Map(ranked.map((r) => [r.rider_id, "helper"])),
    effortByRider: new Map(FIVE.map((effort) => [`r-${effort}`, effort])),
  });
  const keysFor = (id) => moments.filter((m) => m.params?.riderId === id).map((m) => m.moment_key ?? m.key);
  assert.ok(keysFor("r-grupetto").includes("tag_saved_effort"), "grupetto skal arve tag_saved_effort");
  assert.ok(keysFor("r-save").includes("tag_saved_effort"));
  assert.ok(keysFor("r-all_out").includes("tag_gave_everything"), "all_out skal arve tag_gave_everything");
  assert.ok(keysFor("r-protect").includes("tag_gave_everything"));
  assert.equal(
    keysFor("r-normal").filter((k) => k === "tag_saved_effort" || k === "tag_gave_everything").length,
    0,
    "normal er baseline og får bevidst intet indsats-tag",
  );
});
