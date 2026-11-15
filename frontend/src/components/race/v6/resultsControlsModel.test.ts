// #7860 · Resultater i v6: søgning og "Mit hold".
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_RESULTS_CONTROLS,
  filterResultRows,
  isFiltering,
  normalizeSearchText,
  rowMatchesQuery,
  rowTeamId,
  mineOnlyFromTeamFilter,
  sharedMineControls,
  teamFilterAfterMineToggle,
} from "./resultsControlsModel.ts";

const rows = [
  { rider_id: "r1", rank: 1, rider: { firstname: "Tadej", lastname: "Pogačar", team: { id: "tA", name: "Hold A" } } },
  { rider_id: "r2", rank: 2, rider: { firstname: "Søren", lastname: "Kragh", team: { id: "tB", name: "Hold B" } } },
  { rider_id: "r3", rank: 3, rider_name: "Zoë Example", team_id: "tA", team_name: "Hold A" },
  { rider_id: "r4", rank: 4, rider: { firstname: "Free", lastname: "Agent", team: null } },
];
const teamRows = [
  { team_id: "tB", rank: 1, team: { id: "tB", name: "Hold B" } },
  { team_id: "tA", rank: 2, team_name: "Hold A" },
];
const dnfRows = [{ id: "dnf-r9", rider_id: "r9", name: "Lars Udgaaet", team_id: "tA", team_name: "Hold A" }];

test("normalisering fjerner accenter og nordiske tegn", () => {
  assert.equal(normalizeSearchText("  Pogačar "), "pogacar");
  assert.equal(normalizeSearchText("Søren  Ærø Ål"), "soren aero al");
  assert.equal(normalizeSearchText("Zoë"), "zoe");
  assert.equal(normalizeSearchText(null), "");
});

test("søgning matcher rytternavn og holdnavn, alle ord, uanset rækkefølge", () => {
  assert.ok(rowMatchesQuery(rows[0], "pogacar"));
  assert.ok(rowMatchesQuery(rows[0], "pogacar tadej"));
  assert.ok(rowMatchesQuery(rows[1], "soren"));
  assert.ok(rowMatchesQuery(rows[1], "hold b"));
  assert.ok(rowMatchesQuery(rows[2], "zoe"));
  assert.ok(!rowMatchesQuery(rows[0], "kragh"));
  assert.ok(rowMatchesQuery(rows[0], "   "), "tom søgning matcher alt");
});

test("tom tilstand filtrerer intet og bevarer rækkefølgen", () => {
  assert.deepEqual(filterResultRows(rows, EMPTY_RESULTS_CONTROLS, "tA").map((r) => r.rider_id), ["r1", "r2", "r3", "r4"]);
  assert.equal(isFiltering(EMPTY_RESULTS_CONTROLS), false);
  assert.equal(isFiltering({ query: "  ", mineOnly: false }), false);
  assert.deepEqual(filterResultRows(null, EMPTY_RESULTS_CONTROLS, null), []);
});

test("Mit hold viser kun egne ryttere, også fra team_id uden indlejret hold", () => {
  const state = { query: "", mineOnly: true };
  assert.equal(isFiltering(state), true);
  assert.deepEqual(filterResultRows(rows, state, "tA").map((r) => r.rider_id), ["r1", "r3"]);
});

test("Mit hold uden eget hold filtrerer intet", () => {
  assert.equal(filterResultRows(rows, { query: "", mineOnly: true }, null).length, rows.length);
});

test("Mit hold og søgning kombineres", () => {
  assert.deepEqual(filterResultRows(rows, { query: "zoe", mineOnly: true }, "tA").map((r) => r.rider_id), ["r3"]);
  assert.deepEqual(filterResultRows(rows, { query: "kragh", mineOnly: true }, "tA"), []);
});

test("holdklassementet: søg på holdnavn og Mit hold på holdets egen række", () => {
  assert.deepEqual(filterResultRows(teamRows, { query: "hold a", mineOnly: false }, null).map((r) => r.team_id), ["tA"]);
  assert.deepEqual(filterResultRows(teamRows, { query: "", mineOnly: true }, "tB").map((r) => r.team_id), ["tB"]);
});

test("DNF-rækker kan søges og filtreres på samme måde", () => {
  assert.deepEqual(filterResultRows(dnfRows, { query: "lars", mineOnly: false }, null).length, 1);
  assert.deepEqual(filterResultRows(dnfRows, { query: "", mineOnly: true }, "tB").length, 0);
});

test("holdets id læses fra team_id, rytterens hold eller team-embed", () => {
  assert.equal(rowTeamId(rows[0]), "tA");
  assert.equal(rowTeamId(rows[2]), "tA");
  assert.equal(rowTeamId(teamRows[0]), "tB");
  assert.equal(rowTeamId(rows[3]), null);
  assert.equal(rowTeamId({ team_id: 7 }), "7");
});

// ── #7865 punkt 4: "Mit hold" er eet valg ──

test("#7865: knappen og holdvaelgeren viser altid det samme Mit hold-valg", () => {
  assert.equal(mineOnlyFromTeamFilter("mine"), true);
  assert.equal(mineOnlyFromTeamFilter("all"), false);
  assert.equal(mineOnlyFromTeamFilter("tB"), false, "et andet hold valgt i vaelgeren: knappen er slaaet fra");
  assert.equal(teamFilterAfterMineToggle("all", true), "mine");
  assert.equal(teamFilterAfterMineToggle("tB", true), "mine", "knappen vinder over et andet hold");
  assert.equal(teamFilterAfterMineToggle("mine", false), "all");
  assert.equal(teamFilterAfterMineToggle("tB", false), "tB");
});

test("#7865: med delt valg skriver knappen til holdvaelgeren og filtrerer ikke selv paa hold", () => {
  let filter = "all";
  const shared = () => ({ on: mineOnlyFromTeamFilter(filter), set: (on: boolean) => { filter = teamFilterAfterMineToggle(filter, on); } });
  const local = { query: "", mineOnly: false };
  const a = sharedMineControls(local, shared());
  assert.equal(a.shown.mineOnly, false);
  const next = a.change({ ...a.shown, mineOnly: true });
  assert.equal(filter, "mine", "knappen satte holdvaelgeren");
  assert.equal(next.mineOnly, false, "tabellens egen tilstand holder ikke en anden kopi");
  const b = sharedMineControls(next, shared());
  assert.equal(b.shown.mineOnly, true, "knappen viser vaelgerens valg");
  assert.equal(b.filter.mineOnly, false, "holdet filtreres allerede af vaelgeren, ikke to gange");
  assert.equal(isFiltering(b.filter), false, "ingen 'Showing N of M' for Mit hold alene");
  filter = "tB";
  assert.equal(sharedMineControls(next, shared()).shown.mineOnly, false, "vaelgeren paa et andet hold: knappen slukker");
  // Uden delt valg: som foer (#7860).
  const own = sharedMineControls({ query: "", mineOnly: true }, null);
  assert.equal(own.filter.mineOnly, true);
  assert.deepEqual(own.change({ query: "x", mineOnly: false }), { query: "x", mineOnly: false });
});
