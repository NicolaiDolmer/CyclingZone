// backend/lib/raceSelection.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection, buildRiderRows, getSelectionContext, saveSelection } from "./raceSelection.js";

// Ejer 28/6 (afløser #1906): delvis trup tilladt — kun OVER feltstørrelsen afvises.
const base = {
  riderIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  captainId: "r1",
  sprintCaptainId: null,
  hunterId: null,
  teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]),
  injuredRiderIds: new Set(),
  sizeRule: { min: 6, max: 6 },
  availableCount: 9,
};

test("gyldig (fuld) udtagelse passerer", () => {
  assert.deepEqual(validateSelection(base), { ok: true, errors: [] });
});

test("delvis trup tilladt (ejer 28/6): under-fuld + tom passerer, over-fuld afvises", () => {
  // Delvis (2 af 6) → OK (resten auto-udtages ved race-tid).
  assert.equal(validateSelection({ ...base, riderIds: ["r1", "r2"], captainId: "r1" }).ok, true);
  // Tom trup (ingen manuelle picks) → OK; kaptajn ikke krævet.
  assert.equal(validateSelection({ ...base, riderIds: [], captainId: null }).ok, true);
  // ...men en tom trup med en forældet kaptajn-reference afvises (input-hul, CodeRabbit).
  assert.ok(validateSelection({ ...base, riderIds: [], captainId: "r1" }).errors.includes("selection_captain_not_selected"));
  // For mange (7 af 6) → wrong_size (over feltstørrelsen).
  assert.ok(validateSelection({ ...base, riderIds: ["r1","r2","r3","r4","r5","r6","r7"] }).errors.includes("selection_wrong_size"));
  // Default-klasse {6,8}: 6 af 8 = delvis → OK; 9 → wrong_size.
  assert.equal(validateSelection({ ...base, sizeRule: { min: 6, max: 8 }, riderIds: ["r1","r2","r3","r4","r5","r6"] }).ok, true);
  assert.ok(validateSelection({ ...base, sizeRule: { min: 6, max: 8 }, riderIds: ["r1","r2","r3","r4","r5","r6","r7","r8","r9"] }).errors.includes("selection_wrong_size"));
});

test("få raske ryttere er IKKE længere en fejl (delvis trup, top-fyld ved race-tid)", () => {
  // Kun 5 berettigede ryttere, løbet har 6 pladser → tidligere selection_insufficient_riders.
  // Nu: delvis trup tilladt; motoren top-fylder ved race-tid.
  const small = validateSelection({
    ...base,
    riderIds: ["r1", "r2", "r3", "r4", "r5"], captainId: "r1",
    teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5"]),
  });
  assert.equal(small.ok, true);
  assert.ok(!small.errors.includes("selection_insufficient_riders"));
  assert.ok(!small.errors.includes("selection_wrong_size"));
});

test("kaptajn kræves, skal være udtaget, roller skal være distinkte", () => {
  assert.ok(validateSelection({ ...base, captainId: null }).errors.includes("selection_captain_required"));
  assert.ok(validateSelection({ ...base, captainId: "r9" }).errors.includes("selection_captain_not_selected"));
  assert.ok(validateSelection({ ...base, sprintCaptainId: "r1" }).errors.includes("selection_role_overlap"));
  assert.ok(validateSelection({ ...base, hunterId: "r1" }).errors.includes("selection_role_overlap"));
  assert.ok(validateSelection({ ...base, sprintCaptainId: "r9" }).errors.includes("selection_role_not_selected"));
  assert.ok(validateSelection({ ...base, hunterId: "r9" }).errors.includes("selection_role_not_selected"));
});

test("fremmede, skadede og duplikerede ryttere afvises", () => {
  assert.ok(validateSelection({ ...base, riderIds: [...base.riderIds.slice(0, 5), "alien"] }).errors.includes("selection_rider_not_on_team"));
  assert.ok(validateSelection({ ...base, injuredRiderIds: new Set(["r2"]) }).errors.includes("selection_rider_injured"));
  assert.ok(validateSelection({ ...base, riderIds: ["r1", "r1", "r2", "r3", "r4", "r5"] }).errors.includes("selection_duplicate_rider"));
});

// #2376: free_role_ids — additiv rolle-udvidelse (flere ryttere kan dele rollen).
test("validateSelection: free_role_ids — gyldig når i trup, afvist når fremmed eller overlappende", () => {
  // Gyldig: to ryttere i truppen (ingen overlap med captain/sprint/hunter).
  assert.equal(validateSelection({ ...base, freeRoleIds: ["r2", "r3"] }).ok, true);
  // Ikke i den valgte trup → selection_role_not_selected (mirrors sprint/hunter-tjekket).
  assert.ok(validateSelection({ ...base, freeRoleIds: ["r9"] }).errors.includes("selection_role_not_selected"));
  // Overlap med kaptajn → selection_role_overlap.
  assert.ok(validateSelection({ ...base, freeRoleIds: ["r1"] }).errors.includes("selection_role_overlap"));
  // Overlap med sprint_captain/hunter → selection_role_overlap.
  assert.ok(validateSelection({ ...base, sprintCaptainId: "r2", freeRoleIds: ["r2"] }).errors.includes("selection_role_overlap"));
  assert.ok(validateSelection({ ...base, hunterId: "r2", freeRoleIds: ["r2"] }).errors.includes("selection_role_overlap"));
  // Dubletter i freeRoleIds selv → deduperet ved indgang, ikke en fejl.
  assert.equal(validateSelection({ ...base, freeRoleIds: ["r2", "r2", "r3"] }).ok, true);
  // Udeladt (default []) → ingen fejl, uændret adfærd.
  assert.equal(validateSelection(base).ok, true);
});

// #2376: saveSelection mapper freeRoleIds til race_role='free_role' i RPC-kaldets p_roles —
// roleFor() er ikke eksporteret, så vi verificerer mappingen via saveSelection's RPC-payload.
test("saveSelection: freeRoleIds mappes til race_role='free_role' i replace_race_selection-kaldet", async () => {
  let rpcArgs = null;
  const supabase = { rpc: (name, args) => { rpcArgs = { name, args }; return Promise.resolve({ error: null }); } };
  const race = { id: "race1", status: "scheduled", stages_completed: 0 };
  await saveSelection({
    supabase, race, teamId: "t1",
    riderIds: ["r1", "r2", "r3", "r4"],
    captainId: "r1", sprintCaptainId: null, hunterId: null,
    freeRoleIds: ["r2", "r3"],
  });
  assert.equal(rpcArgs.name, "replace_race_selection");
  assert.deepEqual(rpcArgs.args.p_rider_ids, ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(rpcArgs.args.p_roles, ["captain", "free_role", "free_role", "helper"]);
});

// #2637: en skadet rytter skal altid kunne fjernes fra en trup — også midt i et aktivt
// etapeløb. saveSelection({ removalOnly: true }) skal ikke kaste race_lineup_frozen
// selv når løbet er i gang (stages_completed>0); uden flaget (default false) kaster den.
test("saveSelection: removalOnly=true omgår race_lineup_frozen-guarden for et igangværende løb", async () => {
  let rpcArgs = null;
  const supabase = { rpc: (name, args) => { rpcArgs = { name, args }; return Promise.resolve({ error: null }); } };
  const race = { id: "race1", status: "scheduled", stages_completed: 3 };
  await saveSelection({
    supabase, race, teamId: "t1",
    riderIds: ["r1", "r2"], captainId: "r1", sprintCaptainId: null, hunterId: null, freeRoleIds: [],
    removalOnly: true,
  });
  assert.equal(rpcArgs.name, "replace_race_selection");
  assert.deepEqual(rpcArgs.args.p_rider_ids, ["r1", "r2"]);
});

test("saveSelection: uden removalOnly (default) afvises et igangværende løb stadig med race_lineup_frozen", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: null }) };
  const race = { id: "race1", status: "scheduled", stages_completed: 3 };
  await assert.rejects(
    () => saveSelection({
      supabase, race, teamId: "t1",
      riderIds: ["r1", "r2", "r3"], captainId: "r1", sprintCaptainId: null, hunterId: null, freeRoleIds: [],
    }),
    (err) => err.code === "race_lineup_frozen"
  );
});

// Rod B (#1800/#1742): getSelectionContext må kun vise/tælle løbs-berettigede ryttere.
// Mock-supabase: thenable builder pr. tabel; eq/in/or/is registreres så riders-queriet
// kan respektere is_academy-/pending_team_id-filtrene (akademi/under-handel ekskluderes
// fra rosteren).
function makeSelectionSupabase(state) {
  function from(table) {
    const f = { eqs: {}, ins: {}, is: {} };
    const b = {
      select() { return b; },
      eq(col, val) { f.eqs[col] = val; return b; },
      in(col, vals) { f.ins[col] = vals; return b; },
      or() { f.orRetired = true; return b; },
      is(col, val) { f.is[col] = val; return b; },
      order() { return b; },
      then(resolve, reject) {
        let rows = state[table] || [];
        if (table === "riders") {
          rows = rows.filter((r) =>
            (f.eqs.team_id === undefined || r.team_id === f.eqs.team_id) &&
            (f.eqs.is_academy === undefined || r.is_academy === f.eqs.is_academy) &&
            (!f.orRetired || r.is_retired == null || r.is_retired === false) &&
            (f.is.pending_team_id === undefined || (r.pending_team_id ?? null) === f.is.pending_team_id)
          );
        } else if (f.eqs.race_id !== undefined) {
          rows = rows.filter((r) => r.race_id === f.eqs.race_id && (f.eqs.team_id === undefined || r.team_id === f.eqs.team_id));
        } else if (f.ins.rider_id) {
          rows = rows.filter((r) => f.ins.rider_id.includes(r.rider_id));
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("getSelectionContext: ghost-entries (akademi/off-roster) udelades fra selection + counts", async () => {
  const teamId = "t1";
  const state = {
    riders: [
      ...["r1", "r2", "r3", "r4", "r5"].map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
      { id: "academy", team_id: teamId, is_academy: true, is_retired: false, firstname: "A", lastname: "Cad" },
    ],
    race_stage_profiles: [{ race_id: "race1", stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }],
    race_entries: [
      ...["r1", "r2", "r3", "r4", "r5"].map((id) => ({ race_id: "race1", team_id: teamId, rider_id: id, race_role: id === "r1" ? "captain" : "helper", is_auto_filled: false })),
      { race_id: "race1", team_id: teamId, rider_id: "academy", race_role: "helper", is_auto_filled: false }, // ghost: udtaget før akademi-status
    ],
    rider_derived_abilities: ["r1", "r2", "r3", "r4", "r5"].map((id) => ({ rider_id: id, climbing: 50, sprint: 50, aggression: 40 })),
    rider_condition: [],
  };
  const supabase = makeSelectionSupabase(state);
  const ctx = await getSelectionContext({ supabase, race: { id: "race1", race_class: "Class2" }, teamId });
  assert.ok(!ctx.selection.rider_ids.includes("academy"), "akademi-ghost udeladt af selection");
  assert.equal(ctx.selection.rider_ids.length, 5, "kun de 5 gyldige tæller (ærlig count)");
  assert.ok(!ctx.riders.some((r) => r.id === "academy"), "akademirytter ikke i rosteren");
});

// #2579: en rytter der er SOLGT, men hvis holdskifte er parkeret (pending_team_id)
// pga. et aktivt etapeløb hos sælger (#1995), må ikke kunne tilføjes en NY udtagelse
// hos sælgeren — team_id peger stadig på sælger i den periode, så uden dette filter
// ville han fremstå som en helt almindelig rosterrytter for et andet, ikke-låst løb.
test("getSelectionContext: rytter med pending_team_id (solgt, afventer flush) er ikke valgbar til en NY udtagelse", async () => {
  const teamId = "seller";
  const state = {
    riders: [
      ...["r1", "r2", "r3", "r4", "r5"].map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
      // Solgt til "buyer" — team_id er stadig sælger (aktivt etapeløb parkerer flytningen).
      { id: "sold-pending", team_id: teamId, pending_team_id: "buyer", is_academy: false, is_retired: false, firstname: "Sold", lastname: "Pending" },
    ],
    race_stage_profiles: [{ race_id: "race2", stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }],
    // Ingen committede entries for "race2" endnu — vi tester at han ikke KAN vælges,
    // ikke at en eksisterende entry fjernes (det dækkes af clearFutureRaceEntriesSafe
    // ved transfer-bekræftelse).
    race_entries: [],
    rider_derived_abilities: ["r1", "r2", "r3", "r4", "r5"].map((id) => ({ rider_id: id, climbing: 50, sprint: 50, aggression: 40 })),
    rider_condition: [],
  };
  const supabase = makeSelectionSupabase(state);
  const ctx = await getSelectionContext({ supabase, race: { id: "race2", race_class: "Class2" }, teamId });
  assert.ok(!ctx.riders.some((r) => r.id === "sold-pending"), "solgt-men-parkeret rytter er ikke i den valgbare roster");
  assert.equal(ctx.riders.length, 5, "kun de 5 ikke-solgte tæller");
});

// #2376: getSelectionContext skal surface free_role_ids (array — flere ryttere kan dele rollen).
test("getSelectionContext: selection.free_role_ids samler ALLE free_role-entries", async () => {
  const teamId = "t1";
  const state = {
    riders: ["r1", "r2", "r3", "r4"].map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
    race_stage_profiles: [{ race_id: "race1", stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }],
    race_entries: [
      { race_id: "race1", team_id: teamId, rider_id: "r1", race_role: "captain", is_auto_filled: false },
      { race_id: "race1", team_id: teamId, rider_id: "r2", race_role: "free_role", is_auto_filled: false },
      { race_id: "race1", team_id: teamId, rider_id: "r3", race_role: "free_role", is_auto_filled: false },
      { race_id: "race1", team_id: teamId, rider_id: "r4", race_role: "helper", is_auto_filled: false },
    ],
    rider_derived_abilities: [],
    rider_condition: [],
  };
  const supabase = makeSelectionSupabase(state);
  const ctx = await getSelectionContext({ supabase, race: { id: "race1", race_class: "Class2" }, teamId });
  assert.deepEqual(ctx.selection.free_role_ids, ["r2", "r3"]);
  assert.equal(ctx.selection.captain_id, "r1");
});

// S4: per-etape rute-match — buildRiderRows mapper evner+profiler til riderRows.
test("buildRiderRows: hver rytter får stageSuitability-array (længde = antal etaper)", () => {
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, randomness: 0.5 } },
    { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, randomness: 0.4 } },
  ];
  const riders = [{ id: "r1", firstname: "A", lastname: "B", primary_type: "climber", secondary_type: null }];
  const abilityByRider = new Map([["r1", { climbing: 90, sprint: 20, aggression: 73 }]]);
  const conditionByRider = new Map([["r1", { form: 60, fatigue: 10, injured_until: null }]]);
  const rows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr: "2026-06-25" });
  assert.equal(rows[0].stageSuitability.length, 2);
  assert.ok(rows[0].stageSuitability[1] > rows[0].stageSuitability[0]); // klatrer: bjerg > flad
  assert.equal(typeof rows[0].suitability, "number"); // løb-snit bevaret
  assert.equal(rows[0].aggression, 73); // S5: aggression surfaced til jæger-rangering
});

test("buildRiderRows: ingen evner → suitability null + stageSuitability null", () => {
  const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }];
  const rows = buildRiderRows({
    riders: [{ id: "r1", firstname: "A", lastname: "B" }],
    stages, abilityByRider: new Map(), conditionByRider: new Map(), todayStr: "2026-06-25",
  });
  assert.equal(rows[0].suitability, null);
  assert.equal(rows[0].stageSuitability, null);
  assert.equal(rows[0].aggression, null); // ingen evner → aggression null
});
