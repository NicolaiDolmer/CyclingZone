// #7266: rene dele af maaleskriptet for taktik-ordrerne (ingen motor, ingen tal fra motoren).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHECKS,
  DEFAULT_GROUP_CAPS,
  GROUPS,
  MIN_FIELD,
  apiContradictionChecks,
  breakLead,
  effectStats,
  fillField,
  findings,
  invariants,
  mergeResults,
  pickEvenly,
  raceGroup,
  selectRaces,
  sgn,
  stageClass,
  summarize,
} from "./tacticsEffects7266.mjs";

test("#7266 raceGroup: U23/junior, Grand Tours, monumenter, korte etapeloeb og endagsloeb", () => {
  assert.equal(raceGroup({ squad: "u23", race_class: "Class1", stages: 5 }), "youth");
  assert.equal(raceGroup({ squad: "junior", race_class: "Class1", stages: 1 }), "youth");
  assert.equal(raceGroup({ squad: "senior", race_class: "TourFrance", stages: 21 }), "gt");
  assert.equal(raceGroup({ squad: "senior", race_class: "GiroVuelta", stages: 21 }), "gt");
  assert.equal(raceGroup({ squad: "senior", race_class: "Monuments", stages: 1 }), "monument");
  assert.equal(raceGroup({ squad: "senior", race_class: "ProSeries", stages: 6 }), "short_stage");
  assert.equal(raceGroup({ squad: "senior", race_class: "Class1", stages: 1 }), "one_day");
  assert.deepEqual(Object.keys(DEFAULT_GROUP_CAPS), [...GROUPS]);
});

test("#7266 stageClass: enkeltstart, flad, kuperet og bjerg", () => {
  assert.equal(stageClass("itt"), "tt");
  assert.equal(stageClass("itt_hilly"), "tt");
  assert.equal(stageClass("flat"), "flat");
  assert.equal(stageClass("rolling"), "flat");
  assert.equal(stageClass("hilly"), "hilly");
  assert.equal(stageClass("cobbles"), "hilly");
  assert.equal(stageClass("medium_mountain"), "mountain");
  assert.equal(stageClass("high_mountain"), "mountain");
});

test("#7266 pickEvenly/selectRaces: deterministisk og jaevnt fordelt pr. gruppe", () => {
  const xs = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(pickEvenly(xs, 5), [0, 2, 4, 6, 8]);
  assert.deepEqual(pickEvenly(xs, 20), xs);
  const all = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, group: "one_day" })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `g${i}`, group: "gt" })),
  ];
  const picked = selectRaces(all, { one_day: 3, gt: 5 });
  assert.deepEqual(picked.map((r) => r.id), ["o0", "o2", "o4", "g0", "g1"]);
});

test("#7266 fillField: et lille felt fyldes op med hele hold med nye id'er; et stort roeres ikke", () => {
  const small = { race: { id: "R" }, entries: [{ rider_id: "a", team_id: "T", race_role: "captain" }], abilities: [{ rider_id: "a", climbing: 1 }], teams: [{ id: "T", is_ai: false }] };
  const donorEntries = Array.from({ length: MIN_FIELD + 10 }, (_, i) => ({ rider_id: `d${i}`, team_id: `D${Math.floor(i / 8)}`, race_role: i % 8 === 0 ? "captain" : "helper" }));
  const donor = { race: { id: "X" }, entries: donorEntries, abilities: donorEntries.map((e) => ({ rider_id: e.rider_id, climbing: 2 })), teams: [] };
  const { data, filled } = fillField(small, [donor]);
  assert.ok(data.entries.length >= MIN_FIELD);
  assert.equal(filled, data.entries.length - 1);
  assert.ok(data.entries.slice(1).every((e) => e.rider_id.startsWith("fill0-") && e.team_id.startsWith("fill0-")), "nye id'er, aldrig donorens");
  assert.equal(new Set(data.entries.map((e) => e.rider_id)).size, data.entries.length);
  assert.ok(data.entries.every((e) => data.abilities.some((a) => a.rider_id === e.rider_id)));
  // Hele hold: hvert fyld-hold har alle sine ryttere med.
  const byTeam = new Map();
  for (const e of data.entries.slice(1)) byTeam.set(e.team_id, (byTeam.get(e.team_id) ?? 0) + 1);
  const donorSize = new Map();
  for (const e of donorEntries) donorSize.set(`fill0-${e.team_id}`, (donorSize.get(`fill0-${e.team_id}`) ?? 0) + 1);
  assert.ok([...byTeam.entries()].every(([t, n]) => n === donorSize.get(t)));
  assert.ok(data.teams.filter((t) => t.id.startsWith("fill0-")).every((t) => t.is_ai === true));
  const big = { ...donor, race: { id: "B" } };
  assert.equal(fillField(big, [small]).filled, 0);
  assert.equal(fillField(big, [small]).data, big);
});

test("#7266 effectStats: retning og stoej", () => {
  // Klar effekt i forventet retning, ingen stoej i kontrollen.
  const clear = effectStats([-3, -4, -5, -3, -4], [0, 0, 0, 0, 0], -1);
  assert.equal(clear.directionOk, true);
  assert.equal(clear.beatsNoise, true);
  assert.equal(clear.wrong, false);
  // Samme fortegn, men kontrollen er lige saa stor: retning ja, kan ikke maerkes.
  const noisy = effectStats([-1, 1, -2, 2, -1], [-1, 1, -2, 2, -1], -1);
  assert.equal(noisy.directionOk, true);
  assert.equal(noisy.beatsNoise, false);
  // Forkert retning.
  const wrong = effectStats([2, 3, 4], [0, 0, 0], -1);
  assert.equal(wrong.directionOk, false);
  assert.equal(wrong.wrong, true);
  assert.equal(wrong.beatsNoise, false);
  // Ingen effekt overhovedet: hverken rigtig eller forkert retning.
  const none = effectStats([0, 0, 0], [0, 0, 0], 1);
  assert.equal(none.directionOk, false);
  assert.equal(none.wrong, false);
  // null-maalinger springes over; ingen maalinger = n 0.
  assert.equal(effectStats([null, 1], [0, null], 1).n, 1);
  assert.equal(effectStats([], [], 1).n, 0);
});

test("#7266 sgn: fortegn for en tidsforskel", () => {
  assert.equal(sgn(-4.2), -1);
  assert.equal(sgn(0), 0);
  assert.equal(sgn(7), 1);
  assert.equal(sgn(null), null);
});

test("#7266 breakLead: udbruddets forspring i maal", () => {
  const out = { timeline: { events: [{ type: "breakaway_formed", params: { rider_ids: ["b1", "b2"] } }] } };
  assert.deepEqual(breakLead({ out, fin: new Map([["b1", 100], ["b2", 105], ["f1", 130], ["f2", 131]]) }), { formed: true, lead: 30 });
  assert.deepEqual(breakLead({ out, fin: new Map([["b1", 140], ["f1", 130]]) }), { formed: true, lead: -10 });
  assert.deepEqual(breakLead({ out: { timeline: { events: [] } }, fin: new Map([["f1", 1]]) }), { formed: false, lead: null });
});

test("#7266 summarize/findings: forkert retning, ikke maerkbar og brudte invarianter meldes", () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ exp: "break", arm: "try_break", metric: "attempt", group: "one_day", cls: "hilly", level: "mid", dOn: 1, dCtrl: 0 });
    rows.push({ exp: "effort", arm: "all_out", metric: "time", group: "gt", cls: "mountain", level: "mid", dOn: 5 + i, dCtrl: 0 });
    rows.push({ exp: "train", arm: "sprint_train", metric: "captain_rank", group: "one_day", cls: "flat", level: "team", dOn: i % 2 ? -1 : 1, dCtrl: i % 2 ? 1 : -1 });
    rows.push({ exp: "break", arm: "grupetto_try_break", metric: "attempt_invariant", group: "one_day", cls: "hilly", level: "mid", value: i === 3 ? 1 : 0 });
  }
  const summary = summarize(rows);
  const brk = summary.find((s) => s.exp === "break" && s.metric === "attempt");
  assert.equal(brk.scoped.beatsNoise, true);
  assert.equal(brk.byGroup.one_day.n, 10);
  assert.equal(brk.byLevel.mid.n, 10);
  const inv = invariants(rows);
  assert.deepEqual(inv, [{ id: "grupetto_try_break_never_attempts", n: 10, violations: 1 }]);
  const f = findings(summary, inv, [{ id: "x", path: "classic", expectReject: true, rejected: false }]);
  const kinds = f.map((x) => `${x.kind}:${x.exp ?? x.id}`);
  assert.ok(kinds.includes("wrong_direction:effort"));
  assert.ok(kinds.includes("wrong_direction_in_group:effort"));
  assert.ok(kinds.includes("no_effect:train"));
  assert.ok(kinds.includes("invariant_broken:grupetto_try_break_never_attempts"));
  assert.ok(kinds.includes("api_accepts_blocked:x"));
  assert.ok(!kinds.includes("not_noticeable:break"));
});

test("#7266 mergeResults: koersler pr. gruppe samles til ét resultat", () => {
  const a = { config: { caps: { gt: 3 } }, races: [{ race: "g" }], records: [{ exp: "break", arm: "try_break", metric: "attempt", group: "gt", cls: "hilly", level: "mid", dOn: 1, dCtrl: 0 }] };
  const b = { config: { caps: { one_day: 2 } }, races: [{ race: "o" }], records: [{ exp: "break", arm: "try_break", metric: "attempt", group: "one_day", cls: "flat", level: "mid", dOn: 1, dCtrl: 0 }], api: [] };
  const m = mergeResults([a, b]);
  assert.equal(m.records.length, 2);
  assert.equal(m.races.length, 2);
  assert.deepEqual(m.config.caps, { gt: 3, one_day: 2 });
  assert.equal(m.summary.find((s) => s.metric === "attempt").scoped.n, 2);
});

test("#7266 CHECKS: hver maaling har et forventet fortegn og et sted hvor den skal kunne maerkes", () => {
  for (const c of CHECKS) {
    assert.ok(c.sign === 1 || c.sign === -1, `${c.exp}/${c.arm} ${c.metric}`);
    assert.ok(Array.isArray(c.scope) && c.scope.length > 0);
    assert.ok(typeof c.what === "string" && c.what.length > 0);
  }
});

// API'et (spec 2026-10-25-taktik-roller-design.md par. 3 + par. 11): etapeplanens regler holder.
const api = apiContradictionChecks();
const byId = new Map(api.map((a) => [a.id, a]));

test("#7266 API: etapeplanens spaerrede modsaetninger afvises, og en gyldig kaede tillades", () => {
  for (const id of ["plan_breakaway_not_first", "plan_grupetto_before_work", "plan_train_after_dropped", "plan_captain_grupetto", "plan_backwards_in_time", "plan_dropped_not_last"]) {
    assert.equal(byId.get(id).rejected, true, id);
    assert.ok(byId.get(id).error?.startsWith("stage_plan_"), id);
  }
  assert.equal(byId.get("plan_valid_helper_chain").rejected, false);
});

// Fund #7266 (26/10): den klassiske ordre-raekke afviser endnu ikke par. 3's modsaetninger,
// og en plan med udbrud efterfulgt af sprinttog tages imod. KENDTE_AABNE er listen over de
// kombinationer der er aabne lige nu; fjern en kombination fra listen i samme PR som API'et
// begynder at afvise den, saa testen bliver en gate (spec par. 9 raekke 2).
const KENDTE_AABNE = new Set(["grupetto_plus_try_break", "grupetto_plus_sprint_train", "work_plus_try_break", "sprint_train_plus_try_break", "plan_breakaway_then_sprint_train"]);
for (const a of api.filter((x) => x.expectReject)) {
  const todo = KENDTE_AABNE.has(a.id) ? "fund #7266: API'et tager imod kombinationen" : false;
  test(`#7266 API: ${a.id} afvises`, { todo }, () => {
    assert.equal(byId.get(a.id).rejected, true);
  });
}

test("Codex P2: for faa gyldige maalinger giver aldrig 'maerkbar'", () => {
  assert.equal(effectStats([-1], [0], -1).beatsNoise, false);
  assert.equal(effectStats([-1], [0], -1).insufficient, true);
  assert.equal(effectStats([-1, -1], [null, null], -1).beatsNoise, false);
});
