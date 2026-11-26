// #7884: dommer-scenarierne D1-D17 (docs/superpowers/specs/2026-11-26-7884-taktik-klager-og-angreb-paa-stigning.md,
// afsnit 5). Hvert scenarie fejler uden sin regel.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as stagePlan from "./stagePlan.ts";
import {
  LONG_ATTACK_7884_ENGINE_READY,
  LONG_ATTACK_7884_FLAG_KEY,
  attackPlaces7884,
  attackRouteFingerprint7884,
  effectivePlan7884,
  evaluateLongAttack7884Flag,
  placeForTrigger7884,
  planWithoutLongAttack7884,
  validateLongAttackLegs7884,
  validateStagePlan7884,
} from "./tacticAttackTrigger7884.js";

const MOUNTAIN = {
  distance_km: 175,
  profile_type: "high_mountain",
  climbs: [
    { name: "Côte de Brévin", category: "2", crest_km: 66, length_km: 8 },
    { name: "Col du Larzac", category: "1", crest_km: 128, length_km: 9 },
    { name: "Mont Aigu", category: "HC", crest_km: 175, length_km: 15, summit_finish: true },
  ],
};
const route = (raw) => stagePlan.stagePlanRouteFromRaw(raw);
const keys = (places) => places.map((p) => p.key);

// ── Stedlisten ──────────────────────────────────────────────────────────────

test("D1: alle kategoriserede stigninger i rutens raekkefoelge, ogsaa den midterste", () => {
  const places = attackPlaces7884(MOUNTAIN);
  assert.deepEqual(keys(places), ["climb:0", "climb:1", "climb:2", "finale"]);
  assert.deepEqual(places.map((p) => p.name), ["Côte de Brévin", "Col du Larzac", "Mont Aigu", null]);
  // Rodaarsagen til K1: de tre faste rutedele i dag viser kun den foerste og den sidste.
  assert.ok(places.some((p) => p.name === "Col du Larzac"));
});

test("D2: maalstigningen ved topankomst er et sted (den mangler paa planens liste i dag)", () => {
  const places = attackPlaces7884(MOUNTAIN);
  const summit = places.find((p) => p.key === "climb:2");
  assert.equal(summit.summit_finish, true);
  assert.equal(route(MOUNTAIN).climbs.some((c) => c.index === 2), false);
});

test("D3: Finalen findes paa hver vejetape, ogsaa uden stigninger, og begynder ved planens sidste km", () => {
  const flat = attackPlaces7884({ distance_km: 160, profile_type: "flat", climbs: [] });
  assert.deepEqual(keys(flat), ["finale"]);
  assert.equal(flat[0].foot_km, stagePlan.triggerKm({ at: "final_km" }, route({ distance_km: 160, profile_type: "flat", climbs: [] })));
});

test("D4: foden er toppen minus laengden, aldrig under 0; uden gyldig laengde er stigningen ikke et sted", () => {
  const places = attackPlaces7884({
    distance_km: 100,
    profile_type: "hilly",
    climbs: [
      { name: "kort start", category: "4", crest_km: 2, length_km: 5 },
      { name: "uden laengde", category: "3", crest_km: 40 },
      { name: "nul laengde", category: "3", crest_km: 50, length_km: 0 },
      { name: "normal", category: "2", crest_km: 70, length_km: 6 },
    ],
  });
  assert.deepEqual(keys(places), ["climb:0", "climb:3", "finale"]);
  assert.equal(places[0].foot_km, 0);
  assert.equal(places[1].foot_km, 64);
});

test("D5: ukategoriserede stigninger, toppe efter maal og tidskoersler giver ingen steder", () => {
  const places = attackPlaces7884({
    distance_km: 100,
    profile_type: "hilly",
    climbs: [
      { name: "ukategoriseret", category: "", crest_km: 30, length_km: 3 },
      { name: "efter maal", category: "2", crest_km: 120, length_km: 3 },
      { name: "ved start", category: "2", crest_km: 0, length_km: 3 },
    ],
  });
  assert.deepEqual(keys(places), ["finale"]);
  for (const profile_type of ["itt", "itt_hilly", "ttt"]) {
    assert.deepEqual(attackPlaces7884({ ...MOUNTAIN, profile_type }), []);
  }
  assert.deepEqual(attackPlaces7884({ distance_km: 0, climbs: [] }), []);
  assert.deepEqual(attackPlaces7884(null), []);
});

test("D6: to stigninger med samme navn er to steder (index er noeglen, navnet en etiket)", () => {
  const places = attackPlaces7884({
    distance_km: 190,
    profile_type: "hilly",
    climbs: [
      { name: "Muur", category: "3", crest_km: 40, length_km: 3 },
      { name: "Muur", category: "3", crest_km: 95, length_km: 3 },
    ],
  });
  assert.deepEqual(keys(places), ["climb:0", "climb:1", "finale"]);
  assert.equal(placeForTrigger7884({ at: "climb_start", kom_index: 1 }, places).foot_km, 92);
});

test("D7: fingeraftrykket er stabilt for samme rute og skifter, naar et sted flytter, omdoebes eller forsvinder", () => {
  const fp = attackRouteFingerprint7884(attackPlaces7884(MOUNTAIN));
  assert.equal(attackRouteFingerprint7884(attackPlaces7884(structuredClone(MOUNTAIN))), fp);
  const moved = structuredClone(MOUNTAIN); moved.climbs[1].length_km = 10;
  const renamed = structuredClone(MOUNTAIN); renamed.climbs[1].name = "Col du Nouveau";
  const removed = structuredClone(MOUNTAIN); removed.climbs[1].category = "";
  for (const changed of [moved, renamed, removed]) assert.notEqual(attackRouteFingerprint7884(attackPlaces7884(changed)), fp);
});

// ── Ordren ──────────────────────────────────────────────────────────────────

const PLACES = attackPlaces7884(MOUNTAIN);
const R = route(MOUNTAIN);
const atClimb = (kom_index) => ({ at: "climb_start", kom_index });

test("D8: kun opgaven Angrib kan have et sted, og formen er eksakt", () => {
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "tempo", from: atClimb(1) }], "helper", R, PLACES), "long_attack_needs_attack_task");
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: { at: "climb_start", kom_index: 1, extra: 1 } }], "captain", R, PLACES), "long_attack_unknown_place");
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: { at: "climb_start", kom_index: "1" } }], "captain", R, PLACES), "long_attack_unknown_place");
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: { at: "finale", kom_index: 0 } }], "captain", R, PLACES), "long_attack_unknown_place");
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: atClimb(1) }], "captain", R, PLACES), null);
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: { at: "finale" } }], "captain", R, PLACES), null);
  // Foerste led har aldrig et skiftepunkt, heller ikke et sted (de gamle regler).
  assert.equal(validateStagePlan7884([{ task: "attack", from: atClimb(1) }], "captain", R, PLACES), "stage_plan_first_has_trigger");
});

test("D9: alle seks roller maa faa ordren, ogsaa hjaelperen og den delte kaptajn", () => {
  for (const role of ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"]) {
    const first = role === "helper" || role === "hunter" ? "shelter_leader" : "stay_sheltered";
    assert.equal(validateStagePlan7884([{ task: first }, { task: "attack", from: atClimb(0) }], role, R, PLACES), null, role);
  }
  // Den gamle top-ordre er stadig forbeholdt de gamle roller (gemte planer).
  assert.equal(stagePlan.validateStagePlanLegs([{ task: "shelter_leader" }, { task: "attack", from: { at: "kom", kom_index: 0 } }], "helper", R), "stage_plan_task_not_for_role");
  assert.equal(validateLongAttackLegs7884([{ task: "stay_sheltered" }], "manager", R, PLACES), "stage_plan_task_not_for_role");
});

test("D10: et ukendt sted afvises", () => {
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: atClimb(7) }], "captain", R, PLACES), "long_attack_unknown_place");
  const noFinale = PLACES.filter((p) => p.key !== "finale");
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: { at: "finale" } }], "captain", R, noFinale), "long_attack_unknown_place");
});

test("D11: kronologi paa tvaers af gamle og nye punkter", () => {
  // Fra foden af Larzac og derefter fra toppen af Brévin: baglaens.
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: atClimb(1) }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }], "captain", R, PLACES, { newPlan: true }), "stage_plan_not_chronological");
  // Toppen af Brévin, saa foden af Larzac, saa "sat": gyldig.
  assert.equal(validateStagePlan7884([{ task: "follow_moves" }, { task: "stay_sheltered", from: { at: "kom", kom_index: 0 } }, { task: "attack", from: atClimb(1) }], "captain", R, PLACES), null);
  // Finalen foer en stigningsfod, der ligger tidligere: baglaens.
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: { at: "finale" } }, { task: "attack", from: atClimb(1) }], "captain", R, PLACES), "stage_plan_not_chronological");
  // Et angreb fra en fod ved km 0 er ikke et skift.
  const atZero = attackPlaces7884({ distance_km: 100, profile_type: "hilly", climbs: [{ name: "Start", category: "4", crest_km: 2, length_km: 5 }] });
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: atClimb(0) }], "captain", route({ distance_km: 100, profile_type: "hilly", climbs: [] }), atZero), "stage_plan_not_chronological");
});

test("D12: ét forsoeg pr. stigning, flere angreb paa samme etape er tilladt", () => {
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: atClimb(1) }, { task: "attack", from: atClimb(1) }], "captain", R, PLACES), "stage_plan_not_chronological");
  assert.equal(validateStagePlan7884([{ task: "stay_sheltered" }, { task: "attack", from: atClimb(0) }, { task: "attack", from: atClimb(1) }], "captain", R, PLACES), null);
});

test("D13: den gamle top-ordre er ikke et valg i nye planer, men gemte planer laeses", () => {
  const old = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: 1 } }];
  assert.equal(validateStagePlan7884(old, "captain", R, PLACES), "long_attack_top_attack_retired");
  assert.equal(validateStagePlan7884(old, "captain", R, PLACES, { newPlan: false }), null);
  assert.equal(effectivePlan7884({ flagValue: "on", legs: old }), old);
});

// ── Kontakten ───────────────────────────────────────────────────────────────

// ---- BEGIN CORPUS (identisk med generatoren koert mod merge-basen) ----
const CORPUS_ROUTES_7884 = [
  { distance_km: 175, profile_type: "high_mountain", climbs: [
    { name: "A", category: "2", crest_km: 66, length_km: 8 },
    { name: "B", category: "1", crest_km: 128, length_km: 9 },
    { name: "C", category: "HC", crest_km: 175, length_km: 15, summit_finish: true },
  ] },
  { distance_km: 190, profile_type: "hilly", climbs: [
    { name: "A", category: "3", crest_km: 40, length_km: 3 },
    { name: "A", category: "4", crest_km: 95, length_km: 2 },
    { name: null, category: "2", crest_km: 150, length_km: 5 },
    { name: "D", category: "1", crest_km: 182, length_km: 6 },
  ] },
  { distance_km: 160, profile_type: "flat", climbs: [] },
  { distance_km: 210, profile_type: "medium_mountain", climbs: [
    { name: "X", category: "1", crest_km: 120, length_km: 11 },
    { name: "Y", category: "HC", crest_km: 196, length_km: 14 },
  ] },
];

function corpusDigest7884(stagePlan, transform) {
  const hash = createHash("sha256");
  let count = 0;
  const roles = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];
  for (const raw of CORPUS_ROUTES_7884) {
    const route = stagePlan.stagePlanRouteFromRaw(raw);
    const triggers = [
      ...route.climbs.map((c) => ({ at: "kom", kom_index: c.index })),
      { at: "final_km" },
      { at: "dropped" },
    ];
    const tasks = stagePlan.STAGE_PLAN_TASKS;
    const chains = [];
    for (const t0 of tasks) {
      chains.push([{ task: t0 }]);
      for (const t1 of tasks) for (const f1 of triggers) {
        chains.push([{ task: t0 }, { task: t1, from: f1 }]);
        for (const t2 of tasks) for (const f2 of triggers) chains.push([{ task: t0 }, { task: t1, from: f1 }, { task: t2, from: f2 }]);
      }
    }
    for (const role of roles) {
      for (const sugg of [false, true]) {
        const s = stagePlan.suggestStagePlan({ role, route, teamHasSprintCaptain: sugg });
        hash.update(JSON.stringify(s === null ? null : stagePlan.normalizeStagePlanLegs(transform(s))));
        count += 1;
      }
      for (const legs of chains) {
        const err = stagePlan.validateStagePlanLegs(legs, role, route);
        hash.update(err === null ? JSON.stringify(stagePlan.normalizeStagePlanLegs(transform(legs))) : err);
        count += 1;
      }
    }
  }
  return { count, sha256: hash.digest("hex") };
}
// ---- END CORPUS ----

// Frosset: genereret af korpus-koden ovenfor mod MERGE-BASENS stagePlan.ts (f3702709a49d00cd8b96702a00292b8a3bcd473d),
// i et separat checkout, med identitet som transform. Genereres ALDRIG igen med den nye kode (#7587).
const FROZEN_BASE_DIGEST_7884 = { count: 760656, sha256: "f3cdf06910dfca1256ff853a788c5bc02b8902514eb6282df459e964cc08bee0" };

test("D14: slukket er bit-identisk: samme objekt, og korpus-digest = den frosne fra merge-basen", () => {
  let sameObject = true;
  const digest = corpusDigest7884(stagePlan, (legs) => {
    const out = effectivePlan7884({ flagValue: undefined, legs });
    if (out !== legs) sameObject = false;
    return out;
  });
  assert.deepEqual(digest, FROZEN_BASE_DIGEST_7884);
  assert.equal(sameObject, true);
  // Ogsaa med kontakten taendt, saa laenge motorens trin ikke findes.
  const on = corpusDigest7884(stagePlan, (legs) => effectivePlan7884({ flagValue: "on", legs }));
  assert.deepEqual(on, FROZEN_BASE_DIGEST_7884);
});

test("D15: slukket erstattes et angreb paa et sted af den forrige opgave; resultatet er altid gyldigt efter de gamle regler", () => {
  assert.deepEqual(
    planWithoutLongAttack7884([{ task: "stay_sheltered" }, { task: "attack", from: atClimb(1) }, { task: "ride_in", from: { at: "dropped" } }]),
    [{ task: "stay_sheltered" }, { task: "ride_in", from: { at: "dropped" } }],
  );
  // To ens led i traek bliver til ét; det foerste beholder sit punkt.
  assert.deepEqual(
    planWithoutLongAttack7884([{ task: "follow_moves" }, { task: "attack", from: atClimb(1) }, { task: "follow_moves", from: { at: "final_km" } }]),
    [{ task: "follow_moves" }],
  );
  // Egenskab: hver plan der er gyldig med de nye steder, giver en gyldig plan efter de gamle regler.
  const tasks = stagePlan.STAGE_PLAN_TASKS;
  const triggers = [...PLACES.map((p) => p.trigger), ...R.climbs.map((c) => ({ at: "kom", kom_index: c.index })), { at: "final_km" }, { at: "dropped" }];
  let checked = 0;
  for (const role of ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"]) {
    for (const t0 of tasks) for (const t1 of tasks) for (const f1 of triggers) for (const t2 of tasks) for (const f2 of triggers) {
      const legs = [{ task: t0 }, { task: t1, from: f1 }, { task: t2, from: f2 }];
      if (validateStagePlan7884(legs, role, R, PLACES) !== null) continue;
      checked += 1;
      assert.equal(stagePlan.validateStagePlanLegs(planWithoutLongAttack7884(legs), role, R), null, JSON.stringify({ role, legs }));
    }
  }
  assert.ok(checked > 0);
});

test("D16: taendt foer motorens trin findes = som slukket; kun taendt OG klar koerer stederne", () => {
  assert.equal(LONG_ATTACK_7884_ENGINE_READY, false);
  const legs = [{ task: "stay_sheltered" }, { task: "attack", from: atClimb(1) }];
  assert.deepEqual(effectivePlan7884({ flagValue: "on", legs }), [{ task: "stay_sheltered" }]);
  assert.equal(effectivePlan7884({ flagValue: "on", legs, engineReady: true }), legs);
  assert.deepEqual(effectivePlan7884({ flagValue: "off", legs, engineReady: true }), [{ task: "stay_sheltered" }]);
});

test("D17: kun den eksakte vaerdi 'on' taender", () => {
  assert.equal(LONG_ATTACK_7884_FLAG_KEY, "long_attack_7884");
  assert.equal(evaluateLongAttack7884Flag("on"), true);
  for (const value of [undefined, null, "", "off", "beta", "ON", " on", true, 1, {}]) assert.equal(evaluateLongAttack7884Flag(value), false, String(value));
});
