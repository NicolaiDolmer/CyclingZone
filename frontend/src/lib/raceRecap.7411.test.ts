// #7411: udgaaede i etapeloeb synlige (aarsag, DNF-raekker, samlet linje, dit hold).
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRaceRecap,
  incidentReasonKey,
  withdrawalGroupMoment,
  dnfRowsForStage,
  ownStageAbandons,
  isNonStarterKind,
  teamIdByRiderFromRows,
  withTimeLimitFatigue,
  fatigueRiderIdsFromEvents,
} from "./raceRecap.js";
import { readFileSync } from "node:fs";
import { riderWhy } from "./riderWhyModel.ts";
import { castFrom, ownOutSentences } from "../components/race/stagePageV2/raceStoryModel.ts";

// buildRaceRecap er JS med tomme default-arrays (never[] for tsc); testen giver den rigtige raekker.
const recap = buildRaceRecap as unknown as (opts: Record<string, unknown>) => Array<{ key: string; params: Record<string, any> }>;

type Team = { id: string; name: string } | null;
const rider = (id: string, firstname: string, lastname: string, team: Team = null) => ({ id, firstname, lastname, nationality_code: "DK", team });
const inc = (id: string, stage: number, riderId: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id, stage_number: stage, rider_id: riderId, kind, outcome: "abandon",
  rider: rider(riderId, "R", riderId.toUpperCase()), ...extra,
});

const stageRows = [
  { id: "s1", result_type: "stage", stage_number: 2, rank: 1, rider_id: "w", team_id: "tB", finish_time: "+0:00", rider: { id: "w", firstname: "Win", lastname: "Ner" } },
  { id: "s2", result_type: "stage", stage_number: 2, rank: 2, rider_id: "a1", team_id: "tA", finish_time: "+0:30", rider: { id: "a1", firstname: "Al", lastname: "Pha" } },
  { id: "s3", result_type: "stage", stage_number: 2, rank: 3, rider_id: "a2", team_id: "tA", finish_time: "+0:40", rider: { id: "a2", firstname: "Al", lastname: "Two" } },
];

test("incidentReasonKey: withdrawal og time_limit har egen aarsag, ukendt art er neutral", () => {
  assert.equal(incidentReasonKey("withdrawal"), "withdrawal");
  assert.equal(incidentReasonKey("time_limit"), "time_limit");
  assert.equal(incidentReasonKey("crash"), "crash");
  assert.equal(incidentReasonKey("something_new"), "abandoned", "aldrig en forkert aarsag som 'Styrt'");
});

test("withdrawalGroupMoment: én linje fra 2 udstigere, kun den valgte etape", () => {
  const incidents = [inc("1", 2, "h1", "withdrawal"), inc("2", 2, "h2", "withdrawal"), inc("3", 1, "h3", "withdrawal"), inc("4", 2, "c1", "crash")];
  assert.deepEqual(withdrawalGroupMoment(incidents, { type: "stage", stageNumber: 2 }), { key: "withdrawalGroup", params: { count: 2, when: "stage" } });
  assert.equal(withdrawalGroupMoment(incidents, { type: "stage", stageNumber: 1 }), null, "én udstiger er ikke en gruppe");
  assert.deepEqual(withdrawalGroupMoment(incidents, { type: "overall" })?.params, { count: 3, when: "other" });
});

test("buildRaceRecap: gruppen erstatter de enkelte udstiger-linjer, styrt staar stadig", () => {
  const incidents = [inc("1", 2, "h1", "withdrawal"), inc("2", 2, "h2", "withdrawal"), inc("3", 2, "h3", "withdrawal"), inc("4", 2, "c1", "crash")];
  const m = recap({ results: stageRows, scope: { type: "stage", stageNumber: 2 }, incidents });
  const group = m.find((x) => x.key === "withdrawalGroup");
  assert.ok(group, "samlet linje findes");
  assert.equal(group.params.count, 3);
  const abandons = m.filter((x) => x.key === "abandon");
  assert.equal(abandons.length, 1);
  assert.equal(abandons[0].params.kind, "crash");
});

test("buildRaceRecap: én udstiger faar sin egen linje med kind=withdrawal", () => {
  const m = recap({ results: stageRows, scope: { type: "stage", stageNumber: 2 }, incidents: [inc("1", 2, "h1", "withdrawal")] });
  assert.ok(!m.some((x) => x.key === "withdrawalGroup"));
  assert.equal(m.find((x) => x.key === "abandon")?.params.kind, "withdrawal");
  assert.equal(m.find((x) => x.key === "abandon")?.params.when, "stage");
  const oneDay = recap({ results: stageRows, scope: { type: "overall" }, incidents: [inc("1", 1, "h1", "withdrawal")] });
  assert.equal(oneDay.find((x) => x.key === "abandon")?.params.when, "other", "endagsloeb: ingen \"efter etapen\"");
});

test("dnfRowsForStage: etapens udgaaede som DNF-raekker med hold fra loebets etaperaekker", () => {
  const prior = [{ rider_id: "h1", team_id: "tA" }, { rider_id: "h2", team_id: "tB" }];
  const incidents = [
    inc("1", 2, "h1", "withdrawal", { rider: rider("h1", "Zed", "Last", { id: "tNew", name: "Sold To" }) }),
    inc("2", 2, "h2", "time_limit", { rider: rider("h2", "Amy", "First", { id: "tB", name: "Team B" }) }),
    inc("3", 1, "h3", "crash"),
    { id: "5", stage_number: 2, rider_id: "x", kind: "crash", outcome: "time_loss" },
  ];
  const rows = dnfRowsForStage(incidents, 2, teamIdByRiderFromRows(prior));
  assert.equal(rows.length, 2, "kun etape 2, kun outcome=abandon");
  assert.deepEqual(rows.map((r: { name: string | null }) => r.name), ["Amy First", "Zed Last"], "sorteret efter navn");
  assert.equal(rows[0].reasonKey, "time_limit");
  assert.equal(rows[0].team_id, "tB");
  assert.equal(rows[0].team_name, "Team B");
  assert.equal(rows[1].team_id, "tA", "loebets hold vinder over rytterens nuvaerende hold");
  assert.equal(rows[1].team_name, null, "intet forkert holdnavn");
});

test("dnfRowsForStage: uden etaperaekker (endagsloeb) bruges rytterens hold", () => {
  const rows = dnfRowsForStage([inc("1", 1, "h1", "withdrawal", { rider: rider("h1", "A", "B", { id: "tA", name: "Team A" }) })], 1);
  assert.equal(rows[0].team_id, "tA");
  assert.equal(rows[0].team_name, "Team A");
});

test("ownStageAbandons: egne udgaaede + ryttere tilbage efter etapen", () => {
  const incidents = [
    inc("1", 2, "h1", "withdrawal"),
    inc("2", 2, "h2", "withdrawal"),
    inc("3", 2, "b1", "withdrawal"),
  ];
  const teamIdByRider = teamIdByRiderFromRows([{ rider_id: "h1", team_id: "tA" }, { rider_id: "h2", team_id: "tA" }, { rider_id: "b1", team_id: "tB" }]);
  const out = ownStageAbandons({ incidents, results: stageRows, stageNumber: 2, myTeamId: "tA", teamIdByRider });
  assert.ok(out);
  assert.equal(out.abandons.length, 2);
  assert.equal(out.abandons[0].kind, "withdrawal");
  assert.equal(out.ridersLeft, 2, "a1 og a2 kom i maal paa etapen");
  assert.equal(ownStageAbandons({ incidents, results: stageRows, stageNumber: 2, myTeamId: "tC", teamIdByRider }), null);
  assert.equal(ownStageAbandons({ incidents, results: stageRows, stageNumber: 2, myTeamId: null, teamIdByRider }), null);
});

test("isNonStarterKind: skade og sygdom er DNS, alt andet er DNF", () => {
  assert.equal(isNonStarterKind("injury"), true);
  assert.equal(isNonStarterKind("illness"), true);
  for (const k of ["crash", "mechanical", "withdrawal", "time_limit", "something_new"]) assert.equal(isNonStarterKind(k), false, k);
});

test("dnfRowsForStage: ikke-startere (skade/sygdom) er DNS og staar efter dem der udgik", () => {
  const incidents = [
    inc("1", 2, "s1", "injury", { rider: rider("s1", "Anna", "Sick") }),
    inc("2", 2, "s2", "illness", { rider: rider("s2", "Bob", "Ill") }),
    inc("3", 2, "c1", "crash", { rider: rider("c1", "Zed", "Crash") }),
  ];
  const rows = dnfRowsForStage(incidents, 2);
  assert.deepEqual(rows.map((r: { status: string }) => r.status), ["dnf", "dns", "dns"]);
  assert.deepEqual(rows.map((r: { name: string | null }) => r.name), ["Zed Crash", "Anna Sick", "Bob Ill"]);
  assert.equal(rows.filter((r: { status: string }) => r.status === "dnf").length, 1, "kun styrtet taeller som 'did not finish'");
  assert.equal(rows[2].reasonKey, "illness");
});

test("ownStageAbandons: en skadet ikke-starter markeres nonStarter, ikke som udgaaet paa etapen", () => {
  const incidents = [inc("1", 2, "h1", "injury"), inc("2", 2, "h2", "withdrawal")];
  const teamIdByRider = teamIdByRiderFromRows([{ rider_id: "h1", team_id: "tA" }, { rider_id: "h2", team_id: "tA" }]);
  const out = ownStageAbandons({ incidents, results: stageRows, stageNumber: 2, myTeamId: "tA", teamIdByRider });
  assert.ok(out);
  const byId = new Map(out.abandons.map((a: { riderId: string }) => [a.riderId, a]));
  assert.deepEqual(byId.get("h1"), { riderId: "h1", rider: "R H1", kind: "injury", nonStarter: true });
  assert.equal((byId.get("h2") as { nonStarter: boolean }).nonStarter, false);
  assert.equal(out.ridersLeft, 2);
});

// ── #7701: uden for tidsgraensen, fordi han var for traet ───────────────────
const otl = (fatigue?: string[]) => ({
  type: "outside_time_limit", km: 150,
  params: { rider_ids: ["f1", "n1", "f2"], rider_count: 3, ...(fatigue ? { fatigue_rider_ids: fatigue } : {}) },
});
const limitRows = () => dnfRowsForStage([
  inc("1", 2, "f1", "time_limit", { rider: rider("f1", "Ib", "Hansen") }),
  inc("2", 2, "n1", "time_limit", { rider: rider("n1", "Bo", "Olsen") }),
  inc("3", 2, "c1", "crash", { rider: rider("c1", "Cy", "Crash") }),
], 2, teamIdByRiderFromRows([{ rider_id: "f1", team_id: "tA" }, { rider_id: "n1", team_id: "tA" }, { rider_id: "c1", team_id: "tA" }]));
const reasons = (rows: Array<{ rider_id: string | null; reasonKey: string }>) => Object.fromEntries(rows.map((r) => [r.rider_id, r.reasonKey]));

test("#7701 withTimeLimitFatigue: kun den rytter haendelsen peger paa faar aarsagen traethed", () => {
  const rows = withTimeLimitFatigue(limitRows(), [otl(["f1"])]);
  assert.deepEqual(reasons(rows), { c1: "crash", f1: "time_limit_fatigue", n1: "time_limit" });
});

test("#7701 withTimeLimitFatigue: blandet gruppe, en traet og en ikke, og et styrt der aldrig bliver traet", () => {
  const rows = withTimeLimitFatigue(limitRows(), [otl(["f1", "c1"])]);
  assert.deepEqual(reasons(rows), { c1: "crash", f1: "time_limit_fatigue", n1: "time_limit" }, "kun tidsgraense-raekker kan blive traette");
  const cast = castFrom([], [], 2, "tA");
  assert.deepEqual(ownOutSentences(rows, "tA", cast), [
    { key: "ownOut", params: { kind: "time_limit", names: "Olsen" } },
    { key: "ownOut", params: { kind: "crash", names: "Crash" } },
    { key: "ownOut", params: { kind: "time_limit_fatigue", names: "Hansen" } },
  ]);
});

test("#7701 withTimeLimitFatigue: kontakten slukket (intet fatigue_rider_ids) giver bit-identiske raekker", () => {
  const rows = limitRows();
  const before = JSON.stringify(rows);
  for (const events of [undefined, null, [], [otl()], [otl([])], [{ type: "outside_time_limit", km: 1 }], [{ type: "stage_start", params: { fatigue_rider_ids: ["f1"] } }]]) {
    const out = withTimeLimitFatigue(rows, events as never);
    assert.equal(JSON.stringify(out), before);
    assert.deepEqual(reasons(out), { c1: "crash", f1: "time_limit", n1: "time_limit" });
  }
  assert.equal(JSON.stringify(rows), before, "inputtet roeres aldrig");
  assert.equal(fatigueRiderIdsFromEvents([otl(["f1"]), otl(["f2", 7 as never])]).size, 2, "kun streng-id'er og kun fra outside_time_limit");
  assert.equal(ownOutSentences(rows, "tA", castFrom([], [], 2, "tA")).some((s) => s.params.kind === "time_limit_fatigue"), false);
});

test("#7701 Hvorfor?: traet siger traethed, ellers uaendret tekst", () => {
  const why = (reasonKey: string) => riderWhy({ riderId: "f1", rank: null, status: "dnf", reasonKey, events: [], story: null, climbs: [] });
  assert.equal(why("time_limit_fatigue").main, "timeLimitFatigue");
  assert.equal(why("time_limit_fatigue").known, true);
  assert.equal(why("time_limit").main, "timeLimit");
  assert.equal(why("withdrawal").main, "withdrawal");
});

test("#7701 teksten findes paa alle 5 sprog, uden tal og uden tankestreg", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const races = JSON.parse(readFileSync(new URL(`../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    const texts: string[] = [
      races.stagePageV2.why.main.timeLimitFatigue,
      races.detail.incidents.time_limit_fatigue,
      /time_limit_fatigue \{([^}]*)\}/.exec(races.stagePageV2.story.report.ownOut)?.[1] ?? "",
    ];
    for (const text of texts) {
      assert.ok(text.length > 5, `${lang}: mangler tekst`);
      assert.doesNotMatch(text, /\d|—|–/, `${lang}: ${text}`);
    }
    assert.notEqual(texts[0], races.stagePageV2.why.main.timeLimit, lang);
  }
});
