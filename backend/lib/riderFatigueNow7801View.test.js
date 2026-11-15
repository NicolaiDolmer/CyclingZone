// #7801 rest-byg: visningens samlede opslag (teamFatigueNowForSurface, raceFatigueNowForSurface)
// giver præcis samme tal som motorens kerne (ridersWithFatigueNow + loadMedicalBonusByTeam),
// også i lægeafdelingens hjørner, som dommerens verdener ikke rammer: læge uden evne-række
// (afledt profil), to læger, læge uden afdeling og afdeling uden læge. Kun lighed prøves; intet
// tal skrives ud (hard rule 17).

import test from "node:test";
import assert from "node:assert/strict";

import { createFake, world } from "./dommer7801RestByg.harness.mjs";
import { loadMedicalBonusByTeam } from "./medicalEffects.js";
import { raceFatigueNowForSurface, ridersWithFatigueNow, teamFatigueNowForSurface } from "./riderFatigueNow.js";

const MEDICAL_VARIANTS = {
  som_verdenen: () => {},
  laege_uden_evner: (s) => { s.staff_derived_abilities = []; },
  to_laeger: (s) => {
    s.team_staff.push({ id: "staff-a-med2", team_id: "team-a", name: "Laege B", role: "medical", tier: 3, status: "active" });
    s.staff_derived_abilities.push({ staff_id: "staff-a-med2", overall: 40, dimensions: {}, levels: {} });
  },
  laege_uden_afdeling: (s) => { s.team_facilities = s.team_facilities.filter((f) => f.track !== "medical"); },
  afdeling_uden_laege: (s) => { s.team_staff = []; s.staff_derived_abilities = []; },
};

async function engineCore(state, now, team) {
  const supabase = createFake(state);
  const ids = new Set(state.riders.filter((r) => r.team_id === team).map((r) => r.id));
  const recovery = new Map(state.rider_derived_abilities.map((a) => [a.rider_id, a.recovery]));
  const riders = state.rider_condition.filter((c) => ids.has(c.rider_id)).map((c) => ({
    rider_id: c.rider_id, team_id: team, fatigue: c.fatigue, form: c.form, abilities: { recovery: recovery.get(c.rider_id) ?? 50 },
  }));
  const medicalBonusByTeam = await loadMedicalBonusByTeam(supabase, [team]);
  const live = await ridersWithFatigueNow({ supabase, riders, now, medicalBonusByTeam });
  return new Map(live.map((r) => [r.rider_id, r.fatigue]));
}

const conditionsOf = (state, team) => {
  const ids = new Set(state.riders.filter((r) => r.team_id === team).map((r) => r.id));
  return state.rider_condition.filter((c) => ids.has(c.rider_id)).map((c) => ({ ...c }));
};

for (const scenario of ["midt_paa_dagen", "aften_alle_koert", "laege_byttet"]) {
  for (const [variant, apply] of Object.entries(MEDICAL_VARIANTS)) {
    test(`samme tal som motorens kerne: ${scenario} / ${variant}`, async () => {
      const { now, state } = world(scenario, "on");
      apply(state);
      const expected = await engineCore(state, now, "team-a");
      const { fatigue, unavailable } = await teamFatigueNowForSurface({ supabase: createFake(state), conditions: conditionsOf(state, "team-a"), teamId: "team-a", now });
      assert.equal(unavailable.size, 0);
      assert.deepEqual([...fatigue].sort(), [...expected].sort());
    });
  }
}

test("Race Hub: flere løb i én visning giver hvert løb samme tal som løbet alene", async () => {
  const { now, state } = world("midt_paa_dagen", "on");
  const conditions = conditionsOf(state, "team-a");
  const columns = [
    { race: { id: "r-etape" }, stageNumber: 3, conditions },
    { race: { id: "r-imorgen" }, stageNumber: 1, conditions },
    { race: { id: "r-sent" }, stageNumber: 1, conditions },
    { race: { id: "r-uplanlagt" }, stageNumber: 1, conditions },
  ];
  const together = await raceFatigueNowForSurface({ supabase: createFake(state), columns, teamId: "team-a", now });
  for (const [i, column] of columns.entries()) {
    const [alone] = await raceFatigueNowForSurface({ supabase: createFake(state), columns: [column], teamId: "team-a", now });
    assert.deepEqual([...together[i]], [...alone], column.race.id);
  }
});

test("lægeopslaget fejler på skærmen: streg for hele holdet, ingen uafhentede løfter", async () => {
  for (const mode of ["error", "gateway", "throw"]) {
    const { now, state } = world("midt_paa_dagen", "on");
    const fail = (table) => (table === "staff_derived_abilities" ? mode : null);
    const { fatigue, unavailable } = await teamFatigueNowForSurface({ supabase: createFake(state, { fail }), conditions: conditionsOf(state, "team-a"), teamId: "team-a", now });
    assert.ok([...fatigue.values()].every((value) => value === null), mode);
    assert.equal(unavailable.size, fatigue.size, mode);
  }
});
