import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDashboardSquadStats, getSquadLimits } from "./dashboardSquadStats.js";

const ME = "team-me";
const RIVAL = "team-rival";

test("getSquadLimits — fallback til division 3 ved ukendt division", () => {
  assert.deepEqual(getSquadLimits(1), { min: 20, max: 30 });
  assert.deepEqual(getSquadLimits(2), { min: 14, max: 20 });
  assert.deepEqual(getSquadLimits(3), { min: 8, max: 10 });
  assert.deepEqual(getSquadLimits(undefined), { min: 8, max: 10 });
  assert.deepEqual(getSquadLimits(null), { min: 8, max: 10 });
});

test("computeDashboardSquadStats — ingen pending, ingen lån = ownedNow = futureRiderCount", () => {
  const riders = Array.from({ length: 9 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 9);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.futureRiderCount, 9);
  assert.equal(stats.warning, null);
});

test("computeDashboardSquadStats — pending-incoming inkluderes (#250 hovedrapport)", () => {
  // Bug #250: køber har 6 ejede + 2 vundne auktioner i sæson 0 (pending_team_id=mig på 2 separate ryttere).
  // Tidligere var dette undertælling i nogle UI-elementer — nu skal future = 6 + 2 = 8.
  const riders = Array.from({ length: 6 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 2,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 6);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.pendingIncomingCount, 2);
  assert.equal(stats.futureRiderCount, 8);
  assert.equal(stats.warning, null, "8 ryttere i D3 = på minimum, ingen warning");
});

test("computeDashboardSquadStats — pending-outgoing trækkes fra (#250 sæson 0 sælger-side)", () => {
  // I sæson 0 har sælger pending_team_id=køber på en rytter der venter på vindue.
  // Når vinduet lukker, sælges den. Squad-warning skal forudsige fremtidens hold.
  const riders = [
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: null },
    { pending_team_id: RIVAL }, // pending-out
    { pending_team_id: RIVAL }, // pending-out
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 9);
  assert.equal(stats.outgoingCount, 2);
  assert.equal(stats.futureRiderCount, 7, "9 - 2 udgående = 7");
  assert.equal(stats.warning?.type, "under", "7 i D3 < min 8 = warning");
  assert.match(stats.warning.msg, /Køb 1 ryttere mere/);
});

test("computeDashboardSquadStats — pending-out som peger på MIT eget hold tæller IKKE som outgoing", () => {
  // Edge: hvis pending_team_id == myTeamId (= rytteren er allerede ejet og venter på en self-finalize-flow),
  // så er det ikke udgående. Skal beholdes i ownedNow uden subtraktion.
  const riders = [
    { pending_team_id: null },
    { pending_team_id: ME }, // self-pending = ikke udgående
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 2);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.futureRiderCount, 2);
});

test("computeDashboardSquadStats — pending-in + pending-out i samme hold (deadline day)", () => {
  // Klassisk deadline-day: 9 ejede inkl. 2 pending-out + 2 pending-in.
  // Fremtidens hold = 9 - 2 + 2 = 9. På D3 max-1.
  const riders = [
    ...Array.from({ length: 7 }, () => ({ pending_team_id: null })),
    { pending_team_id: RIVAL },
    { pending_team_id: RIVAL },
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 2,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 9);
  assert.equal(stats.outgoingCount, 2);
  assert.equal(stats.futureRiderCount, 9);
  assert.equal(stats.warning, null);
});

test("computeDashboardSquadStats — over-cap warning ved D3 cap=10", () => {
  const riders = Array.from({ length: 9 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 2, // 9 + 2 = 11, over D3 max 10
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.futureRiderCount, 11);
  assert.equal(stats.warning?.type, "over");
  assert.match(stats.warning.msg, /Sælg 1 ryttere/);
});

test("computeDashboardSquadStats — falsk over-warning fjernes når pending-out tager holdet ned i cap", () => {
  // Før #250 fix: 11 ejede + 1 pending-out → riderCount=11, warning "over" trods at fremtidens hold er 10.
  const riders = [
    ...Array.from({ length: 10 }, () => ({ pending_team_id: null })),
    { pending_team_id: RIVAL },
  ];
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 11);
  assert.equal(stats.outgoingCount, 1);
  assert.equal(stats.futureRiderCount, 10, "= D3 max, ingen warning");
  assert.equal(stats.warning, null);
});

test("computeDashboardSquadStats — aktive lån tæller med i squad-størrelsen", () => {
  // Lejede-ind-ryttere er squad-medlemmer ift. cap. Skal med i futureRiderCount.
  const riders = Array.from({ length: 8 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    activeLoanCount: 3, // 8 + 3 = 11, over D3 max 10
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.futureRiderCount, 11);
  assert.equal(stats.warning?.type, "over");
});

test("computeDashboardSquadStats — division 1 cap=30 + warning under 20", () => {
  const riders = Array.from({ length: 19 }, () => ({ pending_team_id: null }));
  const stats = computeDashboardSquadStats({
    riders,
    pendingIncomingCount: 0,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 1,
  });
  assert.equal(stats.futureRiderCount, 19);
  assert.equal(stats.warning?.type, "under");
  assert.match(stats.warning.msg, /min 20 i Division 1/);
});

test("computeDashboardSquadStats — tom riders-array (nyt hold)", () => {
  const stats = computeDashboardSquadStats({
    riders: [],
    pendingIncomingCount: 0,
    activeLoanCount: 0,
    myTeamId: ME,
    division: 3,
  });
  assert.equal(stats.ownedNow, 0);
  assert.equal(stats.outgoingCount, 0);
  assert.equal(stats.futureRiderCount, 0);
  assert.equal(stats.warning?.type, "under");
});
