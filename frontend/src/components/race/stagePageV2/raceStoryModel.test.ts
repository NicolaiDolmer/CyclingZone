// #6570 · loebshistoriens model (kuratering, mellemtider, referat, replay, Final 5 km).
// Fixtures er formet som rigtige v4-tidslinjer (samme hjaelper og form som
// backend/lib/raceStory.test.js, anonymiseret), og historien bygges af
// kontraktens egen buildRaceStory, saa testen ser praecis det siden faar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";
import { buildRaceStory, replayFrames, storyInputsFromResults } from "../../../../../backend/lib/raceStory.js";
import { withEventPlaces } from "../../../../../backend/lib/raceTimeline.js";
import {
  asStory, isTimeTrialStory, buildReport, castFrom, curateMoments, dayWordsByRider, dayWordSentences, finaleData, finaleEndTime, finaleMarkerLabelsShown, finaleStateAt, formatClock, frameAt,
  groupMembersAt, groupOfRider, leaderKmAt, lineReplayKm, mainGroupId, MAX_STORY_LINES, namesList, ownOutSentences, ownTimeLoss, parseGap, pickGroups,
  replayGroupsAt, reportTextKey, splitRows, wholeStageFrames, myBestRider,
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
    ev(60, "gap_update", { group_id: "peloton-0", gap_seconds: 60, exact_km: 60, exact_time: 5460 }),
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

test("buildReport: 3-5 saetninger plus din angrebs-saetning, kun fra linjerne og resultatet, i fast raekkefoelge", () => {
  const s = story();
  const c = cast();
  const report = buildReport(s, curateMoments(s, c), c);
  assert.ok(report.length >= 3 && report.length <= 6, `${report.length} saetninger`);
  assert.deepEqual(report.map((r) => r.key), ["formedMine", "ownAttackedWithMore", "caught", "attackGain", "winnerGap", "mineGap"]);
  assert.deepEqual(report[0].params, { count: 4, km: 10, mine: "Mine" });
  assert.deepEqual(report[2].params, { km: 85 });
  assert.deepEqual(report[4].params, { winner: "Winner", second: "Second", gap: "0:08" });
  assert.deepEqual(report[5].params, { name: "Mine", rank: 5, gap: "0:08" });
  assert.deepEqual(buildReport(s, curateMoments(s, c), c), report, "deterministisk");
});

const ownAttackLines = (report: ReturnType<typeof buildReport>) => report.filter((r) => r.key.startsWith("ownAttackedWith"));

test("#7754: referatet siger hvem din rytter angreb med, lige efter udbruddet og uden tal", () => {
  const s = story();
  const c = cast();
  const report = buildReport(s, curateMoments(s, c), c);
  assert.equal(report[1].key, "ownAttackedWithMore");
  assert.deepEqual(report[1].params, { mine: "Mine", others: "Second, Climber", count: 1 });
  assert.ok(!("km" in report[1].params) && !("gap" in report[1].params));
});

test("#7754: et senere udbrud klistres ikke paa det foerste", () => {
  const events = hillyTimeline().flatMap((e) => (e.type === "breakaway_formed"
    ? [{ ...e, params: { ...e.params, rider_ids: ["b1", "b2"] } }, ev(30, "breakaway_formed", { group_id: "breakaway-2500", reformation: true, rider_ids: ["b3", "m1"], exact_km: 30, exact_time: 2800 })]
    : [e]));
  const s = story(events);
  const c = cast();
  const keys = buildReport(s, curateMoments(s, c), c).map((r) => r.key);
  assert.ok(keys.indexOf("ownAttackedWith") > keys.findIndex((k) => k.startsWith("formed")) + 1, keys.join(","));
});

test("#7754: uden egne ryttere i angrebet siges intet; to egne alene angreb med hinanden", () => {
  const s = story();
  const noMine = castFrom(RESULTS, [], 3, "t-none");
  assert.deepEqual(ownAttackLines(buildReport(s, curateMoments(s, noMine), noMine)), []);
  const pair = story(hillyTimeline().map((e) => (e.type === "breakaway_formed" ? { ...e, params: { ...e.params, rider_ids: ["m1", "m2"] } } : e)));
  const c = cast();
  assert.deepEqual(ownAttackLines(buildReport(pair, curateMoments(pair, c), c)).map((r) => r.params), [{ mine: "Mine", others: "Helper", count: 1 }]);
});

test("#7754: faelles angreb paa nedkoersel staar efter angrebet; et baaret forspring er intet angreb", () => {
  const without = hillyTimeline().filter((e) => e.type !== "breakaway_formed" && e.type !== "breakaway_caught" && e.type !== "group_merged" && e.type !== "finale_attack");
  const finish = without.findIndex((e) => e.type === "finish");
  const withEvent = (params: Record<string, unknown>) => {
    const events = [...without];
    events.splice(finish, 0, ev(90, "finale_attack", { group_id: "attack-90", exact_km: 90, exact_time: 7800, ...params }));
    return story(events);
  };
  const c = cast();
  const descent = withEvent({ direction: "descent", rider_ids: ["m1", "b1", "b2"], gained_seconds: 5 });
  const keys = buildReport(descent, curateMoments(descent, c), c).map((r) => r.key);
  assert.equal(keys[keys.findIndex((k) => k.startsWith("attack")) + 1], "ownAttackedWith");
  // To navne: angrebs-saetningen har allerede sagt det hele.
  const told = withEvent({ direction: "descent", rider_ids: ["m1", "b1"], gained_seconds: 5 });
  assert.deepEqual(ownAttackLines(buildReport(told, curateMoments(told, c), c)), []);
  // Codex: et andet angreb paa samme km har ikke sagt, hvem din rytter koerte med.
  const [mineFirst, other] = [ev(90, "finale_attack", { direction: "descent", group_id: "attack-a", rider_ids: ["m1", "b1"], gained_seconds: 5, exact_km: 90, exact_time: 7800 }), ev(90, "finale_attack", { direction: "descent", group_id: "attack-b", rider_ids: ["b2"], gained_seconds: 5, exact_km: 90, exact_time: 7801 })];
  const twoAttacks = story([...without.slice(0, finish), mineFirst, other, ...without.slice(finish)]);
  assert.equal(ownAttackLines(buildReport(twoAttacks, curateMoments(twoAttacks, c), c)).length, 1);
  const carried = withEvent({ kind: "carried_gap_held", rider_ids: ["m1", "b1", "b2"] });
  assert.deepEqual(ownAttackLines(buildReport(carried, curateMoments(carried, c), c)), []);
});

test("#7754: tekst paa alle sprog med enkelte klammer og uden tal", () => {
  for (const lang of ["en", "da", "fr", "es", "nl"]) {
    const report = JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/races.json`, import.meta.url), "utf8")).stagePageV2.story.report;
    for (const key of ["ownAttackedWith", "ownAttackedWithMore"]) {
      const text = String(report[key]);
      assert.match(text, /\{mine\}/, `${lang}.${key}`);
      assert.match(text, /\{others\}/, `${lang}.${key}`);
      assert.doesNotMatch(text, /\{\{(?!mine)|\d|#/, `${lang}.${key}`);
      const said = (count: number) => new IntlMessageFormat(text, lang).format({ mine: "A", others: "B", count });
      assert.match(String(said(1)), /A.*B/, `${lang}.${key}`);
      assert.match(String(said(2)), /A.*B/, `${lang}.${key}`);
    }
  }
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
  const results = RESULTS.map((r) => (r.rank === 1 ? r : (r.rank ?? 99) <= 4 ? { ...r, finish_time: "+0:00" } : r));
  const c = castFrom(results, [], 3, "t-none");
  const report = buildReport(s, curateMoments(s, c), c);
  const keys = report.map((r) => r.key);
  assert.ok(report.length >= 3, `${report.length} saetninger: ${keys.join(",")}`);
  assert.equal(keys[0], "winnerSame");
  assert.deepEqual(report.find((r) => r.key === "sameTime")?.params, { count: 4 });
  assert.ok(keys.includes("third"), "tredjepladsen naevnes paa samme tid");
});

test("#7900: ved stregen staar alle ryttere i en af resultatets grupper, ogsaa ved samme hul (Codex)", () => {
  const events = [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 100, field_count: 4, profile_type: "flat" }),
    ev(95, "finale_attack", { group_id: "finale-winner-0", source_group_id: "peloton-0", rider_ids: ["a"], exact_km: 100, exact_time: 8200 }),
    ev(95, "finale_attack", { group_id: "finale-tier-1", source_group_id: "peloton-0", rider_ids: ["b"], exact_km: 100, exact_time: 8200 }),
    ev(100, "finish", { win_type: "small_group", exact_km: 100, exact_time: 8200 }),
  ];
  const rows = [["a", 1, "+0:00"], ["b", 2, "+0:00"], ["c", 3, "+0:16"], ["d", 4, "+0:16"]]
    .map(([rider_id, rank, finish_time]) => ({ rider_id: rider_id as string, rank: rank as number, finish_time: finish_time as string, result_type: "stage", stage_number: 2 }));
  const s = asStory(buildRaceStory({ events, timelineVersion: 2, ...storyInputsFromResults(rows, 2) })) as RaceStory;
  const finish = s.snapshots[s.snapshots.length - 1];
  assert.equal(finish.groups.every((g) => g.gap_source === "result"), true);
  const shown = new Set(finish.groups.map((g) => g.group_id));
  assert.equal([...shown].filter((id) => id.startsWith("finale-")).length, 1, "to grupper paa samme hul er een gruppe");
  const members = groupMembersAt(s, 100);
  for (const { rider_id } of rows) assert.equal(shown.has(groupOfRider(members, rider_id) as string), true, rider_id);
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
});

test("mainGroupId (#7704): feltet er den stoerste gruppe, ikke motorens startgruppe", () => {
  const g = (group_id: string, size: number | null, gap_s: number, includes_rest = false) => ({ group_id, size, gap_s, includes_rest });
  assert.equal(mainGroupId([g("peloton-0", 40, 0, true)]), "peloton-0");
  assert.equal(mainGroupId([g("peloton-0", 16, 60, true), g("gruppetto-1", 70, 300), g("gruppetto-2", 30, 400)]), "gruppetto-1", "lille rest foran en stor gruppe");
  assert.equal(mainGroupId([g("peloton-0", 80, 60, true), g("gruppetto-1", 30, 300)]), "peloton-0", "resten er stadig stoerst");
  assert.equal(mainGroupId([g("peloton-0", null, 60, true), g("gruppetto-1", 30, 300)]), "peloton-0", "uden field_count er resten det bedste bud");
  assert.equal(mainGroupId([g("peloton-0", 1, 60, true), g("solo-1", 1, 90)]), null, "ingen gruppe er et felt");
  assert.equal(mainGroupId([g("gruppetto-1", 20, 90), g("gruppetto-2", 20, 30)]), "gruppetto-2", "lige stor: gruppen foran");
  assert.equal(mainGroupId([g("breakaway-0", 12, 0), g("peloton-0", 9, 60, true)]), null, "et udbrud er aldrig feltet");
  assert.equal(mainGroupId([g("breakaway-0", 30, 0, true)]), "breakaway-0", "#7388: resten er gaaet op i gruppen");
});

/** Som prod (#7704): feltet falder fra hinanden bagfra, saa startgruppen er en lille gruppe foran en stor. */
function shatteredTimeline() {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  return [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 100, field_count: 60, profile_type: "mountain" }),
    ev(10, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["b1", "b2", "b3"], exact_km: 10, exact_time: 900 }),
    ev(20, "gap_update", { group_id: "peloton-0", gap_seconds: 60, exact_km: 20, exact_time: 1860 }),
    ev(30, "gap_update", { group_id: "peloton-0", gap_seconds: 150, exact_km: 30, exact_time: 2850 }),
    ev(40, "peloton_splits", { group_id: "gruppetto-1", source_group_id: "peloton-0", rider_ids: [...ids("g", 34), "m1"], gap_seconds: 60, exact_km: 40, exact_time: 3660 }),
    ev(40, "peloton_splits", { group_id: "gruppetto-2", source_group_id: "peloton-0", rider_ids: ids("h", 10), gap_seconds: 120, exact_km: 40, exact_time: 3720 }),
    ev(60, "gap_update", { group_id: "peloton-0", gap_seconds: 60, exact_km: 60, exact_time: 5460 }),
    ev(60, "gap_update", { group_id: "gruppetto-1", gap_seconds: 200, exact_km: 60, exact_time: 5600 }),
    ev(60, "gap_update", { group_id: "gruppetto-2", gap_seconds: 260, exact_km: 60, exact_time: 5660 }),
    ev(80, "gap_update", { group_id: "peloton-0", gap_seconds: 200, exact_km: 80, exact_time: 7400 }),
    ev(80, "gap_update", { group_id: "gruppetto-1", gap_seconds: 300, exact_km: 80, exact_time: 7500 }),
    ev(80, "gap_update", { group_id: "gruppetto-2", gap_seconds: 360, exact_km: 80, exact_time: 7560 }),
    ev(100, "gap_update", { group_id: "peloton-0", gap_seconds: 200, exact_km: 100, exact_time: 9200 }),
    ev(100, "gap_update", { group_id: "gruppetto-1", gap_seconds: 340, exact_km: 100, exact_time: 9340 }),
    ev(100, "gap_update", { group_id: "gruppetto-2", gap_seconds: 400, exact_km: 100, exact_time: 9400 }),
    ev(100, "finish", { win_type: "solo", exact_km: 100, exact_time: 9000 }),
  ];
}

test("#7704: replay og Final 5 km kalder kun den reelle hovedgruppe for feltet", () => {
  const s = story(shatteredTimeline());
  const c = cast();
  const onRoad = replayGroupsAt(s, wholeStageFrames(s), 60, c);
  assert.deepEqual(onRoad.filter((g) => g.peloton).map((g) => g.groupId), ["gruppetto-1"]);
  const start = onRoad.find((g) => g.groupId === "peloton-0");
  const main = onRoad.find((g) => g.peloton);
  assert.ok(start && main && start.gapS < main.gapS, "startgruppen ligger foran hovedgruppen");
  const data = finaleData(s);
  assert.ok(data);
  const finale = finaleStateAt(s, data, c, data.t0);
  assert.deepEqual(finale.groups.filter((g) => g.peloton).map((g) => g.groupId), ["gruppetto-1"]);
});

test("#7704: hul-linjen siger kun feltet om hovedgruppen", () => {
  const s = story(shatteredTimeline());
  const gaps = s.moments.filter((m) => m.key === "story.gap_grew" || m.key === "story.gap_shrank");
  const lines = curateMoments(s, cast(), 50).filter((l) => l.kind === "gap");
  const groupAt = (km: number, id: string) => lines.find((l) => l.km === km && gaps.some((m) => m.km === km && m.data.group_id === id))?.data.group;
  const afterSplit = gaps.find((m) => m.data.group_id === "peloton-0" && m.km >= 40);
  assert.ok(afterSplit, "startgruppens hul flytter sig efter splittet");
  assert.equal(groupAt(afterSplit.km, "peloton-0"), "chase", "startgruppen er ikke feltet efter splittet");
  const beforeSplit = gaps.find((m) => m.data.group_id === "peloton-0" && m.km < 40);
  assert.ok(beforeSplit);
  assert.equal(groupAt(beforeSplit.km, "peloton-0"), "rest", "foer splittet er den feltet");
});

test("buildReport: din rytter vandt naevnes kun een gang (Codex P2)", () => {
  const s = story();
  const results = RESULTS.map((r) => (r.rider_id === "m1" ? { ...r, rank: 1 } : r.rider_id === "w" ? { ...r, rank: 5 } : r));
  const c = castFrom(results, ROLES, 3, "t-me");
  const keys = buildReport(s, curateMoments(s, c), c).map((r) => r.key);
  assert.equal(keys.filter((k) => k === "mineWon" || k.startsWith("winner")).length, 1, keys.join(","));
});

test("#7701 ownOutSentences: kun egne udgaaede, een saetning pr. aarsag, uden ikke-startere", () => {
  const c = castFrom(RESULTS, ROLES, 3, "t-me");
  const rows = [
    { rider_id: "o1", name: "Ib Hansen", team_id: "t-me", reasonKey: "withdrawal", status: "dnf" },
    { rider_id: "o2", name: "Bo Olsen", team_id: "t-me", reasonKey: "withdrawal", status: "dnf" },
    { rider_id: "o3", name: "Jan Berg", team_id: "t-me", reasonKey: "withdrawal", status: "dnf" },
    { rider_id: "o4", name: "Kim Holm", team_id: "t-me", reasonKey: "time_limit", status: "dnf" },
    { rider_id: "o5", name: "Per Lund", team_id: "t-me", reasonKey: "injury", status: "dns" },
    { rider_id: "o6", name: "Ole Dam", team_id: "t-other", reasonKey: "withdrawal", status: "dnf" },
  ];
  assert.deepEqual(ownOutSentences(rows, "t-me", c), [
    { key: "ownOut", params: { kind: "withdrawal", names: "Hansen, Olsen +1" } },
    { key: "ownOut", params: { kind: "time_limit", names: "Holm" } },
  ]);
  assert.deepEqual(ownOutSentences(rows, null, c), [], "uden eget hold er der intet at fortaelle");
  assert.deepEqual(ownOutSentences(null, "t-me", c), []);
});

test("#7701 buildReport: egne udgaaede staar sidst og overlever loftet paa 5 saetninger", () => {
  const s = story();
  const c = castFrom(RESULTS, ROLES, 3, "t-me");
  const lines = curateMoments(s, c);
  const plain = buildReport(s, lines, c);
  const ownOut = [{ key: "ownOut", params: { kind: "withdrawal", names: "Hansen" } }];
  const report = buildReport(s, lines, c, ownOut);
  assert.equal(report[report.length - 1].key, "ownOut");
  assert.ok(report.length <= 6, report.map((r) => r.key).join(","));
  assert.ok(plain.every((r) => r.key !== "ownOut"), "uden udgaaede er referatet uaendret");
});

test("#7725 dayWordsByRider: et daarligt ord er aarsagen; ukendte ord og ryttere giver intet", () => {
  const words = dayWordsByRider([
    ev(100, "day_word", { rider_id: "a", word: "great" }),
    ev(100, "day_word", { rider_id: "b", word: "bad", reason: "fatigue" }),
    ev(100, "day_word", { rider_id: "c", word: "bad", reason: "weather", weather: "rain" }),
    ev(100, "day_word", { rider_id: "d", word: "bad", reason: "weather" }),
    ev(100, "day_word", { rider_id: "e", word: "lucky" }),
    ev(100, "day_word", { word: "good" }),
    ev(100, "bad_day", { rider_id: "f", reason: "form" }),
  ]);
  assert.deepEqual([...words], [["a", "great"], ["b", "fatigue"], ["c", "rain"]]);
  assert.equal(dayWordsByRider(null).size, 0);
});

test("#7725 dayWordSentences: vinderen og dine egne i maal, vinderen foerst, hoejst to, aldrig andre hold", () => {
  const c = castFrom(RESULTS, ROLES, 3, "t-me");
  const mine = c.finishers.filter((f) => c.mine.has(f.riderId)).map((f) => f.riderId);
  const other = c.finishers.find((f, i) => i > 0 && !c.mine.has(f.riderId))?.riderId;
  assert.ok(mine.length > 0 && other);
  const events = [
    ev(100, "day_word", { rider_id: other, word: "great" }),
    ev(100, "day_word", { rider_id: mine[0], word: "bad", reason: "form" }),
    ev(100, "day_word", { rider_id: "w", word: "good" }),
    ev(100, "day_word", { rider_id: "not-in-results", word: "great" }),
  ];
  assert.deepEqual(dayWordSentences(events, c), [
    { key: "dayGood", params: { name: c.nameOf("w") as string } },
    { key: "bad_day_form", params: { rider: c.nameOf(mine[0]) as string } },
  ]);
  assert.deepEqual(dayWordSentences([], c), [], "slukket: ingen ord i loggen, ingen saetning");
});

test("#7725 buildReport: dagens ord staar foer dine udgaaede og skubber ikke loebets historie ud", () => {
  const s = story();
  const c = castFrom(RESULTS, ROLES, 3, "t-me");
  const lines = curateMoments(s, c);
  const dayWords = [{ key: "dayGreat", params: { name: "Winner" } }];
  const ownOut = [{ key: "ownOut", params: { kind: "withdrawal", names: "Hansen" } }];
  const keys = buildReport(s, lines, c, ownOut, dayWords).map((r) => r.key);
  assert.ok(keys.length <= 7, keys.join(","));
  assert.equal(keys.indexOf("dayGreat"), keys.length - 2, keys.join(","));
  assert.deepEqual(buildReport(s, lines, c, ownOut, []), buildReport(s, lines, c, ownOut), "uden ord er referatet uaendret");
  const full = [ownOut[0], { ...ownOut[0] }, { ...ownOut[0] }];
  const crowded = buildReport(s, lines, c, full, dayWords).map((r) => r.key);
  assert.ok(crowded.length <= 7 && crowded.filter((k) => k === "ownOut").length === 3, crowded.join(","));
  assert.ok(crowded.some((k) => k.startsWith("winner")), crowded.join(","));
});

test("#7725 ord: alle fem sprog har begge gode dage og alle aarsager, uden tal, og hver saetning har sin noegle", async () => {
  const { readFileSync } = await import("node:fs");
  assert.equal(reportTextKey("dayGreat"), "stagePageV2.story.report.dayGreat");
  assert.equal(reportTextKey("bad_day_rain"), "detail.film.event.bad_day_rain");
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const url = new URL(`../../../../public/locales/${lang}/races.json`, import.meta.url);
    const races = JSON.parse(readFileSync(url, "utf8"));
    const report = races.stagePageV2.story.report;
    for (const key of ["dayGreat", "dayGood"]) assert.ok(report[key]?.includes("{name}") && !/[0-9%]/.test(report[key]), `${lang}: ${key}`);
    assert.notEqual(report.dayGreat, report.dayGood, lang);
    for (const cause of ["fatigue", "form", "illness", "rain", "wind", "heat"]) assert.ok(races.detail.film.event[`bad_day_${cause}`]?.includes("{rider}"), `${lang}: ${cause}`);
  }
});

test("#7701 buildReport: mange aarsager skubber aldrig vinderen og din bedste ud (Codex)", () => {
  const s = story();
  const c = castFrom(RESULTS, ROLES, 3, "t-me");
  const kinds = ["crash", "withdrawal", "time_limit", "abandoned"];
  const ownOut = kinds.map((kind) => ({ key: "ownOut", params: { kind, names: "Hansen" } }));
  const keys = buildReport(s, curateMoments(s, c), c, ownOut).map((r) => r.key);
  assert.ok(keys.length <= 6, keys.join(","));
  assert.ok(keys.some((k) => k.startsWith("winner") || k === "mineWon"), keys.join(","));
  assert.ok(keys.some((k) => k.startsWith("mine")), keys.join(","));
  assert.equal(keys.filter((k) => k === "ownOut").length, 3, keys.join(","));
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

test("buildReport: sparsom etape med tidshuller og din rytter nr. 3 fylder stadig op til 3 saetninger (Codex #6643)", () => {
  const events = hillyTimeline().filter((e) => ["stage_start", "sprint_decided", "finish"].includes(e.type));
  const s = story(events);
  const results: ResultRow[] = [
    rr(1, "w", "Winner", "t-x", "2:23:20"),
    rr(2, "b2", "Second", "t-x", "+0:01"),
    rr(3, "m1", "Mine", "t-me", "+0:05"),
    rr(4, "x9", "Fourth", "t-y", "+0:09"),
    rr(5, "b1", "Fifth", "t-y", "+0:12"),
  ];
  const c = castFrom(results, ROLES, 3, "t-me");
  const report = buildReport(s, curateMoments(s, c), c);
  const keys = report.map((r) => r.key);
  assert.ok(report.length >= 3, `${report.length} saetninger: ${keys.join(",")}`);
  assert.ok(keys.includes("winnerGap") && keys.includes("mineGap"));
  assert.deepEqual(report.find((r) => r.key === "placedGap")?.params, { name: "Fourth", rank: 4, gap: "0:09" });
  const names = report.flatMap((r) => [r.params?.name, r.params?.winner, r.params?.second]).filter(Boolean);
  assert.equal(new Set(names).size, names.length, "ingen rytter naevnes to gange");
});

test("buildReport: din rytter vandt en sparsom etape: nr. 2 og 3 fylder op (Codex #6643)", () => {
  const events = hillyTimeline().filter((e) => ["stage_start", "sprint_decided", "finish"].includes(e.type));
  const s = story(events);
  const results: ResultRow[] = [
    rr(1, "m1", "Mine", "t-me", "2:23:20"),
    rr(2, "b2", "Second", "t-x", "+0:02"),
    rr(3, "x9", "Third", "t-y", "+0:04"),
  ];
  const c = castFrom(results, ROLES, 3, "t-me");
  const report = buildReport(s, curateMoments(s, c), c);
  assert.deepEqual(report.map((r) => r.key), ["mineWon", "placedGap", "thirdGap"]);
});

test("#6299 (Codex #7161): morgenudbruddet og gruppen foran klynges aldrig sammen", () => {
  const s = story();
  const morningCaught = s.moments.find((m) => m.key === "story.breakaway_caught");
  assert.ok(morningCaught, "fixturens udbrud hentes");
  s.breakaway = { ...(s.breakaway ?? {}), morning_rider_ids: ["b1", "b2", "b3", "m1"] } as typeof s.breakaway;
  // En senere gruppe (ikke morgenudbruddet) hentes 1 km efter: inden for klynge-vinduet.
  s.moments.push({ ...morningCaught, km: morningCaught.km + 1, km_span: undefined, data: { ...morningCaught.data, rider_ids: ["x1", "x2"] } });
  const caught = curateMoments(s, cast(), 99).filter((l) => l.kind === "caught");
  const ahead = caught.filter((l) => l.data.ahead === true);
  const morning = caught.filter((l) => l.data.ahead !== true);
  assert.equal(ahead.length, 1, caught.map((l) => `${l.km}:${l.riderIds.join("+")}`).join(","));
  assert.equal(morning.length, 1);
  assert.ok(!morning[0].riderIds.includes("x1"));
  assert.ok(!ahead[0].riderIds.includes("b1"));
});


test("#6469 v2: selected outcome carries recorded causes and only the player's own order", () => {
  const events = [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 100, field_count: 3, profile_type: "hilly" }),
    ev(10, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["m1", "b1"], exact_km: 10, exact_time: 300 }),
    ev(30, "breakaway_unchased", { group_id: "breakaway-0" }),
    ev(100, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["m1"], exact_km: 100, exact_time: 3600 }),
    ev(100, "finish", { exact_km: 100, exact_time: 3600, win_type: "solo_win", top: [{ rider_id: "m1", rank: 1, gap: 0 }, { rider_id: "b1", rank: 2, gap: 20 }, { rider_id: "w", rank: 3, gap: 40 }] }),
  ];
  const results = [rr(1, "m1", "Mine", "t-me", "1:00:00"), rr(2, "b1", "Climber", "t-x", "+0:20"), rr(3, "w", "Winner", "t-x", "+0:40")];
  const s = asStory(buildRaceStory({ events, timelineVersion: 2, results: results.map(r => ({ rider_id: String(r.rider_id), rank: Number(r.rank) })), startlist: ["m1", "b1", "w"] }));
  assert.ok(s);
  const c = castFrom(results, ROLES, 3, "t-me");
  const context = { events, effortByRider: new Map([["m1", "all_out"], ["b1", "all_out"]]), teamNameById: new Map<string, string>() };
  const before = JSON.stringify({ events, s });
  const lines = curateMoments(s, c, MAX_STORY_LINES, context);
  const outcome = lines.find(l => l.kind === "survived");
  assert.deepEqual(outcome?.narratives?.map(n => n.key), ["cause.unchased", "order.all_out_stayed_away"]);
  assert.equal(lines.length, curateMoments(s, c).length, "explanations belong to existing rows, preserving the eight-moment limit");
  assert.deepEqual(lines, curateMoments(s, c, MAX_STORY_LINES, context), "deterministic, no duplicate explanations");
  assert.equal(JSON.stringify({ events, s }), before, "source timeline and server story remain untouched");
  assert.equal(curateMoments({ ...s, moments: s.moments.filter(m => m.key !== "story.breakaway_survived") }, c, MAX_STORY_LINES, context).some(l => l.narratives?.length), false, "unselected outcome contributes no explanation to another moment");
  assert.equal(curateMoments({ ...s, time_trial: true }, c, MAX_STORY_LINES, context).some(l => l.narratives?.length), false, "no group-racing explanation in time trials");
  const unnamed = curateMoments(s, { ...c, nameOf: () => null }, MAX_STORY_LINES, context).find(l => l.kind === "survived");
  assert.deepEqual(unnamed?.narratives?.map(n => n.key), ["cause.unchased"], "unresolved rider names never produce IDs or invented names");
});


test("#6469 context: authoritative TT metadata overrides a stale mass-start story flag", () => {
  const s = story();
  const before = JSON.stringify(s);
  for (const profileType of ["itt", "itt_hilly", "ttt"]) {
    const context = { profileType, events: hillyTimeline(), effortByRider: new Map([["m1", "all_out"]]) };
    assert.equal(isTimeTrialStory(s, profileType, context.events), true);
    assert.deepEqual(curateMoments(s, cast(), MAX_STORY_LINES, context), []);
  }
  assert.equal(isTimeTrialStory(s, "hilly", hillyTimeline()), false);
  assert.equal(JSON.stringify(s), before);
});

test("#6350: en sen halvdel af et split: navnene følger rytteren fra kontakten, ikke fra stregen", () => {
  const log = [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, field_count: 6, distance_km: 180 }),
    ev(10, "breakaway_formed", { group_id: "breakaway-1", rider_ids: ["ahead"], exact_km: 10, exact_time: 900 }),
    ev(170, "gap_update", { group_id: "peloton-0", gap_seconds: 90, exact_km: 170, exact_time: 17000 }),
    ev(174.07, "breakaway_caught", { group_id: "breakaway-1", rider_ids: ["ahead"], exact_km: 174.07 }),
    ev(174.07, "group_merged", { group_id: "breakaway-1", into_group_id: "peloton-0", rider_ids: ["ahead"], exact_km: 174.07 }),
    ev(180, "peloton_splits", { group_id: "front-part", source_group_id: "peloton-0", gap_seconds: 53.09, rider_ids: ["a"], exact_km: 170.76, exact_time: 17609 }),
    ev(180, "peloton_splits", { group_id: "behind", source_group_id: "peloton-0", gap_seconds: 302.73, rider_ids: ["set", "ahead"], exact_km: 180, exact_time: 19700 }),
    ev(180, "group_merged", { group_id: "behind", into_group_id: "front-part", rider_ids: ["set", "ahead"], exact_km: 176 }),
    ev(180, "finish", { exact_km: 180, top: [] }),
  ];
  const story = buildRaceStory({ events: withEventPlaces(log), timelineVersion: 2 }) as unknown as RaceStory;
  const at = (km: number, rider: string) => groupOfRider(groupMembersAt(story, km), rider);
  assert.equal(at(172, "ahead"), "breakaway-1");
  assert.equal(at(172, "set"), "behind");
  assert.equal(at(175, "ahead"), "peloton-0");
  assert.equal(at(178, "ahead"), "front-part");
  assert.equal(at(178, "set"), "front-part");
});

test("#7734: en sen halvdel med egen linje: navne og film følger rytteren fra kontakten til gruppen", () => {
  const log = [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, field_count: 6, distance_km: 180 }),
    ev(10, "breakaway_formed", { group_id: "breakaway-1", rider_ids: ["ahead"], exact_km: 10, exact_time: 900 }),
    ev(170, "gap_update", { group_id: "peloton-0", gap_seconds: 90, exact_km: 170, exact_time: 17000 }),
    ev(174.07, "breakaway_caught", { group_id: "breakaway-1", rider_ids: ["ahead"], exact_km: 174.07 }),
    ev(174.07, "group_merged", { group_id: "breakaway-1", into_group_id: "peloton-0", rider_ids: ["ahead"], exact_km: 174.07 }),
    ev(180, "peloton_splits", { group_id: "front-part", source_group_id: "peloton-0", gap_seconds: 53.09, rider_ids: ["a"], exact_km: 170.76, exact_time: 17609 }),
    ev(180, "peloton_splits", { group_id: "behind", source_group_id: "peloton-0", gap_seconds: 302.73, rider_ids: ["set", "ahead"], exact_km: 180, exact_time: 19700 }),
    ev(180, "gap_update", { group_id: "front-part", gap_seconds: 53.09, exact_km: 180, exact_time: 19453 }),
    ev(180, "gap_update", { group_id: "behind", gap_seconds: 302.73, exact_km: 180, exact_time: 19700 }),
    ev(180, "finish", { exact_km: 180, exact_time: 19400, top: [] }),
  ];
  const story = buildRaceStory({ events: withEventPlaces(log), timelineVersion: 2 }) as unknown as RaceStory;
  const at = (km: number, rider: string) => groupOfRider(groupMembersAt(story, km), rider);
  const frames = replayFrames(story, { finaleKm: 12, stepKm: 1 }) as Array<{ km: number; groups: Array<{ group_id: string; size: number | null; gap_s: number }> }>;
  const inFilm = (km: number, id: string) => frames.find((f) => f.km === km)?.groups.find((g) => g.group_id === id);

  assert.equal(at(172, "ahead"), "breakaway-1");
  assert.equal(at(172, "set"), "behind");
  assert.equal(at(176, "ahead"), "behind-late", "ikke i feltet og ikke i gruppen han ender i");
  assert.equal(at(176, "set"), "behind");
  assert.equal(at(180, "ahead"), "behind", "på stregen er han i gruppen");
  assert.equal(inFilm(176, "behind-late")?.size, 1, "film og navne er enige");
  assert.equal(inFilm(176, "behind")?.size, 1);
  assert.ok((inFilm(176, "behind-late")?.gap_s ?? 0) < (inFilm(178, "behind-late")?.gap_s ?? 0), "hullet vokser undervejs");
});

test("#7734: en rytter udgået før linjen slutter, står ikke på linjen", () => {
  const log = [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, field_count: 6, distance_km: 100 }),
    ev(40, "gap_update", { group_id: "peloton-0", gap_seconds: 0, exact_km: 40, exact_time: 4000 }),
    ev(55, "incident", { kind: "crash", outcome: "abandoned", rider_id: "gone", exact_km: 55 }),
    ev(60, "peloton_splits", { group_id: "back", source_group_id: "peloton-0", gap_seconds: 60, rider_ids: ["x"], exact_km: 45 }),
    ev(60, "peloton_splits", { group_id: "back", source_group_id: "peloton-0", gap_seconds: 60, rider_ids: ["ahead", "gone"], joined_late: true, own_line: true, exact_km: 50 }),
    ev(60, "gap_update", { group_id: "back", gap_seconds: 60, exact_km: 60, exact_time: 6060 }),
    ev(100, "finish", { exact_km: 100, top: [] }),
  ];
  const story = buildRaceStory({ events: log, timelineVersion: 2 }) as unknown as RaceStory;
  assert.deepEqual(story.group_spans?.find((s) => s.group_id === "back-late")?.rider_ids, ["ahead"]);
});

test("#6350: en sen halvdel: film og navne er enige om uheldsofferet og den udgåede", () => {
  const log = [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, field_count: 6, distance_km: 100 }),
    ev(20, "gap_update", { group_id: "peloton-0", gap_seconds: 0, exact_km: 20, exact_time: 2000 }),
    ev(30, "incident", { kind: "crash", outcome: "time_loss", rider_id: "hurt", exact_km: 30 }),
    ev(31, "incident", { kind: "crash", outcome: "abandoned", rider_id: "gone", exact_km: 31 }),
    ev(40, "gap_update", { group_id: "peloton-0", gap_seconds: 0, exact_km: 40, exact_time: 4000 }),
    ev(60, "peloton_splits", { group_id: "back", source_group_id: "peloton-0", gap_seconds: 60, rider_ids: ["x"], exact_km: 50 }),
    ev(60, "peloton_splits", { group_id: "back", source_group_id: "peloton-0", gap_seconds: 60, rider_ids: ["hurt", "gone"], joined_late: true, exact_km: 55 }),
    ev(60, "gap_update", { group_id: "peloton-0", gap_seconds: 0, exact_km: 60, exact_time: 6000 }),
    ev(60, "gap_update", { group_id: "back", gap_seconds: 60, exact_km: 60, exact_time: 6060 }),
    ev(100, "finish", { exact_km: 100, top: [] }),
  ];
  const story = buildRaceStory({ events: log, timelineVersion: 2 }) as unknown as RaceStory;
  const frames = replayFrames(story, { finaleKm: 60, stepKm: 1 }) as Array<{ km: number; groups: Array<{ group_id: string; size: number | null }> }>;
  const inFilm = (km: number, id: string) => frames.find((f) => f.km === km)?.groups.find((g) => g.group_id === id)?.size;
  const inNames = (km: number) => [...(groupMembersAt(story, km).get("back")?.riders ?? [])].sort();

  assert.equal(inFilm(52, "back"), 1);
  assert.deepEqual(inNames(52), ["x"]);
  assert.equal(inFilm(57, "back"), 2, "uheldsofferet er med fra sit eget sted, den udgåede aldrig");
  assert.deepEqual(inNames(57), ["hurt", "x"]);
  assert.equal(inFilm(57, "peloton-0"), 3, "uheldsofferet var ikke i resten, så resten mister kun den satte");
});

test("#6350: en rytter udgået efter snapshottet, men før den sene halvdel, står aldrig i gruppen", () => {
  const log = [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, field_count: 6, distance_km: 100 }),
    ev(20, "gap_update", { group_id: "peloton-0", gap_seconds: 0, exact_km: 20, exact_time: 2000 }),
    ev(40, "gap_update", { group_id: "peloton-0", gap_seconds: 0, exact_km: 40, exact_time: 4000 }),
    ev(45, "incident", { kind: "crash", outcome: "abandoned", rider_id: "gone", exact_km: 45 }),
    ev(60, "peloton_splits", { group_id: "front-part", source_group_id: "peloton-0", gap_seconds: 30, rider_ids: ["a"], exact_km: 50, exact_time: 5030 }),
    ev(60, "peloton_splits", { group_id: "back", source_group_id: "peloton-0", gap_seconds: 60, rider_ids: ["x", "gone"], exact_km: 60 }),
    ev(60, "group_merged", { group_id: "back", into_group_id: "front-part", rider_ids: ["x", "gone"], exact_km: 58 }),
    ev(60, "gap_update", { group_id: "peloton-0", gap_seconds: 0, exact_km: 60, exact_time: 6000 }),
    ev(100, "finish", { exact_km: 100, top: [] }),
  ];
  const placed = withEventPlaces(log) as Array<{ type: string; params: { group_id?: string; rider_ids?: string[]; joined_late?: boolean; exact_km?: number } }>;
  const late = placed.find((e) => e.type === "peloton_splits" && e.params.joined_late);
  assert.deepEqual(late?.params.rider_ids, ["gone"], "logen giver netop den sene halvdel");
  assert.equal(late?.params.exact_km, 58);
  const story = buildRaceStory({ events: placed, timelineVersion: 2 }) as unknown as RaceStory;
  assert.deepEqual(story.snapshots.find((s) => s.km === 40)?.out_rider_ids, [], "snapshot a kender ikke udgåelsen");

  const frames = replayFrames(story, { finaleKm: 60, stepKm: 0.5 }) as Array<{ km: number; groups: Array<{ group_id: string; size: number | null }> }>;
  const inFilm = (km: number, id: string) => frames.find((f) => f.km === km)?.groups.find((g) => g.group_id === id)?.size;
  assert.equal(inFilm(57.5, "back"), 1);
  assert.deepEqual([...(groupMembersAt(story, 57.5).get("back")?.riders ?? [])], ["x"]);
  assert.equal(inFilm(58, "back"), 1, "den udgåede kører aldrig igen, heller ikke på halvdelens km");
  assert.deepEqual([...(groupMembersAt(story, 58).get("back")?.riders ?? [])], ["x"]);
});

// #7705: formen fra den rapporterede etape (bjergetape med mål på toppen), anonymiseret.
function summitFinish() {
  return [
    ev(0, "stage_start", { exact_km: 0, exact_time: 0, distance_km: 180, field_count: 6, profile_type: "mountain" }),
    ev(170, "gap_update", { group_id: "peloton-0", gap_seconds: 91, exact_km: 170, exact_time: 17499 }),
    ev(180, "all_out_cracked", { rider_id: "a", exact_km: 180, exact_time: 19715 }),
    ev(180, "all_out_cracked", { rider_id: "b", exact_km: 180, exact_time: 19715 }),
    ev(180, "peloton_splits", { group_id: "gruppetto-1", source_group_id: "peloton-0", rider_ids: ["a", "b", "x"], cause: "mixed", gap_seconds: 303, exact_km: 180, exact_time: 19715 }),
    ev(180, "gap_update", { group_id: "gruppetto-1", gap_seconds: 303, exact_km: 180, exact_time: 19715 }),
    ev(180, "bad_day", { rider_id: "b", reason: "illness" }),
    ev(180, "kom_passage", { name: "Top", category: "HC", exact_km: 180 }),
    ev(180, "finish", { exact_km: 180, exact_time: 19412, top: [{ rider_id: "w" }] }),
  ];
}
const LOSS_RESULTS = [
  rr(1, "w", "Winner", "t-x", "+0:00"), rr(2, "m0", "Same", "t-me", "+0:00"), rr(3, "a", "Empty", "t-me", "+5:03"), rr(4, "b", "Ill", "t-me", "+5:03"),
  rr(5, "x", "Other", "t-x", "+5:03"), rr(6, "lost", "Lost", "t-me", "+7:30"),
].map((row) => ({ ...row, stage_number: 10 }));
const lossOf = (events = summitFinish(), results = LOSS_RESULTS) => {
  const built = buildRaceStory({ events, timelineVersion: 2 }) as unknown as RaceStory;
  return ownTimeLoss(built, castFrom(results, [], 10, "t-me"), { events });
};

test("#7705: dine ryttere får den sande årsag, ukendt årsag står, og intet opdigtes", () => {
  const loss = lossOf();
  assert.deepEqual(loss.entries.map((e) => (e.type === "drop" ? ["drop", e.riderIds, e.reason, e.climbName] : [e.event.type, e.riderId])), [
    ["drop", ["a", "b"], "mixed", "Top"],
    ["all_out_cracked", "a"],
    ["all_out_cracked", "b"],
    ["bad_day", "b"],
  ]);
  assert.equal(loss.unknown, "Lost", "efter feltet uden årsag i loggen");
  assert.ok(loss.entries.every((e) => e.riderId !== "x"), "kun dine egne ryttere");
  assert.ok(loss.entries.every((e) => e.riderId !== "m0"), "på vinderens tid er der intet tidstab");
});

test("#7705: uden kendt hul i mål er tidstabet ikke vist, og et fald uden grund står som ukendt", () => {
  const noGap = LOSS_RESULTS.map((row) => (row.rider_id === "a" ? { ...row, finish_time: null } : row));
  assert.ok(lossOf(summitFinish(), noGap).entries.every((e) => e.riderId !== "a" && !(e.type === "drop" && e.riderIds.includes("a"))));
  const noCause = summitFinish()
    .filter((e) => e.type !== "all_out_cracked" && e.type !== "bad_day")
    .map((e) => (e.type === "peloton_splits" ? ev(180, "peloton_splits", { ...e.params, cause: undefined }) : e));
  const loss = lossOf(noCause);
  assert.deepEqual(loss.entries.map((e) => e.type === "drop" && e.reason), ["unknown"], "stedet står stadig");
  assert.equal(loss.unknown, "Empty, Ill, Lost", "faldet siger ikke hvorfor, og han efter feltet står med");
});

test("#7705: din rytter i feltet bag et udbrud har ikke tabt tid", () => {
  const results = [
    rr(1, "w", "Winner", "t-x", "+0:00"), rr(2, "p1", "Pack", "t-me", "+6:00"), rr(3, "p2", "Pack", "t-x", "+6:00"), rr(4, "p3", "Pack", "t-x", "+6:00"),
  ].map((row) => ({ ...row, stage_number: 10 }));
  assert.deepEqual(lossOf(summitFinish().filter((e) => e.type !== "bad_day" && e.type !== "all_out_cracked"), results), { entries: [], unknown: "" });
});

test("#7705: en årsag uden tekst forklarer intet, og uden præcise tider siges intet", () => {
  const events = summitFinish().filter((e) => e.type !== "all_out_cracked" && e.type !== "peloton_splits").map((e) => (e.type === "bad_day" ? ev(180, "bad_day", { rider_id: "lost", reason: "ny_grund" }) : e));
  const loss = lossOf(events);
  assert.deepEqual(loss.entries, []);
  assert.equal(loss.unknown, "Lost", "linjen uden tekst forklarer ham ikke");
  const noTimes = buildRaceStory({ events: [ev(0, "stage_start", { distance_km: 180 }), ev(180, "bad_day", { rider_id: "b", reason: "illness" }), ev(180, "finish", {})], timelineVersion: 1 }) as unknown as RaceStory;
  assert.deepEqual(ownTimeLoss(noTimes, castFrom(LOSS_RESULTS, [], 10, "t-me"), { events: [] }), { entries: [], unknown: "" });
});
