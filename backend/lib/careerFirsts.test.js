// Maiden Win Engine (#3398) — tests for career-firsts detection.
// Covers: (1) ren kandidat-udtrækning (pickCareerFirstCandidates), (2)
// idempotens (gen-finalisering må ALDRIG duplikere et event — issue-kravet),
// (3) etapeløbs-scoping (en TIDLIGERE etapes ægte sejr i samme løb tæller som
// "prior" for en SENERE etapes vinder), (4) klub-milepæle.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pickCareerFirstCandidates,
  detectCareerFirsts,
  CAREER_EVENT_TYPES,
  CAREER_MILESTONE_TYPE,
} from "./careerFirsts.js";

// ── Fake supabase: generisk filter-builder over en in-memory rækkeliste ─────
function makeQueryBuilder(rows) {
  const state = { eqs: [], ins: [], ltes: [], neqs: [], limit: null, headCount: false };
  const b = {
    select(_cols, opts) {
      if (opts?.head) state.headCount = true;
      return b;
    },
    eq(col, val) { state.eqs.push([col, val]); return b; },
    in(col, vals) { state.ins.push([col, vals]); return b; },
    lte(col, val) { state.ltes.push([col, val]); return b; },
    neq(col, val) { state.neqs.push([col, val]); return b; },
    limit(n) { state.limit = n; return b; },
    then(resolve, reject) {
      try {
        let filtered = rows.filter((r) =>
          state.eqs.every(([c, v]) => r[c] === v)
          && state.ins.every(([c, vs]) => vs.includes(r[c]))
          && state.ltes.every(([c, v]) => r[c] <= v)
          && state.neqs.every(([c, v]) => r[c] !== v));
        if (state.headCount) {
          resolve({ count: filtered.length, error: null });
          return;
        }
        if (state.limit != null) filtered = filtered.slice(0, state.limit);
        resolve({ data: filtered, error: null });
      } catch (e) { reject(e); }
    },
  };
  return b;
}

function makeFakeSupabase({ raceResultsFixture = [], ridersFixture = [] } = {}) {
  const careerEvents = [];
  function from(table) {
    if (table === "race_results") return makeQueryBuilder(raceResultsFixture);
    if (table === "riders") return makeQueryBuilder(ridersFixture);
    if (table === "rider_career_events") {
      const b = makeQueryBuilder(careerEvents);
      b.insert = (row) => {
        const rowsToInsert = Array.isArray(row) ? row : [row];
        for (const r of rowsToInsert) {
          if (careerEvents.some((e) => e.dedupe_key === r.dedupe_key)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
          }
          careerEvents.push({ ...r });
        }
        return Promise.resolve({ error: null });
      };
      return b;
    }
    throw new Error(`makeFakeSupabase: unexpected table "${table}"`);
  }
  return { from, careerEvents };
}

const noopNotify = async () => ({ delivered: true });

// ── pickCareerFirstCandidates (ren logik) ───────────────────────────────────

test("pickCareerFirstCandidates: udleder win/podium/jersey-kandidater fra resultRows", () => {
  const resultRows = [
    { rider_id: "r1", team_id: "tA", rider_name: "Jonas Krogh", team_name: "Team A", result_type: "stage", rank: 1, stage_number: 3 },
    { rider_id: "r2", team_id: "tA", rider_name: "Second Rider", team_name: "Team A", result_type: "stage", rank: 2, stage_number: 3 },
    { rider_id: "r3", team_id: "tB", rider_name: "Third Rider", team_name: "Team B", result_type: "stage", rank: 3, stage_number: 3 },
    { rider_id: "r4", team_id: "tB", rider_name: "Points Winner", team_name: "Team B", result_type: "points", rank: 1, stage_number: 3 },
    { rider_id: "r5", team_id: "tB", rider_name: "Midpack", team_name: "Team B", result_type: "stage", rank: 40, stage_number: 3 },
  ];
  const { wins, podiums, jerseys } = pickCareerFirstCandidates({ resultRows });
  assert.equal(wins.length, 1);
  assert.equal(wins[0].riderId, "r1");
  // podium includes rank 1-3 (r1, r2, r3) — r5 (rank 40) excluded.
  assert.equal(podiums.length, 3);
  assert.deepEqual(podiums.map((p) => p.riderId).sort(), ["r1", "r2", "r3"]);
  assert.equal(jerseys.length, 1);
  assert.equal(jerseys[0].riderId, "r4");
  assert.equal(jerseys[0].resultType, "points");
});

test("pickCareerFirstCandidates: tom resultRows giver tomme lister", () => {
  const { wins, podiums, jerseys } = pickCareerFirstCandidates({ resultRows: [] });
  assert.deepEqual(wins, []);
  assert.deepEqual(podiums, []);
  assert.deepEqual(jerseys, []);
});

// ── detectCareerFirsts: maiden win + idempotens ─────────────────────────────

test("detectCareerFirsts: debutantens sejr registreres som maiden_win", async () => {
  const race = { id: "race-1", name: "GP Debut" };
  const resultRows = [
    { rider_id: "r1", team_id: "tA", rider_name: "Jonas Krogh", team_name: "Team A", result_type: "stage", rank: 1, stage_number: 1 },
  ];
  const supabase = makeFakeSupabase({ raceResultsFixture: [], ridersFixture: [{ id: "r1", birthdate: "2005-03-01" }] });

  const stats = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], seasonNumber: 1, notify: noopNotify });

  assert.equal(stats.detected, 1);
  assert.equal(supabase.careerEvents.length, 1);
  assert.equal(supabase.careerEvents[0].event_type, CAREER_EVENT_TYPES.MAIDEN_WIN);
  assert.equal(supabase.careerEvents[0].rider_id, "r1");
  assert.equal(supabase.careerEvents[0].dedupe_key, "rider:r1:maiden_win");
  // age udledt af birthdate + seasonNumber (LAUNCH_REFERENCE_YEAR=2026, sæson 1 → 2026).
  assert.equal(supabase.careerEvents[0].params.age, 21);
});

test("detectCareerFirsts: re-finalisering (samme kald igen) dubler IKKE eventet", async () => {
  const race = { id: "race-1", name: "GP Debut" };
  const resultRows = [
    { rider_id: "r1", team_id: "tA", rider_name: "Jonas Krogh", team_name: "Team A", result_type: "stage", rank: 1, stage_number: 1 },
  ];
  const supabase = makeFakeSupabase({ raceResultsFixture: [], ridersFixture: [] });

  const first = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify: noopNotify });
  const second = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify: noopNotify });

  assert.equal(first.detected, 1);
  assert.equal(second.detected, 0); // dedup_key allerede fundet → ingen ny insert
  assert.equal(supabase.careerEvents.length, 1);
});

test("detectCareerFirsts: rytter med tidligere sejr i ANDET løb får IKKE maiden_win", async () => {
  const race = { id: "race-2", name: "GP To" };
  const resultRows = [
    { rider_id: "r1", team_id: "tA", rider_name: "Veteran", team_name: "Team A", result_type: "stage", rank: 1, stage_number: 1 },
  ];
  const supabase = makeFakeSupabase({
    raceResultsFixture: [
      { rider_id: "r1", race_id: "race-old", stage_number: 1, result_type: "stage", rank: 1 },
    ],
  });

  const stats = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify: noopNotify });

  assert.equal(stats.detected, 0);
  assert.equal(supabase.careerEvents.length, 0);
});

test("detectCareerFirsts: etapeløb — en TIDLIGERE etapes sejr i SAMME løb tæller som prior (ikke maiden_win igen)", async () => {
  const race = { id: "race-3", name: "Grand Tour" };
  // Stage 5 finaliseres NU — rytteren vandt allerede stage 2 af SAMME løb.
  const resultRows = [
    { rider_id: "r1", team_id: "tA", rider_name: "Stage Hunter", team_name: "Team A", result_type: "stage", rank: 1, stage_number: 5 },
  ];
  const supabase = makeFakeSupabase({
    raceResultsFixture: [
      { rider_id: "r1", race_id: "race-3", stage_number: 2, result_type: "stage", rank: 1 },
    ],
  });

  // stageNumbers=[5] — KUN denne etapes egne rækker ekskluderes fra "prior"-tjekket;
  // stage 2's sejr (samme race_id, ANDET stage_number) tæller stadig som prior.
  const stats = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [5], notify: noopNotify });

  assert.equal(stats.detected, 0, "stage 2-sejren i samme løb skal tælle som prior, ikke give en ny maiden_win på stage 5");
  assert.equal(supabase.careerEvents.length, 0);
});

test("detectCareerFirsts: club_milestone_win fyrer ved 25. sejr i klubfarver", async () => {
  const race = { id: "race-4", name: "GP Fire" };
  const resultRows = [
    { rider_id: "r9", team_id: "tX", rider_name: "Milestone Rider", team_name: "Team X", result_type: "stage", rank: 1, stage_number: 1 },
  ];
  // 24 tidligere sejre for team tX (andre løb) — denne sejr bliver #25.
  const raceResultsFixture = Array.from({ length: 24 }, (_, i) => ({
    rider_id: `hist-${i}`, race_id: `race-hist-${i}`, stage_number: 1, result_type: "stage", rank: 1, team_id: "tX",
  }));
  const supabase = makeFakeSupabase({ raceResultsFixture });

  const stats = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify: noopNotify });

  const milestone = supabase.careerEvents.find((e) => e.event_type === CAREER_EVENT_TYPES.CLUB_MILESTONE_WIN);
  assert.ok(milestone, "club_milestone_win skal være detekteret ved sejr nr. 25");
  assert.equal(milestone.params.milestoneCount, 25);
  assert.equal(milestone.dedupe_key, "team:tX:club_milestone_win:25");
  // + rytterens egen maiden_win (r9 har ingen tidligere resultater) tæller også.
  assert.ok(stats.detected >= 2);
});

test("detectCareerFirsts: first_podium udelades hvis rytteren OGSÅ fik maiden_win i samme batch", async () => {
  const race = { id: "race-5", name: "GP Fem" };
  const resultRows = [
    { rider_id: "r1", team_id: "tA", rider_name: "Winner", team_name: "Team A", result_type: "stage", rank: 1, stage_number: 1 },
  ];
  const supabase = makeFakeSupabase({});

  await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify: noopNotify });

  const types = supabase.careerEvents.map((e) => e.event_type);
  assert.ok(types.includes(CAREER_EVENT_TYPES.MAIDEN_WIN));
  assert.ok(!types.includes(CAREER_EVENT_TYPES.FIRST_PODIUM), "en maiden win er IKKE også en separat 'første podium'-historie");
});

test("detectCareerFirsts: first_jersey registreres pr. klassifikationstype uafhængigt", async () => {
  const race = { id: "race-6", name: "GP Seks" };
  const resultRows = [
    { rider_id: "r7", team_id: "tA", rider_name: "Sprinter", team_name: "Team A", result_type: "points", rank: 1, stage_number: 1 },
  ];
  const supabase = makeFakeSupabase({});

  const stats = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify: noopNotify });

  assert.equal(stats.detected, 1);
  assert.equal(supabase.careerEvents[0].event_type, CAREER_EVENT_TYPES.FIRST_JERSEY);
  assert.equal(supabase.careerEvents[0].dedupe_key, "rider:r7:first_jersey:points");
  assert.equal(supabase.careerEvents[0].params.classification, "points");
});

test("detectCareerFirsts: notify kaldes med CAREER_MILESTONE_TYPE og relatedId=raceId", async () => {
  const race = { id: "race-7", name: "GP Syv" };
  const resultRows = [
    { rider_id: "r1", team_id: "tA", rider_name: "Winner", team_name: "Team A", result_type: "stage", rank: 1, stage_number: 1 },
  ];
  const supabase = makeFakeSupabase({});
  const calls = [];
  const notify = async (args) => { calls.push(args); return { delivered: true }; };

  await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, CAREER_MILESTONE_TYPE);
  assert.equal(calls[0].teamId, "tA");
  assert.equal(calls[0].relatedId, "race-7");
});

test("detectCareerFirsts: ingen team_id (fri agent/AI uden hold) springer notifikation over, men persisterer stadig eventet", async () => {
  const race = { id: "race-8", name: "GP Otte" };
  const resultRows = [
    { rider_id: "r1", team_id: null, rider_name: "Free Agent Winner", team_name: null, result_type: "stage", rank: 1, stage_number: 1 },
  ];
  const supabase = makeFakeSupabase({});
  let notifyCalled = false;
  const notify = async () => { notifyCalled = true; return { delivered: true }; };

  const stats = await detectCareerFirsts({ supabase, race, resultRows, stageNumbers: [1], notify });

  assert.equal(stats.detected, 1);
  assert.equal(notifyCalled, false);
  assert.equal(supabase.careerEvents.length, 1);
});

test("detectCareerFirsts: tomme resultRows er en no-op", async () => {
  const supabase = makeFakeSupabase({});
  const stats = await detectCareerFirsts({ supabase, race: { id: "race-9" }, resultRows: [], notify: noopNotify });
  assert.equal(stats.candidates, 0);
  assert.equal(supabase.careerEvents.length, 0);
});

test("detectCareerFirsts: manglende supabase/race degraderer stille (aldrig en throw)", async () => {
  const stats1 = await detectCareerFirsts({ supabase: null, race: { id: "x" }, resultRows: [{ rider_id: "r1", result_type: "stage", rank: 1 }] });
  assert.equal(stats1.candidates, 0);
  const stats2 = await detectCareerFirsts({ supabase: makeFakeSupabase({}), race: null, resultRows: [{ rider_id: "r1", result_type: "stage", rank: 1 }] });
  assert.equal(stats2.candidates, 0);
});
