// #8521: dry-run-scriptets rene dele. Tallene er OPDIGTEDE testfixtures, ikke kalibrering.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  resolveOutDir, parseParams, parseArgs, currentRating, buildReport, renderMarkdown, applyReport, prognosisTop, prognosisTops,
} from "./potentialP6110Convert.mjs";
import { buildTypePrognosisBands } from "../lib/scoutingReport.js";
import { displayPotentialBand } from "../lib/potentialDisplayBand.js";
import { SCOUTING_CONFIG } from "../lib/scouting.js";
import { DEFAULT_SCOUT } from "../lib/scoutEngine.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { REGISTRY_ABILITY_KEYS } from "../lib/abilityRegistry.js";

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

// ── Ejervalg 21/11: unge over deres nye P (#8521) ─────────────────────────────

/** Fødselsdato der giver sæson-alderen `age` i sæson 1 (uden at kende referenceåret). */
function birthdateForAge(age) {
  const base = ageForSeason("2000-06-15", 1);
  return `${2000 + (base - age)}-06-15`;
}
const TYPE = RIDER_TYPE_KEYS[0];
/** Opdigtede, lave evner: rytteren er ung og langt fra sin top. */
const LOW_ABILITIES = Object.freeze(Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k) => [k, 30])));

test("prognosisTop: samme bånd som ruterne viser for egne ryttere (maxLevel, holdet som seed, standard-scout)", () => {
  const rider = { id: "y", potentiale: 5, primary_type: TYPE, secondary_type: null, team_id: "hold-a" };
  const age = 21;
  const expected = buildTypePrognosisBands({
    nowAbilities: LOW_ABILITIES, age, primaryType: TYPE, secondaryType: null, potentiale: 5,
    level: SCOUTING_CONFIG.maxLevel, riderId: "y", teamId: "hold-a", scout: DEFAULT_SCOUT, developmentXp: null,
  }).find((b) => b.key === TYPE).progHi;
  assert.equal(prognosisTop(rider, LOW_ABILITIES, { age }), expected);
  assert.equal(prognosisTop(rider, null, { age }), null, "uden evner ingen prognose");
  assert.equal(prognosisTop({ ...rider, primary_type: null }, LOW_ABILITIES, { age }), null);
  assert.equal(prognosisTop(rider, LOW_ABILITIES, { age: null }), null);
});

test("buildReport: unge over deres nye P får toppen af forventet niveau og tælles for sig", () => {
  const rows = [
    // Ung, rating langt over 1-stjernes ankre -> prognosens top (mindst ratingen).
    { id: "young", potentiale: 1, best_role_rating: 40, birthdate: birthdateForAge(21), primary_type: TYPE, team_id: "hold-a" },
    // Ung uden evner -> ingen prognose -> hæves til ratingen.
    { id: "young-noab", potentiale: 1, best_role_rating: 40, birthdate: birthdateForAge(22), primary_type: TYPE, team_id: "hold-a" },
    // 28+ -> ratingen som i dag.
    { id: "old", potentiale: 1, best_role_rating: 40, birthdate: birthdateForAge(30), primary_type: TYPE, team_id: "hold-b" },
    // Ung under sit P -> uændret.
    { id: "young-under", potentiale: 6, best_role_rating: 10, birthdate: birthdateForAge(20), primary_type: TYPE, team_id: "hold-b" },
  ];
  const abilitiesById = new Map([["young", LOW_ABILITIES], ["young-under", LOW_ABILITIES], ["old", LOW_ABILITIES]]);
  const report = buildReport(rows, abilitiesById, FIXTURE, { asOf: AS_OF, source: "test", seasonNumber: 1 });
  const by = Object.fromEntries(report.riders.map((r) => [r.id, r]));
  const rating = by.young.rating;
  const top = prognosisTop(rows[0], LOW_ABILITIES, { age: 21 });
  assert.equal(by.young.age, 21);
  assert.equal(by.young.p, Math.max(top, Math.round(rating)));
  assert.equal(by.young.liftedToPrognosis, true);
  assert.equal(by["young-noab"].liftedToPrognosis, false);
  assert.equal(by["young-noab"].p, 40);
  assert.equal(by.old.liftedToPrognosis, false);
  assert.equal(by.old.p, Math.round(by.old.rating));
  assert.equal(by.old.prognosisHi, null, "prognosen regnes kun for unge");
  assert.equal(by["young-under"].lifted, false);
  assert.equal(by["young-under"].p, by["young-under"].pBase);
  assert.equal(report.counts.liftedToPrognosis, 1);
  assert.equal(report.counts.liftedToRating, 2);
  assert.equal(report.counts.youngLiftedWithoutPrognosis, 1);
  assert.equal(report.counts.withoutAge, 0);
  assert.equal(report.rankViolations, 0);
  assert.equal(report.seasonNumber, 1);
  assert.equal(report.perStars["1"].liftedToPrognosis, 1);
  const md = renderMarkdown(report);
  assert.match(md, /toppen af forventet niveau: 1/);
});

test("prognosisTops: viste bånd er tabellernes valg; reglen bruger stadig primær type", () => {
  const rider = { id: "y", potentiale: 5, primary_type: TYPE, secondary_type: null, team_id: "hold-a" };
  const bands = buildTypePrognosisBands({
    nowAbilities: LOW_ABILITIES, age: 21, primaryType: TYPE, secondaryType: null, potentiale: 5,
    level: SCOUTING_CONFIG.maxLevel, riderId: "y", teamId: "hold-a",
  });
  const tops = prognosisTops(rider, LOW_ABILITIES, { age: 21 });
  assert.equal(tops.primaryHi, bands.find((b) => b.key === TYPE).progHi);
  assert.equal(tops.displayHi, displayPotentialBand(bands, TYPE).progHi);
  assert.equal(prognosisTop(rider, LOW_ABILITIES, { age: 21 }), tops.primaryHi);
  const lowStar = { ...rider, potentiale: 1, best_role_rating: 40, birthdate: birthdateForAge(21) };
  const report = buildReport([lowStar], new Map([["y", LOW_ABILITIES]]), FIXTURE, { asOf: AS_OF, source: "test", seasonNumber: 1 });
  const row = report.riders[0];
  assert.equal(row.displayHi, prognosisTops(lowStar, LOW_ABILITIES, { age: 21 }).displayHi);
  assert.equal(report.counts.liftedToPrognosisBelowDisplayed, row.liftedToPrognosis && row.displayHi > row.p ? 1 : 0);
});

test("buildReport: uden sæson er ingen ung, og resultatet er dagens regel", () => {
  const rows = [{ id: "young", potentiale: 1, best_role_rating: 40, birthdate: birthdateForAge(21), primary_type: TYPE, team_id: "hold-a" }];
  const report = buildReport(rows, new Map([["young", LOW_ABILITIES]]), FIXTURE, { asOf: AS_OF, source: "test" });
  assert.equal(report.counts.liftedToPrognosis, 0);
  assert.equal(report.counts.withoutAge, 1);
  assert.equal(report.riders[0].p, Math.round(report.riders[0].rating));
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
