// Løbsmotor v4 — flip-infrastruktur, broen (#3855, #4707).
//
// Dækker de fire garantier PR'en hviler på:
//   1. Flag OFF ⇒ v4 er ikke engang indlæst (statisk vagt + doven import).
//   2. v4's output oversættes til PRÆCIS v3's `ranked`-form.
//   3. Determinisme: samme etape to gange giver samme rækker.
//   4. Ydelse: én etape med 180 ryttere skal kunne nå at køre inden næste hele time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ENGINE_VERSION_V4,
  breakawayRiderIdsFromSnapshots,
  buildV4StageInput,
  raceContextForStage,
  createRaceEngineV4Adapter,
  loadRaceEngineV4,
  loadTeamOrderRows,
  passagesFromV4Output,
  rankedFromV4Output,
  stageHasPassageRouteData,
  __resetRaceEngineV4Cache,
} from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Fixtures ────────────────────────────────────────────────────────────────

function abilities(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

/** Realistisk startfelt: `size` ryttere fordelt på hold à 8 (som et rigtigt løb). */
function makeEntrants(size) {
  return Array.from({ length: size }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    team_id: `team${Math.floor(i / 8)}`,
    abilities: abilities(i),
    race_role: "free_role",
    effort: "normal",
    fatigue: (i * 3) % 40,
  }));
}

/** race_stage_profiles-række uden gemte segmenter → routeAdapter syntetiserer dem. */
function stageProfile(overrides = {}) {
  return {
    race_id: "race-v4-test",
    id: "sp-1",
    stage_number: 1,
    profile_type: "mountain",
    finale_type: "long_climb",
    distance_km: 178,
    climbs: [
      { name: "Col A", crest_km: 92, category: "2" },
      { name: "Col B", crest_km: 168, category: "1", summit_finish: true },
    ],
    sprints: [{ name: "Sprint", km: 60, kind: "intermediate" }],
    ...overrides,
  };
}

// ── 1. Flag OFF ⇒ v4 er ikke indlæst ────────────────────────────────────────

test("#3855 flag-off-garanti: hverken raceRunner eller broen importerer v4-kernen STATISK", () => {
  const files = ["raceRunner.js", "raceEngineV4Bridge.js"];
  for (const name of files) {
    const src = readFileSync(join(HERE, name), "utf8");
    // Statiske ESM-imports af v4 ville køre modulet ved boot — så ville
    // "flag off = ingen v4-import" være en påstand, ikke en garanti.
    const staticV4Import = /^\s*import\s[^;]*from\s+["'][^"']*engine\/v4[^"']*["']/m.test(src);
    assert.equal(staticV4Import, false, `${name} har et STATISK import af engine/v4 — kun dynamisk import er tilladt`);
  }
});

test("#3855 flag-off-garanti: loadRaceEngineV4 importerer først når den kaldes, og cacher derefter", async () => {
  __resetRaceEngineV4Cache();
  const specs = [];
  const importModule = async (spec) => {
    specs.push(spec);
    return { simulateStageV4: () => {}, RACE_V4_TUNING: {}, entrantFromAbilitiesRow: () => {}, routeFromStageProfileRow: () => {}, buildStageOrders: () => [] };
  };

  assert.equal(specs.length, 0, "intet må være importeret før første kald");
  const engine = await loadRaceEngineV4({ importModule });
  assert.equal(specs.length, 6, "kernen + tuning + de tre adaptere + timeline-validatoren (#4879)");
  assert.ok(specs.every((s) => s.includes("engine/v4")));
  assert.equal(engine.version, ENGINE_VERSION_V4);

  await loadRaceEngineV4({ importModule });
  assert.equal(specs.length, 6, "andet kald skal ramme cachen, ikke importere igen");
  __resetRaceEngineV4Cache();
});

test("#3855: en fejlet indlæsning forgifter IKKE cachen (næste afvikling kan prøve igen)", async () => {
  __resetRaceEngineV4Cache();
  let attempts = 0;
  const failing = async () => { attempts += 1; throw new Error("boom"); };
  await assert.rejects(() => loadRaceEngineV4({ importModule: failing }));
  await assert.rejects(() => loadRaceEngineV4({ importModule: failing }));
  assert.equal(attempts >= 2, true, "andet kald skal forsøge igen, ikke returnere den cachede fejl");
  __resetRaceEngineV4Cache();
});

// ── 2. Output-mapping: v4 → v3's ranked-form ───────────────────────────────

test("#3855 rankedFromV4Output: gap til vinderen, 1..N uden huller, team_id vedhæftet", () => {
  const output = {
    results: [
      { rider_id: "a", rank: 1, time_seconds: 14400.4, group_id: "g1", status: "finished" },
      { rider_id: "b", rank: 2, time_seconds: 14403.6, group_id: "g1", status: "finished" },
      { rider_id: "c", rank: 3, time_seconds: 14460, group_id: "g2", status: "finished" },
    ],
    groupSnapshots: [{ km: 50, groups: [{ group_id: "g1", kind: "breakaway", rider_ids: ["b"], gap_seconds: 0 }] }],
  };
  const ranked = rankedFromV4Output(output, { teamIdByRider: new Map([["a", "T1"], ["b", "T2"]]) });

  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
  assert.deepEqual(ranked.map((r) => r.stageGap), [0, 3, 60]);
  assert.deepEqual(ranked.map((r) => r.team_id), ["T1", "T2", null]);
  // #1499-konventionen nedstrøms (deriveBreakawayStatus/computePassages) læser
  // components.breakaway > 0 — broen sætter netop dét felt, intet andet.
  assert.deepEqual(ranked.map((r) => r.components.breakaway), [0, 1, 0]);
  assert.deepEqual(Object.keys(ranked[0]).sort(), ["components", "rank", "rider_id", "stageGap", "team_id"]);
});

test("#5577 rankedFromV4Output: vinderens række bærer finish-eventets sejrstype og motorens udbrudsdom", () => {
  const output = {
    results: [
      { rider_id: "a", rank: 1, time_seconds: 100, group_id: "g1", status: "finished" },
      { rider_id: "b", rank: 2, time_seconds: 103, group_id: "g2", status: "finished" },
    ],
    timeline: { events: [{ km: 150, type: "finish", params: { top: [{ rider_id: "a", rank: 1, gap: 0 }], win_type: "solo_win" } }] },
  };
  const ranked = rankedFromV4Output(output, { breakawayWin: true });
  assert.equal(ranked[0].win_type, "solo_win");
  assert.equal(ranked[0].breakaway_win, true);
  assert.deepEqual(Object.keys(ranked[1]).sort(), ["components", "rank", "rider_id", "stageGap", "team_id"], "kun vinderens række");
  assert.equal("win_type" in ranked[0].components, false, "ingen score-komponent opdigtes");
});

test("#5577 rankedFromV4Output: ingen sejrstype når finish-eventets vinder ikke er rækkens vinder", () => {
  // Vinderen er udgået (M10) og filtreret fra: finish-eventet taler om en anden rytter.
  const ranked = rankedFromV4Output({
    results: [
      { rider_id: "a", rank: 1, time_seconds: 100, group_id: "g1", status: "abandoned" },
      { rider_id: "b", rank: 2, time_seconds: 103, group_id: "g1", status: "finished" },
    ],
    timeline: { events: [{ km: 150, type: "finish", params: { top: [{ rider_id: "a", rank: 1, gap: 0 }], win_type: "close_win" } }] },
  }, { breakawayWin: true });
  assert.equal(ranked[0].rider_id, "b");
  assert.equal("win_type" in ranked[0], false);
  assert.equal("breakaway_win" in ranked[0], false, "motorens udbrudsdom gælder a, ikke b");
});

test("#5577 rankedFromV4Output: ukendt udbrudsdom (null, fx tidskørsel) stemples ikke", () => {
  const ranked = rankedFromV4Output({
    results: [{ rider_id: "a", rank: 1, time_seconds: 100, group_id: "g1", status: "finished" }],
    timeline: { events: [{ km: 30, type: "finish", params: { top: [{ rider_id: "a", rank: 1, gap: 0 }], win_type: "itt_win" } }] },
  }, { breakawayWin: null });
  assert.equal(ranked[0].win_type, "itt_win");
  assert.equal("breakaway_win" in ranked[0], false);
});

test("#5577 adapteren (ægte motor): vinderens sejrstype er en kendt nøgle, aldrig pladsholderen", async () => {
  __resetRaceEngineV4Cache();
  const engine = await loadRaceEngineV4();
  const result = engine.simulateStage({
    entrants: makeEntrants(40), stageProfile: stageProfile(), seedString: "race-v4-test:5577", stageNumber: 1, teamOrderRows: [],
  });
  const finish = result.v4Output.timeline.events.find((e) => e.type === "finish");
  assert.ok(["sprint_win", "close_win", "solo_win"].includes(finish.params.win_type), `fik ${finish.params.win_type}`);
  assert.equal(result.ranked[0].win_type, finish.params.win_type);
  assert.equal(typeof result.ranked[0].breakaway_win, "boolean", "en vejetape har altid en udbrudsdom");
});

test("#3855 rankedFromV4Output: abandoned udelades og efterlader ingen huller i rangeringen", () => {
  const ranked = rankedFromV4Output({
    results: [
      { rider_id: "a", rank: 1, time_seconds: 100, group_id: "g", status: "finished" },
      { rider_id: "b", rank: 2, time_seconds: 110, group_id: "g", status: "abandoned" },
      { rider_id: "c", rank: 3, time_seconds: 130, group_id: "g", status: "finished" },
    ],
  });
  assert.deepEqual(ranked.map((r) => r.rider_id), ["a", "c"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
  assert.deepEqual(ranked.map((r) => r.stageGap), [0, 30]);
});

test("#3855 rankedFromV4Output: gap clampes til sikkerhedsloftet (30 min), som v3", () => {
  const ranked = rankedFromV4Output({
    results: [
      { rider_id: "a", rank: 1, time_seconds: 0, group_id: "g", status: "finished" },
      { rider_id: "z", rank: 2, time_seconds: 99_999, group_id: "g", status: "finished" },
    ],
  });
  assert.equal(ranked[1].stageGap, 1800);
});

test("#3855 breakawayRiderIdsFromSnapshots: kun grupper med kind='breakaway' tæller", () => {
  const ids = breakawayRiderIdsFromSnapshots([
    { km: 10, groups: [{ kind: "breakaway", rider_ids: ["a", "b"] }, { kind: "peloton", rider_ids: ["c"] }] },
    { km: 90, groups: [{ kind: "chase", rider_ids: ["d"] }] },
  ]);
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("#3855/#4246 buildV4StageInput: adapteren får startlistens roller, ikke bare hold-id'er", () => {
  const modules = {
    route: { routeFromStageProfileRow: () => ({ distance_km: 10, segments: [], waypoints: [] }) },
    entrants: { entrantFromAbilitiesRow: (row, opts) => ({ rider_id: opts.riderId, condition: opts.condition }) },
    tuning: { RACE_V4_TUNING: { marker: true } },
    orders: {
      buildStageOrderPlan: (args) => ({ orders: args, aiEffortByRider: new Map() }),
    },
  };
  const input = buildV4StageInput({
    modules,
    entrants: [
      { rider_id: "a", team_id: "T2", race_role: "hunter", abilities: {}, fatigue: 0 },
      { rider_id: "b", team_id: "T1", race_role: "captain", abilities: {}, fatigue: 100 },
      { rider_id: "c", team_id: null, abilities: {}, fatigue: 50 },
    ],
    stageProfile: stageProfile(),
    seedString: "race:1",
    stageNumber: 1,
    teamOrderRows: [{ team_id: "T1", stage_number: 1, breakaway_stance: "chase", riders: [] }],
  });

  assert.equal(input.seed, "race:1");
  assert.deepEqual(input.tuning, { marker: true });
  // #4246: rollen ER standardordren, så adapteren skal have (hold, rytter, rolle).
  // Ryttere uden hold hører ikke til en holdplan og sendes ikke med.
  assert.deepEqual(input.orders.roster, [
    { team_id: "T2", rider_id: "a", role: "hunter", is_ai: false, abilities: {} },
    { team_id: "T1", rider_id: "b", role: "captain", is_ai: false, abilities: {} },
  ]);
  assert.equal(input.orders.stageNumber, 1);
  assert.equal(input.orders.rows.length, 1);
  // Uden løbets etaper er løbet ukendt for M14 (#5571).
  assert.equal(input.orders.context.race, undefined);
  // fatigue 0-100 → condition 1-0.
  assert.deepEqual(input.startlist.map((e) => e.condition), [1, 0, 0.5]);
});

// ── #5571: AI-holdene får M14's taktik gennem broen ────────────────────────

test("#5571 raceContextForStage: etapeløb + senere etapers rute-type, i kørselsorden", () => {
  const ctx = raceContextForStage({
    raceStages: [
      { stage_number: 3, profile_type: "flat", finale_type: "bunch_sprint" },
      { stage_number: 1, profile_type: "itt", finale_type: "solo_tt" },
      { stage_number: 2, profile_type: "mountain", finale_type: "long_climb" },
    ],
    stageNumber: 1,
    isStageRace: true,
    routeFromStageProfileRow: (row) => ({ profile_type: row.profile_type, finale_type: row.finale_type }),
  });
  assert.deepEqual(ctx, {
    is_stage_race: true,
    later_stages: [
      { profile_type: "mountain", finale_type: "long_climb" },
      { profile_type: "flat", finale_type: "bunch_sprint" },
    ],
  });
  assert.equal(raceContextForStage({ raceStages: null, stageNumber: 1, isStageRace: true, routeFromStageProfileRow: () => ({}) }), undefined);
});

test("#5571 buildV4StageInput (rigtige adaptere): AI-holdets indsats lander på Entrant.effort, menneskets gør ikke", async () => {
  const [entrantsMod, routeMod, ordersMod] = await Promise.all([
    import("./engine/v4/adapters/entrantAdapter.ts"),
    import("./engine/v4/adapters/routeAdapter.ts"),
    import("./engine/v4/orders/teamOrdersAdapter.ts"),
  ]);
  const modules = { entrants: entrantsMod, route: routeMod, orders: ordersMod, tuning: { RACE_V4_TUNING: {} } };
  const team = (teamId, isAi) => [
    { rider_id: `${teamId}-cap`, team_id: teamId, race_role: "captain", abilities: { climbing: 60, sprint: 10 }, fatigue: 0, team_is_ai: isAi },
    { rider_id: `${teamId}-spr`, team_id: teamId, race_role: "sprint_captain", abilities: { climbing: 5, sprint: 60 }, fatigue: 0, team_is_ai: isAi },
    { rider_id: `${teamId}-dom`, team_id: teamId, race_role: "helper", abilities: { climbing: 45, sprint: 10 }, fatigue: 0, team_is_ai: isAi },
  ];
  const others = Array.from({ length: 20 }, (_, i) => ({
    rider_id: `o${i}`, team_id: `o${i}`, race_role: "free_role", abilities: { climbing: 5 + i, sprint: 5 + i }, fatigue: 0,
  }));
  const mountain = { stage_number: 1, profile_type: "mountain", finale_type: "long_climb", distance_km: 150 };
  const flat = { stage_number: 2, profile_type: "flat", finale_type: "bunch_sprint", distance_km: 180 };
  const input = buildV4StageInput({
    modules,
    entrants: [...team("ai", true), ...team("hum", undefined), ...others],
    stageProfile: mountain,
    seedString: "race:5571:1",
    stageNumber: 1,
    isStageRace: true,
    raceStages: [mountain, flat],
  });
  const effort = new Map(input.startlist.map((e) => [e.rider_id, e.effort]));
  // Sidste bjergetape i etapeløbet: kaptajnen alt ud, hjælperen ved ham, sprinteren i grupettoen.
  assert.equal(effort.get("ai-cap"), "all_out");
  assert.equal(effort.get("ai-dom"), "protect");
  assert.equal(effort.get("ai-spr"), "grupetto");
  // Menneskeholdet: ingen autopilot, rollens standard.
  assert.equal(effort.get("hum-cap"), "normal");
  assert.equal(effort.get("hum-spr"), "normal");
  const aiOrder = input.orders.find((o) => o.team_id === "ai" && o.kind === "team_tactics");
  assert.equal(aiOrder.params.breakaway_stance, "chase");
  const humOrder = input.orders.find((o) => o.team_id === "hum" && o.kind === "team_tactics");
  assert.equal(humOrder.params.breakaway_stance, "neutral");
});

// ── 3. Determinisme (rigtig motor) ─────────────────────────────────────────

test("#3855 determinisme: samme etape kørt to gange giver byte-identiske rækker", async () => {
  __resetRaceEngineV4Cache();
  const engine = await loadRaceEngineV4();
  const entrants = makeEntrants(60);
  const args = { entrants, stageProfile: stageProfile(), seedString: "race-v4-test:1", stageNumber: 1, teamOrderRows: [] };
  const a = engine.simulateStage(args);
  const b = engine.simulateStage(args);
  assert.equal(JSON.stringify(a.ranked), JSON.stringify(b.ranked));
  assert.equal(a.ranked.length, 60);
  assert.deepEqual(a.incidents, [], "v4 har ingen uheldsmekanik endnu — broen må aldrig opfinde en");
});

test("#3855 adapteren afviser tomt felt og tomt seed (fejl skal komme FØR motoren)", () => {
  const engine = createRaceEngineV4Adapter({ core: {}, tuning: {}, entrants: {}, route: {}, orders: {} });
  assert.throws(() => engine.simulateStage({ entrants: [], stageProfile: {}, seedString: "x", stageNumber: 1 }), /entrants/);
  assert.throws(() => engine.simulateStage({ entrants: [{ rider_id: "a" }], stageProfile: {}, seedString: "", stageNumber: 1 }), /seedString/);
});

// ── loadTeamOrderRows: en korrupt/utilgængelig tabel må aldrig vælte et løb ──

test("#3855 loadTeamOrderRows: DB-fejl → tom liste (motoren kræver ALDRIG ordrer)", async () => {
  const supabase = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "nope" } }) }) }) };
  assert.deepEqual(await loadTeamOrderRows({ supabase, raceId: "r1" }), []);
});

test("#3855 loadTeamOrderRows: rækker returneres med team_id som streng", async () => {
  const supabase = {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ team_id: 7, stage_number: 2, breakaway_stance: "chase", riders: [] }], error: null }) }) }),
  };
  const rows = await loadTeamOrderRows({ supabase, raceId: "r1" });
  assert.equal(rows[0].team_id, "7");
});

// ── 4. Ydelse ──────────────────────────────────────────────────────────────

test("#3855 ydelse: én v4-etape med 180 ryttere på en realistisk bjergrute", async () => {
  __resetRaceEngineV4Cache();
  const engine = await loadRaceEngineV4();
  const entrants = makeEntrants(180);
  const args = { entrants, stageProfile: stageProfile(), seedString: "race-v4-perf:1", stageNumber: 1, teamOrderRows: [] };
  engine.simulateStage(args); // varm JIT'en op — vi måler den stationære pris
  const t0 = performance.now();
  const out = engine.simulateStage(args);
  const ms = performance.now() - t0;
  console.log(`  ⏱  v4, 180 ryttere, 178 km bjergetape: ${ms.toFixed(1)} ms`);
  assert.equal(out.ranked.length, 180);
  // Etaper afvikles hver hele time. Én etape må ikke nærme sig det budget —
  // loftet er bevidst LØST (ingen flaky CI-gate), men fanger en katastrofal
  // regression der ville gøre flippet umuligt.
  assert.ok(ms < 60_000, `én etape tog ${ms.toFixed(0)} ms — over 60 s er en flip-blokker`);
});

// ── 5. Passage-laget (#2770/#2413, ejer-beslutning 6/9) ─────────────────────
//
// "v4's egen mekanik er eneste kilde når v4 er on" er en DOBBELT-tildelings-
// garanti: broen skal levere passagerne, og raceRunner skal springe det gamle
// lag over. Testene her låser den første halvdel; raceRunner.test.js den anden.

test("#2770 stageHasPassageRouteData: samme data-gate som computePassages (#2784)", () => {
  assert.equal(stageHasPassageRouteData({ distance_km: 180 }), true);
  assert.equal(stageHasPassageRouteData({ distance_km: null, climbs: [{ crest_km: 10 }] }), true);
  assert.equal(stageHasPassageRouteData({ distance_km: null, sprints: [{ km: 10 }] }), true);
  // Legacy-række: hverken distance, stigninger eller spurter → ikke en rute.
  assert.equal(stageHasPassageRouteData({ distance_km: null, climbs: [], sprints: [] }), false);
  assert.equal(stageHasPassageRouteData({ distance_km: 0 }), false);
});

test("#2770 passagesFromV4Output: computePassages-formen, direkte fra motorens output", () => {
  const out = {
    passages: [{ kind: "sprint", index: 0, name: "Spurt", km: 60, category: null, results: [] }],
    passage_totals: [{ rider_id: "a", sprint_points: 20, kom_points: 5, bonus_seconds: 3 }],
  };
  const passage = passagesFromV4Output(out, { stageProfile: stageProfile(), isStageRace: true });
  assert.equal(passage.passages.length, 1);
  assert.deepEqual(passage.perRider.get("a"), { sprint_points: 20, kom_points: 5, bonus_seconds: 3 });
  assert.equal(passage.perRider.get("ukendt"), undefined, "perRider er et Map som v3's, ikke et objekt");
});

test("#2770 passagesFromV4Output: endagsløb og rutedata-løse etaper falder tilbage til det gamle lag", () => {
  const out = { passages: [{ kind: "finish", index: 0, name: "Maal", km: 1, category: null, results: [] }], passage_totals: [] };
  assert.equal(passagesFromV4Output(out, { stageProfile: stageProfile(), isStageRace: false }), null);
  assert.equal(
    passagesFromV4Output(out, { stageProfile: { distance_km: null, climbs: [], sprints: [] }, isStageRace: true }),
    null,
  );
});

test("#2770 adapteren leverer v4's egne passager på en etapeløbs-etape (ægte motor)", async () => {
  __resetRaceEngineV4Cache();
  const engine = await loadRaceEngineV4();
  const { passages, v4Output } = engine.simulateStage({
    entrants: makeEntrants(60),
    stageProfile: stageProfile(),
    seedString: "race-v4-passages:1",
    stageNumber: 1,
    teamOrderRows: [],
    isStageRace: true,
  });
  assert.ok(passages, "broen skal levere v4's passage-lag for en etapeløbs-etape");
  // Ruten har én indlagt spurt, to stigninger (den ene summit_finish) og et mål.
  assert.deepEqual(
    passages.passages.map((p) => p.kind),
    ["sprint", "kom", "kom", "finish"],
    "alle fire vejpunkter skal give en passage",
  );
  assert.deepEqual(passages.passages, v4Output.passages, "broen må ikke omforme motorens passager");
  const totals = [...passages.perRider.values()];
  assert.ok(totals.some((t) => t.bonus_seconds > 0), "ingen bonussekunder nåede ud af motoren");
  assert.ok(totals.some((t) => t.kom_points > 0), "ingen bjergpoint nåede ud af motoren");
  assert.ok(totals.every((t) => t.bonus_seconds <= 10 + 1e-9), "per-rytter-loftet (#2413) skal holde helt ud i broen");
});

test("#2770 adapteren leverer INGEN passager på et endagsløb (dobbelt-tildeling umulig)", async () => {
  __resetRaceEngineV4Cache();
  const engine = await loadRaceEngineV4();
  const { passages } = engine.simulateStage({
    entrants: makeEntrants(30),
    stageProfile: stageProfile(),
    seedString: "race-v4-passages:2",
    stageNumber: 1,
    teamOrderRows: [],
    isStageRace: false,
  });
  assert.equal(passages, null);
});
