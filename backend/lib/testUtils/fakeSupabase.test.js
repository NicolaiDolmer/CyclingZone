// #2598 · Tests for den delte, projektion-aware fake-supabase-helper.
// Kilde: backwards-check-companion til #2473 (auto-accept datatab, #2469).
// Kernen i #2469 var at test-fake'erne serverede HELE rækken uanset
// select()-kolonnelisten — en fake der er mere large end databasen kan ikke
// fange projektionsfejl. Disse tests er forward-guarden: de fejler hvis
// createFakeSupabase/createRecorderSupabase nogensinde regredierer til at
// servere kolonner de ikke blev bedt om.

import test from "node:test";
import assert from "node:assert/strict";

import { parseSelectColumns, projectRow, createFakeSupabase, createRecorderSupabase } from "./fakeSupabase.js";

// =====================================================================
// parseSelectColumns — pure function
// =====================================================================

test("parseSelectColumns: '*' og tom/null → null (ingen projektion)", () => {
  assert.equal(parseSelectColumns("*"), null);
  assert.equal(parseSelectColumns(""), null);
  assert.equal(parseSelectColumns(null), null);
  assert.equal(parseSelectColumns(undefined), null);
});

test("parseSelectColumns: simpel kommasepareret liste", () => {
  assert.deepEqual(parseSelectColumns("id, salary"), ["id", "salary"]);
  assert.deepEqual(parseSelectColumns("satisfaction,budget_modifier"), ["satisfaction", "budget_modifier"]);
});

test("parseSelectColumns: embedded resource med join-hint respekterer parentes-dybde", () => {
  assert.deepEqual(
    parseSelectColumns("rank, races!inner(race_class, race_type, season_id)"),
    ["rank", "races"]
  );
});

test("parseSelectColumns: aliaset embedded resource bruger alias som output-nøgle", () => {
  assert.deepEqual(parseSelectColumns("team:team_id(is_ai)"), ["team"]);
});

test("parseSelectColumns: '*' blandet med embedded resource → ingen projektion (base-kolonner ikke individuelt opremset)", () => {
  assert.equal(parseSelectColumns("*, team:team_id(is_ai, is_bank)"), null);
});

// =====================================================================
// projectRow — pure function
// =====================================================================

test("projectRow: null-kolonner ('*') returnerer hele rækken uændret", () => {
  const row = { a: 1, b: 2, secret: "x" };
  assert.equal(projectRow(row, null), row);
});

test("projectRow: filtrerer ned til KUN de angivne kolonner", () => {
  assert.deepEqual(projectRow({ a: 1, b: 2, c: 3 }, ["a", "c"]), { a: 1, c: 3 });
});

test("projectRow: kolonne der ikke findes på rækken udelades stille (matcher Postgres-fejl-ved-ukendt-kolonne, ikke undefined-lækage)", () => {
  assert.deepEqual(projectRow({ a: 1 }, ["a", "does_not_exist"]), { a: 1 });
});

// =====================================================================
// createFakeSupabase — forward-guard: select(cols) LÆKKER ALDRIG
// kolonner der ikke blev bedt om (#2469-klassen)
// =====================================================================

test("#2469 forward-guard: narrow select() eksponerer IKKE kolonner uden for listen", async () => {
  const supabase = createFakeSupabase({
    board_profiles: [
      { id: "b1", team_id: "t1", plan_type: "5yr", satisfaction: 82, budget_modifier: 1.2, tradeoff_payload: { secret: true } },
    ],
  });

  const { data } = await supabase.from("board_profiles").select("id, team_id").eq("team_id", "t1");
  assert.deepEqual(data, [{ id: "b1", team_id: "t1" }]);
  // Selve regressions-garanten: hverken satisfaction, budget_modifier eller
  // tradeoff_payload må lække igennem en select der ikke bad om dem.
  assert.ok(!("satisfaction" in data[0]), "satisfaction lækkede gennem en select der ikke bad om den");
  assert.ok(!("budget_modifier" in data[0]), "budget_modifier lækkede gennem en select der ikke bad om den");
  assert.ok(!("tradeoff_payload" in data[0]), "tradeoff_payload lækkede gennem en select der ikke bad om den");
});

test("#2469 forward-guard: 'existingBoard?.x ?? default' på en narrow select ville nu KORREKT ramme defaulten (reproducerer den oprindelige bug-klasse)", async () => {
  // Dette er selve #2469-mekanikken: koden henter en smal select og læser et
  // felt der ikke er med → skal se undefined (og dermed defaulte), IKKE den
  // fulde DB-værdi. Fake'en skal reproducere det, så tests fanger regler-
  // brud i produktionskoden i stedet for at skjule dem.
  const supabase = createFakeSupabase({
    board_profiles: [{ id: "b1", team_id: "t1", satisfaction: 82, budget_modifier: 1.2 }],
  });
  const { data: rows } = await supabase.from("board_profiles").select("id, team_id").eq("team_id", "t1");
  const existingBoard = rows[0];
  assert.equal(existingBoard?.satisfaction ?? 50, 50, "narrow select skal IKKE lade satisfaction smutte igennem");
});

test("select('*') returnerer stadig hele rækken (ingen falsk-positiv projektion)", async () => {
  const supabase = createFakeSupabase({
    teams: [{ id: "t1", name: "Alpha", balance: 500000 }],
  });
  const { data } = await supabase.from("teams").select("*").eq("id", "t1");
  assert.deepEqual(data, [{ id: "t1", name: "Alpha", balance: 500000 }]);
});

test("filtrering (.eq) sker på den FULDE række (som i Postgres) — kun outputtet projiceres", async () => {
  const supabase = createFakeSupabase({
    teams: [
      { id: "t1", name: "Alpha", is_ai: false, secret_flag: true },
      { id: "t2", name: "Beta", is_ai: false, secret_flag: false },
    ],
  });
  // secret_flag er IKKE i selectet, men filtrering skal stadig virke korrekt
  // på den fulde underliggende række.
  const { data } = await supabase.from("teams").select("id, name").eq("secret_flag", true);
  assert.deepEqual(data, [{ id: "t1", name: "Alpha" }]);
});

test("upsert respekterer onConflict-nøglen og merger i stedet for at duplikere", async () => {
  const supabase = createFakeSupabase({ board_profiles: [] });
  await supabase.from("board_profiles").upsert({ team_id: "t1", plan_type: "5yr", satisfaction: 80 }, { onConflict: "team_id,plan_type" });
  await supabase.from("board_profiles").upsert({ team_id: "t1", plan_type: "5yr", budget_modifier: 1.2 }, { onConflict: "team_id,plan_type" });
  assert.equal(supabase.state.board_profiles.length, 1, "samme conflict-nøgle skal merge, ikke duplikere");
  assert.equal(supabase.state.board_profiles[0].satisfaction, 80);
  assert.equal(supabase.state.board_profiles[0].budget_modifier, 1.2);
});

test("options.errors simulerer en fejl for en given tabel+action", async () => {
  const supabase = createFakeSupabase({ board_satisfaction_events: [] }, { errors: { board_satisfaction_events: { upsert: "boom" } } });
  const { error } = await supabase.from("board_satisfaction_events").upsert({ id: "e1" });
  assert.equal(error?.message, "boom");
  assert.equal(supabase.state.board_satisfaction_events.length, 0, "fejlet upsert skal ikke skrive noget");
});

test("state-referencen mutéres direkte (matcher reference-implementationen i boardAutoAccept.test.js #2473)", async () => {
  const state = { teams: [{ id: "t1", satisfaction: 50 }] };
  const supabase = createFakeSupabase(state);
  await supabase.from("teams").update({ satisfaction: 80 }).eq("id", "t1");
  assert.equal(state.teams[0].satisfaction, 80, "kaldere der holder deres egen reference skal se mutationen direkte");
});

// =====================================================================
// createRecorderSupabase — forward-guard for den "canned" variant
// =====================================================================

test("#2469 forward-guard (recorder-variant): narrow select() projicerer canned data ned", () => {
  const recorder = [];
  const supabase = createRecorderSupabase({
    race_results: [{ rank: 1, races: { race_class: "Monuments" }, secret: "x" }],
  }, recorder);

  return supabase.from("race_results").select("rank, races!inner(race_class)").eq("team_id", "t1").then(({ data }) => {
    assert.deepEqual(data, [{ rank: 1, races: { race_class: "Monuments" } }]);
    assert.ok(!("secret" in data[0]), "secret lækkede gennem en select der ikke bad om den");
    assert.deepEqual(recorder, [["eq", "race_results", "team_id", "t1"]]);
  });
});

test("recorder-variant registrerer gte/lte/in-filtre uden faktisk at filtrere rækkerne", async () => {
  const recorder = [];
  const supabase = createRecorderSupabase({ board_plan_snapshots: [{ season_number: 3 }] }, recorder);
  const { data } = await supabase.from("board_plan_snapshots").select("season_number").gte("season_number", 5);
  assert.deepEqual(data, [{ season_number: 3 }], "canned data returneres uanset gte — recorderen fanger filtret");
  assert.deepEqual(recorder, [["gte", "board_plan_snapshots", "season_number", 5]]);
});
