// Løbsmotor v4 — bro-paritet (#4879). De fire huller auditten 5/9 og
// flip-kontrakterne i mechanics/incidents.ts + mechanics/timeLimit.ts udpegede,
// dvs. de steder hvor v4-stien var ufuldstændig SELV OM motoren gjorde det
// rigtige:
//
//   1. race_incidents: v4's uheldstrappe (#2944) og tidsgrænse (#2582) blev
//      kasseret af broen. Skadedage nåede aldrig rytteren.
//   2. Abandon-filteret i raceRunner var gated på `if (v3)`, så BÅDE udgåede
//      OG OTL-ryttere stillede til start dagen efter — tavst.
//   3. v4's egen tidslinje blev kasseret; fladen fik v3's syntetiske i stedet.
//   4. engine_version 4 gav en TOM fortælling og en balance-drift-doc der
//      ikke nævnte at v4 nu skriver race_incidents.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRaceResults,
  buildStageRowsAccumulated,
  incidentInjuryUpsertRows,
  simulateStageByIndex,
} from "./raceRunner.js";
import {
  ENGINE_VERSION_V4,
  incidentRowsFromV4Output,
  loadRaceEngineV4,
  rankedFromV4Output,
} from "./raceEngineV4Bridge.js";
import { buildStageTimelineV4, TIMELINE_VERSION_V4 } from "./raceTimeline.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

const ENTRANTS = Array.from({ length: 16 }, (_, i) => ({
  rider_id: `r${String(i).padStart(2, "0")}`,
  team_id: i < 8 ? "A" : "B",
  team_name: i < 8 ? "Team A" : "Team B",
  rider_name: `Rider ${i}`,
  is_u25: i % 4 === 0,
  abilities: abil(i),
  fatigue: (i * 3) % 30,
}));

const RACE = { id: "race-v4-parity", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };

const STAGES = [
  {
    stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    demand_vector: DEMAND_VECTORS.flat, distance_km: 180,
    climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-1",
  },
  {
    stage_number: 2, profile_type: "mountain", finale_type: "long_climb",
    demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
    climbs: [{ name: "Col", crest_km: 158, category: "1", summit_finish: true }],
    sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-2",
  },
];

function baseArgs(extra = {}) {
  return { race: RACE, stages: STAGES, entrants: ENTRANTS, pointsLookup: {}, v3: true, ...extra };
}

/** En v4 StageOutput med præcis de hændelser en test har brug for. */
function v4Output({ incidents = [], results = [] } = {}) {
  return { incidents, results, groupSnapshots: [], loads: [], timeline: { timeline_version: 2, events: [] } };
}
function inc(overrides = {}) {
  return {
    rider_id: "r01", km: 40, kind: "crash", severity: "light", outcome: "time_loss",
    time_loss_seconds: 12.4, injury_days: null, helper_assist: false, ...overrides,
  };
}
function res(rider_id, status, extra = {}) {
  return { rider_id, rank: 1, time_seconds: 100, group_id: "g", status, injury_days: null, ...extra };
}

// ── (1) race_incidents: trappen + tidsgrænsen skrives som v3 gør ─────────────

test("#2944 broen oversætter hele trappen til race_incidents' kolonner", () => {
  const rows = incidentRowsFromV4Output(v4Output({
    incidents: [
      inc({ rider_id: "light", severity: "light", time_loss_seconds: 12.4 }),
      inc({ rider_id: "hard", severity: "hard", time_loss_seconds: 180.6, injury_days: 3 }),
      inc({ rider_id: "serious", severity: "serious", outcome: "abandoned", time_loss_seconds: null, injury_days: 9 }),
      inc({ rider_id: "mech", kind: "mechanical", severity: null, time_loss_seconds: 45.2 }),
      inc({ rider_id: "prot", severity: "light", outcome: "protected_three_km_rule", time_loss_seconds: null }),
    ],
  }));
  const byRider = Object.fromEntries(rows.map((r) => [r.rider_id, r]));

  // Trin 1: let styrt = tidstab, kører videre.
  assert.deepEqual(byRider.light, { rider_id: "light", kind: "crash", severity: "light", outcome: "time_loss", time_loss_seconds: 12, injury_days: null });
  // Trin 2: hårdt styrt = stort tidstab + skade, MEN ingen udgåelse.
  assert.deepEqual(byRider.hard, { rider_id: "hard", kind: "crash", severity: "hard", outcome: "time_loss", time_loss_seconds: 181, injury_days: 3 });
  // Trin 3: alvorligt styrt = udgår + skade. Ingen etapetid at tabe.
  assert.deepEqual(byRider.serious, { rider_id: "serious", kind: "crash", severity: "serious", outcome: "abandon", time_loss_seconds: null, injury_days: 9 });
  // Trin 4: mekanisk uheld — ALDRIG skade, ALDRIG udgåelse, ingen alvorsakse (#4520).
  assert.deepEqual(byRider.mech, { rider_id: "mech", kind: "mechanical", severity: null, outcome: "time_loss", time_loss_seconds: 45, injury_days: null });
  // 3 km-reglen: placering koster, tid gør ikke.
  assert.deepEqual(byRider.prot, { rider_id: "prot", kind: "crash", severity: "light", outcome: "protected_three_km_rule", time_loss_seconds: null, injury_days: null });
});

test("#2944 to uheld på SAMME etape foldes til ÉN række (UNIQUE race_id/stage/rider)", () => {
  const rows = incidentRowsFromV4Output(v4Output({
    incidents: [
      inc({ rider_id: "r01", km: 120, kind: "mechanical", severity: null, time_loss_seconds: 30 }),
      inc({ rider_id: "r01", km: 40, severity: "hard", time_loss_seconds: 90, injury_days: 4 }),
    ],
  }));
  assert.equal(rows.length, 1, "race_incidents tillader kun én række pr. rytter pr. etape");
  // Repræsentanten er den mest indgribende hændelse; tiden er dagens SAMLEDE tab.
  assert.equal(rows[0].severity, "hard");
  assert.equal(rows[0].time_loss_seconds, 120);
  assert.equal(rows[0].injury_days, 4);
});

test("#2582 en OTL-rytter får kind='time_limit' + outcome='abandon' og ALDRIG skade fra tidsgrænsen", () => {
  const rows = incidentRowsFromV4Output(v4Output({
    results: [res("winner", "finished"), res("late", "otl")],
  }));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    rider_id: "late", kind: "time_limit", severity: null, outcome: "abandon",
    time_loss_seconds: null, injury_days: null,
  });
});

test("#2582 en OTL-rytter der OGSÅ styrtede beholder sine skadedage (én række, terminal art)", () => {
  const rows = incidentRowsFromV4Output(v4Output({
    incidents: [inc({ rider_id: "late", severity: "hard", time_loss_seconds: 400, injury_days: 5 })],
    results: [res("late", "otl")],
  }));
  assert.equal(rows.length, 1);
  // Rækken forklarer hvorfor han er UDE (tidsgrænsen), men skaden fra styrtet
  // følger stadig med — ellers ville han slippe for konsekvensen af sit styrt.
  assert.equal(rows[0].kind, "time_limit");
  assert.equal(rows[0].outcome, "abandon");
  assert.equal(rows[0].injury_days, 5);
  assert.equal(rows[0].time_loss_seconds, null, "en rytter der er ude af løbet har ingen etapetid at tabe");
});

test("#4879 rækkerne er deterministiske (samme output → samme rækker, samme orden)", () => {
  const output = v4Output({
    incidents: [inc({ rider_id: "r09" }), inc({ rider_id: "r02" }), inc({ rider_id: "r05" })],
    results: [res("r07", "otl")],
  });
  assert.deepEqual(incidentRowsFromV4Output(output), incidentRowsFromV4Output(output));
  assert.deepEqual(incidentRowsFromV4Output(output).map((r) => r.rider_id), ["r02", "r05", "r07", "r09"]);
});

test("#4879 udgåede OG OTL-ryttere får INGEN etaperække (race_results har ingen status-kolonne)", () => {
  const ranked = rankedFromV4Output({
    results: [res("ok1", "finished", { time_seconds: 100 }), res("late", "otl", { time_seconds: 900 }), res("gone", "abandoned", { time_seconds: 999 })],
    groupSnapshots: [],
  });
  assert.deepEqual(ranked.map((r) => r.rider_id), ["ok1"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1], "1..N uden huller");
});

// ── (1b) skadedagene lander PÅ rytteren, som v3 gør det ─────────────────────

test("#4520 skadereglen: kun styrt skader — v3-grenen er uændret, v4's trappe er dækket", () => {
  const rows = incidentInjuryUpsertRows({
    todayStr: "2026-09-06",
    incidents: [
      // v3 (uændret): styrt-udgåelse.
      { rider_id: "v3crash", kind: "crash", outcome: "abandon", injury_days: 3 },
      // v3 (uændret): mekanisk udgåelse skader ALDRIG.
      { rider_id: "v3mech", kind: "mechanical", outcome: "abandon", injury_days: null },
      // v4 trin 2: hårdt styrt, kører videre, men er forslået.
      { rider_id: "v4hard", kind: "crash", outcome: "time_loss", injury_days: 4 },
      // v4: mekanisk uheld — aldrig skade.
      { rider_id: "v4mech", kind: "mechanical", outcome: "time_loss", injury_days: null },
      // v4: OTL-række der bærer skaden fra et styrt samme etape.
      { rider_id: "v4otl", kind: "time_limit", outcome: "abandon", injury_days: 5 },
      // #4418: skaden ejes af rider_condition — injury_cause må IKKE overskrives.
      { rider_id: "dns", kind: "injury", outcome: "abandon", injury_days: null },
    ],
  });
  assert.deepEqual(rows.map((r) => r.rider_id), ["v3crash", "v4hard", "v4otl"]);
  assert.ok(rows.every((r) => r.injury_cause === "race_crash"));
  assert.equal(rows.find((r) => r.rider_id === "v3crash").injured_until, "2026-09-09");
  assert.equal(rows.find((r) => r.rider_id === "v4otl").injured_until, "2026-09-11");
});

// ── (2) abandon-filteret dækker v4, ikke kun v3 ─────────────────────────────
//
// Fælden fra mechanics/timeLimit.ts's flip-kontrakt punkt 3: gaten i
// raceRunner.js var `if (v3)`. Her er v3 SLUKKET og v4 TÆNDT — præcis det
// scenarie et flip skaber.

function makeSupabase(canned = {}) {
  const writes = [];
  function from(table) {
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
      order() { return b; }, limit() { return b; }, range() { return b; }, gte() { return b; }, lt() { return b; },
      maybeSingle() { return Promise.resolve({ data: (canned[table] || [])[0] ?? null, error: null }); },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      upsert(rows) { writes.push({ table, op: "upsert", rows }); return Promise.resolve({ error: null }); },
      update() {
        const u = { eq() { return u; }, in() { return u; }, select() { return Promise.resolve({ data: [{ id: "row0" }], error: null }); }, then(r) { return Promise.resolve({ error: null }).then(r); } };
        return u;
      },
      delete() {
        const d = { eq() { return d; }, in() { return d; }, then(r) { return Promise.resolve({ error: null }).then(r); } };
        return d;
      },
      then(resolve, reject) { return Promise.resolve({ data: canned[table] || [], error: null }).then(resolve, reject); },
    };
    return b;
  }
  return { from, rpc: async () => ({ data: null, error: null }), __writes: writes };
}

const STAGE_RACE_3 = { id: "race-v4-parity-otl", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", name: "Parity GP", stages: 3, stages_completed: 1 };
const STAGES_3 = STAGES.map((s, i) => ({ ...s, stage_number: i + 1 })).concat([{ ...STAGES[1], stage_number: 3, id: "sp-3" }]);

function cannedFor(extra = {}) {
  return makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    races: [{ ...STAGE_RACE_3 }],
    seasons: [{ id: "s1", number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    ...extra,
  });
}

const NOOP_DEPS = {
  recomputeRaceDays: async () => 12,
  processBoardWeekend: async () => ({}),
  applyFatigue: async () => ({ updated: 0 }),
};

/** Etape 1 kørt: alle har en række, og to ryttere er markeret ude. */
function stage1Canned() {
  return cannedFor({
    race_results: ENTRANTS.map((e, i) => ({
      stage_number: 1, result_type: "stage", rank: i + 1, rider_id: e.rider_id, team_id: e.team_id, finish_time: `+${i}:00`,
    })),
    race_simulation_runs: [{ stage_number: 1, entrant_snapshot: ENTRANTS.map((e) => e.rider_id) }],
    // Mock-.eq() er no-op, så canned data ER allerede filtreret til
    // (race_id, outcome='abandon'): ét alvorligt styrt + én tidsgrænse.
    race_incidents: [{ rider_id: "r03" }, { rider_id: "r11" }],
  });
}

async function stage2FieldWith({ v3, v4 }) {
  const supabase = stage1Canned();
  let captured = null;
  const origError = console.error;
  console.error = () => {};
  try {
    await simulateStageByIndex({
      supabase, race: { ...STAGE_RACE_3 }, stageIndex: 1,
      ...NOOP_DEPS,
      checkV3Enabled: async () => v3,
      checkV4Enabled: async () => v4,
      applyStageResult: async (_client, { resultRows }) => {
        captured = resultRows;
        return { lockWon: true, rowsImported: resultRows.length };
      },
    });
  } finally {
    console.error = origError;
  }
  return new Set(captured.filter((r) => r.result_type === "stage").map((r) => r.rider_id));
}

test("#2582/#4879 etape 2 på v4: BÅDE den udgåede og OTL-rytteren mangler i startfeltet", async () => {
  const field = await stage2FieldWith({ v3: false, v4: true });
  assert.equal(field.has("r03"), false, "udgået på etape 1 (alvorligt styrt) må ikke starte etape 2");
  assert.equal(field.has("r11"), false, "uden for tidsgrænsen på etape 1 må ikke starte etape 2");
  assert.equal(field.size, ENTRANTS.length - 2);
});

test("#4879 kontrol: uden nogen motor-gate står de to stadig på startlisten (gaten er dét der virker)", async () => {
  const field = await stage2FieldWith({ v3: false, v4: false });
  assert.equal(field.size, ENTRANTS.length, "v1-stien har ingen abandon-model — uændret adfærd");
});

// ── (3) v4's egen tidslinje persisteres under sin egen version ──────────────

test("#4879 buildStageTimelineV4 bevarer motorens events og lægger passage-/GC-laget på", () => {
  const built = buildStageTimelineV4({
    engineTimeline: {
      timeline_version: 2,
      events: [
        { km: 0, type: "stage_start", params: { field_count: 16 } },
        { km: 178, type: "sprint_decided", params: { winner_rider_id: "r01" } },
        { km: 180, type: "finish", params: { top: [], win_type: "group_finish" } },
      ],
    },
    stageProfile: STAGES[0],
    passages: [{ kind: "kom", km: 90, name: "Col", category: "2", results: [{ rider_id: "r02", points: 5 }] }],
    gc: [{ rider_id: "r02" }],
    previousGc: [{ rider_id: "r01" }],
    isStageRace: true,
  });

  assert.equal(built.timeline_version, TIMELINE_VERSION_V4);
  const types = built.events.map((e) => e.type);
  assert.deepEqual(types, ["stage_start", "kom_passage", "sprint_decided", "finish", "gc_change"]);
  // Konsistensregel 4: km monotont ikke-faldende.
  for (let i = 1; i < built.events.length; i++) {
    assert.ok(built.events[i].km >= built.events[i - 1].km, "events skal være km-sorterede");
  }
  // Motorens egne params er UÆNDREDE — broen omskriver ikke motorens sprog.
  assert.equal(built.events.find((e) => e.type === "sprint_decided").params.winner_rider_id, "r01");
});

test("#4879 en forkastet motor-tidslinje giver INGEN række i stedet for et tomt artefakt", async () => {
  assert.deepEqual(buildStageTimelineV4({ engineTimeline: null, stageProfile: STAGES[0] }).events, []);

  // Broen returnerer timeline=null når v4's egen validator (#2410 §2.3) fælder
  // motorens events. Kaldstedet må da hverken kaste eller skrive en tom række:
  // resultaterne er stadig gyldige, kun filmen mangler.
  const real = await loadRaceEngineV4();
  const rejecting = {
    version: ENGINE_VERSION_V4,
    simulateStage: (args) => ({ ...real.simulateStage(args), timeline: null }),
  };
  const run = buildRaceResults(baseArgs({ v4Engine: rejecting, timeline: true }));
  assert.deepEqual(run.timelines, [], "ingen tidslinje er bedre end en inkonsistent");
  assert.ok(run.resultRows.length > 0, "etapen kører videre — tidslinjen er additiv observation");
});

test("#4879 broens validator fælder en tidslinje der bryder §2.3, og etapen kører videre", async () => {
  const real = await loadRaceEngineV4();
  const errors = [];
  const origError = console.error;
  console.error = (msg) => errors.push(String(msg));
  let timeline;
  try {
    // Samme adapter-fabrik, men motoren udsender et event med en ukendt rytter
    // (regel "unknown-rider") — præcis den klasse fejl validatoren blev bygget
    // til og aldrig har været kaldt på i drift før nu.
    const { createRaceEngineV4Adapter } = await import("./raceEngineV4Bridge.js");
    const modules = await import("./engine/v4/timeline.ts");
    const leaky = createRaceEngineV4Adapter({
      core: { simulateStageV4: (input) => ({
        ...real.simulateStage({
          entrants: ENTRANTS, stageProfile: STAGES[0], seedString: "seed-x", stageNumber: 1,
        }).v4Output,
        timeline: { timeline_version: 2, events: [{ km: 0, type: "incident", params: { rider_id: "spoegelse" } }] },
        __input: input,
      }) },
      tuning: { RACE_V4_TUNING: {} },
      entrants: { entrantFromAbilitiesRow: (_a, o) => ({ rider_id: o.riderId }) },
      route: { routeFromStageProfileRow: () => ({ distance_km: 180, profile_type: "flat", segments: [] }) },
      orders: { buildStageOrders: () => [] },
      timeline: modules,
    });
    ({ timeline } = leaky.simulateStage({ entrants: ENTRANTS, stageProfile: STAGES[0], seedString: "seed-x", stageNumber: 1 }));
  } finally {
    console.error = origError;
  }
  assert.equal(timeline, null, "en tidslinje med en ukendt rytter må ALDRIG nå en spillerflade");
  assert.ok(errors.some((e) => e.includes("unknown-rider")), "bruddet skal larme i prod-loggen");
});

test("#4879 tidslinjen fra en RIGTIG v4-kørsel er motorens egen (version 2, ægte event-typer)", async () => {
  const v4Engine = await loadRaceEngineV4();
  const run = buildRaceResults(baseArgs({ v4Engine, timeline: true }));
  assert.ok(run.timelines.length > 0);
  for (const t of run.timelines) {
    assert.equal(t.timeline_version, TIMELINE_VERSION_V4);
    assert.ok(t.events.some((e) => e.type === "stage_start"));
    assert.ok(t.events.some((e) => e.type === "finish"));
    // Passage-laget bor UDEN for motoren og skal stadig med (ellers mister
    // løbsfilmens scrubber sine markører på hver eneste v4-etape).
    assert.ok(t.events.some((e) => e.type === "intermediate_sprint"), "mellemspurten skal være med");
  }
  // Motorens gruppe-lag: gap_update bærer group_id, som v3 aldrig havde.
  const gapUpdate = run.timelines.flatMap((t) => t.events).find((e) => e.type === "gap_update");
  if (gapUpdate) assert.ok("group_id" in gapUpdate.params, "v4's gap-kurve er gruppe-baseret, ikke syntetisk");
});

// ── (4) engine_version 4: neutral, men ikke tom fortælling ──────────────────

test("#4879 v4 giver mindst vinderen + udfaldstypen, og ALDRIG et komponent-afledt moment", async () => {
  const v4Engine = await loadRaceEngineV4();
  const run = buildRaceResults(baseArgs({ v4Engine }));
  assert.ok(run.runs.every((r) => r.engine_version === ENGINE_VERSION_V4));

  const keys = new Set(run.moments.map((m) => m.moment_key));
  const winKeys = ["sprint_win", "close_win", "solo_win", "itt_win", "ttt_win"];
  assert.ok(winKeys.some((k) => keys.has(k)), `fortællingen skal navngive vinderen og hvordan: ${[...keys]}`);

  // Fog-of-war + ærlighed: v4 producerer ingen score-komponenter, ingen
  // dagsform og læser hverken effort eller peaks endnu. Momenter der påstår
  // andet må ALDRIG optræde under v4.
  for (const forbidden of [
    "favorite_off_day", "tag_favorite_collapse", "tag_outsider_win", "dayform_line",
    "tag_jour_sans", "tag_peak_day", "tag_perfect_peak", "form_peak",
    "helper_shift", "tag_helper_sacrifice", "tag_saved_effort", "tag_gave_everything",
    "tag_aggression_no_cost",
  ]) {
    assert.equal(keys.has(forbidden), false, `${forbidden} kræver data v4 ikke producerer`);
  }

  // Vindermomentet peger på den rytter der FAKTISK vandt etape 1.
  const stage1Winner = run.resultRows.find((r) => r.result_type === "stage" && r.stage_number === 1 && r.rank === 1);
  const stage1Win = run.moments.find((m) => m.stage_number === 1 && winKeys.includes(m.moment_key));
  assert.equal(stage1Win.params.riderId, stage1Winner.rider_id);
});

test("#4879 stage-by-stage-stien giver SAMME fortælling og motorstempel som whole-race-stien", async () => {
  const v4Engine = await loadRaceEngineV4();
  const whole = buildRaceResults(baseArgs({ v4Engine }));
  const stage1 = buildStageRowsAccumulated({
    race: RACE, stagesSorted: STAGES, stageIndex: 0, entrants: ENTRANTS, pointsLookup: {},
    priorStageRows: [], v3: true, v4Engine,
  });
  assert.equal(stage1.runs[0].engine_version, ENGINE_VERSION_V4);
  assert.deepEqual(
    stage1.moments.map((m) => m.moment_key),
    whole.moments.filter((m) => m.stage_number === 1).map((m) => m.moment_key),
  );
});
