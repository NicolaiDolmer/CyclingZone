// #7879 · Reglerne for talentmærkerne: ét mærke pr. rytter, videregivelse, U23- og
// junior-grænser efter sæsonår, andele pr. gruppe. Alle params her er syntetiske
// testværdier (de rigtige ligger i private_config, hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  computeTalentMarks, quotaFor, progressScore, progressWindows, shiftDate,
  runTalentMarksDaily, runTalentMarksDailyTick, isInTalentMarksWindow,
  TALENT_MARK, TALENT_MARKS_FLAG_KEY, TALENT_MARKS_PARAMS_KEY, TALENT_MARKS_TICK,
} from "./talentMarks7879.js";
import { nextClockAlignedTickMs } from "./schedulerTick.js";
import { validateTalentMarksParams } from "./talentMarksParams.js";
import { clearFlagStageCache } from "./featureStage.js";
import { clearPrivateConfigCache } from "./privateConfig.ts";

// Sæson 1 = 2026. En rytter født i år Y er (2026 - Y) år i sæson 1.
const SEASON = 1;
const born = (age) => `${2026 - age}-06-15`;

// Syntetiske værdier, bevidst forskellige fra produktionens.
const PARAMS = Object.freeze({
  topTalentShare: 0.1,
  nextGenShare: 0.25,
  windowDays: 20,
  recentDays: 5,
  recentWeight: 2,
});

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
const compute = (input) => computeTalentMarks({ seasonNumber: SEASON, params: PARAMS, juniorGains: [], ...input });

test("quotaFor: afrundet andel, mindst min, aldrig flere end gruppen", () => {
  assert.equal(quotaFor(0, 0.1, 1), 0);
  assert.equal(quotaFor(4, 0.1, 1), 1);
  assert.equal(quotaFor(14, 0.1, 1), 1);
  assert.equal(quotaFor(15, 0.1, 1), 2);
  assert.equal(quotaFor(20, 0.25), 5);
  assert.equal(quotaFor(1, 0.5, 3), 1);
});

test("vinduerne er inklusive dagens dato og tåler sommertid", () => {
  assert.deepEqual(progressWindows("2026-11-07", PARAMS), { windowStart: "2026-10-19", recentStart: "2026-11-03" });
  assert.equal(shiftDate("2026-03-30", -1), "2026-03-29");
  assert.equal(shiftDate("2026-10-26", -1), "2026-10-25");
});

test("fremgangen: det nyeste delvindue vejer ekstra efter paramsene", () => {
  assert.equal(progressScore({ gain_window: 10, gain_recent: 4 }, PARAMS), 18);
  assert.equal(progressScore({ gain_window: 10, gain_recent: 4 }, { recentWeight: 0 }), 10);
  assert.equal(progressScore(undefined, PARAMS), 0);
});

test("uden gyldige params gives ingen mærker (slukket adfærd)", () => {
  const riders = [rider({ id: "u21", age: 21 }), rider({ id: "jun", age: 17 })];
  const gains = [{ rider_id: "jun", gain_window: 5, gain_recent: 1 }];
  for (const params of [undefined, null, {}, { ...PARAMS, topTalentShare: 0 }, { ...PARAMS, recentDays: 99 }]) {
    assert.deepEqual(computeTalentMarks({ riders, juniorGains: gains, seasonNumber: SEASON, params }), []);
  }
});

test("params: formen valideres, og ugyldigt er null", () => {
  assert.deepEqual({ ...validateTalentMarksParams(PARAMS) }, PARAMS);
  assert.ok(Object.isFrozen(validateTalentMarksParams(PARAMS)));
  for (const bad of [
    null, [], "x", {},
    { ...PARAMS, topTalentShare: 0 }, { ...PARAMS, topTalentShare: 1.5 }, { ...PARAMS, nextGenShare: -1 },
    { ...PARAMS, nextGenShare: "0.2" }, { ...PARAMS, windowDays: 0 }, { ...PARAMS, windowDays: 2.5 },
    { ...PARAMS, windowDays: 1000 }, { ...PARAMS, recentDays: 0 }, { ...PARAMS, recentDays: PARAMS.windowDays + 1 },
    { ...PARAMS, recentWeight: -1 }, { ...PARAMS, recentWeight: Number.NaN },
  ]) {
    assert.equal(validateTalentMarksParams(bad), null, JSON.stringify(bad));
  }
});

test("Toptalent: andel pr. ryttertype, mindst én pr. type", () => {
  const climbers = Array.from({ length: 25 }, (_, i) => rider({
    id: `c${String(i).padStart(3, "0")}`, best_role_rating: i < 3 ? 90 : 10 + i, age: 20,
  }));
  const sprinters = [rider({ id: "s1", primary_type: "sprinter", best_role_rating: 40 }), rider({ id: "s2", primary_type: "sprinter", best_role_rating: 41 })];
  const marks = compute({ riders: [...climbers, ...sprinters] });
  const top = marks.filter((m) => m.mark === TALENT_MARK.TOP_TALENT);
  // 25 klatrere -> 3 (afrundet 2,5), 2 sprintere -> mindst 1.
  assert.equal(top.filter((m) => m.rider_type === "climber").length, 3);
  assert.deepEqual(top.filter((m) => m.rider_type === "sprinter").map((m) => m.rider_id), ["s2"]);
  for (const m of top.filter((x) => x.rider_type === "climber")) {
    assert.equal(climbers.find((c) => c.id === m.rider_id).best_role_rating, 90);
  }
});

test("Toptalent: kun under 23 efter sæsonår, ikke kalenderår", () => {
  const riders = [
    rider({ id: "age22", age: 22, best_role_rating: 60 }),
    rider({ id: "age23", age: 23, best_role_rating: 99 }),
  ];
  // Født 31/12: stadig 22 i sæsonens kalenderår, uanset fødselsdag.
  riders.push({ ...rider({ id: "lateBirthday", best_role_rating: 70 }), birthdate: "2004-12-31" });
  const marks = compute({ riders });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["lateBirthday"]);
  // I sæson 2 er samme rytter 23 og falder ud.
  const next = compute({ riders, seasonNumber: 2 });
  assert.ok(!marksOf(next, TALENT_MARK.TOP_TALENT).includes("lateBirthday"));
});

test("Toptalent: pensionerede og ryttere uden type eller rating tæller ikke", () => {
  const riders = [
    rider({ id: "retired", best_role_rating: 99, is_retired: true }),
    rider({ id: "noType", best_role_rating: 98, primary_type: null }),
    rider({ id: "noRating", best_role_rating: null }),
    rider({ id: "ok", best_role_rating: 50 }),
  ];
  const marks = compute({ riders });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["ok"]);
});

test("Toptalent: lige rating giver den yngste først, så id", () => {
  const riders = [
    rider({ id: "b", age: 21, best_role_rating: 70 }),
    rider({ id: "a", age: 21, best_role_rating: 70 }),
    rider({ id: "young", age: 19, best_role_rating: 70 }),
  ];
  const marks = compute({ riders });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["young"]);
});

function juniorField(n) {
  // n juniorer i en type der ellers er domineret af stærke U23'ere, så ingen af
  // juniorerne får Toptalent, medmindre testen selv giver én en høj rating.
  const elite = Array.from({ length: 40 }, (_, i) => rider({ id: `e${String(i).padStart(3, "0")}`, age: 21, best_role_rating: 90 }));
  const juniors = Array.from({ length: n }, (_, i) => rider({ id: `j${String(i).padStart(3, "0")}`, age: 16 + (i % 3), best_role_rating: 30 }));
  return { elite, juniors };
}

test("Næste generation: andel af juniorerne efter vægtet fremgang, kun reel fremgang", () => {
  const { elite, juniors } = juniorField(8); // 2 pladser
  const juniorGains = [
    { rider_id: "j005", gain_window: 10, gain_recent: 0 }, // 10
    { rider_id: "j006", gain_window: 6, gain_recent: 3 }, // 12 med vægten, 6 uden
    { rider_id: "j007", gain_window: 8, gain_recent: 0 }, // 8
    { rider_id: "j004", gain_window: 0, gain_recent: 0 },
  ];
  const marks = compute({ riders: [...elite, ...juniors], juniorGains });
  assert.deepEqual(marksOf(marks, TALENT_MARK.NEXT_GEN), ["j005", "j006"]);
  // Samme data uden ekstra vægt giver et andet udvalg: vægten kommer fra paramsene.
  const flat = compute({ riders: [...elite, ...juniors], juniorGains, params: { ...PARAMS, recentWeight: 0 } });
  assert.deepEqual(marksOf(flat, TALENT_MARK.NEXT_GEN), ["j005", "j007"]);
});

test("Næste generation: andelen følger paramsene", () => {
  const { elite, juniors } = juniorField(8);
  const juniorGains = juniors.map((j, i) => ({ rider_id: j.id, gain_window: 10 + i, gain_recent: 0 }));
  const small = compute({ riders: [...elite, ...juniors], juniorGains, params: { ...PARAMS, nextGenShare: 0.125 } });
  const large = compute({ riders: [...elite, ...juniors], juniorGains, params: { ...PARAMS, nextGenShare: 0.5 } });
  assert.equal(marksOf(small, TALENT_MARK.NEXT_GEN).length, 1);
  assert.equal(marksOf(large, TALENT_MARK.NEXT_GEN).length, 4);
});

test("Næste generation: ingen fremgang = intet mærke, også når der er ledige pladser", () => {
  const { elite, juniors } = juniorField(8);
  const marks = compute({ riders: [...elite, ...juniors], juniorGains: [{ rider_id: "j001", gain_window: -2, gain_recent: 0 }] });
  assert.deepEqual(marksOf(marks, TALENT_MARK.NEXT_GEN), []);
});

test("Næste generation: kun 16-18 efter sæsonår", () => {
  const riders = [
    rider({ id: "age15", age: 15 }), rider({ id: "age16", age: 16 }),
    rider({ id: "age18", age: 18 }), rider({ id: "age19", age: 19 }),
    ...Array.from({ length: 40 }, (_, i) => rider({ id: `e${i}`, age: 21, best_role_rating: 90 })),
  ];
  const juniorGains = ["age15", "age16", "age18", "age19"].map((id) => ({ rider_id: id, gain_window: 50, gain_recent: 0 }));
  const marks = compute({ riders, juniorGains });
  // To juniorer i alt -> én plads (mindst én). Uden for båndet tæller aldrig.
  const nextGen = marksOf(marks, TALENT_MARK.NEXT_GEN);
  assert.equal(nextGen.length, 1);
  assert.ok(["age16", "age18"].includes(nextGen[0]));
});

test("ét mærke pr. rytter: Toptalent udelukker Næste generation, og pladsen går videre", () => {
  const { elite, juniors } = juniorField(8); // 2 pladser
  // j000 er den bedste junior OG får Toptalent i sin egen type.
  juniors[0] = { ...juniors[0], primary_type: "sprinter", best_role_rating: 80 };
  const juniorGains = [
    { rider_id: "j000", gain_window: 30, gain_recent: 10 },
    { rider_id: "j001", gain_window: 20, gain_recent: 0 },
    { rider_id: "j002", gain_window: 15, gain_recent: 0 },
    { rider_id: "j003", gain_window: 5, gain_recent: 0 },
  ];
  const marks = compute({ riders: [...elite, ...juniors], juniorGains });
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
  const marks = compute({ riders });
  assert.deepEqual(marksOf(marks, TALENT_MARK.TOP_TALENT), ["free"]);
});

// ── Den daglige kørsel mod en lille fake ─────────────────────────────────────

function fakeSupabase({ flag = "beta", lastComputedOn = null, riders = [], gains = [], params = PARAMS } = {}) {
  const writes = { upserts: [], deletes: [], sameDayDeletes: [], rpcCalls: [], tablesRead: [], events: [] };
  const single = (data) => ({ data, error: null });
  function q(table) {
    writes.tablesRead.push(table);
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
        if (table === "private_config") return Promise.resolve(single(params === null ? null : { value: params }));
        return Promise.resolve(single(null));
      },
      upsert(rows, opts) { writes.events.push("upsert"); writes.upserts.push({ table, rows, opts }); return Promise.resolve({ error: null }); },
      delete() {
        return {
          eq(col, val) { writes.events.push("same-day-delete"); writes.sameDayDeletes.push({ table, col, val }); return Promise.resolve({ error: null }); },
          lt(col, val) { writes.events.push("old-delete"); writes.deletes.push({ table, col, val }); return Promise.resolve({ error: null }); },
        };
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

const quiet = () => { const warnings = []; return { warnings, log: { warn: (m) => { warnings.push(m); } } }; };

function resetCaches() {
  clearFlagStageCache();
  clearPrivateConfigCache();
}

test("kørslen: slukket kontakt = ingen læsning af ryttere eller params og ingen skrivning", async () => {
  resetCaches();
  const sb = fakeSupabase({ flag: "off" });
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T10:00:00Z") });
  assert.deepEqual(result, { ran: false, skipped: "flag_off" });
  assert.equal(sb.writes.upserts.length + sb.writes.deletes.length + sb.writes.rpcCalls.length, 0);
  assert.ok(!sb.writes.tablesRead.includes("private_config"));
});

test("kørslen: kontakten tændt, men params mangler = slukket adfærd og en værdi-fri advarsel", async () => {
  resetCaches();
  const sb = fakeSupabase({ flag: "on", params: null, riders: [rider({ id: "u21", age: 21 })] });
  const { warnings, log } = quiet();
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T10:00:00Z"), log });
  assert.deepEqual(result, { ran: false, skipped: "no_params" });
  assert.equal(sb.writes.upserts.length + sb.writes.deletes.length + sb.writes.rpcCalls.length, 0);
  assert.ok(!sb.writes.tablesRead.includes("riders"), "rytterne hentes ikke uden params");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(TALENT_MARKS_PARAMS_KEY));
});

test("kørslen: ugyldige params = slukket adfærd, og værdierne nævnes aldrig", async () => {
  resetCaches();
  const bad = { ...PARAMS, topTalentShare: 7.77 };
  const sb = fakeSupabase({ flag: "on", params: bad, riders: [rider({ id: "u21", age: 21 })] });
  const { warnings, log } = quiet();
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T10:00:00Z"), log });
  assert.deepEqual(result, { ran: false, skipped: "no_params" });
  assert.equal(sb.writes.upserts.length + sb.writes.deletes.length, 0);
  assert.ok(warnings.length >= 1);
  assert.ok(!warnings.join(" ").includes("7.77"));
});

test("kørslen: højst én gang pr. dansk kalenderdag", async () => {
  resetCaches();
  const sb = fakeSupabase({ flag: "beta", lastComputedOn: "2026-11-07" });
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T10:00:00Z") });
  assert.equal(result.skipped, "already_today");
  assert.equal(sb.writes.upserts.length, 0);
});

test("kørslen: gårsdagens rækker står tilbage (fejlet oprydning) = dagen køres igen", async () => {
  resetCaches();
  // Den ældste række er fra i går, selv om dagens rækker allerede er skrevet.
  const sb = fakeSupabase({ flag: "beta", lastComputedOn: "2026-11-06", riders: [rider({ id: "u21", age: 21 })] });
  const result = await runTalentMarksDaily({ supabase: sb, now: new Date("2026-11-07T10:00:00Z") });
  assert.equal(result.ran, true);
  assert.deepEqual(sb.writes.deletes, [{ table: "rider_talent_marks", col: "computed_on", val: "2026-11-07" }]);
  // Dagens rækker fra det fejlede forsøg ryddes først, så en tabt plads ikke bliver stående.
  assert.deepEqual(sb.writes.sameDayDeletes, [{ table: "rider_talent_marks", col: "computed_on", val: "2026-11-07" }]);
  assert.deepEqual(sb.writes.events, ["same-day-delete", "upsert", "old-delete"]);
});

test("kørslen: skriver dagens mærker med paramsenes vinduer og fjerner gårsdagens", async () => {
  resetCaches();
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
  assert.equal(sb.writes.rpcCalls[0].args.p_window_start, shiftDate("2026-11-08", -(PARAMS.windowDays - 1)));
  assert.equal(sb.writes.rpcCalls[0].args.p_recent_start, shiftDate("2026-11-08", -(PARAMS.recentDays - 1)));
  const rows = sb.writes.upserts[0].rows;
  assert.deepEqual(rows.map((r) => [r.rider_id, r.mark, r.computed_on]), [
    ["u21", "top_talent", "2026-11-08"],
    ["jun", "next_gen", "2026-11-08"],
  ]);
  assert.deepEqual(sb.writes.deletes, [{ table: "rider_talent_marks", col: "computed_on", val: "2026-11-08" }]);
});

// ── Det faste vindue (ejer 9/11) ─────────────────────────────────────────────

// Vinter: dansk tid = UTC+1. Sommer: dansk tid = UTC+2.
const IN_WINDOW_WINTER = new Date("2026-11-08T02:12:00Z"); // 03:12 dansk tid
const IN_WINDOW_SUMMER = new Date("2026-07-08T01:12:00Z"); // 03:12 dansk tid

test("vinduet: kanterne i dansk tid, vinter og sommer", () => {
  for (const [iso, expected] of [
    ["2026-11-08T01:59:59Z", false], // 02:59:59
    ["2026-11-08T02:00:00Z", true], // 03:00:00
    ["2026-11-08T02:44:59Z", true], // 03:44:59
    ["2026-11-08T02:45:00Z", false], // 03:45:00
    ["2026-07-08T00:59:59Z", false], // 02:59:59
    ["2026-07-08T01:00:00Z", true], // 03:00:00
    ["2026-07-08T01:44:59Z", true], // 03:44:59
    ["2026-07-08T01:45:00Z", false], // 03:45:00
    ["2026-07-08T02:12:00Z", false], // 04:12, vinterens vindue i UTC
  ]) {
    assert.equal(isInTalentMarksWindow(new Date(iso)), expected, iso);
  }
});

test("vinduet: findes præcis én gang på begge dage, hvor sommertiden skifter", () => {
  for (const [day, utcHour] of [["2026-03-29", 1], ["2026-10-25", 2]]) {
    const start = Date.parse(`${day}T00:00:00Z`);
    const inWindow = [];
    for (let m = 0; m < 24 * 60; m += 5) {
      const at = new Date(start + m * 60 * 1000);
      if (isInTalentMarksWindow(at)) inWindow.push(at.toISOString());
    }
    assert.equal(inWindow.length, 9, day); // 45 min i skridt på 5
    assert.equal(inWindow[0], `${day}T0${utcHour}:00:00.000Z`);
  }
});

test("vinduet: tikket giver faste klokkeslæt, som alle ligger i vinduet", () => {
  const hits = [];
  let t = Date.parse("2026-11-08T00:00:00Z");
  for (let i = 0; i < 12; i++) {
    t = nextClockAlignedTickMs(t, TALENT_MARKS_TICK);
    if (isInTalentMarksWindow(new Date(t))) hits.push(new Date(t).toISOString().slice(11, 16));
  }
  assert.deepEqual(hits, ["02:12", "02:27", "02:42"]); // 03:12, 03:27 og 03:42 dansk tid
});

test("tikket: uden for vinduet rører det ikke databasen, heller ikke flaget", async () => {
  resetCaches();
  const sb = fakeSupabase({ flag: "on", riders: [rider({ id: "u21", age: 21 })] });
  for (const iso of ["2026-11-08T10:00:00Z", "2026-11-08T19:30:00Z", "2026-11-08T21:30:00Z", "2026-11-08T23:30:00Z"]) {
    const result = await runTalentMarksDailyTick({ supabase: sb, now: new Date(iso) });
    assert.deepEqual(result, { ran: false, skipped: "outside_window" }, iso);
  }
  assert.deepEqual(sb.writes.tablesRead, []);
  assert.equal(sb.writes.rpcCalls.length, 0);
});

test("tikket: slukket kontakt koster kun flag-opslaget i vinduet", async () => {
  resetCaches();
  const sb = fakeSupabase({ flag: "off" });
  const result = await runTalentMarksDailyTick({ supabase: sb, now: IN_WINDOW_WINTER });
  assert.deepEqual(result, { ran: false, skipped: "flag_off" });
  assert.deepEqual(sb.writes.tablesRead, ["app_config"]);
  assert.equal(sb.writes.upserts.length + sb.writes.deletes.length + sb.writes.sameDayDeletes.length + sb.writes.rpcCalls.length, 0);
});

test("tikket: i vinduet beregnes mærkerne, vinter og sommer", async () => {
  for (const [now, yesterday, today] of [
    [IN_WINDOW_WINTER, "2026-11-07", "2026-11-08"],
    [IN_WINDOW_SUMMER, "2026-07-07", "2026-07-08"],
  ]) {
    resetCaches();
    const sb = fakeSupabase({ flag: "on", lastComputedOn: yesterday, riders: [rider({ id: "u21", age: 21 })] });
    const result = await runTalentMarksDailyTick({ supabase: sb, now });
    assert.equal(result.ran, true);
    assert.equal(sb.writes.upserts[0].rows[0].computed_on, today);
  }
});

test("tikket: dagen er allerede kørt = næste tik i vinduet skriver intet", async () => {
  resetCaches();
  const sb = fakeSupabase({ flag: "on", lastComputedOn: "2026-11-08" });
  const result = await runTalentMarksDailyTick({ supabase: sb, now: new Date("2026-11-08T02:27:00Z") });
  assert.deepEqual(result, { ran: false, skipped: "already_today" });
  assert.equal(sb.writes.upserts.length + sb.writes.deletes.length + sb.writes.sameDayDeletes.length, 0);
});

test("tikket: en misset nat indhentes i næste nats vindue", async () => {
  resetCaches();
  const sb = fakeSupabase({ flag: "on", lastComputedOn: "2026-11-05", riders: [rider({ id: "u21", age: 21 })] });
  const result = await runTalentMarksDailyTick({ supabase: sb, now: IN_WINDOW_WINTER });
  assert.equal(result.ran, true);
  assert.deepEqual(sb.writes.deletes, [{ table: "rider_talent_marks", col: "computed_on", val: "2026-11-08" }]);
});

test("cron.js: ingen boot-kørsel, og tikket ligger på klokken", () => {
  const src = readFileSync(fileURLToPath(new URL("../cron.js", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /trackedTick\("talent-marks-daily"[^\n]*\)\(\)/);
  assert.match(src, /startClockAlignedInterval\(trackedTick\("talent-marks-daily"[^\n]*TALENT_MARKS_TICK[^\n]*DEPLOY_OVERLAP_GRACE_MS/);
  assert.doesNotMatch(src, /setInterval\(trackedTick\("talent-marks-daily"/);
});

test("kontaktens og paramsenes nøgler", () => {
  assert.equal(TALENT_MARKS_FLAG_KEY, "talent_marks_7879");
  assert.equal(TALENT_MARKS_PARAMS_KEY, "talent_marks_params");
});

test("hard rule 17: koden eksporterer ingen talværdier for andele, vinduer eller vægte", () => {
  const src = readFileSync(fileURLToPath(new URL("./talentMarks7879.js", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /(?:_SHARE|_WINDOW_DAYS|_WEIGHT)\s*=\s*[0-9.]+/);
  assert.doesNotMatch(src, /\bTOP_TALENT_SHARE\b|\bNEXT_GEN_SHARE\b|\bPROGRESS_WINDOW_DAYS\b|\bRECENT_WINDOW_DAYS\b/);
});
