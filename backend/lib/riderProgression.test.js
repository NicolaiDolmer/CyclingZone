import test from "node:test";
import assert from "node:assert/strict";

import {
  PROGRESSION_CONFIG, seededUnit, signatureFactor, headroomForPotential,
  peakAgeForType, abilityCap, stepAbility, retirementDecision,
  developRiderSeason, buildCaps,
  youthRoleFactor, YOUTH_PROGRESSION_CONFIG,
  youthAbilityCap, buildYouthCaps,
  buildCapsForRider, buildProgressInit,
  taperedAbsoluteCap, CAP_TAPER_CONFIG,
  CRAFT_ABILITIES, abilityRoleClass, roleRateFactor, ROLE_CLASSES, ROLE_CLASS_RATE,
  announcedRetirementAfterSeason, GC_PUNCH_FLOOR,
} from "./riderProgression.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { ageForSeason } from "./riderSeasonAge.js";

// ── Determinisme ──────────────────────────────────────────────────────────────

test("seededUnit er deterministisk og ∈ [0,1)", () => {
  const a = seededUnit("rider-1:3:climbing");
  assert.equal(a, seededUnit("rider-1:3:climbing"));
  assert.notEqual(a, seededUnit("rider-1:4:climbing"));
  assert.ok(a >= 0 && a < 1);
});

test("developRiderSeason er en ren funktion (samme input → samme output)", () => {
  const rider = { id: "r1", primary_type: "climber", potentiale: 5, age: 21 };
  const ab = { climbing: 60, sprint: 40, flat: 50 };
  const caps = buildCaps(ab, "climber", 5);
  assert.deepEqual(
    developRiderSeason(rider, ab, caps, 2),
    developRiderSeason(rider, ab, caps, 2)
  );
});

// ── Loft / headroom ───────────────────────────────────────────────────────────

test("headroom interpolerer lineært mellem potentiale-ankre", () => {
  assert.equal(headroomForPotential(5), PROGRESSION_CONFIG.headroomByPotential[5]);
  // 4.5 = midt mellem 22 (pot 4) og 30 (pot 5) = 26
  assert.equal(headroomForPotential(4.5), 26);
});

test("headroom clamps udenfor 1..6", () => {
  assert.equal(headroomForPotential(0), PROGRESSION_CONFIG.headroomByPotential[1]);
  assert.equal(headroomForPotential(9), PROGRESSION_CONFIG.headroomByPotential[6]);
});

test("signatur-evne får fuldt loft, modsat-evne intet, off-type delvist", () => {
  // climber: climbing positiv (signatur), sprint negativ (modsat), recovery 0 (off-type)
  assert.equal(signatureFactor("climber", "climbing"), 1.0);
  assert.equal(signatureFactor("climber", "sprint"), 0);
  assert.equal(signatureFactor("climber", "recovery"), PROGRESSION_CONFIG.offTypeHeadroomFactor);
});

test("abilityCap: signatur løftes med fuld headroom, clamp 99", () => {
  // pot 5 → headroom 30; climbing baseline 60 → cap 90
  assert.equal(abilityCap(60, "climber", "climbing", 5), 90);
  // clamp: baseline 80 + 30 = 110 → 99
  assert.equal(abilityCap(80, "climber", "climbing", 5), 99);
  // modsat-evne (sprint for climber): factor 0 → cap = baseline
  assert.equal(abilityCap(40, "climber", "sprint", 5), 40);
});

// ── Peak ──────────────────────────────────────────────────────────────────────

test("peak-alder er fælles for alle typer (ejer 2026-06-07)", () => {
  assert.equal(peakAgeForType("sprinter"), PROGRESSION_CONFIG.peakAge);
  assert.equal(peakAgeForType("gc"), PROGRESSION_CONFIG.peakAge);
  assert.equal(peakAgeForType("ukendt-type"), PROGRESSION_CONFIG.peakAge);
});

// ── Vækst < peak ──────────────────────────────────────────────────────────────

test("ung rytter vokser mod loft, men aldrig over", () => {
  const cap = 90;
  let cur = 60;
  for (let s = 1; s <= 12; s++) {
    const next = stepAbility(cur, cap, 22, 28, true, 0.5);
    assert.ok(next >= cur, "skal ikke falde i vækstfase");
    assert.ok(next <= cap, "må ikke overstige loftet");
    cur = next;
  }
  assert.ok(cur > 80, "skal konvergere tæt mod loftet over tid");
});

test("vækst aftager når man nærmer sig loftet (asymptotisk)", () => {
  const first = stepAbility(60, 90, 22, 28, true, 0.5) - 60;
  const late = stepAbility(85, 90, 22, 28, true, 0.5) - 85;
  assert.ok(first > late, "tidligt spring større end sent spring");
});

test("yngre vokser hurtigere end ældre (samme gab)", () => {
  const young = stepAbility(60, 90, 19, 28, true, 0.5) - 60;
  const older = stepAbility(60, 90, 25, 28, true, 0.5) - 60;
  assert.ok(young > older, "19-årig lukker gabet hurtigere end 25-årig");
});

test("ingen vækst hvis current allerede på/over loft", () => {
  assert.equal(stepAbility(90, 90, 22, 28, true, 0.5), 90);
  assert.equal(stepAbility(95, 90, 22, 28, true, 0.5), 95);
});

// ── Fald ≥ peak ───────────────────────────────────────────────────────────────

test("rytter over peak falder, hårdere jo længere forbi", () => {
  const justPast = 80 - stepAbility(80, 99, 30, 28, true, 0.5); // 2 år forbi
  const farPast = 80 - stepAbility(80, 99, 36, 28, true, 0.5);  // 8 år forbi
  assert.ok(justPast > 0, "skal falde efter peak");
  assert.ok(farPast > justPast, "fald accelererer med årene forbi peak");
});

test("signatur-evner falder hurtigere end off-type", () => {
  const sig = 80 - stepAbility(80, 99, 34, 28, true, 0.5);
  const off = 80 - stepAbility(80, 99, 34, 28, false, 0.5);
  assert.ok(sig > off, "off-type holder bedre (factor < 1)");
});

// ── Retirement ────────────────────────────────────────────────────────────────

test("ingen retirement før windowStartAge", () => {
  const d = retirementDecision(35, "r1", 3);
  assert.equal(d.retire, false);
});

test("garanteret retirement ved guaranteedAge", () => {
  const d = retirementDecision(40, "r1", 3);
  assert.equal(d.retire, true);
});

test("retirement er seeded-deterministisk i vinduet", () => {
  assert.deepEqual(retirementDecision(38, "rX", 5), retirementDecision(38, "rX", 5));
});

test("retirement-sandsynlighed stiger med alder (mange ryttere)", () => {
  const rate = (age) => {
    let n = 0;
    for (let i = 0; i < 500; i++) if (retirementDecision(age, `rider-${i}`, 1).retire) n++;
    return n / 500;
  };
  assert.ok(rate(37) > rate(36), "ældre = højere retirement-rate");
});

// ── #2748 pension-minimum: selektor vs. motor ─────────────────────────────────
// Beviser at announcedRetirementAfterSeason(rider, A) rammer PRÆCIS samme svar
// som den motor der rent faktisk afgør pensionen: developRiderSeason() kaldt
// ved cutover TIL sæson A+1 (samme rider-alder-beregning + samme seed-nøgle
// som riderProgressionEngine.js's processSeasonStart bruger).

// Simulerer engine-kaldet: age = ageForSeason(birthdate, seasonNumber) (samme
// linje som riderProgressionEngine.js:166), rider-objektet bygges med den
// alder, og retirement læses fra developRiderSeason() (riderProgressionEngine.
// js:197-199) — IKKE en genimplementering af selve beslutningen.
function engineRetirementAtCutover(riderId, birthdate, seasonNumber) {
  const age = ageForSeason(birthdate, seasonNumber);
  const rider = { id: riderId, primary_type: "climber", potentiale: 3, age };
  const ab = { climbing: 50 };
  const caps = { climbing: 99 };
  return developRiderSeason(rider, ab, caps, seasonNumber).retirement.retire;
}

test("#2748: announcedRetirementAfterSeason matcher motorens faktiske cutover-beslutning (garanteret alder)", () => {
  // Født så alderen rammer guaranteedAge (40) i aktiv sæson 3 → LAUNCH_REFERENCE_YEAR
  // (2026) + (3-1) - birthYear = 40 ⇒ birthYear = 1988.
  const rider = { id: "engine-vs-selector", birthdate: "1988-06-15" };
  const activeSeason = 3;
  const predicted = announcedRetirementAfterSeason(rider, activeSeason);
  const actual = engineRetirementAtCutover(rider.id, rider.birthdate, activeSeason + 1);
  assert.equal(predicted, true, "garanteret pension ved alder 40 i den aktive sæson");
  assert.equal(predicted, actual, "selektoren skal ramme PRÆCIS motorens cutover-svar");
});

test("#2748: announcedRetirementAfterSeason matcher motoren i det seedede vindue (36-39), for mange ryttere", () => {
  const activeSeason = 4;
  // Alder 37 i aktiv sæson 4 ⇒ birthYear = 2026 + 3 - 37 = 1992.
  let mismatches = 0;
  for (let i = 0; i < 200; i++) {
    const rider = { id: `bulk-rider-${i}`, birthdate: "1992-03-01" };
    const predicted = announcedRetirementAfterSeason(rider, activeSeason);
    const actual = engineRetirementAtCutover(rider.id, rider.birthdate, activeSeason + 1);
    if (predicted !== actual) mismatches++;
  }
  assert.equal(mismatches, 0, "0 uenigheder mellem selektor og motor på tværs af 200 seedede ryttere");
});

test("#2748: announcedRetirementAfterSeason er false godt under vinduet", () => {
  // Alder 20 i aktiv sæson 3 (2026+2-2008=20) — langt under windowStartAge=36.
  const rider = { id: "young-rider", birthdate: "2008-01-01" };
  assert.equal(announcedRetirementAfterSeason(rider, 3), false);
});

test("#2748: announcedRetirementAfterSeason returnerer false uden birthdate/id (aldrig et gæt)", () => {
  assert.equal(announcedRetirementAfterSeason({ id: "r1" }, 3), false);
  assert.equal(announcedRetirementAfterSeason({ birthdate: "1990-01-01" }, 3), false);
});

// ── Integration: developRiderSeason ───────────────────────────────────────────

test("developRiderSeason bevarer specialisering (sprinter vokser mest i sprint)", () => {
  const rider = { id: "r1", primary_type: "sprinter", potentiale: 6, age: 20 };
  const ab = { sprint: 60, climbing: 60, acceleration: 60 };
  const caps = buildCaps(ab, "sprinter", 6);
  const { next } = developRiderSeason(rider, ab, caps, 1);
  const sprintGain = next.sprint - 60;
  const climbGain = next.climbing - 60; // climbing er modsat for sprinter → 0 headroom
  assert.ok(sprintGain > climbGain, "sprint (signatur) vokser mere end climbing (modsat)");
});

test("developRiderSeason: 21-årig høj-pot stiger målbart (acceptkriterie #1137)", () => {
  const rider = { id: "r1", primary_type: "climber", potentiale: 5, age: 21 };
  const ab = { climbing: 55, tempo: 55, endurance: 55 };
  const caps = buildCaps(ab, "climber", 5);
  const { next } = developRiderSeason(rider, ab, caps, 1);
  assert.ok(next.climbing > 57, "signatur-evne stiger mærkbart første sæson");
});

test("developRiderSeason: 34-årig falder målbart (acceptkriterie #1137)", () => {
  const rider = { id: "r1", primary_type: "sprinter", potentiale: 5, age: 34 };
  const ab = { sprint: 80, acceleration: 75, flat: 70 };
  const caps = buildCaps(ab, "sprinter", 5);
  const { next } = developRiderSeason(rider, ab, caps, 1);
  assert.ok(next.sprint < 80, "evne falder efter peak");
});

// ── Træningsbias (#1163) ────────────────────────────────────────────────────────

test("stepAbility: growthMult > 1 lukker mere af gabet (men aldrig over loft)", () => {
  const base = stepAbility(60, 90, 21, 28, true, 0.5);
  const boosted = stepAbility(60, 90, 21, 28, true, 0.5, PROGRESSION_CONFIG, 1.6);
  assert.ok(boosted > base, "bias accelererer vækst");
  assert.ok(boosted <= 90, "bias bryder aldrig loftet");
});

test("stepAbility: growthMult påvirker ikke decline-fasen", () => {
  const plain = stepAbility(80, 99, 34, 28, true, 0.5);
  const trained = stepAbility(80, 99, 34, 28, true, 0.5, PROGRESSION_CONFIG, 1.6);
  assert.equal(plain, trained, "træning fremskynder ikke fald efter peak");
});

test("developRiderSeason: træningsfokus vokser fokus-evne mere end uden træning", () => {
  const rider = { id: "r1", primary_type: "climber", potentiale: 5, age: 21 };
  const ab = { climbing: 55, sprint: 50, endurance: 55 };
  const caps = buildCaps(ab, "climber", 5);
  const training = {
    focusAbilities: new Set(["climbing"]),
    focusMult: 1.6, offFocusMult: 0.9,
  };
  const plain = developRiderSeason(rider, ab, caps, 1).next;
  const trained = developRiderSeason(rider, ab, caps, 1, undefined, training).next;
  assert.ok(trained.climbing > plain.climbing, "fokus-evne vokser mere med træning");
  assert.ok(trained.climbing <= caps.climbing, "stadig under loftet");
});

test("developRiderSeason: ingen training-arg → identisk med før (bagudkompatibel)", () => {
  const rider = { id: "r1", primary_type: "gc", potentiale: 4, age: 23 };
  const ab = { climbing: 60, time_trial: 58, endurance: 62 };
  const caps = buildCaps(ab, "gc", 4);
  assert.deepEqual(
    developRiderSeason(rider, ab, caps, 2),
    developRiderSeason(rider, ab, caps, 2, undefined, null)
  );
});

// ── skipGrowth: anti-double-dip (#1305) ────────────────────────────────────────

test("skipGrowth: vækst-fase rytter (age < peakAge) ændrer intet i abilities", () => {
  const rider = { id: "r1", primary_type: "climber", potentiale: 5, age: 21 };
  const ab = { climbing: 60, sprint: 40, endurance: 55 };
  const caps = buildCaps(ab, "climber", 5);
  const { next } = developRiderSeason(rider, ab, caps, 1, undefined, null, { skipGrowth: true });
  // Alle abilities skal være uændrede (Math.round(current) — ingen vækst)
  for (const [k, v] of Object.entries(ab)) {
    if (next[k] != null) assert.equal(next[k], Math.round(v), `${k} skal være uændret`);
  }
});

test("skipGrowth: changed-liste er tom for vækst-fase rytter", () => {
  const rider = { id: "r1", primary_type: "sprinter", potentiale: 4, age: 24 };
  const ab = { sprint: 70, acceleration: 65, flat: 60 };
  const caps = buildCaps(ab, "sprinter", 4);
  const { changed } = developRiderSeason(rider, ab, caps, 2, undefined, null, { skipGrowth: true });
  assert.equal(changed.length, 0, "ingen ændringer for vækst-fase med skipGrowth");
});

test("skipGrowth: rytter PRÆCIS ved peakAge (age === peakAge) springes over", () => {
  // age === peakAge er stadig vækst-fase (age <= peakAge i stepAbility)
  const rider = { id: "r1", primary_type: "climber", potentiale: 5, age: PROGRESSION_CONFIG.peakAge };
  const ab = { climbing: 70, endurance: 65 };
  const caps = buildCaps(ab, "climber", 5);
  const { next } = developRiderSeason(rider, ab, caps, 3, undefined, null, { skipGrowth: true });
  for (const [k, v] of Object.entries(ab)) {
    if (next[k] != null) assert.equal(next[k], Math.round(v), `${k} ved peakAge skal være uændret`);
  }
});

test("skipGrowth: fald-fase rytter (age > peakAge) falder præcis som UDEN skipGrowth", () => {
  const rider = { id: "r1", primary_type: "sprinter", potentiale: 5, age: 34 };
  const ab = { sprint: 80, acceleration: 75, flat: 70 };
  const caps = buildCaps(ab, "sprinter", 5);
  const plain = developRiderSeason(rider, ab, caps, 4, undefined, null);
  const skipped = developRiderSeason(rider, ab, caps, 4, undefined, null, { skipGrowth: true });
  assert.deepEqual(plain.next, skipped.next, "fald er identisk med og uden skipGrowth");
  // Kontrollér at der rent faktisk sker fald (testen giver mening)
  const sumBefore = Object.values(ab).reduce((s, v) => s + v, 0);
  const sumAfter = Object.values(plain.next).reduce((s, v) => s + v, 0);
  assert.ok(sumAfter < sumBefore, "evner falder faktisk for 34-årig (kontrolcheck)");
});

test("skipGrowth: retirement-beslutning er uændret for vækst-fase rytter", () => {
  const rider = { id: "r1", primary_type: "climber", potentiale: 3, age: 21 };
  const ab = { climbing: 55, endurance: 55 };
  const caps = buildCaps(ab, "climber", 3);
  const plain = developRiderSeason(rider, ab, caps, 1);
  const skipped = developRiderSeason(rider, ab, caps, 1, undefined, null, { skipGrowth: true });
  assert.deepEqual(plain.retirement, skipped.retirement, "retirement er identisk uanset skipGrowth");
});

test("skipGrowth: retirement-beslutning er uændret for fald-fase rytter", () => {
  // 38-årig — i retirement-vindue; seeded — bør give samme svar uanset skipGrowth
  const rider = { id: "rX", primary_type: "gc", potentiale: 4, age: 38 };
  const ab = { climbing: 65, time_trial: 70 };
  const caps = buildCaps(ab, "gc", 4);
  const plain = developRiderSeason(rider, ab, caps, 10);
  const skipped = developRiderSeason(rider, ab, caps, 10, undefined, null, { skipGrowth: true });
  assert.deepEqual(plain.retirement, skipped.retirement, "retirement ens for fald-fase rytter");
});

test("skipGrowth false/udeladt → identisk med default-adfærd (golden test)", () => {
  const rider = { id: "r1", primary_type: "gc", potentiale: 5, age: 23 };
  const ab = { climbing: 62, time_trial: 60, endurance: 64 };
  const caps = buildCaps(ab, "gc", 5);
  const reference = developRiderSeason(rider, ab, caps, 3);
  assert.deepEqual(developRiderSeason(rider, ab, caps, 3, undefined, null, {}), reference, "tom options = uændret");
  assert.deepEqual(developRiderSeason(rider, ab, caps, 3, undefined, null, { skipGrowth: false }), reference, "skipGrowth:false = uændret");
});

// ── Ungdoms-rolle-faktor (#1791) ──────────────────────────────────────────────

test("youthRoleFactor: primær-naturlig > sekundær-naturlig > neutral > modsat", () => {
  // climber primary, tt secondary. climbing er primær-naturlig (climber.weights.climbing=3>0).
  // Trin 7: taget er absolut pr. rolleklasse (roleTags); youthRoleFactor er
  // SUPERSEDERET og returnerer nu klassens tag som andel af signatur-taget, så
  // ordningen mellem klasserne stadig kan aflæses af gamle scripts.
  const tags = YOUTH_PROGRESSION_CONFIG.roleTags;
  const primary = youthRoleFactor("climber", "tt", "climbing");
  const secondary = youthRoleFactor("climber", "tt", "time_trial"); // tt.weights.time_trial=3>0, men kun secondary
  const neutral = youthRoleFactor("climber", "tt", "descending");   // ingen type-vægt, ikke håndværk
  const opposite = youthRoleFactor("climber", "tt", "sprint");      // climber.weights.sprint=-2<0
  assert.equal(primary, tags.signatur / tags.signatur);
  assert.equal(secondary, tags.sekundaer / tags.signatur);
  assert.equal(neutral, tags.andenRolle / tags.signatur);
  assert.equal(opposite, tags.svaghed / tags.signatur);
  assert.ok(primary > secondary && secondary > neutral && neutral > opposite);
});

// ── Håndværks-gulvet (#3709 trin 3, spec §2.1 + beslutning 3) ────────────────

test("håndværk: positioning + tactics er de ENESTE to evner med gulv (beslutning 3)", () => {
  assert.deepEqual([...CRAFT_ABILITIES], ["positioning", "tactics"]);
  // `aggression` hører BEVIDST ikke til: den ER ejet (baroudeur, vægt 3). Dens
  // problem er at intet fokus træner den — det løser trin 2, ikke et tag.
  assert.ok(!CRAFT_ABILITIES.includes("aggression"));
});

test("håndværk: en type der hverken ejer eller modarbejder evnen får gulvet, ikke neutral", () => {
  // gc ejer hverken positioning eller tactics — uden håndværks-klassen stod
  // begge som andenRolle. Trin 7: håndværks-taget er absolut (roleTags).
  const tags = YOUTH_PROGRESSION_CONFIG.roleTags;
  for (const ability of CRAFT_ABILITIES) {
    assert.equal(abilityRoleClass("gc", "climber", ability), "haandvaerk");
    assert.equal(youthAbilityCap(3, "gc", "climber", ability), tags.haandvaerk);
  }
  assert.ok(tags.haandvaerk > tags.andenRolle);
});

test("håndværk: gulvet LØFTER, det erstatter aldrig — signatur slår gulvet (#3682's gulv-løft-krav)", () => {
  // Sprinteren ejer nu positioning (#3682) → signatur-klassen vinder over gulvet.
  const tags = YOUTH_PROGRESSION_CONFIG.roleTags;
  assert.equal(abilityRoleClass("sprinter", "climber", "positioning"), "signatur");
  assert.equal(youthAbilityCap(3, "sprinter", "climber", "positioning"), tags.signatur);
  // Gulvet sammenligner på TAGET, ikke på klasse-navnet. Under trin 7's
  // absolutte tag ligger håndværk (70) UNDER sekundær (80), så en rytter med
  // sprinter som sekundær BEHOLDER `sekundaer` — "opgraderingen" ville være en
  // sænkning. (Under trin 3's faktorer var forholdet omvendt, 0,95 > 0,82, og
  // samme kode gav `haandvaerk`.) Klasse-navnet er IKKE en konstant der kan
  // pinnes: det følger kalibreringen. Invarianten der SKAL holde uanset tal er
  // den næste test: gulvet må aldrig sænke et tag.
  assert.equal(abilityRoleClass("climber", "sprinter", "positioning"), "sekundaer");
  assert.ok(
    youthAbilityCap(3, "climber", "sprinter", "positioning") >= tags.haandvaerk,
    "gulvet må aldrig give et LAVERE tag end håndværks-taget",
  );
});

test("håndværk: gulvet kan ALDRIG sænke et tag, uanset hvordan tagene kalibreres", () => {
  // Invarianten der skal overleve enhver fremtidig kalibrering. Kør hele
  // parameterrummet med en RÆKKE forskellige håndværks-tag — også nogle der er
  // lavere/højere end alle andre klasser — og kræv at gulvet aldrig trækker ned.
  const base = YOUTH_PROGRESSION_CONFIG.roleTags;
  for (const haandvaerk of [5, 45, 70, 95, 120]) {
    const medGulv = { ...YOUTH_PROGRESSION_CONFIG, roleTags: { ...base, haandvaerk } };
    const udenGulv = { ...YOUTH_PROGRESSION_CONFIG, roleTags: { ...base, haandvaerk: undefined } };
    for (const primary of RIDER_TYPE_KEYS) {
      for (const secondary of RIDER_TYPE_KEYS) {
        for (const ability of CRAFT_ABILITIES) {
          assert.ok(
            youthAbilityCap(3, primary, secondary, ability, medGulv)
              >= youthAbilityCap(3, primary, secondary, ability, udenGulv),
            `haandvaerk=${haandvaerk} ${primary}/${secondary} ${ability}: gulvet sænkede taget`,
          );
        }
      }
    }
  }
});

// ── Rolleklasser: to knapper (#3709 trin 4, spec §2.2) ──────────────────────

test("rolleklasser: tag og rate kommer fra SAMME klassifikation", () => {
  // Hele pointen med at skille tag og rate ad er at de ikke må drive fra hinanden.
  // Begge slås op via abilityRoleClass — denne test er vagten mod at nogen
  // senere giver den ene sin egen kopi af klassifikationen.
  for (const primary of RIDER_TYPE_KEYS) {
    for (const secondary of RIDER_TYPE_KEYS) {
      for (const ability of VISIBLE_ABILITIES) {
        const klasse = abilityRoleClass(primary, secondary, ability);
        assert.ok(ROLE_CLASSES.includes(klasse), `ukendt klasse ${klasse}`);
        assert.equal(roleRateFactor(primary, secondary, ability), ROLE_CLASS_RATE[klasse]);
      }
    }
  }
});

test("rolleklasser: raterne er ejer-besluttede 14/8 og falder monotont med klassen", () => {
  assert.deepEqual(ROLE_CLASS_RATE, {
    signatur: 0.45, sekundaer: 0.36, haandvaerk: 0.22, andenRolle: 0.15, svaghed: 0.05,
  });
  // Signatur-raten 0,45 er ANKERET (beslutning 14): valgt for at holde ratingen på
  // dagens niveau, ikke spidsen. Ændres den, ændres hele scorecardet.
  assert.equal(ROLE_CLASS_RATE.signatur, 0.45);
  const rater = ROLE_CLASSES.map((k) => ROLE_CLASS_RATE[k]);
  for (let i = 1; i < rater.length; i++) {
    assert.ok(rater[i] < rater[i - 1], `${ROLE_CLASSES[i]} skal have lavere rate end ${ROLE_CLASSES[i - 1]}`);
  }
});

// OMSKREVET 15/8 ved tilbagerulningen af trin 4's tag.
//
// Testen hed "tagene er ALLE højere end før trin 4" og vogtede at hvert tag var
// hævet. Den påstand er trukket tilbage af ejeren: de hævede tag satte 748
// ryttere over 95 og brød løftet fra Discord 11/8 om at "voldsomt få lander
// deroppe". Tagene står nu på trin 3's værdier igen.
//
// Det der SKAL vogtes er ikke længere en retning, men en grænse: taget må aldrig
// i sig selv kunne sætte en rytter over 95, uanset potentiale og rolle. Det er
// ejerens krav fra 15/8, og `scripts/spillervendteGates3709.mjs` måler det på
// hele populationen. Her pinnes invarianten på selve formlen.
test("rolleklasser: taget kan ALDRIG i sig selv sætte en evne over 95", () => {
  // Trin 7 gjorde denne grænse STRUKTUREL: taget er en flad tabel, så det
  // højeste mulige tag i hele spillet er ét opslag — ikke et produkt af
  // kalibreringer der skal ramme hinanden rigtigt.
  const maksTag = Math.max(...Object.values(YOUTH_PROGRESSION_CONFIG.roleTags));
  assert.ok(
    maksTag < 95,
    `maks tag ${maksTag} skal være under 95 `
    + "(ejer-krav 15/8: taget må aldrig alene sætte nogen over 95 — kun træning må)",
  );
  // Og 90 skal kunne NÅS (S4): gap-proportional vækst ankommer aldrig helt til
  // taget, så signatur-taget skal ligge over 90 + en margin. Vinduet er 92-94.
  assert.ok(YOUTH_PROGRESSION_CONFIG.roleTags.signatur >= 92, "signatur-tag under 92 gør 90 uopnåeligt (asymptoten)");
});

// ── #4634/#4098 (ejer-beslutning 4/9, variant A3+C2) ────────────────────────
// Se docs/audits/4634-cap-varianter-2026-09-04.md for det fulde beslutnings-
// grundlag. Disse tests låser de to konstant-ændringer, ikke bare afledte
// forhold — regression skal fejle hvis nogen ved et uheld ruller tilbage.

test("#4634 A3: svaghed-taget er hævet til 45 (var 25) — ROLE_CLASS_RATE.svaghed er UÆNDRET", () => {
  assert.equal(YOUTH_PROGRESSION_CONFIG.roleTags.svaghed, 45);
  // Raten er en separat beslutning (egen session) — denne PR rører den ikke.
  assert.equal(ROLE_CLASS_RATE.svaghed, 0.05);
  // Rækkefølgen signatur > sekundær > håndværk > andenRolle > svaghed (14/8)
  // skal stadig holde efter hævningen.
  const t = YOUTH_PROGRESSION_CONFIG.roleTags;
  assert.ok(t.signatur > t.sekundaer && t.sekundaer > t.haandvaerk && t.haandvaerk > t.andenRolle && t.andenRolle > t.svaghed);
});

test("#4634 A3: en dobbelt-svaghedsevne får det nye 45-tag, ikke 25", () => {
  // climber/tt, sprint: climber.weights.sprint=-2<0 OG tt.weights.sprint=-1<0 → svaghed.
  assert.equal(abilityRoleClass("climber", "tt", "sprint"), "svaghed");
  assert.equal(youthAbilityCap(3, "climber", "tt", "sprint"), 45);
});

test("#4634 C2: GC_PUNCH_FLOOR er 80 (sekundær-niveau) og gælder KUN gc/punch", () => {
  assert.equal(GC_PUNCH_FLOOR, 80);
  assert.equal(GC_PUNCH_FLOOR, YOUTH_PROGRESSION_CONFIG.roleTags.sekundaer);
});

test("#4634 C2: gc-rytterens punch-tag er MINDST 80, uanset sekundærtype", () => {
  // Før C2: rouleur/sprinter-sekundær gav andenRolle (55); tt-sekundær gav
  // svaghed (nu 45, før 25). Alle skal nu floores til 80.
  for (const secondary of ["rouleur", "tt", "sprinter", "climber", "puncheur", "baroudeur", "brostensrytter", "gc"]) {
    const cap = youthAbilityCap(3, "gc", secondary, "punch");
    assert.ok(cap >= 80, `gc/${secondary} punch-tag ${cap} skal være ≥ 80`);
  }
});

test("#4634 C2: gulvet rører KUN gc — samme (primær, sekundær, evne) med gc som SEKUNDÆR floores ikke", () => {
  // Gulvet er nøglet på PRIMARYTYPE === gc, ikke på om gc indgår som sekundær.
  for (const primary of ["climber", "rouleur", "sprinter", "puncheur", "baroudeur", "brostensrytter", "tt"]) {
    const withGcSecondary = youthAbilityCap(3, primary, "gc", "punch");
    assert.ok(withGcSecondary <= 93, `${primary}/gc punch (${withGcSecondary}) skal IKKE floores af GC-punch-gulvet`);
  }
  // gc's øvrige evner er uændrede af punch-gulvet (fx climbing, hvor gc er primær-signatur).
  assert.equal(youthAbilityCap(3, "gc", "tt", "climbing"), YOUTH_PROGRESSION_CONFIG.roleTags.signatur);
});

test("#4634 C2: gulvet LØFTER, det sænker aldrig — gc/climber-sekundær (allerede 80) forbliver 80", () => {
  // gc/climber: climber.weights.punch=1>0 sekundært → sekundaer-klasse (tag 80
  // allerede) — gulvet må hverken hæve eller sænke dette tilfælde.
  assert.equal(abilityRoleClass("gc", "climber", "punch"), "sekundaer");
  assert.equal(youthAbilityCap(3, "gc", "climber", "punch"), 80);
});

test("#4634 C2: gulvet lever hvor loftet udledes — buildYouthCaps/buildCapsForRider bærer det videre, tapered som ethvert andet tag", () => {
  const youth = buildYouthCaps(3, "gc", "tt");
  assert.equal(youth.punch, 80, "buildYouthCaps skal bære gc-punch-gulvet videre");
  // Ved peakAge (ingen taper endnu) skal buildCapsForRider give samme tal.
  const atPeak = buildCapsForRider(allAbilities(10), { potentiale: 3, age: 28 }, "gc", "tt");
  assert.equal(atPeak.punch, 80);
  // Forbi peak aftrappes gulvet på nøjagtig samme måde som ethvert andet tag
  // (samme taperedAbsoluteCap-sti) — det er IKKE immunt mod alderen.
  const past = buildCapsForRider(allAbilities(10), { potentiale: 3, age: 34 }, "gc", "tt");
  assert.ok(past.punch < 80, `gc-punch-gulvet skal aftrappes forbi peak ligesom alle andre tag (fik ${past.punch})`);
  assert.ok(past.punch > 0);
});

test("håndværk B1: håndværks-klassen sænker intet loft for NOGEN kombination", () => {
  // Gate B1 udtømmende over hele parameterrummet i stedet for på stikprøver:
  // 8 primære × 8 sekundære × 15 evner. Uden håndværks-klassen (haandvaerk-tag
  // udeladt) er taget den rene fire-klasse-model — hvert tag med klassen skal
  // være ≥. (Potentiale-dimensionen er udgået: taget er potentiale-uafhængigt.)
  const udenGulv = {
    ...YOUTH_PROGRESSION_CONFIG,
    roleTags: { ...YOUTH_PROGRESSION_CONFIG.roleTags, haandvaerk: undefined },
  };
  for (const primary of RIDER_TYPE_KEYS) {
    for (const secondary of RIDER_TYPE_KEYS) {
      for (const ability of VISIBLE_ABILITIES) {
        const foer = youthAbilityCap(3, primary, secondary, ability, udenGulv);
        const efter = youthAbilityCap(3, primary, secondary, ability, YOUTH_PROGRESSION_CONFIG);
        assert.ok(
          efter >= foer,
          `${primary}/${secondary} ${ability}: loft faldt ${foer} → ${efter}`,
        );
      }
    }
  }
});

// ── Afkoblet ungdoms-loft (#1791 A2) ─────────────────────────────────────────

test("youthAbilityCap: afkoblet fra start-evne OG fra potentiale (trin 7)", () => {
  // Trin 7 (#3746, ejer 16/8): potentiale er flyttet fra HØJDE til FART. Samme
  // rolle giver samme tag uanset potentiale — forskellen ligger i rateByPotential.
  const lowPot = youthAbilityCap(2, "climber", "tt", "climbing");
  const highPot = youthAbilityCap(6, "climber", "tt", "climbing");
  assert.equal(highPot, lowPot, "taget må ikke afhænge af potentiale");
  assert.equal(highPot, YOUTH_PROGRESSION_CONFIG.roleTags.signatur);
  // Afkobling: loftet afhænger heller IKKE af en start-evne (ingen baseline-parameter).
  assert.equal(youthAbilityCap.length, 5); // (potentiale, primary, secondary, ability, cfg)
});

test("buildYouthCaps: primær-evne højest, modsat lavest, alle ≤99", () => {
  const caps = buildYouthCaps(6, "climber", "tt");
  for (const k of VISIBLE_ABILITIES) assert.ok(caps[k] >= 0 && caps[k] <= 99);
  assert.ok(caps.climbing > caps.sprint, `climbing ${caps.climbing} skal > sprint ${caps.sprint}`);
});

// ── Potentiale-rate i developRiderSeason (#1791 B1) ──────────────────────────

test("potentiale styrer træningsfart: pot6 vokser hurtigere end pot2 fra samme start mod samme loft", () => {
  const abilities = { climbing: 20 };
  const caps = { climbing: 80 };
  const low = developRiderSeason({ id: "r1", primary_type: "climber", potentiale: 2, age: 18 }, abilities, caps, 1);
  const high = developRiderSeason({ id: "r1", primary_type: "climber", potentiale: 6, age: 18 }, abilities, caps, 1);
  assert.ok(high.next.climbing > low.next.climbing,
    `pot6 ${high.next.climbing} skal > pot2 ${low.next.climbing} efter én sæson`);
});

// ── buildProgressInit + buildCapsForRider (#2001) ────────────────────────────
// ability_caps + ability_progress var NULL for ryttere der aldrig blev udviklet/
// trænet. Disse helpers giver derive-stien + backfill ÉN delt init der matcher
// præcis det motoren ellers lazy-initerede.

test("buildProgressInit: nul-fyldt over alle 15 synlige evner", () => {
  const p = buildProgressInit();
  assert.equal(Object.keys(p).length, VISIBLE_ABILITIES.length);
  for (const k of VISIBLE_ABILITIES) assert.equal(p[k], 0, `${k} skal initialiseres til 0`);
});

// ── Samlet loft-semantik: fladt rolle-tag, INTET gulv (trin 7, 16/8) ─────────
// 15/7 konsoliderede to uforenelige loft-semantikker til én (potentiale + anlæg
// + gulv ved nuværende evne). Trin 7 (#3746) fjernede potentiale fra formlen og
// gulvet fra loftet (#3794): taget er rolleklassens absolutte tag, aftrappet
// efter peak-alder, afrundet til heltal (#3788). Et loft under en arvet evne er
// LOVLIGT — rytteren beholder evnen og står stille dér (ingen kodesti kan tage
// evne: dailyTraining lægger kun til, stepAbility er uændret ved gap ≤ 0).

const allAbilities = (v) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));

test("buildCapsForRider: loftet er alders-uafhængigt FØR peak (21→22 må ikke flytte loftet)", () => {
  // #2472 (16/7): loftet er kun alders-uafhængigt TIL OG MED peakAge (28) —
  // se taper-testene nedenfor for adfærden EFTER peak (den nye, tilsigtede ændring).
  const ab = allAbilities(20);
  const young = buildCapsForRider(ab, { potentiale: 5, age: 18 }, "climber", "tt");
  const adult = buildCapsForRider(ab, { potentiale: 5, age: 28 }, "climber", "tt");
  assert.deepEqual(adult, young, "alder må ikke ændre loftet før/på peakAge");
});

test("buildCapsForRider: loftet er formel-rent — evnerne indgår IKKE (#3794)", () => {
  // Gulvet max(tag, current) er fjernet: en voksen med evne 85 og et tag under
  // beholder evnen (ingen kodesti tager den), men loftet følger IKKE evnen op.
  // Det er præcis dét der gør det viste potentiale stabilt mellem kalibreringer.
  const hoej = buildCapsForRider(allAbilities(85), { potentiale: 1, age: 29 }, "climber", "tt");
  const lav = buildCapsForRider(allAbilities(10), { potentiale: 1, age: 29 }, "climber", "tt");
  assert.deepEqual(hoej, lav, "samme rytter-parametre skal give samme loft uanset evner");
  // Og loftet må gerne ligge under evnen — det er den designede tilstand for
  // arvede ryttere over deres tag (ejer-beslutning 8, 15/8).
  assert.ok(hoej.sprint < 85, `svagheds-loft ${hoej.sprint} skal ligge under evnen 85`);
});

test("buildCapsForRider: potentiale ændrer ikke loftet (trin 7)", () => {
  // Prod-anomalien "pot 4,5 slog pot 6 (813 > 737)" er strukturelt umulig nu:
  // taget er potentiale-uafhængigt, så der findes ingen rækkefølge at bryde.
  // Potentiale-forskellen ligger i farten (rateByPotential, testet ovenfor).
  const ab = allAbilities(10);
  const reference = buildCapsForRider(ab, { potentiale: 1, age: 18 }, "climber", "tt");
  for (const p of [2, 3, 4, 4.5, 5, 5.5, 6]) {
    assert.deepEqual(
      buildCapsForRider(ab, { potentiale: p, age: 18 }, "climber", "tt"),
      reference,
      `pot ${p}: loftet skal være identisk med pot 1's`,
    );
  }
});

test("buildCapsForRider: lofter er hele tal, også efter taper (#3788)", () => {
  // Taperingen kunne give et loft midt i et niveau (fx 80,25), så træningsbaren
  // viste fremgang mod et niveau rytteren aldrig kunne nå.
  for (const age of [18, 29, 31, 34, 37]) {
    const caps = buildCapsForRider(allAbilities(20), { potentiale: 4, age }, "climber", "tt");
    for (const k of VISIBLE_ABILITIES) {
      assert.ok(Number.isInteger(caps[k]), `${k} ved alder ${age}: ${caps[k]} skal være et helt tal`);
    }
  }
});

test("buildCapsForRider: afkoblet fra start-evnen — lav baseline + højt pot når verdensklasse", () => {
  const caps = buildCapsForRider(allAbilities(10), { potentiale: 6, age: 16 }, "climber", "tt");
  assert.deepEqual(caps, buildYouthCaps(6, "climber", "tt"), "gulvet binder ikke ved lav current");
  assert.ok(caps.climbing > 80, `pot-6-talent skal kunne nå verdensklasse (${caps.climbing})`);
});

test("buildCapsForRider: dækker alle 15 synlige evner, clamped 0-99", () => {
  const caps = buildCapsForRider(allAbilities(30), { potentiale: 3, age: 25 }, "sprinter", "puncheur");
  assert.equal(Object.keys(caps).length, VISIBLE_ABILITIES.length);
  for (const k of VISIBLE_ABILITIES) assert.ok(caps[k] >= 0 && caps[k] <= 99, `${k}=${caps[k]}`);
});

test("buildCapsForRider: cap ≥ baseline for voksen signatur-evne (current kan vokse mod loft)", () => {
  const caps = buildCapsForRider({ climbing: 60, sprint: 30 }, { potentiale: 5, age: 30 }, "climber");
  assert.ok(caps.climbing >= 60, `signatur-cap ${caps.climbing} skal ≥ baseline 60`);
});

// ── Alders-taper på det absolutte loft (ejer-valg B, 16/7, #2472) ───────────
// Blocker-fund: uden taper er buildYouthCaps alders-uafhængigt, så en post-peak
// rytters gap (=cap−current) genåbnes og daglig træning overhaler sæson-declinen
// (dailyAbilityDelta har ingen aldersgate). Taperen aftrapper det ABSOLUTTE loft
// efter peakAge. Gulvet er fjernet i trin 7 (#3794); ingen konfiskation kan ske
// alligevel — motoren kan kun stå stille under et lavt loft (testet ovenfor).

test("taperedAbsoluteCap: kant 28 (= peakAge) — uændret, retain 1.0", () => {
  assert.equal(taperedAbsoluteCap(80, 28, 28), 80);
});

test("taperedAbsoluteCap: kant 29 (1 år forbi peak) — delvist aftrappet, strengt under 28-værdien", () => {
  const at28 = taperedAbsoluteCap(80, 28, 28);
  const at29 = taperedAbsoluteCap(80, 29, 28);
  assert.ok(at29 < at28, `29 (${at29}) skal være under 28 (${at28})`);
  assert.ok(at29 > 0, "skal ikke være nul allerede efter 1 år");
});

test("taperedAbsoluteCap: kant 36 (sidste veteran-år) — meningsfuldt aftrappet, hverken fuldt eller nul", () => {
  const at36 = taperedAbsoluteCap(80, 36, 28);
  assert.ok(at36 > 0 && at36 < 80, `36 år skal være delvist aftrappet, fik ${at36}`);
  assert.ok(at36 < taperedAbsoluteCap(80, 33, 28), "36 skal ligge under 33 (længere forbi peak = mere aftrappet)");
});

test("taperedAbsoluteCap: kant 40+ — fuldt aftrappet (retain 0, CAP_TAPER_CONFIG's sidste anker), fladt derefter", () => {
  const lastAnchor = CAP_TAPER_CONFIG.retainByYearsPastPeak.at(-1);
  assert.equal(lastAnchor.retain, 0, "sidste anker skal være retain=0 (forudsætning for denne test)");
  assert.equal(taperedAbsoluteCap(80, 28 + lastAnchor.years, 28), 0, `alder ${28 + lastAnchor.years} (sidste anker) skal være fuldt aftrappet`);
  assert.equal(taperedAbsoluteCap(80, 50, 28), 0, "fladt på 0 langt forbi sidste anker — falder ikke i negativ");
});

test("taperedAbsoluteCap: monotont faldende med alderen forbi peak", () => {
  let prev = taperedAbsoluteCap(80, 28, 28);
  for (let age = 29; age <= 45; age++) {
    const cur = taperedAbsoluteCap(80, age, 28);
    assert.ok(cur <= prev, `alder ${age}: ${cur} skal være ≤ forrige ${prev}`);
    prev = cur;
  }
});

test("taperedAbsoluteCap: age null/undefined ⇒ uændret (sikker default, bagudkompatibel)", () => {
  assert.equal(taperedAbsoluteCap(80, null, 28), 80);
  assert.equal(taperedAbsoluteCap(80, undefined, 28), 80);
});

test("buildCapsForRider: age null ⇒ intet taper (bevidst fravalg, ikke en udeladelse)", () => {
  const ab = allAbilities(20);
  const nullAge = buildCapsForRider(ab, { potentiale: 5, age: null }, "climber", "tt");
  const atPeak = buildCapsForRider(ab, { potentiale: 5, age: 28 }, "climber", "tt");
  assert.deepEqual(nullAge, atPeak, "eksplicit age:null skal svare til age ≤ peakAge (intet taper)");
});

// ── FORWARD-GUARD (#3591) ────────────────────────────────────────────────────
// Rodårsagen bag #3591 var ikke at ét kaldsted glemte alderen — det var at det KUNNE
// glemme den tavst. `age` var dokumenteret valgfri, så en caller uden alder fik et
// gyldigt, men for højt loft i stedet for en fejl. To skrivestier divergerede derfor i
// måneder uden at nogen opdagede det, og PR #3598's rettelse af det ene kaldsted
// lukkede ikke muligheden: `starterSquadAllocator.js` kaldte stadig uden alder tre
// dage senere.
//
// Denne test er selve vagten. Fejler den, er kontrakten rullet tilbage til den
// tilstand der producerede #3591.
test("#3591 forward-guard: udeladt age KASTER — divergens ved udeladelse er umulig", () => {
  const ab = allAbilities(20);
  assert.throws(
    () => buildCapsForRider(ab, { potentiale: 5 }, "climber", "tt"),
    /age. skal angives eksplicit/,
    "en caller der glemmer alderen skal fejle højlydt, ikke få et for højt loft",
  );
  assert.throws(
    () => buildCapsForRider(ab, undefined, "climber", "tt"),
    /age. skal angives eksplicit/,
    "helt manglende rider-objekt er samme fejl",
  );
  // Negativ-bevis: vagten må ikke være tom — begge lovlige former skal stadig virke.
  assert.ok(buildCapsForRider(ab, { potentiale: 5, age: null }, "climber", "tt"));
  assert.ok(buildCapsForRider(ab, { potentiale: 5, age: 30 }, "climber", "tt"));
});

// Beviser at kontrakten faktisk BETYDER noget: for en post-peak rytter giver de to
// lovlige former forskellige lofter. Uden denne assertion kunne vagten ovenfor bestå
// på en fixture hvor alderen er ligegyldig, og så ville den intet bevise.
test("#3591 forward-guard: de to lovlige kaldformer ER skelnelige for en post-peak rytter", () => {
  const ab = allAbilities(20);
  const udenTaper = buildCapsForRider(ab, { potentiale: 6, age: null }, "climber", "tt");
  const medTaper = buildCapsForRider(ab, { potentiale: 6, age: 36 }, "climber", "tt");
  assert.notDeepEqual(medTaper, udenTaper, "36-årig skal have et aftrappet loft — ellers måler vagten intet");
});

test("buildCapsForRider: post-peak taper lukker gappet — cap falder med alderen", () => {
  const ab = { climbing: 40 };
  const at29 = buildCapsForRider(ab, { potentiale: 6, age: 29 }, "climber", "tt");
  const at36 = buildCapsForRider(ab, { potentiale: 6, age: 36 }, "climber", "tt");
  const at40 = buildCapsForRider(ab, { potentiale: 6, age: 40 }, "climber", "tt");
  assert.ok(at36.climbing <= at29.climbing, `36 (${at36.climbing}) skal ≤ 29 (${at29.climbing})`);
  // #3794: intet gulv — langt forbi peak må loftet gerne ende UNDER evnen (og
  // ved retain 0 på selve 0). Væksten stopper (gap 0), evnen røres ikke.
  assert.ok(at40.climbing <= at36.climbing, `40 (${at40.climbing}) skal ≤ 36 (${at36.climbing})`);
});

test("et loft under evnen konfiskerer ALDRIG evne — motoren kan kun stå stille dér (#3794)", () => {
  // Gulvet er væk, så invarianten "ingen mister noget" bor nu i motoren selv:
  // et loft under evnen giver gap ≤ 0 → dailyAbilityDelta 0 og stepAbility
  // uændret. Det er præcis det #3794 verificerede før gulvet blev fjernet.
  const caps = buildCapsForRider(allAbilities(70), { potentiale: 2, age: 33 }, "climber", "tt");
  for (const k of VISIBLE_ABILITIES) {
    if (caps[k] >= 70) continue; // kun pladserne hvor loftet ligger under evnen
    const efter = stepAbility(70, caps[k], 25, 28, true, 0.5);
    assert.equal(efter, 70, `${k}: stepAbility må ikke røre en evne over loftet`);
  }
});
