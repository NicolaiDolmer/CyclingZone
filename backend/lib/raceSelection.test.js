// backend/lib/raceSelection.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection, buildRiderRows, getSelectionContext, saveSelection, prepareSelectionChange, saveSelectionBulk, classifyBulkSelectionConflicts } from "./raceSelection.js";

// Ejer 28/6 (afløser #1906): delvis trup tilladt — kun OVER feltstørrelsen afvises.
const base = {
  riderIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  captainId: "r1",
  sprintCaptainId: null,
  hunterId: null,
  teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]),
  injuredRiderIds: new Set(),
  sizeRule: { min: 6, max: 6 },
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

// #4534 (regression, live-fund 31/8): den tidligere #2637-bypass (removalOnly) er fjernet —
// OGSÅ en ren fjernelse afvises på et igangværende løb. En kalder der stadig sender det
// gamle flag får ingen særbehandling (parametren findes ikke længere).
test("saveSelection: ren fjernelse afvises på et igangværende løb — ingen removalOnly-bypass (#4534)", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: null }) };
  const race = { id: "race1", status: "scheduled", stages_completed: 3 };
  await assert.rejects(
    () => saveSelection({
      supabase, race, teamId: "t1",
      riderIds: ["r1", "r2"], captainId: "r1", sprintCaptainId: null, hunterId: null, freeRoleIds: [],
      removalOnly: true, // ignoreres — bypass'en eksisterer ikke længere
    }),
    (err) => err.code === "race_lineup_frozen"
  );
});

// #4283: RPC-guarden matcher kun dette løbs FAKTISKE etape-dage — en konflikt der alene
// rammer en hvile-/pausedag i #4217-spændet slipper forbi og fanges først af
// no_rider_double_booking_day-constrainten (rå 23505 uden 'selection_rider_bound' i
// beskeden). saveSelection skal klassificere den som selection_rider_bound, så ruten
// svarer den navngivne 409 og ikke en opak 500.
test("saveSelection: rå 23505 fra no_rider_double_booking_day klassificeres som selection_rider_bound (#4283)", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: {
    code: "23505",
    message: 'duplicate key value violates unique constraint "no_rider_double_booking_day"',
  } }) };
  const race = { id: "race1", status: "scheduled", stages_completed: 0 };
  await assert.rejects(
    () => saveSelection({ supabase, race, teamId: "t1", riderIds: ["r1"], captainId: "r1" }),
    (err) => err.code === "selection_rider_bound"
  );
});

test("saveSelection: en URELATERET RPC-fejl får IKKE selection_rider_bound-koden", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: { code: "XX000", message: "connection reset" } }) };
  const race = { id: "race1", status: "scheduled", stages_completed: 0 };
  await assert.rejects(
    () => saveSelection({ supabase, race, teamId: "t1", riderIds: ["r1"], captainId: "r1" }),
    (err) => err.code === undefined && /connection reset/.test(err.message)
  );
});

test("saveSelection: et igangværende løb afvises med race_lineup_frozen", async () => {
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

// #1146 — prepareSelectionChange: fælles pr.-løb-validering udtrukket af PUT /:raceId/
// selection, genbrugt af BÅDE single- og bulk-endpointet (PUT /races/selection/bulk).
// Genbruger makeSelectionSupabase (funktionserklæring, hoisted i modulet — defineret
// nedenfor, men tilgængelig her ved kørsel).
test("prepareSelectionChange: gyldig ændring passerer og returnerer riderIds/ctx", async () => {
  const teamId = "t1";
  const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
  const state = {
    riders: ids.map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
    race_stage_profiles: [], race_entries: [], rider_derived_abilities: [], rider_condition: [],
  };
  const race = { id: "race1", status: "scheduled", stages_completed: 0, league_division_id: "d1", race_class: "Class2" };
  const result = await prepareSelectionChange({
    supabase: makeSelectionSupabase(state), race, teamId, teamDivisionId: "d1",
    body: { rider_ids: ids, captain_id: "r1" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.riderIds, ids);
  assert.equal(result.captainId, "r1");
  assert.ok(result.ctx, "skal returnere getSelectionContext-resultatet (bruges af binding-tjekket i kalderen)");
});

test("prepareSelectionChange: løb der ikke er 'scheduled' afvises med 409 selection_race_not_open", async () => {
  const race = { id: "race1", status: "completed", stages_completed: 8, league_division_id: "d1" };
  const result = await prepareSelectionChange({
    supabase: makeSelectionSupabase({}), race, teamId: "t1", teamDivisionId: "d1", body: {},
  });
  assert.deepEqual(result, { ok: false, status: 409, error: "selection_race_not_open" });
});

test("prepareSelectionChange: forkert pulje afvises med 409 selection_wrong_pool", async () => {
  const race = { id: "race1", status: "scheduled", stages_completed: 0, league_division_id: "pool-A" };
  const result = await prepareSelectionChange({
    supabase: makeSelectionSupabase({}), race, teamId: "t1", teamDivisionId: "pool-B", body: {},
  });
  assert.deepEqual(result, { ok: false, status: 409, error: "selection_wrong_pool" });
});

test("prepareSelectionChange: ugyldigt body (rider_ids ikke et array) afvises med 400 selection_invalid_body", async () => {
  const race = { id: "race1", status: "scheduled", stages_completed: 0, league_division_id: "d1" };
  const result = await prepareSelectionChange({
    supabase: makeSelectionSupabase({}), race, teamId: "t1", teamDivisionId: "d1",
    body: { rider_ids: "r1,r2" },
  });
  assert.deepEqual(result, { ok: false, status: 400, error: "selection_invalid_body" });
});

// "for stor trup": SELECTION_SIZE.Class2 = {min:6,max:6} (raceAutopick.js) — 7 ryttere
// overskrider feltstørrelsen.
test("prepareSelectionChange: for stor trup afvises med 400 selection_wrong_size", async () => {
  const teamId = "t1";
  const ids = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];
  const state = {
    riders: ids.map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
    race_stage_profiles: [], race_entries: [], rider_derived_abilities: [], rider_condition: [],
  };
  const race = { id: "race1", status: "scheduled", stages_completed: 0, league_division_id: "d1", race_class: "Class2" };
  const result = await prepareSelectionChange({
    supabase: makeSelectionSupabase(state), race, teamId, teamDivisionId: "d1",
    body: { rider_ids: ids, captain_id: "r1" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, "selection_wrong_size");
});

// "ukendt rolle": sprint_captain_id peger på en rytter der ikke er i den valgte trup.
test("prepareSelectionChange: rolle-reference uden for truppen afvises med 400 selection_role_not_selected", async () => {
  const teamId = "t1";
  const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
  const state = {
    riders: [...ids, "r9"].map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
    race_stage_profiles: [], race_entries: [], rider_derived_abilities: [], rider_condition: [],
  };
  const race = { id: "race1", status: "scheduled", stages_completed: 0, league_division_id: "d1", race_class: "Class2" };
  const result = await prepareSelectionChange({
    supabase: makeSelectionSupabase(state), race, teamId, teamDivisionId: "d1",
    body: { rider_ids: ids, captain_id: "r1", sprint_captain_id: "r9" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, "selection_role_not_selected");
});

// #4534 (regression, live-fund 31/8 — friisisch fjernede sin kaptajn fra en igangværende
// Giro via matrixen): frys-vagten var asymmetrisk (tilføjelse blokeret, fjernelse tilladt
// via #2637-undtagelsen). Nu afvises BEGGE retninger med samme fejlklasse — frivillig
// udtræden findes ikke som mekanik endnu (ejer-beslutning, Discord 31/8 22:21).
test("prepareSelectionChange: frosset løb afviser BÅDE tilføjelse/uændret trup OG ren fjernelse (#4534)", async () => {
  const teamId = "t1";
  const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
  const state = {
    riders: ids.map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
    race_stage_profiles: [],
    race_entries: ids.map((id) => ({
      race_id: "race1", team_id: teamId, rider_id: id, race_role: id === "r1" ? "captain" : "helper", is_auto_filled: false,
    })),
    rider_derived_abilities: [], rider_condition: [],
  };
  const race = { id: "race1", status: "scheduled", stages_completed: 2, league_division_id: "d1", race_class: "Class2" };

  const blockedAdd = await prepareSelectionChange({
    supabase: makeSelectionSupabase(state), race, teamId, teamDivisionId: "d1",
    body: { rider_ids: ids, captain_id: "r1" }, // uændret trup / tilføjelses-retningen
  });
  assert.deepEqual(blockedAdd, { ok: false, status: 409, error: "selection_race_started" });

  const blockedRemoval = await prepareSelectionChange({
    supabase: makeSelectionSupabase(state), race, teamId, teamDivisionId: "d1",
    body: { rider_ids: ids.slice(0, 4), captain_id: "r1" }, // ægte delmængde — før #4534 slap den igennem
  });
  assert.deepEqual(blockedRemoval, { ok: false, status: 409, error: "selection_race_started" });

  const blockedClear = await prepareSelectionChange({
    supabase: makeSelectionSupabase(state), race, teamId, teamDivisionId: "d1",
    body: { rider_ids: [], captain_id: null }, // tøm hele truppen — den groveste fjernelse
  });
  assert.deepEqual(blockedClear, { ok: false, status: 409, error: "selection_race_started" });
});

// #1146 — saveSelectionBulk: atomisk RPC-kald for HELE batchen. Den ægte alt-eller-intet-
// garanti (advisory-lås + deferred constraint) ligger i SQL-transaktionen (database/2026-
// 08-27-1146-selection-bulk-rpc.sql) og kan ikke udøves uden en live Postgres — disse tests
// dækker JS-kontrakten: ÉT rpc-kald pr. bulk-request (uanset N ændringer, samme "ÉN
// marketWriteLimiter-hit pr. kald"-pointe som ruten), og at en RPC-fejl kaster for HELE
// kaldet (ingen delvis JS-side håndtering der kunne skjule et delvist resultat).
test("saveSelectionBulk: bygger replace_race_selection_bulk-kaldet med p_team_id/p_changes/p_auto_releases", async () => {
  let rpcArgs = null;
  const supabase = { rpc: (name, args) => { rpcArgs = { name, args }; return Promise.resolve({ error: null }); } };
  const changes = [{ race_id: "race1", rider_ids: ["r1", "r2"], roles: ["captain", "helper"] }];
  const autoReleases = [{ race_id: "race9", rider_id: "r5" }];
  await saveSelectionBulk({ supabase, teamId: "t1", changes, autoReleases });
  assert.equal(rpcArgs.name, "replace_race_selection_bulk");
  assert.equal(rpcArgs.args.p_team_id, "t1");
  assert.deepEqual(rpcArgs.args.p_changes, changes);
  assert.deepEqual(rpcArgs.args.p_auto_releases, autoReleases);
});

test("saveSelectionBulk: autoReleases er valgfri (default tomt array)", async () => {
  let rpcArgs = null;
  const supabase = { rpc: (name, args) => { rpcArgs = { name, args }; return Promise.resolve({ error: null }); } };
  await saveSelectionBulk({ supabase, teamId: "t1", changes: [] });
  assert.deepEqual(rpcArgs.args.p_auto_releases, []);
});

test("saveSelectionBulk: ÉT RPC-kald for HELE batchen uanset antal ændringer (atomicitet + cap-pointe, #1146)", async () => {
  let callCount = 0;
  const supabase = { rpc: () => { callCount += 1; return Promise.resolve({ error: null }); } };
  const changes = [
    { race_id: "race1", rider_ids: ["r1"], roles: ["captain"] },
    { race_id: "race2", rider_ids: ["r2"], roles: ["captain"] },
    { race_id: "race3", rider_ids: ["r3"], roles: ["captain"] },
  ];
  await saveSelectionBulk({ supabase, teamId: "t1", changes });
  assert.equal(callCount, 1, "N ændringer skal blive til ÉT RPC-kald, ikke N separate skrivninger");
});

test("saveSelectionBulk: en fejl midt i batchen kaster for HELE kaldet (ingen delvis JS-håndtering)", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: { code: "XX000", message: "constraint violation mid-batch" } }) };
  const changes = [
    { race_id: "race1", rider_ids: ["r1"], roles: ["captain"] },
    { race_id: "race2", rider_ids: ["r2"], roles: ["captain"] },
  ];
  await assert.rejects(() => saveSelectionBulk({ supabase, teamId: "t1", changes }));
});

test("saveSelectionBulk: rå 23505 fra no_rider_double_booking_day klassificeres som selection_rider_bound", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: {
    code: "23505",
    message: 'duplicate key value violates unique constraint "no_rider_double_booking_day"',
  } }) };
  await assert.rejects(
    () => saveSelectionBulk({ supabase, teamId: "t1", changes: [{ race_id: "race1", rider_ids: [], roles: [] }] }),
    (err) => err.code === "selection_rider_bound"
  );
});

test("saveSelectionBulk: en URELATERET RPC-fejl får IKKE selection_rider_bound-koden", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: { code: "XX000", message: "connection reset" } }) };
  await assert.rejects(
    () => saveSelectionBulk({ supabase, teamId: "t1", changes: [{ race_id: "race1", rider_ids: [], roles: [] }] }),
    (err) => err.code === undefined && /connection reset/.test(err.message)
  );
});

// #4310-refutation FUND 1 (SQL-niveau forward-guard i replace_race_selection_bulk):
// RPC'ens egen 'selection_race_started'-fejl (TOCTOU-backstop mod et løb der blev
// frosset/afsluttet MELLEM app-lagets prepareSelectionChange og transaktionens commit)
// skal klassificeres med samme fejlkode som prepareSelectionChange bruger for den
// almindelige sti, så api.js kan svare 409 ens uanset hvilket lag der fangede det.
test("saveSelectionBulk: rå 'selection_race_started' fra RPC'ens forward-guard klassificeres korrekt (#4310 FUND 1)", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: {
    code: "check_violation",
    message: "selection_race_started",
  } }) };
  await assert.rejects(
    () => saveSelectionBulk({ supabase, teamId: "t1", changes: [{ race_id: "race1", rider_ids: ["r1"], roles: ["captain"] }] }),
    (err) => err.code === "selection_race_started"
  );
});

// CodeRabbit-review af PR #4316: forward-guarden har TO regler, men kun den ene fejlkode var
// mappet. Et løb der blev FINALISERET (status <> 'scheduled') i TOCTOU-vinduet gav
// err.code = undefined, så api.js's catch faldt igennem til 500 + Sentry-alarm i stedet for
// den 409 de tre øvrige call-sites allerede svarer for præcis den tilstand.
test("saveSelectionBulk: rå 'selection_race_not_open' fra RPC'ens forward-guard klassificeres korrekt", async () => {
  const supabase = { rpc: () => Promise.resolve({ error: {
    code: "check_violation",
    message: "selection_race_not_open",
  } }) };
  await assert.rejects(
    () => saveSelectionBulk({ supabase, teamId: "t1", changes: [{ race_id: "race1", rider_ids: ["r1"], roles: ["captain"] }] }),
    (err) => err.code === "selection_race_not_open"
  );
});

// #4310-refutation FUND 3: classifyBulkSelectionConflicts er den rene funktion der GØR en
// swap mellem to (eller flere) celler i SAMME bulk-kald rækkefølge-uafhængig — udtrukket af
// PUT /races/selection/bulk (api.js), hvor den tidligere lå inline og kun var dækket af
// kildetekst-regex (0% reel adfærdsdækning, jf. #4310's verdict). Testene nedenfor beviser
// selve egenskaben: resultatet for et givet race afhænger KUN af mængden af ændringer i
// batchen, ikke af deres rækkefølge i `changes`-arrayet.
const win = (start, end) => ({ start, end, days: Array.from({ length: end - start + 1 }, (_, i) => start + i) });

test("classifyBulkSelectionConflicts: 2-vejs swap (rytter flyttes fra race A til race B) er rækkefølge-uafhængig — begge 'clear'", () => {
  const a = { raceId: "A", riderIds: [], window: win(1, 3) };
  const b = { raceId: "B", riderIds: ["r1"], window: win(2, 4) }; // overlapper A, men A har IKKE r1 længere
  for (const changes of [[a, b], [b, a]]) {
    const results = classifyBulkSelectionConflicts({ changes, otherRacesByRace: new Map() });
    const byRace = new Map(results.map((r) => [r.race_id, r]));
    assert.equal(byRace.get("A").kind, "clear", `A skal være clear (rækkefølge: ${changes.map((c) => c.raceId)})`);
    assert.equal(byRace.get("B").kind, "clear", `B skal være clear (rækkefølge: ${changes.map((c) => c.raceId)})`);
  }
});

test("classifyBulkSelectionConflicts: 3-vejs rotation (r1: A→B, r2: B→C, r3: C→A, alle vinduer overlapper) er rækkefølge-uafhængig — alle 'clear'", () => {
  const a = { raceId: "A", riderIds: ["r3"], window: win(1, 5) }; // A afgiver r1, modtager r3 (fra C)
  const b = { raceId: "B", riderIds: ["r1"], window: win(1, 5) }; // B afgiver r2, modtager r1 (fra A)
  const c = { raceId: "C", riderIds: ["r2"], window: win(1, 5) }; // C afgiver r3, modtager r2 (fra B)
  const permutations = [[a, b, c], [c, b, a], [b, a, c], [c, a, b]];
  for (const changes of permutations) {
    const results = classifyBulkSelectionConflicts({ changes, otherRacesByRace: new Map() });
    for (const r of results) {
      assert.equal(r.kind, "clear", `${r.race_id} skal være clear (rækkefølge: ${changes.map((c) => c.raceId)})`);
    }
  }
});

test("classifyBulkSelectionConflicts: ÆGTE peer-konflikt (samme rytter ønsket i to overlappende races i SAMME batch) blokerer altid, uanset rækkefølge", () => {
  const a = { raceId: "A", riderIds: ["r1"], window: win(1, 3) };
  const b = { raceId: "B", riderIds: ["r1"], window: win(2, 4) }; // overlapper A, BEGGE vil have r1 → ægte kollision
  for (const changes of [[a, b], [b, a]]) {
    const results = classifyBulkSelectionConflicts({ changes, otherRacesByRace: new Map() });
    const byRace = new Map(results.map((r) => [r.race_id, r]));
    assert.equal(byRace.get("A").kind, "peer_conflict");
    assert.equal(byRace.get("B").kind, "peer_conflict");
    assert.deepEqual(byRace.get("A").conflicts, [{ rider_id: "r1", race_id: "A", conflict_race_id: "B" }]);
    assert.deepEqual(byRace.get("B").conflicts, [{ rider_id: "r1", race_id: "B", conflict_race_id: "A" }]);
  }
});

test("classifyBulkSelectionConflicts: IKKE-overlappende vinduer med samme rytter i to races er IKKE en konflikt", () => {
  const a = { raceId: "A", riderIds: ["r1"], window: win(1, 3) };
  const b = { raceId: "B", riderIds: ["r1"], window: win(10, 12) }; // samme rytter, men ingen dag-overlap
  const results = classifyBulkSelectionConflicts({ changes: [a, b], otherRacesByRace: new Map() });
  for (const r of results) assert.equal(r.kind, "clear");
});

test("classifyBulkSelectionConflicts: DB-konflikt (mod et løb UDENFOR batchen) klassificeres som db_conflict, ikke peer_conflict", () => {
  const a = { raceId: "A", riderIds: ["r1", "r2"], window: win(1, 3) };
  const otherRacesByRace = new Map([
    ["A", [{ raceId: "Z", window: win(2, 5), riderIds: ["r1"] }]], // Z er UDENFOR batchen
  ]);
  const [result] = classifyBulkSelectionConflicts({ changes: [a], otherRacesByRace });
  assert.equal(result.kind, "db_conflict");
  assert.deepEqual(result.boundRiderIds, ["r1"]);
});

test("classifyBulkSelectionConflicts: peer-konflikt tjekkes FØR DB-konflikt (samme rytter rammer begge slags samtidig)", () => {
  const a = { raceId: "A", riderIds: ["r1"], window: win(1, 3) };
  const b = { raceId: "B", riderIds: ["r1"], window: win(1, 3) }; // peer-kollision på r1
  const otherRacesByRace = new Map([
    ["A", [{ raceId: "Z", window: win(1, 3), riderIds: ["r1"] }]], // ville OGSÅ være en db-konflikt
  ]);
  const [resultA] = classifyBulkSelectionConflicts({ changes: [a, b], otherRacesByRace });
  assert.equal(resultA.kind, "peer_conflict", "peer-konflikten skal vinde (blokerende under alle omstændigheder)");
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

// #3041: selection.manual_rider_ids skal kun indeholde de MANUELT udtagne (ikke
// auto-filled) — bruges af distribution-endpointet til at bygge binding-map'et, så et
// auto-pick ikke gråner rytteren for et andet overlappende løb (viger ved gem, #2637).
test("getSelectionContext: selection.manual_rider_ids indeholder kun ikke-auto-filled entries", async () => {
  const teamId = "t1";
  const state = {
    riders: ["r1", "r2", "r3"].map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
    race_stage_profiles: [{ race_id: "race1", stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }],
    race_entries: [
      { race_id: "race1", team_id: teamId, rider_id: "r1", race_role: "captain", is_auto_filled: false }, // manuel
      { race_id: "race1", team_id: teamId, rider_id: "r2", race_role: "helper", is_auto_filled: true }, // auto
      { race_id: "race1", team_id: teamId, rider_id: "r3", race_role: "helper", is_auto_filled: true }, // auto
    ],
    rider_derived_abilities: [],
    rider_condition: [],
  };
  const supabase = makeSelectionSupabase(state);
  const ctx = await getSelectionContext({ supabase, race: { id: "race1", race_class: "Class2" }, teamId });
  assert.deepEqual(ctx.selection.rider_ids.sort(), ["r1", "r2", "r3"], "rider_ids forbliver ALT (auto+manuelt)");
  assert.deepEqual(ctx.selection.manual_rider_ids, ["r1"], "manual_rider_ids kun den manuelle");
});

// S4: per-etape rute-match — buildRiderRows mapper evner+profiler til riderRows.
test("buildRiderRows: hver rytter får stageSuitability-array (længde = antal etaper)", () => {
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, randomness: 0.5 } },
    { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, randomness: 0.4 } },
  ];
  const riders = [{ id: "r1", firstname: "A", lastname: "B", primary_type: "climber", secondary_type: null }];
  const abilityByRider = new Map([["r1", { climbing: 90, sprint: 20, aggression: 73, tactics: 55 }]]);
  const conditionByRider = new Map([["r1", { form: 60, fatigue: 10, injured_until: null }]]);
  const rows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr: "2026-06-25" });
  assert.equal(rows[0].stageSuitability.length, 2);
  assert.ok(rows[0].stageSuitability[1] > rows[0].stageSuitability[0]); // klatrer: bjerg > flad
  assert.equal(typeof rows[0].suitability, "number"); // løb-snit bevaret
  assert.equal(rows[0].aggression, 73); // S5: aggression surfaced til jæger-rangering
  assert.equal(rows[0].tactics, 55); // #3115: tactics surfaced til selectionDrivers-bånd
  // #3809: abilities-objektet indeholder ALLE 15 evne-nøgler, ikke kun de fire
  // testede — manglende kolonner (fx climbing er sat, sprint er sat, resten
  // mangler i mock'en) skal falde tilbage til null pr. nøgle, ikke undefined/kastet.
  assert.equal(rows[0].abilities.climbing, 90);
  assert.equal(rows[0].abilities.sprint, 20);
  assert.equal(rows[0].abilities.tactics, 55);
  assert.equal(rows[0].abilities.punch, null); // ikke sat i mock'en → null, ikke undefined
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
  assert.equal(rows[0].tactics, null); // ingen evner → tactics null
  assert.equal(rows[0].abilities, null); // #3809: ingen evner → hele abilities-objektet null
});
