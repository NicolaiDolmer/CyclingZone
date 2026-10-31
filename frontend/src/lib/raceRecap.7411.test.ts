// #7411: udgaaede i etapeloeb synlige (aarsag, DNF-raekker, samlet linje, dit hold).
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRaceRecap,
  incidentReasonKey,
  withdrawalGroupMoment,
  dnfRowsForStage,
  ownStageAbandons,
  teamIdByRiderFromRows,
} from "./raceRecap.js";

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
