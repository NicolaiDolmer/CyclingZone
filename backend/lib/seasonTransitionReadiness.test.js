import test from "node:test";
import assert from "node:assert/strict";

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assessSeasonEndBlockers, assessTransitionReadiness, countSquadLimitViolations } from "./seasonTransitionReadiness.js";
import { ALL_CRON_MONITORS } from "./cronMonitorRegistry.js";
import { getSquadLimits } from "./marketUtils.js";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));

// ─── Mock Supabase ────────────────────────────────────────────────────────────
// Dækker præcis de queries assessTransitionReadiness laver:
//   transfer_windows: select().eq().order().limit().maybeSingle()
//   auctions:         select(_, {count,head}).in()  → thenable {count}
//   races:            select().eq().neq().order().range() (fetchAllRows, #3038-fixet)
//   teams:            select().order().range()      (emptyPoolPolicy.js)
//   seasons:          select().eq().maybeSingle() (#2361: season_end_completed)

// Paged chain til fetchAllRows-forbrugere: alle filtre returnerer kæden,
// range(from, to) leverer det udsnit.
function pagedChain(rows, { calls = null, error = null } = {}) {
  const rec = (op) => (...args) => { if (calls) calls.push([op, ...args]); return chain; };
  const chain = {
    eq: rec("eq"),
    neq: rec("neq"),
    not: rec("not"),
    in: rec("in"),
    order: () => chain,
    range: (from, to) => Promise.resolve(error
      ? { data: null, error }
      : { data: rows.slice(from, to + 1), error: null }),
  };
  return chain;
}

// #5855: hold med `count` senior-ryttere hver (team_id = holdets id).
function ridersFor(teamId, count) {
  return Array.from({ length: count }, (_, i) => ({ id: `${teamId}-r${i}`, team_id: teamId }));
}

function createMockSupabase({
  win = null,
  activeAuctionCount = 0,
  unfinishedRaceCount = 0,
  // Rækker for races-læsningen; default afledes af unfinishedRaceCount med
  // league_division_id=null (blokerer altid, matcher den gamle count-adfærd).
  unfinishedRaceRows = null,
  // teams-tabellen (empty-pool-filteret). Default tom → fail-open, filter inaktivt.
  teamRows = [],
  // #2361: default = sæson 1, status completed → season_end_completed er ok
  // som default, så eksisterende tests (der ikke handler om dette check)
  // fortsat udtrykker deres oprindelige "ready"/"blocked af X"-forventning.
  seasonNumber = 1,
  seasonStatus = "completed",
  seasonMissing = false,
  // #5855: trup-grænse-målingen. humanTeams = rækker {id, division} fra
  // populationens teams-query; seniorRiders = rækker {id, team_id}. Default
  // tom → 0 overtrædelser.
  humanTeams = [],
  seniorRiders = [],
  ridersError = null,
  calls = null,
} = {}) {
  const thenableCount = (count) => ({
    then: (resolve) => resolve({ data: null, count, error: null }),
  });
  const raceRows = unfinishedRaceRows
    ?? Array.from({ length: unfinishedRaceCount }, (_, i) => ({ id: `race-${i}`, league_division_id: null }));
  return {
    _calls: calls,
    from(table) {
      if (table === "riders") {
        return {
          select: () => {
            const c = calls ? [] : null;
            if (calls) calls.push(["riders", c]);
            return pagedChain(seniorRiders, { calls: c, error: ridersError });
          },
        };
      }
      if (table === "teams") {
        return {
          select: (cols) => {
            if (cols === "id, division") {
              const c = calls ? [] : null;
              if (calls) calls.push(["teams", c]);
              return pagedChain(humanTeams, { calls: c });
            }
            return pagedChain(teamRows);
          },
        };
      }
      if (table === "transfer_windows") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: win, error: null }),
        };
        return { select: () => chain };
      }
      if (table === "auctions") {
        return { select: () => ({ in: () => thenableCount(activeAuctionCount) }) };
      }
      if (table === "races") {
        return { select: () => pagedChain(raceRows) };
      }
      if (table === "seasons") {
        const chain = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve({
            data: seasonMissing ? null : { id: FROM_SEASON_ID, number: seasonNumber, status: seasonStatus },
            error: null,
          }),
        };
        return { select: () => chain };
      }
      throw new Error(`Uventet tabel i mock: ${table}`);
    },
  };
}

const WRAPPED_WINDOW = {
  id: "w-1",
  status: "closed",
  closed_at: "2026-06-10T18:00:00Z",
  // #6120: final_whistle_sent_at bevidst null — altid-åbent marked, ingen Deadline Day-cron sætter den.
  final_whistle_sent_at: null,
  squad_enforcement_completed_at: "2026-06-10T18:10:00Z",
};

const FROM_SEASON_ID = "00000000-0000-0000-0000-000000000001";

// #5855: sådan ser en sæsons vindue ud i det NUVÆRENDE flow — født af
// transitionToNextSeason med status='closed', og ingen af de gamle
// deadline-cyklus-markører bliver nogensinde sat.
const CURRENT_FLOW_WINDOW = {
  id: "w-now",
  status: "closed",
  squad_enforcement_started_at: null,
  squad_enforcement_completed_at: null,
};

const MAX_D1 = getSquadLimits(1).max;
const COMPLIANT_TEAMS = [{ id: "hold-a", division: 1 }, { id: "hold-b", division: 1 }];
const COMPLIANT_RIDERS = [...ridersFor("hold-a", MAX_D1), ...ridersFor("hold-b", MAX_D1 - 3)];
const OVER_CAP_RIDERS = [...ridersFor("hold-a", MAX_D1 + 1), ...ridersFor("hold-b", MAX_D1 - 3)];

test("assessTransitionReadiness — wrapped vindue + 0 auktioner + 0 uafviklede løb = ready", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, true);
  assert.deepEqual(result.failed_critical, []);
  for (const [key, check] of Object.entries(result.checks)) {
    assert.equal(check.ok, true, `check '${key}' skulle være ok`);
    assert.equal(check.critical, true, `check '${key}' skal være kritisk`);
  }
  assert.deepEqual(
    Object.keys(result.checks).sort(),
    [
      "all_races_completed",
      "no_active_auctions",
      "season_end_completed",
      "squad_enforcement_completed",
      "window_closed",
    ],
  );
});

// ============================================================
// #3038-hul lukket 24/8: all_races_completed brugte en rå HEAD-tælling
// uden empty-pool-undtagelsen — et løb i en pulje uden hold blokerede
// transitionen selvom season-end (assessSeasonEndBlockers) undtog det.
// ============================================================

test("assessTransitionReadiness — uafviklet løb i TOM pulje blokerer ikke all_races_completed", async () => {
  const supabase = createMockSupabase({
    win: WRAPPED_WINDOW,
    unfinishedRaceRows: [{ id: "race-dormant", league_division_id: "d4-pool-c" }],
    teamRows: [{ id: "t1", league_division_id: "d1" }], // filter aktivt, ingen hold i d4-pool-c
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.all_races_completed.ok, true, "dormant-pulje-løb må ikke spærre transitionen");
});

test("assessTransitionReadiness — uafviklet løb i AKTIV pulje blokerer stadig", async () => {
  const supabase = createMockSupabase({
    win: WRAPPED_WINDOW,
    unfinishedRaceRows: [{ id: "race-live", league_division_id: "d1" }],
    teamRows: [{ id: "t1", league_division_id: "d1" }],
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.all_races_completed.ok, false);
  assert.ok(result.failed_critical.includes("all_races_completed"));
});

test("assessTransitionReadiness — fail-open: tom teams-tabel deaktiverer pool-filteret (mock/test-DB)", async () => {
  const supabase = createMockSupabase({
    win: WRAPPED_WINDOW,
    unfinishedRaceRows: [{ id: "race-x", league_division_id: "d4-pool-c" }],
    teamRows: [],
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.all_races_completed.ok, false, "uden hold-data skal spærren være konservativ");
});

// ============================================================
// #2361 — season_end_completed: transition på en stadig-AKTIV sæson
// springer op/nedrykning + divisionsbonusser irreversibelt over.
// ============================================================

test("assessTransitionReadiness — sæson 1 stadig 'active' (season-end ikke kørt) blokerer", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 1, seasonStatus: "active" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.season_end_completed.ok, false);
  assert.ok(result.failed_critical.includes("season_end_completed"));
  assert.match(result.checks.season_end_completed.detail, /Afslut sæson/);
});

test("assessTransitionReadiness — sæson 1 'completed' (season-end kørt) er ok", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 1, seasonStatus: "completed" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.season_end_completed.ok, true);
  assert.equal(result.checks.season_end_completed.detail, null);
});

test("assessTransitionReadiness — sæson 0 er N/A for season_end_completed selv med status='active'", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 0, seasonStatus: "active" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.season_end_completed.ok, true, "sæson 0 har intet season-end-skridt at vente på");
});

test("assessTransitionReadiness — resume-sti (#578): completed sæson 2+ er stadig ok for season_end_completed", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonNumber: 2, seasonStatus: "completed" });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.season_end_completed.ok, true);
});

test("assessTransitionReadiness — manglende sæson-row kaster", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seasonMissing: true });
  await assert.rejects(
    () => assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID }),
    /findes ikke/,
  );
});

test("assessTransitionReadiness — query-fejl på sæson kaster (fail-closed)", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const broken = {
    from(table) {
      if (table === "seasons") {
        const chain = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        };
        return { select: () => chain };
      }
      return supabase.from(table);
    },
  };
  await assert.rejects(
    () => assessTransitionReadiness({ supabase: broken, fromSeasonId: FROM_SEASON_ID }),
    /Kunne ikke læse sæson/,
  );
});

test("assessTransitionReadiness — åbent vindue blokerer (window_closed=false)", async () => {
  const supabase = createMockSupabase({
    win: { id: "w-2", status: "open", closed_at: null, final_whistle_sent_at: null, squad_enforcement_completed_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false);
  assert.ok(result.failed_critical.includes("window_closed"));
});

// ============================================================
// #5855: gaten måler vinduet på den måde det lukkes NU. closed_at og
// squad_enforcement_completed_at sættes aldrig i det nuværende flow, og S3→S4
// krævede manuel SQL-normalisering. Gaten skal stadig blokere et åbent vindue
// og en trup-håndhævelse der ikke er kørt — målt på dataene, ikke markøren.
// ============================================================

test("#5855 lukket vindue UDEN gamle markører + trupper inden for grænserne = ready", async () => {
  const supabase = createMockSupabase({
    win: CURRENT_FLOW_WINDOW,
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: COMPLIANT_RIDERS,
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, true);
  assert.deepEqual(result.failed_critical, []);
  assert.equal(result.checks.window_closed.ok, true, "status='closed' uden closed_at er lukket i dag");
  assert.equal(result.checks.squad_enforcement_completed.ok, true);
  assert.equal(result.checks.squad_enforcement_completed.detail, null);
});

test("#5855 åbent vindue blokerer, også når trupperne er inden for grænserne", async () => {
  const supabase = createMockSupabase({
    win: { ...CURRENT_FLOW_WINDOW, status: "open" },
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: COMPLIANT_RIDERS,
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.deepEqual(result.failed_critical, ["window_closed"]);
  assert.match(result.checks.window_closed.detail, /'open'/);
});

test("#5855 håndhævelse ikke kørt (hold over loftet, ingen markør) blokerer", async () => {
  const supabase = createMockSupabase({
    win: CURRENT_FLOW_WINDOW,
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: OVER_CAP_RIDERS,
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.deepEqual(result.failed_critical, ["squad_enforcement_completed"]);
  assert.match(result.checks.squad_enforcement_completed.detail, /^1 hold er uden for/);
});

test("#5855 countSquadLimitViolations tæller pr. hold og springer rider-læsning over uden hold", async () => {
  const over = await countSquadLimitViolations({
    supabase: createMockSupabase({
      humanTeams: [...COMPLIANT_TEAMS, { id: "hold-c", division: 1 }],
      seniorRiders: [...OVER_CAP_RIDERS, ...ridersFor("hold-c", MAX_D1 + 2)],
    }),
  });
  assert.deepEqual(over, { teams_checked: 3, violations: 2 });

  const calls = [];
  const none = await countSquadLimitViolations({ supabase: createMockSupabase({ calls }) });
  assert.deepEqual(none, { teams_checked: 0, violations: 0 });
  assert.ok(!calls.some(([t]) => t === "riders"), "ingen hold → ingen .in([])-query mod riders");
});

test("#5855 påbegyndt men ikke afsluttet håndhævelse blokerer, selv med trupper inden for grænserne", async () => {
  const supabase = createMockSupabase({
    win: { ...CURRENT_FLOW_WINDOW, squad_enforcement_started_at: "2026-10-25T18:00:00Z" },
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: COMPLIANT_RIDERS,
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.deepEqual(result.failed_critical, ["squad_enforcement_completed"]);
  assert.match(result.checks.squad_enforcement_completed.detail, /påbegyndt/);
});

test("#5855 gammelt vindue med completed-markør er stadig ok (markøren er gyldigt bevis)", async () => {
  const calls = [];
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, seniorRiders: OVER_CAP_RIDERS, humanTeams: COMPLIANT_TEAMS, calls });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.checks.squad_enforcement_completed.ok, true);
  assert.equal(calls.length, 0, "med markøren sat skal trup-målingen ikke køres");
});

test("#5855 trup-målingen bruger håndhævelsens population og senior-tælling", async () => {
  const calls = [];
  const supabase = createMockSupabase({
    win: CURRENT_FLOW_WINDOW,
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: COMPLIANT_RIDERS,
    calls,
  });
  await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  const teamsCalls = calls.find(([t]) => t === "teams")[1];
  for (const expected of [["eq", "is_ai", false], ["eq", "is_bank", false], ["eq", "is_frozen", false], ["not", "user_id", "is", null]]) {
    assert.ok(teamsCalls.some((c) => JSON.stringify(c) === JSON.stringify(expected)), `teams-filter mangler: ${expected}`);
  }
  const riderCalls = calls.find(([t]) => t === "riders")[1];
  for (const expected of [["eq", "squad", "senior"], ["eq", "is_academy", false], ["eq", "is_retired", false]]) {
    assert.ok(riderCalls.some((c) => JSON.stringify(c) === JSON.stringify(expected)), `rider-filter mangler: ${expected}`);
  }
  const inCall = riderCalls.find(([op]) => op === "in");
  assert.deepEqual(inCall, ["in", "team_id", ["hold-a", "hold-b"]]);
});

test("#5855 læsefejl i trup-målingen kaster (fail-closed, aldrig ready)", async () => {
  const supabase = createMockSupabase({
    win: CURRENT_FLOW_WINDOW,
    humanTeams: COMPLIANT_TEAMS,
    ridersError: { message: "boom" },
  });
  await assert.rejects(
    () => assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID }),
    /Kunne ikke måle trup-grænser/,
  );
});

test("#5855 readiness læser ikke closed_at fra transfer_windows", async () => {
  const selects = [];
  const base = createMockSupabase({ win: CURRENT_FLOW_WINDOW });
  const spy = {
    from(table) {
      const q = base.from(table);
      if (table !== "transfer_windows") return q;
      return { select: (cols, ...rest) => { selects.push(cols); return q.select(cols, ...rest); } };
    },
  };
  await assessTransitionReadiness({ supabase: spy, fromSeasonId: FROM_SEASON_ID });
  assert.ok(!/\bclosed_at\b/.test(selects[0]), `select må ikke kræve closed_at: ${selects[0]}`);
});

// ============================================================
// #6120: markedet er altid åbent (docs/TRANSFER_MARKET_RULES.md), og den
// afskaffede Deadline Day-cron var eneste setter af final_whistle_sent_at.
// Readiness må derfor ikke kræve Final Whistle — men må heller ikke blive
// fail-open: de øvrige kritiske vindue-/trup-checks gælder uændret.
// ============================================================

test("#6120 altid-åbent marked: manglende final whistle blokerer IKKE", async () => {
  const supabase = createMockSupabase({
    win: { ...WRAPPED_WINDOW, final_whistle_sent_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, true);
  assert.equal(result.checks.final_whistle_sent, undefined, "Final Whistle er ikke længere et readiness-check");
  assert.ok(!result.failed_critical.includes("final_whistle_sent"));
});

test("#6120 ikke fail-open: whistle sat men squad enforcement ikke kørt (hold over loftet) blokerer stadig", async () => {
  const supabase = createMockSupabase({
    win: { ...WRAPPED_WINDOW, final_whistle_sent_at: "2026-06-10T18:05:00Z", squad_enforcement_completed_at: null },
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: OVER_CAP_RIDERS,
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.deepEqual(result.failed_critical, ["squad_enforcement_completed"]);
});

test("#6120 ikke fail-open: alle kritiske blockers består samtidig", async () => {
  const supabase = createMockSupabase({
    win: { id: "w-4", status: "open", closed_at: null, final_whistle_sent_at: null, squad_enforcement_completed_at: null },
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: OVER_CAP_RIDERS,
    activeAuctionCount: 1,
    unfinishedRaceCount: 1,
    seasonNumber: 3,
    seasonStatus: "active",
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.deepEqual(
    [...result.failed_critical].sort(),
    [
      "all_races_completed",
      "no_active_auctions",
      "season_end_completed",
      "squad_enforcement_completed",
      "window_closed",
    ],
  );
});

test("#6120 readiness læser ikke final_whistle_sent_at fra transfer_windows", async () => {
  const selects = [];
  const base = createMockSupabase({ win: WRAPPED_WINDOW });
  const spy = {
    from(table) {
      const q = base.from(table);
      if (table !== "transfer_windows") return q;
      return { select: (cols, ...rest) => { selects.push(cols); return q.select(cols, ...rest); } };
    },
  };
  await assessTransitionReadiness({ supabase: spy, fromSeasonId: FROM_SEASON_ID });
  assert.equal(selects.length, 1);
  assert.ok(!selects[0].includes("final_whistle_sent_at"), `select må ikke kræve whistle: ${selects[0]}`);
});

test("assessTransitionReadiness — manglende squad enforcement (ingen markør, hold over loftet) blokerer", async () => {
  const supabase = createMockSupabase({
    win: { ...WRAPPED_WINDOW, squad_enforcement_completed_at: null },
    humanTeams: COMPLIANT_TEAMS,
    seniorRiders: OVER_CAP_RIDERS,
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.squad_enforcement_completed.ok, false);
});

test("assessTransitionReadiness — aktive auktioner blokerer med antal i detail", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, activeAuctionCount: 2 });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.no_active_auctions.ok, false);
  assert.match(result.checks.no_active_auctions.detail, /2/);
});

test("assessTransitionReadiness — uafviklede løb blokerer med antal i detail", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, unfinishedRaceCount: 3 });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.all_races_completed.ok, false);
  assert.match(result.checks.all_races_completed.detail, /3/);
});

test("assessTransitionReadiness — intet vindue overhovedet blokerer (trup-checket måles stadig på data)", async () => {
  const supabase = createMockSupabase({ win: null, humanTeams: COMPLIANT_TEAMS, seniorRiders: OVER_CAP_RIDERS });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false);
  assert.equal(result.checks.squad_enforcement_completed.ok, false);
});

test("assessTransitionReadiness — kræver supabase og fromSeasonId", async () => {
  await assert.rejects(() => assessTransitionReadiness({ supabase: null, fromSeasonId: FROM_SEASON_ID }));
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  await assert.rejects(() => assessTransitionReadiness({ supabase, fromSeasonId: null }));
});

test("assessTransitionReadiness — query-fejl på vinduet kaster (fail-closed, aldrig ready)", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const broken = {
    from(table) {
      if (table === "transfer_windows") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        };
        return { select: () => chain };
      }
      return supabase.from(table);
    },
  };
  await assert.rejects(
    () => assessTransitionReadiness({ supabase: broken, fromSeasonId: FROM_SEASON_ID }),
    /Kunne ikke læse transfervindue/,
  );
});

test("assessTransitionReadiness — query-fejl på auktions-count kaster (fail-closed)", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const broken = {
    from(table) {
      if (table === "auctions") {
        return {
          select: () => ({
            in: () => ({ then: (resolve) => resolve({ data: null, count: null, error: { message: "boom" } }) }),
          }),
        };
      }
      return supabase.from(table);
    },
  };
  await assert.rejects(
    () => assessTransitionReadiness({ supabase: broken, fromSeasonId: FROM_SEASON_ID }),
    /Kunne ikke tælle auktioner/,
  );
});

// ============================================================
// #2805 — assessSeasonEndBlockers: spærre for "Afslut sæson"
// mod uafviklede løb. pending_race_results fanger kun løb der
// VENTER på behandling — et løb der aldrig startede har ingen
// række der og passerede tavst før denne spærre.
// ============================================================

// unfinishedRaces: array af {id, league_division_id} — league_division_id=null
// (default via genUnfinishedRaces) svarer til "ikke pulje-relateret" og blokerer
// altid, uanset teamPools (matcher den gamle count-only-adfærd).
// teamPools: array af {league_division_id} — én række pr. hold. Default = ét
// hold i "d1" (pool-filter aktivt, men rammer ingen af default-løbene).
function genUnfinishedRaces(n, leagueDivisionId = null) {
  return Array.from({ length: n }, (_, i) => ({ id: `race-${i}`, league_division_id: leagueDivisionId }));
}

// lastStageAt: bruges når spærren kun kalder race_stage_schedule ÉN gang
// (≤100 blocking races → ét chunk). lastStageAtSequence: array af scheduled_at
// (eller null) — ÉT element pr. forventet .in()-kald, i rækkefølge. Bruges til
// at simulere #3014-chunkingen (>100 blocking races → 2+ kald) og teste at
// implementeringen tager MAX på tværs af kaldene, ikke bare sidste/første.
function createSeasonEndMock({
  unfinishedRaces = [],
  teamPools = [{ league_division_id: "d1" }],
  lastStageAt = null,
  lastStageAtSequence = null,
  racesError = null,
  teamsError = null,
  stageError = null,
} = {}) {
  let stageCallIndex = 0;
  const stageInCalls = [];
  return {
    _stageInCalls: stageInCalls,
    from(table) {
      if (table === "races") {
        const chain = {
          eq: () => chain,
          neq: () => chain,
          order: () => chain,
          range: (from, to) => (racesError
            ? Promise.resolve({ data: null, error: racesError })
            : Promise.resolve({ data: unfinishedRaces.slice(from, to + 1), error: null })),
        };
        return { select: () => chain };
      }
      if (table === "teams") {
        const chain = {
          order: () => chain,
          range: (from, to) => (teamsError
            ? Promise.resolve({ data: null, error: teamsError })
            : Promise.resolve({ data: teamPools.slice(from, to + 1), error: null })),
        };
        return { select: () => chain };
      }
      if (table === "race_stage_schedule") {
        const chain = {
          in: (_col, ids) => { stageInCalls.push(ids); return chain; },
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => {
            if (stageError) return Promise.resolve({ data: null, error: stageError });
            const at = lastStageAtSequence ? (lastStageAtSequence[stageCallIndex] ?? null) : lastStageAt;
            stageCallIndex++;
            return Promise.resolve({ data: at ? { scheduled_at: at } : null, error: null });
          },
        };
        return { select: () => chain };
      }
      throw new Error(`Uventet tabel i season-end-mock: ${table}`);
    },
  };
}

test("assessSeasonEndBlockers — 0 uafviklede løb = ikke blokeret (sæson 0 / færdigkørt sæson)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: [] });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, false);
  assert.equal(result.unfinished_races, 0);
  assert.equal(result.detail, null);
});

test("assessSeasonEndBlockers — uafviklede løb blokerer med antal + sidste etape-dato", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(76),
    lastStageAt: "2026-07-26T17:00:00+00:00",
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true);
  assert.equal(result.unfinished_races, 76);
  assert.equal(result.last_unfinished_stage_at, "2026-07-26T17:00:00+00:00");
  assert.match(result.detail, /76 løb er ikke afviklet/);
  assert.match(result.detail, /2026-07-26T17:00:00/);
});

test("assessSeasonEndBlockers — uafviklet løb UDEN schedule-rækker blokerer stadig (dato udelades)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: genUnfinishedRaces(3), lastStageAt: null });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true);
  assert.equal(result.last_unfinished_stage_at, null);
  assert.match(result.detail, /3 løb er ikke afviklet/);
  assert.doesNotMatch(result.detail, /planlagt til/);
});

test("assessSeasonEndBlockers — query-fejl på races-count kaster (fail-closed)", async () => {
  const supabase = createSeasonEndMock({ racesError: { message: "boom" } });
  await assert.rejects(
    () => assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID }),
    /Kunne ikke tælle uafviklede løb/,
  );
});

test("assessSeasonEndBlockers — query-fejl på puljer (teams) kaster (fail-closed)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: genUnfinishedRaces(2), teamsError: { message: "boom" } });
  await assert.rejects(
    () => assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID }),
    /empty-pool-filter/,
  );
});

test("assessSeasonEndBlockers — query-fejl på etape-lookup kaster (fail-closed)", async () => {
  const supabase = createSeasonEndMock({ unfinishedRaces: genUnfinishedRaces(5), stageError: { message: "boom" } });
  await assert.rejects(
    () => assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID }),
    /Kunne ikke finde sidste uafviklede etape/,
  );
});

test("assessSeasonEndBlockers — kræver supabase + seasonId", async () => {
  await assert.rejects(() => assessSeasonEndBlockers({ seasonId: FROM_SEASON_ID }), /Supabase client required/);
  await assert.rejects(() => assessSeasonEndBlockers({ supabase: createSeasonEndMock() }), /seasonId required/);
});

// ============================================================
// #3038 — empty-pool-undtagelse: dormant-pulje-løb (#2851-reconcilen tømte
// D4 C-H for legacy-AI) må IKKE tælle som season-end-blocker, men løb i
// puljer der stadig har hold skal fortsat blokere. Samme diskriminator som
// stageScheduler.js's "inEmptyPool" (P0 2/7-filteret).
// ============================================================

test("assessSeasonEndBlockers — uafviklet løb i TOM pulje (D4 C-H, 0 hold) tælles IKKE som blocker", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(143, "d4-pool-c"),
    teamPools: [{ league_division_id: "d4-pool-a" }, { league_division_id: "d1" }], // ingen hold i d4-pool-c
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, false, "dormant-pulje-løb må ikke blokere 'Afslut sæson'");
  assert.equal(result.unfinished_races, 0);
});

test("assessSeasonEndBlockers — uafviklet løb i AKTIV pulje (hold findes) blokerer stadig", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(2, "d4-pool-a"),
    teamPools: [{ league_division_id: "d4-pool-a" }, { league_division_id: "d4-pool-a" }],
    lastStageAt: "2026-08-10T12:00:00+00:00",
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true, "løb i en pulje med hold skal stadig blokere");
  assert.equal(result.unfinished_races, 2);
  assert.match(result.detail, /2 løb er ikke afviklet/);
});

test("assessSeasonEndBlockers — blandet: dormant-pulje-løb undtages, aktive løb tælles", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: [
      ...genUnfinishedRaces(143, "d4-pool-c"), // dormant, ingen hold
      ...genUnfinishedRaces(1, "d1"), // aktiv pulje, har hold
    ],
    teamPools: [{ league_division_id: "d1" }],
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true);
  assert.equal(result.unfinished_races, 1, "kun løbet i den aktive pulje skal tælles");
});

test("assessSeasonEndBlockers — fail-open: tom teams-tabel (0 hold overhovedet) deaktiverer pool-filteret", async () => {
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(4, "d4-pool-c"),
    teamPools: [],
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true, "tom teams-tabel (mock/test-DB) skal fail-open, ikke undtage alle løb");
  assert.equal(result.unfinished_races, 4);
});

// ============================================================
// #3014-fejlklassen: en enkelt .in("race_id", ids) med hundredvis af id'er
// kan ramme PostgRESTs URL-længde-cap (sket 2x før i repoet). >100 blocking
// races skal derfor chunkes over flere .in()-kald, og resultatet skal være
// MAX scheduled_at på tværs af biddene — ikke bare det seneste kalds svar.
// ============================================================

test("assessSeasonEndBlockers — >100 blocking races chunkes i flere .in()-kald, MAX scheduled_at vindes uanset chunk", async () => {
  // 150 uafviklede løb i en aktiv pulje (150 hold i samme pulje ⇒ pool ikke tom)
  // ⇒ 150 blocking-race-id'er ⇒ 2 chunks (100 + 50) ved LAST_STAGE_CHUNK_SIZE=100.
  // Bevidst: chunk 1 (de FØRSTE 100 id'er) får den SENESTE dato — hvis
  // implementeringen fejlagtigt bare beholdt "sidste kalds resultat" i stedet
  // for MAX på tværs af kald, ville testen fange det.
  const teamPools = Array.from({ length: 150 }, () => ({ league_division_id: "d4-pool-a" }));
  const supabase = createSeasonEndMock({
    unfinishedRaces: genUnfinishedRaces(150, "d4-pool-a"),
    teamPools,
    lastStageAtSequence: ["2026-08-20T10:00:00+00:00", "2026-08-05T10:00:00+00:00"],
  });
  const result = await assessSeasonEndBlockers({ supabase, seasonId: FROM_SEASON_ID });
  assert.equal(result.blocked, true);
  assert.equal(result.unfinished_races, 150);
  assert.equal(supabase._stageInCalls.length, 2, "150 blocking-id'er skal splittes i præcis 2 .in()-kald");
  assert.equal(supabase._stageInCalls[0].length, 100, "første chunk skal være 100 id'er");
  assert.equal(supabase._stageInCalls[1].length, 50, "andet chunk skal være de resterende 50 id'er");
  assert.equal(
    result.last_unfinished_stage_at,
    "2026-08-20T10:00:00+00:00",
    "MAX scheduled_at på tværs af begge chunks skal vindes, selvom det kom fra det FØRSTE kald",
  );
});

// ============================================================
// #6120: Deadline Day-cron'en er fjernet. Den læste transfer_windows hver
// 5. min uden funktion (markedet er altid åbent) og gav CYCLINGZONE-82 under
// et udfald. Ingen query, notifikation, webhook eller monitor-slug må komme
// tilbage ad bagdøren.
// ============================================================

test("#6120 Deadline Day-cron er væk: intet modul, intet cron-kald, intet monitor-slug", () => {
  assert.equal(existsSync(join(LIB_DIR, "deadlineDayReport.js")), false, "deadlineDayReport.js skal være slettet");
  const cronSrc = readFileSync(join(LIB_DIR, "..", "cron.js"), "utf8");
  for (const needle of ["deadlineDayReport", "processDeadlineDayCron", "runDeadlineDayCron", "\"deadline-day\"", "deadline_day_warning", "Final Whistle"]) {
    assert.ok(!cronSrc.includes(needle), `cron.js må ikke indeholde ${needle}`);
  }
  const slugs = ALL_CRON_MONITORS.map(([slug]) => slug);
  assert.ok(!slugs.includes("deadline-day"), "deadline-day monitor-slug skal være fjernet");
});
