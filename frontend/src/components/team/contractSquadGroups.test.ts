import test from "node:test";
import assert from "node:assert/strict";
import { groupBySquadAndExpiry, type ContractRow } from "./contractsTabModel.ts";

test("expiry urgency stays first and each squad can be selected separately", () => {
  const base: ContractRow = { id: "r", name: "Rider", ovr: 50, potential: null, age: 20,
    endSeason: 5, salary: 100, newSalary: 120, value: 1200, maxSeasons: 1 };
  const rows: ContractRow[] = ["senior", "u23", "junior", "academy"].map((squad, i) => ({
    ...base, id: `r-${i}`, squad: squad as ContractRow["squad"],
  }));
  rows.push({ ...base, id: "later", squad: "u23", endSeason: 6 });
  rows.push({ ...base, id: "capped", squad: "junior", endSeason: 6, maxSeasons: 0 });
  const groups = groupBySquadAndExpiry(rows, 5, { sort: "name", dir: "asc" });
  assert.deepEqual(groups.map((g) => g.key), ["expiring-senior", "expiring-u23", "expiring-junior", "expiring-academy", "s6-u23", "atCap-junior"]);
  assert.equal(groups.flatMap((g) => g.rows).length, rows.length);
  assert.equal(new Set(groups.flatMap((g) => g.rows.map((r) => r.id))).size, rows.length);
});
