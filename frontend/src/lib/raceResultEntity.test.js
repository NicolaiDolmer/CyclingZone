import test from "node:test";
import assert from "node:assert/strict";
import { resultEntity, isTeamResult } from "./raceResultEntity.js";

test("resultEntity: rytter-række med joinet rider → navn + link + nationalitet", () => {
  const row = {
    result_type: "gc",
    rank: 1,
    rider_id: "r1",
    rider_name: "Old Name",
    team_id: "t1",
    rider: { id: "r1", firstname: "Mads", lastname: "Mortensen", nationality_code: "DK", team: { id: "t1", name: "Skjern" } },
  };
  const e = resultEntity(row);
  assert.equal(e.kind, "rider");
  assert.equal(e.name, "Mads Mortensen");
  assert.equal(e.linkId, "r1");
  assert.equal(e.nationality, "DK");
});

test("resultEntity: rytter-række uden join falder tilbage til rider_name", () => {
  const row = { result_type: "stage", rank: 2, rider_id: "r2", rider_name: "Jonas Holm", team_id: "t1", rider: null };
  const e = resultEntity(row);
  assert.equal(e.kind, "rider");
  assert.equal(e.name, "Jonas Holm");
  assert.equal(e.linkId, null);
  assert.equal(e.nationality, null);
});

test("resultEntity: team-række (result_type=team) med joinet team → holdnavn + holdlink", () => {
  const row = {
    result_type: "team", rank: 1, rider_id: null, rider_name: null,
    team_id: "t1", team_name: null, rider: null, team: { id: "t1", name: "Skjern Cycling" },
  };
  const e = resultEntity(row);
  assert.equal(e.kind, "team");
  assert.equal(e.name, "Skjern Cycling");
  assert.equal(e.linkId, "t1");
  assert.equal(e.nationality, null);
});

test("resultEntity: team-række uden team-join bruger denormaliseret team_name, ellers null (aldrig crash)", () => {
  const withName = resultEntity({ result_type: "team", rank: 2, rider_id: null, team_id: "t2", team_name: "Vossan Pro" });
  assert.equal(withName.kind, "team");
  assert.equal(withName.name, "Vossan Pro");
  assert.equal(withName.linkId, "t2");

  const bare = resultEntity({ result_type: "team", rank: 3, rider_id: null, team_id: "t3" });
  assert.equal(bare.kind, "team");
  assert.equal(bare.name, null, "ukendt holdnavn → null (komponent renderer '—')");
  assert.equal(bare.linkId, "t3");
});

test("resultEntity: rider_id null + team_id sat behandles som team selv uden result_type", () => {
  const e = resultEntity({ rank: 1, rider_id: null, team_id: "t9", team: { id: "t9", name: "Nordby" } });
  assert.equal(e.kind, "team");
  assert.equal(e.name, "Nordby");
});

test("resultEntity: tom/uventet række crasher ikke", () => {
  const e = resultEntity({});
  assert.equal(e.kind, "rider");
  assert.equal(e.name, null);
  assert.equal(e.linkId, null);
});

test("isTeamResult: skelner team-rækker fra rytter-rækker", () => {
  assert.equal(isTeamResult({ result_type: "team" }), true);
  assert.equal(isTeamResult({ rider_id: null, team_id: "t1" }), true);
  assert.equal(isTeamResult({ result_type: "gc", rider_id: "r1", team_id: "t1" }), false);
});
