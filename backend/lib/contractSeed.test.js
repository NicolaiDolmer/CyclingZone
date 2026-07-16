import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT,
  computeFrozenSalary,
  pickContractLength,
  computeContractEndSeason,
  contractOnAcquirePatch,
  computeReleaseBuyoutFee,
  computeContractExtension,
  runContractSeed,
} from "./contractSeed.js";
import { makeRng } from "./fictionalRiderGenerator.js";

test("computeFrozenSalary = strict_fair_v1 rate (0.067)", () => {
  // E2: GREATEST(1, ROUND((COALESCE(base_value,1000)+prize)*0.067))
  assert.equal(computeFrozenSalary({ base_value: 1_000_000, prize_earnings_bonus: 0 }), 67_000);
  assert.equal(computeFrozenSalary({ base_value: 50_000, prize_earnings_bonus: 5_000 }), 3_685);
  // NULL/0 base_value → fallback 1000 → salary 67
  assert.equal(computeFrozenSalary({ base_value: null, prize_earnings_bonus: 0 }), 67);
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
  assert.equal(CONTRACT.SALARY_RATE, 0.067);
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
  assert.equal(patch.salary, 67_000); // 6.7% af 1_000_000
  assert.equal(patch.contract_end_season, 2); // 1 + 2 - 1
});

test("contractOnAcquirePatch: undefined salary behandles som kontraktløs (free agent)", () => {
  const patch = contractOnAcquirePatch({ base_value: 50_000, prize_earnings_bonus: 5_000 }, 3);
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.salary, 3_685); // 6.7% af (50_000 + 5_000)
  assert.equal(patch.contract_end_season, 4); // 3 + 2 - 1
});

test("contractOnAcquirePatch: kontraktløs + NULL base_value → fallback salary 100", () => {
  const patch = contractOnAcquirePatch({ salary: null, base_value: null }, 1);
  assert.equal(patch.salary, 67);
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.contract_end_season, 2);
});

// ── computeReleaseBuyoutFee (#1719) ─────────────────────────────────────────
// Buyout-gebyr (ejer-besluttet): round(salary * max(1, contract_end_season -
// current_season + 1) * 0.5). Manageren betaler en halv sæson-løn pr.
// resterende sæson på kontrakten (mindst 1 sæson, så gebyret aldrig bliver 0
// for en udløbet/samme-sæson-kontrakt med løn).

test("computeReleaseBuyoutFee: 0.5 * salary * resterende sæsoner (mindst 1)", () => {
  // 3 resterende sæsoner (end=5, current=3 → 5-3+1=3): 100k * 3 * 0.5 = 150k
  assert.equal(computeReleaseBuyoutFee({ salary: 100_000, contractEndSeason: 5, currentSeason: 3 }), 150_000);
  // 1 resterende (end=3, current=3 → 1): 100k * 1 * 0.5 = 50k
  assert.equal(computeReleaseBuyoutFee({ salary: 100_000, contractEndSeason: 3, currentSeason: 3 }), 50_000);
  // 2 resterende (end=4, current=3 → 2): 80k * 2 * 0.5 = 80k
  assert.equal(computeReleaseBuyoutFee({ salary: 80_000, contractEndSeason: 4, currentSeason: 3 }), 80_000);
});

test("computeReleaseBuyoutFee: udløbet/forbi kontrakt → gulv på 1 sæson (max(1, ...))", () => {
  // end < current → resterende ville være <=0, men max(1,...) gør den til 1 sæson.
  assert.equal(computeReleaseBuyoutFee({ salary: 60_000, contractEndSeason: 2, currentSeason: 4 }), 30_000);
  // end == current-1 (lige udløbet): 60k * 1 * 0.5 = 30k
  assert.equal(computeReleaseBuyoutFee({ salary: 60_000, contractEndSeason: 3, currentSeason: 4 }), 30_000);
});

test("computeReleaseBuyoutFee: NULL/manglende felter → robust (0-salary → 0 gebyr)", () => {
  assert.equal(computeReleaseBuyoutFee({ salary: 0, contractEndSeason: 5, currentSeason: 1 }), 0);
  assert.equal(computeReleaseBuyoutFee({ salary: null, contractEndSeason: null, currentSeason: 1 }), 0);
  // manglende contract_end_season → behandles som 1 resterende sæson (gulvet)
  assert.equal(computeReleaseBuyoutFee({ salary: 40_000, contractEndSeason: null, currentSeason: 2 }), 20_000);
});

test("computeReleaseBuyoutFee: rundes til nærmeste heltal", () => {
  // 33_333 * 1 * 0.5 = 16_666.5 → round → 16_667
  assert.equal(computeReleaseBuyoutFee({ salary: 33_333, contractEndSeason: 1, currentSeason: 1 }), 16_667);
});

// ── computeContractExtension (#1720) ────────────────────────────────────────
// Forlæng kontrakten 1 sæson + genforhandl lønnen fra rytterens aktuelle
// markedsværdi (samme SALARY_RATE-formel som signering). contract_end_season
// +1, contract_length +1 (eller min 1 hvis NULL).

test("computeContractExtension: ny løn fra market_value, end+1, length+1", () => {
  const next = computeContractExtension({
    market_value: 1_000_000,
    contract_end_season: 4,
    contract_length: 2,
  });
  assert.equal(next.salary, 67_000); // 6.7% af 1_000_000 (= computeFrozenSalary)
  assert.equal(next.contract_end_season, 5); // 4 + 1
  assert.equal(next.contract_length, 3); // 2 + 1
});

test("computeContractExtension: bruger base_value+prize hvis market_value mangler", () => {
  const next = computeContractExtension({
    base_value: 50_000,
    prize_earnings_bonus: 5_000,
    contract_end_season: 2,
    contract_length: 1,
  });
  assert.equal(next.salary, 3_685); // 6.7% af (50_000 + 5_000)
  assert.equal(next.contract_end_season, 3);
  assert.equal(next.contract_length, 2);
});

test("computeContractExtension: NULL contract-felter → end baseres på currentSeason, length=1", () => {
  // Kontraktløs/NULL end: forlængelsen forankres i currentSeason så den nye
  // udløbssæson altid ligger i fremtiden (currentSeason + 1).
  const next = computeContractExtension({
    market_value: 200_000,
    contract_end_season: null,
    contract_length: null,
    currentSeason: 3,
  });
  assert.equal(next.salary, 13_400); // 6.7% af 200_000
  assert.equal(next.contract_end_season, 4); // currentSeason(3) + 1
  assert.equal(next.contract_length, 1);
});

test("computeContractExtension: udløbet kontrakt forlænges fra currentSeason, ikke fortid", () => {
  // end(2) < currentSeason(5): forlæng fra current, ikke fra fortidens end.
  const next = computeContractExtension({
    market_value: 100_000,
    contract_end_season: 2,
    contract_length: 2,
    currentSeason: 5,
  });
  assert.equal(next.contract_end_season, 6); // max(end, currentSeason) + 1 = 5 + 1
  assert.equal(next.contract_length, 3);
});

// #2424: prod-log viste 5× 23514 riders_contract_length_check-violations fra
// gentagne extend-contract-kald på ryttere allerede på MAX_LENGTH(3).
// contract_length må ALDRIG overskride constraintets loft, uanset hvor mange
// gange forlængelsen kaldes.
test("computeContractExtension: allerede på MAX_LENGTH(3) → clampes, crasher IKKE riders_contract_length_check", () => {
  const next = computeContractExtension({
    market_value: 100_000,
    contract_end_season: 4,
    contract_length: 3,
    currentSeason: 4,
  });
  assert.equal(next.contract_length, 3); // clamped, ikke 4
  assert.equal(next.contract_end_season, 5); // end-sæson rykker stadig frem
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

  // Founder r1: length=2, end=2, salary=67_000 (6.7% af 1_000_000)
  assert.equal(byId.r1.contract_length, 2);
  assert.equal(byId.r1.contract_end_season, 2);
  assert.equal(byId.r1.salary, 67_000);

  // Founder r2: length=2, end=2, salary=13_400 (6.7% af 200_000)
  assert.equal(byId.r2.contract_length, 2);
  assert.equal(byId.r2.contract_end_season, 2);
  assert.equal(byId.r2.salary, 13_400);

  // Non-founder r3: length 1-3, end = 1 + length - 1, salary=33_500 (6.7% af 500_000)
  assert.ok(byId.r3.contract_length >= 1 && byId.r3.contract_length <= 3,
    `r3 length=${byId.r3.contract_length} ude af 1-3`);
  assert.equal(byId.r3.contract_end_season, byId.r3.contract_length); // = 1 + length - 1
  assert.equal(byId.r3.salary, 33_500);
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
