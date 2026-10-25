import test from "node:test";
import assert from "node:assert/strict";

import { runAcademyWeeklyPullSweep, MAX_AI_PULLS_PER_RUN } from "./academyWeeklyPull.ts";

// Mini-supabase: teams og academy_intake_ticks som in-memory rækker. Filtrene
// (eq/is/not) anvendes rigtigt, så testen fanger forkerte hold-udvælgelser.
function buildSupabase({ teams = [], ticks = [] } = {}) {
  const log = { reads: [], writes: 0 };
  const rowsFor = (table) => (table === "teams" ? teams : table === "academy_intake_ticks" ? ticks : []);
  return {
    log,
    from(table) {
      log.reads.push(table);
      let rows = rowsFor(table);
      const api = {
        select() { return api; },
        eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
        is(col, val) { rows = rows.filter((r) => (r[col] ?? null) === val); return api; },
        not(col, op, val) { rows = rows.filter((r) => (r[col] ?? null) !== val); return api; },
        order() { return api; },
        range(from, to) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); },
        insert() { log.writes += 1; return api; },
        upsert() { log.writes += 1; return api; },
        update() { log.writes += 1; return api; },
        delete() { log.writes += 1; return api; },
      };
      return api;
    },
  };
}

const base = { is_bank: false, is_frozen: false, is_test_account: false, retired_at: null, parked_at: null };
const ai = (id) => ({ ...base, id, is_ai: true, user_id: null });
const human = (id) => ({ ...base, id, is_ai: false, user_id: `u-${id}`, academy_intake_seeded_at: "2026-01-01" });

// 2026-10-25 er en søndag; 2026-10-26 (mandag 00:30 lokal) er en ny uge.
const SUNDAY = new Date("2026-10-25T10:00:00Z");
const MONDAY_AFTER_MIDNIGHT = new Date("2026-10-25T23:30:00Z"); // 00:30 mandag 26/10 i København (CET)
const WEDNESDAY = new Date("2026-10-21T10:00:00Z");

function harness(sb, overrides = {}) {
  const pulls = [];
  const notes = [];
  return {
    pulls,
    notes,
    run: (opts = {}) => runAcademyWeeklyPullSweep({
      supabase: sb,
      now: SUNDAY,
      isAssistEnabled: async () => true,
      isPullEnabled: async () => true,
      pullFn: async (_s, a) => { pulls.push(a); return { ok: true, alreadyPulled: false, candidates: [] }; },
      notify: async (a) => { notes.push(a); return { delivered: true }; },
      ...overrides,
      ...opts,
    }),
  };
}

test("flag slukket = ingen ændring: hverken læsning, pull eller påmindelse", async () => {
  const sb = buildSupabase({ teams: [ai("a1"), human("h1")] });
  const h = harness(sb, { isAssistEnabled: async () => false });
  const r = await h.run();
  assert.deepEqual(r, { ran: false, reason: "flag_off" });
  assert.equal(sb.log.reads.length, 0);
  assert.equal(h.pulls.length, 0);
  assert.equal(h.notes.length, 0);
});

test("pull-flaget slukket = ingen ændring", async () => {
  const sb = buildSupabase({ teams: [ai("a1"), human("h1")] });
  const h = harness(sb, { isPullEnabled: async () => false });
  const r = await h.run();
  assert.deepEqual(r, { ran: false, reason: "pull_flag_off" });
  assert.equal(h.pulls.length + h.notes.length, 0);
});

test("AI-hold henter selv; menneskehold, banker, frosne, testhold og pensionerede røres ikke af pull", async () => {
  const sb = buildSupabase({
    teams: [
      ai("a1"), ai("a2"),
      { ...ai("a-retired"), retired_at: "2026-01-01" },
      { ...ai("a-bank"), is_bank: true },
      human("h1"),
    ],
  });
  const h = harness(sb, { now: WEDNESDAY });
  const r = await h.run({ now: WEDNESDAY });
  assert.deepEqual(h.pulls.map((p) => p.teamId).sort(), ["a1", "a2"]);
  assert.equal(r.aiPulled, 2);
  assert.equal(r.weekSunday, "2026-10-25");
});

test("idempotens: hold med ugens claim hoppes over, og alreadyPulled tæller ikke", async () => {
  const sb = buildSupabase({
    teams: [ai("a1"), ai("a2")],
    ticks: [{ team_id: "a1", tick_date: "2026-10-25" }, { team_id: "a2", tick_date: "2026-10-18" }],
  });
  const h = harness(sb, { now: WEDNESDAY });
  await h.run({ now: WEDNESDAY });
  assert.deepEqual(h.pulls.map((p) => p.teamId), ["a2"]); // a2's claim er fra FORRIGE uge

  // Anden kørsel: pullFn svarer alreadyPulled (parallel kørsel) -> intet tælles.
  const h2 = harness(sb, { pullFn: async () => ({ ok: true, alreadyPulled: true, candidates: [] }), now: WEDNESDAY });
  const r2 = await h2.run({ now: WEDNESDAY });
  assert.equal(r2.aiPulled, 0);
});

test("ugegrænse: søndag 23:30 lokal tilhører ugen der slutter den dag, mandag 00:30 den næste", async () => {
  const sb = buildSupabase({ teams: [ai("a1")], ticks: [{ team_id: "a1", tick_date: "2026-10-25" }] });
  const sun = harness(sb);
  const r1 = await sun.run({ now: new Date("2026-10-25T21:30:00Z") }); // 23:30 søndag i København (CET)
  assert.equal(r1.weekSunday, "2026-10-25");
  assert.equal(sun.pulls.length, 0); // allerede hentet i den uge

  const mon = harness(sb);
  const r2 = await mon.run({ now: MONDAY_AFTER_MIDNIGHT });
  assert.equal(r2.weekSunday, "2026-11-01");
  assert.deepEqual(mon.pulls.map((p) => p.teamId), ["a1"]); // ny uge, nyt kuld
});

test("loft pr. kørsel: højst MAX_AI_PULLS_PER_RUN, resten rapporteres", async () => {
  const teams = Array.from({ length: MAX_AI_PULLS_PER_RUN + 5 }, (_, i) => ai(`a${i}`));
  const h = harness(buildSupabase({ teams }), { now: WEDNESDAY });
  const r = await h.run({ now: WEDNESDAY });
  assert.equal(h.pulls.length, MAX_AI_PULLS_PER_RUN);
  assert.equal(r.aiRemaining, 5);
});

test("ét AI-holds fejl vælter ikke de andre og samles i errors", async () => {
  const sb = buildSupabase({ teams: [ai("a1"), ai("a2")] });
  const h = harness(sb, {
    now: WEDNESDAY,
    pullFn: async (_s, a) => { if (a.teamId === "a1") throw new Error("boom"); return { ok: true, alreadyPulled: false }; },
  });
  const r = await h.run({ now: WEDNESDAY });
  assert.equal(r.aiPulled, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /a1/);
});

test("påmindelse: kun søndag, kun menneskehold uden hentning, med akademi, aktive", async () => {
  const sb = buildSupabase({
    teams: [
      human("h-needs"),
      human("h-pulled"),
      { ...human("h-parked"), parked_at: "2026-09-01" },
      { ...human("h-noacademy"), academy_intake_seeded_at: null },
      { ...human("h-nouser"), user_id: null },
      ai("a1"),
    ],
    ticks: [{ team_id: "h-pulled", tick_date: "2026-10-25" }],
  });
  const h = harness(sb);
  const r = await h.run();
  assert.deepEqual(h.notes.map((n) => n.teamId), ["h-needs"]);
  assert.equal(r.reminded, 1);
  const n = h.notes[0];
  assert.equal(n.type, "academy_intake_ready");
  assert.equal(n.metadata.titleCode, "notif.academyPullReminder.title");
  assert.ok(n.dedupeWindowMs < 7 * 24 * 60 * 60 * 1000, "dedup-vinduet må ikke dække næste uges påmindelse");
});

test("ingen påmindelse på andre dage end søndag", async () => {
  const sb = buildSupabase({ teams: [human("h1")] });
  const h = harness(sb, { now: WEDNESDAY });
  const r = await h.run({ now: WEDNESDAY });
  assert.equal(h.notes.length, 0);
  assert.equal(r.reminded, 0);
});

test("idempotent påmindelse: deduperet notifikation tæller ikke, og en fejl samles", async () => {
  const sb = buildSupabase({ teams: [human("h1"), human("h2")] });
  const h = harness(sb, {
    notify: async (a) => {
      if (a.teamId === "h2") throw new Error("nope");
      return { delivered: false, deduped: true };
    },
  });
  const r = await h.run();
  assert.equal(r.reminded, 0);
  assert.equal(r.errors.length, 1);
});
