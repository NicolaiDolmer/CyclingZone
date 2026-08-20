// Tests for marketValueSundaySweep.js (#3448)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runMarketValueSundaySweep, MARKET_VALUE_SWEEP_LOG_TABLE } from "./marketValueSundaySweep.js";

// 2026-08-09 = søndag (dansk tid). 2026-08-08 = lørdag.
const SUNDAY = new Date("2026-08-09T10:00:00Z"); // 12:00 CEST
const SATURDAY = new Date("2026-08-08T10:00:00Z"); // 12:00 CEST

const TEST_MODEL = {
  coefficients: {
    a: 5.25, b: 0.0976, c: 0.000164, d_age: 0.139, e_age2: -0.0023,
    f_potentiale: 0.235, g_popularity: -0.0185, popularity_mode: "raw", h_is_youth: -0.452,
    offset: { gc: 0.136, baroudeur: 0 },
  },
  guard: { K: 12, O_window: 5, age_window: 3 },
};

function makeSupabase({ updateCalls = [] } = {}) {
  return {
    updateCalls,
    from(table) {
      if (table === "riders") {
        return {
          update(patch) {
            return {
              eq: async (_col, id) => {
                updateCalls.push({ id, ...patch });
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`uventet tabel i test-stub: ${table}`);
    },
  };
}

function baseDeps(overrides = {}) {
  return {
    isEnabled: async () => true,
    readGlobalWeight: async () => 0.5,
    readWeeklyCap: async () => 0.25,
    loadModel: () => TEST_MODEL,
    fetchActiveSeasonNumber: async () => 1,
    fetchSaleRiderIds: async () => [],
    fetchRidersByIds: async () => new Map(),
    fetchAbilitiesByRider: async () => new Map(),
    fetchPopulation: async () => [],
    claimSweepDate: async () => ({ claimed: true, tableMissing: false }),
    completeSweepRun: async () => {},
    ...overrides,
  };
}

describe("runMarketValueSundaySweep — gates", () => {
  it("no-op på en ikke-søndag", async () => {
    const supabase = makeSupabase();
    const result = await runMarketValueSundaySweep({ supabase, now: SATURDAY, ...baseDeps() });
    assert.deepEqual(result, { ran: false, skipped: "not_sunday" });
  });

  it("no-op når kill-switch er off", async () => {
    const supabase = makeSupabase();
    const result = await runMarketValueSundaySweep({ supabase, now: SUNDAY, ...baseDeps({ isEnabled: async () => false }) });
    assert.deepEqual(result, { ran: false, skipped: "flag_off" });
  });

  it("no-op når sweepen allerede er kørt i dag (persisteret dedup)", async () => {
    const supabase = makeSupabase();
    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...baseDeps({ claimSweepDate: async () => ({ claimed: false, tableMissing: false }) }),
    });
    assert.deepEqual(result, { ran: false, skipped: "already_ran_today" });
  });

  it("no-op når dedup-tabellen ikke findes endnu (migration ikke applied)", async () => {
    const supabase = makeSupabase();
    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...baseDeps({ claimSweepDate: async () => ({ claimed: false, tableMissing: true }) }),
    });
    assert.deepEqual(result, { ran: false, skipped: "log_table_missing" });
  });

  it("no-op når der ingen aktiv sæson er", async () => {
    const supabase = makeSupabase();
    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...baseDeps({ fetchActiveSeasonNumber: async () => null }),
    });
    assert.deepEqual(result, { ran: false, skipped: "no_active_season" });
  });
});

describe("runMarketValueSundaySweep — blend + skriv", () => {
  it("beregner blended+capped base_value og skriver kun ændrede ryttere", async () => {
    const updateCalls = [];
    const supabase = makeSupabase({ updateCalls });

    // r1/r2: samme (O,alder,type) → samme support og samme markedsgæt. r1 starter
    // langt OVER markedsgættet (bevæger sig NED, loftet af cap), r2 langt UNDER
    // (bevæger sig OP, loftet af cap) — dækker begge cap-retninger i samme kørsel.
    const population = [
      { id: "r1", team_id: "t1", birthdate: "2000-01-01", popularity: 30, potentiale: 3.5, primary_type: "gc", base_value: 5_000_000 },
      { id: "r2", team_id: "t1", birthdate: "2000-01-01", popularity: 30, potentiale: 3.5, primary_type: "gc", base_value: 10_000 },
    ];
    const abilities = { climbing: 65, time_trial: 60, flat: 55, tempo: 55, sprint: 40, acceleration: 45, punch: 50, endurance: 60, recovery: 55, durability: 55, descending: 50, cobblestone: 40, aggression: 45 };
    // 15 "solgte" ryttere med SAMME (birthdate/abilities) som r1/r2 → identisk
    // (O,alder,type) → count_nearby=15 >= K(12) → support=1 for begge.
    const saleIds = Array.from({ length: 15 }, (_, i) => `s${i}`);

    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...baseDeps({
        fetchPopulation: async () => population,
        fetchAbilitiesByRider: async ({ riderIds }) => new Map(riderIds.map((id) => [id, abilities])),
        fetchSaleRiderIds: async () => saleIds,
        fetchRidersByIds: async ({ riderIds }) =>
          new Map(riderIds.map((id) => [id, { birthdate: "2000-01-01", primary_type: "gc" }])),
        completeSweepRun: async ({ sweepDate, summary }) => {
          assert.equal(sweepDate, "2026-08-09");
          assert.equal(summary.changed, updateCalls.length);
        },
      }),
    });

    assert.equal(result.ran, true);
    assert.equal(result.scanned, 2);
    assert.equal(result.changed, 2);
    assert.equal(updateCalls.length, 2);

    const r1 = updateCalls.find((c) => c.id === "r1");
    const r2 = updateCalls.find((c) => c.id === "r2");
    // cap=0.25: r1 (5M, for højt) klemmes ned til MINDST 75% af 5M; r2 (10k, for
    // lavt) klemmes op til HØJST 125% af 10k.
    assert.equal(r1.base_value, Math.round(5_000_000 * 0.75));
    assert.equal(r2.base_value, Math.round(10_000 * 1.25));
  });

  it("support=0 (tomt salesIndex) fastfryser hele populationen — ingen writes", async () => {
    const updateCalls = [];
    const supabase = makeSupabase({ updateCalls });
    const population = [
      { id: "r1", team_id: "t1", birthdate: "2000-01-01", popularity: 30, potentiale: 3.5, primary_type: "gc", base_value: 1_000_000 },
    ];
    const abilities = { climbing: 65, time_trial: 60, flat: 55, tempo: 55, sprint: 40, acceleration: 45, punch: 50, endurance: 60, recovery: 55, durability: 55, descending: 50, cobblestone: 40, aggression: 45 };

    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...baseDeps({
        fetchPopulation: async () => population,
        fetchAbilitiesByRider: async () => new Map([["r1", abilities]]),
      }),
    });

    assert.equal(result.ran, true);
    assert.equal(result.changed, 0);
    assert.equal(updateCalls.length, 0);
  });

  it("springer ryttere uden abilities/birthdate/type over (ikke en fejl)", async () => {
    const supabase = makeSupabase();
    const population = [
      { id: "r1", team_id: "t1", birthdate: null, popularity: 30, potentiale: 3.5, primary_type: "gc", base_value: 1000 },
      { id: "r2", team_id: "t1", birthdate: "2000-01-01", popularity: 30, potentiale: 3.5, primary_type: null, base_value: 1000 },
    ];
    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...baseDeps({ fetchPopulation: async () => population }),
    });
    assert.equal(result.scanned, 0);
    assert.equal(result.changed, 0);
  });

  it("log-insert-fejl vælter IKKE sweepen (værdierne er allerede skrevet)", async () => {
    const updateCalls = [];
    const supabase = makeSupabase({ updateCalls });
    const population = [
      { id: "r1", team_id: "t1", birthdate: "2000-01-01", popularity: 30, potentiale: 3.5, primary_type: "gc", base_value: 1_000_000 },
    ];
    const abilities = { climbing: 65, time_trial: 60, flat: 55, tempo: 55, sprint: 40, acceleration: 45, punch: 50, endurance: 60, recovery: 55, durability: 55, descending: 50, cobblestone: 40, aggression: 45 };

    let capturedErr = null;
    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...baseDeps({
        fetchPopulation: async () => population,
        fetchAbilitiesByRider: async () => new Map([["r1", abilities]]),
        fetchSaleRiderIds: async () => ["s1"],
        fetchRidersByIds: async () => new Map([["s1", { birthdate: "2000-01-01", primary_type: "gc" }]]),
        completeSweepRun: async () => { throw new Error("log-opsummering fejlede"); },
      }),
      captureExceptionFn: (err) => { capturedErr = err; },
    });

    assert.equal(result.ran, true); // sweepen fuldførte og returnerer stadig et resultat
    assert.ok(capturedErr instanceof Error);
  });
});

describe("MARKET_VALUE_SWEEP_LOG_TABLE", () => {
  it("eksporterer det forventede tabelnavn", () => {
    assert.equal(MARKET_VALUE_SWEEP_LOG_TABLE, "market_value_sunday_sweep_log");
  });
});

// ── Rækkefølge + påkrævet `now` (CodeRabbit-fund, PR #3449) ──────────────────
describe("runMarketValueSundaySweep — claim FØR mutation", () => {
  const ABILITIES = { climbing: 65, time_trial: 60, flat: 55, tempo: 55, sprint: 40, acceleration: 45, punch: 50, endurance: 60, recovery: 55, durability: 55, descending: 50, cobblestone: 40, aggression: 45 };
  const POPULATION = [
    { id: "r1", team_id: "t1", birthdate: "2000-01-01", popularity: 30, potentiale: 3.5, primary_type: "gc", base_value: 1_000_000 },
  ];

  function movingDeps(overrides = {}) {
    return baseDeps({
      fetchPopulation: async () => POPULATION,
      // Dækker BEGGE opslag (salesIndex + population) — ellers er salesIndex tomt,
      // support = 0 og sweepen flytter intet.
      fetchAbilitiesByRider: async ({ riderIds }) => new Map(riderIds.map((id) => [id, ABILITIES])),
      fetchSaleRiderIds: async () => Array.from({ length: 15 }, (_, i) => `s${i}`),
      fetchRidersByIds: async ({ riderIds }) =>
        new Map(riderIds.map((id) => [id, { birthdate: "2000-01-01", primary_type: "gc" }])),
      ...overrides,
    });
  }

  it("claimer dagen FØR første base_value-skrivning", async () => {
    const updateCalls = [];
    const supabase = makeSupabase({ updateCalls });
    const order = [];
    await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...movingDeps({
        claimSweepDate: async () => { order.push("claim"); return { claimed: true, tableMissing: false }; },
        completeSweepRun: async () => { order.push("complete"); },
      }),
    });
    assert.ok(updateCalls.length > 0, "testen skal faktisk flytte mindst én værdi");
    assert.deepEqual(order, ["claim", "complete"]);
    // Claim'et skal ligge før skrivningerne, ikke bare før opsummeringen.
    assert.equal(order[0], "claim");
  });

  it("muterer INTET når dagen allerede er claimet af en anden proces", async () => {
    const updateCalls = [];
    const supabase = makeSupabase({ updateCalls });
    let completed = 0;
    const result = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...movingDeps({
        claimSweepDate: async () => ({ claimed: false, tableMissing: false }),
        completeSweepRun: async () => { completed++; },
      }),
    });
    assert.deepEqual(result, { ran: false, skipped: "already_ran_today" });
    assert.equal(updateCalls.length, 0, "en tabt claim må ikke føre til nogen skrivning");
    assert.equal(completed, 0);
  });

  it("en fejlet opsummering låser stadig dagen — næste tick muterer ikke igen", async () => {
    // Regression mod dobbelt cap-anvendelse: claim'et er skrevet, så tick 2
    // taber claim'et og rører ingenting, selvom tick 1's completeSweepRun fejlede.
    const updateCalls = [];
    const supabase = makeSupabase({ updateCalls });
    let claimed = false;
    const claimSweepDate = async () => {
      if (claimed) return { claimed: false, tableMissing: false };
      claimed = true;
      return { claimed: true, tableMissing: false };
    };

    const first = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...movingDeps({ claimSweepDate, completeSweepRun: async () => { throw new Error("opsummering fejlede"); } }),
      captureExceptionFn: () => {},
    });
    assert.equal(first.ran, true);
    const writesAfterFirst = updateCalls.length;
    assert.ok(writesAfterFirst > 0);

    const second = await runMarketValueSundaySweep({
      supabase, now: SUNDAY,
      ...movingDeps({ claimSweepDate, completeSweepRun: async () => {} }),
    });
    assert.deepEqual(second, { ran: false, skipped: "already_ran_today" });
    assert.equal(updateCalls.length, writesAfterFirst, "loftet må ikke kunne anvendes to gange samme søndag");
  });
});

describe("runMarketValueSundaySweep — `now` er påkrævet", () => {
  it("kaster hvis `now` udelades (AGENTS.md hard rule 16)", async () => {
    const supabase = makeSupabase();
    await assert.rejects(
      () => runMarketValueSundaySweep({ supabase, ...baseDeps() }),
      /eksplicit `now`/
    );
  });

  it("kaster på et ugyldigt Date-objekt", async () => {
    const supabase = makeSupabase();
    await assert.rejects(
      () => runMarketValueSundaySweep({ supabase, now: new Date("ikke-en-dato"), ...baseDeps() }),
      /eksplicit `now`/
    );
  });
});
