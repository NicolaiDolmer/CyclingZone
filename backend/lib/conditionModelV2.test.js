import test from "node:test";
import assert from "node:assert/strict";
import {
  CONDITION_V2_CONFIG, recoveryV2, stageLengthMultiplier, seasonLoadMultiplier, stageAccumulationMultiplierV2,
  workMultiplierV2, stageLoadV2, nextFormV2, settleDateFatigueV2, settleTrainingDateConditionV2, enteringFatigueV2,
} from "./conditionModelV2.js";
import { settleTrainingDateCondition } from "./trainingDateCondition.js";
import { CONDITION_CONFIG } from "./riderCondition.js";
import { isConditionModelV2Enabled } from "./conditionModelV2Flag.js";

const NEUTRAL_REC = 49.5; // andelen er præcis den gamle 0,15 her

test("dato uden etaper: samme formel som v1 for en middel-rytter (bit-identisk)", () => {
  for (const intensities of [
    ["hard", "hard", "hard", "hard", "hard"], ["rest", "rest", "rest", "rest", "rest"],
    ["normal", "easy", "recovery", "hard", "rest"], ["easy", "easy", "easy", "easy", "easy"],
  ]) {
    for (const fatigue of [0, 17, 42, 63, 88, 100]) {
      const args = { riderId: "r", dateStr: "2026-10-26", condition: { fatigue, form: 50 }, intensities, raceLoads: [0, 0, 0, 0, 0], recoveryAbility: NEUTRAL_REC };
      assert.equal(settleTrainingDateConditionV2(args).fatigue, settleTrainingDateCondition(args).fatigue, `${intensities} @${fatigue}`);
    }
  }
});

test("B1: en etape vejer et helt døgn, ikke en femtedel", () => {
  const intensities = ["race", "race", "race", "race", "rest"];
  const raceLoads = [18, 18, 18, 18, 0];
  const v1 = settleTrainingDateCondition({ riderId: "r", dateStr: "d", condition: { fatigue: 20, form: 80 }, intensities, raceLoads, recoveryAbility: 50 });
  const v2 = settleDateFatigueV2({ fatigue: 20, intensities, raceLoads, recoveryAbility: 50 });
  assert.ok(v1.fatigue <= 22, `v1 ${v1.fatigue}`);
  assert.ok(v2 >= 40, `v2 ${v2}`);
  // Hver etape: belastning minus én restitution, i rækkefølge.
  let f = 20;
  for (let i = 0; i < 4; i++) f = f + 18 - recoveryV2({ fatigue: f, recoveryAbility: 50 });
  f = f + -14 / 5 - recoveryV2({ fatigue: f, recoveryAbility: 50, share: 1 / 5 });
  assert.equal(v2, Math.round(f));
});

test("B1: en hel hviledato giver mere tilbage end en dato med fire etaper", () => {
  const rest = settleDateFatigueV2({ fatigue: 70, intensities: Array(5).fill("rest"), raceLoads: [0, 0, 0, 0, 0], recoveryAbility: 50 });
  assert.ok(rest < 55, `hviledato ${rest}`);
});

test("§5.4: høj recovery restituerer klart mere end lav", () => {
  const lo = recoveryV2({ fatigue: 60, recoveryAbility: 10 });
  const mid = recoveryV2({ fatigue: 60, recoveryAbility: NEUTRAL_REC });
  const hi = recoveryV2({ fatigue: 60, recoveryAbility: 90 });
  assert.ok(lo < mid && mid < hi);
  assert.ok(hi - lo > 5, `spænd ${hi - lo}`);
  assert.equal(recoveryV2({ fatigue: 60, recoveryAbility: 50, share: 0.2 }).toFixed(6), (recoveryV2({ fatigue: 60, recoveryAbility: 50 }) * 0.2).toFixed(6));
});

test("§5.2: profilrækkefølge og længde", () => {
  const p = CONDITION_V2_CONFIG.profileLoad;
  assert.ok(p.flat < p.rolling && p.rolling < p.hilly && p.hilly < p.medium_mountain && p.medium_mountain < p.mountain && p.mountain < p.high_mountain);
  assert.ok(p.itt > p.flat);
  assert.equal(stageLengthMultiplier("flat", 180), 1);
  assert.ok(stageLengthMultiplier("flat", 120) < 1 && stageLengthMultiplier("flat", 240) > 1);
  assert.equal(stageLengthMultiplier("itt", 9), 1);
  assert.equal(stageLengthMultiplier("flat", null), 1);
  assert.equal(stageLengthMultiplier("flat", 5000), CONDITION_V2_CONFIG.lengthMax);
});

test("B3: sæsonbelastning er glidende, starter efter de frie dage og har loft", () => {
  const free = CONDITION_V2_CONFIG.seasonFreeDays;
  assert.equal(seasonLoadMultiplier(0), 1);
  assert.equal(seasonLoadMultiplier(free), 1);
  const a = seasonLoadMultiplier(free + 1), b = seasonLoadMultiplier(free + 2);
  assert.ok(a > 1 && b > a);
  assert.ok(b - a < 0.05, "ingen trappe");
  assert.equal(seasonLoadMultiplier(1000), CONDITION_V2_CONFIG.seasonCap);
});

test("§5.5: akkumulering, arbejde og hentet udbrud", () => {
  assert.equal(stageAccumulationMultiplierV2(1), 1);
  assert.ok(stageAccumulationMultiplierV2(10) > stageAccumulationMultiplierV2(5));
  assert.equal(stageAccumulationMultiplierV2(100), stageAccumulationMultiplierV2(1 + CONDITION_V2_CONFIG.accumulationCapStages));
  const homeBreak = workMultiplierV2({ front: 1, shelter: 0 }, { profileType: "flat" });
  const caught = workMultiplierV2({ front: 1, shelter: 0, caught: true }, { profileType: "flat" });
  assert.ok(caught > homeBreak && homeBreak > 1);
  assert.ok(workMultiplierV2({ front: 0, shelter: 1 }, { profileType: "mountain" }) < 1);
  assert.equal(workMultiplierV2({ front: 1, caught: true }, { profileType: "itt" }), 1);
  assert.equal(workMultiplierV2({ front: 0, caught: true }, { profileType: "flat" }), 1, "caught uden frontarbejde koster intet");
});

test("stageLoadV2 = produktet af faktorerne; indsatsen tæller ikke på enkeltstart", () => {
  const base = stageLoadV2({ profileType: "mountain", distanceKm: 180 });
  assert.equal(base, CONDITION_V2_CONFIG.profileLoad.mountain);
  assert.ok(stageLoadV2({ profileType: "mountain", distanceKm: 180, effort: "protect" }) > base);
  assert.ok(stageLoadV2({ profileType: "mountain", distanceKm: 180, effort: "save" }) < base);
  assert.equal(stageLoadV2({ profileType: "itt", effort: "save" }), stageLoadV2({ profileType: "itt", effort: "normal" }));
  assert.ok(stageLoadV2({ profileType: "mountain", distanceKm: 180, seasonRaceDays: 45 }) > base);
  assert.equal(stageLoadV2({ profileType: "nope", distanceKm: 180 }), CONDITION_V2_CONFIG.unknownProfileLoad);
});

test("B4: inaktivitet og overbelastning koster form, passende belastning bygger den", () => {
  assert.equal(nextFormV2({ form: 80, fatigue: 2 }), 79);
  assert.equal(nextFormV2({ form: 80, fatigue: 20 }), 80);
  assert.equal(nextFormV2({ form: 80, fatigue: 40 }), 82);
  assert.equal(nextFormV2({ form: 95, fatigue: 40 }), 96, "langsommere mod toppen");
  assert.equal(nextFormV2({ form: 80, fatigue: 60 }), 80);
  assert.equal(nextFormV2({ form: 80, fatigue: 75 }), 78);
  assert.equal(nextFormV2({ form: 80, fatigue: 95 }), 76);
  assert.equal(nextFormV2({ form: 100, fatigue: 40 }), 100);
  assert.equal(nextFormV2({ form: 0, fatigue: 95 }), 0);
  assert.equal(nextFormV2({ form: NaN, fatigue: 40 }), 50);
});

test("settleTrainingDateConditionV2 bevarer v1's skaderisiko og signatur", () => {
  const args = { riderId: "r", dateStr: "2026-10-26", condition: { fatigue: 80, form: 70 }, intensities: ["hard", "hard", "race", "rest", "rest"], raceLoads: [0, 0, 20, 0, 0], recoveryAbility: 50 };
  const v1 = settleTrainingDateCondition(args);
  const v2 = settleTrainingDateConditionV2(args);
  assert.equal(v2.risk, v1.risk);
  assert.deepEqual(Object.keys(v2).sort(), ["fatigue", "form", "injury", "risk"]);
});

test("B2: træthed ved start af en senere etape samme dato", () => {
  assert.equal(enteringFatigueV2({ openingFatigue: 30 }), 30);
  const after = enteringFatigueV2({ openingFatigue: 30, priorLoadsToday: [20, 20], recoveryAbility: 50 });
  assert.ok(after > 40, `${after}`);
  // Samme regnestykke som afregningens etape-pladser.
  assert.equal(after, settleDateFatigueV2({ fatigue: 30, intensities: ["race", "race"], raceLoads: [20, 20], recoveryAbility: 50 }));
});

test("§5.8: en GT kan holdes under skadegrænsen med hvile, men ikke med hård træning og mange løbsdage", () => {
  const vuelta = [
    [["itt", 9], ["flat", 190], ["rolling", 180], ["hilly", 190]], [["itt_hilly", 26], ["mountain", 165], ["mountain", 185]],
    [["high_mountain", 180], ["flat", 185]], [["rolling", 180], ["mountain", 170], ["high_mountain", 165], ["high_mountain", 160]],
    [["hilly", 180], ["hilly", 195], ["high_mountain", 160]], [["flat", 170]],
  ];
  const ride = ({ free, seasonStart, recoveryAbility = 50 }) => {
    let f = 20, stage = 0, days = seasonStart, peak = 0;
    for (const stages of vuelta) {
      const intensities = [], raceLoads = [];
      for (const [profileType, distanceKm] of stages) {
        stage++; days++;
        intensities.push("race");
        raceLoads.push(stageLoadV2({ profileType, distanceKm, stageNumber: stage, seasonRaceDays: days }));
      }
      while (intensities.length < 5) { intensities.push(free); raceLoads.push(0); }
      f = settleDateFatigueV2({ fatigue: f, intensities, raceLoads, recoveryAbility });
      peak = Math.max(peak, f);
    }
    return peak;
  };
  assert.ok(ride({ free: "rest", seasonStart: 0 }) < CONDITION_CONFIG.injuryFatigueFloor, "frisk rytter med hvile holder sig under grænsen");
  assert.ok(ride({ free: "hard", seasonStart: 45 }) >= 90, "hård træning efter mange løbsdage gør ikke");
});

function flagClient(values, error = null) {
  return { from() { let key; return { select() { return this; }, eq(_c, v) { key = v; return this; }, async maybeSingle() { return { data: values[key] == null ? null : { value: values[key] }, error }; } }; } };
}
test("condition_model_v2: default off, kræver dato-modellen, fejl kaster", async () => {
  assert.equal(await isConditionModelV2Enabled(flagClient({})), false);
  assert.equal(await isConditionModelV2Enabled(flagClient({ condition_model_v2: "off" })), false);
  assert.equal(await isConditionModelV2Enabled(flagClient({ condition_model_v2: "on", training_condition_per_date: "on", training_tick_per_race_day: "on" })), true);
  await assert.rejects(isConditionModelV2Enabled(flagClient({ condition_model_v2: "on" })), /requires training_condition_per_date/);
  await assert.rejects(isConditionModelV2Enabled(flagClient({}, { message: "offline" })), /ownership/);
});

// #7332 (ejer 31/10 valg A, SLUKKET): spar mod uret sparer traethed som spar paa en flad etape.
test('#7332: spar/beskyt/grupetto paa enkeltstart faar flad-etapens spar-rabat; slukket = uaendret', async () => {
  const { saveIttLoadMultiplier7332 } = await import('./conditionModelV2.js');
  const { effortFatigueMultiplier } = await import('./raceRoles.js');
  const { setSaveItt7332ForBench, SAVE_ITT_7332_ACTIVE } = await import('./engine/v4/mechanics/effortCost.ts');
  const V3 = 's5_profiles_v3';
  const load = (effort, profileType, rulesRevision = V3) => stageLoadV2({ profileType, distanceKm: 30, effort, rulesRevision });
  assert.equal(SAVE_ITT_7332_ACTIVE, false, 'taend kraever ejerens ordrette go i en egen PR');
  // Slukket: som main, hvor enkeltstarter ignorerer indsatsen (spar = normal).
  for (const profileType of ['itt', 'itt_hilly', 'ttt']) {
    for (const effort of ['save', 'protect', 'grupetto']) {
      assert.equal(load(effort, profileType), load('normal', profileType), `${profileType}/${effort}: slukket = normal`);
      assert.equal(saveIttLoadMultiplier7332(effort, profileType, V3), null);
    }
  }
  const offAllOut = { itt: load('all_out', 'itt'), itt_hilly: load('all_out', 'itt_hilly') };
  const offMountainSave = load('save', 'mountain');
  try {
    setSaveItt7332ForBench({ active: true });
    const flatSave = effortFatigueMultiplier('save', { profileType: 'flat', rulesRevision: V3 });
    assert.ok(flatSave < 1, 'flad-etapens spar-rabat er en rabat');
    for (const profileType of ['itt', 'itt_hilly']) {
      const normal = load('normal', profileType);
      const save = load('save', profileType);
      assert.ok(save < normal, `${profileType}: spar er lavere belastning end normal`);
      assert.ok(Math.abs(save - normal * flatSave) < 1e-9, `${profileType}: praecis flad-etapens spar-rabat`);
      assert.equal(load('protect', profileType), save, `${profileType}: beskyt = spar`);
      assert.equal(load('grupetto', profileType), save, `${profileType}: grupetto = spar`);
      assert.equal(load('all_out', profileType), offAllOut[profileType], `${profileType}: alt ud uaendret`);
    }
    for (const effort of ['save', 'protect', 'grupetto']) {
      assert.equal(saveIttLoadMultiplier7332(effort, 'ttt', V3), null, `ttt/${effort}: holdtidskoerslen uroert`);
      assert.equal(load(effort, 'ttt'), load('normal', 'ttt'), `ttt/${effort}: som foer`);
    }
    for (const effort of ['normal', 'all_out']) assert.equal(saveIttLoadMultiplier7332(effort, 'itt', V3), null, `itt/${effort}: ikke omfattet`);
    assert.equal(load('save', 'mountain'), offMountainSave, 'vejetaper uroerte');
    for (const rev of ['s5_profiles_v2', 's5_profiles_v1', 'legacy', null]) {
      assert.equal(load('save', 'itt', rev), load('normal', 'itt', rev), `${String(rev)}: aeldre revisioner uroerte`);
    }
  } finally {
    setSaveItt7332ForBench(null);
  }
  assert.equal(load('save', 'itt'), load('normal', 'itt'), 'nulstillet = slukket');
});

// #6641/#7280: Alt ud-pakkens traethedspris (slukket kontakt; dev-bench-setteren taender den).
test('#7280: alt ud koster mere traethed under pakken, ogsaa i enkeltstart; slukket = uaendret', async () => {
  const { allOutLoadMultiplier7280, stageLoadV2 } = await import('./conditionModelV2.js');
  const { setAllOut7280ForBench } = await import('./engine/v4/mechanics/effortCost.ts');
  const load = (effort, profileType, rulesRevision = 's5_profiles_v3') => stageLoadV2({ profileType, distanceKm: 180, effort, rulesRevision });
  setAllOut7280ForBench({ active: false }); // kontakten er taendt (#7311); slukket-stien maales via bench-setteren
  const offMountain = load('all_out', 'mountain');
  const offItt = load('all_out', 'itt');
  assert.equal(allOutLoadMultiplier7280('all_out', 's5_profiles_v3'), null);
  try {
    setAllOut7280ForBench({ active: true });
    assert.ok(load('all_out', 'mountain') > offMountain, 'mere traethed paa en vejetape');
    assert.ok(load('all_out', 'itt') > offItt, 'og i enkeltstarten, hvor alt ud nu vinder tid');
    assert.equal(load('normal', 'mountain'), stageLoadV2({ profileType: 'mountain', distanceKm: 180, effort: 'normal', rulesRevision: 's5_profiles_v3' }));
    assert.equal(load('all_out', 'mountain', 's5_profiles_v2'), stageLoadV2({ profileType: 'mountain', distanceKm: 180, effort: 'all_out', rulesRevision: 's5_profiles_v2' }));
    assert.equal(allOutLoadMultiplier7280('protect', 's5_profiles_v3'), null);
    setAllOut7280ForBench({ active: false });
    assert.equal(load('all_out', 'mountain'), offMountain);
  } finally {
    setAllOut7280ForBench(null);
  }
});

// #7332 (spillerrapport 28/10, ejer: "alt ud skal give bedre praestation, men ogsaa mere
// traethed"): spillerens tilfaelde gennem HELE kaeden raceRunner koerer i prod. Ordren
// (race_team_orders.riders[].effort) -> orderEffortByRiderForStage -> resolveStageEntrants
// (simEntrant.effort) -> broen -> motorens enkeltstart -> broens efforts-kort ->
// stageConditionWork -> raceConditionLoads (condition v2, det frosne belastnings-snapshot).
// Samme rytter, samme seed, kun indsatsen skifter: alt ud er hurtigere OG belastes mere.
// Rodaarsagen til rapporterne (maalt, tal i balance-internals/7332/): enkeltstarten de to
// spillere sammenlignede, koerte foer kontakten (#7311) var i drift; dengang var alt ud
// uden virkning paa en flad enkeltstart. Testen laaser at kaeden holder fremover.
test('#7332: alt ud paa enkeltstart er hurtigere og koster mere traethed, gennem hele kaeden', async () => {
  const { createRaceEngineV4Adapter } = await import('./raceEngineV4Bridge.js');
  const { orderEffortByRiderForStage, resolveStageEntrants } = await import('./raceStageRoles.js');
  const { raceConditionLoads, stageConditionWork } = await import('./raceFatigue.js');
  const [core, tuning, entrants, route, orders, timeline] = await Promise.all([
    import('./engine/v4/index.ts'), import('./engine/v4/tuning.ts'), import('./engine/v4/adapters/entrantAdapter.ts'),
    import('./engine/v4/adapters/routeAdapter.ts'), import('./engine/v4/orders/teamOrdersAdapter.ts'), import('./engine/v4/timeline.ts'),
  ]);
  const engine = createRaceEngineV4Adapter({ core, tuning, entrants, route, orders, timeline });
  const KEYS = ['climbing', 'time_trial', 'flat', 'tempo', 'sprint', 'acceleration', 'punch', 'endurance', 'recovery', 'durability', 'descending', 'cobblestone', 'positioning', 'aggression', 'tactics'];
  // Feltet: 48 ryttere paa hold a 8, TT-evnen spredt. Rytter A (hold 0) er en middel tidskoerer.
  const field = Array.from({ length: 48 }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, '0')}`,
    team_id: `team${Math.floor(i / 8)}`,
    abilities: Object.fromEntries(KEYS.map((k) => [k, k === 'time_trial' ? 82 - (i % 24) * 2 : 60])),
    race_role: 'free_role',
    fatigue: 20,
  }));
  const RIDER_A = 'r010';
  const REVISION = 's5_profiles_v3';
  const profiles = {
    itt: { race_id: 'race-7332', stage_number: 1, profile_type: 'itt', finale_type: 'solo_tt', distance_km: 30, segments: [{ kind: 'flat', from_km: 0, to_km: 30 }], weather: { kind: 'sun', wind_exposure: 0.3 } },
    itt_hilly: {
      race_id: 'race-7332', stage_number: 1, profile_type: 'itt_hilly', finale_type: 'solo_tt', distance_km: 30,
      segments: [{ kind: 'flat', from_km: 0, to_km: 10 }, { kind: 'climb', from_km: 10, to_km: 16, category: '2', avg_gradient: 6, top_elevation_m: 700 }, { kind: 'descent', from_km: 16, to_km: 21, technicality: 1 }, { kind: 'flat', from_km: 21, to_km: 30 }],
      weather: { kind: 'sun', wind_exposure: 0.3 },
    },
  };
  function runStage(stageProfile, effort, seedString) {
    const teamOrderRows = [{ team_id: 'team1', stage_number: 1, breakaway_stance: 'neutral', riders: [{ rider_id: RIDER_A, effort, try_break: false, leadout: false }] }];
    const orderEffortByRider = orderEffortByRiderForStage(teamOrderRows, 1);
    const simEntrants = resolveStageEntrants(field, undefined, { orderEffortByRider }).entrants;
    const out = engine.simulateStage({ entrants: simEntrants, stageProfile, seedString, stageNumber: 1, teamOrderRows, rulesRevision: REVISION });
    const work = stageConditionWork({ rulesRevision: REVISION, stageNumber: 1, profileType: stageProfile.profile_type, v4Result: { v4Output: out.v4Output, efforts: out.efforts } });
    const loads = raceConditionLoads(field.map((e) => e.rider_id), stageProfile.profile_type, null, REVISION, work, { distanceKm: stageProfile.distance_km, seasonRaceDaysByRider: new Map() });
    const result = out.v4Output.results.find((r) => r.rider_id === RIDER_A);
    return { seconds: result.time_seconds, load: loads.find((l) => l.rider_id === RIDER_A).load, engineEffort: out.efforts.get(RIDER_A) };
  }
  for (const [kind, stageProfile] of Object.entries(profiles)) {
    for (const seed of ['s7332-a', 's7332-b', 's7332-c']) {
      const normal = runStage(stageProfile, 'normal', seed);
      const allOut = runStage(stageProfile, 'all_out', seed);
      assert.equal(allOut.engineEffort, 'all_out', `${kind}/${seed}: motoren koerer rytteren paa alt ud`);
      assert.ok(allOut.seconds < normal.seconds, `${kind}/${seed}: alt ud er hurtigere (${allOut.seconds} mod ${normal.seconds})`);
      assert.ok(allOut.load > normal.load, `${kind}/${seed}: alt ud koster mere traethed (${allOut.load} mod ${normal.load})`);
      // Spar er ikke en gratis gevinst paa enkeltstarten: aldrig hurtigere end normal.
      const save = runStage(stageProfile, 'save', seed);
      assert.ok(save.seconds >= normal.seconds, `${kind}/${seed}: spar er ikke hurtigere end normal`);
    }
  }
});
