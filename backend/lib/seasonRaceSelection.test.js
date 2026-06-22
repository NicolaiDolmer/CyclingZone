import test from "node:test";
import assert from "node:assert/strict";
import {
  selectSeasonRaces,
  selectFirstSeasonRaces,
  makeStableShuffler,
  DEFAULT_RACE_DAYS_TARGET,
  FIRST_SEASON_STAGE_RACE_QUOTA,
} from "./seasonRaceSelection.js";

function makeRace({ name, race_class, race_type = "single", stages = 1, id }) {
  return { id: id ?? name, name, race_class, race_type, stages };
}

test("selectSeasonRaces — vælger løb indtil race_days_target nås", () => {
  const pool = Array.from({ length: 50 }, (_, i) =>
    makeRace({ name: `R${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const result = selectSeasonRaces({ pool, raceDaysTarget: 30 });
  assert.equal(result.totalRaceDays, 30);
  assert.equal(result.selectedCount, 30);
  assert.equal(result.omitted.length, 20);
  assert.ok(result.omitted.every((o) => o.reason === "target_reached"));
});

test("selectSeasonRaces — sæson 1 ekskluderer alle WT-klasser via excludeClasses", () => {
  const pool = [
    makeRace({ name: "Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 }),
    makeRace({ name: "Sanremo", race_class: "Monuments", stages: 1 }),
    makeRace({ name: "Burgos", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Surf Coast", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectFirstSeasonRaces(pool, { raceDaysTarget: 60 });
  assert.ok(result.selected.every((r) => r.race_class === "ProSeries"));
  assert.equal(result.selected.length, 2);
  assert.equal(result.totalRaceDays, 6);
});

test("selectSeasonRaces — overshootTolerance forhindrer at stort etapeløb skubber over", () => {
  const pool = [
    makeRace({ name: "Big", race_class: "ProSeries", race_type: "stage_race", stages: 21 }),
    makeRace({ name: "Small", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 5,
    overshootTolerance: 2,
  });
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, "Small");
  assert.equal(result.totalRaceDays, 1);
  assert.equal(result.omitted[0].reason, "would_overshoot");
});

test("selectSeasonRaces — er deterministisk (samme input → samme output)", () => {
  const pool = [
    makeRace({ name: "Beta", race_class: "ProSeries", stages: 3 }),
    makeRace({ name: "Alpha", race_class: "ProSeries", stages: 2 }),
    makeRace({ name: "Gamma", race_class: "ProSeries", stages: 4 }),
  ];
  const a = selectSeasonRaces({ pool, raceDaysTarget: 100 });
  const b = selectSeasonRaces({ pool, raceDaysTarget: 100 });
  assert.deepEqual(
    a.selected.map((r) => r.name),
    b.selected.map((r) => r.name),
  );
});

test("selectSeasonRaces — tom pool returnerer tom liste", () => {
  const result = selectSeasonRaces({ pool: [], raceDaysTarget: 60 });
  assert.equal(result.selectedCount, 0);
  assert.equal(result.totalRaceDays, 0);
});

test("selectSeasonRaces — includeClasses begrænser kandidater", () => {
  const pool = [
    makeRace({ name: "A", race_class: "ProSeries", stages: 1 }),
    makeRace({ name: "B", race_class: "Class1", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    includeClasses: ["ProSeries"],
    raceDaysTarget: 60,
  });
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, "A");
});

test("selectSeasonRaces — DEFAULT_RACE_DAYS_TARGET = 60 (matcher seasons.race_days_total)", () => {
  assert.equal(DEFAULT_RACE_DAYS_TARGET, 60);
});

test("selectFirstSeasonRaces — accepterer override af raceDaysTarget", () => {
  const pool = Array.from({ length: 100 }, (_, i) =>
    makeRace({ name: `R${i}`, race_class: "ProSeries", stages: 1 }),
  );
  // Override quota=0 så denne backward-compat-test ikke trækker i sæson-1-defaulten.
  const result = selectFirstSeasonRaces(pool, { raceDaysTarget: 30, stageRaceQuota: 0 });
  assert.equal(result.totalRaceDays, 30);
});

// ─── stageRaceQuota tests ────────────────────────────────────────────────────

test("stageRaceQuota=0 → backward compatible (race_type ASC: single før stage_race)", () => {
  const pool = [
    makeRace({ name: "Beta", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Alpha", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({ pool, raceDaysTarget: 10, stageRaceQuota: 0 });
  // race_type ASC: "single" < "stage_race" → Alpha først, derefter Beta
  assert.equal(result.selected[0].name, "Alpha");
  assert.equal(result.selected[1].name, "Beta");
});

test("stageRaceQuota=2 fra whitelist IDs → vælger prioriterede stage races først", () => {
  const pool = [
    makeRace({ id: "cro", name: "CRO Race", race_class: "ProSeries", race_type: "stage_race", stages: 6 }),
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "algarve", name: "Volta ao Algarve", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "filler", name: "Filler Single", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    stageRaceQuota: 2,
    prioritizedStageRaceIds: ["oman", "algarve", "cro"],
  });
  const stageNames = result.selected.filter((r) => r.race_type === "stage_race").map((r) => r.name);
  // Whitelist [oman, algarve, cro] med quota=2 → tag de første 2 (oman, algarve)
  // CRO Race tilføjes senere i Phase 3 fill (selv om den ikke er i quota)
  assert.equal(stageNames[0], "Tour of Oman");
  assert.equal(stageNames[1], "Volta ao Algarve");
});

test("tom prioritizedStageRaceIds + quota>0 → quota fyldes seedet (ikke alfabetisk)", () => {
  const pool = [
    makeRace({ id: "z", name: "Zeta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "a", name: "Alpha Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "b", name: "Beta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  ];
  const opts = {
    pool,
    raceDaysTarget: 15,
    overshootTolerance: 5,
    stageRaceQuota: 2,
    prioritizedStageRaceIds: [],
    seed: 1,
  };
  const result = selectSeasonRaces(opts);
  // Tom whitelist → quota fyldes fra det seedet-shufflede supplement (ikke alfabetisk).
  const stageCount = result.selected.filter((r) => r.race_type === "stage_race").length;
  assert.ok(stageCount >= 2, "quota=2 skal give mindst 2 etapeløb");
  // Samme seed → samme udvælgelse (reproducerbar).
  const again = selectSeasonRaces(opts);
  assert.deepEqual(
    result.selected.map((r) => r.name),
    again.selected.map((r) => r.name),
  );
});

test("stale prioritizedStageRaceIds (ikke i pool) ignoreres stille", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    stageRaceQuota: 3,
    prioritizedStageRaceIds: ["deleted-id-1", "oman", "deleted-id-2"],
  });
  // Kun "oman" findes; algoritmen ignorerer de 2 stale IDs uden crash
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, "Tour of Oman");
});

test("stageRaceQuota > whitelist-matches → whitelist først, supplér seedet fra remaining", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
    makeRace({ id: "z", name: "Zeta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
    makeRace({ id: "b", name: "Beta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
    makeRace({ id: "a", name: "Alpha Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 12,
    overshootTolerance: 0,
    stageRaceQuota: 3,
    prioritizedStageRaceIds: ["oman"],
    seed: 1,
  });
  // Whitelist-prioritet bevares: oman vælges først. Resten af quota'en (2) fyldes
  // seedet fra remaining (Alpha/Beta/Zeta) — rækkefølgen er ikke alfabetisk.
  assert.equal(result.selected[0].name, "Tour of Oman");
  const stageCount = result.selected.filter((r) => r.race_type === "stage_race").length;
  assert.equal(stageCount, 3, "quota=3: oman + 2 supplement (12 dage = target)");
});

test("stageRaceQuota > total stage races → tag alle uden crash", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "s1", name: "Single A", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    stageRaceQuota: 8,
    prioritizedStageRaceIds: ["oman"],
  });
  assert.equal(result.selected.length, 2);
  assert.equal(result.totalRaceDays, 6);
});

test("boostSingleRaceIds tilføjes efter quota hvis plads", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "tre", name: "Tre Valli Varesine", race_class: "ProSeries", stages: 1 }),
    makeRace({ id: "trof", name: "Trofeo Laigueglia", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    stageRaceQuota: 1,
    prioritizedStageRaceIds: ["oman"],
    boostSingleRaceIds: ["tre", "trof"],
  });
  const names = result.selected.map((r) => r.name);
  assert.ok(names.includes("Tour of Oman"));
  assert.ok(names.includes("Tre Valli Varesine"));
  assert.ok(names.includes("Trofeo Laigueglia"));
});

test("quota respekterer overshootTolerance — skipper stage race der ville sprænge", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "algarve", name: "Volta ao Algarve", race_class: "ProSeries", race_type: "stage_race", stages: 21 }),
    makeRace({ id: "filler", name: "Filler", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 5,
    overshootTolerance: 2,
    stageRaceQuota: 2,
    prioritizedStageRaceIds: ["oman", "algarve"],
  });
  const stageNames = result.selected.filter((r) => r.race_type === "stage_race").map((r) => r.name);
  assert.deepEqual(stageNames, ["Tour of Oman"]);
});

test("quota dedup'er — samme race vælges ikke to gange via whitelist + fill", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "s1", name: "Single A", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    stageRaceQuota: 1,
    prioritizedStageRaceIds: ["oman"],
  });
  const omanCount = result.selected.filter((r) => r.name === "Tour of Oman").length;
  assert.equal(omanCount, 1);
});

test("selectFirstSeasonRaces — default quota=8 garanterer mindst 8 etapeløb (seedet fill)", () => {
  const stageRaces = Array.from({ length: 10 }, (_, i) =>
    makeRace({ id: `s${i}`, name: `StageRace${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  );
  const singles = Array.from({ length: 30 }, (_, i) =>
    makeRace({ id: `sg${i}`, name: `Single${i}`, race_class: "ProSeries", stages: 1 }),
  );
  // Tom whitelist → quota=8 fyldes fra det seedet-shufflede supplement (ikke alfabetisk).
  // Phase 3-fill kan tilføje flere etapeløb, så quota er et minimum, ikke et loft.
  const result = selectFirstSeasonRaces([...stageRaces, ...singles], { raceDaysTarget: 60 });
  const selectedStage = result.selected.filter((r) => r.race_type === "stage_race").length;
  assert.ok(selectedStage >= 8, `quota=8 garanterer mindst 8 etapeløb (fik ${selectedStage})`);
  assert.equal(FIRST_SEASON_STAGE_RACE_QUOTA, 8);
});

test("selectFirstSeasonRaces — caller kan override quota til 0", () => {
  const stageRaces = Array.from({ length: 3 }, (_, i) =>
    makeRace({ id: `s${i}`, name: `StageRace${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  );
  const singles = Array.from({ length: 30 }, (_, i) =>
    makeRace({ id: `sg${i}`, name: `Single${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const result = selectFirstSeasonRaces([...stageRaces, ...singles], {
    raceDaysTarget: 60,
    stageRaceQuota: 0,
  });
  assert.equal(result.selected.filter((r) => r.race_type === "stage_race").length, 3);
});

test("WT-klasser ekskluderet selv med stageRaceQuota=8", () => {
  const pool = [
    makeRace({ id: "tdf", name: "Tour de France", race_class: "TourFrance", race_type: "stage_race", stages: 21 }),
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  ];
  const result = selectFirstSeasonRaces(pool, {
    raceDaysTarget: 60,
    prioritizedStageRaceIds: ["tdf", "oman"],
  });
  // Selvom Tour de France er i whitelisten ekskluderes den via excludeClasses
  assert.ok(result.selected.every((r) => r.race_class === "ProSeries"));
  assert.ok(!result.selected.some((r) => r.name === "Tour de France"));
});

test("stale boostSingleRaceIds ignoreres stille", () => {
  const pool = [
    makeRace({ id: "tre", name: "Tre Valli Varesine", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    boostSingleRaceIds: ["deleted-id-1", "tre", "deleted-id-2"],
  });
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, "Tre Valli Varesine");
});

test("determinisme — quota+boost giver samme output ved gentagne kald", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "alps", name: "Tour of the Alps", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "tre", name: "Tre Valli Varesine", race_class: "ProSeries", stages: 1 }),
    makeRace({ id: "rng", name: "Random Single", race_class: "ProSeries", stages: 1 }),
  ];
  const a = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    stageRaceQuota: 2,
    prioritizedStageRaceIds: ["oman", "alps"],
    boostSingleRaceIds: ["tre"],
  });
  const b = selectSeasonRaces({
    pool,
    raceDaysTarget: 60,
    stageRaceQuota: 2,
    prioritizedStageRaceIds: ["oman", "alps"],
    boostSingleRaceIds: ["tre"],
  });
  assert.deepEqual(
    a.selected.map((r) => r.name),
    b.selected.map((r) => r.name),
  );
});

// ─── makeStableShuffler (eksporteret helper, #1714) ──────────────────────────

test("makeStableShuffler — deterministisk pr. seed (samme seed → samme rækkefølge)", () => {
  const arr = Array.from({ length: 20 }, (_, i) =>
    makeRace({ id: `r${String(i).padStart(2, "0")}`, name: `R${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const a = makeStableShuffler(123)(arr).map((r) => r.id);
  const b = makeStableShuffler(123)(arr).map((r) => r.id);
  assert.deepEqual(a, b);
});

test("makeStableShuffler — forskellige seeds → forskellig rækkefølge", () => {
  const arr = Array.from({ length: 20 }, (_, i) =>
    makeRace({ id: `r${String(i).padStart(2, "0")}`, name: `R${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const a = makeStableShuffler(1)(arr).map((r) => r.id);
  const b = makeStableShuffler(2)(arr).map((r) => r.id);
  assert.notDeepEqual(a, b);
});

test("makeStableShuffler — input-rækkefølge er ligegyldig (sorterer stabilt på key først)", () => {
  const base = Array.from({ length: 12 }, (_, i) =>
    makeRace({ id: `r${String(i).padStart(2, "0")}`, name: `R${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const reversed = base.slice().reverse();
  const a = makeStableShuffler(7)(base).map((r) => r.id);
  const b = makeStableShuffler(7)(reversed).map((r) => r.id);
  assert.deepEqual(a, b);
});

test("#1124 — fill er seedet og varieret (ikke alfabetisk)", () => {
  // 50 ens single-løb; target = 30. Alfabetisk fill ville altid tage R00..R29.
  const pool = Array.from({ length: 50 }, (_, i) => {
    const n = String(i).padStart(2, "0");
    return makeRace({ id: `r${n}`, name: `R${n}`, race_class: "ProSeries", stages: 1 });
  });
  const seedA = selectSeasonRaces({ pool, raceDaysTarget: 30, seed: 1 }).selected.map((r) => r.name);
  const seedB = selectSeasonRaces({ pool, raceDaysTarget: 30, seed: 2 }).selected.map((r) => r.name);

  assert.equal(seedA.length, 30);
  assert.equal(seedB.length, 30);
  // Forskellige seeds → forskelligt udvalg (seedet, ikke fast).
  assert.notDeepEqual(seedA, seedB);
  // Ikke alfabetisk: udvalget er ikke præcis de 30 alfabetisk første (R00..R29).
  const firstThirtyAlpha = pool.slice(0, 30).map((r) => r.name);
  assert.notDeepEqual([...seedA].sort(), firstThirtyAlpha);
});
