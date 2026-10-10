import test from "node:test";
import assert from "node:assert/strict";
import {
  planRepair,
  repairBoard,
  loadRepairInput,
  buildApplySql,
  modifierCaseSql,
  verifyAgainstPlan,
  parseArgs,
  renderPublicReport,
  describeDistribution,
  eventIdSetHash,
  prepareApply,
  existingBackupTables,
  parseReportCounts,
  compareCell,
  OWNER_GO_FLAG,
  PREVENTION_MERGED_AT,
  BASELINE_REPORT,
  BACKUP_PROFILES_TABLE,
  BACKUP_EVENTS_TABLE,
} from "./repair5897BoardYouthRaces.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { satisfactionToModifier } from "../../lib/boardEvaluation.js";
import { createFakeSupabase } from "../../lib/testUtils/fakeSupabase.js";

const HASH = "a".repeat(64);

const T0 = "2026-09-28T17:50:00.000Z";
const T1 = "2026-09-28T18:00:00.000Z";
const T2 = "2026-09-28T18:20:00.000Z";
const LATER = "2026-09-29T18:00:00.000Z";

function ev(id, board, race, delta, at, before = 50) {
  return { id, board_id: board, team_id: `t-${board}`, season_id: "s4", race_id: race,
    satisfaction_before: before, satisfaction_after: before + delta, satisfaction_delta: delta, created_at: at };
}

test("repairBoard: invers-delta, clamp og modifier fra repareret satisfaction", () => {
  const r = repairBoard({ satisfaction: 70, budget_modifier: satisfactionToModifier(70) }, 15);
  assert.equal(r.repaired, 55);
  assert.equal(r.newModifier, satisfactionToModifier(55));
  assert.equal(r.modifierChanged, satisfactionToModifier(55) !== satisfactionToModifier(70));
  assert.equal(r.clamped, false);

  const low = repairBoard({ satisfaction: 5, budget_modifier: 0.8 }, 20);
  assert.equal(low.repaired, 0);
  assert.equal(low.clamped, true);

  const neg = repairBoard({ satisfaction: 40, budget_modifier: 1 }, -10);
  assert.equal(neg.repaired, 50);
});

test("repairBoard: baseline-board bruger baseline-båndet og rører ikke budget_modifier", () => {
  const r = repairBoard({ satisfaction: 35, budget_modifier: 1.0, is_baseline: true }, 20);
  assert.equal(r.baseline, true);
  assert.equal(r.repaired, 30);
  assert.equal(r.clamped, true);
  assert.equal(r.newModifier, 1.0);
  assert.equal(r.modifierChanged, false);
  assert.equal(repairBoard({ satisfaction: 60, budget_modifier: 1.0, plan_type: "baseline" }, 5).baseline, true);
});

test("planRepair: summerer events pr. board, tæller ændret-siden, økonomi og gap-boards", () => {
  const youthEvents = [
    ev("e1", "b1", "y1", 6, T0), ev("e2", "b1", "y2", 6, T1, 56),
    ev("e3", "b2", "y1", -4, T0),
    ev("e4", "b3", "y1", 0, T0),
    ev("e5", "ghost", "y1", 3, T0),
  ];
  const boards = [
    { id: "b1", team_id: "tA", satisfaction: 62, budget_modifier: satisfactionToModifier(62), negotiation_status: "completed", updated_at: T1 },
    { id: "b2", team_id: "tB", satisfaction: 46, budget_modifier: 1.0, negotiation_status: "completed", updated_at: LATER },
    { id: "b3", team_id: "tC", satisfaction: 50, budget_modifier: 1.0, negotiation_status: "completed", is_baseline: true, updated_at: T0 },
  ];
  const teamBoards = [...boards, { id: "b1x", team_id: "tA", satisfaction: 50, budget_modifier: 1.0, negotiation_status: "completed" }];
  const teams = [{ id: "tA", sponsor_income: 1000 }, { id: "tB", sponsor_income: 500 }, { id: "tC", sponsor_income: 100 }];
  const laterEvents = [...youthEvents, { id: "s1", board_id: "b2", created_at: LATER }];
  const windowEvents = [
    { id: "w1", board_id: "q1", satisfaction_before: 50, satisfaction_after: 52, created_at: "2026-09-28T17:30:00.000Z" },
    { id: "w2", board_id: "q1", satisfaction_before: 49, satisfaction_after: 50, created_at: "2026-09-28T18:10:00.000Z" },
    { id: "w3", board_id: "q2", satisfaction_before: 50, satisfaction_after: 52, created_at: "2026-09-28T17:30:00.000Z" },
    { id: "w4", board_id: "q2", satisfaction_before: 52, satisfaction_after: 55, created_at: "2026-09-28T18:10:00.000Z" },
    { id: "w5", board_id: "b1", satisfaction_before: 0, satisfaction_after: 0, created_at: T1 },
  ];
  const { summary, plans, economy, silentGaps } = planRepair({ youthEvents, boards, teamBoards, teams, laterEvents, windowEvents });

  assert.equal(summary.youthEvents, 5);
  assert.equal(summary.boards, 3);
  assert.equal(summary.missingBoards, 1);
  const b1 = plans.find((p) => p.board_id === "b1");
  assert.equal(b1.youthDelta, 12);
  assert.equal(b1.repaired, 50);
  assert.equal(b1.changedAfterWindow, false);
  const b2 = plans.find((p) => p.board_id === "b2");
  assert.equal(b2.repaired, 50);
  assert.equal(b2.changedAfterWindow, true);
  assert.equal(summary.changedAfterYouthWindow, 1);
  assert.equal(summary.baselineBoards, 1);
  assert.equal(summary.nonZeroDeltaBoards, 2);
  assert.equal(summary.absDeltaAtLeast10, 1);
  assert.equal(summary.delta.max, 12);
  assert.equal(summary.delta.median, 0);

  // Hold A: b1 går fra modifier(62) til modifier(50); snit over 2 completed boards.
  const tA = economy.find((e) => e.team_id === "tA");
  const expected = Math.round(1000 * ((satisfactionToModifier(50) + 1) / 2 - (satisfactionToModifier(62) + 1) / 2));
  if (satisfactionToModifier(50) !== satisfactionToModifier(62)) assert.equal(tA.sponsorDelta, expected);
  assert.equal(economy.some((e) => e.team_id === "tC"), false, "baseline uden modifier-ændring");

  // Gap: q1 faldt 52 -> 49 uden event i vinduet; q2 har ingen gap; b1 ignoreres (har youth-events).
  assert.deepEqual(silentGaps, [{ board_id: "q1", gap: -3 }]);
  assert.equal(summary.silentGapBoards, 1);
});

test("planRepair: tomt input giver tom plan uden fejl", () => {
  const { summary, plans } = planRepair({});
  assert.equal(plans.length, 0);
  assert.equal(summary.boards, 0);
  assert.equal(summary.window, null);
  assert.deepEqual(describeDistribution([]), { count: 0, mean: null, median: null, min: null, max: null });
});

test("loadRepairInput er READ-ONLY og filtrerer ungdomsløb via squad", async () => {
  const state = {
    races: [{ id: "y1", squad: "u23" }, { id: "j1", squad: "junior" }, { id: "s1", squad: "senior" }],
    board_satisfaction_events: [
      ev("e1", "b1", "y1", 5, T0), ev("e2", "b1", "s1", 2, T2), ev("e3", "b2", "j1", -1, T1),
    ],
    board_profiles: [
      { id: "b1", team_id: "tA", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 60, budget_modifier: 1.1, updated_at: T2 },
      { id: "b2", team_id: "tB", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 40, budget_modifier: 1.0, updated_at: T1 },
    ],
    teams: [{ id: "tA", sponsor_income: 10 }, { id: "tB", sponsor_income: 20 }],
  };
  const before = structuredClone(state);
  const input = await loadRepairInput(createFakeSupabase(state));
  assert.deepEqual(state, before);
  assert.deepEqual(input.youthEvents.map((e) => e.id).sort(), ["e1", "e3"]);
  assert.equal(input.boards.length, 2);
  assert.ok(input.laterEvents.some((e) => e.id === "e2"));
  const plan = planRepair(input);
  assert.equal(plan.plans.find((p) => p.board_id === "b1").repaired, 55);
  assert.equal(plan.plans.find((p) => p.board_id === "b2").repaired, 41);
});

test("loader-fejl afbryder i stedet for at rapportere en tom plan", async () => {
  const db = createFakeSupabase({}, { errors: { races: { select: "permission denied" } } });
  await assert.rejects(loadRepairInput(db), /permission denied/);
});

test("modifierCaseSql spejler satisfactionToModifier for hele skalaen", () => {
  const sql = modifierCaseSql("x");
  for (let s = 0; s <= 100; s += 1) {
    const match = [...sql.matchAll(/WHEN x >= (\d+) THEN ([\d.]+)/g)].find(([, from]) => s >= Number(from));
    const value = match ? Number(match[2]) : Number(sql.match(/ELSE ([\d.]+) END/)[1]);
    assert.equal(value, satisfactionToModifier(s), `satisfaction ${s}`);
  }
});

test("apply-SQL er én atomisk, idempotent blok uden ids og med backup + verify", () => {
  const sql = buildApplySql({ approvedHash: HASH });
  assert.match(sql, /^-- #5897/);
  assert.equal((sql.match(/DO \$repair\$/g) || []).length, 1);
  assert.match(sql, /IF n_events = 0 THEN[\s\S]*RETURN;/);
  assert.match(sql, /to_regclass\('public\.backup_board_profiles_5897'\)/);
  assert.ok(sql.indexOf("CREATE TABLE public.backup_board_satisfaction_events_5897") < sql.indexOf("UPDATE public.board_profiles"));
  assert.ok(sql.indexOf("UPDATE public.board_profiles") < sql.indexOf("DELETE FROM public.board_satisfaction_events"));
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /r\.squad <> 'senior'/);
  assert.match(sql, /RAISE EXCEPTION 'STOP #5897: % boards matcher ikke/);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-/i, "ingen uuid'er i SQL'en");
  assert.doesNotMatch(sql, /^\s*(COMMIT|ROLLBACK)\s*;/m,"DO-blokken styrer selv transaktionen");
});

test("events-only-SQL sletter events men rører hverken satisfaction eller budget_modifier", () => {
  const sql = buildApplySql({ eventsOnly: true, approvedHash: HASH });
  assert.match(sql, /EVENTS-ONLY/);
  assert.doesNotMatch(sql, /UPDATE public\.board_profiles/);
  assert.doesNotMatch(sql, /_repair_5897/);
  assert.doesNotMatch(sql, /--@profiles/);
  assert.match(sql, /DELETE FROM public\.board_satisfaction_events/);
  assert.match(sql, /CREATE TABLE public\.backup_board_satisfaction_events_5897/);
  assert.doesNotMatch(buildApplySql({ approvedHash: HASH }), /--@profiles/);
});

test("planRepair: atTargetNow når seneste senior-skridt er 0 og værdien matcher", () => {
  const youthEvents = [ev("e1", "b1", "y1", 6, T0), ev("e2", "b2", "y1", 4, T0)];
  const boards = [
    { id: "b1", team_id: "tA", satisfaction: 60, budget_modifier: 1.1, negotiation_status: "completed" },
    { id: "b2", team_id: "tB", satisfaction: 58, budget_modifier: 1.0, negotiation_status: "completed" },
  ];
  const laterEvents = [
    { id: "s1", board_id: "b1", race_id: "sr1", satisfaction_after: 60, satisfaction_delta: -2, created_at: T2 },
    { id: "s2", board_id: "b1", race_id: "sr2", satisfaction_after: 60, satisfaction_delta: 0, created_at: LATER },
    { id: "s3", board_id: "b2", race_id: "sr2", satisfaction_after: 58, satisfaction_delta: 3, created_at: LATER },
  ];
  const { summary, plans } = planRepair({ youthEvents, boards, teamBoards: boards, teams: [], laterEvents });
  assert.equal(plans.find((p) => p.board_id === "b1").atTargetNow, true);
  assert.equal(plans.find((p) => p.board_id === "b2").atTargetNow, false);
  assert.equal(summary.atTargetNow, 1);
  assert.equal(summary.atTargetNowWithNonZeroDelta, 1);
  assert.equal(summary.eventsSinceYouthWindow.max, 2);
});

test("verifyAgainstPlan: events-only forventer uændrede værdier", () => {
  const plan = { plans: [{ board_id: "b1", current: 60, repaired: 54, baseline: false, oldModifier: 1.1, newModifier: 1.0 }] };
  const r = verifyAgainstPlan({ plan, youthEventsRemaining: 0, boards: [{ id: "b1", satisfaction: 60, budget_modifier: 1.1 }], eventsOnly: true });
  assert.equal(r.ok, true);
  const changed = verifyAgainstPlan({ plan, youthEventsRemaining: 0, boards: [{ id: "b1", satisfaction: 60, budget_modifier: 1.0 }], eventsOnly: true });
  assert.deepEqual(changed.mismatches.map((m) => m.reason), ["budget_modifier"]);
});

test("verifyAgainstPlan: ok når events er væk og boards matcher", () => {
  const plan = { plans: [
    { board_id: "b1", repaired: 50, baseline: false, newModifier: 1.0 },
    { board_id: "b2", repaired: 40, baseline: true, newModifier: 1.0 },
  ] };
  const ok = verifyAgainstPlan({ plan, youthEventsRemaining: 0, boards: [
    { id: "b1", satisfaction: 50, budget_modifier: 1.0 }, { id: "b2", satisfaction: 40, budget_modifier: 1.0 },
  ] });
  assert.equal(ok.ok, true);
  const bad = verifyAgainstPlan({ plan, youthEventsRemaining: 2, boards: [{ id: "b1", satisfaction: 51, budget_modifier: 1.0 }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.mismatches.map((m) => m.reason).sort(), ["missing", "satisfaction"]);
});

test("CLI: dry-run er default, apply kræver owner-go-token OG liste-hash", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, approvedHash: null, verify: null, dryRun: true, eventsOnly: false });
  assert.throws(() => parseArgs(["--events-only"]), /kræver/);
  const goB = parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`, "--events-only"]);
  assert.equal(goB.eventsOnly && goB.apply && goB.ownerGo && !goB.dryRun, true);
  assert.equal(goB.approvedHash, HASH);
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.throws(() => parseArgs([OWNER_GO_FLAG]), /--apply/);
  assert.throws(() => parseArgs(["--typo"]), /Ukendt/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`, "--verify=x.json"]), /kombineres/);
  assert.equal(parseArgs(["--verify=5897/x.json"]).verify, "5897/x.json");
});

test("token-gate: bar --owner-go, forkert token, manglende eller ugyldig liste-hash afvises", () => {
  assert.equal(OWNER_GO_FLAG, "--owner-go=5897-production");
  assert.throws(() => parseArgs(["--apply", "--owner-go", `--approved-list=${HASH}`]), /Forkert owner-go-token/);
  assert.throws(() => parseArgs(["--apply", "--owner-go=5864-production", `--approved-list=${HASH}`]), /Forkert owner-go-token/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG]), /--approved-list/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, "--approved-list=abc"]), /64-tegns/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH.toUpperCase()}`]), /64-tegns/);
  assert.throws(() => parseArgs([`--approved-list=${HASH}`]), /uden --apply/);
  assert.throws(() => buildApplySql({ eventsOnly: true }), /approvedHash/);
});

test("eventIdSetHash: eksakt id-mængde, uafhængig af rækkefølge og dubletter", () => {
  const a = [{ id: "e2" }, { id: "e1" }, { id: "e3" }];
  const b = [{ id: "e3" }, { id: "e1" }, { id: "e2" }, { id: "e1" }];
  assert.equal(eventIdSetHash(a), eventIdSetHash(b));
  assert.match(eventIdSetHash(a), /^[a-f0-9]{64}$/);
  // Samme antal, anden mængde => anden hash.
  assert.notEqual(eventIdSetHash(a), eventIdSetHash([{ id: "e1" }, { id: "e2" }, { id: "e4" }]));
  // Formlen er sha256 over kodepunkt-sorterede ids join'et med "\n" (samme som SQL'en).
  assert.equal(eventIdSetHash(a), createHash("sha256").update("e1\ne2\ne3").digest("hex"));
  // Kodepunkt-orden (som COLLATE "C"), ikke locale-orden.
  const mixed = [{ id: "b" }, { id: "B" }, { id: "a-1" }, { id: "a1" }];
  assert.equal(eventIdSetHash(mixed), createHash("sha256").update(["B", "a-1", "a1", "b"].join("\n")).digest("hex"));
});

test("apply-SQL gentager liste-gaten under lås FØR første skrivning", () => {
  const sql = buildApplySql({ eventsOnly: true, approvedHash: HASH });
  const lock = sql.indexOf("LOCK TABLE");
  const hashCheck = sql.indexOf(`IF live_hash IS DISTINCT FROM '${HASH}'`);
  const backupCheck = sql.indexOf("to_regclass('public.backup_board_profiles_5897')");
  const firstWrite = sql.indexOf("CREATE TABLE public.backup_board_satisfaction_events_5897");
  assert.ok(lock > 0 && lock < backupCheck && backupCheck < hashCheck && hashCheck < firstWrite);
  assert.match(sql, /ORDER BY x\.id_text COLLATE "C"/);
  assert.match(sql, /string_agg\(x\.id_text, E'\\n'/);
  assert.match(sql, /SELECT DISTINCT e\.id::text AS id_text/);
  assert.match(sql, /matcher ikke den godkendte liste-hash/);
});

function gateInput(ids) {
  return { youthEvents: ids.map((id) => ev(id, "b1", "y1", 1, T0)) };
}

test("prepareApply: hash-mismatch stopper før backup-tjek og før SQL", async () => {
  const approved = eventIdSetHash(gateInput(["e1", "e2"]).youthEvents);
  let backupChecked = false;
  const checkBackups = async () => { backupChecked = true; return []; };
  await assert.rejects(
    prepareApply({ supabase: null, input: gateInput(["e1", "e3"]), ownerGo: true, approvedHash: approved, eventsOnly: true, checkBackups }),
    /afviger fra den godkendte liste[\s\S]*Intet skrevet/,
  );
  await assert.rejects(
    prepareApply({ supabase: null, input: gateInput(["e1", "e2", "e3"]), ownerGo: true, approvedHash: approved, eventsOnly: true, checkBackups }),
    /afviger/,
  );
  assert.equal(backupChecked, false);
  await assert.rejects(
    prepareApply({ supabase: null, input: gateInput(["e1", "e2"]), ownerGo: false, approvedHash: approved, checkBackups }),
    /5897-production/,
  );
  const ok = await prepareApply({ supabase: null, input: gateInput(["e2", "e1"]), ownerGo: true, approvedHash: approved, eventsOnly: true, checkBackups });
  assert.equal(ok.liveHash, approved);
  assert.match(ok.sql, /EVENTS-ONLY/);
  assert.ok(ok.sql.includes(approved));
});

test("prepareApply: findes en backup-tabel allerede, stopper apply", async () => {
  const input = gateInput(["e1"]);
  const approvedHash = eventIdSetHash(input.youthEvents);
  await assert.rejects(
    prepareApply({ supabase: null, input, ownerGo: true, approvedHash, checkBackups: async () => [BACKUP_EVENTS_TABLE] }),
    /backup-tabel findes allerede \(backup_board_satisfaction_events_5897\)[\s\S]*Intet skrevet/,
  );
});

test("existingBackupTables: læser PostgREST-svar korrekt og stopper ved ukendt fejl", async () => {
  const missing = "Could not find the table 'public.x' in the schema cache";
  const none = createFakeSupabase({}, { errors: { [BACKUP_PROFILES_TABLE]: { select: missing }, [BACKUP_EVENTS_TABLE]: { select: missing } } });
  assert.deepEqual(await existingBackupTables(none), []);
  const one = createFakeSupabase({}, { errors: { [BACKUP_PROFILES_TABLE]: { select: missing } } });
  assert.deepEqual(await existingBackupTables(one), [BACKUP_EVENTS_TABLE]);
  const both = createFakeSupabase({});
  assert.deepEqual(await existingBackupTables(both), [BACKUP_PROFILES_TABLE, BACKUP_EVENTS_TABLE]);
  const broken = createFakeSupabase({}, { errors: { [BACKUP_PROFILES_TABLE]: { select: "permission denied" } } });
  await assert.rejects(existingBackupTables(broken), /kunne ikke afgøre[\s\S]*Intet skrevet/);
  const coded = { from: () => ({ select: () => ({ limit: async () => ({ error: { code: "PGRST205", message: "x" } }) }) }) };
  assert.deepEqual(await existingBackupTables(coded), []);
});

test("planRepair: tæller ungdoms-events oprettet efter forebyggelsen (#5892)", () => {
  const after = new Date(Date.parse(PREVENTION_MERGED_AT) + 60_000).toISOString();
  const before = planRepair({ youthEvents: [ev("e1", "b1", "y1", 1, T0)], boards: [{ id: "b1", team_id: "tA", satisfaction: 50 }] });
  assert.equal(before.summary.youthEventsAfterPrevention, 0);
  const regressed = planRepair({
    youthEvents: [ev("e1", "b1", "y1", 1, T0), ev("e2", "b1", "y2", 1, after)],
    boards: [{ id: "b1", team_id: "tA", satisfaction: 50 }],
  });
  assert.equal(regressed.summary.youthEventsAfterPrevention, 1);
  assert.equal(regressed.summary.listHash, eventIdSetHash([{ id: "e1" }, { id: "e2" }]));
  const md = renderPublicReport(regressed.summary, { generatedAt: "x", privateFile: "5897/x.json" });
  assert.match(md, /REGRESSION/);
  assert.doesNotMatch(renderPublicReport(before.summary, { generatedAt: "x", privateFile: "5897/x.json" }), /REGRESSION/);
});

test("rapport: liste-hash, events efter forebyggelsen og ændring mod 1/10-baseline", () => {
  const baselineMd = readFileSync(new URL(`../../../docs/snapshots/5897/${BASELINE_REPORT}`, import.meta.url), "utf8");
  const baseline = parseReportCounts(baselineMd);
  assert.equal(baseline.get("Ungdoms-events (races.squad <> 'senior') der fjernes"), "2100");
  assert.equal(baseline.get("Boards hvor budget_modifier ændres (op / ned)"), "93 (8 / 85)");
  assert.equal(baseline.has("Mål"), false);

  const { summary } = planRepair({
    youthEvents: [ev("e1", "b1", "y1", 3, T0)],
    boards: [{ id: "b1", team_id: "tA", satisfaction: 50, budget_modifier: 1.0, negotiation_status: "completed" }],
  });
  const md = renderPublicReport(summary, { generatedAt: "2026-10-10T00:00:00Z", privateFile: "5897/x.json", baseline });
  assert.ok(md.includes(summary.listHash));
  assert.ok(md.includes(`--approved-list=${summary.listHash} --events-only`));
  assert.match(md, /\| Ungdoms-events \(races\.squad <> 'senior'\) der fjernes \| 1 \| 2100 \| -2099 \|/);
  assert.match(md, /\| Ungdoms-events oprettet efter forebyggelsen \(#5892\), forventet 0 \| 0 \| - \| ny \|/);
  assert.match(md, /\| Boards der mangler \(event uden board\) \| 0 \| 0 \| uændret \|/);
  assert.match(md, /Ændret siden 1\/10/);
  assert.equal(compareCell("93 (8 / 85)", "93 (8 / 85)"), "uændret");
  assert.equal(compareCell("94 (9 / 85)", "93 (8 / 85)"), "ændret");
  assert.equal(compareCell(5, "3"), "+2");
});

test("offentlig rapport indeholder kun antal, ingen ids eller beløb", () => {
  const { summary } = planRepair({
    youthEvents: [ev("e1", "board-secret-id", "y1", 12, T0)],
    boards: [{ id: "board-secret-id", team_id: "team-secret-id", satisfaction: 70, budget_modifier: satisfactionToModifier(70), negotiation_status: "completed" }],
    teamBoards: [{ id: "board-secret-id", team_id: "team-secret-id", satisfaction: 70, budget_modifier: satisfactionToModifier(70), negotiation_status: "completed" }],
    teams: [{ id: "team-secret-id", sponsor_income: 987654 }],
  });
  const md = renderPublicReport(summary, { generatedAt: "2026-10-01T00:00:00Z", privateFile: "5897/dry-run-x.json" });
  assert.doesNotMatch(md, /secret/);
  assert.doesNotMatch(md, /987654/);
  assert.match(md, /Boards med invers-delta \| 1 \|/);
});
