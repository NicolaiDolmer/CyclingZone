// #2581 (genåbnet 19/7) — unit-tests for scoutReportVisibility.js. Tidligere blev
// denne fil kun dækket indirekte via scoutAssignmentService.test.js's getScoutState-
// integrationstests. Denne fil dækker isRiderHiddenFromReport + hydrateCompletedVisibility
// direkte, med fokus på den NYE owner_is_ai-diskriminator (AI-holds ryttere er skjulte
// for spillere i RidersPage men var ikke udelukket fra spejder-rapporter, jf. #2581).
import test from "node:test";
import assert from "node:assert/strict";

import { isRiderHiddenFromReport, hydrateCompletedVisibility } from "./scoutReportVisibility.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Minimal chainable mock, mirror af scoutAssignmentService.test.js' createScoutSupabase
// riders/academy_intake-gren: select().eq()?.in().
function makeSupabase({ riders = [], academyIntake = [] } = {}) {
  const state = { riders: clone(riders), academyIntake: clone(academyIntake) };
  return {
    state,
    from(table) {
      if (table === "riders") {
        return {
          select() {
            const filters = [];
            const chain = {
              eq(col, val) { filters.push([col, val]); return chain; },
              in(col, vals) {
                const rows = state.riders
                  .filter((r) => vals.includes(r[col]))
                  .filter((r) => filters.every(([c, v]) => r[c] === v));
                return Promise.resolve({ data: clone(rows), error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === "academy_intake") {
        return {
          select() {
            const filters = [];
            const chain = {
              eq(col, val) { filters.push([col, val]); return chain; },
              in(col, vals) {
                const rows = state.academyIntake
                  .filter((r) => vals.includes(r[col]))
                  .filter((r) => filters.every(([c, v]) => r[c] === v));
                return Promise.resolve({ data: clone(rows), error: null });
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// ─── isRiderHiddenFromReport ───────────────────────────────────────────────

test("isRiderHiddenFromReport: owner_is_ai=true skjuler rytteren (#2581)", () => {
  assert.equal(
    isRiderHiddenFromReport({ teamId: "team-9", pendingTeamId: null, isAcademy: false, hasOpenIntakeOffer: false, ownerIsAi: true }),
    true,
  );
});

test("isRiderHiddenFromReport: owner_is_ai=false + ingen pending + intet åbent tilbud = synlig", () => {
  assert.equal(
    isRiderHiddenFromReport({ teamId: "team-9", pendingTeamId: null, isAcademy: false, hasOpenIntakeOffer: false, ownerIsAi: false }),
    false,
  );
});

test("isRiderHiddenFromReport: free agent (owner_is_ai=false, ingen hold) er synlig", () => {
  assert.equal(
    isRiderHiddenFromReport({ teamId: null, pendingTeamId: null, isAcademy: false, hasOpenIntakeOffer: false, ownerIsAi: false }),
    false,
  );
});

test("isRiderHiddenFromReport: pending_team_id skjuler stadig uanset owner_is_ai", () => {
  assert.equal(
    isRiderHiddenFromReport({ teamId: null, pendingTeamId: "team-9", isAcademy: false, hasOpenIntakeOffer: false, ownerIsAi: false }),
    true,
  );
});

test("isRiderHiddenFromReport: åbent akademi-intake-tilbud skjuler stadig uanset owner_is_ai", () => {
  assert.equal(
    isRiderHiddenFromReport({ teamId: null, pendingTeamId: null, isAcademy: false, hasOpenIntakeOffer: true, ownerIsAi: false }),
    true,
  );
});

// ─── hydrateCompletedVisibility ─────────────────────────────────────────────

test("hydrateCompletedVisibility: fjerner AI-ejet rytter fra mission-shortlist + nuller top_rider_id (#2581)", async () => {
  const completed = [{
    id: "m1", kind: "mission", status: "completed",
    result: { shortlist: ["rider-ai", "rider-human"], top_rider_id: "rider-ai" },
  }];
  const riders = [
    { id: "rider-ai", team_id: "team-9", pending_team_id: null, is_academy: false, owner_is_ai: true, team: { name: "AI FC" } },
    { id: "rider-human", team_id: "team-42", pending_team_id: null, is_academy: false, owner_is_ai: false, team: { name: "FC Nordkyst" } },
  ];
  const supabase = makeSupabase({ riders });
  const [mission] = await hydrateCompletedVisibility(supabase, completed);
  assert.deepEqual(mission.result.shortlist, ["rider-human"]);
  assert.equal(mission.result.top_rider_id, null); // topfundet VAR den AI-ejede rytter
  assert.deepEqual(mission.riderStatus, { "rider-human": { status: "team", teamName: "FC Nordkyst" } });
});

test("hydrateCompletedVisibility: target-rapport skjuler rider_id hvis rytteren er AI-ejet", async () => {
  const completed = [{
    id: "t1", kind: "target", status: "completed",
    rider_id: "rider-ai", result: { level: 2 },
  }];
  const riders = [
    { id: "rider-ai", team_id: "team-9", pending_team_id: null, is_academy: false, owner_is_ai: true, team: null },
  ];
  const supabase = makeSupabase({ riders });
  const [target] = await hydrateCompletedVisibility(supabase, completed);
  assert.equal(target.rider_id, null);
  assert.deepEqual(target.riderStatus, {});
});
