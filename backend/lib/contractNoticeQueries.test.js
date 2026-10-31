import test from "node:test";
import assert from "node:assert/strict";
import { fetchOwnedExpiringRiders } from "./notificationService.js";
import { emitSeasonTransitionRiskNotice } from "./seasonTransitionNotice.js";

function makeClient() {
  const owner = { id: "team-a", user_id: "owner-a", name: "Team A", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false };
  const teams = [owner, ...["is_ai", "is_bank", "is_frozen", "is_test_account"].map((flag, i) => ({ ...owner, id: `excluded-${i}`, [flag]: true }))];
  const base = { firstname: "Rider", birthdate: "2010-01-01", is_retired: false, is_academy: true, contract_end_season: 5, market_value: 1200 };
  const owned = ["senior", "u23", "junior", "academy"].map((squad, i) => ({ ...base, id: `r-${i}`, lastname: String(i), team_id: owner.id, team: owner, squad, is_academy: squad !== "senior", contract_end_season: i === 1 ? 4 : 5 }));
  const riders = [
    ...owned,
    ...teams.slice(1).map((team, i) => ({ ...base, id: `excluded-${i}`, team_id: team.id, team, squad: "junior" })),
    { ...owned[0], id: "future", contract_end_season: 6 },
    { ...owned[0], id: "retired", is_retired: true },
    { ...owned[0], id: "free", team_id: null, team: null },
    { ...owned[0], id: "unsigned", contract_end_season: null },
  ];
  const queries = [];
  return {
    queries,
    from(table) {
      const filters = [];
      let bounds;
      const q = { table, filters, ordered: false };
      queries.push(q);
      const field = (r, key) => key.split(".").reduce((v, k) => v?.[k], r);
      const b = {
        select() { return b; },
        eq(k, v) { filters.push((r) => field(r, k) === v); return b; },
        lte(k, v) { filters.push((r) => field(r, k) != null && field(r, k) <= v); return b; },
        not(k, _op, v) { filters.push((r) => field(r, k) !== v); return b; },
        order(k) { assert.equal(k, "id"); q.ordered = true; return b; },
        range(from, to) { bounds = [from, to]; return b; },
        then(resolve) {
          let rows = (table === "teams" ? teams : riders).filter((r) => filters.every((f) => f(r)));
          rows = rows.sort((a, z) => a.id.localeCompare(z.id));
          if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return b;
    },
  };
}

test("owned expiry reader includes all squads with the youth-release ownership exclusions", async () => {
  const supabase = makeClient();
  const rows = await fetchOwnedExpiringRiders({ supabase, seasonNumber: 5 });
  assert.deepEqual(rows.map((r) => r.id), ["r-0", "r-2", "r-3"]);
  assert.ok(supabase.queries.every((q) => q.ordered));
});

test("pre-transition notice includes overdue youth and academy without counting excluded owners", async () => {
  const supabase = makeClient();
  const calls = [];
  const stats = await emitSeasonTransitionRiskNotice({
    supabase, activeSeasonNumber: 5, dryRun: false,
    notify: async (p) => { calls.push(p); return { delivered: true }; },
  });
  assert.equal(stats.teamsAffected, 1);
  assert.equal(stats.totalExpiring, 4);
  assert.equal(stats.delivered, 1);
  assert.equal(calls[0].metadata.messageParams.contractRiders.length, 4);
  assert.deepEqual(calls[0].metadata.messageParams.contractRiders.map((r) => r.squad), ["senior", "u23", "junior", "academy"]);
  assert.ok(supabase.queries.every((q) => q.ordered));
});
