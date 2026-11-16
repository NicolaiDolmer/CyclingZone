import test from "node:test";
import assert from "node:assert/strict";

import {
  seasonResetInjury,
  injuryDaysIntoSeason,
  readSeasonInjuryResetConfig,
  applySeasonInjuryReset,
  SEASON_INJURY_RESET_MODE_KEY,
  SEASON_INJURY_RESET_APPLIED_KEY,
} from "./seasonInjuryReset.js";
import { runSeasonStartHooks } from "./seasonStartHooks.js";

const START = "2026-12-02";
const TODAY = "2026-11-29";

const injured = (until, extra = {}) => ({
  rider_id: "r1",
  injured_until: until,
  injury_cause: "race_crash",
  injury_end_game_day: 170,
  injury_season_id: "s5",
  injury_race_days_left: 12,
  ...extra,
});

const CLEARED = {
  injured_until: null,
  injury_cause: null,
  injury_end_game_day: null,
  injury_season_id: null,
  injury_race_days_left: null,
};

test("injuryDaysIntoSeason: inklusiv første løbsdato, 0 før start og ved ugyldige datoer", () => {
  assert.equal(injuryDaysIntoSeason({ injuredUntil: START, seasonStartDate: START }), 1);
  assert.equal(injuryDaysIntoSeason({ injuredUntil: "2026-12-05", seasonStartDate: START }), 4);
  assert.equal(injuryDaysIntoSeason({ injuredUntil: "2026-12-01", seasonStartDate: START }), 0);
  assert.equal(injuryDaysIntoSeason({ injuredUntil: null, seasonStartDate: START }), 0);
  assert.equal(injuryDaysIntoSeason({ injuredUntil: "x", seasonStartDate: START }), 0);
});

test("mode off: ingen ændring for nogen række", () => {
  for (const c of [injured("2026-12-10"), injured(START), injured(null), null]) {
    assert.equal(seasonResetInjury({ condition: c, mode: "off", seasonStartDate: START, today: TODAY }), null);
  }
});

test("ukendt mode kaster (fejlkonfiguration må ikke ske tavst i den rene kerne)", () => {
  assert.throws(() => seasonResetInjury({ condition: injured(START), mode: "halve", seasonStartDate: START }));
});

test("rask rytter og udløbet skade røres aldrig, uanset mode", () => {
  for (const mode of ["clear", "cap", "light"]) {
    assert.equal(seasonResetInjury({ condition: injured(null), mode, seasonStartDate: START, today: TODAY }), null);
    assert.equal(seasonResetInjury({ condition: injured("2026-11-20"), mode, seasonStartDate: START, today: TODAY }), null);
  }
});

test("A clear: enhver aktiv skade og sygdom forsvinder, inkl. løbsdags-koordinaten", () => {
  assert.deepEqual(seasonResetInjury({ condition: injured("2026-12-20"), mode: "clear", seasonStartDate: START, today: TODAY }), CLEARED);
  assert.deepEqual(seasonResetInjury({ condition: injured("2026-11-30", { injury_cause: "illness" }), mode: "clear", seasonStartDate: START, today: TODAY }), CLEARED);
});

test("B cap: lang skade afkortes til loftet, kort skade er urørt, årsagen bevares", () => {
  const out = seasonResetInjury({ condition: injured("2026-12-20"), mode: "cap", seasonStartDate: START, today: TODAY, capDays: 2 });
  assert.deepEqual(out, {
    injured_until: "2026-12-03",
    injury_cause: "race_crash",
    injury_end_game_day: null,
    injury_season_id: null,
    injury_race_days_left: null,
  });
  assert.equal(seasonResetInjury({ condition: injured("2026-12-03"), mode: "cap", seasonStartDate: START, today: TODAY, capDays: 2 }), null);
  assert.equal(seasonResetInjury({ condition: injured("2026-11-30"), mode: "cap", seasonStartDate: START, today: TODAY, capDays: 2 }), null);
});

test("C light: kun skader inden for grænsen forsvinder", () => {
  assert.deepEqual(seasonResetInjury({ condition: injured("2026-12-03"), mode: "light", seasonStartDate: START, today: TODAY, lightMaxDays: 2 }), CLEARED);
  assert.deepEqual(seasonResetInjury({ condition: injured("2026-11-30"), mode: "light", seasonStartDate: START, today: TODAY, lightMaxDays: 2 }), CLEARED);
  assert.equal(seasonResetInjury({ condition: injured("2026-12-04"), mode: "light", seasonStartDate: START, today: TODAY, lightMaxDays: 2 }), null);
});

test("idempotens: anden anvendelse af hver mode er et no-op", () => {
  for (const mode of ["clear", "cap", "light"]) {
    for (const until of ["2026-11-30", START, "2026-12-03", "2026-12-20"]) {
      const c = injured(until);
      const once = seasonResetInjury({ condition: c, mode, seasonStartDate: START, today: TODAY, capDays: 2, lightMaxDays: 2 });
      const after = once ? { ...c, ...once } : c;
      assert.equal(
        seasonResetInjury({ condition: after, mode, seasonStartDate: START, today: TODAY, capDays: 2, lightMaxDays: 2 }),
        null,
        `${mode} ${until}`,
      );
    }
  }
});

// ── DB-stien med en lille fake ──────────────────────────────────────────────

function fakeSupabase({ config = [], seasonStart = START, raceDaysCompleted = 0, rows = [], applied = null } = {}) {
  const writes = [];
  const reads = [];
  const from = (table) => {
    const q = {
      _table: table, _filters: [],
      select() { return q; },
      in(col, vals) { q._filters.push(["in", col, vals]); return q; },
      eq(col, v) { q._filters.push(["eq", col, v]); return q; },
      gte(col, v) { q._filters.push(["gte", col, v]); return q; },
      order() { return q; },
      range() { return q; },
      maybeSingle() {
        reads.push({ table, filters: q._filters });
        if (table === "app_config") return Promise.resolve({ data: applied == null ? null : { value: applied }, error: null });
        return Promise.resolve({ data: { start_date: seasonStart, race_days_completed: raceDaysCompleted }, error: null });
      },
      upsert(chunk, opts) { writes.push({ table, chunk, opts }); return Promise.resolve({ error: null }); },
      then(resolve, reject) {
        reads.push({ table, filters: q._filters });
        let data = [];
        if (table === "app_config") data = config;
        if (table === "rider_condition") {
          const gte = q._filters.find((f) => f[0] === "gte");
          data = rows.filter((r) => !gte || (r.injured_until && r.injured_until >= gte[2]));
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  const riderWrites = () => writes.filter((w) => w.table === "rider_condition");
  return { from, writes, reads, riderWrites };
}

const NOW = new Date("2026-11-29T12:00:00Z");

test("readSeasonInjuryResetConfig: manglende række / ugyldig værdi / kastende klient → off", async () => {
  assert.equal((await readSeasonInjuryResetConfig(fakeSupabase())).mode, "off");
  assert.equal((await readSeasonInjuryResetConfig(fakeSupabase({ config: [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "halve" }] }))).mode, "off");
  assert.equal((await readSeasonInjuryResetConfig({ from: () => { throw new Error("nede"); } })).mode, "off");
  assert.equal((await readSeasonInjuryResetConfig(null)).mode, "off");
  const cfg = await readSeasonInjuryResetConfig(fakeSupabase({ config: [
    { key: SEASON_INJURY_RESET_MODE_KEY, value: "cap" },
    { key: "season_injury_reset_cap_days", value: 0 },
  ] }));
  assert.equal(cfg.mode, "cap");
  assert.ok(cfg.capDays >= 1, "et loft under 1 falder tilbage til default");
});

test("kontakt slukket: flag_off, ingen læsning af rider_condition, ingen skrivning", async () => {
  const sb = fakeSupabase({ rows: [injured("2026-12-20")] });
  const res = await applySeasonInjuryReset({ supabase: sb, now: NOW, toSeasonId: "s6" });
  assert.deepEqual(res, { ran: false, reason: "flag_off" });
  assert.equal(sb.writes.length, 0);
  assert.ok(!sb.reads.some((r) => r.table === "rider_condition"));
});

test("kontakt slukket i seasonStartHooks: ingen fase-række (bit-identisk fase-log)", async () => {
  const sb = fakeSupabase({ rows: [injured("2026-12-20")] });
  const log = await runSeasonStartHooks({
    supabase: sb,
    now: NOW,
    toSeasonId: "s6",
    deps: {
      applySeasonFatigueReset: async () => ({ ran: false, reason: "flag_off" }),
      applySeasonFormReset: async () => ({ ran: false, reason: "flag_off" }),
      runSeasonAcademyIntake: async () => ({ ran: false, reason: "flag_off" }),
      expireSeasonScopedConsequences: async () => ({ expired: 0 }),
      stampUnscopedBonusOffers: async () => ({ stamped: 0 }),
    },
  });
  assert.ok(!log.some((l) => l.phase === "season_injury_reset"));
  assert.equal(sb.writes.length, 0);
});

test("clear: skriver kun skade-kolonnerne for aktive skader; anden kørsel skriver intet", async () => {
  const rows = [
    injured("2026-12-20", { rider_id: "a" }),
    injured("2026-11-30", { rider_id: "b", injury_cause: "illness" }),
    injured(null, { rider_id: "c" }),
  ];
  const sb = fakeSupabase({ config: [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "clear" }], rows });
  const res = await applySeasonInjuryReset({ supabase: sb, now: NOW, toSeasonId: "s6" });
  assert.equal(res.ran, true);
  assert.equal(res.seasonStartDate, START);
  assert.equal(res.cleared, 2);
  assert.equal(res.changed, 2);
  assert.equal(sb.riderWrites().length, 1);
  for (const w of sb.riderWrites()[0].chunk) {
    assert.deepEqual(Object.keys(w).sort(), ["injured_until", "injury_cause", "injury_end_game_day", "injury_race_days_left", "injury_season_id", "rider_id", "updated_at"]);
    assert.ok(!("form" in w) && !("fatigue" in w));
  }
  // Anvend skrivningerne og kør igen.
  const byId = new Map(rows.map((r) => [r.rider_id, r]));
  for (const w of sb.riderWrites()[0].chunk) Object.assign(byId.get(w.rider_id), w);
  // Idempotent inden for én kørsel: også uden markøren (fx hvis markør-skrivningen fejlede).
  const sb2 = fakeSupabase({ config: [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "clear" }], rows: [...byId.values()] });
  const res2 = await applySeasonInjuryReset({ supabase: sb2, now: NOW, toSeasonId: "s6" });
  assert.equal(res2.changed, 0);
  assert.equal(sb2.riderWrites().length, 0);
});

test("dryRun: tæller men skriver intet", async () => {
  const sb = fakeSupabase({ config: [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "clear" }], rows: [injured("2026-12-20")] });
  const res = await applySeasonInjuryReset({ supabase: sb, now: NOW, toSeasonId: "s6", dryRun: true });
  assert.equal(res.changed, 1);
  assert.equal(sb.writes.length, 0);
});

test("ankeret er den seneste af lagret start_date og skiftets danske dato; uden sæson-id bruges skiftets egen dato", async () => {
  const cap = [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "cap" }];
  // Lagret dato i fremtiden → den bruges.
  const fut = await applySeasonInjuryReset({ supabase: fakeSupabase({ config: cap, seasonStart: START, rows: [] }), now: NOW, toSeasonId: "s6", dryRun: true });
  assert.equal(fut.seasonStartDate, START);
  // Lagret dato før i dag → skiftets danske dato.
  const past = await applySeasonInjuryReset({ supabase: fakeSupabase({ config: cap, seasonStart: "2026-11-27", rows: [] }), now: NOW, toSeasonId: "s6", dryRun: true });
  assert.equal(past.seasonStartDate, TODAY);
  const none = await applySeasonInjuryReset({ supabase: fakeSupabase({ config: cap, rows: [] }), now: NOW, dryRun: true });
  assert.equal(none.seasonStartDate, TODAY);
});

// Review 16/11: start_date er en DATE skrevet fra et UTC-tidsstempel.
test("skifte kl. 00:30 dansk tid: UTC-datoen (gårsdagen) bliver ikke anker, skaden afkortes til fuldt loft", async () => {
  const cfg = [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "cap" }, { key: "season_injury_reset_cap_days", value: 3 }];
  const sb = fakeSupabase({ config: cfg, seasonStart: "2026-11-28", rows: [injured("2026-12-20")] });
  const res = await applySeasonInjuryReset({ supabase: sb, now: new Date("2026-11-28T23:30:00Z"), toSeasonId: "s6" });
  assert.equal(res.seasonStartDate, "2026-11-29");
  assert.equal(sb.riderWrites()[0].chunk[0].injured_until, "2026-12-01");
});

// Review 16/11: et genoptaget skifte (#578) må ikke røre skader fra den nye sæsons pause.
test("markør: skrives efter kørslen, ikke i dryRun; genoptaget skifte springes over uden at læse eller skrive skader", async () => {
  const cfg = [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "light" }, { key: "season_injury_reset_light_max_days", value: 2 }];
  const dry = fakeSupabase({ config: cfg, rows: [injured("2026-12-05")] });
  await applySeasonInjuryReset({ supabase: dry, now: new Date("2026-12-02T10:00:00Z"), toSeasonId: "s6", dryRun: true });
  assert.equal(dry.writes.length, 0);

  const first = fakeSupabase({ config: cfg, rows: [injured("2026-12-05")] });
  const res = await applySeasonInjuryReset({ supabase: first, now: new Date("2026-12-02T10:00:00Z"), toSeasonId: "s6" });
  assert.equal(res.changed, 0);
  const marker = first.writes.find((w) => w.table === "app_config");
  assert.ok(marker, "markøren skrives også når ingen skade ændres");
  assert.equal(marker.chunk.key, SEASON_INJURY_RESET_APPLIED_KEY);
  assert.equal(marker.chunk.value, "s6");

  // To dage senere: en træningsskade fra pausen ville ellers blive ryddet af "light".
  const retry = fakeSupabase({ config: cfg, rows: [injured("2026-12-05", { injury_cause: "training_overload" })], applied: "s6" });
  const second = await applySeasonInjuryReset({ supabase: retry, now: new Date("2026-12-04T10:00:00Z"), toSeasonId: "s6" });
  assert.equal(second.ran, false);
  assert.equal(second.reason, "already_applied");
  assert.equal(retry.writes.length, 0);
  assert.ok(!retry.reads.some((r) => r.table === "rider_condition"));

  // En markør for en ANDEN sæson blokerer ikke.
  const next = fakeSupabase({ config: cfg, rows: [], applied: "s5" });
  assert.equal((await applySeasonInjuryReset({ supabase: next, now: NOW, toSeasonId: "s6" })).ran, true);
});

test("gen-kørsel efter at den nye sæson har kørt løbsdage → springes over, intet læses eller skrives", async () => {
  const sb = fakeSupabase({ config: [{ key: SEASON_INJURY_RESET_MODE_KEY, value: "clear" }], raceDaysCompleted: 3, rows: [injured("2026-12-20", { injury_season_id: "s6" })] });
  const res = await applySeasonInjuryReset({ supabase: sb, now: NOW, toSeasonId: "s6" });
  assert.equal(res.ran, false);
  assert.equal(res.reason, "season_already_started");
  assert.equal(sb.writes.length, 0);
  assert.ok(!sb.reads.some((r) => r.table === "rider_condition"));
});
