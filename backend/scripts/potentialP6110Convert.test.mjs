// #8521: dry-run-scriptets rene dele. Tallene er OPDIGTEDE testfixtures, ikke kalibrering.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  resolveOutDir, parseParams, parseArgs, currentRating, buildReport, renderMarkdown, applyReport,
} from "./potentialP6110Convert.mjs";

const FIXTURE = Object.freeze({
  anchors: {
    "1": [5, 14], "1.5": [15, 22], "2": [23, 30], "2.5": [31, 38], "3": [39, 46], "3.5": [47, 54],
    "4": [55, 62], "4.5": [63, 69], "5": [70, 75], "5.5": [76, 80], "6": [81, 84],
  },
});
const AS_OF = new Date("2026-11-20T12:00:00Z");

const ROWS = [
  { id: "a", potentiale: 1, best_role_rating: 3 },
  { id: "b", potentiale: 2, best_role_rating: 60 },
  { id: "c", potentiale: 6, best_role_rating: null },
  { id: "d", potentiale: null, best_role_rating: 40 },
  { id: "e", potentiale: 4.5, best_role_rating: 20, base_talent: 66, talent_ceiling: 66 },
];

test("resolveOutDir: kun under balance-internals", () => {
  const root = path.resolve("/repo");
  assert.equal(resolveOutDir(undefined, root), path.join(root, "balance-internals", "6110"));
  assert.throws(() => resolveOutDir(path.join(root, "reports")), /balance-internals/);
});

test("parseParams: accepterer objektet direkte eller under potentialP, afviser ugyldige", () => {
  assert.equal(parseParams(FIXTURE), FIXTURE);
  assert.equal(parseParams({ potentialP: FIXTURE }), FIXTURE);
  assert.throws(() => parseParams({ anchors: { ...FIXTURE.anchors, "2": [10, 30] } }), /overlap/);
});

test("parseArgs: --apply kræver --owner-go, ukendte flag afvises", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false });
  assert.deepEqual(parseArgs(["--apply", "--owner-go"]), { apply: true, ownerGo: true });
  assert.throws(() => parseArgs(["--apply"]), /--owner-go/);
  assert.throws(() => parseArgs(["--aply"]), /Unknown/);
});

test("currentRating: afledte evner vinder, ellers den gemte best_role_rating", () => {
  assert.equal(currentRating({ best_role_rating: 42 }, null), 42);
  assert.equal(currentRating({}, null), null);
});

test("buildReport: dry-run tæller, fordeler og hæver til rating uden at skrive", () => {
  const before = JSON.parse(JSON.stringify(ROWS));
  const report = buildReport(ROWS, new Map(), FIXTURE, { asOf: AS_OF, source: "test" });
  assert.deepEqual(ROWS, before, "inputtet (og dermed ratingen) ændres ikke");
  assert.equal(report.writes, "none");
  assert.equal(report.counts.rowsRead, 5);
  assert.equal(report.counts.missingPotentiale, 1);
  assert.equal(report.counts.converted, 4);
  assert.equal(report.counts.liftedToRating, 1);
  assert.equal(report.counts.withoutRating, 1);
  assert.equal(report.rankViolations, 0);
  const b = report.riders.find((r) => r.id === "b");
  assert.equal(b.p, 60);
  assert.equal(b.lifted, true);
  assert.equal(b.rating, 60);
  assert.equal(report.distribution.n, 4);
  assert.ok(report.perStars["2"].lifted === 1);
  // "e" har allerede sit P (fixturens midte for 4.5 er 66), så kun de andre ville ændres.
  assert.equal(report.riders.find((r) => r.id === "e").p, 66);
  assert.equal(report.counts.wouldChange, 3);
  const md = renderMarkdown(report);
  assert.match(md, /Rang-brud: 0/);
  assert.match(md, /Hævet til rating: 1/);
});

test("applyReport: skriver kun base_talent + talent_ceiling for ryttere der afviger", async () => {
  const report = buildReport(ROWS, new Map(), FIXTURE, { asOf: AS_OF, source: "test" });
  const updates = [];
  const sb = {
    from(table) {
      assert.equal(table, "riders");
      return {
        update(patch) {
          return { eq: async (col, id) => { updates.push({ id, col, patch }); return { error: null }; } };
        },
      };
    },
  };
  const { written } = await applyReport(sb, report, ROWS, { log: {} });
  assert.equal(written, 3);
  for (const u of updates) {
    assert.equal(u.col, "id");
    assert.deepEqual(Object.keys(u.patch).sort(), ["base_talent", "talent_ceiling"]);
    assert.equal(u.patch.base_talent, u.patch.talent_ceiling);
  }
  assert.ok(!updates.some((u) => u.id === "e"));
});

test("applyReport: nægter at skrive ved rang-brud", async () => {
  await assert.rejects(() => applyReport({ from() { throw new Error("must not write"); } }, { rankViolations: 1, riders: [] }, []), /rank violations/);
});
