// #8604 Del 2 · Model 2. Syntetiske XP-tal, ikke kalibreringen (privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDevelopmentXpParams } from "./developmentXp.ts";
import { expectedCareer, expectedTopRating, standardCareerRotation, standardCareerShares } from "./developmentXpExpectedTop.ts";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import {
  DEFAULT_TRAINING_SWITCHES, MODEL2_BAND_HALF_FULL, MODEL2_BAND_HALF_START, MODEL2_WINDOW_DATES, PROGNOSIS_MODEL2_TABLE,
  bandHalfWidth, blendMix, calibrateEarningProxy, computeModel2Prognosis, model2View, observedDateEntries,
  plannedDateEntries, prepareTeamModel2, raceProfilesBySlot, raceSlotKey, runPrognosisModel2Batch, simulateMixCareer, slotShares,
  supabaseModel2Io,
} from "./prognosisModel2_8604.js";
import { applyTrainingCatalog } from "./trainingCatalogV3.js";
import { programForSession } from "./trainingPrograms.js";
import { WEEKDAY_KEYS } from "./training.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { buildAcademyFromViews, buildEstimatesFromViews, buildProjectionFromView } from "./potentialEstimateRead.js";

const XP = validateDevelopmentXpParams({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
    mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});
const TYPES = { primaryType: "climber", secondaryType: "puncheur" };
const ABILITIES = Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 45]));
const RIDER = { id: "r1", abilities: ABILITIES, age: 20, ...TYPES };

const reference = (p) => expectedTopRating({ ...RIDER, potentiale: p }, XP);
const estimateAt = (p) => Math.round(reference(p));

// ── Motorens grene ────────────────────────────────────────────────────────────

test("standardrotationen med tomme bjælker er bit for bit expectedCareer", () => {
  const rotation = standardCareerRotation(TYPES.primaryType).map((program) => standardCareerShares(TYPES.primaryType, TYPES.secondaryType, XP, program));
  for (const potentiale of [1, 2.5, 4, 6]) {
    const ours = simulateMixCareer({ ...RIDER, potentiale }, rotation, XP);
    const engine = expectedCareer({ ...RIDER, potentiale }, XP);
    assert.equal(ours.rating, engine.rating, `potentiale ${potentiale}`);
    assert.equal(ours.ratingNow, engine.ratingNow);
    assert.equal(ours.atAge, engine.atAge);
  }
});

test("løbsgrenen giver XP på en løbsdato, hvile giver intet", () => {
  const race = slotShares({ race_day: "true", intensity: "race", focus: "race_day" }, TYPES, XP);
  assert.ok(Object.values(race).some((share) => share > 0));
  assert.deepEqual(slotShares({ intensity: "rest", focus: "endurance" }, TYPES, XP), {});
  const train = slotShares({ intensity: "hard", focus: "long_climbs" }, TYPES, XP);
  assert.ok(Object.values(train).some((share) => share > 0));
});

test("bjælkernes rest tæller med og kan kun hjælpe", () => {
  const plan = plannedDateEntries(null, TYPES, XP);
  const without = simulateMixCareer({ ...RIDER, potentiale: 3 }, plan, XP);
  const withBars = simulateMixCareer({ ...RIDER, potentiale: 3, bars: Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 0.9])) }, plan, XP);
  assert.ok(withBars.rating >= without.rating);
});

// ── Kalibrering mod skønnet ─────────────────────────────────────────────────

test("kalibreringen finder et input, der fører standardkarrieren til skønnet", () => {
  for (const p of [2, 3.5, 5]) {
    const estimate = estimateAt(p);
    const proxy = calibrateEarningProxy(RIDER, estimate, XP);
    assert.ok(reference(proxy) >= estimate, `p ${p}`);
    assert.ok(Math.abs(reference(proxy) - estimate) < 1, `p ${p}`);
  }
});

test("kalibreringen læser aldrig rytterens skjulte potentiale", () => {
  const estimate = estimateAt(3);
  assert.equal(calibrateEarningProxy({ ...RIDER, potentiale: 1 }, estimate, XP), calibrateEarningProxy({ ...RIDER, potentiale: 6 }, estimate, XP));
});

test("et skøn uden for kurven bruger nærmeste ende", () => {
  assert.equal(calibrateEarningProxy(RIDER, 99, XP), 6);
  assert.equal(calibrateEarningProxy(RIDER, 1, XP), 1);
});

// ── Prognosen ───────────────────────────────────────────────────────────────

test("standardplan: prognosen er skønnet; aldrig over skønnet, aldrig under ratingen nu", () => {
  const estimate = estimateAt(3);
  const result = computeModel2Prognosis({ rider: RIDER, estimate }, XP);
  assert.equal(result.value, estimate);
  assert.ok(result.lo <= result.value && result.value <= result.hi);
  assert.ok(result.hi <= estimate);
});

test("en rytter der hviler hver dag ender lavere end en der træner", () => {
  const estimate = estimateAt(4);
  const rest = observedDateEntries(
    Array.from({ length: MODEL2_WINDOW_DATES }, (_, i) => ({ season_id: "s", game_day: i, tick_date: `2026-11-${String(i + 1).padStart(2, "0")}`, intensity: "rest", focus: "endurance" })),
    TYPES, XP, { today: "2026-12-01" },
  );
  const trained = computeModel2Prognosis({ rider: RIDER, estimate }, XP);
  const rested = computeModel2Prognosis({ rider: RIDER, estimate, observed: rest }, XP);
  assert.ok(rested.value < trained.value);
  assert.ok(rested.value >= Math.round(simulateMixCareer({ ...RIDER, potentiale: 1 }, [{}], XP).ratingNow));
});

test("ét tal fra første dag: ny rytter uden historik får et tal", () => {
  const result = computeModel2Prognosis({ rider: RIDER, estimate: estimateAt(3), observed: [] }, XP);
  assert.equal(typeof result.value, "number");
  assert.equal(result.observedDates, 0);
});

test("intervallet snævrer ind for hver faktisk dato og bliver aldrig bredere", () => {
  let previous = Infinity;
  for (let n = 0; n <= MODEL2_WINDOW_DATES + 3; n++) {
    const half = bandHalfWidth(n);
    assert.ok(half <= previous, `n ${n}`);
    previous = half;
  }
  assert.equal(bandHalfWidth(0), MODEL2_BAND_HALF_START);
  assert.equal(bandHalfWidth(MODEL2_WINDOW_DATES), MODEL2_BAND_HALF_FULL);
});

test("en faktisk dato erstatter én simuleret dato", () => {
  const planned = [{ a: 1 }, { b: 1 }];
  const observed = [{ x: 1 }, { y: 1 }, { z: 1 }];
  const mix = blendMix(observed, planned, 5);
  assert.equal(mix.length, 5);
  assert.deepEqual(mix.slice(-3), observed);
  assert.deepEqual(blendMix(Array.from({ length: 9 }, (_, i) => ({ i })), planned, 5).map((d) => d.i), [4, 5, 6, 7, 8]);
});

test("faktiske datoer: samme felt to gange tæller én gang, og dagens åbne dato tæller ikke", () => {
  const slot = { season_id: "s", game_day: 3, tick_date: "2026-11-20", intensity: "hard", focus: "long_climbs" };
  assert.equal(observedDateEntries([slot, { ...slot }], TYPES, XP, { today: "2026-11-26" }).length, 1);
  assert.equal(observedDateEntries([{ ...slot, tick_date: "2026-11-26" }], TYPES, XP, { today: "2026-11-26" }).length, 0);
  const two = observedDateEntries([slot, { ...slot, game_day: 4 }], TYPES, XP, { today: "2026-11-26" });
  const one = observedDateEntries([slot], TYPES, XP, { today: "2026-11-26" });
  assert.deepEqual(two, one, "en dato tæller som én dato, uanset antal felter");
});

test("deterministisk: samme input giver samme svar", () => {
  const input = { rider: RIDER, estimate: estimateAt(3.3) };
  assert.deepEqual(computeModel2Prognosis(input, XP), computeModel2Prognosis(input, XP));
});

// ── #8810 fund 1: samme planopløsning som motoren ───────────────────────────

const sharesOf = (program) => standardCareerShares(TYPES.primaryType, TYPES.secondaryType, XP, applyTrainingCatalog({ ...program }, { v3: true }));
const sessionShares = (session) => {
  const chosen = programForSession(session, null, { catalogV3: true });
  return sharesOf({ focus: chosen.focus, intensity: chosen.intensity });
};
const CELLS_ON = { programsOn: true, catalogV3: true, effortLevels: false };
const everyDay = (entry) => Object.fromEntries(WEEKDAY_KEYS.map((weekday) => [weekday, entry]));

test("fund 1: holdets ugeplan med programceller styrer en rytter uden egen plan, dag for dag", () => {
  const teamDays = { ...everyDay({ session: "endurance" }), mon: { session: "vo2max_climb" }, sun: { session: "rest" } };
  const dates = plannedDateEntries(null, TYPES, XP, { teamDays, switches: CELLS_ON, startWeekday: "mon" });
  assert.equal(dates.length, 7, "én dato pr. ugedag");
  assert.deepEqual(dates[0], sessionShares("vo2max_climb"), "mandag: holdets celle");
  assert.deepEqual(dates[1], sessionShares("endurance"), "tirsdag: holdets celle");
  assert.deepEqual(dates[6], {}, "søndag: hvile giver intet");
  const standard = standardCareerRotation(TYPES.primaryType).map((program) => standardCareerShares(TYPES.primaryType, TYPES.secondaryType, XP, program));
  assert.notDeepEqual(dates, standard, "ikke længere standardkarrieren, når holdet har valgt en plan");
});

test("fund 1: rytterens egen række vinder over holdets, og hans gemte plan vinder over holdets (#2438)", () => {
  const teamDays = everyDay({ session: "endurance" });
  const riderDays = { ...everyDay({}), tue: { session: "sprint" } };
  const own = plannedDateEntries(null, TYPES, XP, { teamDays, riderDays, switches: CELLS_ON, startWeekday: "mon" });
  assert.deepEqual(own[1], sessionShares("sprint"), "tirsdag: rytterens egen celle");
  assert.deepEqual(own[0], sessionShares("endurance"), "mandag: holdets celle, rytteren har intet");
  const plan = { focus: "long_climbs", intensity: "hard" };
  const planned = plannedDateEntries(plan, TYPES, XP, { teamDays, switches: CELLS_ON, startWeekday: "mon" });
  assert.deepEqual(planned, [sharesOf(plan)], "hans plan alle dage: én gentaget dato");
});

test("fund 1: en ren ugerytme ændrer kun intensiteten, som resolveDayIntensity", () => {
  const plan = { focus: "long_climbs", intensity: "hard" };
  const riderDays = { mon: { intensity: "rest" }, wed: { intensity: "easy" } };
  const dates = plannedDateEntries(plan, TYPES, XP, { riderDays, startWeekday: "mon" });
  assert.equal(dates.length, 7);
  assert.deepEqual(dates[0], {}, "mandag: hvile");
  assert.deepEqual(dates[1], sharesOf(plan), "tirsdag: planen");
  assert.deepEqual(dates[2], sharesOf({ ...plan, intensity: "easy" }), "onsdag: rytmens intensitet, planens fokus");
  const fromWed = plannedDateEntries(plan, TYPES, XP, { riderDays, startWeekday: "wed" });
  assert.deepEqual(fromWed[0], dates[2], "datoerne følger kalenderen fra i dag");
});

test("fund 1: en rotation kører passene i rækkefølge fra rytterens plads, ét pas pr. felt", () => {
  const rotation = { v: 1, passes: [{ session: "vo2max_climb" }, { session: "endurance" }], rev: 3, anchor: { rev: 3, index: 1 } };
  const dates = plannedDateEntries({ focus: "long_climbs", intensity: "hard" }, TYPES, XP, { rotation, startWeekday: "mon" });
  assert.equal(dates.length, rotation.passes.length, "én hel omgang");
  const climb = sessionShares("vo2max_climb");
  const easy = sessionShares("endurance");
  // Ankeret starter på pas 2: datoens fem felter er pas 2, 1, 2, 1, 2.
  const mixOf = (wClimb, wEasy) => {
    const out = {};
    for (const [a, s] of Object.entries(climb)) out[a] = (out[a] ?? 0) + s * wClimb;
    for (const [a, s] of Object.entries(easy)) out[a] = (out[a] ?? 0) + s * wEasy;
    return out;
  };
  for (const [ability, share] of Object.entries(mixOf(2 / 5, 3 / 5))) assert.ok(Math.abs(dates[0][ability] - share) < 1e-12, `første dato ${ability}`);
  for (const [ability, share] of Object.entries(mixOf(3 / 5, 2 / 5))) assert.ok(Math.abs(dates[1][ability] - share) < 1e-12, `anden dato ${ability}`);
  // Plads fra seneste kvittering med samme rev (motorens rotationProgram).
  const receipts = [{ tick_date: "2026-11-25", report: { rotation: { rev: 3, index: 0, length: 2, advanced: false, order: 1 } } }];
  const held = plannedDateEntries(null, TYPES, XP, { rotation, rotationReceipts: receipts, startWeekday: "mon" });
  for (const [ability, share] of Object.entries(mixOf(3 / 5, 2 / 5))) assert.ok(Math.abs(held[0][ability] - share) < 1e-12, `kvitteringens plads ${ability}`);
});

test("fund 1: uden nogen plan er det fortsat standardkarrieren (kalibreringens reference)", () => {
  const standard = standardCareerRotation(TYPES.primaryType).map((program) => standardCareerShares(TYPES.primaryType, TYPES.secondaryType, XP, program));
  assert.deepEqual(plannedDateEntries(null, TYPES, XP), standard);
  assert.deepEqual(plannedDateEntries(null, TYPES, XP, { teamDays: everyDay({}), switches: CELLS_ON }), standard, "en tom ugerække er ingen plan");
});

test("fund 1: batchen sender holdets ugeplan, kontakter og rotation ind, og hashen følger planen", async () => {
  const base = { riders: [BATCH_RIDER], estimates: [estimateRow(estimateAt(3))], abilities: [{ rider_id: "r1", ...ABILITIES, ability_progress: {} }] };
  const plain = memoryIo(base);
  await prepareTeamModel2({ io: plain, teamId: "t1", season: { id: "s1", number: 1 }, params: XP, today: "2026-11-26", now: NOW });
  const restWeek = memoryIo({ ...base, weekRows: [{ rider_id: null, days: everyDay({ session: "rest" }), plan_kind: null }], switches: CELLS_ON });
  await prepareTeamModel2({ io: restWeek, teamId: "t1", season: { id: "s1", number: 1 }, params: XP, today: "2026-11-26", now: NOW });
  const [plainRow] = plain.table.values();
  const [restRow] = restWeek.table.values();
  assert.notEqual(plainRow.input_hash, restRow.input_hash);
  assert.ok(restRow.value < plainRow.value, "et hold, der hviler hver dag, giver en lavere prognose");
});

// ── #8810 fund 2: etapens rigtige profil ────────────────────────────────────

test("fund 2: et løbsfelt bruger etapens profil, en ukendt profil motorens fallback", () => {
  const raceSlot = (profile_type) => ({ race_day: "true", intensity: "race", focus: "race_day", profile_type });
  const mountain = slotShares(raceSlot("mountain"), TYPES, XP);
  const flat = slotShares(raceSlot("flat"), TYPES, XP);
  assert.notDeepEqual(mountain, flat);
  assert.ok(mountain.climbing > flat.climbing, "bjergetapen træner klatring");
  assert.ok(flat.sprint > mountain.sprint, "den flade etape træner spurt");
  assert.deepEqual(slotShares(raceSlot(null), TYPES, XP), slotShares(raceSlot("rolling"), TYPES, XP));
});

test("fund 2: profilopslaget er scopet til feltets sæson og tæller aldrig tour-GC", () => {
  const profiles = raceProfilesBySlot({
    races: [{ id: "tourA", season_id: "s0", race_type: "stage_race" }, { id: "tourB", season_id: "s1", race_type: "stage_race" }, { id: "oneDay", season_id: "s1", race_type: "single" }],
    schedule: [
      { race_id: "tourA", stage_number: 2, game_day: 7 },
      { race_id: "tourB", stage_number: 4, game_day: 7 },
      { race_id: "oneDay", stage_number: 1, game_day: 9 },
    ],
    results: [
      { rider_id: "r1", race_id: "tourA", stage_number: 2, result_type: "stage" },
      { rider_id: "r1", race_id: "tourB", stage_number: 4, result_type: "stage" },
      { rider_id: "r2", race_id: "tourB", stage_number: 4, result_type: "gc" },
      { rider_id: "r1", race_id: "oneDay", stage_number: 1, result_type: "gc" },
    ],
    profileRows: [
      { race_id: "tourA", stage_number: 2, profile_type: "mountain" },
      { race_id: "tourB", stage_number: 4, profile_type: "itt" },
      { race_id: "oneDay", stage_number: 1, profile_type: "cobbles" },
    ],
  });
  assert.equal(profiles.get(raceSlotKey("r1", "s0", 7)), "mountain");
  assert.equal(profiles.get(raceSlotKey("r1", "s1", 7)), "itt", "samme løbsdag i en anden sæson er en anden etape");
  assert.equal(profiles.get(raceSlotKey("r1", "s1", 9)), "cobbles", "endagsløbets GC tæller");
  assert.equal(profiles.has(raceSlotKey("r2", "s1", 7)), false, "tour-GC er aldrig en etape");
});

test("fund 2: batchen slår profilen op for løbsfelterne og bruger den i mixet", async () => {
  const days = Array.from({ length: MODEL2_WINDOW_DATES }, (_, i) => i + 1);
  const slots = days.map((day) => ({ rider_id: "r1", season_id: "s1", game_day: day, tick_date: `2026-11-${String(day).padStart(2, "0")}`, focus: "race_day", intensity: "race", race_day: "true", status: "trained" }));
  const base = { riders: [BATCH_RIDER], estimates: [estimateRow(estimateAt(4))], abilities: [{ rider_id: "r1", ...ABILITIES, ability_progress: {} }], slots };
  const run = async (profile) => {
    const io = memoryIo({ ...base, profiles: new Map(days.map((day) => [raceSlotKey("r1", "s1", day), profile])) });
    await prepareTeamModel2({ io, teamId: "t1", season: { id: "s1", number: 1 }, params: XP, today: "2026-11-26", now: NOW });
    return { io, row: [...io.table.values()][0] };
  };
  const mountain = await run("high_mountain");
  const flat = await run("flat");
  assert.equal(mountain.io.calls.raceProfiles.length, 1);
  assert.deepEqual(mountain.io.calls.raceProfiles[0].riderIds, ["r1"]);
  assert.equal(mountain.io.calls.raceProfiles[0].slots.length, MODEL2_WINDOW_DATES);
  assert.notEqual(mountain.row.input_hash, flat.row.input_hash, "profilen indgår i beregningen");
  assert.ok(mountain.row.value > flat.row.value, "en klatrer, der kører bjergetaper, ender højere end på flade etaper");
});

test("fund 2: Supabase-opslaget kobler løbsfeltet til etapen på feltets løbsdag", async () => {
  const sb = createFakeSupabase({
    races: [{ id: "tour", season_id: "s1", race_type: "stage_race" }, { id: "old", season_id: "s0", race_type: "stage_race" }],
    race_stage_schedule: [{ race_id: "tour", stage_number: 3, game_day: 12 }, { race_id: "tour", stage_number: 4, game_day: 13 }, { race_id: "old", stage_number: 3, game_day: 12 }],
    race_results: [
      { rider_id: "r1", race_id: "tour", stage_number: 3, result_type: "stage" },
      { rider_id: "r1", race_id: "tour", stage_number: 4, result_type: "stage" },
      { rider_id: "r1", race_id: "old", stage_number: 3, result_type: "stage" },
    ],
    race_stage_profiles: [
      { race_id: "tour", stage_number: 3, profile_type: "mountain" },
      { race_id: "tour", stage_number: 4, profile_type: "itt" },
      { race_id: "old", stage_number: 3, profile_type: "flat" },
    ],
  });
  const profiles = await supabaseModel2Io(sb).raceProfiles({ riderIds: ["r1"], slots: [{ rider_id: "r1", season_id: "s1", game_day: 12 }] });
  assert.equal(profiles.get(raceSlotKey("r1", "s1", 12)), "mountain");
  assert.equal(profiles.has(raceSlotKey("r1", "s0", 12)), false, "en anden sæsons løb læses ikke");
});

// ── #8810 fund 3: et uafgjort felt er ikke afregnet ─────────────────────────

test("fund 3: en dato med et uafgjort felt tæller ikke som faktisk og snævrer ikke intervallet", () => {
  const slot = (day, extra = {}) => ({ season_id: "s", game_day: day, tick_date: `2026-11-${String(10 + Math.ceil(day / 5)).padStart(2, "0")}`, intensity: "hard", focus: "long_climbs", ...extra });
  const settledDate = [1, 2, 3, 4, 5].map((day) => slot(day));
  const pendingDate = [6, 7, 8, 9].map((day) => slot(day)).concat(slot(10, { intensity: "unknown_pending", status: "unknown_pending", focus: "long_climbs" }));
  const observed = observedDateEntries([...settledDate, ...pendingDate], TYPES, XP, { today: "2026-11-26" });
  assert.equal(observed.length, 1, "kun den afregnede dato");
  assert.deepEqual(slotShares({ intensity: "unknown_pending", focus: "long_climbs" }, TYPES, XP), {}, "ingen opfundet XP");
  assert.deepEqual(slotShares({ intensity: "hard", focus: "long_climbs", status: "unknown_pending" }, TYPES, XP), {});
  const estimate = estimateAt(3);
  const withPending = computeModel2Prognosis({ rider: RIDER, estimate, observed }, XP);
  const settledOnly = computeModel2Prognosis({ rider: RIDER, estimate, observed: observedDateEntries(settledDate, TYPES, XP, { today: "2026-11-26" }) }, XP);
  assert.deepEqual(withPending, settledOnly, "den uafgjorte dato er simuleret, ikke faktisk");
  assert.equal(withPending.observedDates, 1);
});

test("fund 3: batchen sender aldrig et uafgjort løbsfelt til profilopslaget", async () => {
  const slots = [
    { rider_id: "r1", season_id: "s1", game_day: 1, tick_date: "2026-11-20", focus: "race_day", intensity: "unknown_pending", race_day: "false", status: "unknown_pending" },
  ];
  const io = memoryIo({ riders: [BATCH_RIDER], estimates: [estimateRow(estimateAt(3))], abilities: [{ rider_id: "r1", ...ABILITIES, ability_progress: {} }], slots });
  await prepareTeamModel2({ io, teamId: "t1", season: { id: "s1", number: 1 }, params: XP, today: "2026-11-26", now: NOW });
  assert.equal(io.calls.raceProfiles.length, 0);
  assert.equal([...io.table.values()][0].observed_dates, 0);
});

// ── #8810 fund 4: afregnede datoer fra forrige sæson på samme hold ───────────

test("fund 4: datoer fra forrige sæson bevares, også med samme løbsdagsnummer", () => {
  const slots = [
    { season_id: "s0", game_day: 3, tick_date: "2026-11-20", intensity: "hard", focus: "long_climbs" },
    { season_id: "s1", game_day: 3, tick_date: "2026-11-24", intensity: "hard", focus: "long_climbs" },
  ];
  assert.equal(observedDateEntries(slots, TYPES, XP, { today: "2026-11-26" }).length, 2);
});

test("fund 4: batchen læser holdets kvitteringer på tværs af sæsonskiftet", async () => {
  const slot = (season_id, day, date) => ({ rider_id: "r1", season_id, game_day: day, tick_date: date, focus: "long_climbs", intensity: "hard", race_day: "false", status: "trained" });
  const slots = [slot("s0", 60, "2026-11-20"), slot("s0", 61, "2026-11-21"), slot("s1", 1, "2026-11-24")];
  const io = memoryIo({ riders: [BATCH_RIDER], estimates: [estimateRow(estimateAt(3))], abilities: [{ rider_id: "r1", ...ABILITIES, ability_progress: {} }], slots, seasonIds: ["s1", "s0"] });
  await prepareTeamModel2({ io, teamId: "t1", season: { id: "s1", number: 2 }, params: XP, today: "2026-11-26", now: NOW });
  assert.deepEqual(io.calls.slots[0].seasonIds, ["s1", "s0"]);
  assert.equal([...io.table.values()][0].observed_dates, 3, "forrige sæsons datoer tæller med");
});

test("fund 4: sæson-opslaget giver sæsonen nu og den før", async () => {
  const sb = createFakeSupabase({ seasons: [{ id: "s0", number: 1 }, { id: "s1", number: 2 }, { id: "sx", number: 7 }] });
  assert.deepEqual((await supabaseModel2Io(sb).seasonIds({ id: "s1", number: 2 })).sort(), ["s0", "s1"]);
});

// ── Visningen ───────────────────────────────────────────────────────────────

test("visningen klemmer tallet ind mellem ratingen nu og skønnet nu", () => {
  assert.deepEqual(model2View({ value: 70, lo: 66, hi: 72 }, { estimate: 68, currentRating: 50 }), { hidden: false, value: 68, model: 2, band: { lo: 66, hi: 68 } });
  assert.deepEqual(model2View({ value: 40, lo: 36, hi: 44 }, { estimate: 70, currentRating: 42 }), { hidden: false, value: 42, model: 2, band: { lo: 42, hi: 44 } });
  assert.equal(model2View(null, { estimate: 70, currentRating: 42 }), null);
});

// ── Batchen ─────────────────────────────────────────────────────────────────

function memoryIo({
  riders, estimates, abilities = [], plans = [], slots = [], weekRows = [], switches = DEFAULT_TRAINING_SWITCHES,
  rotations = new Map(), rotationReceipts = new Map(), profiles = new Map(), seasonIds = ["s1"],
}) {
  const table = new Map();
  const calls = { slots: [], raceProfiles: [] };
  return {
    table,
    calls,
    activeSeason: async () => ({ id: "s1", number: 1 }),
    teamIds: async () => ["t1"],
    riders: async () => riders,
    estimates: async () => estimates,
    abilities: async (ids) => abilities.filter((row) => ids.includes(row.rider_id)),
    plans: async () => plans,
    seasonIds: async () => seasonIds,
    slots: async (teamId, ids, since, today) => {
      calls.slots.push({ teamId, seasonIds: ids, since, today });
      return slots.filter((slot) => ids.includes(slot.season_id));
    },
    weekPlans: async () => weekRows,
    trainingSwitches: async () => switches,
    rotations: async () => ({ byRider: rotations, receipts: rotationReceipts }),
    raceProfiles: async (args) => { calls.raceProfiles.push(args); return profiles; },
    published: async (teamId) => [...table.values()].filter((row) => row.team_id === teamId),
    upsert: async (rows) => { for (const row of rows) table.set(`${row.rider_id}:${row.team_id}`, row); },
    remove: async (teamId, ids) => { for (const id of ids) table.delete(`${id}:${teamId}`); },
  };
}

const BATCH_RIDER = { id: "r1", team_id: "t1", birthdate: "2006-03-01", ...{ primary_type: "climber", secondary_type: "puncheur" }, best_role_rating: 45, is_retired: false };
const estimateRow = (value) => ({ rider_id: "r1", value, certainty: "fair", previous_value: null, previous_certainty: null, changed_at: null });
const NOW = new Date("2026-11-26T06:00:00.000Z");

test("batch: publicerer én række, og samme input skriver intet igen", async () => {
  const io = memoryIo({ riders: [BATCH_RIDER], estimates: [estimateRow(estimateAt(3))], abilities: [{ rider_id: "r1", ...ABILITIES, ability_progress: {} }] });
  const first = await prepareTeamModel2({ io, teamId: "t1", season: { id: "s1", number: 1 }, params: XP, today: "2026-11-26", now: NOW });
  assert.equal(first.written, 1);
  const [row] = io.table.values();
  assert.equal(row.value, estimateAt(3));
  assert.ok(row.band_lo <= row.value && row.value <= row.band_hi);
  const again = await prepareTeamModel2({ io, teamId: "t1", season: { id: "s1", number: 1 }, params: XP, today: "2026-11-26", now: NOW });
  assert.equal(again.written, 0);
  assert.equal(again.unchanged, 1);
});

test("batch: rytter uden skøn springes over, og en rytter der forlod holdet fjernes", async () => {
  const io = memoryIo({ riders: [BATCH_RIDER], estimates: [], abilities: [{ rider_id: "r1", ...ABILITIES }] });
  io.table.set("gone:t1", { rider_id: "gone", team_id: "t1", input_hash: "x" });
  const counts = await prepareTeamModel2({ io, teamId: "t1", season: { id: "s1", number: 1 }, params: XP, today: "2026-11-26", now: NOW });
  assert.equal(counts.skipped, 1);
  assert.equal(io.table.size, 0);
});

test("batch: kontakten slukket læser intet ud over kontakten", async () => {
  const sb = createFakeSupabase({ app_config: [{ key: "prognosis_model2", value: "off" }] });
  const tables = [];
  const from = sb.from;
  sb.from = (table) => { tables.push(table); return from(table); };
  assert.deepEqual(await runPrognosisModel2Batch({ supabase: sb, now: NOW }), { ran: false, skipped: "flag_off" });
  assert.deepEqual([...new Set(tables)], ["app_config"]);
  assert.equal(PROGNOSIS_MODEL2_TABLE, "rider_prognosis_model2");
});

test("batch: før dagens time kun ryttere uden række, derefter den fulde kørsel én gang", async () => {
  const sb = createFakeSupabase({
    app_config: [
      { key: "prognosis_model2", value: "on" },
      { key: "development_xp_model", value: "on" },
      { key: "development_xp_from_date", value: "2026-11-01" },
    ],
    private_config: [{ key: "development_xp_params", value: XP }],
  });
  const io = memoryIo({ riders: [BATCH_RIDER], estimates: [estimateRow(estimateAt(3))], abilities: [{ rider_id: "r1", ...ABILITIES }] });
  const state = { fullRunDate: null };
  const early = await runPrognosisModel2Batch({ supabase: sb, now: new Date("2026-11-26T02:00:00.000Z"), io, state });
  assert.equal(early.full, false);
  assert.equal(early.written, 1);
  const later = await runPrognosisModel2Batch({ supabase: sb, now: NOW, io, state });
  assert.equal(later.full, true);
  assert.equal(state.fullRunDate, "2026-11-26");
  const third = await runPrognosisModel2Batch({ supabase: sb, now: new Date("2026-11-26T08:00:00.000Z"), io, state });
  assert.equal(third.full, false);
});

// ── Læsesiden: samme tal på alle flader ─────────────────────────────────────


const READ_TEAM = "team-own";
const READ_SEASON = 3;
const ageBirth = (age) => `${ageForSeason("2000-01-01", READ_SEASON) + 2000 - age}-06-01`;
const flatAbilities = (rating) => Object.fromEntries(REGISTRY_ABILITY_KEYS.map((key) => [key, rating]));
const readEstimate = (riderId, value) => ({ rider_id: riderId, team_id: READ_TEAM, value, certainty: "fair", previous_value: null, previous_certainty: null, changed_at: null });
const readWorld = (flag) => createFakeSupabase({
  app_config: [{ key: "prognosis_model2", value: flag }],
  seasons: [{ id: "s3", number: READ_SEASON, status: "active" }],
  teams: [{ id: READ_TEAM, is_ai: false }],
  riders: [
    { id: "m2", team_id: READ_TEAM, is_academy: false, birthdate: ageBirth(21), primary_type: "climber", best_role_rating: 50 },
    { id: "plain", team_id: READ_TEAM, is_academy: false, birthdate: ageBirth(21), primary_type: "climber", best_role_rating: 50 },
  ],
  rider_potential_estimates: [readEstimate("m2", 70), readEstimate("plain", 70)],
  rider_derived_abilities: [{ rider_id: "m2", ...flatAbilities(50) }, { rider_id: "plain", ...flatAbilities(50) }],
  rider_derived_ability_history: [],
  rider_ability_race_day_history: [],
  training_rider_ticks: [],
  [PROGNOSIS_MODEL2_TABLE]: [{ rider_id: "m2", team_id: READ_TEAM, value: 66, band_lo: 62, band_hi: 72 }, { rider_id: "m2", team_id: "other", value: 99, band_lo: 99, band_hi: 99 }],
});
const READ_NOW = new Date("2026-11-26T12:00:00.000Z");

test("læsning: kontakten tændt giver Model 2-tallet, klemt under skønnet, og kun holdets egen række", async () => {
  const estimates = await buildEstimatesFromViews(readWorld("on"), { teamId: READ_TEAM, riderIds: ["m2", "plain"], clock: READ_NOW });
  assert.deepEqual(estimates.m2.prognosisView, { hidden: false, value: 66, model: 2, band: { lo: 62, hi: 70 } });
  assert.deepEqual(estimates.plain.prognosisView, { hidden: false, value: 50 }, "uden række: den nuværende prognose, aldrig tomt");
});

test("læsning: kontakten slukket rører ikke tabellen og svarer som i dag", async () => {
  const supabase = readWorld("off");
  const tables = [];
  const from = supabase.from;
  supabase.from = (table) => { tables.push(table); return from(table); };
  const estimates = await buildEstimatesFromViews(supabase, { teamId: READ_TEAM, riderIds: ["m2"], clock: READ_NOW });
  assert.deepEqual(estimates.m2.prognosisView, { hidden: false, value: 50 });
  assert.ok(!tables.includes(PROGNOSIS_MODEL2_TABLE));
});

test("læsning: kort, profil og akademi viser samme Model 2-tal", async () => {
  const supabase = readWorld("on");
  const estimates = await buildEstimatesFromViews(supabase, { teamId: READ_TEAM, riderIds: ["m2"], clock: READ_NOW });
  const projection = await buildProjectionFromView(supabase, { teamId: READ_TEAM, rider: { id: "m2", primary_type: "climber" }, own: true, level: 3, maxLevel: 3, age: 21, clock: READ_NOW });
  const academy = await buildAcademyFromViews(supabase, { teamId: READ_TEAM, roster: [{ id: "m2" }], intake: [], clock: READ_NOW });
  assert.equal(projection.prognosisView.value, estimates.m2.prognosisView.value);
  assert.equal(academy.roster[0].prognosisView.value, estimates.m2.prognosisView.value);
});
