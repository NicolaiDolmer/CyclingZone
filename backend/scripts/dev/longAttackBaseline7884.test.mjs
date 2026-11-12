// #7884 trin 0: rene dele af maalingerne for langt angreb (ingen motor, ingen tal fra motoren).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  B11_SQL,
  KM_EPS,
  assertPrivateOut,
  b2Of,
  b6Of,
  benchRaceGroup,
  forwardSplitRiders,
  lastClimbWindow,
  lateAttacksOf,
  measureStage7884,
  quantile,
  renderB11Markdown,
  renderBenchMarkdown,
  summarize7884,
  summarizeB11,
  winnerOf,
} from "./longAttackBaseline7884.mjs";
import {
  BASELINE_EXPERIMENTS,
  EXPERIMENTS,
  LONG_ATTACK_ARMS,
  LONG_ATTACK_METRICS,
  longAttackClimbs,
  longAttackPlans,
  renderLongAttackMarkdown,
  summarizeLongAttack,
} from "./tacticsEffects7266.mjs";
import { stagePlanRouteFromRaw, validateStagePlanLegs } from "../../lib/stagePlan.ts";

// En syntetisk etape: tre kategoriserede stigninger, den sidste er en topankomst.
const PROFILE = {
  stage_number: 3, profile_type: "mountain", distance_km: 160,
  climbs: [
    { crest_km: 50, length_km: 8, category: "2", name: "A" },
    { crest_km: 110, length_km: 12, category: "1", name: "B" },
    { crest_km: 160, length_km: 10, category: "HC", name: "C", summit_finish: true },
  ],
};

/** Deterministisk pseudo-tilfaeldig raekke (fast seed), kun til at bygge testdata. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

// ── B1 (tacticsEffects7266) ─────────────────────────────────────────────────

test("#7884 B1: armen koeres kun naar den bedes om; #7266's default-liste er uaendret", () => {
  assert.deepEqual([...BASELINE_EXPERIMENTS], ["longattack"]);
  assert.ok(!EXPERIMENTS.includes("longattack"));
  assert.deepEqual([...LONG_ATTACK_ARMS], ["last", "prev", "early"]);
  for (const [m, sign] of Object.entries(LONG_ATTACK_METRICS)) assert.ok(sign === 1 || sign === -1, m);
});

test("#7884 B1: longAttackClimbs bruger planens liste (ingen topankomst), og armene maaler aldrig samme top", () => {
  const route = stagePlanRouteFromRaw(PROFILE);
  assert.deepEqual(route.climbs.map((c) => c.index), [0, 1], "topankomsten er ikke paa planens liste");
  const c = longAttackClimbs(route);
  assert.equal(c.last.index, 1);
  assert.equal(c.prev.index, 0);
  assert.equal(c.early, null, "early kraever mindst tre stigninger");
  const three = longAttackClimbs({ climbs: [{ index: 0 }, { index: 2 }, { index: 5 }] });
  assert.deepEqual([three.last.index, three.prev.index, three.early.index], [5, 2, 0]);
  assert.deepEqual(longAttackClimbs({ climbs: [] }), { last: null, prev: null, early: null });
  assert.deepEqual(longAttackClimbs(null), { last: null, prev: null, early: null });
});

test("#7884 B1: angrebsplanen og tvillingens plan er gyldige kaeder for en fri rolle", () => {
  const route = stagePlanRouteFromRaw(PROFILE);
  for (const climb of route.climbs) {
    const p = longAttackPlans(climb);
    assert.equal(validateStagePlanLegs(p.on, "free_role", route), null);
    assert.equal(validateStagePlanLegs(p.off, "free_role", route), null);
    assert.deepEqual(p.on[1], { task: "attack", from: { at: "kom", kom_index: climb.index } });
  }
});

test("#7884 B1: summarizeLongAttack opdeler pr. gruppe, klasse, etapetype og niveau; flad+tt er kontrol", () => {
  const rnd = seeded(7884);
  const recs = [];
  const cells = [["one_day", "hilly", "hilly"], ["gt", "mountain", "high_mountain"], ["gt", "flat", "flat"], ["youth", "tt", "itt_hilly"]];
  for (const [group, cls, ptype] of cells) {
    for (let i = 0; i < 6; i++) {
      for (const level of ["mid", "strong", "top"]) {
        const road = cls === "hilly" || cls === "mountain";
        recs.push({ exp: "longattack", arm: "last", level, metric: "time", group, cls, ptype, dOn: road ? -10 - rnd() : rnd() - 0.5, dCtrl: rnd() - 0.5 });
      }
    }
  }
  recs.push({ exp: "longattack", arm: "none", level: "stage", metric: "no_climb", value: 1, group: "one_day", cls: "flat" });
  recs.push({ exp: "effort", arm: "all_out", level: "mid", metric: "time", group: "gt", cls: "mountain", dOn: 1, dCtrl: 0 });
  const la = summarizeLongAttack(recs);
  const time = la.arms.find((a) => a.arm === "last" && a.metric === "time");
  assert.equal(time.all.n, 72);
  assert.equal(time.road.n, 36);
  assert.equal(time.control.n, 36);
  assert.equal(time.road.directionOk, true);
  assert.equal(time.road.beatsNoise, true);
  assert.equal(time.control.beatsNoise, false, "kontrollen maa ikke vise en gevinst");
  assert.deepEqual(Object.keys(time.byGroup).sort(), ["gt", "one_day", "youth"]);
  assert.deepEqual(Object.keys(time.byClass).sort(), ["flat", "hilly", "mountain", "tt"]);
  assert.deepEqual(Object.keys(time.byPtype).sort(), ["flat", "high_mountain", "hilly", "itt_hilly"]);
  assert.deepEqual(Object.keys(time.byGroupClass.gt).sort(), ["flat", "mountain"]);
  assert.equal(time.byLevel.top.n, 24);
  assert.deepEqual(la.noClimb, { byClass: { flat: 1 }, byGroup: { one_day: 1 } });
  assert.equal(summarizeLongAttack([{ exp: "effort", metric: "time" }]), null, "uden armen: intet afsnit");
  const md = renderLongAttackMarkdown(la).join("\n");
  assert.ok(md.includes("#7884 B1") && md.includes("Etaper uden stigning"));
});

// ── B2/B6/B10 (longAttackBaseline7884) ─────────────────────────────────────

test("#7884 quantile: median og p95 med interpolation, tomt = null", () => {
  assert.equal(quantile([3, 1, 2], 0.5), 2);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile(Array.from({ length: 21 }, (_, i) => i), 0.95), 19);
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([NaN, 5], 0.5), 5);
});

test("#7884 lastClimbWindow: sidste stigning fra fod til top, ogsaa en topankomst", () => {
  assert.deepEqual(lastClimbWindow(PROFILE), { foot: 150, crest: 160 });
  assert.deepEqual(lastClimbWindow({ ...PROFILE, climbs: PROFILE.climbs.slice(0, 2) }), { foot: 98, crest: 110 });
  assert.equal(lastClimbWindow({ distance_km: 100, climbs: [] }), null);
  assert.equal(lastClimbWindow({ distance_km: 100, climbs: [{ crest_km: 50, length_km: 2, category: "x" }] }), null, "ukategoriseret taeller ikke");
  assert.deepEqual(lastClimbWindow({ distance_km: 100, climbs: [{ km: 40, category: "4" }] }), { foot: 40, crest: 40 }, "uden laengde: toppen alene");
});

test("#7884 forwardSplitRiders: kun negative split inden for vinduet", () => {
  const w = { foot: 150, crest: 160 };
  const ev = [
    { type: "peloton_splits", km: 155, params: { rider_ids: ["a"], gap_seconds: -12 } },
    { type: "peloton_splits", km: 160 + KM_EPS / 2, params: { rider_ids: ["b"], gap_seconds: -3 } },
    { type: "peloton_splits", km: 156, params: { rider_ids: ["c"], gap_seconds: 20 } },
    { type: "peloton_splits", km: 120, params: { rider_ids: ["d"], gap_seconds: -9 } },
    { type: "group_merged", km: 155, params: { rider_ids: ["e"], gap_seconds: -1 } },
  ];
  assert.deepEqual([...forwardSplitRiders(ev, w)].sort(), ["a", "b"]);
  assert.equal(forwardSplitRiders(ev, null).size, 0);
  assert.deepEqual([...forwardSplitRiders(ev, { foot: -Infinity, crest: Infinity })].sort(), ["a", "b", "d"]);
});

test("#7884 lateAttacksOf + winnerOf", () => {
  const ev = [{ type: "finale_attack", km: 150, params: { kind: "late_attack", rider_id: 7 } }, { type: "finale_attack", km: 155, params: { kind: "gap_survived" } }];
  assert.deepEqual(lateAttacksOf(ev), [{ riderId: "7", km: 150 }]);
  const results = [{ rider_id: "x", status: "finished", time_seconds: 100, rank: 2 }, { rider_id: "y", status: "finished", time_seconds: 100, rank: 1 }, { rider_id: "z", status: "dnf", time_seconds: 1 }];
  assert.deepEqual(winnerOf(results), { riderId: "y", time: 100 });
  assert.equal(winnerOf([]), null);
});

const out = (events, times) => ({ timeline: { events }, results: Object.entries(times).map(([id, t], i) => ({ rider_id: id, status: "finished", time_seconds: t, rank: i + 1 })) });

test("#7884 measureStage7884: frem-split vinder, sent angreb holder (vandt / foran feltet), tidskoersel taeller ikke", () => {
  const split = [{ type: "peloton_splits", km: 158, params: { rider_ids: ["a"], gap_seconds: -10 } }];
  const won = measureStage7884({ profile: PROFILE, out: out(split, { a: 100, b: 110 }), ms: 42 });
  assert.deepEqual([won.hasClimb, won.forwardSplit, won.wonFromForwardSplit, won.ms], [true, true, true, 42]);
  const lost = measureStage7884({ profile: PROFILE, out: out(split, { b: 100, a: 110 }) });
  assert.deepEqual([lost.forwardSplit, lost.wonFromForwardSplit, lost.ms], [true, false, null]);
  const late = [{ type: "finale_attack", km: 150, params: { kind: "late_attack", rider_id: "s" } }];
  const held = measureStage7884({ profile: PROFILE, out: out(late, { s: 100, f: 120 }) });
  assert.deepEqual([held.lateAttack, held.lateAttackHeldWin, held.lateAttackHeldAhead], [true, true, true]);
  const behindBreak = measureStage7884({ profile: PROFILE, out: out(late, { u: 90, s: 100, f: 120 }), breakIds: new Set(["u"]) });
  assert.deepEqual([behindBreak.lateAttackHeldWin, behindBreak.lateAttackHeldAhead], [false, true], "udbruddet foran: holdt mod feltet, men ikke sejren");
  const caught = measureStage7884({ profile: PROFILE, out: out(late, { f: 99, s: 100 }) });
  assert.deepEqual([caught.lateAttackHeldWin, caught.lateAttackHeldAhead], [false, false]);
  const tt = measureStage7884({ profile: { ...PROFILE, profile_type: "itt" }, out: out(split, { a: 100 }) });
  assert.deepEqual([tt.tt, tt.hasClimb, tt.forwardSplit], [true, false, false]);
});

test("#7884 b2Of/b6Of/summarize7884: andele med de rigtige naevnere, faste seeds", () => {
  const rnd = seeded(12);
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const tt = i % 10 === 0;
    const hasClimb = !tt && i % 4 !== 1;
    const forwardSplit = hasClimb && rnd() < 0.5;
    rows.push({ group: i % 2 ? "gt" : "one_day", profile_type: tt ? "itt" : i % 3 ? "hilly" : "mountain", tt, hasClimb, forwardSplit, wonFromForwardSplit: forwardSplit && rnd() < 0.5, lateAttack: !tt && rnd() < 0.3, lateAttackHeldWin: false, lateAttackHeldAhead: false, ms: 10 + i });
  }
  for (const r of rows) if (r.lateAttack) { r.lateAttackHeldWin = rnd() < 0.5; r.lateAttackHeldAhead = r.lateAttackHeldWin || rnd() < 0.5; }
  const b2 = b2Of(rows);
  const climbing = rows.filter((r) => !r.tt && r.hasClimb);
  assert.equal(b2.stages, climbing.length);
  assert.equal(b2.wonFromForwardSplit, climbing.filter((r) => r.wonFromForwardSplit).length);
  assert.equal(b2.shareWon, b2.wonFromForwardSplit / b2.stages);
  assert.ok(b2.wonGivenSplit >= b2.shareWon);
  const b6 = b6Of(rows);
  assert.equal(b6.stages, rows.filter((r) => !r.tt).length);
  assert.ok(b6.heldWin <= b6.heldAhead, "en sejr er altid ogsaa foran feltet i testdataene");
  assert.deepEqual(b2Of([]), { stages: 0, withForwardSplit: 0, wonFromForwardSplit: 0, shareWon: null, shareSplit: null, wonGivenSplit: null });
  const sum = summarize7884(rows);
  assert.equal(sum.n, 40);
  assert.equal(sum.b10.all.n, 40);
  assert.equal(sum.b10.all.median, quantile(rows.map((r) => r.ms), 0.5));
  assert.equal(sum.b10.all.max, 49);
  assert.deepEqual(Object.keys(sum.b2.byGroup), ["gt", "one_day"]);
  assert.deepEqual(Object.keys(sum.b6.byProfile), ["hilly", "itt", "mountain"]);
  const md = renderBenchMarkdown(sum, { revision: "r", scope: "all", genSeeds: 1, simSeeds: 1, races: 2 });
  assert.ok(md.includes("## B2") && md.includes("## B6") && md.includes("## B10") && md.includes("PRIVAT"));
  assert.ok(renderBenchMarkdown(sum, { revision: "r", scope: "export", genSeeds: 0, simSeeds: 1, races: 2 }).includes("prod-eksporten"));
});

test("#7884 benchRaceGroup: samme inddeling som #7266 for seniorer", () => {
  assert.equal(benchRaceGroup({ race_class: "TourFrance" }, 21), "gt");
  assert.equal(benchRaceGroup({ race_class: "GiroVuelta" }, 21), "gt");
  assert.equal(benchRaceGroup({ race_class: "Monuments" }, 1), "monument");
  assert.equal(benchRaceGroup({ race_class: "ProSeries" }, 5), "short_stage");
  assert.equal(benchRaceGroup({ race_class: "Class1" }, 1), "one_day");
});

test("#7884 assertPrivateOut: kun under balance-internals (hard rule 17)", () => {
  assert.doesNotThrow(() => assertPrivateOut(path.join("x", "balance-internals", "7884", "d")));
  assert.throws(() => assertPrivateOut(path.join("docs", "7884")), /balance-internals/);
});

// ── B11 ─────────────────────────────────────────────────────────────────────

test("#7884 B11_SQL: én SELECT, kun laesning, kun kolonner fra schema-snapshottet", () => {
  const sql = B11_SQL.toLowerCase();
  assert.ok(sql.startsWith("with "));
  assert.equal((B11_SQL.match(/;/g) ?? []).length, 1, "ét statement");
  assert.ok(B11_SQL.trim().endsWith(";"));
  for (const w of ["insert ", "update ", "delete ", "drop ", "alter ", "truncate ", "create ", "grant "]) assert.ok(!sql.includes(w), w);
  for (const col of ["o.riders", "r.status", "r.stages_completed", "sp.climbs", "sp.distance_km", "rsr.race_role", "re.race_role"]) assert.ok(B11_SQL.includes(col), col);
  for (const t of ["race_team_orders", "races", "race_stage_profiles", "race_stage_roles", "race_entries"]) assert.ok(sql.includes(` ${t} `), t);
});

test("#7884 summarizeB11: andele pr. etapetilstand, led pr. punkt og rolle", () => {
  const rows = [
    { kind: "all_plans", stage_state: "done", n: 200 },
    { kind: "all_plans", stage_state: "pending", n: 50 },
    { kind: "attack_plans", stage_state: "done", n: 20 },
    { kind: "attack_plans", stage_state: "pending", n: 5 },
    { kind: "attack_legs", stage_state: "done", role: "captain", at: "kom", kom_pos: "last", n: 12 },
    { kind: "attack_legs", stage_state: "done", role: "helper", at: "kom", kom_pos: "earlier", n: 3 },
    { kind: "attack_legs", stage_state: "pending", role: "captain", at: "final_km", kom_pos: null, n: 4 },
    { kind: "attack_legs", stage_state: "pending", role: "free_role", at: "start", kom_pos: null, n: 2 },
  ];
  const s = summarizeB11(rows);
  assert.deepEqual(s.byState.done, { plans: 200, plansWithAttack: 20, shareWithAttack: 0.1 });
  assert.deepEqual(s.byState.pending, { plans: 50, plansWithAttack: 5, shareWithAttack: 0.1 });
  assert.deepEqual(s.legsByPoint, { kom_last: { done: 12, pending: 0 }, kom_earlier: { done: 3, pending: 0 }, final_km: { done: 0, pending: 4 }, start: { done: 0, pending: 2 } });
  assert.deepEqual(s.legsByRole.captain, { done: 12, pending: 4 });
  assert.deepEqual(summarizeB11([]).byState.done, { plans: 0, plansWithAttack: 0, shareWithAttack: null });
  assert.ok(renderB11Markdown(s).includes("kom_last"));
});
