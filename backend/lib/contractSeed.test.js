import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT,
  computeFrozenSalary,
  pickContractLength,
  computeContractEndSeason,
  contractOnAcquirePatch,
  runContractSeed,
} from "./contractSeed.js";
import { makeRng } from "./fictionalRiderGenerator.js";

test("computeFrozenSalary spejler den gamle generated formel", () => {
  // GREATEST(1, ROUND((COALESCE(base_value,1000)+prize)*0.10))
  assert.equal(computeFrozenSalary({ base_value: 1_000_000, prize_earnings_bonus: 0 }), 100_000);
  assert.equal(computeFrozenSalary({ base_value: 50_000, prize_earnings_bonus: 5_000 }), 5_500);
  // NULL/0 base_value → fallback 1000 → salary 100
  assert.equal(computeFrozenSalary({ base_value: null, prize_earnings_bonus: 0 }), 100);
  // bundgrænse 1
  assert.equal(computeFrozenSalary({ base_value: 1, prize_earnings_bonus: 0 }), 1);
});

test("pickContractLength giver 1-3, ~1/3 fordeling, deterministisk pr. seed", () => {
  const rng = makeRng(2026);
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 3000; i++) counts[pickContractLength(rng)]++;
  for (const len of [1, 2, 3]) {
    assert.ok(counts[len] >= 850 && counts[len] <= 1150, `len ${len}: ${counts[len]} udenfor ~1/3`);
  }
  // determinisme: samme seed → samme første træk
  assert.equal(pickContractLength(makeRng(7)), pickContractLength(makeRng(7)));
});

test("computeContractEndSeason = start + length - 1", () => {
  assert.equal(computeContractEndSeason(1, 2), 2); // relaunch founder: aktiv sæson 1+2
  assert.equal(computeContractEndSeason(1, 1), 1);
  assert.equal(computeContractEndSeason(3, 3), 5);
});

test("CONTRACT-konstanter", () => {
  assert.equal(CONTRACT.FOUNDER_LENGTH, 2);
  assert.equal(CONTRACT.DEFAULT_ACQUIRE_LENGTH, 2);
  assert.equal(CONTRACT.SALARY_RATE, 0.10);
});

// ── contractOnAcquirePatch ──────────────────────────────────────────────────
// Create-if-missing / inherit-if-present: kontraktløse ryttere får standard-
// kontrakt; ryttere med kontrakt (salary != null) arver uændret ({}).

test("contractOnAcquirePatch: rytter MED kontrakt → {} (arves uændret, regenereres ALDRIG)", () => {
  // salary != null → tom patch uanset base_value/length/end
  assert.deepEqual(
    contractOnAcquirePatch({ salary: 42_000, base_value: 1_000_000, contract_length: 3, contract_end_season: 9 }, 5),
    {}
  );
  // salary 0 er en gyldig (gratis) kontrakt → arves også uændret
  assert.deepEqual(contractOnAcquirePatch({ salary: 0, base_value: 1_000_000 }, 5), {});
});

test("contractOnAcquirePatch: kontraktløs rytter → standard-kontrakt (length 2, frossen salary, korrekt end)", () => {
  const patch = contractOnAcquirePatch({ salary: null, base_value: 1_000_000, prize_earnings_bonus: 0 }, 1);
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.salary, 100_000); // 10% af 1_000_000
  assert.equal(patch.contract_end_season, 2); // 1 + 2 - 1
});

test("contractOnAcquirePatch: undefined salary behandles som kontraktløs (free agent)", () => {
  const patch = contractOnAcquirePatch({ base_value: 50_000, prize_earnings_bonus: 5_000 }, 3);
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.salary, 5_500); // 10% af (50_000 + 5_000)
  assert.equal(patch.contract_end_season, 4); // 3 + 2 - 1
});

test("contractOnAcquirePatch: kontraktløs + NULL base_value → fallback salary 100", () => {
  const patch = contractOnAcquirePatch({ salary: null, base_value: null }, 1);
  assert.equal(patch.salary, 100);
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.contract_end_season, 2);
});

// ── runContractSeed wrapper-tests ──────────────────────────────────────────────
// Supabase-mock spejler starterSquadAllocator.test.js: range() returnerer hele
// listen (fetchAllRows kalder .range() for paginering). update-calls optages.

function makeContractSupabase({ owned, activeSeasonNumber = 1 }) {
  const updates = [];
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: { number: activeSeasonNumber }, error: null }); },
        };
        return api;
      }
      // riders table
      const api = {
        select() { return api; },
        not() { return api; },
        order() { return api; },
        range() { return Promise.resolve({ data: owned, error: null }); },
        update(patch) {
          return {
            eq(_col, id) {
              updates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return api;
    },
    _updates: updates,
  };
  return supabase;
}

test("runContractSeed: founders → 2 sæsoner, andre ejede → 1-3, free agents urørt", async () => {
  const owned = [
    { id: "r1", team_id: "founder1", base_value: 1_000_000, prize_earnings_bonus: 0 },
    { id: "r2", team_id: "founder1", base_value: 200_000,   prize_earnings_bonus: 0 },
    { id: "r3", team_id: "ai1",      base_value: 500_000,   prize_earnings_bonus: 0 },
  ];
  const supabase = makeContractSupabase({ owned, activeSeasonNumber: 1 });

  const res = await runContractSeed(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => [{ id: "founder1" }],
  });

  assert.equal(res.dryRun, false);
  assert.equal(res.seeded, 3);
  assert.equal(res.founders, 1);
  assert.equal(res.startSeason, 1);

  const byId = Object.fromEntries(supabase._updates.map((u) => [u.id, u.patch]));

  // Founder r1: length=2, end=2, salary=100_000
  assert.equal(byId.r1.contract_length, 2);
  assert.equal(byId.r1.contract_end_season, 2);
  assert.equal(byId.r1.salary, 100_000);

  // Founder r2: length=2, end=2, salary=20_000
  assert.equal(byId.r2.contract_length, 2);
  assert.equal(byId.r2.contract_end_season, 2);
  assert.equal(byId.r2.salary, 20_000);

  // Non-founder r3: length 1-3, end = 1 + length - 1, salary=50_000
  assert.ok(byId.r3.contract_length >= 1 && byId.r3.contract_length <= 3,
    `r3 length=${byId.r3.contract_length} ude af 1-3`);
  assert.equal(byId.r3.contract_end_season, byId.r3.contract_length); // = 1 + length - 1
  assert.equal(byId.r3.salary, 50_000);
});

test("runContractSeed (dryRun): ingen writes, kun preview-count", async () => {
  const owned = [
    { id: "r1", team_id: "founder1", base_value: 800_000, prize_earnings_bonus: 0 },
  ];
  const supabase = makeContractSupabase({ owned, activeSeasonNumber: 1 });

  const res = await runContractSeed(supabase, {
    dryRun: true,
    seed: 2026,
    getManagerTeams: async () => [{ id: "founder1" }],
  });

  assert.equal(res.dryRun, true);
  assert.equal(res.toSeed, 1);
  assert.equal(supabase._updates.length, 0, "dryRun må ikke skrive");
});

test("runContractSeed: ingen ejede ryttere → seeded=0", async () => {
  const supabase = makeContractSupabase({ owned: [], activeSeasonNumber: 1 });
  const res = await runContractSeed(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => [],
  });
  assert.equal(res.seeded, 0);
  assert.equal(supabase._updates.length, 0);
});

test("runContractSeed: kaster uden supabase-client", async () => {
  await assert.rejects(
    () => runContractSeed(null, { getManagerTeams: async () => [] }),
    /Supabase client required/,
  );
});
