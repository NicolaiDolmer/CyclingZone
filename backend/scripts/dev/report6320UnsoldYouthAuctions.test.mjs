// #6320 · tests for report6320UnsoldYouthAuctions.mjs (rene funktioner, ingen database).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectExit,
  isGraduateAuction,
  currentState,
  classifyAuction,
  buildReport,
  renderPublicSummary,
  renderPrivateReport,
} from "./report6320UnsoldYouthAuctions.mjs";

const AUCTION = Object.freeze({
  id: "auc-1",
  rider_id: "rider-1",
  seller_team_id: "team-a",
  created_at: "2026-10-05T08:00:00.000Z",
  actual_end: "2026-10-06T08:00:00.000Z",
});

const exitNote = (code, at = "2026-10-06T08:00:05.000Z", relatedId = "rider-1") => ({
  id: `n-${code}-${at}`,
  related_id: relatedId,
  type: "academy_graduated",
  created_at: at,
  metadata: { messageCode: code },
});

test("detectExit: unsoldPromoted/unsold tæt på slut → promoted/released", () => {
  assert.equal(detectExit(AUCTION, [exitNote("notif.academyGraduated.unsoldPromoted")]), "promoted");
  assert.equal(detectExit(AUCTION, [exitNote("notif.academyGraduated.unsold")]), "released");
});

test("detectExit: andre beskeder, anden rytter eller langt fra slut tæller ikke", () => {
  assert.equal(detectExit(AUCTION, [exitNote("notif.academyGraduated.promote")]), null);
  assert.equal(detectExit(AUCTION, [exitNote("notif.academyGraduated.unsold", undefined, "rider-2")]), null);
  assert.equal(detectExit(AUCTION, [exitNote("notif.academyGraduated.unsold", "2026-10-08T08:00:00.000Z")]), null);
  assert.equal(detectExit(AUCTION, [exitNote("notif.academyGraduated.unsold", "2026-10-05T08:00:00.000Z")]), null);
});

test("isGraduateAuction: 'sold'-række afgjort ved oprettelse eller restemplet ved slut = graduate", () => {
  assert.equal(isGraduateAuction(AUCTION, [
    { team_id: "team-a", rider_id: "rider-1", status: "sold", resolved_at: "2026-10-05T08:00:00.500Z" },
  ]), true);
  assert.equal(isGraduateAuction(AUCTION, [
    { team_id: "team-a", rider_id: "rider-1", status: "released", resolved_at: "2026-10-06T08:00:01.000Z" },
  ]), true);
});

test("isGraduateAuction: ingen række, pending-række, andet hold eller fjern tid = ikke graduate", () => {
  assert.equal(isGraduateAuction(AUCTION, []), false);
  assert.equal(isGraduateAuction(AUCTION, [
    { team_id: "team-a", rider_id: "rider-1", status: "pending", resolved_at: null },
  ]), false);
  assert.equal(isGraduateAuction(AUCTION, [
    { team_id: "team-b", rider_id: "rider-1", status: "sold", resolved_at: "2026-10-05T08:00:00.500Z" },
  ]), false);
  assert.equal(isGraduateAuction(AUCTION, [
    { team_id: "team-a", rider_id: "rider-1", status: "promoted", resolved_at: "2026-09-01T08:00:00.000Z" },
  ]), false);
});

test("currentState dækker alle udfald", () => {
  assert.equal(currentState(AUCTION, null), "rider_missing");
  assert.equal(currentState(AUCTION, { is_retired: true, team_id: "team-a" }), "retired");
  assert.equal(currentState(AUCTION, { team_id: null }), "free_agent");
  assert.equal(currentState(AUCTION, { team_id: "team-a", is_academy: true }), "on_seller_academy");
  assert.equal(currentState(AUCTION, { team_id: "team-a", is_academy: false }), "on_seller_senior");
  assert.equal(currentState(AUCTION, { team_id: "team-c", is_academy: false }), "other_team");
});

test("classifyAuction: frivilligt salg + udgang fyrede = wrongly_exited (#6320)", () => {
  const row = classifyAuction(AUCTION, {
    rider: { team_id: null },
    gradRows: [],
    notifications: [exitNote("notif.academyGraduated.unsold")],
  });
  assert.equal(row.category, "wrongly_exited");
  assert.equal(row.exit, "released");
  assert.equal(row.state_now, "free_agent");
  assert.equal(row.after_exit_introduced, true);
});

test("buildReport + offentlig opsummering: kun tal, ingen navne/hold/id'er", () => {
  const auctions = [
    { ...AUCTION, id: "auc-1", rider_id: "rider-1" },
    { ...AUCTION, id: "auc-2", rider_id: "rider-2" },
    { ...AUCTION, id: "auc-3", rider_id: "rider-3" },
    { ...AUCTION, id: "auc-4", rider_id: "rider-4" },
  ];
  const ridersById = new Map([
    ["rider-1", { id: "rider-1", firstname: "Secret", lastname: "Name", team_id: null }],
    ["rider-2", { id: "rider-2", firstname: "Other", lastname: "Person", team_id: "team-a", is_academy: false }],
    ["rider-3", { id: "rider-3", firstname: "Grad", lastname: "Uate", team_id: null }],
    ["rider-4", { id: "rider-4", firstname: "Stay", lastname: "Ed", team_id: "team-a", is_academy: true }],
  ]);
  const gradRows = [{ team_id: "team-a", rider_id: "rider-3", status: "released", resolved_at: AUCTION.actual_end }];
  const notifications = [
    exitNote("notif.academyGraduated.unsold", undefined, "rider-1"),
    exitNote("notif.academyGraduated.unsoldPromoted", undefined, "rider-2"),
    exitNote("notif.academyGraduated.unsold", undefined, "rider-3"),
  ];
  const report = buildReport({ auctions, ridersById, gradRows, notifications });
  assert.equal(report.total, 4);
  assert.deepEqual(report.counts, { wrongly_exited: 2, graduate_exit: 1, untouched: 1 });
  assert.deepEqual(report.wronglyByExit, { promoted: 1, released: 1 });
  assert.equal(report.affectedTeams, 1);

  const summary = renderPublicSummary(report, { generatedAt: "2026-10-10T00:00:00.000Z" });
  assert.match(summary, /Frivilligt salg ramt af udgangen \(#6320\): 2/);
  for (const secret of ["Secret", "Name", "rider-1", "team-a", "auc-1"]) {
    assert.equal(summary.includes(secret), false, `offentlig opsummering lækker ${secret}`);
  }

  const teamsById = new Map([["team-a", { id: "team-a", name: "Hold A" }]]);
  const priv = renderPrivateReport(report, { generatedAt: "x", ridersById, teamsById });
  assert.match(priv, /Secret Name/);
  assert.match(priv, /Hold A/);
});
