import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRetentionCohorts, weekStartUTC, cohortCutoff } from "./retentionScorecard.js";

const NOW = new Date("2026-07-11T12:00:00Z"); // fredag

test("weekStartUTC finder mandag 00:00 UTC for enhver ugedag", () => {
  assert.equal(weekStartUTC(new Date("2026-07-11T12:00:00Z")).toISOString(), "2026-07-06T00:00:00.000Z"); // fre
  assert.equal(weekStartUTC(new Date("2026-07-06T00:00:00Z")).toISOString(), "2026-07-06T00:00:00.000Z"); // man selv
  assert.equal(weekStartUTC(new Date("2026-07-12T23:59:00Z")).toISOString(), "2026-07-06T00:00:00.000Z"); // søn
});

test("cohortCutoff clamper weeks til [1,52] og regner tilbage fra ugestart", () => {
  assert.equal(cohortCutoff(NOW, 1).toISOString(), "2026-07-06T00:00:00.000Z");
  assert.equal(cohortCutoff(NOW, 8).toISOString(), "2026-05-18T00:00:00.000Z");
  assert.equal(cohortCutoff(NOW, 0).toISOString(), cohortCutoff(NOW, 8).toISOString()); // 0 -> default 8
  assert.equal(cohortCutoff(NOW, 999).toISOString(), cohortCutoff(NOW, 52).toISOString()); // clamp top
});

test("computeRetentionCohorts: rolling D1/D7/D30 med eligibility-gate", () => {
  const users = [
    // Signet op for 40 dage siden, aktiv helt op til nu -> retained på alle tre.
    { id: "u1", created_at: "2026-06-01T00:00:00Z", last_seen: "2026-07-10T00:00:00Z" },
    // Signet op for 40 dage siden, INGEN aktivitet efter dag 0 -> churned på alle tre.
    { id: "u2", created_at: "2026-06-01T00:00:00Z", last_seen: "2026-06-01T00:05:00Z" },
    // Signet op for 3 dage siden -> D1 eligible+returned, D7/D30 slet ikke eligible endnu.
    { id: "u3", created_at: "2026-07-08T00:00:00Z", last_seen: "2026-07-10T00:00:00Z" },
  ];
  const eventMaxByUser = new Map([
    ["u1", "2026-07-09T00:00:00Z"], // event senere end last_seen for u2 ville ellers batte, men u2 har intet event
  ]);

  const result = computeRetentionCohorts(users, eventMaxByUser, { now: NOW, weeks: 8 });
  assert.equal(result.weeks, 8);

  const juneCohort = result.cohorts.find(c => c.cohort_week === "2026-06-01");
  assert.equal(juneCohort.cohort_size, 2);
  assert.equal(juneCohort.d1_eligible, 2);
  assert.equal(juneCohort.d1_returned, 1); // kun u1
  assert.equal(juneCohort.d30_eligible, 2);
  assert.equal(juneCohort.d30_returned, 1);
  assert.equal(juneCohort.d1_pct, 50);
  assert.equal(juneCohort.d30_pct, 50);

  const julyCohort = result.cohorts.find(c => c.cohort_week === "2026-07-06");
  assert.equal(julyCohort.cohort_size, 1);
  assert.equal(julyCohort.d1_eligible, 1);
  assert.equal(julyCohort.d1_returned, 1);
  assert.equal(julyCohort.d7_eligible, 0); // signup + 7d > now endnu
  assert.equal(julyCohort.d7_pct, null);
  assert.equal(julyCohort.d30_pct, null);
});

test("computeRetentionCohorts: rolling retention er monotont — D1_pct >= D7_pct >= D30_pct", () => {
  const users = [
    { id: "a", created_at: "2026-05-01T00:00:00Z", last_seen: "2026-05-04T00:00:00Z" }, // kun D1
    { id: "b", created_at: "2026-05-01T00:00:00Z", last_seen: "2026-05-09T00:00:00Z" }, // D1+D7
    { id: "c", created_at: "2026-05-01T00:00:00Z", last_seen: "2026-06-05T00:00:00Z" }, // D1+D7+D30
    { id: "d", created_at: "2026-05-01T00:00:00Z", last_seen: "2026-05-01T00:00:00Z" }, // ingen
  ];
  const { cohorts } = computeRetentionCohorts(users, new Map(), { now: NOW, weeks: 12 });
  const c = cohorts.find(c => c.cohort_week === "2026-04-27");
  assert.ok(c.d1_pct >= c.d7_pct && c.d7_pct >= c.d30_pct, `forventede D1>=D7>=D30, fik ${JSON.stringify(c)}`);
  assert.equal(c.d1_returned, 3);
  assert.equal(c.d7_returned, 2);
  assert.equal(c.d30_returned, 1);
});

test("computeRetentionCohorts: kohorter ældre end weeks-vinduet ekskluderes; tomme/ugyldige rows ignoreres", () => {
  const users = [
    { id: "old", created_at: "2026-01-01T00:00:00Z", last_seen: "2026-01-02T00:00:00Z" }, // langt uden for 8-ugers-vindue
    { id: "no-id" }, // ugyldig, springes over
    { id: "no-created" }, // ugyldig, springes over
    { id: "recent", created_at: "2026-07-06T00:00:00Z", last_seen: "2026-07-06T00:00:00Z" },
  ];
  const result = computeRetentionCohorts(users, new Map(), { now: NOW, weeks: 8 });
  const weeks = result.cohorts.map(c => c.cohort_week);
  assert.ok(!weeks.includes("2025-12-29"), "gammel kohorte uden for vinduet skal ikke med");
  assert.equal(result.cohorts.reduce((s, c) => s + c.cohort_size, 0), 1); // kun "recent"
});

test("computeRetentionCohorts: eventMaxByUser kan redde retention når last_seen er forældet", () => {
  // last_seen blev sat tidligt, men brugeren har et player_event langt senere
  // (fx presence-throttling ramte, men et game-event blev alligevel logget).
  const users = [
    { id: "u1", created_at: "2026-06-01T00:00:00Z", last_seen: "2026-06-01T00:10:00Z" },
  ];
  const eventMaxByUser = new Map([["u1", "2026-07-05T00:00:00Z"]]); // 34 dage efter signup
  const { cohorts } = computeRetentionCohorts(users, eventMaxByUser, { now: NOW, weeks: 8 });
  const c = cohorts.find(c => c.cohort_week === "2026-06-01");
  assert.equal(c.d30_returned, 1);
  assert.equal(c.d30_pct, 100);
});

test("computeRetentionCohorts: tom input giver tom kohorte-liste, ikke fejl", () => {
  assert.deepEqual(computeRetentionCohorts([], new Map(), { now: NOW }).cohorts, []);
  assert.deepEqual(computeRetentionCohorts(null, new Map(), { now: NOW }).cohorts, []);
});
