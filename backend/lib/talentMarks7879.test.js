// #7879 · Reglerne for talentmærkerne (ejer 7/11): ét mærke pr. rytter,
// videregivelse, U23- og junior-grænser efter sæsonår, top-procent pr. gruppe.
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeTalentMarks, quotaFor, progressScore, progressWindows, shiftDate,
  runTalentMarksDaily, TALENT_MARK, TALENT_MARKS_FLAG_KEY,
} from "./talentMarks7879.js";
import { clearFlagStageCache } from "./featureStage.js";

// Sæson 1 = 2026. En rytter født i år Y er (2026 - Y) år i sæson 1.
const SEASON = 1;
const born = (age) => `${2026 - age}-06-15`;

let seq = 0;
function rider(over = {}) {
  seq += 1;
  return {
    id: over.id ?? `r${String(seq).padStart(4, "0")}`,
    birthdate: born(over.age ?? 20),
    primary_type: "climber",
    best_role_rating: 50,
    is_retired: false,
    ...over,
  };
}

const marksOf = (marks, mark) => marks.filter((m) => m.mark === mark).map((m) => m.rider_id).sort();

test("quotaFor: afrundet andel, mindst min, aldrig flere end gruppen", () => {
  assert.equal(quotaFor(0, 0.01, 1), 0);
  assert.equal(quotaFor(5, 0.01, 1), 1);
  assert.equal(quotaFor(149, 0.01, 1), 1);
  assert.equal(quotaFor(150, 0.01, 1), 2);
  assert.equal(quotaFor(200, 0.02), 4);
  assert.equal(quotaFor(1, 0.5, 3), 1);
});

test("vinduerne er inklusive dagens dato og tåler sommertid", () => {
  assert.deepEqual(progressWindows("2026-11-07"), { windowStart: "2026-10-09", recentStart: "2026-11-01" });
  assert.equal(shiftDate("2026-03-30", -1), "2026-03-29");
  assert.equal(shiftDate("2026-10-26", -1), "2026-10-25");
});

test("fremgangen: de seneste 7 dage tæller dobbelt", () => {
  assert.equal(progressScore({ gain_window: 10, gain_recent: 4 }), 14);
  assert.equal(progressScore(undefined), 0);
});

test("Toptalent: top 1 % pr. ryttertype, mindst én pr. type", () => {
  const climbers = Array.from({ length: 250 }, (_, i) => rider({ id: `c${String(i).padStart(3, "0")}`, best_role_rating: 10 + (i % 80), age: 20 }));
  const sprinters = [rider({ id: "s1", primary_type: "sprinter", best_role_rating: 40 }), rider({ id: "s2", primary_type: "sprinter", best_role_rating: 41 })];
  const marks = computeTalentMarks({ riders: [...climbers, ...sprinters], juniorGains: [], seasonNumber: SEASON });
  const top = marks.filter((m) => m.mark === TALENT_MARK.TOP_TALENT);
  // 250 klatrere -> 3 (afrundet 2,5), 2 sprintere -> mindst 1.
  assert.equal(top.filter((m) => m.rider_type === "climber").length, 3);
  assert.deepEqual(top.filter((m) => m.rider_type === "sprinter").map((m) => m.rider_id), ["s2"]);
  for (const m of top.filter((x) => x.rider_type === "climber")) {
    assert.equal(climbers.find((c) => c.id === m.rider_id).best_role_rating, 89);
  }
});

test("Toptalent: kun under 23 efter sæsonår, ikke kalenderår", () => {
  const riders = [
    rider({ id: "age22", age: 22, best_role_rating: 60 }),
    rider({ id: "age23", age: 23, best_role_rating: 99 }),
  ];
  // Født 31/12: stadig 22 i sæsonens kalenderår, uanset fødselsdag.
  riders.push({ ...rider({ id: "lateBirthday", best_role_rating: 70 }), birthdate: "2004-12-31" });
  const marks = computeTalentMarks({ riders, juniorGains: [], seasonNumber: SEASON });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["lateBirthday"]);
  // I sæson 2 er samme rytter 23 og falder ud.
  const next = computeTalentMarks({ riders, juniorGains: [], seasonNumber: 2 });
  assert.ok(!marksOf(next, TALENT_MARK.TOP_TALENT).includes("lateBirthday"));
});

test("Toptalent: pensionerede og ryttere uden type eller rating tæller ikke", () => {
  const riders = [
    rider({ id: "retired", best_role_rating: 99, is_retired: true }),
    rider({ id: "noType", best_role_rating: 98, primary_type: null }),
    rider({ id: "noRating", best_role_rating: null }),
    rider({ id: "ok", best_role_rating: 50 }),
  ];
  const marks = computeTalentMarks({ riders, juniorGains: [], seasonNumber: SEASON });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["ok"]);
});

test("Toptalent: lige rating giver den yngste først, så id", () => {
  const riders = [
    rider({ id: "b", age: 21, best_role_rating: 70 }),
    rider({ id: "a", age: 21, best_role_rating: 70 }),
    rider({ id: "young", age: 19, best_role_rating: 70 }),
  ];
  const marks = computeTalentMarks({ riders, juniorGains: [], seasonNumber: SEASON });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["young"]);
});

function juniorField(n) {
  // n juniorer i en type der ellers er domineret af stærke U23'ere, så ingen af
  // juniorerne får Toptalent, medmindre testen selv giver én en høj rating.
  const elite = Array.from({ length: 100 }, (_, i) => rider({ id: `e${String(i).padStart(3, "0")}`, age: 21, best_role_rating: 90 }));
  const juniors = Array.from({ length: n }, (_, i) => rider({ id: `j${String(i).padStart(3, "0")}`, age: 16 + (i % 3), best_role_rating: 30 }));
  return { elite, juniors };
}

test("Næste generation: top 2 % af juniorerne efter fremgang, kun reel fremgang", () => {
  const { elite, juniors } = juniorField(100); // 2 pladser
  const juniorGains = [
    { rider_id: "j005", gain_window: 9, gain_recent: 0 },
    { rider_id: "j006", gain_window: 6, gain_recent: 5 }, // 11
    { rider_id: "j007", gain_window: 10, gain_recent: 0 },
    { rider_id: "j008", gain_window: 0, gain_recent: 0 },
  ];
  const marks = computeTalentMarks({ riders: [...elite, ...juniors], juniorGains, seasonNumber: SEASON });
  assert.deepEqual(marksOf(marks, TALENT_MARK.NEXT_GEN), ["j006", "j007"]);
});

test("Næste generation: ingen fremgang = intet mærke, også når der er ledige pladser", () => {
  const { elite, juniors } = juniorField(100);
  const marks = computeTalentMarks({ riders: [...elite, ...juniors], juniorGains: [{ rider_id: "j001", gain_window: -2, gain_recent: 0 }], seasonNumber: SEASON });
  assert.deepEqual(marksOf(marks, TALENT_MARK.NEXT_GEN), []);
});

test("Næste generation: kun 16-18 efter sæsonår", () => {
  const riders = [
    rider({ id: "age15", age: 15 }), rider({ id: "age16", age: 16 }),
    rider({ id: "age18", age: 18 }), rider({ id: "age19", age: 19 }),
    ...Array.from({ length: 200 }, (_, i) => rider({ id: `e${i}`, age: 21, best_role_rating: 90 })),
  ];
  const juniorGains = ["age15", "age16", "age18", "age19"].map((id) => ({ rider_id: id, gain_window: 50, gain_recent: 0 }));
  const marks = computeTalentMarks({ riders, juniorGains, seasonNumber: SEASON });
  // To juniorer i alt -> én plads (mindst én). Uden for båndet tæller aldrig.
  const nextGen = marksOf(marks, TALENT_MARK.NEXT_GEN);
  assert.equal(nextGen.length, 1);
  assert.ok(["age16", "age18"].includes(nextGen[0]));
});

test("ét mærke pr. rytter: Toptalent udelukker Næste generation, og pladsen går videre", () => {
  const { elite, juniors } = juniorField(100); // 2 pladser
  // j000 er den bedste junior OG får Toptalent i sin egen type.
  juniors[0] = { ...juniors[0], primary_type: "sprinter", best_role_rating: 80 };
  const juniorGains = [
    { rider_id: "j000", gain_window: 30, gain_recent: 10 },
    { rider_id: "j001", gain_window: 20, gain_recent: 0 },
    { rider_id: "j002", gain_window: 15, gain_recent: 0 },
    { rider_id: "j003", gain_window: 5, gain_recent: 0 },
  ];
  const marks = computeTalentMarks({ riders: [...elite, ...juniors], juniorGains, seasonNumber: SEASON });
  assert.ok(marksOf(marks, TALENT_MARK.TOP_TALENT).includes("j000"));
  assert.deepEqual(marksOf(marks, TALENT_MARK.NEXT_GEN), ["j001", "j002"]);
  const ids = marks.map((m) => m.rider_id);
  assert.equal(new Set(ids).size, ids.length, "ingen rytter har to mærker");
});

test("alle ryttere tæller: frie, AI- og managerhold vurderes ens", () => {
  const riders = [
    rider({ id: "free", best_role_rating: 80, team_id: null }),
    rider({ id: "ai", best_role_rating: 70, team_id: "t-ai" }),
    rider({ id: "mgr", best_role_rating: 60, team_id: "t-m" }),
  ];
  const marks = computeTalentMarks({ riders, juniorGains: [], seasonNumber: SEASON });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["free"]);
});

// ── Den daglige kørsel mod en lille fake ─────────────────────────────────────

function fakeSupabase({ flag = "beta", lastComputedOn = null, riders = [], gains = [] } = {}) {
  const writes = { upserts: [], deletes: [], rpcCalls: [] };
  const single = (data) => ({ data, error: null });
  function q(table) {
    const state = { table, filters: [] };
    const api = {
      select() { return api; },
      eq(col, val) { state.filters.push([col, val]); return api; },
      gte() { return api; },
      order() { return api; },
      limit() {
        if (table === "rider_talent_marks") return Promise.resolve(single(lastComputedOn ? [{ computed_on: lastComputedOn }] : []));
        return api;
      },
      range(from) { return Promise.resolve(single(from === 0 ? riders : [])); },
      maybeSingle() {
        if (table === "app_config") return Promise.resolve(single({ value: flag }));
        if (table === "seasons") return Promise.resolve(single({ number: SEASON }));
        return Promise.resolve(single(null));
      },
      upsert(rows, opts) { writes.upserts.push({ table, rows, opts }); return Promise.resolve({ error: null }); },
      delete() {
        return { lt(col, val) { writes.deletes.push({ table, col, val }); return Promise.resolve({ error: null }); } };
      },
    };
    return api;
  }
  return {
    writes,
    from: q,
    rpc(name, args) { writes.rpcCalls.push({ name, args }); return Promise.resolve(single(gains)); },
  };
}

test("kørslen: slukket kontakt = ingen læsning af ryttere og ingen skrivning", async () => {
  clearFlagStageCache();
  const sb = fakeSupabase({ flag: "off" });
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T10:00:00Z") });
  assert.deepEqual(result, { ran: false, skipped: "flag_off" });
  assert.equal(sb.writes.upserts.length + sb.writes.deletes.length + sb.writes.rpcCalls.length, 0);
});

test("kørslen: højst én gang pr. dansk kalenderdag", async () => {
  clearFlagStageCache();
  const sb = fakeSupabase({ flag: "beta", lastComputedOn: "2026-11-07" });
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T10:00:00Z") });
  assert.equal(result.skipped, "already_today");
  assert.equal(sb.writes.upserts.length, 0);
});

test("kørslen: skriver dagens mærker og fjerner gårsdagens", async () => {
  clearFlagStageCache();
  const riders = [
    rider({ id: "u21", age: 21, best_role_rating: 70 }),
    rider({ id: "jun", age: 17, best_role_rating: 20 }),
  ];
  const sb = fakeSupabase({ flag: "on", lastComputedOn: "2026-11-06", riders, gains: [{ rider_id: "jun", gain_window: 3, gain_recent: 1 }] });
  // 23:30 UTC 7/11 er 8/11 i dansk tid.
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T23:30:00Z") });
  assert.equal(result.ran, true);
  assert.equal(sb.writes.rpcCalls.length, 1);
  assert.deepEqual(sb.writes.rpcCalls[0].args.p_rider_ids, ["jun"]);
  assert.equal(sb.writes.rpcCalls[0].args.p_window_start, "2026-10-10");
  const rows = sb.writes.upserts[0].rows;
  assert.deepEqual(rows.map((r) => [r.rider_id, r.mark, r.computed_on]), [
    ["u21", "top_talent", "2026-11-08"],
    ["jun", "next_gen", "2026-11-08"],
  ]);
  assert.deepEqual(sb.writes.deletes, [{ table: "rider_talent_marks", col: "computed_on", val: "2026-11-08" }]);
});

test("kontaktens nøgle", () => {
  assert.equal(TALENT_MARKS_FLAG_KEY, "talent_marks_7879");
});
