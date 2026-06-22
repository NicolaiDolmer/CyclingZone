import test from "node:test";
import assert from "node:assert/strict";

import {
  runRelaunchSeason1,
  seedSeasonZero,
  assertRelaunchProdGuard,
  isProdSupabaseUrl,
  RELAUNCH_CONFIRM_TOKEN,
} from "./relaunchOrchestrator.js";
import { computeSeasonUuid } from "./seasonTransition.js";

// Recorder-stubs for byggeklodserne (DI) — tester sekvens + dryRun-propagation.
function makeDeps(order) {
  const rec = (name, ret = {}) => async (_s, opts = {}) => {
    order.push({ name, dryRun: opts.dryRun });
    return ret;
  };
  return {
    retireLegacyRiders: rec("retire", { wouldRetire: 8969 }),
    runFullBetaReset: rec("reset"),
    generateAndInsertPopulation: rec("population", { generated: 800 }),
    runPhysiologyBackfill: rec("physiology"),
    runRiderTypesBackfill: rec("types"),
    runBaseValueBackfill: rec("baseValue"),
    runStarterSquadAllocation: rec("allocation", { teams: 18 }),
    allocateLeaguePools: rec("leaguePools", { allocated: 18, pools: 8 }),
    // #1688: clear FØR fyld (begge kaldes med options-objekt, ikke (supabase, opts)) —
    // egne stubs så call-order-asserten ser dem.
    clearAllAiTeams: async () => { order.push({ name: "clearAiTeams" }); return { teams: 1 }; },
    generateAndAllocateAiTeams: async () => { order.push({ name: "aiTeams" }); return { created: 72, removed: 0, pools: [] }; },
    seedSeasonZero: async (_s, opts = {}) => { order.push({ name: "seedSeason0", dryRun: opts.dryRun }); return { seasonId: computeSeasonUuid(0) }; },
    // transitionToNextSeason returnerer { ok, plan, log }; orchestrator udvinder den nye
    // sæson-id fra plan.to_season.id til kalender-materialiseringen.
    transitionToNextSeason: async () => { order.push({ name: "transition" }); return { ok: true, plan: { to_season: { id: computeSeasonUuid(1), number: 1 } } }; },
    // #1704: per-division-kalender materialiseres EFTER transitionen (ét options-objekt-kald).
    materializeSeasonCalendar: async (opts = {}) => { order.push({ name: "calendar", seasonId: opts.seasonId, dryRun: opts.dryRun }); return { racesInserted: 42, stageProfiles: 100, stageSchedules: 100, pools: [] }; },
    // #1680: bestyrelse låst OP fra start i sæson 1 (startSequentialNegotiation-primitiv).
    startSequentialNegotiation: async () => { order.push({ name: "unlockBoard" }); return { window_state: "pending_5yr", baseline_rows_deleted: 2 }; },
    runAcademyIntake: rec("academy", { teams: 2, candidates: 8 }),
    runContractSeed: rec("contracts", { seeded: 144 }),
    grantFounderBadges: rec("founder", { wouldGrant: 18 }),
    getBetaManagerTeams: async () => [{ id: "t1", user_id: "u1" }, { id: "t2", user_id: "u2" }],
  };
}

test("runRelaunchSeason1 (dryRun): sekvens + dryRun-prop, INGEN reset/sæson-transition", async () => {
  const order = [];
  const summary = await runRelaunchSeason1({}, { dryRun: true, startDate: "2026-06-20", deps: makeDeps(order) });
  assert.equal(summary.dryRun, true);
  const names = order.map((o) => o.name);
  // reset, leaguePools, seedSeason0 og transition kaldes IKKE i dry-run (kan ikke simuleres uden writes)
  assert.deepEqual(names, ["retire", "population", "physiology", "types", "baseValue", "allocation", "contracts", "founder"]);
  // dryRun propagerer til alle byggeklodser der modtager opts
  assert.ok(order.filter((o) => "dryRun" in o && o.dryRun !== undefined).every((o) => o.dryRun === true));
  // summary har en nøgle pr. fase
  for (const k of ["retireLegacy", "reset", "population", "backfills", "allocation", "leaguePools", "aiTeams", "season", "calendar", "academy", "contracts", "founderBadge"]) {
    assert.ok(k in summary, `summary mangler ${k}`);
  }
  // academy-trinet er flag-gated; uden academy_enabled=true i mock → skipped-form
  assert.ok("skipped" in summary.academy || "teams" in summary.academy, "summary.academy skal have skipped eller teams");
});

test("runRelaunchSeason1 (apply): kalder reset + seedSeason0 + transition i korrekt rækkefølge", async () => {
  const order = [];
  const summary = await runRelaunchSeason1({}, { dryRun: false, startDate: "2026-06-20", deps: makeDeps(order) });
  assert.equal(summary.dryRun, false);
  const names = order.map((o) => o.name);
  assert.deepEqual(names, [
    "retire", "reset", "population", "physiology", "types", "baseValue", "allocation",
    "leaguePools", "clearAiTeams", "aiTeams", "seedSeason0", "transition", "calendar", "unlockBoard", "contracts", "founder",
  ]);
});

// #1680: bestyrelsen skal være låst OP fra start i sæson 1. Apply-stien flipper
// sæson-1-vinduet til 'pending_5yr' (via startSequentialNegotiation) EFTER transitionen,
// så managere kan forhandle planer fra dag 1 i stedet for at vente til sæson 2.
test("runRelaunchSeason1 (apply): låser bestyrelsen OP i sæson 1 efter transition", async () => {
  const order = [];
  const summary = await runRelaunchSeason1({}, { dryRun: false, startDate: "2026-06-20", deps: makeDeps(order) });
  const idxTransition = order.findIndex((o) => o.name === "transition");
  const idxUnlock = order.findIndex((o) => o.name === "unlockBoard");
  assert.ok(idxUnlock > idxTransition, "board-oplåsning skal ske EFTER sæson-transitionen");
  assert.equal(summary.boardUnlock?.window_state, "pending_5yr", "summary skal vise board låst op (pending_5yr)");
});

// Dry-run må ikke skrive — board-oplåsning springes over (kræver et eksisterende
// sæson-1-vindue, der først findes efter apply).
test("runRelaunchSeason1 (dryRun): springer board-oplåsning over", async () => {
  const order = [];
  const summary = await runRelaunchSeason1({}, { dryRun: true, startDate: "2026-06-20", deps: makeDeps(order) });
  assert.ok(!order.some((o) => o.name === "unlockBoard"), "unlockBoard må ikke kaldes i dry-run");
  assert.ok("skipped" in (summary.boardUnlock || {}), "summary.boardUnlock skal markere dry-run-skip");
});

// #1704: per-division-kalender materialiseres EFTER sæson-transitionen (sæson 1 er aktiv +
// AI-fyld kørt = puljerne har felter at køre løbene i), med sæson-id udvundet fra transitionen
// og dryRun=false. IKKE flag-gated her (relaunchen materialiserer altid eksplicit).
test("runRelaunchSeason1 (apply): materialiserer kalender efter transition med sæson-1-id", async () => {
  const order = [];
  const summary = await runRelaunchSeason1({}, { dryRun: false, startDate: "2026-06-20", deps: makeDeps(order) });
  const idxTransition = order.findIndex((o) => o.name === "transition");
  const idxCalendar = order.findIndex((o) => o.name === "calendar");
  assert.ok(idxCalendar > idxTransition, "kalender skal materialiseres EFTER sæson-transitionen");
  const calCall = order.find((o) => o.name === "calendar");
  assert.equal(calCall?.seasonId, computeSeasonUuid(1), "kalender skal bruge den nye sæson-1-id fra transitionen");
  assert.equal(calCall?.dryRun, false, "apply → materialisér med writes");
  assert.equal(summary.calendar?.racesInserted, 42, "summary skal vise materialiserings-resultatet");
});

// Dry-run må ikke skrive — kalender-materialiseringen springes over (kræver den aktive
// sæson-1-row + AI-fyldte puljer der først findes efter apply).
test("runRelaunchSeason1 (dryRun): springer kalender-materialisering over", async () => {
  const order = [];
  const summary = await runRelaunchSeason1({}, { dryRun: true, startDate: "2026-06-20", deps: makeDeps(order) });
  assert.ok(!order.some((o) => o.name === "calendar"), "calendar må ikke kaldes i dry-run");
  assert.ok("skipped" in (summary.calendar || {}), "summary.calendar skal markere dry-run-skip");
});

// Regression #1191: seedSeasonZero defaulter til dryRun=true — apply-stien SKAL
// sende eksplicit dryRun=false, ellers indsættes sæson 0 aldrig og transitionen
// fejler på "Season <nul-uuid> not found" (fundet i rehearsal 11/6).
test("runRelaunchSeason1 (apply): seedSeasonZero kaldes med eksplicit dryRun=false", async () => {
  const order = [];
  await runRelaunchSeason1({}, { dryRun: false, startDate: "2026-06-20", deps: makeDeps(order) });
  const seedCall = order.find((o) => o.name === "seedSeason0");
  assert.equal(seedCall?.dryRun, false);
});

test("seedSeasonZero indsætter sæson number=0 (active) med deterministisk UUID", async () => {
  const inserts = [];
  const supabase = { from() { return { insert(row) { inserts.push(row); return Promise.resolve({ error: null }); } }; } };
  const res = await seedSeasonZero(supabase, { startDate: "2026-06-20", dryRun: false });
  assert.equal(res.seasonId, computeSeasonUuid(0));
  assert.equal(inserts[0].number, 0);
  assert.equal(inserts[0].status, "active");
  assert.equal(inserts[0].start_date, "2026-06-20");
});

test("seedSeasonZero (dryRun) indsætter intet", async () => {
  let wrote = false;
  const supabase = { from() { return { insert() { wrote = true; return Promise.resolve({ error: null }); } }; } };
  const res = await seedSeasonZero(supabase, { startDate: "2026-06-20", dryRun: true });
  assert.equal(wrote, false);
  assert.equal(res.seasonId, computeSeasonUuid(0));
});

test("assertRelaunchProdGuard: lagdelt prod-opt-in", () => {
  // ingen --apply → dry-run
  assert.equal(assertRelaunchProdGuard({ apply: false, isProd: true }).proceed, false);
  // non-prod apply → fortsæt
  assert.equal(assertRelaunchProdGuard({ apply: true, isProd: false }).proceed, true);
  // prod apply uden --target-prod → kast
  assert.throws(() => assertRelaunchProdGuard({ apply: true, isProd: true, targetProd: false }), /target-prod/);
  // prod + target uden korrekt confirm → kast
  assert.throws(() => assertRelaunchProdGuard({ apply: true, isProd: true, targetProd: true, confirm: "nope" }), /confirm/);
  // prod + target + confirm uden #1101-cutover-ack → kast
  assert.throws(() => assertRelaunchProdGuard({ apply: true, isProd: true, targetProd: true, confirm: RELAUNCH_CONFIRM_TOKEN, cutoverAck: "false" }), /1101/);
  // alt sat → fortsæt mod PROD
  const ok = assertRelaunchProdGuard({ apply: true, isProd: true, targetProd: true, confirm: RELAUNCH_CONFIRM_TOKEN, cutoverAck: "true" });
  assert.equal(ok.proceed, true);
  assert.equal(ok.target, "PROD");
});

// ── #1198 rel-M2: prod-detektion skal være casing-robust ──────────────────────
test("isProdSupabaseUrl: DNS er case-insensitive — uppercased prod-URL er stadig prod", () => {
  assert.equal(isProdSupabaseUrl("https://ghwvkxzhsbbltzfnuhhz.supabase.co"), true);
  // Mutanten fra #1198-kataloget: casing-trick måtte IKKE omgå den lagdelte guard.
  assert.equal(isProdSupabaseUrl("https://GHWVKXZHSBBLTZFNUHHZ.supabase.co"), true);
  assert.equal(isProdSupabaseUrl("https://GhWvKxZhSbBlTzFnUhHz.supabase.co"), true);
  // Pooler-/connection-string-varianter med ref-strengen fanges også.
  assert.equal(isProdSupabaseUrl("postgres://x@db.GHWVKXZHSBBLTZFNUHHZ.supabase.co:5432/postgres"), true);
  // Ikke-prod og tomme input → false (fail-closed mod guard, fail-open mod dry-run).
  assert.equal(isProdSupabaseUrl("https://abcdefabcdefabcdefab.supabase.co"), false);
  assert.equal(isProdSupabaseUrl(null), false);
  assert.equal(isProdSupabaseUrl(undefined), false);
});
