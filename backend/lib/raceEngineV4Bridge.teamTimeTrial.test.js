// Løbsmotor v4 — broen genkender holdtidskørslen (#3463, #2412, #3855).
//
// Egen fil (ikke en tilføjelse til raceEngineV4Bridge.test.js) fordi flere
// paritets-laner rører broens testfil samtidig; her er der intet at rebase.
//
// Det den beviser er præcis #3463's fund: før M13-wiringen "ville ni ryttere
// fra samme hold hver få deres egen tid" på en TTT-etape, fordi `ttt` faldt
// igennem til enkeltstarts-vejen. Broen leverer allerede begge halvdele —
// `profile_type` gennem routeAdapter og `team_id` gennem entrantAdapter (M16,
// #4246) — så testen måler at kæden ude fra en race_stage_profiles-række og
// ind til `ranked` faktisk holder hele vejen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildV4StageInput, createRaceEngineV4Adapter, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";

const TEAM_SIZE = 9; // #3463's egen formulering: "ni ryttere fra samme hold"
const TEAMS = 6;

function abilities(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

/** Startfelt med ægte holdstruktur — hold à ni, spredte evner inden for holdet. */
function makeEntrants() {
  const out = [];
  for (let t = 0; t < TEAMS; t++) {
    for (let i = 0; i < TEAM_SIZE; i++) {
      out.push({
        rider_id: `t${t}r${i}`,
        team_id: `team${t}`,
        abilities: abilities(t * 17 + i * 5),
        race_role: "free_role",
        effort: "normal",
        fatigue: (t * 7 + i * 3) % 40,
      });
    }
  }
  return out;
}

/** race_stage_profiles-række. `ttt` og `itt` deler finale_type "solo_tt". */
function stageProfile(profileType) {
  return {
    race_id: "race-v4-ttt-test",
    id: `sp-${profileType}`,
    stage_number: 4,
    profile_type: profileType,
    finale_type: "solo_tt",
    distance_km: 42,
    climbs: [],
    sprints: [],
  };
}

async function runStage(profileType) {
  const modules = await loadRaceEngineV4();
  return modules.simulateStage({
    entrants: makeEntrants(),
    stageProfile: stageProfile(profileType),
    seedString: "race-v4-ttt-test:4",
    stageNumber: 4,
    teamOrderRows: [],
  });
}

test("#3463: broen kører en ttt-etape som holdtidskørsel — ét hold, én tid", async () => {
  const { ranked } = await runStage("ttt");
  assert.equal(ranked.length, TEAMS * TEAM_SIZE, "hele startfeltet skal have en etaperække");

  const timesByTeam = new Map();
  for (const row of ranked) {
    if (!timesByTeam.has(row.team_id)) timesByTeam.set(row.team_id, new Set());
    timesByTeam.get(row.team_id).add(row.stageGap);
  }
  assert.equal(timesByTeam.size, TEAMS);
  for (const [teamId, gaps] of timesByTeam) {
    assert.equal(gaps.size, 1, `${teamId} har ${gaps.size} forskellige etape-gaps — TTT giver ÉN holdtid`);
  }
  // ...og holdene står ikke alle på samme tid (så testen ovenfor ikke består
  // trivielt af at ingen tabte tid overhovedet).
  const distinctTeamGaps = new Set([...timesByTeam.values()].map((s) => [...s][0]));
  assert.ok(distinctTeamGaps.size > 1, "alle hold fik samme tid — etapen afgjorde ingenting");
});

test("samme rute som itt splitter holdet — broen skelner PÅ profile_type, ikke finale_type", async () => {
  const { ranked } = await runStage("itt");
  const gapsPerTeam = new Map();
  for (const row of ranked) {
    if (!gapsPerTeam.has(row.team_id)) gapsPerTeam.set(row.team_id, new Set());
    gapsPerTeam.get(row.team_id).add(row.stageGap);
  }
  const split = [...gapsPerTeam.values()].filter((s) => s.size > 1).length;
  assert.ok(split > 0, "enkeltstarten gav hvert hold ÉN fælles tid — den er faldet i TTT-grenen");
});

test("broen: ttt-etapen giver en gyldig tidslinje der faktisk persisteres", async () => {
  const { timeline } = await runStage("ttt");
  assert.ok(timeline, "tidslinjen blev kasseret — den brød motorens egen validator");
  assert.equal(timeline.timeline_version, 2);
  const finish = timeline.events.find((e) => e.type === "finish");
  assert.equal(finish?.params?.win_type, "ttt_win");
  assert.ok(
    timeline.events.some((e) => e.type === "ttt_team_result"),
    "holdenes officielle tider mangler i tidslinjen",
  );
});

test("broen: ingen uheldsrækker og ingen OTL på en TTT (M10/M15 rører ikke holdtidskørslen)", async () => {
  const { incidents } = await runStage("ttt");
  assert.deepEqual(incidents, []);
});

test("broen: determinisme — samme etape to gange giver identiske rækker", async () => {
  const a = await runStage("ttt");
  const b = await runStage("ttt");
  assert.deepEqual(a.ranked, b.ranked);
  assert.deepEqual(a.timeline, b.timeline);
});

test("buildV4StageInput bærer både profile_type ttt og team_id videre til kernen", async () => {
  const modules = await loadRaceEngineV4();
  // loadRaceEngineV4 returnerer adapteren, ikke modul-sættet — byg input via
  // de samme moduler ad den vej createRaceEngineV4Adapter selv bruger.
  assert.equal(typeof modules.simulateStage, "function");

  const raw = await import("./engine/v4/index.ts");
  const tuning = await import("./engine/v4/tuning.ts");
  const entrants = await import("./engine/v4/adapters/entrantAdapter.ts");
  const routeMod = await import("./engine/v4/adapters/routeAdapter.ts");
  const orders = await import("./engine/v4/orders/teamOrdersAdapter.ts");
  const input = buildV4StageInput({
    modules: { core: raw, tuning, entrants, route: routeMod, orders },
    entrants: makeEntrants(),
    stageProfile: stageProfile("ttt"),
    seedString: "race-v4-ttt-test:4",
    stageNumber: 4,
  });
  assert.equal(input.route.profile_type, "ttt");
  assert.equal(new Set(input.startlist.map((e) => e.team_id)).size, TEAMS);
});

test("adapter-kontrakten er uændret: engine_version 4 og samme simulateStage-form", () => {
  const engine = createRaceEngineV4Adapter({ core: {}, tuning: {}, entrants: {}, route: {}, orders: {} });
  assert.equal(engine.version, 4);
  assert.equal(typeof engine.simulateStage, "function");
});
