// #7643: sandhedsvagtens regler mod de kendte fejl fra Giro della Penisola
// (etape 6 og 8, anonymiseret) og mod en ren etape (etape 2).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RULES,
  buildFilm,
  checkStage,
  dayRowsFor,
  filmPlaceFindings,
  parseGapSeconds,
  publicFinding,
  replayTimeline,
  ruleAbandonedGone,
  ruleCatchAfterFormation,
  ruleClaimsMatchGroup,
  ruleDroppedInFront,
  ruleFilmMatchesResult,
  ruleSplitNeverAhead,
  ruleStandingsAddUp,
  startlistFor,
  summarize,
} from "./race-truth-rules.mjs";
import { loadFixture, stageInput } from "../__fixtures__/race-truth/load.mjs";
import { withEventPlaces } from "../../backend/lib/raceTimeline.js"; // #6350

const clone = (value) => JSON.parse(JSON.stringify(value));

function prepared(stage) {
  const stageRows = stage.raceRows.filter((row) => row.result_type === "stage" && row.stage_number === stage.stageNumber);
  return { ...stage, stageRows, startlist: startlistFor(stage.events, stageRows) };
}

function codes(findings) {
  return summarize(findings);
}

const stage2 = stageInput("giro-stage-2-clean.json");
const stage6 = stageInput("giro-stage-6.json");
const stage8 = stageInput("giro-stage-8.json");

test("de syv regler er navngivet", () => {
  assert.deepEqual(Object.keys(RULES), ["R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
});

test("en ren etape giver 0 fund", () => {
  assert.deepEqual(checkStage(stage2), []);
});

test("R1 (#7635): etape 8, tre ryttere 'sat' ved km 61,8 mens de sidder i hovedgruppen", () => {
  const findings = ruleDroppedInFront(prepared(stage8));
  assert.equal(findings.length, 3);
  for (const f of findings) {
    assert.equal(f.code, "dropped_in_main_group");
    assert.equal(f.km, 61.8);
    assert.equal(f.group_id, "peloton-0");
  }
  // Nedkørselsangrebet (få sekunder foran) må ikke tælle som fronten.
  assert.ok(findings.every((f) => f.main_group_id === "peloton-0"));
});

test("R1: en rytter i et split bag hovedgruppen er ærligt sat (intet fund)", () => {
  const events = [
    { km: 0, type: "stage_start", params: { exact_km: 0, exact_time: 0 } },
    { km: 50, type: "peloton_splits", params: { exact_km: 48, exact_time: 4000, group_id: "gruppetto-1", source_group_id: "peloton-0", rider_ids: ["b"], gap_seconds: 40, cause: "climb_deficit" } },
    { km: 50, type: "stage_plan_leg", params: { rider_id: "b", leg: 1, task: "ride_in", reason: "dropped", exact_km: 50 } },
  ];
  assert.deepEqual(ruleDroppedInFront({ events, startlist: ["a", "b"] }), []);
});

test("R2 (#7639): etape 6, den udgåede rytter lever videre som spøgelsesgruppe", () => {
  const findings = ruleAbandonedGone(prepared(stage6));
  const ghosts = findings.filter((f) => f.code === "ghost_group_after_abandon");
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0].group_id, "solo-m10-16-0");
  // Resultatet er rigtigt: den udgåede har ingen etape-række.
  assert.equal(findings.filter((f) => f.code === "abandoned_in_result").length, 0);
});

test("R2: en udgået rytter der navngives senere i loggen giver et fund", () => {
  const events = [
    { km: 0, type: "stage_start", params: {} },
    { km: 20, type: "incident", params: { rider_id: "a", outcome: "abandoned", exact_km: 20 } },
    { km: 30, type: "finale_attack", params: { group_id: "solo-9", rider_ids: ["a"], exact_km: 30, exact_time: 3000 } },
  ];
  const findings = ruleAbandonedGone({ events, startlist: ["a", "b"], stageRows: [{ rider_id: "a" }] });
  assert.deepEqual(findings.map((f) => f.code).sort(), ["abandoned_in_result", "named_after_abandon"]);
});

test("R3 (#6350): etape 8, gruppen hentes før den angriber, og uheldsgrupper uden dannelse", () => {
  const findings = ruleCatchAfterFormation(prepared(stage8));
  const early = findings.filter((f) => f.code === "caught_before_formed");
  assert.equal(early.length, 1);
  assert.equal(early[0].group_id, "breakaway-7000");
  assert.equal(early[0].km, 97.4);
  assert.equal(early[0].formed_km, 99.2);
  // Et uheldsoffers solo-gruppe er dannet af uheldet: filmen starter den dér.
  assert.ok(!findings.some((f) => f.group_id === "solo-m10-10-0"));
  const span = buildFilm(prepared(stage8)).group_spans.find((s) => s.group_id === "solo-m10-8-0");
  assert.equal(span.from_km, 107.23);
  // Et nedkørselsangreb der nævnes (holdordre) før selve angrebet står i loggen.
  assert.ok(findings.some((f) => f.code === "referenced_before_formed" && f.group_id === "breakaway-4000"));
});

test("R4 (#7640): etape 8, vinderens angreb står som et split med negativt hul", () => {
  const findings = ruleSplitNeverAhead(prepared(stage8));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "split_ahead_of_source");
  assert.equal(findings[0].group_id, "solo-11010");
  assert.equal(findings[0].cause, "climb_deficit");
});

test("R5: filmens mål svarer til resultatet på etape 6 og 8", () => {
  assert.deepEqual(ruleFilmMatchesResult(prepared(stage6)), []);
  assert.deepEqual(ruleFilmMatchesResult(prepared(stage8)), []);
});

test("R5: et resultat-hul filmen ikke viser giver et fund", () => {
  const stage = clone(stage8);
  const row = stage.raceRows.find((r) => r.result_type === "stage" && r.stage_number === 8 && r.rank === 2);
  row.finish_time = "+0:00";
  const input = prepared(stage);
  // #7900: filmen bygges nu af resultatets huller; her en film uden dem (motorens målbillede).
  const motorFilm = buildFilm({ ...input, stageRows: input.stageRows.map(({ finish_time: _gap, ...rest }) => rest) });
  const found = codes(ruleFilmMatchesResult(input, motorFilm));
  assert.equal(found.R5.codes.finish_gap_mismatch, 1);
});

test("R5 (#7900): filmen følger resultatets hul ved målet, så samme etape giver intet fund", () => {
  const stage = clone(stage8);
  const row = stage.raceRows.find((r) => r.result_type === "stage" && r.stage_number === 8 && r.rank === 2);
  row.finish_time = "+0:00";
  const found = codes(ruleFilmMatchesResult(prepared(stage)));
  assert.equal(found.R5?.codes.finish_gap_mismatch, undefined);
  assert.equal(found.R5?.codes.finish_order_mismatch, undefined);
});

test("R5: en byttet vinder i filmens målrækkefølge giver et fund, også med samme hul", () => {
  const stage = clone(stage2);
  const finish = stage.events.find((e) => e.type === "finish");
  const [first, second] = finish.params.top;
  [first.rider_id, second.rider_id] = [second.rider_id, first.rider_id];
  const found = codes(ruleFilmMatchesResult(prepared(stage)));
  assert.equal(found.R5.codes.film_top_rank_mismatch, 2);
});

test("R6 (#6350): etape 8, 'sat' stemples ved segmentgrænsen km 161, ikke ved splittet km 147,31", () => {
  const findings = ruleClaimsMatchGroup(prepared(stage8)).filter((f) => f.code === "dropped_stamped_after_split");
  const late = findings.find((f) => f.km === 161 && f.split_index === 229);
  assert.ok(late, "rytteren i gruppetto-11008 skal fanges");
  assert.ok(Math.abs(late.split_km - 147.31) < 0.01);
});

test("#6350: gemte etaper læst gennem withEventPlaces: ingen indhentning før dannelse, 'sat' står ved splittet, filmen holder", () => {
  for (const stage of [stage6, stage8]) {
    const placed = prepared({ ...stage, events: withEventPlaces(stage.events) });
    assert.deepEqual(ruleCatchAfterFormation(placed).filter((f) => f.code === "caught_before_formed"), []);
    assert.deepEqual(ruleClaimsMatchGroup(placed).filter((f) => f.code === "dropped_stamped_after_split"), []);
    assert.deepEqual(ruleFilmMatchesResult(placed), []);
    // km er rækkefølgen og flyttes aldrig; kun stedet.
    assert.deepEqual(placed.events.map((e) => [e.type, e.km]), stage.events.map((e) => [e.type, e.km]));
    assert.deepEqual(withEventPlaces(placed.events), placed.events, "idempotent");
  }
  const split = withEventPlaces(stage8.events).find((e) => e.type === "peloton_splits" && e.km === 89 && e.params.group_id === "solo-6003");
  assert.ok(split.params.exact_km > 80.5 && split.params.exact_km < 82, "splittet på stigningen står på stigningen, ikke på toppen");
  assert.equal(split.params.exact_time, undefined, "tiden på toppen hører ikke til stedet");
  const attack = withEventPlaces(stage8.events).find((e) => e.type === "finale_attack" && e.params.group_id === "breakaway-7000");
  assert.ok(attack.params.exact_km <= 97.4);
  const dropped = withEventPlaces(stage8.events).find((e) => e.type === "stage_plan_leg" && e.km === 161 && e.params.reason === "dropped");
  assert.ok(dropped.params.exact_km < 161);
});

test("R6: referatets vinder og uheld svarer til resultat og tidslinje", () => {
  const stage = prepared(stage8);
  assert.equal(ruleClaimsMatchGroup(stage).filter((f) => f.code !== "dropped_stamped_after_split").length, 0);
  const wrong = clone(stage8);
  const win = wrong.moments.find((m) => m.moment_key === "solo_win");
  const runnerUp = wrong.raceRows.find((r) => r.result_type === "stage" && r.stage_number === 8 && r.rank === 2);
  win.params.riderId = runnerUp.rider_id;
  wrong.moments.push({ moment_key: "incident_abandon", params: { riderId: runnerUp.rider_id } });
  const found = codes(ruleClaimsMatchGroup(prepared(wrong)));
  assert.equal(found.R6.codes.win_moment_not_stage_winner, 1);
  assert.equal(found.R6.codes.abandon_moment_without_abandon, 1);
});

test("R6: 'hentet' mens rytteren stadig sidder i udbruddet giver et fund", () => {
  const events = [
    { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a"], exact_km: 10, exact_time: 900 } },
    { km: 20, type: "stage_plan_leg", params: { rider_id: "a", leg: 1, task: "ride_in", reason: "caught" } },
  ];
  const found = ruleClaimsMatchGroup({ events, startlist: ["a", "b"], stageRows: [] });
  assert.deepEqual(found.map((f) => f.code), ["caught_while_in_break"]);
});

test("R7: GC, bonus og trøjer går op på etape 6 og 8", () => {
  assert.deepEqual(ruleStandingsAddUp(prepared(stage6)), []);
  assert.deepEqual(ruleStandingsAddUp(prepared(stage8)), []);
});

test("R7: et GC-hul eller en bonus der ikke er summen giver et fund", () => {
  const stage = clone(stage8);
  const gc = stage.raceRows.find((r) => r.result_type === "leader" && r.rank === 2);
  gc.finish_time = "+0:01";
  const winner = stage.raceRows.find((r) => r.result_type === "stage" && r.stage_number === 8 && r.rank === 1);
  winner.bonus_seconds += 2;
  const found = codes(ruleStandingsAddUp(prepared(stage)));
  assert.ok(found.R7.codes.gc_gap_not_sum_of_stages >= 1);
  assert.equal(found.R7.codes.stage_bonus_not_passages, 1);
});

test("R7: slut-etapens gc/points/mountain tjekkes som mellem-etapernes klassementer", () => {
  const final = clone(stage8);
  const rename = { leader: "gc", points_day: "points", mountain_day: "mountain" };
  for (const row of final.raceRows) if (row.stage_number === 8 && rename[row.result_type]) row.result_type = rename[row.result_type];
  assert.deepEqual(ruleStandingsAddUp(prepared(final)), []);
  final.raceRows.find((r) => r.result_type === "gc" && r.rank === 2).finish_time = "+0:01";
  assert.ok(codes(ruleStandingsAddUp(prepared(final))).R7.codes.gc_gap_not_sum_of_stages >= 1);
});

test("checkStage samler kendte fejl på etape 6 og 8 og vælter aldrig", () => {
  const s8 = summarize(checkStage(stage8));
  assert.equal(s8.R1.total, 3);
  assert.equal(s8.R4.total, 1);
  assert.equal(s8.R5, undefined);
  assert.equal(s8.R7, undefined);
  const s6 = summarize(checkStage(stage6));
  assert.equal(s6.R2.total, 1);
  assert.equal(s6.R1, undefined);
  // Ødelagt input: et fund om vagten selv, aldrig en exception.
  const broken = checkStage({ raceId: "x", stageNumber: 1, events: [{ type: "gap_update", get params() { throw new Error("boom"); } }], raceRows: [] });
  assert.ok(broken.length >= 1 && broken.every((f) => f.code === "guard_error"));
  assert.deepEqual(checkStage({ raceId: "x", stageNumber: 1 }), []);
});

test("publicFinding bærer kun race, etape, regel og kode", () => {
  const [first] = checkStage(stage8);
  assert.deepEqual(Object.keys(publicFinding(first)).sort(), ["code", "race_id", "rule", "stage_number"]);
});

test("dayRowsFor: et endagsløbs resultat står i gc-rækkerne", () => {
  const rows = [{ result_type: "gc", stage_number: 1, rider_id: "a", rank: 1 }, { result_type: "team", stage_number: 1 }];
  assert.deepEqual(dayRowsFor(rows, 1).map((r) => r.rider_id), ["a"]);
  assert.deepEqual(dayRowsFor(rows, 2), []);
  const staged = [{ result_type: "stage", stage_number: 1, rider_id: "b" }, ...rows];
  assert.deepEqual(dayRowsFor(staged, 1).map((r) => r.rider_id), ["b"]);
});

test("R2: motorens bogføring ved målstregen tæller ikke som en optræden", () => {
  const events = [
    { km: 20, type: "incident", params: { rider_id: "a", outcome: "abandoned" } },
    { km: 100, type: "finale_attack", params: { kind: "placement_gap", group_id: "peloton-0", rider_ids: ["a", "b"] } },
  ];
  assert.deepEqual(ruleAbandonedGone({ events, startlist: ["a", "b"], stageRows: [] }), []);
});

test("parseGapSeconds læser viste tider", () => {
  assert.equal(parseGapSeconds("+0:00"), 0);
  assert.equal(parseGapSeconds("+1:58"), 118);
  assert.equal(parseGapSeconds("+1:02:03"), 3723);
  assert.equal(parseGapSeconds("DNF"), null);
  assert.equal(parseGapSeconds(null), null);
});

test("replayTimeline giver uheldsofferet sin M10-gruppe", () => {
  const events = [
    { km: 5, type: "incident", params: { rider_id: "a", outcome: "time_loss", exact_km: 5 } },
    { km: 10, type: "gap_update", params: { group_id: "solo-m10-0-0", gap_seconds: 30, exact_km: 10 } },
  ];
  let seen = null;
  replayTimeline([...events, { km: 11, type: "noop", params: {} }], ["a", "b"], (event, _i, view) => {
    if (event.type === "noop") seen = view.groupOf("a");
  });
  assert.equal(seen, "solo-m10-0-0");
});

test("replayTimeline (Codex P2): uheldsgrupper følger motorens seq i rider_id-orden, ikke km-orden", () => {
  // To M10-uheld i samme segment: "z" udgår først (km 3), "a" taber tid senere (km 6).
  // Motoren giver seq i rider_id-orden: solo-m10-0-0 = "a", solo-m10-0-1 = "z".
  const events = [
    { km: 3, type: "incident", params: { rider_id: "z", outcome: "abandoned", exact_km: 3 } },
    { km: 6, type: "incident", params: { rider_id: "a", outcome: "time_loss", exact_km: 6 } },
    { km: 10, type: "gap_update", params: { group_id: "solo-m10-0-0", gap_seconds: 30, exact_km: 10 } },
  ];
  let seen = null;
  const { incidentGroups } = replayTimeline([...events, { km: 11, type: "noop", params: {} }], ["a", "z", "b"], (event, _i, view) => {
    if (event.type === "noop") seen = view.groupOf("a");
  });
  assert.equal(seen, "solo-m10-0-0");
  assert.equal(incidentGroups.get("solo-m10-0-0").riderId, "a");
  // Den overlevende rytters gruppe er ikke et spøgelse.
  assert.deepEqual(ruleAbandonedGone({ events, startlist: ["a", "z", "b"], stageRows: [] }), []);
});

test("R7 (Codex P2): en rytter i GC der mangler en kørt etape giver et fund", () => {
  const rows = [
    { result_type: "stage", stage_number: 1, rider_id: "A", rank: 1, finish_time: "+0:00", bonus_seconds: 0 },
    { result_type: "stage", stage_number: 1, rider_id: "B", rank: 2, finish_time: "+0:10", bonus_seconds: 0 },
    { result_type: "stage", stage_number: 2, rider_id: "A", rank: 1, finish_time: "+0:00", bonus_seconds: 0 },
    { result_type: "leader", stage_number: 2, rider_id: "A", rank: 1, finish_time: "+0:00" },
    { result_type: "leader", stage_number: 2, rider_id: "B", rank: 2, finish_time: "+0:10" },
  ];
  const stageRows = rows.filter((r) => r.result_type === "stage" && r.stage_number === 2);
  const found = codes(ruleStandingsAddUp({ raceId: "x", stageNumber: 2, raceRows: rows, stageRows, events: [], startlist: ["A", "B"] }));
  assert.equal(found.R7.codes.gc_rider_missing_stage, 1);
});

test("#6350: en sen halvdel af et split flytter ikke gruppens dannelse", () => {
  const log = [
    { km: 0, type: "stage_start", params: { exact_km: 0, exact_time: 0 } },
    { km: 180, type: "peloton_splits", params: { group_id: "g", source_group_id: "peloton-0", rider_ids: ["a"], exact_km: 170.47 } },
    { km: 180, type: "peloton_splits", params: { group_id: "g", source_group_id: "peloton-0", rider_ids: ["b"], exact_km: 176, joined_late: true } },
    { km: 180, type: "group_merged", params: { group_id: "g", into_group_id: "peloton-0", rider_ids: ["a", "b"], exact_km: 176 } },
  ];
  assert.deepEqual(ruleCatchAfterFormation({ events: log, startlist: ["a", "b"] }), []);
});

// Motorens form: splits, så sammenlægningen med alle gruppens ryttere, samme km.
function filmContradiction({ splitKm, lateKm, catchKm = 174.07 }) {
  return [
    { km: 0, type: "stage_start", params: { exact_km: 0, exact_time: 0 } },
    { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-1", rider_ids: ["ahead"], exact_km: 10 } },
    { km: catchKm, type: "breakaway_caught", params: { group_id: "breakaway-1", rider_ids: ["ahead"], exact_km: catchKm } },
    { km: catchKm, type: "group_merged", params: { group_id: "breakaway-1", into_group_id: "peloton-0", rider_ids: ["ahead"], exact_km: catchKm } },
    { km: 180, type: "peloton_splits", params: { group_id: "g", source_group_id: "peloton-0", rider_ids: lateKm == null ? ["set", "ahead"] : ["set"], gap_seconds: 300, exact_km: splitKm } },
    ...(lateKm == null ? [] : [{ km: 180, type: "peloton_splits", params: { group_id: "g", source_group_id: "peloton-0", rider_ids: ["ahead"], gap_seconds: 300, exact_km: lateKm, joined_late: true } }]),
    { km: 180, type: "group_merged", params: { group_id: "g", into_group_id: "gruppetto-2", rider_ids: ["set", "ahead"], exact_km: 176 } },
  ];
}

test("#6350 R3: vagten fanger en rytter der står i en gruppe før han var fri af udbruddet", () => {
  // Det et trukket-tilbage split ville vise: i gruppen bag ved km 170,76, hentet ved km 174,07.
  const found = ruleCatchAfterFormation({ events: filmContradiction({ splitKm: 170.76 }), startlist: ["set", "ahead"] });
  const hit = found.filter((f) => f.code === "rider_in_group_before_free");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].rider_id, "ahead");
  assert.equal(hit[0].km, 170.76);
  assert.equal(hit[0].left_km, 174.07);
});

test("#6350 R3: vagten fanger en sen halvdel der går ind i en gruppe efter gruppens kontakt", () => {
  const hit = filmPlaceFindings(filmContradiction({ splitKm: 170.47, lateKm: 179 })).filter((f) => f.code === "split_after_group_contact");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].group_id, "g");
  assert.equal(hit[0].contact_km, 176);
  // Reglen læser filmen som siden viser den: withEventPlaces har allerede rettet stedet.
  assert.deepEqual(ruleCatchAfterFormation({ events: filmContradiction({ splitKm: 170.47, lateKm: 179 }), startlist: ["set", "ahead"] }), []);
  // Det rigtige sted er ikke et fund.
  assert.deepEqual(ruleCatchAfterFormation({ events: filmContradiction({ splitKm: 170.47, lateKm: 176 }), startlist: ["set", "ahead"] }), []);
});

test("#7734 R3: etape 10: de hentede står ikke i en gruppe før de var fri af udbruddet", () => {
  const { events } = loadFixture("giro-stage-10.json");
  const late = filmPlaceFindings(withEventPlaces(events)).filter((f) => f.rider_id === "rider-late-a" || f.rider_id === "rider-late-b");
  assert.deepEqual(late, []);
});

test("#6350 R3: en kæde af sammenlægninger i segmentet er ikke et skift ud af en anden gruppe", () => {
  const log = [
    { km: 0, type: "stage_start", params: { exact_km: 0, exact_time: 0 } },
    { km: 180, type: "peloton_splits", params: { group_id: "g1", source_group_id: "peloton-0", rider_ids: ["a"], gap_seconds: 60, exact_km: 171 } },
    { km: 180, type: "group_merged", params: { group_id: "g1", into_group_id: "g2", rider_ids: ["a"], exact_km: 174 } },
    { km: 180, type: "group_merged", params: { group_id: "g2", into_group_id: "g3", rider_ids: ["a", "b"], exact_km: 177 } },
  ];
  assert.deepEqual(ruleCatchAfterFormation({ events: log, startlist: ["a", "b"] }).filter((f) => f.code === "rider_in_group_before_free"), []);
});
