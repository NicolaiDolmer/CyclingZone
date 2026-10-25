import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fatigueStreaksFromRows,
  loadFatigueStreaks,
  FATIGUE_STREAK_FROM,
} from "./trainingFatigueStreak.js";

const row = (rider_id, tick_date, fatigue) => ({
  rider_id,
  tick_date,
  applied_condition: fatigue === undefined ? null : { fatigue },
});

test("streak: tæller afregnede dage i træk fra nyeste, uanset input-rækkefølge", () => {
  const out = fatigueStreaksFromRows([
    row("a", "2026-10-21", 75),
    row("a", "2026-10-23", 80),
    row("a", "2026-10-22", 71),
    row("a", "2026-10-20", 40),
    row("a", "2026-10-19", 90),
  ]);
  assert.deepEqual(out, { a: 3 });
});

test("streak: grænsen er inklusiv, og en dag under bryder rækken", () => {
  assert.equal(FATIGUE_STREAK_FROM, 70);
  const out = fatigueStreaksFromRows([
    row("a", "2026-10-23", 70),
    row("a", "2026-10-22", 69),
    row("a", "2026-10-21", 99),
  ]);
  assert.deepEqual(out, { a: 1 });
});

test("streak: en rytter hvis nyeste dag er under grænsen udelades (0)", () => {
  const out = fatigueStreaksFromRows([row("a", "2026-10-23", 50), row("a", "2026-10-22", 90)]);
  assert.deepEqual(out, {});
});

test("streak: manglende eller ugyldigt tal bryder rækken i stedet for at blive talt", () => {
  const out = fatigueStreaksFromRows([
    row("a", "2026-10-23", 80),
    row("a", "2026-10-22", undefined),
    row("a", "2026-10-21", 80),
    row("b", "2026-10-23", "abc"),
  ]);
  assert.deepEqual(out, { a: 1 });
});

test("streak: ryttere holdes adskilt", () => {
  const out = fatigueStreaksFromRows([
    row("a", "2026-10-23", 80),
    row("b", "2026-10-23", 85),
    row("b", "2026-10-22", 85),
  ]);
  assert.deepEqual(out, { a: 1, b: 2 });
});

function fakeClient({ rows = [], error = null } = {}) {
  const calls = [];
  const chain = {
    select: (...a) => (calls.push(["select", ...a]), chain),
    in: (...a) => (calls.push(["in", ...a]), chain),
    eq: (...a) => (calls.push(["eq", ...a]), chain),
    gte: (...a) => (calls.push(["gte", ...a]), chain),
    order: (...a) => (calls.push(["order", ...a]), chain),
    range: async (from, to) => ({ data: error ? null : rows.slice(from, to + 1), error }),
  };
  return { calls, from: (table) => (calls.push(["from", table]), chain) };
}

test("loader: læser på rider_id + season_id (aldrig team_id) og returnerer map", async () => {
  const client = fakeClient({ rows: [row("a", "2026-10-23", 80), row("a", "2026-10-22", 80)] });
  const out = await loadFatigueStreaks(client, { riderIds: ["a", "b"], seasonId: "s1", now: new Date("2026-10-24T10:00:00Z") });
  assert.deepEqual(out, { a: 2 });
  const names = client.calls.map((c) => c.slice(0, 2).join(":"));
  assert.ok(names.includes("from:training_condition_settlements"));
  assert.ok(names.includes("in:rider_id"));
  assert.ok(names.includes("eq:season_id"));
  assert.ok(!names.some((n) => n.includes("team_id")), "må ikke læse på team_id");
  const since = client.calls.find((c) => c[0] === "gte");
  assert.equal(since[1], "tick_date");
  assert.equal(since[2], "2026-09-24");
});

test("loader: fail-safe, null uden ryttere/sæson og ved fejl", async () => {
  assert.equal(await loadFatigueStreaks(fakeClient(), { riderIds: [], seasonId: "s1" }), null);
  assert.equal(await loadFatigueStreaks(fakeClient(), { riderIds: ["a"], seasonId: null }), null);
  assert.equal(await loadFatigueStreaks(null, { riderIds: ["a"], seasonId: "s1" }), null);
  const failing = fakeClient({ error: { message: "boom" } });
  assert.equal(await loadFatigueStreaks(failing, { riderIds: ["a"], seasonId: "s1" }), null);
});

test("wiring: /api/training/me henter kun streaks med flaget on og sender feltet", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../routes/api.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /import \{ loadFatigueStreaks \} from "\.\.\/lib\/trainingFatigueStreak\.js"/);
  assert.match(src, /decisionCard \? loadFatigueStreaks\(supabase, \{ riderIds, seasonId: activeSeasonId \}\)/);
  assert.match(src, /\.\.\.\(fatigueStreaks \? \{ fatigueDays70: fatigueStreaks \} : \{\}\)/);
});
