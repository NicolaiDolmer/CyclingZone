// #6855: Kontrakter-fanens model. Dækker "sortering bevares ved navigation"
// (URL-parametrene overlever en tur ind på en rytter og tilbage, og truppens og
// fanens sortering overskriver ikke hinanden), grupperingen efter udløb,
// "2 (maks)"-reglen og bundlinjens summer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readContractsSort,
  readSquadSort,
  writeSortParams,
  cycleSort,
  groupByExpiry,
  effectiveSeasons,
  seasonOptions,
  buildItems,
  requestedSeasons,
  selectionTotals,
  compareRows,
  DEFAULT_CONTRACTS_SORT,
  CONTRACTS_SORT_PARAM,
  CONTRACTS_DIR_PARAM,
  SQUAD_SORT_PARAM,
  SQUAD_DIR_PARAM,
  type ContractRow,
} from "./contractsTabModel.ts";

function row(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    id: "r1", name: "Anna A", ovr: 60, potential: 70, age: 24, endSeason: 5,
    salary: 100, newSalary: 120, value: 1000, maxSeasons: 2, ...overrides,
  };
}

test("sortering bevares ved navigation: URL -> læs giver samme sortering, andre parametre røres ikke", () => {
  const start = new URLSearchParams("tab=contracts");
  const written = writeSortParams(start, CONTRACTS_SORT_PARAM, CONTRACTS_DIR_PARAM, { sort: "potential", dir: "asc" });
  assert.equal(written.get("tab"), "contracts");
  // En tur ind på en rytter og tilbage = browseren genskaber præcis denne URL.
  const restored = new URLSearchParams(written.toString());
  assert.deepEqual(readContractsSort(restored), { sort: "potential", dir: "asc" });
  // Den oprindelige params-instans er ikke muteret.
  assert.equal(start.get(CONTRACTS_SORT_PARAM), null);
});

test("sortering bevares ved navigation: truppens sort/dir og fanens csort/cdir lever side om side", () => {
  let params = new URLSearchParams("tab=squad");
  params = writeSortParams(params, SQUAD_SORT_PARAM, SQUAD_DIR_PARAM, { sort: "_scoutMid", dir: "desc" });
  params = writeSortParams(params, CONTRACTS_SORT_PARAM, CONTRACTS_DIR_PARAM, { sort: "salary", dir: "asc" });
  const back = new URLSearchParams(params.toString());
  assert.deepEqual(readSquadSort(back), { sort: "_scoutMid", sort_dir: "desc" });
  assert.deepEqual(readContractsSort(back), { sort: "salary", dir: "asc" });
});

test("ugyldige URL-værdier falder tilbage til standard", () => {
  assert.deepEqual(readContractsSort(new URLSearchParams("csort=evil&cdir=up")), DEFAULT_CONTRACTS_SORT);
  assert.deepEqual(readContractsSort(new URLSearchParams("")), DEFAULT_CONTRACTS_SORT);
  assert.equal(readContractsSort(new URLSearchParams("csort=name")).dir, "asc");
  assert.equal(readSquadSort(new URLSearchParams("sort=a;drop&dir=asc")), null);
  assert.equal(readSquadSort(new URLSearchParams("sort=salary&dir=sideways")), null);
  assert.equal(readSquadSort(new URLSearchParams("")), null);
});

test("cycleSort: samme kolonne vender, ny kolonne starter i sin naturlige retning", () => {
  assert.deepEqual(cycleSort({ sort: "ovr", dir: "desc" }, "ovr"), { sort: "ovr", dir: "asc" });
  assert.deepEqual(cycleSort({ sort: "ovr", dir: "desc" }, "name"), { sort: "name", dir: "asc" });
  assert.deepEqual(cycleSort({ sort: "name", dir: "asc" }, "potential"), { sort: "potential", dir: "desc" });
});

test("groupByExpiry: udløber denne sæson øverst, så S6, S7, loftet sidst; sortering inden for gruppen", () => {
  const rows = [
    row({ id: "cap", name: "Cap C", endSeason: 7, maxSeasons: 0 }),
    row({ id: "s7", name: "Late L", endSeason: 7, maxSeasons: 0 }),
    row({ id: "s6", name: "Six S", endSeason: 6, maxSeasons: 1 }),
    row({ id: "exp1", name: "Exp B", endSeason: 4, maxSeasons: 3, ovr: 50 }),
    row({ id: "exp2", name: "Exp A", endSeason: null, maxSeasons: 3, ovr: 80 }),
    row({ id: "s5", name: "Five F", endSeason: 5, maxSeasons: 2 }),
  ];
  const groups = groupByExpiry(rows, 4, { sort: "ovr", dir: "desc" });
  assert.deepEqual(groups.map((g) => g.key), ["expiring", "s5", "s6", "atCap"]);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["exp2", "exp1"]);
  assert.deepEqual(groups[3].rows.map((r) => r.id).sort(), ["cap", "s7"]);
});

test("compareRows: manglende værdier står sidst i begge retninger", () => {
  const a = row({ id: "a", name: "A", potential: null });
  const b = row({ id: "b", name: "B", potential: 50 });
  assert.ok(compareRows(a, b, { sort: "potential", dir: "desc" }) > 0);
  assert.ok(compareRows(a, b, { sort: "potential", dir: "asc" }) > 0);
});

test("loft: vælger 3, rytter kan kun få 2 -> får 2, og 2 er markeret (maks)", () => {
  assert.equal(effectiveSeasons(3, 2), 2);
  assert.equal(effectiveSeasons(1, 2), 1);
  assert.equal(effectiveSeasons(2, 0), 0);
  assert.deepEqual(seasonOptions(2), [{ value: 1, atMax: false }, { value: 2, atMax: true }]);
  assert.deepEqual(seasonOptions(3).map((o) => o.atMax), [false, false, false]);
  assert.deepEqual(seasonOptions(0), []);
});

test("fælles valg gælder alle valgte, egen rettelse vinder", () => {
  const selection = { a: null, b: 1 };
  assert.equal(requestedSeasons(selection, "a", 3), 3);
  assert.equal(requestedSeasons(selection, "b", 3), 1);
  assert.deepEqual(buildItems(selection, 2), [{ riderId: "a", seasons: 2 }, { riderId: "b", seasons: 1 }]);
});

test("selectionTotals: antal valgte og lønsum-ændring pr. sæson ud fra quotens tal", () => {
  const rows = [row({ id: "a", salary: 100, newSalary: 150 }), row({ id: "b", salary: 300, newSalary: 200 }), row({ id: "c" })];
  assert.deepEqual(selectionTotals(rows, { a: null, b: 2 }), { count: 2, salaryDelta: -50 });
  assert.deepEqual(selectionTotals(rows, {}), { count: 0, salaryDelta: 0 });
});
