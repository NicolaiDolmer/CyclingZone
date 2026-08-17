import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRidersByFilter, applyRiderColumnSort } from "./riderColumnSort.js";

// ── compareRidersByFilter: _scoutMid (#3787) ────────────────────────────────
// Klient-side potentiale-sortering (Mit Hold, Ønskeliste, Auktioner) driver
// via denne komparator på den dekorerede `_scoutMid`-nøgle (scoutSortValue,
// scouting.js). Efter #3787 er `_scoutMid` `null` for ryttere uden synligt
// estimat i stedet for 0 — komparatoren skal placere dem sidst, UANSET
// sorteringsretning, i stedet for at kollidere null med 0 på skalaen.

test("compareRidersByFilter: _scoutMid sorterer numerisk stigende (asc)", () => {
  const a = { _scoutMid: 70 };
  const b = { _scoutMid: 81 };
  const filters = { sort: "_scoutMid", sort_dir: "asc" };
  assert.ok(compareRidersByFilter(a, b, filters) < 0);
  assert.ok(compareRidersByFilter(b, a, filters) > 0);
});

test("compareRidersByFilter: _scoutMid sorterer numerisk faldende (desc)", () => {
  const a = { _scoutMid: 70 };
  const b = { _scoutMid: 81 };
  const filters = { sort: "_scoutMid", sort_dir: "desc" };
  assert.ok(compareRidersByFilter(a, b, filters) > 0);
  assert.ok(compareRidersByFilter(b, a, filters) < 0);
});

test("compareRidersByFilter: _scoutMid=null (intet synligt estimat) sorterer ALTID sidst — asc", () => {
  const scouted = { _scoutMid: 70 };
  const unscouted = { _scoutMid: null };
  const filters = { sort: "_scoutMid", sort_dir: "asc" };
  // unscouted efter scouted, uanset at 70 > 0 ville have placeret den først
  // hvis null var faldet tilbage til 0.
  assert.ok(compareRidersByFilter(unscouted, scouted, filters) > 0);
  assert.ok(compareRidersByFilter(scouted, unscouted, filters) < 0);
});

test("compareRidersByFilter: _scoutMid=null sorterer ALTID sidst — desc (ikke bare toppen fordi 0 var 'lavest')", () => {
  const scouted = { _scoutMid: 70 };
  const unscouted = { _scoutMid: null };
  const filters = { sort: "_scoutMid", sort_dir: "desc" };
  assert.ok(compareRidersByFilter(unscouted, scouted, filters) > 0);
  assert.ok(compareRidersByFilter(scouted, unscouted, filters) < 0);
});

test("compareRidersByFilter: to null _scoutMid er lige", () => {
  const filters = { sort: "_scoutMid", sort_dir: "asc" };
  assert.equal(compareRidersByFilter({ _scoutMid: null }, { _scoutMid: null }, filters), 0);
});

// ── applyRiderColumnSort: server-side rytter-DB (#3787) ─────────────────────
// Fake supabase-query-builder: fanger .order()-kaldene i stedet for at ramme
// databasen. Rytter-DB'en (RidersPage) har hverken en potentiale-kolonne
// (#1537) eller adgang til den rå potentiale (#1162) — en stale "potentiale"/
// "_scoutMid" sort-nøgle må derfor ikke stille blive tolket som "sortér efter
// værdi" (den invertérbare sidekanal #2798 advarer imod).
function fakeQuery() {
  const calls = [];
  const q = {
    order(column, opts) {
      calls.push({ column, opts });
      return q;
    },
  };
  q.calls = calls;
  return q;
}

test("applyRiderColumnSort: 'value' sorterer eksplicit på market_value (uændret, intentionelt)", () => {
  const q = fakeQuery();
  applyRiderColumnSort(q, { sort: "value", sort_dir: "desc" });
  assert.equal(q.calls[0].column, "market_value");
});

test("applyRiderColumnSort: stale 'potentiale'-nøgle falder IKKE tavst til market_value", () => {
  const q = fakeQuery();
  applyRiderColumnSort(q, { sort: "potentiale", sort_dir: "desc" });
  assert.notEqual(q.calls[0].column, "market_value");
  assert.equal(q.calls[0].column, "lastname");
});

test("applyRiderColumnSort: stale '_scoutMid'-nøgle falder IKKE tavst til market_value", () => {
  const q = fakeQuery();
  applyRiderColumnSort(q, { sort: "_scoutMid", sort_dir: "asc" });
  assert.notEqual(q.calls[0].column, "market_value");
  assert.equal(q.calls[0].column, "lastname");
});
