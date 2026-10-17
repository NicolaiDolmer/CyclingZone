import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatGap,
  gapSeconds,
  youthGaps,
  teamGaps,
  withGaps,
  withClassificationGaps,
  isOfficialTimesV3OrLater,
} from "./raceClassificationGaps.js";
import {
  formatGap as backendFormatGap,
  accumulateStageRows,
  teamClassification,
  teamClassificationTime,
  filterCompletedEntrants,
} from "../../../backend/lib/raceClassifications.js";
import { isOfficialTimesV3OrLater as backendIsV3 } from "../../../backend/lib/raceEngineRulesRevision.ts";
import { RACE_RULES_REVISIONS } from "../../../backend/lib/raceEngineRulesRevision.ts";

const gc = (rider_id, rank, finish_time) => ({ id: `gc-${rider_id}`, result_type: "gc", rider_id, rank, finish_time });
const young = (rider_id, rank) => ({ id: `y-${rider_id}`, result_type: "young", rider_id, rank, finish_time: null });
const team = (team_id, rank) => ({ id: `t-${team_id}`, result_type: "team", rider_id: null, team_id, rank, finish_time: null });
const stage = (stage_number, rider_id, team_id, rank, finish_time, bonus_seconds = null) => ({
  result_type: "stage", stage_number, rider_id, team_id, rank, finish_time, bonus_seconds,
});

test("formatGap and gapSeconds match the engine format", () => {
  for (const s of [0, 1, 59, 60, 61, 3599, 3725]) {
    assert.equal(formatGap(s), backendFormatGap(s));
    assert.equal(gapSeconds(formatGap(s)), s);
  }
  assert.equal(gapSeconds(null), null);
  assert.equal(gapSeconds(""), null);
});

test("youthGaps: gap to the youth leader is GC gap minus the youth leader's GC gap", () => {
  const gcRows = [gc("a", 1, "+0:00"), gc("b", 2, "+0:20"), gc("c", 3, "+1:05"), gc("d", 4, "+2:00")];
  const gaps = youthGaps(gcRows, [young("b", 1), young("d", 2), young("c", 3)]);
  // young order is by rank: b (+0:20), d (+2:00), c (+1:05) is inconsistent -> no gaps at all
  assert.equal(gaps.size, 0);
  const ok = youthGaps(gcRows, [young("b", 1), young("c", 2), young("d", 3)]);
  assert.equal(ok.get("b"), "+0:00");
  assert.equal(ok.get("c"), "+0:45");
  assert.equal(ok.get("d"), "+1:40");
});

test("youthGaps: missing GC time for the youth leader gives no gaps", () => {
  assert.equal(youthGaps([gc("a", 1, "+0:00")], [young("z", 1)]).size, 0);
  assert.equal(youthGaps([], [young("z", 1)]).size, 0);
});

test("teamGaps: sum of the 3 best rider times, only riders who rode every stage", () => {
  const rows = [];
  // Team T1: riders r1..r4. Team T2: r5..r7. Two stages.
  const add = (rid, tid, g1, g2) => { rows.push(stage(1, rid, tid, 1, g1), stage(2, rid, tid, 1, g2)); };
  add("r1", "T1", "+0:00", "+0:10");
  add("r2", "T1", "+0:30", "+0:30");
  add("r3", "T1", "+1:00", "+0:50");
  add("r4", "T1", "+9:00", "+9:00");
  add("r5", "T2", "+0:10", "+0:10");
  add("r6", "T2", "+0:20", "+0:20");
  add("r7", "T2", "+0:30", "+0:40");
  // T1 = 10 + 60 + 110 = 180 ; T2 = 20 + 40 + 70 = 130
  const gaps = teamGaps({ stageRows: rows, teamRows: [team("T2", 1), team("T1", 2)], revision: "official_times_v3" });
  assert.equal(gaps.get("T2"), "+0:00");
  assert.equal(gaps.get("T1"), "+0:50");
});

test("teamGaps: a rider who missed a stage does not count", () => {
  const rows = [
    stage(1, "r1", "T1", 1, "+0:00"), stage(2, "r1", "T1", 1, "+0:00"),
    stage(1, "r2", "T1", 2, "+0:10"), stage(2, "r2", "T1", 2, "+0:10"),
    stage(1, "r3", "T1", 3, "+0:20"), stage(2, "r3", "T1", 3, "+0:20"),
    stage(1, "r4", "T1", 4, "+0:30"), // left the race after stage 1
    stage(1, "q1", "T2", 5, "+1:00"), stage(2, "q1", "T2", 5, "+1:00"),
    stage(1, "q2", "T2", 6, "+1:00"), stage(2, "q2", "T2", 6, "+1:00"),
    stage(1, "q3", "T2", 7, "+1:00"), stage(2, "q3", "T2", 7, "+1:00"),
  ];
  const gaps = teamGaps({ stageRows: rows, teamRows: [team("T1", 1), team("T2", 2)], revision: "official_times_v3" });
  assert.equal(gaps.get("T1"), "+0:00");
  assert.equal(gaps.get("T2"), "+5:00");
});

test("teamGaps: uptoStage ignores later stages", () => {
  const rows = [];
  for (const [rid, tid, g1, g2] of [["a1", "A", "+0:00", "+9:00"], ["a2", "A", "+0:00", "+9:00"], ["a3", "A", "+0:00", "+9:00"],
    ["b1", "B", "+0:10", "+0:00"], ["b2", "B", "+0:10", "+0:00"], ["b3", "B", "+0:10", "+0:00"]]) {
    rows.push(stage(1, rid, tid, 1, g1), stage(2, rid, tid, 1, g2));
  }
  const after1 = teamGaps({ stageRows: rows, teamRows: [team("A", 1), team("B", 2)], uptoStage: 1, revision: "official_times_v3" });
  assert.equal(after1.get("B"), "+0:30");
  const after2 = teamGaps({ stageRows: rows, teamRows: [team("B", 1), team("A", 2)], uptoStage: 2, revision: "official_times_v3" });
  assert.equal(after2.get("A"), "+26:30");
});

test("teamGaps: bonus seconds are left out under official_times_v3, kept before", () => {
  const rows = [];
  for (const rid of ["a1", "a2", "a3"]) rows.push(stage(1, rid, "A", 1, "+0:00", 10));
  for (const rid of ["b1", "b2", "b3"]) rows.push(stage(1, rid, "B", 2, "+0:05", 0));
  const teamRows = [team("A", 1), team("B", 2)];
  assert.equal(teamGaps({ stageRows: rows, teamRows, revision: "official_times_v3" }).get("B"), "+0:15");
  assert.equal(teamGaps({ stageRows: rows, teamRows, revision: "official_times_v2" }).get("B"), "+0:45");
  assert.equal(teamGaps({ stageRows: rows, teamRows, revision: null }).get("B"), "+0:45");
});

test("teamGaps: stored order that disagrees with the computed times shows no gaps", () => {
  const rows = [];
  for (const rid of ["a1", "a2", "a3"]) rows.push(stage(1, rid, "A", 1, "+0:00"));
  for (const rid of ["b1", "b2", "b3"]) rows.push(stage(1, rid, "B", 2, "+0:30"));
  assert.equal(teamGaps({ stageRows: rows, teamRows: [team("B", 1), team("A", 2)], revision: "official_times_v3" }).size, 0);
});

test("teamGaps: old races without any stage times give no gaps", () => {
  const rows = [];
  for (const rid of ["a1", "a2", "a3"]) rows.push(stage(1, rid, "A", 1, null));
  assert.equal(teamGaps({ stageRows: rows, teamRows: [team("A", 1)] }).size, 0);
});

test("withGaps keeps existing finish_time and untouched rows", () => {
  const rows = [{ rider_id: "a", finish_time: "+0:05" }, { rider_id: "b", finish_time: null }, { rider_id: "c", finish_time: null }];
  const out = withGaps(rows, new Map([["a", "+9:99"], ["b", "+0:10"]]), "rider_id");
  assert.deepEqual(out.map((r) => r.finish_time), ["+0:05", "+0:10", null]);
  assert.equal(withGaps(rows, new Map(), "rider_id"), rows);
});

test("withClassificationGaps fills young and team, leaves other classifications alone", () => {
  const stageRows = [];
  for (const rid of ["a1", "a2", "a3"]) stageRows.push(stage(1, rid, "A", 1, "+0:00"));
  for (const rid of ["b1", "b2", "b3"]) stageRows.push(stage(1, rid, "B", 2, "+0:10"));
  const byType = {
    gc: [gc("a1", 1, "+0:00"), gc("b1", 2, "+0:10")],
    young: [young("b1", 1)],
    team: [team("A", 1), team("B", 2)],
    points: [{ rider_id: "a1", rank: 1, finish_time: null }],
  };
  const out = withClassificationGaps(byType, { stageRows, uptoStage: null, revision: "official_times_v3" });
  assert.equal(out.young[0].finish_time, "+0:00");
  assert.deepEqual(out.team.map((r) => r.finish_time), ["+0:00", "+0:30"]);
  assert.equal(out.points, byType.points);
  assert.equal(byType.team[0].finish_time, null, "input is not mutated");
  assert.equal(withClassificationGaps(null, {}), null);
});

// Parity: the display derivation must agree with what the engine computes.
test("parity: teamGaps matches backend teamClassification for both time models", () => {
  const riders = [];
  const stageRows = [];
  let n = 0;
  const teams = ["A", "B", "C"];
  for (const tid of teams) {
    for (let i = 0; i < 4; i += 1) {
      n += 1;
      riders.push({ rider_id: `r${n}`, team_id: tid });
      for (const sn of [1, 2, 3]) {
        const gap = ((n * 7 + sn * 13 + i * 5) % 90);
        const bonus = (n + sn) % 4 === 0 ? 4 : 0;
        stageRows.push({ ...stage(sn, `r${n}`, tid, 1 + ((n + sn) % 12), formatGap(gap), bonus) });
      }
    }
  }
  for (const revision of ["official_times_v5", "s5_profiles_v1", "official_times_v4", "official_times_v3", "official_times_v2", "legacy"]) {
    const acc = accumulateStageRows({ stageRows });
    const classified = filterCompletedEntrants(riders, acc.stagesByRider, acc.stageNumbers);
    const engine = teamClassification(classified, teamClassificationTime(acc, revision));
    const teamRows = engine.map((t) => team(t.team_id, t.rank));
    const gaps = teamGaps({ stageRows, teamRows, revision });
    assert.equal(gaps.size, engine.length, `gaps for ${revision}`);
    for (const t of engine) {
      assert.equal(gaps.get(t.team_id), backendFormatGap(t.time - engine[0].time), `${revision} ${t.team_id}`);
    }
  }
});

test("parity: isOfficialTimesV3OrLater agrees with the backend for every known revision", () => {
  for (const rev of [...RACE_RULES_REVISIONS, null, undefined, "nonsense"]) {
    assert.equal(isOfficialTimesV3OrLater(rev), backendIsV3(rev), String(rev));
  }
});
