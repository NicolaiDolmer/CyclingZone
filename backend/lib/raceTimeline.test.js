import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildStageTimeline, buildStageTimelineV4, TIMELINE_VERSION, withEventPlaces } from "./raceTimeline.js";
import { buildRaceStory, checkpointGapForRider, replayFrames } from "./raceStory.js";
import { computeCatchKm } from "./racePassages.js";
import { stableSeed, deriveBreakawayStatus, ABILITY_KEYS } from "./raceSimulator.js";
import { buildRaceResults, buildStageRowsAccumulated } from "./raceRunner.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

// components-nøgler simulateStage persisterer pr. rytter (raceSimulator.js:677) —
// fog-gaten (#1791, konsistensregel 5) forbyder disse som event-param-nøgler.
const COMPONENT_KEYS = new Set([
  "terrain", "noise", "form", "fatigue", "team", "breakaway", "finale",
  "work_cost", "dayform", "jour_sans", "peak", "long_day", "incident",
]);

function collectKeys(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) collectKeys(v, out); return out; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { out.add(k); collectKeys(v, out); }
  }
  return out;
}

function rider(id, rank, stageGap, extra = {}) {
  return {
    rider_id: id, team_id: extra.team_id ?? `t-${id}`, rank, stageGap,
    components: { breakaway: extra.breakaway ?? 0 },
    ...(extra.race_role ? { race_role: extra.race_role } : {}),
  };
}

// ── 1. Determinisme ────────────────────────────────────────────────────────
test("determinisme: samme (seed, input) → byte-identisk output, to kald", () => {
  const ranked = [
    rider("a", 1, 0, { breakaway: 0.2 }),
    rider("b", 2, 4),
    rider("c", 3, 9),
    rider("d", 4, 20, { breakaway: 0.1 }),
    rider("e", 5, 33),
  ];
  const stageProfile = {
    profile_type: "mountain", distance_km: 160, finale_type: "descent",
    climbs: [
      { name: "Col A", category: "1", crest_km: 50 },
      { name: "Col B", category: "HC", crest_km: 140 },
    ],
  };
  const incidents = [{ rider_id: "c", kind: "crash", outcome: "time_loss", time_loss_seconds: 45 }];
  const seed = stableSeed("timeline-determinism");
  const args = {
    ranked, stageProfile, moments: [], incidents, passages: [],
    breakawayStatus: deriveBreakawayStatus(ranked),
    gc: null, previousGc: null, seed, isStageRace: false,
  };
  const r1 = buildStageTimeline(args);
  const r2 = buildStageTimeline({ ...args, breakawayStatus: deriveBreakawayStatus(ranked) });
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  assert.equal(r1.timeline_version, TIMELINE_VERSION);
  assert.ok(r1.events.length > 0);
});

// ── 2. Konsistensregler ────────────────────────────────────────────────────
test("konsistensregel 1: finish-eventens rækkefølge = ranked's rangorden", () => {
  const ranked = [
    rider("a", 1, 0), rider("b", 2, 3), rider("c", 3, 8), rider("d", 4, 15), rider("e", 5, 40),
  ];
  const stageProfile = { profile_type: "flat", distance_km: 190 };
  const result = buildStageTimeline({
    ranked, stageProfile, breakawayStatus: deriveBreakawayStatus(ranked),
    seed: stableSeed("finish-order"), isStageRace: false,
  });
  const finish = result.events.find((e) => e.type === "finish");
  assert.ok(finish);
  assert.deepEqual(finish.params.top.map((t) => t.rider_id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(finish.params.top.map((t) => t.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(finish.params.top.map((t) => t.gap), [0, 3, 8, 15, 40]);
});

test("konsistensregel 2: gap-kurvens slutpunkt = 0 ved catchKm når udbruddet ER indhentet", () => {
  const ranked = [
    rider("winner", 1, 0),           // IKKE escapee — vandt fra feltet
    rider("b", 2, 4, { breakaway: 0.2 }),  // escapee, indhentet
    rider("c", 3, 9),
    rider("e", 4, 14, { breakaway: 0.1 }), // escapee, indhentet
    rider("f", 5, 20),
  ];
  const stageProfile = {
    profile_type: "mountain", distance_km: 170, finale_type: "descent",
    climbs: [{ name: "Col A", category: "2", crest_km: 60 }, { name: "Col B", category: "1", crest_km: 150 }],
  };
  const seed = stableSeed("timeline-catch-endpoint");
  const result = buildStageTimeline({
    ranked, stageProfile, breakawayStatus: deriveBreakawayStatus(ranked),
    seed, isStageRace: false,
  });
  const expectedCatchKm = Math.round(computeCatchKm({ stageProfile, seed }) * 100) / 100;
  const caught = result.events.find((e) => e.type === "breakaway_caught");
  assert.ok(caught, "breakaway_caught mangler");
  assert.equal(caught.km, expectedCatchKm);
  assert.deepEqual(caught.params.rider_ids, ["b", "e"]);

  const gapEvents = result.events.filter((e) => e.type === "gap_update");
  assert.ok(gapEvents.length >= 2);
  const lastGap = gapEvents[gapEvents.length - 1];
  assert.equal(lastGap.km, expectedCatchKm);
  assert.equal(lastGap.params.gap_seconds, 0);
});

test("konsistensregel 2: gap-kurvens slutpunkt = vinderens persisterede slutgab når udbruddet OVERLEVER", () => {
  const ranked = [
    rider("escapee", 1, 0, { breakaway: 0.25 }), // vandt SOM escapee — holdt hjem
    rider("chaser", 2, 27),  // bedst-placerede IKKE-escapee → feltets persisterede slutgab
    rider("c", 3, 33),
    rider("d", 4, 41),
  ];
  const stageProfile = { profile_type: "hilly", distance_km: 140, climbs: [{ name: "Côte", category: "2", crest_km: 100 }] };
  const seed = stableSeed("timeline-survived-endpoint");
  const result = buildStageTimeline({
    ranked, stageProfile, breakawayStatus: deriveBreakawayStatus(ranked),
    seed, isStageRace: false,
  });
  const survived = result.events.find((e) => e.type === "breakaway_survived");
  assert.ok(survived, "breakaway_survived mangler");
  assert.equal(survived.params.final_gap, 27);
  assert.deepEqual(survived.params.rider_ids, ["escapee"]);

  const gapEvents = result.events.filter((e) => e.type === "gap_update");
  const lastGap = gapEvents[gapEvents.length - 1];
  assert.equal(lastGap.km, 140);
  assert.equal(lastGap.params.gap_seconds, 27);
});

test("konsistensregel 4: alle km ∈ [0, distance] og listen er sorteret ikke-faldende på km", () => {
  const ranked = [
    rider("a", 1, 0, { breakaway: 0.2 }),
    rider("b", 2, 5),
    rider("c", 3, 11, { breakaway: 0.15 }),
    rider("d", 4, 19),
    rider("e", 5, 60),
    rider("f", 6, 61),
  ];
  const stageProfile = {
    profile_type: "mountain", distance_km: 150, finale_type: "descent",
    climbs: [{ name: "Col A", category: "1", crest_km: 40 }, { name: "Col B", category: "HC", crest_km: 130, summit_finish: false }],
  };
  const incidents = [
    { rider_id: "d", kind: "crash", outcome: "time_loss", time_loss_seconds: 20 },
    { rider_id: "f", kind: "mechanical", outcome: "abandon", time_loss_seconds: null },
  ];
  const moments = [
    { moment_key: "favorite_off_day", params: { riderId: "e", rank: 5, reason: "incident" }, significance: 75, rider_ids: ["e"] },
  ];
  const result = buildStageTimeline({
    ranked, stageProfile, moments, incidents, passages: [],
    breakawayStatus: deriveBreakawayStatus(ranked),
    gc: [{ rider_id: "a", rank: 1, time: 100 }],
    previousGc: [{ rider_id: "b", rank: 1, time: 90 }, { rider_id: "a", rank: 2, time: 140 }],
    seed: stableSeed("timeline-bounds"), isStageRace: true,
  });
  assert.ok(result.events.length > 5);
  let lastKm = -1;
  for (const e of result.events) {
    assert.ok(e.km >= 0 && e.km <= 150, `${e.type} km=${e.km} uden for [0,150]`);
    assert.ok(e.km >= lastKm, `${e.type} km=${e.km} < forrige km=${lastKm} (ikke monotont)`);
    lastKm = e.km;
  }
});

// ── 3. Fog-gate ────────────────────────────────────────────────────────────
test("fog-gate: ingen event-params indeholder nøgler fra components-settet", () => {
  const ranked = [
    rider("a", 1, 0, { breakaway: 0.2, race_role: "sprint_captain" }),
    rider("b", 2, 2, { race_role: "sprint_captain", team_id: "team-b" }),
    rider("c", 3, 5),
    rider("d", 4, 9, { breakaway: 0.1 }),
    rider("e", 5, 60),
    rider("f", 6, 61),
  ];
  const stageProfile = {
    profile_type: "flat", distance_km: 180, finale_type: "bunch_sprint",
    climbs: [], sprints: [{ name: "Sprint 1", km: 90, kind: "intermediate" }],
  };
  const passages = [
    { kind: "sprint", index: 0, name: "Sprint 1", km: 90, category: null, results: [{ rider_id: "a", passage_rank: 1, points: 20, bonus_seconds: 3 }] },
  ];
  const incidents = [{ rider_id: "e", kind: "crash", outcome: "time_loss", time_loss_seconds: 12 }];
  const moments = [
    { moment_key: "favorite_off_day", params: { riderId: "e", rank: 5, reason: "incident" }, significance: 75, rider_ids: ["e"] },
    { moment_key: "tag_jour_sans", params: { riderId: "f" }, significance: 30, rider_ids: ["f"] },
  ];
  const result = buildStageTimeline({
    ranked, stageProfile, moments, incidents, passages,
    breakawayStatus: deriveBreakawayStatus(ranked),
    gc: [{ rider_id: "a", rank: 1, time: 50 }],
    previousGc: [{ rider_id: "d", rank: 1, time: 20 }, { rider_id: "a", rank: 2, time: 60 }],
    seed: stableSeed("timeline-fog-gate"), isStageRace: true,
  });
  assert.ok(result.events.length > 3);
  for (const e of result.events) {
    const keys = collectKeys(e.params);
    for (const k of keys) {
      assert.ok(!COMPONENT_KEYS.has(k), `event ${e.type} lækker komponent-nøgle "${k}" i params: ${JSON.stringify(e.params)}`);
    }
  }
});

// ── 5. catch-km bit-identisk med racePassages ─────────────────────────────
test("catch-km er bit-identisk med racePassages.computeCatchKm for samme seed", () => {
  const stageProfile = { profile_type: "high_mountain", distance_km: 210, climbs: [{ name: "HC", category: "HC", crest_km: 195 }] };
  const seed = stableSeed("timeline-catch-bit-identity");
  const expected = computeCatchKm({ stageProfile, seed });

  const ranked = [
    rider("winner", 1, 0),
    rider("escapee", 2, 6, { breakaway: 0.3 }),
    rider("c", 3, 12),
  ];
  const result = buildStageTimeline({
    ranked, stageProfile, breakawayStatus: deriveBreakawayStatus(ranked),
    seed, isStageRace: false,
  });
  const caught = result.events.find((e) => e.type === "breakaway_caught");
  assert.ok(caught);
  assert.equal(caught.km, Math.round(expected * 100) / 100);
  // Determinisme af selve computeCatchKm: to uafhængige kald med samme seed er identiske.
  assert.equal(computeCatchKm({ stageProfile, seed }), expected);
});

// ── 6. Kurations-reglen (forbedring 1) ────────────────────────────────────
test("kurations-reglen: 8 jour_sans-kandidater ind → max 3 favorite_crack + ét field_fading(count=5)", () => {
  const jourSansIds = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
  const ranked = [
    rider("winner", 1, 0),
    ...jourSansIds.map((id, i) => rider(id, i + 2, 30 + i * 5)),
  ];
  const moments = jourSansIds.map((id, i) => ({
    moment_key: "tag_jour_sans",
    params: { riderId: id },
    significance: 30 + (jourSansIds.length - i), // faldende — deterministisk rangorden
    rider_ids: [id],
  }));
  const stageProfile = { profile_type: "hilly", distance_km: 120, climbs: [] };
  const result = buildStageTimeline({
    ranked, stageProfile, moments, incidents: [], passages: [],
    breakawayStatus: deriveBreakawayStatus(ranked),
    seed: stableSeed("timeline-curation"), isStageRace: false,
  });
  const cracks = result.events.filter((e) => e.type === "favorite_crack");
  const fading = result.events.filter((e) => e.type === "field_fading");
  assert.equal(cracks.length, 3, "skal kuratere til max 3 favorite_crack-events");
  assert.equal(fading.length, 1, "resten skal aggregeres til ÉT field_fading-event");
  assert.equal(fading[0].params.count, 5);
  // De 3 kept skal være de 3 højest-signifikante (r1, r2, r3 — faldende significance).
  assert.deepEqual(cracks.map((c) => c.params.rider_id).sort(), ["r1", "r2", "r3"]);
});

// ── 4. Flag-off → ingen tidslinje-rækker (raceRunner-integration) ─────────
function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}
function entrant(id, team_id, overrides = {}) {
  return { rider_id: id, team_id, rider_name: id, abilities: abil(overrides) };
}
const FLAG_OFF_ENTRANTS = [
  entrant("r1", "A", { climbing: 80 }),
  entrant("r2", "A", { sprint: 80 }),
  entrant("r3", "B", { endurance: 70 }),
  entrant("r4", "B", { punch: 65 }),
];
const FLAG_OFF_RACE = { id: "race-timeline-flagoff", race_type: "stage_race", season_id: "s1" };
const FLAG_OFF_STAGES = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "hilly", demand_vector: DEMAND_VECTORS.hilly },
];

test("flag-off (timeline-param udeladt) → buildRaceResults returnerer timelines: []", () => {
  const { timelines } = buildRaceResults({
    race: FLAG_OFF_RACE, stages: FLAG_OFF_STAGES, entrants: FLAG_OFF_ENTRANTS, pointsLookup: {},
  });
  assert.deepEqual(timelines, []);
});

test("flag-off (timeline-param udeladt) → buildStageRowsAccumulated returnerer timelines: []", () => {
  const { timelines } = buildStageRowsAccumulated({
    race: FLAG_OFF_RACE, stagesSorted: FLAG_OFF_STAGES, stageIndex: 0,
    entrants: FLAG_OFF_ENTRANTS, pointsLookup: {}, priorStageRows: [],
  });
  assert.deepEqual(timelines, []);
});

test("timeline=true → buildRaceResults genererer PRÆCIS én tidslinje pr. etape (stage_number matcher)", () => {
  const { timelines } = buildRaceResults({
    race: FLAG_OFF_RACE, stages: FLAG_OFF_STAGES, entrants: FLAG_OFF_ENTRANTS, pointsLookup: {},
    timeline: true,
  });
  assert.equal(timelines.length, FLAG_OFF_STAGES.length);
  assert.deepEqual(timelines.map((t) => t.stage_number).sort(), [1, 2]);
  for (const t of timelines) {
    assert.equal(t.timeline_version, TIMELINE_VERSION);
    assert.ok(Array.isArray(t.events) && t.events.length > 0);
  }
});

// ── 5. #4373: tidskørsler er ikke massespurter ─────────────────────────────
// Regressionen: prologen i Giro della Penisola fik win_type "sprint_win", og
// "The story of the stage" skrev at vinderen vandt massespurten. Feltbaserede
// events (sprint_decided, leadout, finale_attack, peloton_splits) må slet ikke
// kunne opstå på itt/ttt — der er intet felt.
const FIELD_EVENT_TYPES = ["sprint_decided", "leadout", "finale_attack", "peloton_splits"];

function timeTrialTimeline(profileType, extra = {}) {
  const ranked = [
    rider("a", 1, 0),
    rider("b", 2, 1),   // 1 sekund → ramte den gamle SPRINT_GAP_S-tærskel
    rider("c", 3, 1),   // samme sluttid som b → gammel peloton_splits-"gruppe"
    rider("d", 4, 25),
  ];
  return buildStageTimeline({
    ranked,
    stageProfile: { profile_type: profileType, distance_km: 12, climbs: [] },
    moments: [], incidents: [], passages: [],
    breakawayStatus: deriveBreakawayStatus(ranked),
    seed: stableSeed(`timeline-${profileType}`), isStageRace: false,
    ...extra,
  });
}

test("#4373 itt: win_type = itt_win, og ingen felt-events overhovedet", () => {
  const { events } = timeTrialTimeline("itt");
  const finish = events.find((e) => e.type === "finish");
  assert.ok(finish, "finish-eventet skal stadig findes");
  assert.equal(finish.params.win_type, "itt_win");
  for (const type of FIELD_EVENT_TYPES) {
    assert.equal(events.some((e) => e.type === type), false, `itt må aldrig udsende ${type}`);
  }
});

test("#4373 ttt: egen win_type, ikke enkeltstartens og ikke spurtens", () => {
  const { events } = timeTrialTimeline("ttt");
  const finish = events.find((e) => e.type === "finish");
  assert.equal(finish.params.win_type, "ttt_win");
  for (const type of FIELD_EVENT_TYPES) {
    assert.equal(events.some((e) => e.type === type), false, `ttt må aldrig udsende ${type}`);
  }
});

test("#4373: flad etape med samme tal er UÆNDRET (sprint_decided + sprint_win)", () => {
  const { events } = timeTrialTimeline("flat");
  const finish = events.find((e) => e.type === "finish");
  assert.equal(finish.params.win_type, "sprint_win");
  assert.ok(events.some((e) => e.type === "sprint_decided"), "flad etape spurter stadig");
});

test("#4373: favorite_crack på itt markeres som tidskørsel (feltsprog gates i tekst-laget)", () => {
  const ranked = [rider("a", 1, 0), rider("b", 2, 40), rider("c", 3, 90)];
  const moments = [{ moment_key: "tag_jour_sans", params: { riderId: "c" }, significance: 30, rider_ids: ["c"] }];
  const itt = buildStageTimeline({
    ranked, stageProfile: { profile_type: "itt", distance_km: 12, climbs: [] },
    moments, incidents: [], passages: [],
    breakawayStatus: deriveBreakawayStatus(ranked),
    seed: stableSeed("timeline-crack-itt"), isStageRace: false,
  });
  const ittCrack = itt.events.find((e) => e.type === "favorite_crack");
  assert.ok(ittCrack);
  assert.equal(ittCrack.params.discipline, "time_trial");

  const hilly = buildStageTimeline({
    ranked, stageProfile: { profile_type: "hilly", distance_km: 120, climbs: [] },
    moments, incidents: [], passages: [],
    breakawayStatus: deriveBreakawayStatus(ranked),
    seed: stableSeed("timeline-crack-hilly"), isStageRace: false,
  });
  const hillyCrack = hilly.events.find((e) => e.type === "favorite_crack");
  assert.ok(hillyCrack);
  assert.equal(hillyCrack.params.discipline, undefined, "kun tidskørsler markeres");
});

// End-to-end gennem raceRunner: profilen SKAL nå hele vejen fra etape-rækken til
// både moments og tidslinje. Fejler denne, er tråden knækket et sted i runneren.
const ITT_STAGES = [
  { stage_number: 1, profile_type: "itt", distance_km: 8, demand_vector: DEMAND_VECTORS.itt ?? DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
];

test("#4373 end-to-end: buildRaceResults giver itt_win på etape 1 og spurt-nøgler på etape 2", () => {
  const { moments, timelines } = buildRaceResults({
    race: { id: "race-4373", race_type: "stage_race", season_id: "s1" },
    stages: ITT_STAGES, entrants: FLAG_OFF_ENTRANTS, pointsLookup: {},
    v3: true, timeline: true,
  });

  const stage1Moments = moments.filter((m) => m.stage_number === 1);
  assert.ok(stage1Moments.some((m) => m.moment_key === "itt_win"), "etape 1 skal have itt_win");
  for (const k of ["sprint_win", "close_win", "solo_win"]) {
    assert.equal(stage1Moments.some((m) => m.moment_key === k), false, `etape 1 (itt) må ikke have ${k}`);
  }

  const stage1Timeline = timelines.find((t) => t.stage_number === 1);
  assert.equal(stage1Timeline.events.find((e) => e.type === "finish").params.win_type, "itt_win");
  for (const type of FIELD_EVENT_TYPES) {
    assert.equal(stage1Timeline.events.some((e) => e.type === type), false, `etape 1 (itt) må ikke have ${type}`);
  }

  // Etape 2 er flad — den gamle klassificering skal stadig gælde der.
  const stage2Moments = moments.filter((m) => m.stage_number === 2);
  assert.equal(stage2Moments.some((m) => m.moment_key === "itt_win"), false);
  assert.ok(
    stage2Moments.some((m) => ["sprint_win", "close_win", "solo_win"].includes(m.moment_key)),
    "etape 2 skal stadig klassificeres som spurt/tæt/solo",
  );
});

// #6350: formen fra en gemt bjergankomst (Giro-etapen fra ejerens Hvorfor-krav,
// anonymiseret): feltet henter et udbrud inde i sidste segment, og den gruppe der
// blev sat, står derfor på stregen sammen med en rytter der "gik kold" dér.
function summitFinishLog(lastSplitRiders = ["dropped"]) {
  const split = (groupId, gapSeconds, exactKm, riderIds, exactTime) => ({
    km: 180,
    type: "peloton_splits",
    params: { group_id: groupId, source_group_id: "peloton-0", gap_seconds: gapSeconds, rider_ids: riderIds, exact_km: exactKm, exact_time: exactTime },
  });
  return [
    { km: 0, type: "stage_start", params: { exact_km: 0, exact_time: 0 } },
    { km: 170, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 91, exact_km: 170 } },
    { km: 174.07, type: "breakaway_caught", params: { group_id: "breakaway-1", rider_ids: ["ahead"], exact_km: 174.07 } },
    { km: 180, type: "all_out_cracked", params: { rider_id: "dropped", exact_km: 180, exact_time: 19700 } },
    split("gruppetto-1", 53.09, 170.76, ["a"], 17609),
    split("gruppetto-2", 62.38, 170.71, ["b"], 17599),
    split("gruppetto-3", 302.73, 180, lastSplitRiders, 19700),
    { km: 180, type: "finish", params: { exact_km: 180, top: [] } },
  ];
}

test("#6350: et split der stod på stregen får stedet på stigningen, og 'gik kold' følger med", () => {
  const log = summitFinishLog();
  const before = JSON.stringify(log);
  const placed = withEventPlaces(log);
  assert.equal(JSON.stringify(log), before, "input muteres aldrig");
  const split = placed.find((e) => e.params.group_id === "gruppetto-3");
  assert.ok(Math.abs(split.params.exact_km - 170.46) <= 0.02, `motorens egen formel, fik ${split.params.exact_km}`);
  assert.equal(split.params.exact_time, undefined, "tiden på stregen hører ikke til stedet");
  assert.equal(split.km, 180, "rækkefølgen røres ikke");
  const crack = placed.find((e) => e.type === "all_out_cracked");
  assert.equal(crack.params.exact_km, split.params.exact_km);
  assert.deepEqual(withEventPlaces(placed), placed, "idempotent");
});

test("#6350: 'sat' står hvor han blev sat, men kun til han er tilbage i gruppen han blev sat fra", () => {
  const leg = (km) => ({ km, type: "stage_plan_leg", params: { rider_id: "r", leg: 1, task: "ride_in", reason: "dropped", exact_km: km } });
  const dropped = { km: 90, type: "peloton_splits", params: { group_id: "chase-1", source_group_id: "peloton-0", rider_ids: ["r"], gap_seconds: 40, exact_km: 82.5, exact_time: 7000 } };
  assert.deepEqual(withEventPlaces([dropped, leg(120)])[1].params, { rider_id: "r", leg: 1, task: "ride_in", reason: "dropped", exact_km: 82.5, exact_time: 7000 });
  const back = { km: 100, type: "group_merged", params: { group_id: "chase-1", into_group_id: "peloton-0", rider_ids: ["r"], exact_km: 100 } };
  assert.equal(withEventPlaces([dropped, back, leg(120)])[2].params.exact_km, 120);
  const onward = { km: 100, type: "group_merged", params: { group_id: "chase-1", into_group_id: "gruppetto-2", rider_ids: ["r"], exact_km: 100 } };
  assert.equal(withEventPlaces([dropped, onward, leg(120)])[2].params.exact_km, 82.5);
});

test("#6350: 'hentet' står ved indhentningen, og et uheld forklarer 'sat' uden at låne uheldets tid", () => {
  const leg = (reason) => ({ km: 120, type: "stage_plan_leg", params: { rider_id: "r", leg: 1, task: "ride_in", reason, exact_km: 120 } });
  const caught = { km: 118, type: "breakaway_caught", params: { group_id: "b", rider_ids: ["r"], exact_km: 112, exact_time: 9000 } };
  assert.equal(withEventPlaces([caught, leg("caught")])[1].params.exact_km, 112);
  const crash = { km: 107, type: "incident", params: { rider_id: "r", outcome: "time_loss", exact_km: 107 } };
  const placed = withEventPlaces([crash, leg("dropped")])[1];
  assert.equal(placed.params.exact_km, 107);
  assert.equal(placed.params.exact_time, undefined);
});

test("#6350 (Codex-review): uden bevis bliver tjekpunktet stående, og et uheld forklarer ikke et 'sat' efter han er tilbage", () => {
  const stuck = (sourceGroupId) => ({ km: 180, type: "peloton_splits", params: { group_id: "late", source_group_id: sourceGroupId, gap_seconds: 120, rider_ids: ["r"], exact_km: 180, exact_time: 19000 } });
  const placed = { km: 180, type: "peloton_splits", params: { group_id: "early", source_group_id: "peloton-0", gap_seconds: 53.09, rider_ids: ["a"], exact_km: 170.76, exact_time: 17609 } };
  const update = { km: 170, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 10, exact_km: 170 } };
  // Intet placeret split i segmentet: ingen viden om hvor segmentet startede.
  assert.equal(withEventPlaces([update, stuck("peloton-0")])[1].params.exact_km, 180);
  // Kildegruppen blev først dannet i segmentet: linjerne var ikke samlet ved starten.
  assert.equal(withEventPlaces([update, placed, stuck("chase-new")])[2].params.exact_km, 180);
  assert.ok(withEventPlaces([update, placed, stuck("peloton-0")])[2].params.exact_km < 171);

  const crash = { km: 107, type: "incident", params: { rider_id: "r", outcome: "time_loss", exact_km: 107 } };
  const back = { km: 115, type: "group_merged", params: { group_id: "solo-m10-1-0", into_group_id: "chase-2", rider_ids: ["r"], exact_km: 115 } };
  const leg = { km: 140, type: "stage_plan_leg", params: { rider_id: "r", leg: 1, task: "ride_in", reason: "dropped", exact_km: 140 } };
  assert.equal(withEventPlaces([crash, back, leg])[2].params.exact_km, 140);
});

// Formen fra etape 10 på rigtige data, anonymiseret: et split på stregen med 15
// ryttere, 13 fra feltet og 2 fra et udbrud der først blev hentet ved km 174,07.
// Hul, steder og hentninger er de gemte tal. 'caught-early' blev hentet før stedet.
function stage10Log() {
  const fieldRiders = ["dropped", "caught-early", ...Array.from({ length: 11 }, (_, i) => `field-${i}`)];
  const log = summitFinishLog([...fieldRiders, "ahead", "ahead-2"]);
  const ahead = ["ahead", "ahead-2"];
  const catchAt = log.findIndex((e) => e.type === "breakaway_caught");
  log[catchAt] = { km: 174.07, type: "breakaway_caught", params: { group_id: "breakaway-1", rider_ids: ahead, exact_km: 174.07, exact_time: 18313.7 } };
  log.splice(catchAt + 1, 0, { km: 174.07, type: "group_merged", params: { group_id: "breakaway-1", into_group_id: "peloton-0", rider_ids: ahead, exact_km: 174.07, exact_time: 18313.7 } });
  log.splice(1, 0,
    { km: 97.1, type: "finale_attack", params: { group_id: "breakaway-1", rider_ids: ahead, exact_km: 93.02, exact_time: 9086.87 } },
    { km: 130, type: "peloton_splits", params: { group_id: "solo-early", source_group_id: "breakaway-1", gap_seconds: 102.04, rider_ids: ["caught-early"], exact_km: 120.23, exact_time: 11708.61 } },
    { km: 160.54, type: "group_merged", params: { group_id: "solo-early", into_group_id: "peloton-0", rider_ids: ["caught-early"], exact_km: 160.54, exact_time: 16568.81 } });
  return log;
}

test("#6350: split'et deles pr. rytter: den der blev sat, får stedet på stigningen, den hentede bliver i udbruddet til km 174", () => {
  const log = stage10Log();
  const before = JSON.stringify(log);
  const placed = withEventPlaces(log);
  assert.equal(JSON.stringify(log), before, "input muteres ikke");

  const halves = placed.filter((e) => e.type === "peloton_splits" && e.params.group_id === "gruppetto-3");
  assert.equal(halves.length, 2);
  const [set, late] = halves;
  assert.ok(set.params.exact_km > 170.4 && set.params.exact_km < 171, `sat ved km ${set.params.exact_km}, på stigningen`);
  assert.equal(set.params.exact_time, undefined, "tiden hører ikke til stedet");
  assert.equal(set.params.rider_ids.length, 13);
  assert.ok(set.params.rider_ids.includes("dropped"));
  assert.ok(set.params.rider_ids.includes("caught-early"), "hentet før stedet: han var i feltet da hullet åbnede");
  assert.deepEqual(late.params.rider_ids, ["ahead", "ahead-2"]);
  assert.ok(late.params.exact_km > 174.07 && late.params.exact_km < 175, `#7734: tabet begynder efter kontakten, fik km ${late.params.exact_km}`);
  assert.equal(late.params.exact_time, undefined, "tiden på stregen hører ikke til stedet");
  assert.equal(late.params.own_line, true);
  assert.equal(set.km, 180);
  assert.equal(late.km, 180);
  assert.equal(placed.find((e) => e.type === "all_out_cracked").params.exact_km, set.params.exact_km, "'gik kold' følger rytteren");
  assert.deepEqual(withEventPlaces(placed), placed, "idempotent");

  const story = buildRaceStory({ events: placed });
  const frames = replayFrames(story, { finaleKm: 12, stepKm: 1 });
  const onClimb = frames.filter((f) => f.km >= 171 && f.km <= 174);
  assert.ok(onClimb.length > 0);
  for (const frame of onClimb) {
    assert.equal(frame.groups.find((g) => g.group_id === "breakaway-1")?.size, 2, `km ${frame.km}: udbruddet er helt til det er hentet`);
    assert.equal(frame.groups.find((g) => g.group_id === "gruppetto-3")?.size, 13, `km ${frame.km}: de 13 er sat, de 2 er ikke`);
  }
  const atLine = story.snapshots.at(-1).groups.find((g) => g.group_id === "gruppetto-3");
  assert.equal(atLine.size, 15, "alle 15 ender i gruppen på stregen");
});

test("#6350: split'et bliver helt, når ingen eller alle ryttere kørte i kildegruppen på stedet", () => {
  const onlyLate = withEventPlaces(summitFinishLog(["ahead"])).filter((e) => e.params.group_id === "gruppetto-3");
  assert.equal(onlyLate.length, 1);
  assert.ok(onlyLate[0].params.exact_km > 174.07 && onlyLate[0].params.exact_km < 175, "#7734: gruppen er selv linjen fra kontakten");
  assert.equal(onlyLate[0].params.joined_late, undefined);
  assert.equal(onlyLate[0].params.own_line, undefined);

  const all = withEventPlaces(summitFinishLog(["dropped", "other"])).filter((e) => e.params.group_id === "gruppetto-3");
  assert.equal(all.length, 1);
  assert.ok(all[0].params.exact_km < 171);
  assert.deepEqual(all[0].params.rider_ids, ["dropped", "other"]);
});

test("#6350: loggen kender kun indhentningen, ikke dannelsen: den hentede holdes stadig tilbage", () => {
  const halves = withEventPlaces(summitFinishLog(["dropped", "ahead"])).filter((e) => e.params.group_id === "gruppetto-3");
  assert.deepEqual(halves.map((e) => e.params.rider_ids), [["dropped"], ["ahead"]]);
  assert.ok(halves[1].params.exact_km > 174.07 && halves[1].params.exact_km < 180);
});

// #7734: etape 10 på rigtige data (anonymiseret fixture, kun events). rider-set blev
// sat på stigningen, rider-late-a/b kørte i udbruddet til km 174,07.
function realStage10() {
  const { events } = JSON.parse(readFileSync(new URL("../../scripts/__fixtures__/race-truth/giro-stage-10.json", import.meta.url), "utf8"));
  const placed = withEventPlaces(events);
  const story = buildRaceStory({ events: placed, timelineVersion: 2 });
  return { events, placed, story, frames: replayFrames(story, { finaleKm: 12, stepKm: 1 }) };
}

test("#7734: etape 10: de hentede taber tiden undervejs og hopper ikke ind i gruppen på stregen", () => {
  const { placed, story, frames } = realStage10();
  assert.deepEqual(withEventPlaces(placed), placed, "idempotent");
  const [set, late] = placed.filter((e) => e.type === "peloton_splits" && e.params.group_id === "gruppetto-13010");
  assert.equal(set.params.exact_km, 170.47, "den satte rytter er uændret");
  assert.ok(set.params.rider_ids.includes("rider-set"));
  assert.deepEqual([...late.params.rider_ids].sort(), ["rider-late-a", "rider-late-b"]);
  assert.ok(late.params.exact_km > 174.07 && late.params.exact_km < 175, `fik km ${late.params.exact_km}`);

  const line = story.group_spans.find((s) => s.group_id === "gruppetto-13010-late");
  assert.deepEqual([line.from_km, line.to_km, line.source_group_id, line.into_group_id], [late.params.exact_km, 180, "peloton-0", "gruppetto-13010"]);
  const gapOf = (frame, id) => frame.groups.find((g) => g.group_id === id);
  const onRoad = frames.filter((f) => f.km >= 175 && f.km < 180);
  assert.ok(onRoad.length >= 5);
  let previous = gapOf(frames.find((f) => f.km === 174), "breakaway-6000").gap_s;
  for (const frame of onRoad) {
    const own = gapOf(frame, "gruppetto-13010-late");
    assert.equal(own?.size, 2, `km ${frame.km}: de to kører for sig selv`);
    assert.equal(gapOf(frame, "gruppetto-13010").size, 13, `km ${frame.km}: gruppen er de 13`);
    assert.ok(own.gap_s > previous, `km ${frame.km}: hullet vokser`);
    assert.ok(own.gap_s < gapOf(frame, "gruppetto-13010").gap_s, `km ${frame.km}: de er ikke bag gruppen de ender i`);
    previous = own.gap_s;
  }
  const last = frames.at(-1);
  assert.equal(last.km, 180);
  assert.equal(gapOf(last, "gruppetto-13010").size, 15, "alle 15 på stregen");
  assert.equal(gapOf(last, "gruppetto-13010-late"), undefined);
  const stepToLine = gapOf(last, "gruppetto-13010").gap_s - previous;
  const stepOnRoad = gapOf(onRoad.at(-1), "gruppetto-13010-late").gap_s - gapOf(onRoad.at(-2), "gruppetto-13010-late").gap_s;
  assert.ok(Math.abs(stepToLine - stepOnRoad) < 1, `sidste km er samme hældning som resten, ikke et hop (${stepToLine} mod ${stepOnRoad})`);
});

test("#7734: en passage på vejen viser de hentede på deres egen linje, som filmen gør", () => {
  const { events, frames } = realStage10();
  const withPassage = withEventPlaces([...events, { km: 176, type: "kom_passage", params: { name: "x", category: "3", exact_km: 176, top: [] } }]);
  const story = buildRaceStory({ events: withPassage, timelineVersion: 2 });
  const passage = story.checkpoints.find((c) => c.km === 176);
  const late = checkpointGapForRider(passage, "rider-late-a");
  assert.equal(late.group_id, "gruppetto-13010-late");
  assert.equal(checkpointGapForRider(passage, "rider-set").group_id, "gruppetto-13010");
  // En passage bærer hullerne fra sidste melding, så de sammenlignes med feltet, ikke fronten.
  const behindField = (groups) => groups.find((g) => g.group_id === "gruppetto-13010-late").gap_s - groups.find((g) => g.group_id === "peloton-0").gap_s;
  const inFilm = behindField(frames.find((f) => f.km === 176).groups);
  const atPassage = behindField(passage.groups);
  assert.ok(Math.abs(atPassage - inFilm) < 5, `passagen ${atPassage} og filmen ${inFilm} fortæller det samme`);
  assert.equal(story.checkpoints.at(-1).groups.find((g) => g.group_id === "gruppetto-13010").size, 15, "målet er uændret");
});

test("#7734: filmens mål er det samme: kun vejen derhen ændrer sig", () => {
  const { placed, story } = realStage10();
  const lateOnLine = placed.map((e) => {
    if (!e.params?.own_line) return e;
    const { own_line: _ownLine, ...params } = e.params;
    return { ...e, params: { ...params, exact_km: e.km } };
  });
  const before = buildRaceStory({ events: lateOnLine, timelineVersion: 2 });
  assert.deepEqual(story.snapshots.at(-1), before.snapshots.at(-1));
  assert.deepEqual(story.checkpoints.at(-1), before.checkpoints.at(-1));
  assert.deepEqual(story.breakaway, before.breakaway);
});

test("#7734: uden bevis bliver den sene halvdel på tjekpunktet", () => {
  const inOtherGroup = summitFinishLog(["dropped", "ahead"]);
  inOtherGroup.splice(3, 0, { km: 174.07, type: "group_merged", params: { group_id: "breakaway-1", into_group_id: "gruppetto-1", rider_ids: ["ahead"], exact_km: 174.07 } });
  const [, late] = halvesOf(withEventPlaces(inOtherGroup));
  assert.equal(late.params.exact_km, 180, "han kørte ikke i kildegruppen efter kontakten");
  assert.equal(late.params.own_line, undefined);

  const noVisibleGap = summitFinishLog(["dropped", "ahead"]).map((e) => (e.params.group_id === "gruppetto-3" ? { ...e, params: { ...e.params, gap_seconds: 0.5 } } : e));
  assert.equal(withEventPlaces(noVisibleGap).find((e) => e.params.group_id === "gruppetto-3").params.own_line, undefined, "intet hul at vise");

  const beforeSegment = summitFinishLog(["ahead"]).filter((e) => e.type !== "breakaway_caught");
  beforeSegment.splice(1, 0, { km: 150, type: "group_merged", params: { group_id: "breakaway-1", into_group_id: "side", rider_ids: ["ahead"], exact_km: 150 } });
  assert.equal(withEventPlaces(beforeSegment).find((e) => e.params.group_id === "gruppetto-3").params.exact_km, 180, "kontakten er ikke i segmentet");
});

test("#7734: en sen halvdel fra et tidligere tjekpunkt kører i sin gruppe ved det næste split", () => {
  const split = (km, groupId, source, gap, exactKm, riderIds, time) => ({ km, type: "peloton_splits", params: { group_id: groupId, source_group_id: source, gap_seconds: gap, rider_ids: riderIds, exact_km: exactKm, ...(time ? { exact_time: time } : {}) } });
  const log = [
    { km: 0, type: "stage_start", params: { exact_km: 0, exact_time: 0 } },
    { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-1", rider_ids: ["late"], exact_km: 10 } },
    { km: 40, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 30, exact_km: 40 } },
    { km: 51, type: "breakaway_caught", params: { group_id: "breakaway-1", rider_ids: ["late"], exact_km: 51 } },
    { km: 51, type: "group_merged", params: { group_id: "breakaway-1", into_group_id: "peloton-0", rider_ids: ["late"], exact_km: 51 } },
    split(56, "g1", "peloton-0", 60, 45, ["a"], 4500),
    split(56, "g2", "peloton-0", 120, 56, ["set", "x", "late"], 5700),
    { km: 56, type: "gap_update", params: { group_id: "g2", gap_seconds: 120, exact_km: 56 } },
    split(85, "h1", "g2", 60, 70, ["x"], 7000),
    split(85, "h2", "g2", 90, 85, ["set", "late"], 8600),
    { km: 85, type: "gap_update", params: { group_id: "h2", gap_seconds: 210, exact_km: 85 } },
    { km: 100, type: "finish", params: { exact_km: 100, top: [] } },
  ];
  const placed = withEventPlaces(log);
  const atSecond = placed.filter((e) => e.type === "peloton_splits" && e.params.group_id === "h2");
  assert.equal(atSecond.length, 1, "ingen ny halvdel: begge kørte i g2 på stedet");
  assert.deepEqual(atSecond[0].params.rider_ids, ["set", "late"]);
  assert.ok(atSecond[0].params.exact_km < 75);
  assert.equal(placed.find((e) => e.params?.own_line)?.params.group_id, "g2");
  assert.deepEqual(withEventPlaces(placed), placed, "idempotent");
});

// Motorens form (segmentLoop.ts): sammenlægningen står efter splits på tjekpunktet
// og navngiver ALLE gruppens ryttere, også splittets egne.
function withOwnMerge(log, contactKm, riderIds) {
  const out = [...log];
  out.splice(out.length - 1, 0, { km: 180, type: "group_merged", params: { group_id: "gruppetto-3", into_group_id: "gruppetto-2", rider_ids: riderIds, exact_km: contactKm, exact_time: 18400 } });
  return out;
}
const halvesOf = (events) => events.filter((e) => e.type === "peloton_splits" && e.params.group_id === "gruppetto-3");

test("#6350: splittets egen sammenlægning er ikke et gruppeskift: den sene halvdel står på kontakten, de andre på stigningen", () => {
  const halves = halvesOf(withEventPlaces(withOwnMerge(summitFinishLog(["dropped", "ahead"]), 176, ["dropped", "ahead"])));
  assert.deepEqual(halves.map((e) => e.params.rider_ids), [["dropped"], ["ahead"]]);
  assert.ok(halves[0].params.exact_km < 171);
  assert.equal(halves[1].params.exact_km, 176, "før gruppen forsvinder, aldrig på stregen");
  assert.equal(halves[1].params.exact_time, undefined, "tiden på stregen hører ikke til stedet");
  assert.equal(halves[1].params.joined_late, true);
});

test("#6350: en kæde af sammenlægninger på tjekpunktet er stadig splittets egen linje", () => {
  const log = withOwnMerge(summitFinishLog(["dropped", "ahead"]), 176, ["dropped", "ahead"]);
  log.splice(log.length - 1, 0, { km: 180, type: "group_merged", params: { group_id: "gruppetto-2", into_group_id: "gruppetto-1", rider_ids: ["b", "dropped", "ahead"], exact_km: 178 } });
  assert.deepEqual(halvesOf(withEventPlaces(log)).map((e) => e.params.rider_ids), [["dropped"], ["ahead"]]);
});

test("#6350: et helt split af sene ryttere trækkes aldrig tilbage før rytterne var fri af udbruddet", () => {
  const [only] = halvesOf(withEventPlaces(withOwnMerge(summitFinishLog(["ahead"]), 176, ["ahead"])));
  assert.equal(only.params.exact_km, 174.07, "ikke søster-splittenes km 170,76");
  assert.equal(only.params.joined_late, undefined);
});

test("#6350: kontakten før den sene rytter var fri: sammenlægningen venter på ham", () => {
  const placed = withEventPlaces(withOwnMerge(summitFinishLog(["dropped", "ahead"]), 173, ["dropped", "ahead"]));
  const halves = halvesOf(placed);
  const merge = placed.find((e) => e.type === "group_merged" && e.params.group_id === "gruppetto-3");
  assert.equal(halves[1].params.exact_km, 174.07);
  assert.equal(merge.params.exact_km, 174.07);
  assert.equal(merge.params.exact_time, undefined);
  assert.deepEqual(withEventPlaces(placed), placed, "idempotent");
});

test("#6350: etape 10 med sammenlægningen i motorens form: filmen modsiger ikke sig selv", () => {
  const riders = halvesOf(stage10Log())[0].params.rider_ids;
  const log = withOwnMerge(stage10Log(), 176, riders);
  const placed = withEventPlaces(log);
  assert.deepEqual(placed.filter((e) => e.params?.joined_late !== true).map((e) => [e.type, e.km]), log.map((e) => [e.type, e.km]), "km er rækkefølgen og flyttes aldrig");
  assert.deepEqual(withEventPlaces(placed), placed, "idempotent");
  const [set, late] = halvesOf(placed);
  assert.equal(set.params.rider_ids.length, 13);
  assert.ok(set.params.exact_km > 170.4 && set.params.exact_km < 171);
  assert.deepEqual(late.params.rider_ids, ["ahead", "ahead-2"]);
  assert.equal(late.params.exact_km, 176);

  const story = buildRaceStory({ events: placed });
  const frames = replayFrames(story, { finaleKm: 12, stepKm: 1 });
  const size = (frame, id) => frame.groups.find((g) => g.group_id === id)?.size;
  for (const frame of frames.filter((f) => f.km >= 171 && f.km <= 174)) {
    assert.equal(size(frame, "breakaway-1"), 2, `km ${frame.km}: udbruddet er helt til det er hentet`);
    assert.equal(size(frame, "gruppetto-3"), 13, `km ${frame.km}: de 2 er ikke sat`);
  }
  for (const frame of frames.filter((f) => f.km > 174.07)) assert.equal(size(frame, "breakaway-1"), undefined, `km ${frame.km}: hentet`);
  const after = frames.filter((f) => f.km > 176 && f.km < 180);
  assert.ok(after.length > 0);
  for (const frame of after) {
    assert.equal(size(frame, "gruppetto-3"), undefined, `km ${frame.km}: gruppen er væk efter kontakten`);
    assert.equal(size(frame, "gruppetto-2"), 16, `km ${frame.km}: alle 15 og gruppens egen rytter`);
  }

  const groupMoments = story.moments.filter((m) => m.data?.group_id === "gruppetto-3");
  const joined = groupMoments.find((m) => m.key === "story.groups_joined");
  assert.equal(joined.km, 176);
  for (const moment of groupMoments.filter((m) => m.key === "story.split")) assert.ok(moment.km <= joined.km, `split ved km ${moment.km} efter kontakten`);
  assert.ok(groupMoments.indexOf(joined) > groupMoments.findLastIndex((m) => m.key === "story.split"), "sammenlægningen fortælles sidst");
});

test("#6350: 'droppet fra udbruddet' med flere ryttere står ved den sidste af dem", () => {
  const log = summitFinishLog(["dropped", "ahead"]);
  log.splice(3, 0, { km: 180, type: "breakaway_dropped", params: { group_id: "piece", from_group_id: "breakaway-1", rider_ids: ["dropped", "ahead"], exact_km: 180 } });
  const placed = withEventPlaces(withOwnMerge(log, 176, ["dropped", "ahead"]));
  assert.equal(placed.find((e) => e.type === "breakaway_dropped").params.exact_km, 176);
});

test("#6350: et angreb hentet i samme segment står før sin indhentning; en melding om gruppen venter på dannelsen", () => {
  const attack = (groupId, exactKm, exactTime) => ({ km: 99.2, type: "finale_attack", params: { group_id: groupId, rider_ids: [groupId], direction: "descent", exact_km: exactKm, exact_time: exactTime } });
  const log = [
    { km: 89, type: "own_riders_ahead", params: { group_id: "solo-2", rider_ids: ["solo-2"], exact_km: 89 } },
    attack("break-1", 99.2, 10336),
    attack("solo-2", 90.91, 9960),
    { km: 99.2, type: "breakaway_caught", params: { group_id: "break-1", rider_ids: ["break-1"], exact_km: 97.4, exact_time: 10225 } },
    { km: 99.2, type: "group_merged", params: { group_id: "break-1", into_group_id: "peloton-0", rider_ids: ["break-1"], exact_km: 97.4 } },
  ];
  const placed = withEventPlaces(log);
  assert.equal(placed[1].params.exact_km, 90.91, "sammen med de angreb den hørte til");
  assert.equal(placed[1].params.exact_time, undefined);
  assert.equal(placed[0].params.exact_km, 90.91);
  assert.equal(placed[0].params.exact_time, 9960);
  // Uden andre angreb før kontakten står den på selve kontakten.
  assert.equal(withEventPlaces(log.filter((e) => e.params.group_id !== "solo-2"))[0].params.exact_km, 97.4);
});

test("#6350: en log uden præcise steder kommer uændret tilbage, og en ny etape får stederne når den gemmes", () => {
  const old = [{ km: 10, type: "peloton_splits", params: { group_id: "g", gap_seconds: 30, rider_ids: ["r"] } }];
  assert.equal(withEventPlaces(old), old);
  assert.equal(withEventPlaces(null), null);
  const { events } = buildStageTimelineV4({ engineTimeline: { events: summitFinishLog() }, stageProfile: { distance_km: 180 } });
  assert.ok(events.find((e) => e.params.group_id === "gruppetto-3").params.exact_km < 171);
});

test("#7729: forsøget når filmen med alt det motoren skrev, også på en gemt etape", () => {
  const params = { exact_km: 12, exact_time: 900, rider_ids: ["a", "b"], escaped_rider_ids: ["a"], reacting_team_ids: ["t1"] };
  const [attempt] = withEventPlaces([{ km: 12, type: "breakaway_attempt", params }]);
  assert.deepEqual(attempt.params, params);
  const built = buildStageTimelineV4({ engineTimeline: { events: [{ km: 12, type: "breakaway_attempt", params }] }, stageProfile: { distance_km: 100 } });
  assert.deepEqual(built.events.find((e) => e.type === "breakaway_attempt").params, params);
});
