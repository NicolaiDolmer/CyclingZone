import test from "node:test";
import assert from "node:assert/strict";
import { buildFinalKilometrePlayback, countdownAt, COUNTDOWN_MS, ARRIVALS_MS } from "./finalKilometre.js";

function riderRow({ id, rank, finish_time, in_breakaway = false, breakaway_caught = false, rider_id = id, firstname = "R", lastname = id, team_id = "t1", team_name = "Team" }) {
  return {
    id, rank, result_type: "stage", stage_number: 1, rider_id, finish_time, in_breakaway, breakaway_caught,
    team_id, team_name,
    rider: { id: rider_id, firstname, lastname, nationality_code: "DK", team: { id: team_id, name: team_name } },
  };
}

test("mindre end 2 rytter-rækker → ikke tilgængelig (degraderer ærligt)", () => {
  assert.deepEqual(buildFinalKilometrePlayback({ rows: [] }), { available: false });
  assert.deepEqual(
    buildFinalKilometrePlayback({ rows: [riderRow({ id: "1", rank: 1, finish_time: "+0:00" })] }),
    { available: false },
  );
});

test("deterministisk: samme input giver samme tidslinje ved gentagne kald", () => {
  const rows = [
    riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
    riderRow({ id: "2", rank: 2, finish_time: "+0:03" }),
    riderRow({ id: "3", rank: 3, finish_time: "+0:18" }),
  ];
  const a = buildFinalKilometrePlayback({ rows, stageNumber: 4 });
  const b = buildFinalKilometrePlayback({ rows, stageNumber: 4 });
  assert.deepEqual(a, b);
});

test("rækkefølge følger rank, ikke input-orden", () => {
  const rows = [
    riderRow({ id: "2", rank: 2, finish_time: "+0:05" }),
    riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
    riderRow({ id: "3", rank: 3, finish_time: "+0:40" }),
  ];
  const p = buildFinalKilometrePlayback({ rows });
  assert.deepEqual(p.riders.map((r) => r.id), ["1", "2", "3"]);
  assert.equal(p.riders[0].atMs, 0);
  // ankomsttidspunkter er strengt stigende (ingen omvendt rækkefølge).
  for (let i = 1; i < p.riders.length; i++) assert.ok(p.riders[i].atMs >= p.riders[i - 1].atMs);
});

test("fotofinish: et almindeligt sekund-gab (>=1s) markeres IKKE", () => {
  const rows = [
    riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
    riderRow({ id: "2", rank: 2, finish_time: "+0:03" }),
    riderRow({ id: "3", rank: 3, finish_time: "+0:12" }),
  ];
  const p = buildFinalKilometrePlayback({ rows });
  assert.equal(p.riders[1].photoFinish, false);
  assert.equal(p.riders[2].photoFinish, false);
  assert.equal(p.photoFinishWin, false);
});

test("fotofinish-flag + photoFinishWin sættes korrekt for et reelt <1s-gab", () => {
  const rows = [
    riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
    riderRow({ id: "2", rank: 2, finish_time: "+0:00" }), // samme registrerede sekund = under tærsklen
    riderRow({ id: "3", rank: 3, finish_time: "+0:15" }),
  ];
  const p = buildFinalKilometrePlayback({ rows });
  assert.equal(p.photoFinishWin, true);
  assert.equal(p.riders[1].photoFinish, true);
  assert.equal(p.riders[2].photoFinish, false);
});

test("overflow: felt større end MAX_ANIMATED_RIDERS opsummeres", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    riderRow({ id: String(i + 1), rank: i + 1, finish_time: i === 0 ? "+0:00" : `+0:${String(i * 5).padStart(2, "0")}` }));
  const p = buildFinalKilometrePlayback({ rows });
  assert.equal(p.riders.length, 8);
  assert.equal(p.overflowCount, 4);
  assert.equal(p.totalFinishers, 12);
});

test("store gab komprimeres proportionalt så ankomster holder sig inden for ARRIVALS_MS-budgettet", () => {
  const rows = [
    riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
    riderRow({ id: "2", rank: 2, finish_time: "+8:00" }), // grupetto langt bagude
    riderRow({ id: "3", rank: 3, finish_time: "+9:00" }),
  ];
  const p = buildFinalKilometrePlayback({ rows });
  for (const r of p.riders) assert.ok(r.atMs <= ARRIVALS_MS);
});

test("vind-type: bruger race_stage_moments når til stede", () => {
  const rows = [
    riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
    riderRow({ id: "2", rank: 2, finish_time: "+0:20" }),
  ];
  const moments = [{ stage_number: 1, moment_key: "close_win", params: {} }];
  const p = buildFinalKilometrePlayback({ rows, moments, stageNumber: 1 });
  assert.equal(p.winType, "close_win");
});

test("vind-type: falder tilbage til 2-tier-gab-grænse uden moments (ældre løb)", () => {
  const solo = buildFinalKilometrePlayback({
    rows: [riderRow({ id: "1", rank: 1, finish_time: "+0:00" }), riderRow({ id: "2", rank: 2, finish_time: "+0:15" })],
    moments: [],
  });
  assert.equal(solo.winType, "solo_win");
  const sprint = buildFinalKilometrePlayback({
    rows: [riderRow({ id: "1", rank: 1, finish_time: "+0:00" }), riderRow({ id: "2", rank: 2, finish_time: "+0:02" })],
    moments: [],
  });
  assert.equal(sprint.winType, "sprint_win");
});

test("vind-type null når finish_time helt mangler (gamle PCM-løb)", () => {
  const p = buildFinalKilometrePlayback({
    rows: [riderRow({ id: "1", rank: 1, finish_time: "" }), riderRow({ id: "2", rank: 2, finish_time: "" })],
    moments: [],
  });
  assert.equal(p.winType, null);
  // ingen gap-data → jævn fallback-takt, stadig deterministisk og stigende.
  assert.equal(p.riders[0].atMs, 0);
  assert.ok(p.riders[1].atMs > 0);
});

test("udbrud: overlevet vs. indhentet, ingen beat når intet udbrud", () => {
  const survived = buildFinalKilometrePlayback({
    rows: [
      riderRow({ id: "1", rank: 1, finish_time: "+0:00", in_breakaway: true, breakaway_caught: false }),
      riderRow({ id: "2", rank: 2, finish_time: "+0:20" }),
    ],
  });
  assert.deepEqual(survived.breakawayBeat, { key: "breakawaySurvived", count: 1 });

  const caught = buildFinalKilometrePlayback({
    rows: [
      riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
      riderRow({ id: "2", rank: 2, finish_time: "+0:05", in_breakaway: true, breakaway_caught: true }),
    ],
  });
  assert.deepEqual(caught.breakawayBeat, { key: "breakawayCaught", count: 1 });

  const none = buildFinalKilometrePlayback({
    rows: [riderRow({ id: "1", rank: 1, finish_time: "+0:00" }), riderRow({ id: "2", rank: 2, finish_time: "+0:05" })],
  });
  assert.equal(none.breakawayBeat, null);
});

test("team-klassement-rækker (rider_id=null) tælles ikke med som finishers", () => {
  const rows = [
    riderRow({ id: "1", rank: 1, finish_time: "+0:00" }),
    riderRow({ id: "2", rank: 2, finish_time: "+0:05" }),
    { id: "3", rank: 1, result_type: "team", stage_number: 1, rider_id: null, team_id: "t1", team: { id: "t1", name: "Team" } },
  ];
  const p = buildFinalKilometrePlayback({ rows });
  assert.equal(p.totalFinishers, 2);
});

test("countdownAt: lineær nedtælling der rammer 0/0 præcis ved countdownMs", () => {
  assert.deepEqual(countdownAt(0), { distanceM: 3000, secondsToGo: COUNTDOWN_MS / 1000 });
  assert.deepEqual(countdownAt(COUNTDOWN_MS), { distanceM: 0, secondsToGo: 0 });
  const mid = countdownAt(COUNTDOWN_MS / 2);
  assert.equal(mid.distanceM, 1500);
});
