// #6050: tekstvalget for "hvem hentede udbruddet" i film, recap og etaperapport.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { catchActor, catchActorCopy, findMorningCatch, timelineDistanceKm } from "./raceCatchActor.js";
import { describeEvent } from "./stageTimelineFilm.js";
import { buildRaceRecap } from "./raceRecap.js";
import { buildRaceReport, BEAT_VARIANT_COUNTS } from "./raceReport.js";

const riderNameById = new Map([["r1", "Ada Pedersen"], ["r2", "Mikkel Hansen"], ["r9", "Jonas Berg"]]);
const teamNameById = new Map([["t1", "Team A"], ["t2", "Team B"]]);

const formed = { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["r1", "r2"] } };
const start = { km: 0, type: "stage_start", params: { field_count: 120, distance_km: 180 } };
const caughtV4 = (extra) => ({ km: 176, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["r1", "r2"], chase_group_id: "peloton-0", ...extra } });

test("catchActor: hold med jagt-arbejde navngives, km til mål afrundes", () => {
  const actor = catchActor(caughtV4({ chase_group_kind: "peloton", chasing_team_ids: ["t1", "t2"] }), { teamNameById, distanceKm: 180 });
  assert.deepEqual(actor, { kind: "teams", teams: "Team A, Team B", teamCount: 2, km: 4 });
});

test("catchActor: ukendte hold-navne falder tilbage til feltet, aldrig et råt id", () => {
  const actor = catchActor(caughtV4({ chase_group_kind: "peloton", chasing_team_ids: ["t-unknown"] }), { teamNameById, distanceKm: 180 });
  assert.deepEqual(actor, { kind: "peloton", km: 4 });
});

test("catchActor: jagtgruppe uden hold-ordre og ældre events giver null", () => {
  assert.equal(catchActor(caughtV4({ chase_group_kind: "chase" }), { teamNameById }), null);
  assert.equal(catchActor({ km: 120, type: "breakaway_caught", params: { rider_ids: ["r1"] } }, { teamNameById }), null);
});

test("catchActor: hentet på stregen giver ingen km", () => {
  const actor = catchActor({ ...caughtV4({ chase_group_kind: "peloton" }), km: 179.8 }, { distanceKm: 180 });
  assert.deepEqual(actor, { kind: "peloton", km: null });
});

test("findMorningCatch springer et senere angrebs catch over", () => {
  const counter = { km: 60, type: "breakaway_caught", params: { group_id: "breakaway-9", rider_ids: ["r9"] } };
  const morning = caughtV4({ chase_group_kind: "peloton" });
  assert.equal(findMorningCatch([start, formed, counter, morning]), morning);
  assert.equal(timelineDistanceKm([start]), 180);
});

test("describeEvent: film-linjen navngiver holdene, ellers feltet, ellers den gamle linje", () => {
  const teams = describeEvent(caughtV4({ chase_group_kind: "peloton", chasing_team_ids: ["t1"] }), { riderNameById, teamNameById });
  assert.equal(teams.key, "breakaway_caught_by_teams");
  assert.equal(teams.params.teams, "Team A");
  assert.equal(teams.params.count, 2);
  assert.equal(describeEvent(caughtV4({ chase_group_kind: "peloton" }), { riderNameById, teamNameById }).key, "breakaway_caught_by_peloton");
  assert.equal(describeEvent(caughtV4({ chase_group_kind: "chase" }), { riderNameById, teamNameById }).key, "breakaway_caught");
  // RaceCentrePage sender ikke teamNameById: hold kan ikke navngives → feltet.
  assert.equal(describeEvent(caughtV4({ chase_group_kind: "peloton", chasing_team_ids: ["t1"] }), { riderNameById }).key, "breakaway_caught_by_peloton");
});

const stageRows = [
  { result_type: "stage", stage_number: 1, rank: 1, rider_id: "r9", rider_name: "Jonas Berg", finish_time: "+0:00", in_breakaway: false },
  { result_type: "stage", stage_number: 1, rank: 2, rider_id: "r3", rider_name: "Sofie Lund", finish_time: "+0:00", in_breakaway: false },
  { result_type: "stage", stage_number: 1, rank: 30, rider_id: "r1", rider_name: "Ada Pedersen", finish_time: "+0:40", in_breakaway: true, breakaway_caught: true },
  { result_type: "stage", stage_number: 1, rank: 31, rider_id: "r2", rider_name: "Mikkel Hansen", finish_time: "+0:40", in_breakaway: true, breakaway_caught: true },
];
const scope = { type: "stage", stageNumber: 1 };

test("buildRaceRecap: aktør-linje med km når tidslinjen bærer den", () => {
  const events = [start, formed, caughtV4({ chase_group_kind: "peloton", chasing_team_ids: ["t2"] })];
  const caught = buildRaceRecap({ results: stageRows, scope, timelineEvents: events, teamNameById }).find((m) => m.key.startsWith("breakawayCaught"));
  assert.deepEqual(caught, { key: "breakawayCaughtByTeamsKm", params: { count: 2, teams: "Team B", teamCount: 1, km: 4 } });
});

test("buildRaceRecap: uden tidslinje eller felter er linjen uændret", () => {
  const plain = buildRaceRecap({ results: stageRows, scope }).find((m) => m.key.startsWith("breakawayCaught"));
  assert.deepEqual(plain, { key: "breakawayCaught", params: { count: 2 } });
  const old = buildRaceRecap({ results: stageRows, scope, timelineEvents: [start, formed, { km: 150, type: "breakaway_caught", params: { rider_ids: ["r1", "r2"] } }], teamNameById })
    .find((m) => m.key.startsWith("breakawayCaught"));
  assert.equal(old.key, "breakawayCaught");
});

test("buildRaceReport: breakaway_caught-beat skifter til aktør-nøgle med færdige params", () => {
  const moments = [
    { stage_number: 1, moment_key: "sprint_win", params: { riderId: "r9" }, rider_ids: ["r9"], significance: 60 },
    { stage_number: 1, moment_key: "breakaway_caught", params: { count: 2 }, rider_ids: [], significance: 35 },
  ];
  const events = [start, formed, caughtV4({ chase_group_kind: "peloton" })];
  const withActor = buildRaceReport({ raceId: "race-x", stageNumber: 1, moments, timelineEvents: events, teamNameById });
  const beat = withActor.beats.find((b) => b.moment.moment_key === "breakaway_caught");
  assert.equal(beat.beatKey, "breakaway_caught_by_peloton_km");
  assert.equal(beat.variant, 0);
  assert.deepEqual(beat.params, { count: 2, km: 4 });
  const without = buildRaceReport({ raceId: "race-x", stageNumber: 1, moments }).beats.find((b) => b.moment.moment_key === "breakaway_caught");
  assert.equal(without.beatKey, "breakaway_caught");
  assert.equal(without.params, undefined);
});

test("catchActorCopy: beat- og recap-familier giver nøgler der findes i en+da", () => {
  for (const lang of ["en", "da"]) {
    const races = JSON.parse(readFileSync(new URL(`../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    for (const key of ["breakaway_caught_by_teams", "breakaway_caught_by_peloton"]) assert.ok(races.detail.film.event[key], `${lang} film ${key}`);
    for (const suffix of ["", "Km"]) {
      for (const base of ["breakawayCaughtByTeams", "breakawayCaughtByPeloton"]) assert.ok(races.detail.recap[`${base}${suffix}`], `${lang} recap ${base}${suffix}`);
    }
    for (const key of Object.keys(BEAT_VARIANT_COUNTS).filter((k) => k.startsWith("breakaway_caught_by"))) {
      assert.ok(races.detail.report.beat[key]?.v1, `${lang} beat ${key}`);
    }
  }
  assert.equal(catchActorCopy(null, {}), null);
});
