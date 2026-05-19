import test from "node:test";
import assert from "node:assert/strict";
import {
  selectSeasonRaces,
  selectFirstSeasonRaces,
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

test("tom prioritizedStageRaceIds + quota>0 → quota fyldes alfabetisk i Phase 1", () => {
  const pool = [
    makeRace({ id: "z", name: "Zeta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "a", name: "Alpha Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "b", name: "Beta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 15,
    overshootTolerance: 5,
    stageRaceQuota: 2,
    prioritizedStageRaceIds: [],
  });
  // Tom whitelist → Phase 1 fylder quota alfabetisk: Alpha, Beta (i denne rækkefølge).
  // Phase 3 supplerer evt. resten (Zeta passer i target+tolerance).
  // Vi tester RÆKKEFØLGEN af de første 2 valg fra quota'en.
  const firstTwo = result.selected.slice(0, 2).map((r) => r.name);
  assert.deepEqual(firstTwo, ["Alpha Tour", "Beta Tour"]);
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

test("stageRaceQuota > whitelist-matches → supplér alfabetisk fra remaining", () => {
  const pool = [
    makeRace({ id: "oman", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ id: "z", name: "Zeta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
    makeRace({ id: "b", name: "Beta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
    makeRace({ id: "a", name: "Alpha Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
  ];
  const result = selectSeasonRaces({
    pool,
    raceDaysTarget: 13,
    overshootTolerance: 5,
    stageRaceQuota: 3,
    prioritizedStageRaceIds: ["oman"],
  });
  const firstThree = result.selected.slice(0, 3).map((r) => r.name);
  assert.deepEqual(firstThree, ["Tour of Oman", "Alpha Tour", "Beta Tour"]);
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

test("selectFirstSeasonRaces — default quota=8 men whitelist tom = alfabetisk fallback", () => {
  const stageRaces = Array.from({ length: 10 }, (_, i) =>
    makeRace({ id: `s${i}`, name: `StageRace${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  );
  const singles = Array.from({ length: 30 }, (_, i) =>
    makeRace({ id: `sg${i}`, name: `Single${i}`, race_class: "ProSeries", stages: 1 }),
  );
  // Ingen prioritizedStageRaceIds = tom default → algoritmen fylder quota=8 alfabetisk
  const result = selectFirstSeasonRaces([...stageRaces, ...singles], { raceDaysTarget: 60 });
  const selectedStage = result.selected.filter((r) => r.race_type === "stage_race").length;
  // Quota=8 garantier 8 stage races (alfabetisk fra tom whitelist)
  assert.equal(selectedStage, 8);
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
