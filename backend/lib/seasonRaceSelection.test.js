import test from "node:test";
import assert from "node:assert/strict";
import {
  selectSeasonRaces,
  selectFirstSeasonRaces,
  DEFAULT_RACE_DAYS_TARGET,
  FIRST_SEASON_STAGE_RACE_QUOTA,
  STAGE_RACE_PRIORITY,
  SINGLE_RACE_BOOST,
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

test("stageRaceQuota=2 fra whitelist → vælger prioriterede stage races først", () => {
  const pool = [
    makeRace({ name: "CRO Race", race_class: "ProSeries", race_type: "stage_race", stages: 6 }),
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Volta ao Algarve em Bicicleta", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Filler Single", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({ pool, raceDaysTarget: 60, stageRaceQuota: 2 });
  // Whitelist-rækkefølge: Volta Comunitat Valenciana → Tour of Oman → Volta ao Algarve …
  // Pool indeholder Tour of Oman + Volta ao Algarve (begge i whitelist) + CRO Race (lavere prioritet i whitelist)
  // Med quota=2 forventer vi Tour of Oman + Volta ao Algarve (CRO Race kommer senere i whitelist-rækkefølgen)
  const stageNames = result.selected.filter((r) => r.race_type === "stage_race").map((r) => r.name);
  assert.deepEqual(stageNames.slice(0, 2), ["Tour of Oman", "Volta ao Algarve em Bicicleta"]);
});

test("stageRaceQuota > whitelist-matches → supplér alfabetisk fra remaining (i quota-rækkefølgen)", () => {
  // Whitelist har kun "Tour of Oman" i pool; quota=3 skal supplere med 2 ikke-whitelist stage races (alfabetisk)
  // raceDaysTarget=15 stopper Phase 3 i at tilføje flere stage races (kun lige nok plads til quota).
  const pool = [
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Zeta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
    makeRace({ name: "Beta Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
    makeRace({ name: "Alpha Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 }),
  ];
  // Med target=13 + tolerance=5 fitter quota-summen 5+4+4=13. Zeta Tour ville sprænge (13+4>13+5).
  const result = selectSeasonRaces({ pool, raceDaysTarget: 13, overshootTolerance: 5, stageRaceQuota: 3 });
  // De FØRSTE 3 (i selected-rækkefølgen) skal være quota-resultatet: Oman (whitelist), så alfabetisk Alpha, Beta.
  const firstThree = result.selected.slice(0, 3).map((r) => r.name);
  assert.deepEqual(firstThree, ["Tour of Oman", "Alpha Tour", "Beta Tour"]);
});

test("stageRaceQuota > total stage races → tag alle uden crash", () => {
  const pool = [
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Single A", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({ pool, raceDaysTarget: 60, stageRaceQuota: 8 });
  assert.equal(result.selected.length, 2);
  assert.equal(result.totalRaceDays, 6);
});

test("boost singles tilføjes efter quota hvis plads", () => {
  const pool = [
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Tre Valli Varesine", race_class: "ProSeries", stages: 1 }),
    makeRace({ name: "Trofeo Laigueglia", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({ pool, raceDaysTarget: 60, stageRaceQuota: 1 });
  const names = result.selected.map((r) => r.name);
  assert.ok(names.includes("Tour of Oman"));
  assert.ok(names.includes("Tre Valli Varesine"));
  assert.ok(names.includes("Trofeo Laigueglia"));
});

test("quota respekterer overshootTolerance — skipper stage race der ville sprænge", () => {
  const pool = [
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Volta ao Algarve em Bicicleta", race_class: "ProSeries", race_type: "stage_race", stages: 21 }),
    makeRace({ name: "Filler", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({ pool, raceDaysTarget: 5, overshootTolerance: 2, stageRaceQuota: 2 });
  // Tour of Oman (5 stages) passer akkurat (5 ≤ 5+2=7). Volta Algarve (21) overskrider → skip.
  const stageNames = result.selected.filter((r) => r.race_type === "stage_race").map((r) => r.name);
  assert.deepEqual(stageNames, ["Tour of Oman"]);
});

test("quota dedup'er — samme race vælges ikke to gange via whitelist + fill", () => {
  const pool = [
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Single A", race_class: "ProSeries", stages: 1 }),
  ];
  const result = selectSeasonRaces({ pool, raceDaysTarget: 60, stageRaceQuota: 1 });
  const omanCount = result.selected.filter((r) => r.name === "Tour of Oman").length;
  assert.equal(omanCount, 1);
});

test("selectFirstSeasonRaces — default kører quota=8 (sæson 1 garanti)", () => {
  const stageRaces = STAGE_RACE_PRIORITY.slice(0, 10).map((name) =>
    makeRace({ name, race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  );
  const singles = Array.from({ length: 30 }, (_, i) =>
    makeRace({ name: `Single${i}`, race_class: "ProSeries", stages: 1 }),
  );
  const result = selectFirstSeasonRaces([...stageRaces, ...singles], { raceDaysTarget: 60 });
  const selectedStage = result.selected.filter((r) => r.race_type === "stage_race").length;
  // Med whitelist + quota=8 forventer vi præcis 8 stage races (de første 8 fra whitelist matchede pool)
  assert.equal(selectedStage, 8);
  assert.equal(FIRST_SEASON_STAGE_RACE_QUOTA, 8);
});

test("selectFirstSeasonRaces — caller kan override quota til 0", () => {
  const stageRaces = STAGE_RACE_PRIORITY.slice(0, 3).map((name) =>
    makeRace({ name, race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  );
  const singles = Array.from({ length: 30 }, (_, i) =>
    makeRace({ name: `Single${i}`, race_class: "ProSeries", stages: 1 }),
  );
  // quota=0 → bag-til-bag alphabetic; stage_race kommer før single i race_type DESC
  const result = selectFirstSeasonRaces([...stageRaces, ...singles], {
    raceDaysTarget: 60,
    stageRaceQuota: 0,
  });
  // Med quota=0 vælger algoritmen alle 3 stage_race (15 dage) + 45 single = 60 dage
  assert.equal(result.selected.filter((r) => r.race_type === "stage_race").length, 3);
});

test("WT-klasser ekskluderet selv med stageRaceQuota=8", () => {
  const pool = [
    makeRace({ name: "Tour de France", race_class: "TourFrance", race_type: "stage_race", stages: 21 }),
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
  ];
  const result = selectFirstSeasonRaces(pool, { raceDaysTarget: 60 });
  assert.ok(result.selected.every((r) => r.race_class === "ProSeries"));
  assert.ok(!result.selected.some((r) => r.name === "Tour de France"));
});

test("STAGE_RACE_PRIORITY og SINGLE_RACE_BOOST eksporteres", () => {
  assert.ok(Array.isArray(STAGE_RACE_PRIORITY));
  assert.ok(STAGE_RACE_PRIORITY.length >= 8, "skal indeholde mindst quota-default (8) løb");
  assert.ok(STAGE_RACE_PRIORITY.includes("Tour of Oman"));
  assert.ok(STAGE_RACE_PRIORITY.includes("Vuelta a Burgos"));
  assert.ok(Array.isArray(SINGLE_RACE_BOOST));
  assert.ok(SINGLE_RACE_BOOST.includes("Tre Valli Varesine"));
});

test("determinisme — quota+boost giver samme output ved gentagne kald", () => {
  const pool = [
    makeRace({ name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Tour of the Alps", race_class: "ProSeries", race_type: "stage_race", stages: 5 }),
    makeRace({ name: "Tre Valli Varesine", race_class: "ProSeries", stages: 1 }),
    makeRace({ name: "Random Single", race_class: "ProSeries", stages: 1 }),
  ];
  const a = selectSeasonRaces({ pool, raceDaysTarget: 60, stageRaceQuota: 2 });
  const b = selectSeasonRaces({ pool, raceDaysTarget: 60, stageRaceQuota: 2 });
  assert.deepEqual(
    a.selected.map((r) => r.name),
    b.selected.map((r) => r.name),
  );
});
