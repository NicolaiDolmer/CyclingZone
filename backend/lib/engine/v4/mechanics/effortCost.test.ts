// backend/lib/engine/v4/mechanics/effortCost.test.ts
// Kontrakt-tests + property-test (fast-check, 200 runs, seeded) for M12
// (effort-styring). SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-
// intra-stage-design.md §4 M12; opgave-brief: "effortFatigueMultiplier-
// moensteret fra raceRoles.js genimplementeres RENT i v4".
//
// Testene laaser HENSIGTEN (retning + bounded stoerrelse), ikke implementations-
// detaljer: protect koster MERE end normal, save koster MINDRE end normal,
// ALDRIG omvendt fortegn, og applyEffortToDemand aendrer aldrig fortegn paa
// demand (0 -> 0, positiv -> positiv, aldrig negativ).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { ALL_OUT_7280_ACTIVE, ALL_OUT_7280_TUNING, allOut7280Active, allOut7280Tuning, allOutDemandMultiplier, allOutTimeTrialFactor7280, applyEffortToDemand, climbGapEffortFactor, EFFORT_COST_TUNING, EFFORT_COST_TUNING_6641, effortCostTuningFor, effortDemandMultiplier, isAllOut7280On, isEffortCalibration6641Revision, setAllOut7280ForBench } from "./effortCost.ts";
import { decidingClimbSelectionsOnTheDay, effortClimbScoreFactor } from "./climbSelection.ts";
import { isS5ProfilesV3OrLater, RACE_RULES_REVISIONS } from "../../../raceEngineRulesRevision.ts";
import type { EffortLevel } from "../types.ts";

test("effortDemandMultiplier: protect > normal > save (raceRoles FATIGUE_MULTIPLIER-anker: 1.2 / 1.0 / 0.7)", () => {
  const protect = effortDemandMultiplier("protect");
  const normal = effortDemandMultiplier("normal");
  const save = effortDemandMultiplier("save");
  assert.ok(protect > normal, `protect (${protect}) skal koste MERE end normal (${normal})`);
  assert.ok(normal > save, `normal (${normal}) skal koste MERE end save (${save})`);
  assert.equal(protect, EFFORT_COST_TUNING.demandMultiplierProtect);
  assert.equal(normal, EFFORT_COST_TUNING.demandMultiplierNormal);
  assert.equal(save, EFFORT_COST_TUNING.demandMultiplierSave);
});

test("effortDemandMultiplier: normal er neutral (multiplikator 1) med default-tuning", () => {
  assert.equal(effortDemandMultiplier("normal"), 1);
});

test("effortDemandMultiplier: ren funktion — samme effort giver ALTID samme multiplikator", () => {
  const levels: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
  for (const level of levels) {
    const a = effortDemandMultiplier(level);
    const b = effortDemandMultiplier(level);
    assert.equal(a, b);
  }
});

test("effortDemandMultiplier: custom tuning respekteres (ikke hardkodet til default-konstanterne)", () => {
  const customTuning = {
    demandMultiplierGrupetto: 0.05, demandMultiplierProtect: 2, demandMultiplierNormal: 1,
    demandMultiplierSave: 0.1, demandMultiplierAllOut: 3,
  };
  assert.equal(effortDemandMultiplier("protect", customTuning), 2);
  assert.equal(effortDemandMultiplier("save", customTuning), 0.1);
  assert.equal(effortDemandMultiplier("grupetto", customTuning), 0.05);
  assert.equal(effortDemandMultiplier("all_out", customTuning), 3);
});

test("applyEffortToDemand: skalerer demand, aendrer ALDRIG fortegn (0 -> 0, positiv -> positiv)", () => {
  assert.equal(applyEffortToDemand(0, "protect"), 0);
  assert.equal(applyEffortToDemand(0, "save"), 0);
  assert.ok(applyEffortToDemand(0.5, "protect") > 0);
  assert.ok(applyEffortToDemand(0.5, "save") > 0);
});

test("applyEffortToDemand: negativ demand clampes forsvarsmaessigt til 0 foer skalering", () => {
  assert.equal(applyEffortToDemand(-5, "protect"), 0);
  assert.equal(applyEffortToDemand(-5, "normal"), 0);
});

test("applyEffortToDemand: protect >= normal >= save for samme positive demand (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(fc.float({ min: 0, max: 5, noNaN: true }), (demand) => {
      const protect = applyEffortToDemand(demand, "protect");
      const normal = applyEffortToDemand(demand, "normal");
      const save = applyEffortToDemand(demand, "save");
      assert.ok(protect >= normal - 1e-9, `protect (${protect}) < normal (${normal}) ved demand=${demand}`);
      assert.ok(normal >= save - 1e-9, `normal (${normal}) < save (${save}) ved demand=${demand}`);
      assert.ok(protect >= 0 && normal >= 0 && save >= 0);
    }),
    { numRuns: 200, seed: 4030 },
  );
});

test("determinisme: gentagne kald med samme input giver byte-identisk resultat", () => {
  const a = applyEffortToDemand(0.42, "protect");
  const b = applyEffortToDemand(0.42, "protect");
  assert.equal(a, b);
});

// ── #4632 (loebsdagens intention): femtrins-skalaen ──────────────────────────
test("#4632: effortDemandMultiplier er strengt stigende over alle FEM trin (grupetto < save < normal < protect < all_out)", () => {
  const scale: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
  const values = scale.map((level) => effortDemandMultiplier(level));
  for (let i = 1; i < values.length; i++) {
    assert.ok(
      values[i]! > values[i - 1]!,
      `${scale[i]} (${values[i]}) skal koste MERE end ${scale[i - 1]} (${values[i - 1]})`,
    );
  }
});

test("#4632: all_out koster ALTID strengt mere end normal, grupetto strengt mindre (ingen gratis all-out)", () => {
  assert.ok(effortDemandMultiplier("all_out") > effortDemandMultiplier("normal"));
  assert.ok(effortDemandMultiplier("grupetto") < effortDemandMultiplier("normal"));
});

// ── #4914 -> #5580 (M1 punkt 4): all_out er SEGMENT-terraen-afhaengig ────────
test("#5580: all_out paa flade/rullende SEGMENTER koster MERE end paa en stigning; oevrige terraener bruger den faelles vaerdi", () => {
  const common = EFFORT_COST_TUNING.demandMultiplierAllOut;
  assert.ok(effortDemandMultiplier("all_out", EFFORT_COST_TUNING, "flat") > common);
  assert.ok(effortDemandMultiplier("all_out", EFFORT_COST_TUNING, "rolling") > common);
  for (const kind of ["climb", "descent", "cobbles"] as const) {
    assert.equal(effortDemandMultiplier("all_out", EFFORT_COST_TUNING, kind), common, kind);
  }
  assert.equal(effortDemandMultiplier("all_out"), common, "uden terraen: den faelles vaerdi (bagudkompatibelt)");
});

test("#5580: tabellen er noeglet paa segment-terraen, ikke etapeprofil (#4914's flat/rolling-vaerdier overfoert 1:1)", () => {
  const table = EFFORT_COST_TUNING.demandMultiplierAllOutBySegmentKind ?? {};
  assert.deepEqual(Object.keys(table).sort(), ["flat", "rolling"]);
  assert.equal("demandMultiplierAllOutByProfile" in EFFORT_COST_TUNING, false, "den gamle profil-noegle maa ikke leve videre ved siden af");
});

test("#5580: terraenet flytter KUN all_out — de fire andre trin er terraen-uafhaengige", () => {
  for (const effort of ["grupetto", "save", "normal", "protect"] as EffortLevel[]) {
    for (const kind of ["flat", "rolling", "climb", "descent", "cobbles"] as const) {
      assert.equal(
        effortDemandMultiplier(effort, EFFORT_COST_TUNING, kind),
        effortDemandMultiplier(effort, EFFORT_COST_TUNING),
        `${effort}/${kind}`,
      );
    }
  }
});

test("#5580: femtrins-ordenen holder paa ALLE segment-terraener (grupetto < save < normal < protect < all_out)", () => {
  const scale: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
  for (const kind of ["flat", "rolling", "climb", "descent", "cobbles"] as const) {
    const values = scale.map((level) => effortDemandMultiplier(level, EFFORT_COST_TUNING, kind));
    for (let i = 1; i < values.length; i++) assert.ok(values[i]! > values[i - 1]!, `${kind}: ${scale[i]} <= ${scale[i - 1]}`);
  }
});

test("#4914: en ugyldig tabel-vaerdi (NaN, under protect) ignoreres — all_out bliver aldrig billigere end protect", () => {
  const base = { ...EFFORT_COST_TUNING };
  for (const bad of [Number.NaN, 0.5, base.demandMultiplierProtect]) {
    const tuning = { ...base, demandMultiplierAllOutBySegmentKind: { flat: bad } };
    assert.equal(allOutDemandMultiplier("flat", tuning), base.demandMultiplierAllOut, String(bad));
  }
  const withoutTable = { ...base, demandMultiplierAllOutBySegmentKind: undefined };
  assert.equal(allOutDemandMultiplier("flat", withoutTable), base.demandMultiplierAllOut);
  assert.equal(allOutDemandMultiplier(null), base.demandMultiplierAllOut);
});

test("#4632: applyEffortToDemand aendrer aldrig fortegn paa nogen af de fem trin", () => {
  const scale: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
  for (const level of scale) {
    assert.equal(applyEffortToDemand(0, level), 0, level);
    assert.equal(applyEffortToDemand(-3, level), 0, level);
    assert.ok(applyEffortToDemand(1.5, level) > 0, level);
  }
});

// ── #6641: kalibreringen bag s5_profiles_v3 (slukket) ──────────────────────────
test("#6641: alle revisioner foer s5_profiles_v3 faar den uaendrede tuning (samme objekt = bit-identisk)", () => {
  for (const revision of [...RACE_RULES_REVISIONS.filter((r) => !isS5ProfilesV3OrLater(r)), null, undefined]) {
    assert.equal(effortCostTuningFor(revision), EFFORT_COST_TUNING, String(revision));
    assert.equal(isEffortCalibration6641Revision(revision), false, String(revision));
  }
});

test("#6641: s5_profiles_v3 faar den kalibrerede tuning", () => {
  assert.equal(isEffortCalibration6641Revision("s5_profiles_v3"), true);
  assert.equal(effortCostTuningFor("s5_profiles_v3"), EFFORT_COST_TUNING_6641);
});

test("#6641: femtrins-ordenen holder i den kalibrerede tuning paa ALLE segment-terraener", () => {
  const scale: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
  for (const kind of ["flat", "rolling", "climb", "descent", "cobbles", null] as const) {
    const values = scale.map((level) => effortDemandMultiplier(level, EFFORT_COST_TUNING_6641, kind));
    for (let i = 1; i < values.length; i++) assert.ok(values[i]! > values[i - 1]!, `${kind}: ${scale[i]} <= ${scale[i - 1]}`);
  }
  assert.equal(effortDemandMultiplier("normal", EFFORT_COST_TUNING_6641), 1, "normal er stadig neutral");
});

test("#6641: gevinsten paa hullet er 1 uden for s5_profiles_v3 (aeldre revisioner bit-identiske)", () => {
  for (const level of ["grupetto", "save", "normal", "protect", "all_out"] as EffortLevel[]) {
    for (const reserve of [0, 0.5, 1]) {
      assert.equal(climbGapEffortFactor(false, effortClimbScoreFactor(level, reserve)), 1, `${level}/${reserve}`);
    }
  }
  assert.equal(climbGapEffortFactor(true, Number.NaN), 1);
});

test("#6641 (ejer 25/10, som i virkeligheden): all_out graver dybere, save giver slip, normal er neutral", () => {
  const gap = (level: EffortLevel, reserve: number) => climbGapEffortFactor(true, effortClimbScoreFactor(level, reserve));
  for (const reserve of [0.25, 0.5, 1]) {
    assert.equal(gap("normal", reserve), 1, "normal er praecis neutral");
    assert.ok(gap("all_out", reserve) < gap("protect", reserve) && gap("protect", reserve) < 1, `${reserve}: all_out < protect < normal paa hullet`);
    assert.ok(gap("save", reserve) > 1, `${reserve}: save taber lidt paa hullet`);
  }
  // Gevinsten er betalt med reserven: tom reserve = ingen gevinst.
  assert.equal(gap("all_out", 0), 1);
  assert.ok(gap("all_out", 1) < gap("all_out", 0.5), "jo mere i tanken, jo dybere kan han grave");
});

test("#6641: retningen af kalibreringen — all_out og protect billigere, save taettere paa normal, grupetto uroert", () => {
  const old = EFFORT_COST_TUNING;
  const cal = EFFORT_COST_TUNING_6641;
  assert.ok(cal.demandMultiplierAllOut < old.demandMultiplierAllOut, "all_out op ad stigningen var en faelde");
  assert.ok(cal.demandMultiplierProtect < old.demandMultiplierProtect);
  assert.ok(cal.demandMultiplierSave > old.demandMultiplierSave && cal.demandMultiplierSave < 1, "save sparer stadig, men mindre");
  assert.equal(cal.demandMultiplierGrupetto, old.demandMultiplierGrupetto);
  assert.ok(allOutDemandMultiplier("climb", cal) > 1, "all_out koster stadig mere end normal (ingen gratis all-out)");
});

test("#6641: all_out-tabellen pr. segment-terraen foelger samme regel (flad/rullende dyrere end stigningen)", () => {
  const cal = EFFORT_COST_TUNING_6641;
  assert.deepEqual(Object.keys(cal.demandMultiplierAllOutBySegmentKind ?? {}).sort(), ["flat", "rolling"]);
  assert.ok(allOutDemandMultiplier("flat", cal) > cal.demandMultiplierAllOut);
  assert.ok(allOutDemandMultiplier("rolling", cal) > cal.demandMultiplierAllOut);
  // Samme andel af gruppens tempo som i den gamle tuning: forholdet flad/stigning er uaendret.
  const ratioOld = allOutDemandMultiplier("flat", EFFORT_COST_TUNING) / EFFORT_COST_TUNING.demandMultiplierAllOut;
  const ratioNew = allOutDemandMultiplier("flat", cal) / cal.demandMultiplierAllOut;
  assert.ok(Math.abs(ratioOld - ratioNew) < 1e-12);
  assert.ok(Object.isFrozen(cal) && Object.isFrozen(cal.demandMultiplierAllOutBySegmentKind));
});

// ── #7280: Alt ud efter ejerens design 27/10, bag en SLUKKET kontakt ──────────
test("#7280: kontakten er slukket, saa den aktuelle revision koerer bit-identisk med main", () => {
  assert.equal(ALL_OUT_7280_ACTIVE, false, "taend kun med ejerens ordrette go");
  assert.equal(allOut7280Active(), false);
  assert.equal(effortCostTuningFor("s5_profiles_v3"), EFFORT_COST_TUNING_6641);
  assert.equal(isAllOut7280On("s5_profiles_v3"), false);
  assert.equal(allOutTimeTrialFactor7280("all_out", 99, isAllOut7280On("s5_profiles_v3")), 1);
  for (const revision of [...RACE_RULES_REVISIONS.filter((r) => !isS5ProfilesV3OrLater(r)), null, undefined]) {
    assert.equal(effortCostTuningFor(revision, true), EFFORT_COST_TUNING, `${String(revision)}: aeldre revisioner uroert ogsaa med kontakten taendt`);
  }
});

test("#7280 (taendt): alt ud koerer som normal paa transport-terraenet, de fire andre trin er #6641's", () => {
  const cal = effortCostTuningFor("s5_profiles_v3", true);
  for (const kind of ["flat", "rolling", "descent"] as const) {
    assert.equal(effortDemandMultiplier("all_out", cal, kind), effortDemandMultiplier("normal", cal, kind), `${kind}: ingen pris, ingen gevinst`);
  }
  assert.ok(effortDemandMultiplier("all_out", cal, "climb") >= effortDemandMultiplier("normal", cal, "climb"));
  for (const level of ["grupetto", "save", "normal", "protect"] as EffortLevel[]) {
    for (const kind of ["flat", "rolling", "climb", "descent", "cobbles", null] as const) {
      assert.equal(effortDemandMultiplier(level, cal, kind), effortDemandMultiplier(level, EFFORT_COST_TUNING_6641, kind), `${level}/${kind}: uaendret`);
    }
  }
  // Gulvet: en tabel-vaerdi under normal ignoreres stadig (falder tilbage paa faelles-vaerdien).
  const broken = { ...cal, demandMultiplierAllOutBySegmentKind: { flat: 0.5 } };
  assert.equal(allOutDemandMultiplier("flat", broken), cal.demandMultiplierAllOut);
});

test("#7280: bench-setteren taender og nulstiller (kun dev-benches)", () => {
  try {
    setAllOut7280ForBench({ active: true, tuning: { timeTrialGain: 0.02 } });
    assert.equal(isAllOut7280On("s5_profiles_v3"), true);
    assert.equal(isAllOut7280On("s5_profiles_v2"), false, "kun s5_profiles_v3 og senere");
    assert.ok(Math.abs(allOutTimeTrialFactor7280("all_out", 99, true) - 1.02) < 1e-12);
    assert.ok(allOutTimeTrialFactor7280("all_out", 50, true) < allOutTimeTrialFactor7280("all_out", 90, true), "mest de staerke");
    assert.equal(allOutTimeTrialFactor7280("normal", 99, true), 1);
    assert.equal(allOut7280Tuning().fatigueLoad, ALL_OUT_7280_TUNING.fatigueLoad);
  } finally {
    setAllOut7280ForBench(null);
  }
  assert.equal(allOut7280Active(), false);
  assert.ok(Object.isFrozen(ALL_OUT_7280_TUNING));
});

test("#6641: gevinsten overlever nedkoerselsfinalens genberegnede underskud (dagsform + angreb)", () => {
  const sel = (riderId: string, gapEffortFactor?: number) => ({ riderId, baseScore: 0, scoreTriggered: false, wprimeForced: false, effortForced: false, deficit01: 0, energyDeficit01: 0, ...(gapEffortFactor === undefined ? {} : { gapEffortFactor }) });
  const climbing: Record<string, number> = { best: 80, a: 60, b: 60 };
  const t = { descentFinishClimbDayformWeight: 0.1, descentFinishClimbAttackWindowSeconds: 0, descentFinishClimbAttackDayformWeight: 0 };
  const out = decidingClimbSelectionsOnTheDay([sel("best"), sel("a", 0.5), sel("b")], (id) => climbing[id]!, () => 0, (d) => d * 100, t);
  const a = out.find((s) => s.riderId === "a")!.deficit01;
  const b = out.find((s) => s.riderId === "b")!.deficit01;
  assert.ok(b > 0);
  assert.ok(Math.abs(a - b * 0.5) < 1e-12, "faktoren gaelder ogsaa paa det genberegnede underskud");
  // Uden faktor (alle aeldre revisioner) er resultatet det gamle.
  const old = decidingClimbSelectionsOnTheDay([sel("best"), sel("a"), sel("b")], (id) => climbing[id]!, () => 0, (d) => d * 100, t);
  assert.equal(old.find((s) => s.riderId === "a")!.deficit01, b);
});
