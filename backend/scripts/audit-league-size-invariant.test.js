import test from "node:test";
import assert from "node:assert/strict";

import { runLeagueSizeAudit, excessScore, REQUIRED_TEAM_COUNT } from "./audit-league-size-invariant.js";

// Mock for audit-stien:
//   league_divisions.select().order().range()
//   teams.select().order().range()
//   riders.select().not().order().range()
// Alle tre er paginerede single-page reads i disse tests (data.length < 1000).
function makeMock({ divisions = [], teams = [], riders = [] } = {}) {
  function from(table) {
    const b = {
      select() { return b; },
      order() { return b; },
      not() { return b; },
      range() {
        if (table === "league_divisions") return Promise.resolve({ data: divisions, error: null });
        if (table === "teams") return Promise.resolve({ data: teams, error: null });
        if (table === "riders") return Promise.resolve({ data: riders, error: null });
        return Promise.resolve({ data: [], error: null });
      },
    };
    return b;
  }
  return { from };
}

function makeDivision(id, tier, pool_index, label) {
  return { id, tier, pool_index, label };
}

function makeTeam(id, { league_division_id = null, is_ai = false, is_frozen = false, is_bank = false, created_at = "2026-06-01T00:00:00Z", name } = {}) {
  return { id, name: name || `Team ${id}`, is_ai, is_frozen, is_bank, created_at, league_division_id };
}

test("no findings when every division has exactly 24 teams", async () => {
  const divisions = [makeDivision(1, 1, 0, "Division 1")];
  const teams = Array.from({ length: 24 }, (_, i) => makeTeam(`t${i}`, { league_division_id: 1 }));
  const supabase = makeMock({ divisions, teams, riders: [] });

  const summary = await runLeagueSizeAudit({ supabase });
  assert.equal(summary.total_findings, 0);
  assert.equal(summary.required_team_count, REQUIRED_TEAM_COUNT);
});

test("flags a group with 25 teams (excess) with positive delta", async () => {
  const divisions = [makeDivision(1, 1, 0, "Division 1")];
  const teams = Array.from({ length: 25 }, (_, i) => makeTeam(`t${i}`, { league_division_id: 1 }));
  const supabase = makeMock({ divisions, teams, riders: [] });

  const summary = await runLeagueSizeAudit({ supabase });
  assert.equal(summary.total_findings, 1);
  assert.equal(summary.findings[0].count, 25);
  assert.equal(summary.findings[0].delta, 1);
  assert.equal(summary.findings[0].label, "Division 1");
});

test("flags a group with 23 teams (shortage) with negative delta and no candidates", async () => {
  const divisions = [makeDivision(1, 1, 0, "Division 1")];
  const teams = Array.from({ length: 23 }, (_, i) => makeTeam(`t${i}`, { league_division_id: 1 }));
  const supabase = makeMock({ divisions, teams, riders: [] });

  const summary = await runLeagueSizeAudit({ supabase });
  assert.equal(summary.total_findings, 1);
  assert.equal(summary.findings[0].delta, -1);
  // Shortage har ingen "overskudskandidater" — der er intet at trimme.
  assert.equal(summary.findings[0].top_candidates.length, 0);
});

test("ranks AI + frozen + 0-rider teams highest as excess candidates", async () => {
  const divisions = [makeDivision(1, 1, 0, "Division 1")];
  const normalTeams = Array.from({ length: 24 }, (_, i) => makeTeam(`normal${i}`, { league_division_id: 1 }));
  const aiExcess = makeTeam("ai-excess", {
    league_division_id: 1,
    is_ai: true,
    is_frozen: true,
    created_at: "2026-06-22T00:00:00Z",
    name: "AI Excess Cycling",
  });
  const teams = [...normalTeams, aiExcess];
  // Give normal teams riders so they don't outrank the AI-excess team.
  const riders = normalTeams.map((t, i) => ({ team_id: t.id, i }));
  const supabase = makeMock({ divisions, teams, riders });

  const summary = await runLeagueSizeAudit({ supabase });
  assert.equal(summary.total_findings, 1);
  assert.equal(summary.findings[0].delta, 1);
  assert.equal(summary.findings[0].top_candidates[0].id, "ai-excess");
  assert.equal(summary.findings[0].top_candidates[0].rider_count, 0);
});

test("excludes bank teams from the invariant count", async () => {
  const divisions = [makeDivision(1, 1, 0, "Division 1")];
  const teams = [
    ...Array.from({ length: 24 }, (_, i) => makeTeam(`t${i}`, { league_division_id: 1 })),
    makeTeam("bank", { league_division_id: 1, is_bank: true }),
  ];
  const supabase = makeMock({ divisions, teams, riders: [] });

  const summary = await runLeagueSizeAudit({ supabase });
  assert.equal(summary.total_findings, 0, "bank-hold må ikke tælle med i puljens 24-krav");
});

test("teams with no league_division_id are outside the invariant (not flagged)", async () => {
  const divisions = [makeDivision(1, 1, 0, "Division 1")];
  const teams = [
    ...Array.from({ length: 24 }, (_, i) => makeTeam(`t${i}`, { league_division_id: 1 })),
    makeTeam("unallocated", { league_division_id: null }),
  ];
  const supabase = makeMock({ divisions, teams, riders: [] });

  const summary = await runLeagueSizeAudit({ supabase });
  assert.equal(summary.total_findings, 0, "et ikke-allokeret hold må ikke tælle med i nogen puljes 24-krav");
});

test("excessScore ranks AI+frozen+0-rider highest, plain team lowest", () => {
  const plain = { is_ai: false, is_frozen: false, rider_count: 5 };
  const aiFrozenEmpty = { is_ai: true, is_frozen: true, rider_count: 0 };
  assert.ok(excessScore(aiFrozenEmpty) > excessScore(plain));
});

test("multiple divisions: only the ones deviating from 24 are reported", async () => {
  const divisions = [makeDivision(1, 1, 0, "Division 1"), makeDivision(2, 2, 0, "Division 2 — A")];
  const teams = [
    ...Array.from({ length: 24 }, (_, i) => makeTeam(`d1-${i}`, { league_division_id: 1 })),
    ...Array.from({ length: 26 }, (_, i) => makeTeam(`d2-${i}`, { league_division_id: 2 })),
  ];
  const supabase = makeMock({ divisions, teams, riders: [] });

  const summary = await runLeagueSizeAudit({ supabase });
  assert.equal(summary.total_findings, 1);
  assert.equal(summary.findings[0].label, "Division 2 — A");
  assert.equal(summary.findings[0].delta, 2);
});
