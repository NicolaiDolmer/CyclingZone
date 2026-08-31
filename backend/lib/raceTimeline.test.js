import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStageTimeline, TIMELINE_VERSION } from "./raceTimeline.js";
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
