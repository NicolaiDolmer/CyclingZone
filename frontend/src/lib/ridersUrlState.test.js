import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filtersToSearchParams,
  searchParamsToFilters,
} from "./ridersUrlState.js";

// Minimalt subset af DEFAULT_FILTERS (RiderFilters.jsx) — dækker alle typer
// (string, number, boolean) som encode/decode skal håndtere.
const DEFAULTS = {
  q: "",
  sort: "uci_points",
  sort_dir: "desc",
  nationality_code: "",
  min_uci: "",
  max_uci: "",
  u25: false,
  u23: false,
  free_agent: false,
  team_id: "",
  stat_bro_min: 50,
  stat_bro_max: 85,
  stat_fl_min: 50,
  stat_fl_max: 85,
  page: 1,
};

test("filtersToSearchParams — kun ikke-default værdier encodes", () => {
  const params = filtersToSearchParams({ ...DEFAULTS }, DEFAULTS);
  assert.equal(params.toString(), "");
});

test("filtersToSearchParams — tekst-filter encodes", () => {
  const params = filtersToSearchParams({ ...DEFAULTS, q: "Pogacar" }, DEFAULTS);
  assert.equal(params.get("q"), "Pogacar");
});

test("filtersToSearchParams — booleans encodes som '1'", () => {
  const params = filtersToSearchParams(
    { ...DEFAULTS, u25: true, free_agent: true },
    DEFAULTS,
  );
  assert.equal(params.get("u25"), "1");
  assert.equal(params.get("free_agent"), "1");
});

test("filtersToSearchParams — stat min/max encodes kun når forskellig fra default", () => {
  const params = filtersToSearchParams(
    { ...DEFAULTS, stat_bro_min: 70, stat_bro_max: 85, stat_fl_min: 50, stat_fl_max: 80 },
    DEFAULTS,
  );
  assert.equal(params.get("stat_bro_min"), "70");
  assert.equal(params.has("stat_bro_max"), false, "stat_bro_max=85 er default — skal ikke encodes");
  assert.equal(params.has("stat_fl_min"), false, "stat_fl_min=50 er default — skal ikke encodes");
  assert.equal(params.get("stat_fl_max"), "80");
});

test("filtersToSearchParams — sort/sort_dir encodes kun når forskellig fra default", () => {
  const params = filtersToSearchParams(
    { ...DEFAULTS, sort: "salary", sort_dir: "desc" },
    DEFAULTS,
  );
  assert.equal(params.get("sort"), "salary");
  assert.equal(params.has("sort_dir"), false, "sort_dir=desc er default");
});

test("filtersToSearchParams — tom-streng-filtre encodes ikke (default er '')", () => {
  const params = filtersToSearchParams(
    { ...DEFAULTS, min_uci: "", max_uci: "", q: "" },
    DEFAULTS,
  );
  assert.equal(params.toString(), "");
});

test("filtersToSearchParams — numeriske filtre som strings encodes når forskellig fra default", () => {
  const params = filtersToSearchParams(
    { ...DEFAULTS, min_uci: "100000", max_uci: "" },
    DEFAULTS,
  );
  assert.equal(params.get("min_uci"), "100000");
  assert.equal(params.has("max_uci"), false);
});

test("searchParamsToFilters — læser tekst, tal og booleans korrekt", () => {
  const params = new URLSearchParams("q=Pogacar&u25=1&stat_bro_min=70&page=3&min_uci=50000");
  const filters = searchParamsToFilters(params, DEFAULTS);
  assert.equal(filters.q, "Pogacar");
  assert.equal(filters.u25, true);
  assert.equal(filters.stat_bro_min, 70);
  assert.equal(filters.page, 3);
  assert.equal(filters.min_uci, "50000");
  // urørte defaults
  assert.equal(filters.sort, "uci_points");
  assert.equal(filters.sort_dir, "desc");
  assert.equal(filters.free_agent, false);
});

test("searchParamsToFilters — round-trip bevarer ikke-default filtre", () => {
  const original = {
    ...DEFAULTS,
    q: "test",
    u25: true,
    stat_bro_min: 70,
    sort: "salary",
    page: 2,
    min_uci: "10000",
  };
  const params = filtersToSearchParams(original, DEFAULTS);
  const restored = searchParamsToFilters(params, DEFAULTS);
  assert.deepEqual(restored, original);
});

test("searchParamsToFilters — ukendte query-nøgler ignoreres", () => {
  const params = new URLSearchParams("evil=1&q=ok&__proto__=hack");
  const filters = searchParamsToFilters(params, DEFAULTS);
  assert.equal(filters.evil, undefined);
  assert.equal(filters.q, "ok");
});

test("searchParamsToFilters — ugyldig page falder tilbage til default", () => {
  const params = new URLSearchParams("page=abc");
  const filters = searchParamsToFilters(params, DEFAULTS);
  assert.equal(filters.page, 1);
});
