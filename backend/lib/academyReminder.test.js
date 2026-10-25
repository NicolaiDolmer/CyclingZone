import test from "node:test";
import assert from "node:assert/strict";

import {
  academyReminderKind,
  runAcademyPullReminderSweep,
  REMINDER_COPY,
  REMINDER_DEDUPE_WINDOW_MS,
  REMINDER_EXPIRING_HOUR,
  REMINDER_READY_HOUR,
} from "./academyReminder.ts";
import { ACADEMY_REMINDER_WALL_CLOCK } from "./cronMonitorRegistry.js";

// Mini-supabase: teams og academy_intake_ticks som in-memory rækker. Filtrene
// (eq/is/not) anvendes rigtigt, så testen fanger forkerte hold-udvælgelser.
function buildSupabase({ teams = [], ticks = [] } = {}) {
  const log = { reads: [] };
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
      };
      return api;
    },
  };
}

const base = { is_bank: false, is_frozen: false, is_test_account: false, retired_at: null, parked_at: null };
const ai = (id) => ({ ...base, id, is_ai: true, user_id: null });
const human = (id) => ({ ...base, id, is_ai: false, user_id: `u-${id}`, academy_intake_seeded_at: "2026-01-01" });

// Uge søndag 25/10 - lørdag 31/10 2026 (nøgle 2026-10-31). Sommertid slutter
// natten til 25/10, så hele ugen er CET (UTC+1).
const SUN_10 = new Date("2026-10-25T09:00:00Z"); // søndag 10:00 CET
const SAT_18 = new Date("2026-10-31T17:00:00Z"); // lørdag 18:00 CET
const WEEK_KEY = "2026-10-31";

// Notify der efterligner notificationService's dedup: samme type/titel/tekst til
// samme hold inden for dedupeWindowMs leveres ikke igen.
function dedupingNotify() {
  const sent = [];
  const fn = async (a) => {
    const dup = sent.find((s) => s.teamId === a.teamId && s.type === a.type && s.title === a.title
      && s.message === a.message && a.now.getTime() - s.now.getTime() < a.dedupeWindowMs);
    if (dup) return { delivered: false, deduped: true };
    sent.push(a);
    return { delivered: true };
  };
  return { sent, fn };
}

function run(sb, opts = {}) {
  return runAcademyPullReminderSweep({
    supabase: sb,
    now: SUN_10,
    isReminderEnabled: async () => true,
    isPullEnabled: async () => true,
    notify: async () => ({ delivered: true }),
    ...opts,
  });
}

test("tidspunkter: søndag fra 10:00 og lørdag fra 18:00 dansk tid, ellers ingen", () => {
  // Vintertid (CET, UTC+1)
  assert.equal(academyReminderKind(new Date("2026-10-25T08:59:00Z")), null, "søndag 09:59");
  assert.equal(academyReminderKind(new Date("2026-10-25T09:00:00Z")), "ready", "søndag 10:00");
  assert.equal(academyReminderKind(new Date("2026-10-25T22:59:00Z")), "ready", "søndag 23:59");
  assert.equal(academyReminderKind(new Date("2026-10-25T23:00:00Z")), null, "mandag 00:00");
  assert.equal(academyReminderKind(new Date("2026-10-28T17:00:00Z")), null, "onsdag 18:00");
  assert.equal(academyReminderKind(new Date("2026-10-31T16:59:00Z")), null, "lørdag 17:59");
  assert.equal(academyReminderKind(new Date("2026-10-31T17:00:00Z")), "expiring", "lørdag 18:00");
  assert.equal(academyReminderKind(new Date("2026-10-31T22:59:00Z")), "expiring", "lørdag 23:59");
  assert.equal(academyReminderKind(new Date("2026-10-31T23:00:00Z")), null, "søndag 00:00");
  // Sommertid (CEST, UTC+2)
  assert.equal(academyReminderKind(new Date("2026-10-24T15:59:00Z")), null, "lørdag 17:59 CEST");
  assert.equal(academyReminderKind(new Date("2026-10-24T16:00:00Z")), "expiring", "lørdag 18:00 CEST");
  assert.equal(academyReminderKind(new Date("2026-08-16T07:59:00Z")), null, "søndag 09:59 CEST");
  assert.equal(academyReminderKind(new Date("2026-08-16T08:00:00Z")), "ready", "søndag 10:00 CEST");
});

test("cron-skemaet dækker begge vinduer (paritet med modulets gate)", () => {
  assert.deepEqual([...ACADEMY_REMINDER_WALL_CLOCK.weekdays].sort(), ["sat", "sun"]);
  assert.equal(ACADEMY_REMINDER_WALL_CLOCK.repeatHourly, true);
  assert.equal(ACADEMY_REMINDER_WALL_CLOCK.hour, REMINDER_READY_HOUR, "søndagens første kørsel er kl. 10");
  assert.ok(ACADEMY_REMINDER_WALL_CLOCK.hour <= REMINDER_EXPIRING_HOUR, "lørdagens kl. 18 nås af timegenforsøget");
});

test("uden for vinduet: intet læses og intet sendes, også med flaget tændt", async () => {
  const sb = buildSupabase({ teams: [human("h1")] });
  let notes = 0;
  let flagReads = 0;
  const r = await run(sb, {
    now: new Date("2026-10-28T12:00:00Z"),
    isReminderEnabled: async () => { flagReads += 1; return true; },
    notify: async () => { notes += 1; return { delivered: true }; },
  });
  assert.deepEqual(r, { ran: false, reason: "outside_window" });
  assert.equal(sb.log.reads.length + notes + flagReads, 0);
});

test("flag slukket: ingen læsning af hold og ingen påmindelse", async () => {
  const sb = buildSupabase({ teams: [human("h1")] });
  let notes = 0;
  const r = await run(sb, { isReminderEnabled: async () => false, notify: async () => { notes += 1; return {}; } });
  assert.deepEqual(r, { ran: false, reason: "flag_off" });
  assert.equal(sb.log.reads.length + notes, 0);
});

test("pull-flaget slukket: ingen påmindelse", async () => {
  const sb = buildSupabase({ teams: [human("h1")] });
  const r = await run(sb, { isPullEnabled: async () => false });
  assert.deepEqual(r, { ran: false, reason: "pull_flag_off" });
  assert.equal(sb.log.reads.length, 0);
});

test("kun aktive menneskehold uden ugens hentning; AI-hold får aldrig en påmindelse", async () => {
  const sb = buildSupabase({
    teams: [
      human("h-needs"),
      human("h-pulled"),
      human("h-pulled-last-week"),
      { ...human("h-parked"), parked_at: "2026-09-01" },
      { ...human("h-noacademy"), academy_intake_seeded_at: null },
      { ...human("h-nouser"), user_id: null },
      { ...human("h-test"), is_test_account: true },
      { ...human("h-retired"), retired_at: "2026-01-01" },
      ai("a1"),
    ],
    ticks: [
      { team_id: "h-pulled", tick_date: WEEK_KEY },
      { team_id: "h-pulled-last-week", tick_date: "2026-10-24" },
      { team_id: "a1", tick_date: "2026-10-24" },
    ],
  });
  const notes = [];
  const r = await run(sb, { notify: async (a) => { notes.push(a); return { delivered: true }; } });
  assert.deepEqual(notes.map((n) => n.teamId).sort(), ["h-needs", "h-pulled-last-week"]);
  assert.equal(r.ran && r.reminded, 2);
  assert.equal(r.ran && r.weekKey, WEEK_KEY);
});

test("søndag: 'nye kandidater er klar'; lørdag: 'udløber i nat', begge med koder til spillerens sprog", async () => {
  const sb = buildSupabase({ teams: [human("h1")] });
  const sun = [];
  const rs = await run(sb, { notify: async (a) => { sun.push(a); return { delivered: true }; } });
  assert.equal(rs.ran && rs.kind, "ready");
  assert.equal(sun[0].type, "academy_intake_ready");
  assert.equal(sun[0].title, REMINDER_COPY.ready.title);
  assert.equal(sun[0].metadata.titleCode, "notif.academyPullReminderReady.title");
  assert.equal(sun[0].metadata.messageCode, "notif.academyPullReminderReady.message");

  const sat = [];
  const rl = await run(sb, { now: SAT_18, notify: async (a) => { sat.push(a); return { delivered: true }; } });
  assert.equal(rl.ran && rl.kind, "expiring");
  assert.equal(rl.ran && rl.weekKey, WEEK_KEY, "lørdag og søndag i samme uge har samme nøgle");
  assert.equal(sat[0].metadata.titleCode, "notif.academyPullReminderExpiring.title");
  assert.notEqual(sat[0].title, sun[0].title, "forskellig tekst, så søndagens dedup ikke spærrer lørdagens");
});

test("idempotens: højst én af hver pr. hold pr. uge, og næste uge sendes igen", async () => {
  const sb = buildSupabase({ teams: [human("h1"), human("h2")] });
  const n = dedupingNotify();
  const hour = 60 * 60 * 1000;

  // Søndag 10:00 og genforsøgene hver hele time til 23:00.
  const first = await run(sb, { notify: n.fn });
  assert.equal(first.ran && first.reminded, 2);
  for (let h = 1; h <= 13; h++) {
    const r = await run(sb, { notify: n.fn, now: new Date(SUN_10.getTime() + h * hour) });
    assert.equal(r.ran && r.reminded, 0, `søndag +${h} t`);
    assert.equal(r.ran && r.deduped, 2);
  }
  // Lørdag 18:00-23:00 i samme uge: én 'udløber'-påmindelse pr. hold.
  for (let h = 0; h <= 5; h++) {
    const r = await run(sb, { notify: n.fn, now: new Date(SAT_18.getTime() + h * hour) });
    assert.equal(r.ran && r.reminded, h === 0 ? 2 : 0, `lørdag +${h} t`);
  }
  assert.equal(n.sent.length, 4);
  assert.ok(REMINDER_DEDUPE_WINDOW_MS < 7 * 24 * hour, "vinduet må ikke dække næste uges påmindelse");

  // Næste søndag 10:00 (7 døgn senere) sendes igen.
  const next = await run(sb, { notify: n.fn, now: new Date(SUN_10.getTime() + 7 * 24 * hour) });
  assert.equal(next.ran && next.reminded, 2);
  assert.equal(next.ran && next.weekKey, "2026-11-07");
});

test("hold der henter efter søndagens påmindelse, får ingen påmindelse lørdag", async () => {
  const ticks = [];
  const sb = buildSupabase({ teams: [human("h1"), human("h2")], ticks });
  const n = dedupingNotify();
  await run(sb, { notify: n.fn });
  ticks.push({ team_id: "h1", tick_date: WEEK_KEY }); // h1 henter onsdag
  const r = await run(sb, { notify: n.fn, now: SAT_18 });
  assert.deepEqual(n.sent.filter((s) => s.now === SAT_18).map((s) => s.teamId), ["h2"]);
  assert.equal(r.ran && r.reminded, 1);
});

test("én fejlet påmindelse stopper ikke de andre og samles i errors", async () => {
  const sb = buildSupabase({ teams: [human("h1"), human("h2")] });
  const r = await run(sb, {
    notify: async (a) => {
      if (a.teamId === "h1") throw new Error("boom");
      return { delivered: true };
    },
  });
  assert.equal(r.ran && r.reminded, 1);
  assert.equal(r.ran && r.errors.length, 1);
  assert.match(r.ran ? r.errors[0] : "", /h1/);
});
