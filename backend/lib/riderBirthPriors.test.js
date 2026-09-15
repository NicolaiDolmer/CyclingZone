// Kontrakt for #5269 — rytter-fødsel uden PCM-stats.
//
// De vigtigste gates her er de to der holder resten af systemet ærligt:
//   1. SPEJLINGEN. Priorerne er den lineære afbildning (faktor 98/35) af de
//      eksisterende ARCHETYPES/TIERS/YOUTH_GEN_CONFIG-tabeller. Drifter den ene
//      side fra den anden, flytter populationen sig i stilhed — og ejer-kravet
//      var udtrykkeligt "ryttere skal stadig vaere de samme nu her inde i spillet".
//   2. REPRODUKTIONEN. En nyfødt rytters evner skal kunne genskabes PRÆCIS fra
//      den persisterede række alene, ellers nulstiller den næste heal-sweep ham.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BIRTH_ARCHETYPE_PROFILES, BIRTH_ARCHETYPE_KEYS, BIRTH_TIERS, BIRTH_TIER_KEYS,
  TYPE_MEAN_ADJUST_ABILITY, YOUTH_BIRTH_BAND, DEFAULT_PRIOR_BY_CATEGORY, AGE_CURVED,
  COMPOSITE_ABILITIES, ABILITY_FLOOR, ABILITY_CEIL, PCM_TO_ABILITY_GAIN,
  statPointsToAbility, statLevelToAbility, makeBirthRng, drawBirthAbilities,
  drawYouthBirthAbilities, birthHiddenPotential, makeBirthMarker, makeYouthBirthMarker,
  withBirthAbilityCap, isBornFromPriors, deriveBirthAbilities, birthAbilityKeys,
  birthPriorCoverage, physiologySeedInputFromAbilities, blendBirthProfiles,
} from "./riderBirthPriors.js";
import {
  ARCHETYPES, ARCHETYPE_BY_TYPE, makeRng, STAT_KEYS,
} from "./fictionalRiderGenerator.js";
import { YOUTH_GEN_CONFIG } from "./academyGenerator.js";
import {
  REGISTRY_ABILITY_KEYS, REGISTRY_PRIMARY_STAT, ABILITY_REGISTRY,
} from "./abilityRegistry.js";
import { deriveAbilities, FILL_TAIL_ABILITY_CAP, FILL_TAIL_GENERATION_TAG } from "./abilityDerivation.js";
import { RIDER_TYPES } from "./riderTypes.js";

const STAT_TO_ABILITY = {
  ...Object.fromEntries(Object.entries(REGISTRY_PRIMARY_STAT).map(([ability, stat]) => [stat, ability])),
  // `aggression` er registreret som `derivation: { source: "skill" }` og staar
  // derfor ikke i REGISTRY_PRIMARY_STAT — men abilityDerivation.js udleder den
  // de facto af stat_ftr (0,85·pcmFrac(stat_ftr) + 0,15·youth). Det er netop
  // alders-leddet #5269 fjerner; stat-siden af koblingen er den samme.
  stat_ftr: "aggression",
};
const CLASSIFIER_WEIGHTS_BY_TYPE = Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights]));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── 1. Spejlingen af de eksisterende tabeller ────────────────────────────────

test("skalaen er PCM-afbildningen: 50 -> 1, 85 -> 99, 98/35 pr. point", () => {
  assert.ok(near(PCM_TO_ABILITY_GAIN, 98 / 35));
  assert.ok(near(statLevelToAbility(50), 1));
  assert.ok(near(statLevelToAbility(85), 99));
  assert.ok(near(statPointsToAbility(1), 98 / 35));
});

test("arketype-profilerne er ARCHETYPES spejlet i evne-rummet (ingen drift)", () => {
  assert.deepEqual(BIRTH_ARCHETYPE_KEYS.slice().sort(), ARCHETYPES.map((a) => a.type).sort());
  for (const arch of ARCHETYPES) {
    const profile = BIRTH_ARCHETYPE_PROFILES[arch.type];
    assert.ok(profile, `mangler prior for arketype ${arch.type}`);

    for (const [statKey, points] of Object.entries(arch.boost)) {
      // stat_prl (prolog) har ingen evne: abilityDerivation slår den sammen med
      // stat_tt via max(), så tt-arketypens prl-boost er absorberet i time_trial.
      if (statKey === "stat_prl") continue;
      const ability = STAT_TO_ABILITY[statKey];
      assert.ok(ability, `${statKey} har ingen evne i registret`);
      assert.ok(
        near(profile.boost[ability], points * PCM_TO_ABILITY_GAIN),
        `${arch.type}.${ability}: ${profile.boost[ability]} != ${points} * 98/35`,
      );
    }
    assert.equal(Object.keys(profile.boost).length, Object.keys(arch.boost).filter((k) => k !== "stat_prl").length);

    const expectedDamp = (arch.damp ?? []).map((s) => STAT_TO_ABILITY[s]).sort();
    assert.deepEqual([...(profile.damp ?? [])].sort(), expectedDamp, `${arch.type}: damp-listen afviger`);

    if (arch.minStats) {
      for (const [statKey, floor] of Object.entries(arch.minStats)) {
        assert.ok(near(profile.minAbilities[STAT_TO_ABILITY[statKey]], statLevelToAbility(floor)));
      }
    } else {
      assert.equal(profile.minAbilities ?? null, null, `${arch.type} har et gulv ARCHETYPES ikke har`);
    }
    if (arch.capSpeciality != null) {
      assert.ok(near(profile.capSpeciality, statLevelToAbility(arch.capSpeciality)));
    } else {
      assert.equal(profile.capSpeciality ?? null, null, `${arch.type} har et loft ARCHETYPES ikke har`);
    }
  }
});

test("tier-baandene er TIERS spejlet (niveau, spredning, damp-skala)", () => {
  // Tallene her er TIERS' egne (fictionalRiderGenerator.js) — skrevet ud, så
  // testen fejler hvis ÉN af de to sider flyttes uden den anden.
  const expected = {
    superstar: { statMean: 70.75, sd: 1.5, dampScale: 0.35 },
    star: { statMean: 67, sd: 2.5, dampScale: 0.5 },
    solid: { statMean: 63.75, sd: 2.75, dampScale: 0.75 },
    domestique: { statMean: 53, sd: 3.5, dampScale: 1 },
  };
  assert.deepEqual(BIRTH_TIER_KEYS.slice().sort(), Object.keys(expected).sort());
  for (const [key, e] of Object.entries(expected)) {
    const band = BIRTH_TIERS[key];
    assert.ok(near(band.mean, statLevelToAbility(e.statMean)), `${key}.mean`);
    assert.ok(near(band.sd, statPointsToAbility(e.sd)), `${key}.sd`);
    assert.equal(band.dampScale, e.dampScale, `${key}.dampScale`);
  }
});

test("ungdomsbaandet er YOUTH_GEN_CONFIG spejlet", () => {
  assert.ok(near(YOUTH_BIRTH_BAND.baseAt16, statLevelToAbility(YOUTH_GEN_CONFIG.baseStatAt16)));
  assert.ok(near(YOUTH_BIRTH_BAND.perYearOver16, statPointsToAbility(YOUTH_GEN_CONFIG.statPerYearOver16)));
  assert.ok(near(YOUTH_BIRTH_BAND.potStartLift, statPointsToAbility(YOUTH_GEN_CONFIG.potStartLift)));
  assert.ok(near(YOUTH_BIRTH_BAND.startLuckSd, statPointsToAbility(YOUTH_GEN_CONFIG.startLuckSd)));
  assert.ok(near(YOUTH_BIRTH_BAND.sd, statPointsToAbility(YOUTH_GEN_CONFIG.sd)));
  assert.ok(near(YOUTH_BIRTH_BAND.ceil, statLevelToAbility(YOUTH_GEN_CONFIG.statCeil)));
  assert.ok(near(YOUTH_BIRTH_BAND.ceilBoosted, statLevelToAbility(YOUTH_GEN_CONFIG.statCeilBoosted)));
  assert.ok(near(YOUTH_BIRTH_BAND.signatureBoostPerWeight, statPointsToAbility(YOUTH_GEN_CONFIG.signatureBoostPerWeight)));
  assert.ok(near(YOUTH_BIRTH_BAND.dampPerWeight, statPointsToAbility(YOUTH_GEN_CONFIG.dampPerWeight)));
  assert.equal(YOUTH_BIRTH_BAND.secondarySignatureWeight, YOUTH_GEN_CONFIG.secondarySignatureWeight);
  assert.equal(YOUTH_BIRTH_BAND.gcTimeTrialBoostRatio, YOUTH_GEN_CONFIG.gcTimeTrialBoostRatio);
  assert.equal(YOUTH_BIRTH_BAND.gcClimbingBoostRatio, YOUTH_GEN_CONFIG.gcClimbingBoostRatio);
});

test("TYPE_MEAN_ADJUST er spejlet for alle otte arketyper", () => {
  for (const key of BIRTH_ARCHETYPE_KEYS) {
    assert.ok(Number.isFinite(TYPE_MEAN_ADJUST_ABILITY[key]), `${key} mangler vaerdi-udligning`);
  }
  assert.ok(near(TYPE_MEAN_ADJUST_ABILITY.rouleur, statPointsToAbility(1.5)));
  assert.ok(near(TYPE_MEAN_ADJUST_ABILITY.sprinter, statPointsToAbility(-1.5)));
  assert.equal(TYPE_MEAN_ADJUST_ABILITY.brostensrytter, 0);
});

test("den lokale PRNG er bit-identisk med generatorens makeRng", () => {
  const a = makeRng(123456);
  const b = makeBirthRng(123456);
  for (let i = 0; i < 500; i++) assert.equal(a(), b());
});

// ── 2. Evne-listen kommer fra registret ──────────────────────────────────────

test("evne-listen HENTES fra registret (ingen hardkodede navne)", () => {
  assert.deepEqual(birthAbilityKeys(), REGISTRY_ABILITY_KEYS);
  const drawn = drawBirthAbilities({ rng: makeBirthRng(1), tier: "solid", archetype: "climber" });
  assert.deepEqual(Object.keys(drawn).sort(), [...REGISTRY_ABILITY_KEYS].sort());
});

test("hver registret evne har en dokumenteret prior-kilde", () => {
  const coverage = birthPriorCoverage();
  assert.equal(coverage.length, ABILITY_REGISTRY.length);
  for (const row of coverage) {
    assert.ok(["archetype", "composite", "category-default"].includes(row.source), `${row.key}: ${row.source}`);
  }
  // De to sammensatte er positioning og tactics — og INGEN af dem er alders-kurvet.
  const composite = coverage.filter((c) => c.source === "composite").map((c) => c.key).sort();
  assert.deepEqual(composite, ["positioning", "tactics"]);
  for (const key of ["tactics", "aggression"]) {
    assert.equal(AGE_CURVED[key], undefined, `${key} maa IKKE vaere alders-kurvet (ejer-krav #5269)`);
  }
  assert.deepEqual(Object.keys(COMPOSITE_ABILITIES).sort(), ["cobblestone", "positioning", "tactics"]);
});

test("#5268-forward-guard: en ny MENTAL evne faar automatisk en fornuftig prior", () => {
  // teamwork/leadership findes ikke i registret endnu. Den dag de lander skal de
  // have en prior UDEN at denne fil skal roeres — derfor kategori-defaulten.
  const keys = [...REGISTRY_ABILITY_KEYS, "teamwork", "leadership"];
  const drawn = drawBirthAbilities({ rng: makeBirthRng(9), tier: "solid", archetype: "gc", age: 27, abilityKeys: keys });
  for (const key of ["teamwork", "leadership"]) {
    assert.ok(Number.isInteger(drawn[key]), `${key} fik ingen vaerdi`);
    assert.ok(drawn[key] >= ABILITY_FLOOR && drawn[key] <= ABILITY_CEIL, `${key}=${drawn[key]} uden for [1,99]`);
  }
  assert.ok(DEFAULT_PRIOR_BY_CATEGORY.mental.meanScale > 0 && DEFAULT_PRIOR_BY_CATEGORY.mental.meanScale <= 1);
});

test("D-030: leadership MAA bruge alder — taktik/aggression maa ikke", () => {
  const keys = [...REGISTRY_ABILITY_KEYS, "leadership"];
  const meanOf = (age, key) => {
    let sum = 0;
    for (let s = 0; s < 400; s++) {
      sum += drawBirthAbilities({ rng: makeBirthRng(s + 1), tier: "solid", archetype: "gc", age, abilityKeys: keys })[key];
    }
    return sum / 400;
  };
  assert.ok(meanOf(31, "leadership") - meanOf(19, "leadership") > 5, "alders-kurven paa leadership virker ikke");
  for (const key of ["tactics", "aggression"]) {
    assert.ok(Math.abs(meanOf(31, key) - meanOf(19, key)) < 0.5, `${key} flytter sig med alderen`);
  }
});

// ── 3. Selve traekket ────────────────────────────────────────────────────────

test("samme seed -> identisk traek (determinisme)", () => {
  const a = drawBirthAbilities({ rng: makeBirthRng(77), tier: "star", archetype: "sprinter", secondaryArchetype: "tt", age: 26 });
  const b = drawBirthAbilities({ rng: makeBirthRng(77), tier: "star", archetype: "sprinter", secondaryArchetype: "tt", age: 26 });
  assert.deepEqual(a, b);
});

test("hoejere tier -> hoejere evner", () => {
  const meanFor = (tier) => {
    let sum = 0;
    for (let s = 0; s < 300; s++) {
      const a = drawBirthAbilities({ rng: makeBirthRng(s + 1), tier, archetype: "rouleur", age: 27 });
      sum += REGISTRY_ABILITY_KEYS.reduce((t, k) => t + a[k], 0) / REGISTRY_ABILITY_KEYS.length;
    }
    return sum / 300;
  };
  const d = meanFor("domestique"), so = meanFor("solid"), st = meanFor("star"), su = meanFor("superstar");
  assert.ok(d < so && so < st && st < su, `tier-pyramiden er ikke monoton: ${d} ${so} ${st} ${su}`);
});

test("gc's gulv og rouleurs speciale-loft holder (type-GUARDS kan opfyldes)", () => {
  const gcFloor = BIRTH_ARCHETYPE_PROFILES.gc.minAbilities;
  for (let s = 0; s < 200; s++) {
    const gc = drawBirthAbilities({ rng: makeBirthRng(s + 1), tier: "domestique", archetype: "gc", age: 27 });
    for (const [key, floor] of Object.entries(gcFloor)) {
      assert.ok(gc[key] >= Math.floor(floor), `gc.${key}=${gc[key]} under gulvet ${floor}`);
    }
    const rouleur = drawBirthAbilities({ rng: makeBirthRng(s + 1), tier: "superstar", archetype: "rouleur", age: 27 });
    const cap = Math.ceil(BIRTH_ARCHETYPE_PROFILES.rouleur.capSpeciality);
    for (const key of ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"]) {
      assert.ok(rouleur[key] <= cap, `rouleur.${key}=${rouleur[key]} over speciale-loftet ${cap}`);
    }
  }
});

test("bi-typens vaegt er 0 i produktionen (samme begrundelse som voksen-stien)", () => {
  const alene = blendBirthProfiles("climber", null);
  const medBi = blendBirthProfiles("climber", "sprinter");
  assert.deepEqual(medBi.boost, alene.boost);
  assert.deepEqual(medBi.damp, alene.damp);
  // Knappen virker naar den bruges — ellers maaler den ingenting.
  const skewed = blendBirthProfiles("climber", "sprinter", 0.5);
  assert.ok(skewed.boost.sprint > 0, "bi-typens signatur slaar ikke igennem ved vaegt 0,5");
});

test("ungdoms-traekket holder sig i baandet og foelger alder + potentiale", () => {
  const meanFor = (age, potentiale) => {
    let sum = 0;
    for (let s = 0; s < 200; s++) {
      const a = drawYouthBirthAbilities({
        rng: makeBirthRng(s + 1), age, potentiale, archetype: "climber",
        secondaryArchetype: "gc", classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE,
      });
      for (const k of REGISTRY_ABILITY_KEYS) {
        assert.ok(a[k] >= 1 && a[k] <= Math.ceil(YOUTH_BIRTH_BAND.ceil), `${k}=${a[k]} uden for ungdomsbaandet`);
      }
      sum += a.climbing;
    }
    return sum / 200;
  };
  assert.ok(meanFor(21, 3) > meanFor(16, 3), "alders-rampen virker ikke");
  assert.ok(meanFor(18, 6) > meanFor(18, 1), "potentiale-loeftet virker ikke");
});

// ── 4. Persistering + reproduktion ───────────────────────────────────────────

test("foedsels-markoeren valideres og saetter kun cap naar den er reel", () => {
  const m = makeBirthMarker({ tier: "solid", seed: 42 });
  assert.deepEqual(m, { v: 1, tier: "solid", seed: 42 });
  assert.equal("cap" in m, false, "cap maa ikke saettes af en manglende vaerdi (Number(null) === 0-faelden)");
  assert.equal(makeBirthMarker({ tier: "solid", seed: 42, cap: 21 }).cap, 21);
  assert.equal(makeYouthBirthMarker({ seed: 7 }).tier, "youth");
  assert.throws(() => makeBirthMarker({ tier: "elite", seed: 1 }), /unknown tier/);
  assert.throws(() => makeBirthMarker({ tier: "solid", seed: 1.5 }), /integer/);
});

test("evne-loftet kan kun saenkes, aldrig haeves", () => {
  const draw = { primary: "gc", secondary: "tt", birth: makeBirthMarker({ tier: "solid", seed: 3 }) };
  assert.equal(withBirthAbilityCap(draw, 21).birth.cap, 21);
  assert.equal(withBirthAbilityCap(withBirthAbilityCap(draw, 21), 7).birth.cap, 7);
  assert.equal(withBirthAbilityCap(withBirthAbilityCap(draw, 7), 21).birth.cap, 7);
  // Rene funktioner: originalen er urørt.
  assert.equal(draw.birth.cap, undefined);
});

test("isBornFromPriors ser kun foedsels-markoeren", () => {
  assert.equal(isBornFromPriors({ archetype_draw: { primary: "gc", secondary: "tt" } }), false);
  assert.equal(isBornFromPriors({ archetype_draw: null }), false);
  assert.equal(isBornFromPriors({}), false);
  assert.equal(isBornFromPriors({ archetype_draw: { primary: "gc", secondary: "tt", birth: { v: 1, tier: "solid", seed: 1 } } }), true);
});

test("deriveBirthAbilities reproducerer traekket fra den persisterede raekke alene", () => {
  const seed = 8675309;
  const draw = { primary: "puncheur", secondary: "climber", birth: makeBirthMarker({ tier: "star", seed }) };
  const row = { id: "rider-1", archetype_draw: draw, potentiale: 4, birthdate: "1999-05-05" };
  const first = deriveBirthAbilities(row, { age: 27 });
  const again = deriveBirthAbilities({ ...row }, { age: 27 });
  assert.deepEqual(first, again);
  const direct = drawBirthAbilities({ rng: makeBirthRng(seed), tier: "star", archetype: "puncheur", secondaryArchetype: "climber", age: 27 });
  for (const key of REGISTRY_ABILITY_KEYS) assert.equal(first[key], direct[key], key);
  assert.ok(Number.isInteger(first.hidden_potential));
});

test("det persisterede evne-loft klemmer ved re-derivation", () => {
  const draw = { primary: "sprinter", secondary: "tt", birth: makeBirthMarker({ tier: "superstar", seed: 11, cap: 7 }) };
  const abilities = deriveBirthAbilities({ id: "r", archetype_draw: draw, potentiale: 2 }, { age: 27 });
  for (const [k, v] of Object.entries(abilities)) assert.ok(v <= 7, `${k}=${v} over loftet 7`);
});

test("#4311: fyld-taggen klemmer ogsaa prior-foedte ryttere", () => {
  const draw = { primary: "gc", secondary: "tt", birth: makeBirthMarker({ tier: "superstar", seed: 21 }) };
  const row = { id: "r", archetype_draw: draw, potentiale: 6, generation_tag: FILL_TAIL_GENERATION_TAG };
  const abilities = deriveBirthAbilities(row, { age: 27 });
  for (const [k, v] of Object.entries(abilities)) {
    assert.ok(v <= FILL_TAIL_ABILITY_CAP, `${k}=${v} over fyld-loftet ${FILL_TAIL_ABILITY_CAP}`);
  }
  // Negativ-test: uden taggen er rytteren tydeligt staerkere.
  const uden = deriveBirthAbilities({ ...row, generation_tag: null }, { age: 27 });
  assert.ok(Math.max(...Object.values(uden)) > FILL_TAIL_ABILITY_CAP, "taggen maaler ingenting");
});

test("en rytter UDEN markoer giver null (den uaendrede kodesti)", () => {
  assert.equal(deriveBirthAbilities({ id: "r", archetype_draw: { primary: "gc", secondary: "tt" } }), null);
});

// ── 5. Broer til resten af systemet ──────────────────────────────────────────

test("hidden_potential er formel-identisk med abilityDerivation's", () => {
  for (const [potentiale, birthdate, age] of [[1, "1999-01-01", 27], [3.5, "2005-01-01", 21], [6, "1990-01-01", 36]]) {
    const row = { id: "abc-123", potentiale, birthdate };
    const viaDerivation = deriveAbilities({}, row, { asOfYear: 2026 }).hidden_potential;
    assert.equal(birthHiddenPotential({ potentiale, age, id: row.id }), viaDerivation, `${potentiale}/${age}`);
  }
});

test("fysiologi-broen oversaetter evner til de 0-99-felter seedingen forventer", () => {
  const abilities = drawBirthAbilities({ rng: makeBirthRng(5), tier: "solid", archetype: "climber", age: 27 });
  const seedRow = physiologySeedInputFromAbilities({ id: "r", height: 175, weight: 60 }, abilities);
  assert.equal(seedRow.height, 175);
  assert.equal(seedRow.weight, 60);
  assert.equal(seedRow.stat_bj, abilities.climbing);
  assert.equal(seedRow.stat_sp, abilities.sprint);
  assert.equal(seedRow.stat_ftr, abilities.aggression);
  // stat_prl har ingen evne og maa derfor ikke dukke op.
  assert.equal("stat_prl" in seedRow, false);
  for (const key of Object.keys(seedRow)) {
    if (key === "id" || key === "height" || key === "weight") continue;
    assert.ok(STAT_KEYS.includes(key), `${key} er ikke et kendt legacy-felt`);
  }
});

test("ARCHETYPE_BY_TYPE og prior-tabellen daekker samme otte arketyper", () => {
  assert.deepEqual(Object.keys(ARCHETYPE_BY_TYPE).sort(), BIRTH_ARCHETYPE_KEYS.slice().sort());
});
