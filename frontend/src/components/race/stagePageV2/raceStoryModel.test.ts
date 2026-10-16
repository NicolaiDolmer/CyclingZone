// #6570 · loebshistoriens model (kuratering, mellemtider, referat, replay, Final 5 km).
// Fixtures er formet som rigtige v4-tidslinjer (samme hjaelper og form som
// backend/lib/raceStory.test.js, anonymiseret), og historien bygges af
// kontraktens egen buildRaceStory, saa testen ser praecis det siden faar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRaceStory } from "../../../../../backend/lib/raceStory.js";
import {
  asStory, buildReport, castFrom, curateMoments, finaleData, finaleEndTime, finaleMarkerLabelsShown, finaleStateAt, formatClock, frameAt,
  groupMembersAt, groupOfRider, isPeloton, leaderKmAt, lineReplayKm, MAX_STORY_LINES, namesList, parseGap, pickGroups,
  replayGroupsAt, splitRows, wholeStageFrames, myBestRider,
  type RaceStory, type StoryLine,
} from "./raceStoryModel.ts";
import type { ResultRow, RoleRider } from "./stagePageV2Model.ts";

const ev = (km: number, type: string, params: Record<string, unknown> = {}) => ({ km, type, params });

/** Kuperet etape, 100 km: udbrud med din rytter, 4 splits paa 0,3 km, top, indhentning, sent angreb. */
function hillyTimeline() {
  return [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 100, field_count: 12, profile_type: "hilly" }),
    ev(10, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["b1", "b2", "b3", "m1"], exact_km: 10, exact_time: 900 }),
    ev(20, "gap_update", { group_id: "peloton-0", gap_seconds: 60, exact_km: 20, exact_time: 1860 }),
    ev(40, "gap_update", { group_id: "peloton-0", gap_seconds: 200, exact_km: 40, exact_time: 3800 }),
    ev(60, "peloton_splits", { group_id: "gruppetto-1", source_group_id: "peloton-0", rider_ids: ["x1"], gap_seconds: 20, exact_km: 58.1, exact_time: 5300 }),
    ev(60, "peloton_splits", { group_id: "gruppetto-2", source_group_id: "peloton-0", rider_ids: ["x2"], gap_seconds: 30, exact_km: 58.2, exact_time: 5310 }),
    ev(60, "peloton_splits", { group_id: "gruppetto-3", source_group_id: "peloton-0", rider_ids: ["x3", "m2"], gap_seconds: 40, exact_km: 58.3, exact_time: 5320 }),
    ev(60, "peloton_splits", { group_id: "gruppetto-4", source_group_id: "peloton-0", rider_ids: ["x4"], gap_seconds: 50, exact_km: 58.4, exact_time: 5330 }),
    ev(60, "kom_passage", { name: "Col A", category: "1", exact_km: 60, top: [{ rider_id: "b1", points: 10 }] }),
    ev(60, "gap_update", { group_id: "peloton-0", gap_seconds: 120, exact_km: 60, exact_time: 5520 }),
    ev(60, "gap_update", { group_id: "gruppetto-1", gap_seconds: 150, exact_km: 60, exact_time: 5550 }),
    ev(60, "gap_update", { group_id: "gruppetto-2", gap_seconds: 170, exact_km: 60, exact_time: 5570 }),
    ev(60, "gap_update", { group_id: "gruppetto-3", gap_seconds: 190, exact_km: 60, exact_time: 5590 }),
    ev(60, "gap_update", { group_id: "gruppetto-4", gap_seconds: 210, exact_km: 60, exact_time: 5610 }),
    ev(80, "gap_update", { group_id: "peloton-0", gap_seconds: 30, exact_km: 80, exact_time: 7230 }),
    ev(85, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["b1", "b2", "b3", "m1"], chase_group_id: "peloton-0", chase_group_kind: "peloton", exact_km: 85, exact_time: 7650 }),
    ev(85, "group_merged", { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["b1", "b2", "b3", "m1"], exact_km: 85, exact_time: 7650 }),
    ev(96, "finale_attack", { kind: "late_attack", rider_id: "w", group_id: "solo-96", source_group_id: "peloton-0", gained_seconds: 8, exact_km: 96, exact_time: 8250 }),
    ev(100, "gap_update", { group_id: "peloton-0", gap_seconds: 8, exact_km: 100, exact_time: 8608 }),
    ev(100, "finish", { win_type: "solo", exact_km: 100, exact_time: 8600 }),
  ];
}

function rr(rank: number, id: string, last: string, team: string, gap: string): ResultRow {
  return { id: `s-${id}`, stage_number: 3, result_type: "stage", rank, rider_id: id, team_id: team, finish_time: gap, rider: { id, firstname: "A", lastname: last } };
}

const RESULTS: ResultRow[] = [
  rr(1, "w", "Winner", "t-x", "2:23:20"),
  rr(2, "b2", "Second", "t-x", "+0:08"),
  rr(3, "x9", "Third", "t-y", "+0:08"),
  rr(4, "b1", "Climber", "t-y", "+0:08"),
  rr(5, "m1", "Mine", "t-me", "+0:08"),
  rr(9, "m2", "Helper", "t-me", "+3:30"),
  rr(6, "b3", "Breaker", "t-y", "+0:08"),
  rr(7, "x1", "Dropped", "t-y", "+3:30"),
];
const ROLES: RoleRider[] = [{ rider_id: "m1", name: "Ole Mine", race_role: "captain" }, { rider_id: "m2", name: "Per Helper", race_role: "helper" }];

function story(events = hillyTimeline()): RaceStory {
  const results = RESULTS.map((r) => ({ rider_id: r.rider_id as string, rank: r.rank as number }));
  const built = asStory(buildRaceStory({ events, timelineVersion: 2, results, startlist: results.map((r) => r.rider_id) }));
  assert.ok(built, "kontraktens historie");
  return built;
}
const cast = () => castFrom(RESULTS, ROLES, 3, "t-me");

test("castFrom: efternavne fra resultatet, dine ryttere fra hold + roller, maalresultatet i orden", () => {
  const c = cast();
  assert.equal(c.nameOf("w"), "Winner");
  assert.deepEqual([...c.mine].sort(), ["m1", "m2"]);
  assert.deepEqual(c.finishers.slice(0, 3).map((f) => f.riderId), ["w", "b2", "x9"]);
  assert.equal(namesList(["b3", "b1", "zz"], c), "Climber, Breaker +1", "bedst placerede foerst, ukendte taeller med");
});

test("curateMoments: hoejst 8 linjer i km-orden; 4 splits paa 0,3 km er EEN linje med antal", () => {
  const s = story();
  const lines = curateMoments(s, cast());
  assert.ok(lines.length <= MAX_STORY_LINES);
  assert.deepEqual(lines.map((l) => l.km), [...lines.map((l) => l.km)].sort((a, b) => a - b));
  const splits = lines.filter((l) => l.kind === "split");
  assert.equal(splits.length, 1);
  assert.equal(splits[0].count, 4);
  assert.equal(splits[0].km, 58.1);
  assert.equal(splits[0].kmTo, 58.4);
  assert.deepEqual(splits[0].mineIds, ["m2"], "din rytter i en af splitsene navngives");
  const formed = lines.find((l) => l.kind === "formed");
  assert.ok(formed);
  assert.equal(formed.count, 4);
  assert.deepEqual(formed.mineIds, ["m1"]);
  assert.equal(formed.time, 900, "tiden er loggens egen");
  assert.ok(lines.some((l) => l.kind === "caught" && l.km === 85));
  const attack = lines.find((l) => l.kind === "attack");
  assert.deepEqual(attack?.riderIds, ["w"]);
  assert.equal(attack?.data.gain, 8);
  const finish = lines.at(-1) as StoryLine;
  assert.equal(finish.kind, "finish");
  assert.deepEqual(finish.riderIds, ["w"]);
  const climb = lines.find((l) => l.kind === "climb");
  assert.equal(climb?.data.name, "Col A");
  assert.deepEqual(climb?.riderIds, ["b1"]);
});

test("curateMoments: prod-form med ~50 oejeblikke (mange splits, samlinger, huller) kurateres til hoejst 8, maal og udbrud bevares", () => {
  const events = hillyTimeline();
  // 30 ekstra splits og samlinger spredt over etapen, som en tung bjergetape i prod.
  for (let i = 0; i < 30; i++) {
    const km = 20 + i * 2;
    events.push(ev(km, "peloton_splits", { group_id: `chase-${i}`, source_group_id: "peloton-0", rider_ids: [`r${i}`], gap_seconds: 10, exact_km: km - 0.5, exact_time: km * 90 }));
    events.push(ev(km + 1, "group_merged", { group_id: `chase-${i}`, into_group_id: "peloton-0", rider_ids: [`r${i}`], exact_km: km + 0.5, exact_time: km * 90 + 60 }));
  }
  const s = story(events);
  assert.ok(s.moments.length >= 50, `prod-form: ${s.moments.length} oejeblikke`);
  const lines = curateMoments(s, cast());
  assert.ok(lines.length <= MAX_STORY_LINES, `${lines.length} linjer`);
  assert.ok(lines.some((l) => l.kind === "finish"));
  assert.ok(lines.some((l) => l.kind === "formed"));
  assert.ok(lines.some((l) => l.kind === "caught"));
  assert.equal(lines.filter((l) => l.kind === "joined").length, 0, "samlinger har laveste prioritet");
  // 30 splits hver 2. km: en kaede af naere splits bliver til klynger paa hoejst 5 km.
  for (const l of curateMoments(s, cast(), 99).filter((x) => x.kind === "split")) {
    assert.ok((l.kmTo ?? l.km) - l.km <= 5 + 1e-9, `klynge km ${l.km}-${l.kmTo}`);
  }
});

test("curateMoments: uden praecise tider (aeldre log) faar et km-spaend aldrig en tid", () => {
  const old = hillyTimeline().map((e) => {
    const { exact_km: _k, exact_time: _t, ...rest } = e.params as Record<string, unknown>;
    return { ...e, params: rest };
  });
  const s = story(old);
  assert.equal(s.precise_times, false);
  const lines = curateMoments(s, cast());
  for (const l of lines) if (l.span) assert.equal(l.time, null, `${l.kind} paa km-spaend uden tid`);
  assert.ok(lines.some((l) => l.span), "loggens checkpoint-stemplede haendelser vises som spaend");
  for (const row of splitRows(s, "m1")) {
    assert.equal(row.leaderTime, null);
    assert.equal(row.myGap, null, "uden tider kendes hullet ikke");
  }
  assert.equal(splitRows(s, "m1").find((r) => r.kind === "climb")?.firstId, "b1", "foerst over toppen staar stadig i loggen");
  assert.equal(finaleData(s), null, "ingen Final 5 km uden praecise tider");
});

test("lineReplayKm: et stykke vej hopper til slut-km, aldrig forbi maal", () => {
  const line = { km: 58.1, kmTo: 58.4 } as StoryLine;
  assert.equal(lineReplayKm(line, 100), 58.4);
  assert.equal(lineReplayKm({ km: 120, kmTo: null } as StoryLine, 100), 100);
});

test("splitRows: foerer, foerertid og din bedste rytters hul pr. kontrolpunkt", () => {
  const s = story();
  const c = cast();
  const me = myBestRider(s, c);
  assert.equal(me, "m1");
  const rows = splitRows(s, me);
  const climb = rows.find((r) => r.kind === "climb");
  assert.ok(climb);
  assert.equal(climb.km, 60);
  assert.equal(climb.leaderTime, 5400);
  assert.deepEqual(climb.leaderIds, ["b1", "b2", "b3", "m1"]);
  assert.equal(climb.myGap?.in_front, true, "din rytter er i udbruddet paa toppen");
  const finish = rows.find((r) => r.kind === "finish");
  assert.ok(finish);
  assert.equal(finish.leaderTime, 8600);
  assert.equal(finish.myGap?.gap_s, 8);
});

test("buildReport: 3-5 saetninger, kun fra linjerne og resultatet, i fast raekkefoelge", () => {
  const s = story();
  const c = cast();
  const report = buildReport(s, curateMoments(s, c), c);
  assert.ok(report.length >= 3 && report.length <= 5, `${report.length} saetninger`);
  assert.deepEqual(report.map((r) => r.key), ["formedMine", "caught", "attackGain", "winnerGap", "mineGap"]);
  assert.deepEqual(report[0].params, { count: 4, km: 10, mine: "Mine" });
  assert.deepEqual(report[1].params, { km: 85 });
  assert.deepEqual(report[3].params, { winner: "Winner", second: "Second", gap: "0:08" });
  assert.deepEqual(report[4].params, { name: "Mine", rank: 5, gap: "0:08" });
  assert.deepEqual(buildReport(s, curateMoments(s, c), c), report, "deterministisk");
});

test("buildReport: din rytter vandt = egen saetning; ingen udbrud = ingen udbruds-saetning", () => {
  const events = hillyTimeline().filter((e) => !["breakaway_formed", "breakaway_caught", "group_merged"].includes(e.type));
  const s = story(events);
  const results = RESULTS.map((r) => (r.rider_id === "m1" ? { ...r, rank: 1 } : r.rider_id === "w" ? { ...r, rank: 5 } : r));
  const c = castFrom(results, ROLES, 3, "t-me");
  const report = buildReport(s, curateMoments(s, c), c);
  assert.ok(!report.some((r) => r.key.startsWith("formed") || r.key === "caught"));
  assert.ok(report.some((r) => r.key === "mineWon"));
  assert.ok(report.length >= 3);
});

test("buildReport: sparsom flad spurt (kun start, spurt, maal) fyldes op til 3 fakta-saetninger (Codex P2)", () => {
  const events = hillyTimeline().filter((e) => ["stage_start", "sprint_decided", "finish"].includes(e.type));
  const s = story(events);
  const results = RESULTS.map((r) => (r.rank === 1 ? r : r.rank <= 4 ? { ...r, finish_time: "+0:00" } : r));
  const c = castFrom(results, [], 3, "t-none");
  const report = buildReport(s, curateMoments(s, c), c);
  const keys = report.map((r) => r.key);
  assert.ok(report.length >= 3, `${report.length} saetninger: ${keys.join(",")}`);
  assert.equal(keys[0], "winnerSame");
  assert.deepEqual(report.find((r) => r.key === "sameTime")?.params, { count: 4 });
  assert.ok(keys.includes("third"), "tredjepladsen naevnes paa samme tid");
});

test("groupMembersAt: splits flytter rytterne fra deres split-punkt; resten foelger feltet", () => {
  const s = story();
  const at = groupMembersAt(s, 58.35);
  assert.equal(groupOfRider(at, "x3"), "gruppetto-3");
  assert.equal(groupOfRider(at, "x4"), "peloton-0", "endnu ikke splittet paa km 58,35");
  assert.equal(groupOfRider(at, "m1"), "breakaway-0");
  assert.equal(groupOfRider(groupMembersAt(s, 90), "m1"), "peloton-0", "efter indhentningen");
});

test("replay: hele etapen pr. km; fronten er udbruddet med din rytter, feltet staar km bag", () => {
  const s = story();
  const frames = wholeStageFrames(s);
  assert.ok(frames.length >= 100);
  assert.equal(frameAt(frames, 30.4)?.km, 30);
  const groups = replayGroupsAt(s, frames, 30, cast());
  const front = groups.find((g) => g.front);
  assert.equal(front?.groupId, "breakaway-0");
  assert.deepEqual(front?.mine, ["m1"]);
  const pel = groups.find((g) => g.groupId === "peloton-0");
  assert.ok(pel && pel.km != null && pel.km < 30 && pel.km > 25, `feltet paa km ${pel?.km}`);
});

test("Final 5 km: tidsmodel fra foererlinjen; foereren paa 5 km-skiltet ved t0 og paa stregen ved tLeaderEnd", () => {
  const s = story();
  const data = finaleData(s);
  assert.ok(data);
  assert.equal(data.startKm, 95);
  assert.equal(data.tLeaderEnd, 8600);
  assert.ok(Math.abs(leaderKmAt(data.line, data.t0) - 95) < 1e-6);
  const c = cast();
  const start = finaleStateAt(s, data, c, data.t0);
  assert.ok(Math.abs(start.toGoKm - 5) < 1e-6);
  const end = finaleStateAt(s, data, c, data.tLeaderEnd);
  assert.equal(end.leaderFinished, true);
  const front = end.groups.find((g) => g.front);
  assert.equal(front?.groupId, "solo-96");
  const pel = end.groups.find((g) => g.groupId === "peloton-0");
  assert.equal(pel?.gapS, 8);
  assert.equal(pel?.finished, false, "feltet er 8 s bag stregen");
  assert.deepEqual(pel?.mine.sort(), ["m1"], "din rytter kører i feltet");
  assert.ok(finaleEndTime(s, data, c) >= data.tLeaderEnd + 8);
  assert.equal(finaleStateAt(s, data, c, data.tLeaderEnd + 9).groups.find((g) => g.groupId === "peloton-0")?.finished, true);
});

test("pickGroups: 25 grupper i finalen = front + hoejst 3 + din gruppe, resten samlet", () => {
  const groups = Array.from({ length: 25 }, (_, i) => ({ groupId: `g${i}`, gapS: i * 10, size: 3, front: i === 0, mine: i === 20 ? ["m1"] : [] }));
  const { shown, rest } = pickGroups(groups);
  assert.deepEqual(shown.map((g) => g.groupId), ["g0", "g1", "g2", "g3", "g20"]);
  assert.deepEqual(rest, { groups: 20, riders: 60, minGap: 40, maxGap: 240 });
  assert.equal(pickGroups(groups.slice(0, 3)).rest, null);
  // Dine ryttere i flere grupper: kun din forreste faar plads; resten er i den samlede linje.
  const spread = groups.map((g, i) => ({ ...g, mine: i === 12 || i === 20 ? ["m"] : [] }));
  assert.deepEqual(pickGroups(spread).shown.map((g) => g.groupId), ["g0", "g1", "g2", "g3", "g12"]);
});

test("enkeltstart: ingen gruppehistorie, ingen replay, ingen Final 5 km", () => {
  const s = story([
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 20, field_count: 10, profile_type: "itt" }),
    ev(20, "finish", { exact_km: 20, exact_time: 1500 }),
  ]);
  assert.equal(s.time_trial, true);
  assert.deepEqual(wholeStageFrames(s), []);
  assert.equal(finaleData(s), null);
});

test("asStory, formatClock og parseGap", () => {
  assert.equal(asStory(null), null);
  assert.equal(asStory({ version: 2, moments: [], checkpoints: [], snapshots: [] }), null, "ukendt kontraktversion");
  assert.equal(formatClock(17410.8), "4:50:11");
  assert.equal(formatClock(24), "0:24");
  assert.equal(parseGap("+1:10"), 70);
  assert.equal(parseGap("2:23:20"), 8600);
  assert.equal(parseGap("DNF"), null);
  assert.equal(isPeloton(true, null), true);
  assert.equal(isPeloton(true, 40), true);
  assert.equal(isPeloton(true, 1), false, "resten paa een rytter er ikke et felt");
  assert.equal(isPeloton(false, 40), false);
});

test("buildReport: din rytter vandt naevnes kun een gang (Codex P2)", () => {
  const s = story();
  const results = RESULTS.map((r) => (r.rider_id === "m1" ? { ...r, rank: 1 } : r.rider_id === "w" ? { ...r, rank: 5 } : r));
  const c = castFrom(results, ROLES, 3, "t-me");
  const keys = buildReport(s, curateMoments(s, c), c).map((r) => r.key);
  assert.equal(keys.filter((k) => k === "mineWon" || k.startsWith("winner")).length, 1, keys.join(","));
});

test("castFrom: raekker uden placering (rank null) er aldrig vinderen (Codex P2)", () => {
  const withNull = [{ ...rr(0, "dnf", "Nobody", "t-z", ""), rank: null } as unknown as ResultRow, ...RESULTS];
  const c = castFrom(withNull, ROLES, 3, "t-me");
  assert.equal(c.finishers[0].riderId, "w");
  assert.ok(!c.finishers.some((f) => f.riderId === "dnf"));
});

test("curateMoments: en gruppe der kommer i maal efter vinderen er ikke 'hentet'; maal staar sidst (endagsloeb, prod 15/10)", () => {
  const events = hillyTimeline();
  events.push(ev(100, "breakaway_caught", { group_id: "late-1", rider_ids: ["x1", "x2"], chase_group_id: "peloton-0", chase_group_kind: "peloton", exact_km: 100, exact_time: 8642 }));
  const lines = curateMoments(story(events), cast(), 99);
  const finishIdx = lines.findIndex((l) => l.kind === "finish");
  assert.equal(finishIdx, lines.length - 1, lines.map((l) => `${l.kind}@${l.km}`).join(","));
  assert.ok(!lines.some((l) => l.kind === "caught" && l.km >= 100));
});

test("#6643: Final 5 km-maerkernes tekst overlapper aldrig (desktop og mobil)", () => {
  for (const [plotW, fs] of [[653, 11], [318, 9], [900, 11]]) {
    const pxPerKm = (plotW - 40) / 5;
    const X = (kmFromStart: number) => 20 + kmFromStart * pxPerKm;
    const markers = [0, 1, 2, 3].map((i) => ({ x: X(i), label: `${5 - i} KM`, start: i === 0 }))
      .concat([{ x: X(4), label: "1 KM", start: false }, { x: X(4.5), label: "500 M", start: false }, { x: X(4.8), label: "200 M", start: false }]);
    const shown = finaleMarkerLabelsShown(markers, fs);
    assert.deepEqual(shown.slice(0, 5), [true, true, true, true, true], "km-maerkerne og flamme rouge vises altid");
    const boxes = markers.filter((_, i) => shown[i]).map(({ x, label, start }) => {
      const w = label.length * fs * 0.72;
      return start ? [x, x + w] : [x - w / 2, x + w / 2];
    });
    for (let i = 1; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) assert.ok(boxes[i][0] >= boxes[j][1] || boxes[i][1] <= boxes[j][0], `${plotW}px: ingen overlap`);
    }
  }
});
