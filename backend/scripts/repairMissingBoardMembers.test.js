// backend/scripts/repairMissingBoardMembers.test.js
// ============================================================================
// #4715 — repairMissingBoardMembers.js's dry-run-rapport overtalte kandidater
// (37 vist, 13 reelt repareret ved --apply), fordi rapporten og apply-loopet
// brugte to forskellige tællinger. Kernen i denne test-fil: kør scriptets
// kerne (runRepairMissingBoardMembers) i BÅDE dry-run- og apply-tilstand mod
// PRÆCIS samme fixture, og bevis at dry-run-listen (repairCandidateIds) er
// identisk med apply's faktiske resultat (repairedTeamIds) — ingen team må
// falde i "already_assigned" (det er netop det divergens-signal #4715 så).
//
// Refs #4715 #4664.

import test from "node:test";
import assert from "node:assert/strict";

import {
  countMembersByTeam,
  isRepairEligible,
  selectRepairCandidates,
  runRepairMissingBoardMembers,
  fetchRepairSnapshot,
} from "./repairMissingBoardMembers.js";
import { TEAM_BOARD_MEMBERS_COUNT } from "../lib/boardMembers.js";

// ── Mock-supabase: minimal, in-memory, kun de kald scriptet + ─────────────
// assignBoardMembersForTeam faktisk foretager (select+eq, insert). Thenable
// query-builder, så både `await ....select(...)` og `await ...select(...).eq(...)`
// virker uden en rigtig supabase-js-afhængighed.
function makeSupabase({ teams, members }) {
  const state = {
    teams: teams.map((t) => ({ ...t })),
    team_board_members: members.map((m) => ({ ...m })),
  };

  function selectBuilder(table) {
    let rows = state[table];
    const builder = {
      eq(col, val) {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      then(resolve, reject) {
        Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    from(table) {
      return {
        select: () => selectBuilder(table),
        insert: (rows) => {
          state[table].push(...rows.map((r) => ({ ...r })));
          return Promise.resolve({ error: null });
        },
      };
    },
    state,
  };
}

const IDENTITY_BASIS = { youth_level: "medium", season_number_observed: 1 };

/**
 * Bygger et fixture med teams i alle fire klasser #4715-predikatet skal
 * skelne mellem: eligible-og-klar, eligible-men-ikke-klar (mangler identity
 * basis), test-konto (ekskluderes), AI-hold (ekskluderes), og allerede-fuldt
 * (ekskluderes af selve tælle-predikatet).
 */
function makeFixtureTeams() {
  const teams = [
    { id: "t-eligible-1", name: "Eligible Et", is_ai: false, is_test_account: false, season_1_identity_basis: IDENTITY_BASIS, team_dna_key: null },
    { id: "t-eligible-2", name: "Eligible To", is_ai: false, is_test_account: false, season_1_identity_basis: IDENTITY_BASIS, team_dna_key: "climbers" },
    { id: "t-eligible-3", name: "Eligible Tre", is_ai: false, is_test_account: false, season_1_identity_basis: IDENTITY_BASIS, team_dna_key: null },
    { id: "t-not-ready", name: "Ikke Klar", is_ai: false, is_test_account: false, season_1_identity_basis: null, team_dna_key: null },
    { id: "t-test-account", name: "Test Konto", is_ai: false, is_test_account: true, season_1_identity_basis: IDENTITY_BASIS, team_dna_key: null },
    { id: "t-ai", name: "AI Hold", is_ai: true, is_test_account: false, season_1_identity_basis: IDENTITY_BASIS, team_dna_key: null },
    { id: "t-already-full", name: "Allerede Fuld", is_ai: false, is_test_account: false, season_1_identity_basis: IDENTITY_BASIS, team_dna_key: null },
  ];
  // Kun "t-already-full" starter med et fuldt board; alle andre har 0 medlemmer.
  const members = Array.from({ length: TEAM_BOARD_MEMBERS_COUNT }, (_, i) => ({
    team_id: "t-already-full",
    archetype_key: `k${i}`,
  }));
  return { teams, members };
}

test("countMembersByTeam taeller korrekt, inkl. hold uden raekker", () => {
  const map = countMembersByTeam([
    { team_id: "a" }, { team_id: "a" }, { team_id: "b" },
  ]);
  assert.equal(map.get("a"), 2);
  assert.equal(map.get("b"), 1);
  assert.equal(map.get("c"), undefined);
});

test("isRepairEligible: is_ai, is_test_account og fuldt board ekskluderer; alt andet under COUNT er eligible", () => {
  assert.equal(isRepairEligible({ is_ai: true }, 0), false);
  assert.equal(isRepairEligible({ is_test_account: true }, 0), false);
  assert.equal(isRepairEligible({}, TEAM_BOARD_MEMBERS_COUNT), false, "praecis fuldt board er IKKE eligible");
  assert.equal(isRepairEligible({}, TEAM_BOARD_MEMBERS_COUNT - 1), true, "en under fuldt er eligible");
  assert.equal(isRepairEligible({}, 0), true);
  assert.equal(isRepairEligible(null, 0), false);
});

test("selectRepairCandidates: missing inkluderer test-konti, eligible ekskluderer dem (samme predikat som apply)", () => {
  const { teams, members } = makeFixtureTeams();
  const countByTeam = countMembersByTeam(members);
  const { missing, eligible } = selectRepairCandidates(teams, countByTeam);

  // missing: alle menneskehold under fuldt board, INKL. test-konti, EKSKL. AI.
  assert.deepEqual(
    missing.map((t) => t.id).sort(),
    ["t-eligible-1", "t-eligible-2", "t-eligible-3", "t-not-ready", "t-test-account"].sort(),
  );
  // eligible: samme, MINUS test-konti.
  assert.deepEqual(
    eligible.map((t) => t.id).sort(),
    ["t-eligible-1", "t-eligible-2", "t-eligible-3", "t-not-ready"].sort(),
  );
});

// ── Kernen i #4715: dry-run-listen == apply-listen på samme fixture ────────
test("dry-run-kandidatlisten er IDENTISK med apply's faktiske resultat på samme fixture (#4715)", async () => {
  const dryRunDb = makeSupabase(makeFixtureTeams());
  const dryRun = await runRepairMissingBoardMembers({ supabase: dryRunDb, apply: false });

  // Frisk, uafhaengig kopi af PRAECIS samme udgangs-data til apply-koerslen.
  const applyDb = makeSupabase(makeFixtureTeams());
  const apply = await runRepairMissingBoardMembers({ supabase: applyDb, apply: true });

  // Rapport-tallene skal stemme (den bug #4715 rapporterede: 37 vs 13).
  assert.equal(dryRun.eligibleCount, apply.eligibleCount);
  assert.equal(dryRun.repairCandidateIds.length, apply.repairCandidateIds.length);
  assert.deepEqual([...dryRun.repairCandidateIds].sort(), [...apply.repairCandidateIds].sort());

  // Selve leverancen: den liste dry-run LOVER at reparere er den liste apply
  // FAKTISK reparerer — ingen team må falde i "already_assigned" (det signal
  // ville betyde de to tællinger er kommet ud af trit igen).
  assert.deepEqual([...apply.repairedTeamIds].sort(), [...dryRun.repairCandidateIds].sort());
  assert.deepEqual(apply.alreadyAssignedTeamIds, []);
  assert.deepEqual(apply.failedTeamIds, []);

  // "t-not-ready" er eligible (under fuldt board), men mangler identity_basis,
  // så den optræder i notReadyTeamIds i BEGGE tilstande, ikke i kandidatlisten.
  assert.ok(dryRun.notReadyTeamIds.includes("t-not-ready"));
  assert.ok(apply.notReadyTeamIds.includes("t-not-ready"));
  assert.ok(!dryRun.repairCandidateIds.includes("t-not-ready"));

  // Test-konto, AI-hold og allerede-fuldt hold optraeder slet ikke.
  for (const excluded of ["t-test-account", "t-ai", "t-already-full"]) {
    assert.ok(!dryRun.repairCandidateIds.includes(excluded));
    assert.ok(!apply.repairCandidateIds.includes(excluded));
  }

  // Og selve DB-tilstanden bekraefter det: apply skrev faktisk 5 medlemmer
  // pr. repareret hold, "t-already-full" er uroert.
  for (const teamId of apply.repairedTeamIds) {
    const rows = applyDb.state.team_board_members.filter((r) => r.team_id === teamId);
    assert.equal(rows.length, TEAM_BOARD_MEMBERS_COUNT);
  }
  assert.equal(applyDb.state.team_board_members.filter((r) => r.team_id === "t-already-full").length, TEAM_BOARD_MEMBERS_COUNT);
});

test("apply er idempotent: en ANDEN apply-koersel mod samme (nu reparerede) DB reparerer 0 nye", async () => {
  const db = makeSupabase(makeFixtureTeams());
  const first = await runRepairMissingBoardMembers({ supabase: db, apply: true });
  assert.ok(first.repairedTeamIds.length > 0);

  // Frisk snapshot (fetchRepairSnapshot koeres paa ny inde i runRepairMissingBoardMembers):
  // de reparerede hold har nu 5 medlemmer og forsvinder derfor HELT fra
  // "eligible" (samme predikat som rapporten) — de optraeder ikke laengere
  // som "already_assigned", de er bare ikke kandidater mere.
  const second = await runRepairMissingBoardMembers({ supabase: db, apply: true });
  assert.deepEqual(second.repairedTeamIds, []);
  assert.deepEqual(second.alreadyAssignedTeamIds, []);
  for (const teamId of first.repairedTeamIds) {
    assert.ok(!second.repairCandidateIds.includes(teamId), `${teamId} skal ikke laengere vaere kandidat`);
  }
  // Kun "t-not-ready" er stadig eligible (mangler identity_basis, aldrig repareret).
  assert.deepEqual(second.repairCandidateIds, []);
  assert.deepEqual(second.notReadyTeamIds, ["t-not-ready"]);
});

test("fetchRepairSnapshot laeser teams + team_board_members og taeller korrekt", async () => {
  const db = makeSupabase(makeFixtureTeams());
  const { teams, countByTeam } = await fetchRepairSnapshot(db);
  assert.equal(teams.length, 7);
  assert.equal(countByTeam.get("t-already-full"), TEAM_BOARD_MEMBERS_COUNT);
  assert.equal(countByTeam.get("t-eligible-1"), undefined);
});
