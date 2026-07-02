import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeSnapshots, pickChartTypeKeys, typeSeries, seasonSegments,
  seasonDelta, seasonAbilityGains, dominantPlan, gainDayCount,
} from "./developmentReport.js";
import { riderTypeRating } from "./riderRating.js";

// #2000 stykke 5 — Udvikling-fanens rene aggregerings-helpers. Testet mod den
// ægte snapshot-form fra GET /api/riders/:id/development (rider_derived_
// ability_history): { snapshot_date, season_number, source, abilities }.

// Sprinter-tung evnevektor (13 rating-keys) med justérbare overrides.
function abilities(overrides = {}) {
  return {
    climbing: 10, time_trial: 12, flat: 30, tempo: 15, sprint: 40,
    acceleration: 45, punch: 20, endurance: 18, recovery: 16, durability: 22,
    descending: 14, cobblestone: 8, aggression: 12,
    ...overrides,
  };
}

const snap = (date, source, season, abil) => ({
  snapshot_date: date, source, season_number: season, abilities: abil ?? abilities(),
});

test("dedupeSnapshots: daily_training vinder over baseline på samme dato, sorteret ASC", () => {
  const rows = [
    snap("2026-06-30", "daily_training", 1, abilities({ sprint: 42 })),
    snap("2026-06-29", "baseline", 1, abilities()),
    snap("2026-06-29", "daily_training", 1, abilities({ sprint: 41 })),
  ];
  const out = dedupeSnapshots(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.snapshot_date), ["2026-06-29", "2026-06-30"]);
  assert.equal(out[0].source, "daily_training", "samme dato: daily_training-snapshotten (dagens sluttilstand) skal vinde");
  assert.equal(out[0].abilities.sprint, 41);
});

test("dedupeSnapshots: season_transition (nyt sæsonnummer) vinder over præ-transition daily på samme dato", () => {
  // Sæsonskifte-dagen: træningen kan have kørt FØR auto-transitionen, så dagens
  // daily-række bærer det gamle sæsonnummer + præ-progression-evner. Højeste
  // sæsonnummer skal vinde uanset source-prioritet (review-fund, stykke 5).
  const rows = [
    snap("2026-07-20", "daily_training", 1, abilities({ sprint: 44 })),
    snap("2026-07-20", "season_transition", 2, abilities({ sprint: 47 })),
  ];
  const out = dedupeSnapshots(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "season_transition");
  assert.equal(out[0].season_number, 2);
  // ...og symmetrisk: kører træningen EFTER transitionen (samme sæsonnummer),
  // vinder daily-rækken som dagens slut-tilstand.
  const out2 = dedupeSnapshots([
    snap("2026-07-20", "season_transition", 2, abilities({ sprint: 47 })),
    snap("2026-07-20", "daily_training", 2, abilities({ sprint: 48 })),
  ]);
  assert.equal(out2[0].source, "daily_training");
  assert.equal(out2[0].abilities.sprint, 48);
});

test("dedupeSnapshots: ugyldige rækker (manglende dato/abilities) droppes", () => {
  const out = dedupeSnapshots([null, { snapshot_date: "2026-06-29" }, { abilities: {} }, snap("2026-06-29", "baseline", 1)]);
  assert.equal(out.length, 1);
});

test("pickChartTypeKeys: primærtypen først, derefter top-2 øvrige efter rating", () => {
  const keys = ["sprinter", "tt", "climber", "puncheur", "rouleur"];
  const out = pickChartTypeKeys(abilities(), "puncheur", keys);
  assert.equal(out.length, 3);
  assert.equal(out[0], "puncheur", "stored primary_type skal altid være første/fremhævede serie");
  assert.ok(!out.slice(1).includes("puncheur"));
  // De to øvrige skal være de højest-ratede blandt resten.
  const ratings = keys.filter((k) => k !== "puncheur")
    .map((k) => ({ k, r: riderTypeRating(abilities(), k) }))
    .sort((a, b) => b.r - a.r);
  assert.deepEqual(out.slice(1).sort(), ratings.slice(0, 2).map((x) => x.k).sort());
});

test("pickChartTypeKeys: ukendt/manglende primærtype falder tilbage til højest-ratet", () => {
  const keys = ["sprinter", "tt", "climber"];
  const out = pickChartTypeKeys(abilities(), null, keys);
  assert.equal(out[0], "sprinter", "sprinter-tung vektor skal give sprinter som fallback-primær");
});

test("typeSeries: én rating pr. snapshot via rating-SSOT'en", () => {
  const snaps = dedupeSnapshots([
    snap("2026-06-29", "baseline", 1, abilities({ sprint: 40 })),
    snap("2026-06-30", "daily_training", 1, abilities({ sprint: 46 })),
  ]);
  const series = typeSeries(snaps, "sprinter");
  assert.equal(series.length, 2);
  assert.ok(series[1].rating >= series[0].rating, "højere sprint-evne må ikke give lavere sprinter-rating");
  assert.equal(series[0].rating, riderTypeRating(snaps[0].abilities, "sprinter"));
});

test("seasonSegments: grupperer konsekutive sæsoner og coalescer null til forrige kendte", () => {
  const snaps = [
    snap("2026-06-29", "baseline", 1),
    snap("2026-06-30", "daily_training", 1),
    snap("2026-07-01", "daily_training", null), // null → hører til sæson 1
    snap("2026-07-10", "season_transition", 2),
  ];
  const segs = seasonSegments(snaps);
  assert.deepEqual(segs.map((s) => s.season), [1, 2]);
  assert.deepEqual([segs[0].startIndex, segs[0].endIndex], [0, 2]);
  assert.deepEqual([segs[1].startIndex, segs[1].endIndex], [3, 3]);
});

test("seasonDelta: første → seneste snapshot inden for sæsonen; ukendt sæson → null", () => {
  const snaps = dedupeSnapshots([
    snap("2026-06-29", "baseline", 1, abilities({ sprint: 40, acceleration: 45 })),
    snap("2026-07-02", "daily_training", 1, abilities({ sprint: 48, acceleration: 50 })),
  ]);
  const d = seasonDelta(snaps, "sprinter", 1);
  assert.ok(d.delta > 0);
  assert.equal(d.to - d.from, d.delta);
  assert.equal(seasonDelta(snaps, "sprinter", 99), null);
});

test("seasonAbilityGains: kun positive deltaer, faldende, med totalPoints", () => {
  const snaps = dedupeSnapshots([
    snap("2026-06-29", "baseline", 1, abilities({ sprint: 40, endurance: 18, climbing: 10 })),
    snap("2026-07-02", "daily_training", 1, abilities({ sprint: 43, endurance: 19, climbing: 9 })),
  ]);
  const { gains, totalPoints } = seasonAbilityGains(snaps, 1);
  assert.deepEqual(gains.map((g) => g.ability), ["sprint", "endurance"], "fald (climbing −1) må ikke optræde som gevinst");
  assert.deepEqual(gains.map((g) => g.delta), [3, 1]);
  assert.equal(totalPoints, 4);
});

test("dominantPlan: hyppigste fokus + intensitet; null uden fokus-dage", () => {
  const entries = [
    { row: { focus: "sprint", intensity: "hard" } },
    { row: { focus: "sprint", intensity: "normal" } },
    { row: { focus: "sprint", intensity: "hard" } },
    { row: { focus: "endurance", intensity: "easy" } },
    { row: { focus: null, intensity: "rest" } },
  ];
  assert.deepEqual(dominantPlan(entries), { focus: "sprint", intensity: "hard" });
  assert.equal(dominantPlan([{ row: { focus: null } }]), null);
  assert.equal(dominantPlan([]), null);
});

test("gainDayCount: tæller kun dage med mindst én evne-gevinst", () => {
  const entries = [
    { row: { gains: { sprint: 1 } } },
    { row: { gains: {} } },
    { row: { gains: { endurance: 2, recovery: 1 } } },
    { row: {} },
  ];
  assert.equal(gainDayCount(entries), 2);
  assert.equal(gainDayCount(null), 0);
});
