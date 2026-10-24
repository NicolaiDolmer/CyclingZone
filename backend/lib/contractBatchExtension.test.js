// #6855: batch-forlængelse af kontrakter. Dækker issuets test-krav:
// batch = N x enkelt, loftet (nu+3, "2 (maks)"), lønloft-afvisning på samlet
// lønsum, alt-eller-intet, og at contract_length clampes til MAX_LENGTH.
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeBatchItems,
  planRiderExtension,
  planBatchExtension,
  quoteBatchExtension,
  applyBatchExtension,
  MAX_BATCH_RIDERS,
} from "./contractBatchExtension.js";
import { CONTRACT, computeContractExtension, maxAllowedContractEndSeason } from "./contractSeed.js";

const TEAM = "team-A";
const OTHER = "team-B";

function rider(overrides = {}) {
  return {
    id: "r1",
    firstname: "Rider",
    lastname: "One",
    team_id: TEAM,
    is_retired: false,
    salary: 100,
    current_production_value: 50_000,
    contract_length: 1,
    contract_end_season: 4,
    ...overrides,
  };
}

// Kør enkelt-forlængelsen N gange som POST /riders/:id/extend-contract gør:
// én computeContractExtension pr. kald, rytteren gemt imellem, afvist ved loftet.
function singleExtensionsInARow(r, n, currentSeason) {
  let state = { ...r };
  let done = 0;
  for (let i = 0; i < n; i += 1) {
    const next = computeContractExtension({ ...state, currentSeason });
    if (next.contract_end_season > maxAllowedContractEndSeason(currentSeason)) break;
    state = { ...state, ...next };
    done += 1;
  }
  return { state, done };
}

// ── Lille in-memory Supabase-mock (kun de kæder modulet bruger) ─────────────
function makeDb({ riders = [], season = 4, consequences = [], failUpdateFor = null, onUpdate = null } = {}) {
  const tables = {
    riders: riders.map((r) => ({ ...r })),
    seasons: [{ number: season, status: "active" }],
    board_consequences: consequences.map((c) => ({ ...c })),
  };
  const updates = [];

  function builder(table) {
    const filters = [];
    let patch = null;
    const match = (row) => filters.every((f) => f(row));
    const api = {
      select() { return api; },
      limit() { return api; },
      eq(col, val) { filters.push((row) => row[col] === val); return api; },
      is(col, val) { filters.push((row) => (row[col] ?? null) === val); return api; },
      in(col, vals) { filters.push((row) => vals.includes(row[col])); return api; },
      update(p) { patch = p; return api; },
      maybeSingle() {
        const rows = tables[table].filter(match);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() { return api.maybeSingle(); },
      then(resolve, reject) {
        try {
          const rows = tables[table].filter(match);
          if (patch) {
            if (failUpdateFor && rows.some((r) => r.id === failUpdateFor) && patch.contract_end_season !== undefined) {
              // Simulér at rytteren skiftede tilstand: ingen række matcher.
              resolve({ data: [], error: null });
              return;
            }
            for (const row of rows) Object.assign(row, patch);
            updates.push({ table, patch, ids: rows.map((r) => r.id) });
            const ids = rows.map((r) => ({ id: r.id }));
            if (onUpdate) for (const row of rows) onUpdate(row);
            resolve({ data: ids, error: null });
            return;
          }
          resolve({ data: rows.map((r) => ({ ...r })), error: null });
        } catch (err) {
          reject(err);
        }
      },
    };
    return api;
  }

  return {
    from: (table) => builder(table),
    tables,
    updates,
  };
}

const noCap = { assertSalaryIncreaseAllowed: async () => null, getActiveConsequencesForTeam: async () => [] };

// ── normalizeBatchItems ─────────────────────────────────────────────────────
test("normalizeBatchItems: accepterer {items} og bar liste, afviser tom/dublet/ugyldig", () => {
  assert.deepEqual(normalizeBatchItems({ items: [{ riderId: "a", seasons: 2 }] }).items, [{ riderId: "a", seasons: 2 }]);
  assert.deepEqual(normalizeBatchItems([{ riderId: "a", seasons: 1 }]).items, [{ riderId: "a", seasons: 1 }]);
  assert.equal(normalizeBatchItems({ items: [] }).error.errorCode, "contract_batch_empty");
  assert.equal(normalizeBatchItems({}).error.errorCode, "contract_batch_empty");
  assert.equal(normalizeBatchItems({ items: [{ riderId: "a", seasons: 1 }, { riderId: "a", seasons: 2 }] }).error.errorCode, "contract_batch_duplicate");
  assert.equal(normalizeBatchItems({ items: [{ riderId: "a", seasons: 0 }] }).error.errorCode, "contract_batch_invalid");
  assert.equal(normalizeBatchItems({ items: [{ riderId: "a", seasons: CONTRACT.MAX_EXTENSION_SEASONS_AHEAD + 1 }] }).error.errorCode, "contract_batch_invalid");
  assert.equal(normalizeBatchItems({ items: [{ riderId: "a", seasons: 1.5 }] }).error.errorCode, "contract_batch_invalid");
  assert.equal(normalizeBatchItems({ items: [{ seasons: 1 }] }).error.errorCode, "contract_batch_invalid");
  const tooMany = Array.from({ length: MAX_BATCH_RIDERS + 1 }, (_, i) => ({ riderId: `r${i}`, seasons: 1 }));
  assert.equal(normalizeBatchItems({ items: tooMany }).error.errorCode, "contract_batch_too_large");
});

// ── batch = N x enkelt ───────────────────────────────────────────────────────
test("batch = N x enkelt: samme løn, udløbssæson og længde som N enkelt-forlængelser", () => {
  const currentSeason = 4;
  const cases = [
    rider({ contract_end_season: 4, contract_length: 1 }),
    rider({ contract_end_season: 5, contract_length: 2, salary: 900 }),
    rider({ contract_end_season: null, contract_length: null, salary: null }),
    rider({ contract_end_season: 2, contract_length: 3 }), // udløbet, allerede MAX_LENGTH
  ];
  for (const r of cases) {
    for (let n = 1; n <= CONTRACT.MAX_EXTENSION_SEASONS_AHEAD; n += 1) {
      const single = singleExtensionsInARow(r, n, currentSeason);
      const { plan, error } = planRiderExtension(r, n, currentSeason);
      if (single.done === 0) {
        assert.ok(error, `forventede loft-fejl for ${JSON.stringify(r)} n=${n}`);
        continue;
      }
      assert.equal(plan.grantedSeasons, single.done);
      assert.equal(plan.newSalary, single.state.salary);
      assert.equal(plan.newEndSeason, single.state.contract_end_season);
      assert.equal(plan.newLength, single.state.contract_length);
    }
  }
});

test("contract_length clampes til MAX_LENGTH ved flere sæsoner", () => {
  const { plan } = planRiderExtension(rider({ contract_end_season: 4, contract_length: 2 }), 3, 4);
  assert.equal(plan.newLength, CONTRACT.MAX_LENGTH);
  assert.equal(plan.newEndSeason, 7);
});

// ── loftet ──────────────────────────────────────────────────────────────────
test("loft: beder om 3, kan kun få 2 -> får 2 og markeres capped (UI: '2 (maks)')", () => {
  const { plan } = planRiderExtension(rider({ contract_end_season: 5 }), 3, 4);
  assert.equal(plan.grantedSeasons, 2);
  assert.equal(plan.requestedSeasons, 3);
  assert.equal(plan.capped, true);
  assert.equal(plan.maxSeasons, 2);
  assert.equal(plan.newEndSeason, maxAllowedContractEndSeason(4));
});

test("loft: rytter ved loftet afvises med samme fejlkode som enkelt-forlængelsen", () => {
  const { error } = planRiderExtension(rider({ contract_end_season: 7 }), 1, 4);
  assert.equal(error.errorCode, "contract_extension_cap_reached");
  assert.deepEqual(error.errorParams, { maxSeason: 7 });
});

test("planBatchExtension: fremmed og pensioneret rytter giver fejl pr. rytter, summer kun over gyldige", () => {
  const riders = [
    rider({ id: "a", salary: 100 }),
    rider({ id: "b", team_id: OTHER }),
    rider({ id: "c", is_retired: true }),
  ];
  const items = [{ riderId: "a", seasons: 1 }, { riderId: "b", seasons: 1 }, { riderId: "c", seasons: 1 }, { riderId: "zz", seasons: 1 }];
  const result = planBatchExtension({ riders, items, teamId: TEAM, currentSeason: 4 });
  assert.equal(result.plans.length, 1);
  assert.deepEqual(result.errors.map((e) => [e.riderId, e.errorCode]), [
    ["b", "rider_not_owned"], ["c", "rider_retired"], ["zz", "rider_not_owned"],
  ]);
  assert.equal(result.oldSalarySum, 100);
});

// ── quote ───────────────────────────────────────────────────────────────────
test("quote: skriver intet, viser lønsum før/efter for hold og valgte", async () => {
  const db = makeDb({ riders: [rider({ id: "a", salary: 100 }), rider({ id: "b", salary: 300, contract_end_season: 6 }), rider({ id: "x", salary: 1000 })] });
  const res = await quoteBatchExtension({ supabase: db, teamId: TEAM, body: { items: [{ riderId: "a", seasons: 2 }, { riderId: "b", seasons: 3 }] }, deps: noCap });
  assert.equal(res.status, 200);
  assert.equal(db.updates.length, 0);
  const newA = computeContractExtension({ ...rider(), currentSeason: 4 }).salary;
  assert.equal(res.body.totals.selectedSalaryBefore, 400);
  assert.equal(res.body.totals.selectedSalaryAfter, newA * 2);
  assert.equal(res.body.totals.teamSalaryBefore, 1400);
  assert.equal(res.body.totals.teamSalaryAfter, 1400 - 400 + newA * 2);
  const b = res.body.riders.find((r) => r.riderId === "b");
  assert.equal(b.grantedSeasons, 1);
  assert.equal(b.capped, true);
  assert.deepEqual(res.body.salaryCap, { active: false, withinCap: true, cap: null });
});

test("quote: ugyldig krop -> 400", async () => {
  const db = makeDb();
  const res = await quoteBatchExtension({ supabase: db, teamId: TEAM, body: { items: [] }, deps: noCap });
  assert.equal(res.status, 400);
});

// ── lønloft ─────────────────────────────────────────────────────────────────
test("lønloft: tjekkes på SAMLET lønsum for de valgte, afvisning skriver intet", async () => {
  const db = makeDb({ riders: [rider({ id: "a", salary: 10 }), rider({ id: "b", salary: 10 })] });
  const calls = [];
  const deps = {
    assertSalaryIncreaseAllowed: async (args) => {
      calls.push(args);
      return { code: "board_salary_cap", layer: 2, threshold: 5000, reason: "cap" };
    },
    getActiveConsequencesForTeam: async () => [{ layer: 2, severity: 5000 }],
  };
  const items = [{ riderId: "a", seasons: 1 }, { riderId: "b", seasons: 1 }];
  const res = await applyBatchExtension({ supabase: db, teamId: TEAM, body: { items }, deps });
  assert.equal(res.status, 403);
  assert.equal(res.body.errorCode, "contract_batch_salary_cap");
  assert.deepEqual(res.body.errorParams, { cap: 5000 });
  assert.equal(db.updates.length, 0);
  assert.equal(calls.length, 1);
  const newSalary = computeContractExtension({ ...rider(), currentSeason: 4 }).salary;
  assert.equal(calls[0].oldSalary, 20);
  assert.equal(calls[0].newSalary, newSalary * 2);

  const quote = await quoteBatchExtension({ supabase: db, teamId: TEAM, body: { items }, deps });
  assert.deepEqual(quote.body.salaryCap, { active: true, withinCap: false, cap: 5000 });
});

// ── skrivning: alt eller intet ──────────────────────────────────────────────
test("apply: skriver alle ryttere med samme tal som quote", async () => {
  const db = makeDb({ riders: [rider({ id: "a" }), rider({ id: "b", contract_end_season: 5, contract_length: 2 })] });
  const items = [{ riderId: "a", seasons: 3 }, { riderId: "b", seasons: 1 }];
  const quote = await quoteBatchExtension({ supabase: db, teamId: TEAM, body: { items }, deps: noCap });
  const res = await applyBatchExtension({ supabase: db, teamId: TEAM, body: { items }, deps: noCap });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  const a = db.tables.riders.find((r) => r.id === "a");
  const b = db.tables.riders.find((r) => r.id === "b");
  const qa = quote.body.riders.find((r) => r.riderId === "a");
  assert.equal(a.contract_end_season, qa.newEndSeason);
  assert.equal(a.contract_end_season, 7);
  assert.equal(a.contract_length, CONTRACT.MAX_LENGTH);
  assert.equal(a.salary, qa.newSalary);
  assert.equal(b.contract_end_season, 6);
  assert.equal(b.contract_length, 3);
});

test("apply: én rytter ved loftet -> hele batchen afvises med fejl pr. rytter, intet skrevet", async () => {
  const db = makeDb({ riders: [rider({ id: "a" }), rider({ id: "b", contract_end_season: 7 })] });
  const res = await applyBatchExtension({ supabase: db, teamId: TEAM, body: { items: [{ riderId: "a", seasons: 1 }, { riderId: "b", seasons: 1 }] }, deps: noCap });
  assert.equal(res.status, 409);
  assert.equal(res.body.errorCode, "contract_batch_rejected");
  assert.deepEqual(res.body.errors.map((e) => e.riderId), ["b"]);
  assert.equal(db.updates.length, 0);
  assert.equal(db.tables.riders.find((r) => r.id === "a").contract_end_season, 4);
});

test("apply: rytter der skifter tilstand under skrivningen -> allerede skrevne rulles tilbage", async () => {
  const db = makeDb({
    riders: [rider({ id: "a", salary: 100 }), rider({ id: "b", salary: null, contract_end_season: null, contract_length: null })],
    failUpdateFor: "b",
  });
  const res = await applyBatchExtension({ supabase: db, teamId: TEAM, body: { items: [{ riderId: "a", seasons: 2 }, { riderId: "b", seasons: 1 }] }, deps: noCap });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body.errors, [{ riderId: "b", errorCode: "rider_state_changed" }]);
  const a = db.tables.riders.find((r) => r.id === "a");
  assert.equal(a.salary, 100);
  assert.equal(a.contract_end_season, 4);
  assert.equal(a.contract_length, 1);
});

test("apply: gentaget kald planlægger fra den nye tilstand, aldrig fra den gamle", async () => {
  const db = makeDb({ riders: [rider({ id: "a" })] });
  const body = { items: [{ riderId: "a", seasons: 1 }] };
  const first = await applyBatchExtension({ supabase: db, teamId: TEAM, body, deps: noCap });
  assert.equal(first.status, 200);
  assert.equal(db.tables.riders[0].contract_end_season, 5);
  // Andet kald planlægger ud fra den NYE tilstand (5 -> 6), aldrig fra den gamle.
  const second = await applyBatchExtension({ supabase: db, teamId: TEAM, body, deps: noCap });
  assert.equal(second.status, 200);
  assert.equal(db.tables.riders[0].contract_end_season, 6);
});

test("apply: kan tilbagerulningen ikke gennemføres (samtidig ændring), siges det ærligt med de berørte ryttere", async () => {
  let interfered = false;
  const db = makeDb({
    riders: [rider({ id: "a" }), rider({ id: "b" })],
    failUpdateFor: "b",
    // En anden forespørgsel forlænger a igen lige efter vores skrivning.
    onUpdate: (row) => { if (row.id === "a" && !interfered) { interfered = true; row.contract_end_season = 6; } },
  });
  const res = await applyBatchExtension({ supabase: db, teamId: TEAM, body: { items: [{ riderId: "a", seasons: 1 }, { riderId: "b", seasons: 1 }] }, deps: noCap });
  assert.equal(res.status, 409);
  assert.equal(res.body.errorCode, "contract_batch_partial");
  assert.deepEqual(res.body.errors.map((e) => [e.riderId, e.errorCode]), [["b", "rider_state_changed"], ["a", "contract_batch_partial"]]);
  assert.ok(res.writeError, "logges til Sentry via routen");
});
