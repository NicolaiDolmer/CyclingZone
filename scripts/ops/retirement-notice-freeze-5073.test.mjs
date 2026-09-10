// Unit-tests for #5073-maalescriptets RENE klassifikationslogik. Ingen DB, ingen
// netvaerk - samme kontrakt som de oevrige scripts/ops/*.test.mjs i CI's
// static-guards-job.
//
// Importer .lib.mjs, ALDRIG .mjs: static-guards koerer uden `npm ci`, og
// .mjs-scriptet importerer @supabase/supabase-js paa topniveau. Ryger den import
// ind i denne kaede, fejler jobbet med ERR_MODULE_NOT_FOUND i CI selvom testen
// passerer lokalt hvor node_modules findes.

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRider,
  buildFreezeReport,
  buildFreezeRows,
  legacyAnnouncedRetirementAfterSeason,
} from "./retirement-notice-freeze-5073.lib.mjs";
import { announcedRetirementAfterSeason } from "../../backend/lib/riderProgression.js";

// Saeson 3 = referenceaar 2028 (LAUNCH_REFERENCE_YEAR 2026).
const S3 = 3;
const bornForAge = (age) => `${2028 - age}-06-01`;

test("uden for det seedede vindue er legacy og nuvaerende ALTID enige", () => {
  for (const age of [20, 30, 35, 40, 44]) {
    for (const id of ["a1", "b2", "c3", "d4", "e5"]) {
      const rider = { id, birthdate: bornForAge(age) };
      const c = classifyRider(rider, S3);
      assert.equal(c.inSeededWindow, false, `alder ${age} burde ligge uden for vinduet`);
      assert.equal(c.diverged, false, `alder ${age}, id ${id} divergerede uden for vinduet`);
    }
  }
});

test("i vinduet (36-39) kan de to hash-varianter give forskellige svar", () => {
  // Beviser at divergensen er REEL og ikke en tilfaeldighed i en enkelt raekke:
  // over et bredt id-udsnit skal mindst ét udfald vaere forskelligt.
  let diverged = 0;
  for (let i = 0; i < 400; i++) {
    const rider = { id: `rider-${i}`, birthdate: bornForAge(36 + (i % 4)) };
    if (classifyRider(rider, S3).diverged) diverged += 1;
  }
  assert.ok(diverged > 0, "forventede mindst én divergens i det seedede vindue");
});

test("classifyRider's 'current' er motorens egen funktion, ikke en kopi", () => {
  const rider = { id: "rider-42", birthdate: bornForAge(38) };
  assert.equal(classifyRider(rider, S3).current, announcedRetirementAfterSeason(rider, S3));
});

test("manglende foedselsdato eller id giver aldrig et gaet", () => {
  assert.equal(legacyAnnouncedRetirementAfterSeason({ id: "x" }, S3), false);
  assert.equal(legacyAnnouncedRetirementAfterSeason({ birthdate: "1990-01-01" }, S3), false);
  const c = classifyRider({ id: "x" }, S3);
  assert.equal(c.diverged, false);
  assert.equal(c.inSeededWindow, false);
});

test("buildFreezeReport taeller menneskehold separat og lister kun divergenser", () => {
  const riders = [
    { id: "young", firstname: "Ung", lastname: "Rytter", birthdate: bornForAge(24), team_id: "t1", teamName: "Hold 1", isHuman: true },
    { id: "old", firstname: "Gammel", lastname: "Rytter", birthdate: bornForAge(41), team_id: "t1", teamName: "Hold 1", isHuman: true },
  ];
  const report = buildFreezeReport(riders, S3);
  assert.equal(report.activeSeason, S3);
  assert.equal(report.totals.ridersScanned, 2);
  assert.equal(report.totals.inSeededWindow, 0);
  assert.equal(report.totals.diverged, 0);
  assert.deepEqual(report.diverged, []);
  // 41-aarige er garanteret pension i BEGGE varianter.
  assert.equal(report.totals.legacyAnnounced, 1);
  assert.equal(report.totals.currentAnnounced, 1);
});

test("buildFreezeRows daekker HELE populationen og foelger --source i vinduet", () => {
  const riders = [
    { id: "w1", birthdate: bornForAge(37), isHuman: true },
    { id: "w2", birthdate: bornForAge(39), isHuman: true },
    { id: "young", birthdate: bornForAge(22), isHuman: true },
    { id: "guaranteed", birthdate: bornForAge(42), isHuman: true },
  ];
  const now = "2026-09-10T14:00:00.000Z";
  const legacy = buildFreezeRows(riders, S3, "legacy", now);
  const current = buildFreezeRows(riders, S3, "current", now);

  // ALLE ryttere faar en raekke: efter koerslen er saeson 3 besvaret for hele
  // populationen, saa hverken cutover eller rytterkortet behoever rulle igen.
  assert.deepEqual(legacy.map((r) => r.riderId).sort(), ["guaranteed", "w1", "w2", "young"]);

  const byId = (rows, id) => rows.find((r) => r.riderId === id);
  assert.equal(byId(legacy, "w1").announced,
    legacyAnnouncedRetirementAfterSeason({ id: "w1", birthdate: bornForAge(37) }, S3));
  assert.equal(byId(current, "w1").announced,
    announcedRetirementAfterSeason({ id: "w1", birthdate: bornForAge(37) }, S3));

  // Uden for vinduet er kilden ligegyldig: en alders-regel uden rul.
  for (const id of ["young", "guaranteed"]) {
    assert.equal(byId(legacy, id).announced, byId(current, id).announced,
      `${id} burde give samme svar uanset kilde`);
  }
  assert.equal(byId(legacy, "young").announced, false);
  assert.equal(byId(legacy, "guaranteed").announced, true);
});

test("buildFreezeRows' patch matcher kolonne-kontrakten (ja faar dato, nej faar ikke)", () => {
  const now = "2026-09-10T14:00:00.000Z";
  const rows = buildFreezeRows(
    [{ id: "young", birthdate: bornForAge(22) }, { id: "guaranteed", birthdate: bornForAge(42) }],
    S3, "legacy", now,
  );
  const young = rows.find((r) => r.riderId === "young");
  const old = rows.find((r) => r.riderId === "guaranteed");

  assert.deepEqual(young.patch, {
    retirement_notice_season: S3,
    retirement_notice_after_season: null,
    retirement_notice_given_at: null,
  });
  assert.deepEqual(old.patch, {
    retirement_notice_season: S3,
    retirement_notice_after_season: S3,
    retirement_notice_given_at: now,
  });
});

test("buildFreezeRows afviser en ukendt kilde", () => {
  assert.throws(() => buildFreezeRows([], S3, "whatever"), /ukendt --source/);
});

test("frie agenter (team_id null) er med i populationen og taelles for sig", () => {
  // Populationen skal inkludere transfermarked/auktion - det er dem koebere
  // traeffer beslutninger om (#5073's thelamba-case). Vi vaelger et id der rent
  // faktisk divergerer, saa taellingen kan verificeres.
  let freeId = null;
  for (let i = 0; i < 400 && !freeId; i++) {
    const cand = { id: `fa-${i}`, birthdate: bornForAge(38) };
    if (classifyRider(cand, S3).diverged) freeId = cand.id;
  }
  assert.ok(freeId, "kunne ikke finde en divergerende test-rytter");

  const riders = [
    { id: freeId, firstname: "Fri", lastname: "Agent", birthdate: bornForAge(38), team_id: null, isHuman: false },
  ];
  const report = buildFreezeReport(riders, S3);
  assert.equal(report.totals.inSeededWindow, 1);
  assert.equal(report.totals.freeAgentInSeededWindow, 1);
  assert.equal(report.totals.humanInSeededWindow, 0);
  assert.equal(report.totals.diverged, 1);
  assert.equal(report.totals.freeAgentDiverged, 1);
  assert.equal(report.diverged[0].isFreeAgent, true);
  // Frie agenter skal ogsaa have en raekke i frysningen.
  assert.deepEqual(buildFreezeRows(riders, S3, "legacy").map((r) => r.riderId), [freeId]);
});
