// backend/scripts/resyncMandateGoalsFromLegacy5751.test.js
// #5751 · resynk af board_mandates.goals fra den gamle 1yr-forhandling.
// Mod en falsk Supabase: dry-run skriver intet, --apply uden --owner-go
// afvises, beskyttede mandater springes over, kun target/label/
// satisfaction_bonus skrives, backup-porten stopper skrivning, og en anden
// kørsel er en no-op.
//
// Refs #5751.

import test from "node:test";
import assert from "node:assert/strict";

import {
  backupTableName,
  isProtectedMandate,
  parseResyncArgs,
  planMandateGoalResync,
  runResyncMandateGoalsFromLegacy,
} from "./resyncMandateGoalsFromLegacy5751.js";
import { createFakeSupabase } from "../lib/testUtils/fakeSupabase.js";

const NOW = new Date("2026-09-25T18:00:00Z");
const BACKUP = backupTableName(NOW);

const staleGoal = () => ({
  type: "top_n_finish", target: 5, label: "Slut i top 5", category: "results",
  satisfaction_bonus: 10, satisfaction_penalty: 5, status: "behind",
});
const legacyGoal = () => ({
  type: "top_n_finish", target: 7, label: "Slut i top 7", category: "results",
  satisfaction_bonus: 12, satisfaction_penalty: 9,
});

function makeState(over = {}) {
  return {
    teams: [
      { id: "t-a", name: "Hold A", is_ai: false },
      { id: "t-b", name: "Hold B", is_ai: false },
      { id: "t-c", name: "Hold C", is_ai: false },
      { id: "t-ai", name: "AI", is_ai: true },
    ],
    board_mandates: [
      // Hold A: stale mål + bonusmål → resynkes (kun det native mål).
      { id: "m-a", team_id: "t-a", status: "active", adjustments_used: 0, request_used: false,
        goals: [staleGoal(), { type: "monument_podium", target: 1, source: "bonus_offer" }] },
      // Hold B: årsmøde har rørt mandatet → beskyttet.
      { id: "m-b", team_id: "t-b", status: "active", adjustments_used: 1, request_used: false, goals: [staleGoal()] },
      // Hold C: legacy-forhandling i gang (pending) → urørt.
      { id: "m-c", team_id: "t-c", status: "active", adjustments_used: 0, request_used: false, goals: [staleGoal()] },
      // AI-hold → aldrig med.
      { id: "m-ai", team_id: "t-ai", status: "active", adjustments_used: 0, request_used: false, goals: [staleGoal()] },
    ],
    board_profiles: [
      { id: "bp-a", team_id: "t-a", plan_type: "1yr", negotiation_status: "completed", negotiated_at: null,
        current_goals: [legacyGoal(), { type: "stage_wins", target: 3 }] },
      { id: "bp-b", team_id: "t-b", plan_type: "1yr", negotiation_status: "completed", negotiated_at: null,
        current_goals: [legacyGoal()] },
      { id: "bp-c", team_id: "t-c", plan_type: "1yr", negotiation_status: "pending", negotiated_at: null,
        current_goals: [legacyGoal()] },
      { id: "bp-ai", team_id: "t-ai", plan_type: "1yr", negotiation_status: "completed", negotiated_at: null,
        current_goals: [legacyGoal()] },
    ],
    [BACKUP]: [{ id: "m-a" }, { id: "m-b" }, { id: "m-c" }],
    ...over,
  };
}

test("#5751 resync: --apply uden --owner-go afvises; begge flag = apply; intet flag = dry-run", () => {
  assert.equal(parseResyncArgs([]).apply, false);
  assert.equal(parseResyncArgs([]).error, null);
  const halfCommand = parseResyncArgs(["--apply"]);
  assert.equal(halfCommand.apply, false);
  assert.match(halfCommand.error, /--owner-go/);
  assert.deepEqual(parseResyncArgs(["--apply", "--owner-go"]), { apply: true, error: null });
});

test("#5751 resync: beskyttet = adjustments_used > 0 eller request_used", () => {
  assert.equal(isProtectedMandate({ adjustments_used: 0, request_used: false }), false);
  assert.equal(isProtectedMandate({ adjustments_used: 2 }), true);
  assert.equal(isProtectedMandate({ adjustments_used: 0, request_used: true }), true);
});

test("#5751 resync: planen kopierer KUN target/label/satisfaction_bonus og bevarer resten af målet", () => {
  const { goals, changes } = planMandateGoalResync({
    mandateGoals: [staleGoal()],
    legacyBoard: { negotiation_status: "completed", current_goals: [legacyGoal()] },
  });
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].to, { target: 7, label: "Slut i top 7", satisfaction_bonus: 12 });
  assert.deepEqual(changes[0].from, { target: 5, label: "Slut i top 5", satisfaction_bonus: 10 });
  assert.equal(goals[0].satisfaction_penalty, 5, "penalty er ikke en af de tre felter scriptet skriver");
  assert.equal(goals[0].status, "behind", "status røres aldrig");
  assert.equal(goals[0].category, "results");
});

test("#5751 resync: dry-run skriver INTET og rapporterer Hold A som plan, Hold B som beskyttet", async () => {
  const state = makeState();
  const before = JSON.stringify(state.board_mandates);
  const supabase = createFakeSupabase(state);

  const res = await runResyncMandateGoalsFromLegacy({ supabase, apply: false, now: NOW });

  assert.equal(JSON.stringify(state.board_mandates), before, "dry-run må ikke ændre en eneste række");
  assert.equal(res.mandatesScanned, 3, "AI-holdet tælles ikke med");
  assert.deepEqual(res.planned.map((p) => p.mandateId), ["m-a"]);
  assert.deepEqual(res.protected.map((p) => p.mandateId), ["m-b"]);
  assert.equal(res.planned[0].changes.length, 1, "bonusmålet og legacy-only stage_wins indgår ikke");
  assert.deepEqual(res.written, []);
});

test("#5751 resync: apply skriver kun det ubeskyttede mandat, rører ikke bonusmål, og anden kørsel = 0 ændringer", async () => {
  const state = makeState();
  const supabase = createFakeSupabase(state);

  const res = await runResyncMandateGoalsFromLegacy({ supabase, apply: true, now: NOW });
  assert.equal(res.error, null);
  assert.deepEqual(res.written, ["m-a"]);

  const mandateA = state.board_mandates.find((m) => m.id === "m-a");
  assert.equal(mandateA.goals.length, 2, "ingen mål tilføjet eller fjernet");
  assert.equal(mandateA.goals[0].target, 7);
  assert.equal(mandateA.goals[0].label, "Slut i top 7");
  assert.equal(mandateA.goals[0].satisfaction_bonus, 12);
  assert.equal(mandateA.goals[0].status, "behind");
  assert.deepEqual(mandateA.goals[1], { type: "monument_podium", target: 1, source: "bonus_offer" });
  assert.equal(mandateA.adjustments_used, 0);
  assert.equal(mandateA.status, "active");

  assert.equal(state.board_mandates.find((m) => m.id === "m-b").goals[0].target, 5, "beskyttet mandat urørt");
  assert.equal(state.board_mandates.find((m) => m.id === "m-c").goals[0].target, 5, "pending legacy urørt");
  assert.equal(state.board_mandates.find((m) => m.id === "m-ai").goals[0].target, 5, "AI-hold urørt");

  const second = await runResyncMandateGoalsFromLegacy({ supabase, apply: true, now: NOW });
  assert.deepEqual(second.planned, [], "idempotent: anden kørsel finder intet");
  assert.deepEqual(second.written, []);
});

test("#5751 resync: apply stopper FØR skrivning når backup-tabellen mangler eller er ufuldstændig", async () => {
  const missingState = makeState();
  delete missingState[BACKUP];
  const missing = createFakeSupabase(missingState, { errors: { [BACKUP]: { select: "relation does not exist" } } });
  const resMissing = await runResyncMandateGoalsFromLegacy({ supabase: missing, apply: true, now: NOW });
  assert.match(resMissing.error, /^backup_missing/);
  assert.deepEqual(resMissing.written, []);
  assert.equal(missingState.board_mandates.find((m) => m.id === "m-a").goals[0].target, 5);

  const incompleteState = makeState({ [BACKUP]: [{ id: "m-b" }] });
  const incomplete = createFakeSupabase(incompleteState);
  const resIncomplete = await runResyncMandateGoalsFromLegacy({ supabase: incomplete, apply: true, now: NOW });
  assert.match(resIncomplete.error, /^backup_incomplete/);
  assert.equal(incompleteState.board_mandates.find((m) => m.id === "m-a").goals[0].target, 5);
});

test("#5751 resync: et mandat der ændres mellem snapshot og skrivning springes over som konflikt (CodeRabbit-fund)", async () => {
  const state = makeState();
  const fake = createFakeSupabase(state);
  let mandateCalls = 0;
  const supabase = {
    from(table) {
      if (table === "board_mandates") {
        mandateCalls += 1;
        // Kald 1 = snapshot. Før genlæsningen (kald 2) når et årsmøde at ændre Hold A.
        if (mandateCalls === 2) {
          const row = state.board_mandates.find((m) => m.id === "m-a");
          row.goals = [{ ...row.goals[0], target: 4 }, row.goals[1]];
          row.adjustments_used = 1;
        }
      }
      return fake.from(table);
    },
  };

  const res = await runResyncMandateGoalsFromLegacy({ supabase, apply: true, now: NOW });
  assert.deepEqual(res.conflicts, ["m-a"]);
  assert.deepEqual(res.written, []);
  assert.equal(state.board_mandates.find((m) => m.id === "m-a").goals[0].target, 4, "årsmødets ændring overskrives ikke");
});

test("#5751 resync: backup-tabellens navn bærer datoen", () => {
  assert.equal(backupTableName(NOW), "backup_5751_board_mandates_goals_20260925");
});
