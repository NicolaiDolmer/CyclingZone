import test from "node:test";
import assert from "node:assert/strict";

import { findStaleOfferedIntake, runAcademyIntakeReconcile } from "./academyIntakeReconcile.js";

// In-memory mock af de to tabeller scriptet rører:
//   academy_intake: select("id, team_id, rider_id").eq("status","offered").order().range()
//                   update({status,resolved_at}).eq("id",x).eq("status","offered").select()
//   riders:         select("id, team_id").in("id",[...]).order().range()
function makeMock({ intake, riders }) {
  // Muterer intake-arrayet ved update, så idempotens kan testes på tværs af kald.
  const intakeRows = intake;
  return {
    from(table) {
      if (table === "academy_intake") {
        const eqFilters = [];
        let mode = "select";
        let patch = null;
        const b = {
          select() { return b; },
          update(p) { mode = "update"; patch = p; return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          order() { return b; },
          range(from, to) {
            // Kun læse-stien paginerer.
            let out = intakeRows.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            out = out.slice(from, to + 1);
            return Promise.resolve({
              data: out.map((r) => ({ id: r.id, team_id: r.team_id, rider_id: r.rider_id })),
              error: null,
            });
          },
          // update().eq().eq().select() returnerer en thenable (ingen .range()).
          then(resolve, reject) {
            if (mode !== "update") {
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            }
            const matched = intakeRows.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            for (const r of matched) Object.assign(r, patch);
            return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
          },
        };
        return b;
      }
      if (table === "riders") {
        let inIds = null;
        const b = {
          select() { return b; },
          in(_col, ids) { inIds = ids; return b; },
          order() { return b; },
          range(from, to) {
            let out = riders.filter((r) => (inIds ? inIds.includes(r.id) : true));
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out.map((r) => ({ id: r.id, team_id: r.team_id })), error: null });
          },
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("#1756 findStale: ejet af SAMME hold → signed; ejet af ANDET hold → rejected; fri rytter ignoreres", async () => {
  const intake = [
    { id: "i-same", team_id: "team-A", rider_id: "r-1", status: "offered" },   // ejet af team-A → signed
    { id: "i-other", team_id: "team-A", rider_id: "r-2", status: "offered" },  // ejet af team-B → rejected
    { id: "i-free", team_id: "team-A", rider_id: "r-3", status: "offered" },   // rytter fri → ignoreret
  ];
  const riders = [
    { id: "r-1", team_id: "team-A" },
    { id: "r-2", team_id: "team-B" },
    { id: "r-3", team_id: null },
  ];
  const plan = await findStaleOfferedIntake(makeMock({ intake, riders }));
  assert.equal(plan.length, 2, "kun de 2 ejede rækker er stale");
  const byId = Object.fromEntries(plan.map((p) => [p.intakeId, p]));
  assert.equal(byId["i-same"].targetStatus, "signed");
  assert.equal(byId["i-other"].targetStatus, "rejected");
  assert.ok(!byId["i-free"], "fri rytter ikke i planen");
});

test("#1756 reconcile dry-run: rapporterer plan, skriver intet", async () => {
  const intake = [
    { id: "i1", team_id: "team-A", rider_id: "r-1", status: "offered" },
    { id: "i2", team_id: "team-A", rider_id: "r-2", status: "offered" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A" }, // signed
    { id: "r-2", team_id: "team-B" }, // rejected
  ];
  const res = await runAcademyIntakeReconcile({ supabase: makeMock({ intake, riders }), dryRun: true, log: () => {} });
  assert.equal(res.dryRun, true);
  assert.equal(res.stale, 2);
  assert.equal(res.signed, 1);
  assert.equal(res.rejected, 1);
  assert.equal(res.updated, 0, "dry-run skriver intet");
  // Intet flippet i mock-tabellen.
  assert.equal(intake.find((r) => r.id === "i1").status, "offered");
});

test("#1756 reconcile live: flipper status + sætter resolved_at, og er idempotent ved re-run", async () => {
  const intake = [
    { id: "i1", team_id: "team-A", rider_id: "r-1", status: "offered" },
    { id: "i2", team_id: "team-A", rider_id: "r-2", status: "offered" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A" }, // → signed
    { id: "r-2", team_id: "team-B" }, // → rejected
  ];
  const now = () => new Date("2026-06-23T09:00:00Z");
  const mock = makeMock({ intake, riders });

  const res = await runAcademyIntakeReconcile({ supabase: mock, dryRun: false, now, log: () => {} });
  assert.equal(res.updated, 2);
  assert.equal(intake.find((r) => r.id === "i1").status, "signed");
  assert.equal(intake.find((r) => r.id === "i2").status, "rejected");
  assert.equal(intake.find((r) => r.id === "i1").resolved_at, "2026-06-23T09:00:00.000Z");

  // Re-run: ingen 'offered'-rækker tilbage → no-op.
  const res2 = await runAcademyIntakeReconcile({ supabase: mock, dryRun: false, now, log: () => {} });
  assert.equal(res2.stale, 0);
  assert.equal(res2.updated, 0);
});

test("#1756 reconcile: tom tabel → idempotent no-op", async () => {
  const res = await runAcademyIntakeReconcile({ supabase: makeMock({ intake: [], riders: [] }), dryRun: false, log: () => {} });
  assert.equal(res.stale, 0);
  assert.equal(res.updated, 0);
  assert.deepEqual(res.plan, []);
});

test("#1756 findStale: kræver supabase-klient", async () => {
  await assert.rejects(() => findStaleOfferedIntake({}), /Supabase client required/);
});
