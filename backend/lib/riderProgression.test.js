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
} from "./riderProgression.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";

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
    focusMult: 1.6, offFocusMult: 0.9, setbackHit: false,
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
  // #3709 trin 3: neutral-eksemplet var `positioning`, men den er nu HÅNDVÆRK og har
  // sit eget gulv (0,95). `descending` er neutral for begge typer og er derfor det
  // rene neutral-eksempel nu — se håndværks-testene nedenfor for den nye klasse.
  const primary = youthRoleFactor("climber", "tt", "climbing");
  const secondary = youthRoleFactor("climber", "tt", "time_trial"); // tt.weights.time_trial=3>0, men kun secondary
  const neutral = youthRoleFactor("climber", "tt", "descending");   // ingen type-vægt, ikke håndværk
  const opposite = youthRoleFactor("climber", "tt", "sprint");      // climber.weights.sprint=-2<0
  assert.equal(primary, YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor);
  assert.equal(secondary, YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor);
  assert.equal(neutral, YOUTH_PROGRESSION_CONFIG.neutralFactor);
  assert.equal(opposite, YOUTH_PROGRESSION_CONFIG.oppositeFactor);
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
  // gc ejer hverken positioning eller tactics — før trin 3 stod begge på 0,45.
  for (const ability of CRAFT_ABILITIES) {
    assert.equal(youthRoleFactor("gc", "climber", ability), YOUTH_PROGRESSION_CONFIG.craftFactor);
  }
  assert.ok(YOUTH_PROGRESSION_CONFIG.craftFactor > YOUTH_PROGRESSION_CONFIG.neutralFactor);
});

test("håndværk: gulvet LØFTER, det erstatter aldrig — signatur slår gulvet (#3682's gulv-løft-krav)", () => {
  // Sprinteren ejer nu positioning (#3682) → signatur-klassen vinder over gulvet.
  assert.equal(abilityRoleClass("sprinter", "climber", "positioning"), "signatur");
  assert.equal(
    youthRoleFactor("sprinter", "climber", "positioning"),
    YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor,
  );
  // Gulvet sammenligner på FAKTOREN, ikke på klasse-navnet. Efter trin 4 er
  // sekundær (1,10) højere end håndværk (0,95), så en rytter med sprinter som
  // sekundær bliver `sekundaer` — ikke fordi navnet rangerer højere, men fordi
  // tallet gør. Før trin 4 var forholdet omvendt (0,82 < 0,95) og samme kode gav
  // `haandvaerk`. Det er hele grunden til at sammenligningen står på faktorer:
  // ændres tallene igen, kan gulvet stadig ikke sænke nogens tag.
  assert.equal(abilityRoleClass("climber", "sprinter", "positioning"), "sekundaer");
  assert.ok(
    youthRoleFactor("climber", "sprinter", "positioning") >= YOUTH_PROGRESSION_CONFIG.craftFactor,
    "gulvet må aldrig give et LAVERE tag end håndværks-faktoren",
  );
});

test("håndværk: gulvet kan ALDRIG sænke et tag, uanset hvordan faktorerne kalibreres", () => {
  // Invarianten der skal overleve enhver fremtidig kalibrering. Kør hele
  // parameterrummet med en RÆKKE forskellige craftFactor-værdier — også nogle
  // der er lavere end alle andre klasser — og kræv at gulvet aldrig trækker ned.
  for (const craftFactor of [0.05, 0.45, 0.95, 1.2, 2.0]) {
    const medGulv = { ...YOUTH_PROGRESSION_CONFIG, craftFactor };
    const udenGulv = { ...YOUTH_PROGRESSION_CONFIG, craftFactor: undefined };
    for (const primary of RIDER_TYPE_KEYS) {
      for (const secondary of RIDER_TYPE_KEYS) {
        for (const ability of CRAFT_ABILITIES) {
          assert.ok(
            youthRoleFactor(primary, secondary, ability, medGulv)
              >= youthRoleFactor(primary, secondary, ability, udenGulv),
            `craftFactor=${craftFactor} ${primary}/${secondary} ${ability}: gulvet sænkede taget`,
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

test("rolleklasser: tagene er ALLE højere end før trin 4 (loftet er hævet, raten bremser)", () => {
  // Modellens vigtigste egenskab, og den der gør beslutning 6 mulig: hvert eneste
  // tag stiger, og det er raten der sørger for at ryttere alligevel ikke NÅR dem.
  const foer = { naturalPrimaryFactor: 1.0, naturalSecondaryFactor: 0.82, neutralFactor: 0.45, oppositeFactor: 0.12 };
  for (const [key, gammel] of Object.entries(foer)) {
    assert.ok(
      YOUTH_PROGRESSION_CONFIG[key] > gammel,
      `${key}: ${YOUTH_PROGRESSION_CONFIG[key]} skal være HØJERE end den gamle ${gammel}`,
    );
  }
});

test("håndværk B1: intet loft falder for NOGEN kombination af type, evne og potentiale", () => {
  // Gate B1 udtømmende over hele parameterrummet i stedet for på stikprøver:
  // 8 primære × 8 sekundære × 15 evner × 6 potentialer. Uden håndværks-gulvet
  // (craftFactor udeladt) er faktoren den gamle model — hver ny faktor skal være ≥.
  const udenGulv = { ...YOUTH_PROGRESSION_CONFIG, craftFactor: undefined };
  for (const primary of RIDER_TYPE_KEYS) {
    for (const secondary of RIDER_TYPE_KEYS) {
      for (const ability of VISIBLE_ABILITIES) {
        for (const pot of [1, 2, 3, 4, 5, 6]) {
          const foer = youthAbilityCap(pot, primary, secondary, ability, udenGulv);
          const efter = youthAbilityCap(pot, primary, secondary, ability, YOUTH_PROGRESSION_CONFIG);
          assert.ok(
            efter >= foer,
            `${primary}/${secondary} ${ability} pot${pot}: loft faldt ${foer} → ${efter}`,
          );
        }
      }
    }
  }
});

// ── Afkoblet ungdoms-loft (#1791 A2) ─────────────────────────────────────────

test("youthAbilityCap: afkoblet fra start-evne, stiger med potentiale", () => {
  // Samme rytter, to potentialer → højere pot giver højere loft, UANSET baseline.
  const lowPot = youthAbilityCap(2, "climber", "tt", "climbing");
  const highPot = youthAbilityCap(6, "climber", "tt", "climbing");
  assert.ok(highPot > lowPot, `pot6 ${highPot} skal > pot2 ${lowPot}`);
  // Afkobling: loftet afhænger IKKE af en start-evne (ingen baseline-parameter).
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

// ── Samlet loft-semantik: absolut loft + gulv (ejer-besluttet 2026-07-15) ────
// Indtil 15/7 fandtes TO uforenelige loft-semantikker side om side, og hvilken en
// rytter fik afgjordes af hvilken kodesti der først skrev ability_caps (feltet
// skrives kun når NULL). Prod-følgen: en pot-4,5-rytter havde et højere livstids-
// loft (813) end den bedste pot-6-rytter (737) — potentiale styrede ikke hvor god
// en rytter kunne blive. Nu ét loft for ALLE: potentiale + anlæg bestemmer niveauet,
// med et gulv ved nuværende evne så ingen spiller får frataget evne han ejer.
// Supersederer §4.2/§8/§10 i specs/2026-06-23-ungdoms-rytter-evner-rework-design.md.

const allAbilities = (v) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));

test("buildCapsForRider: loftet er alders-uafhængigt FØR peak (21→22 må ikke flytte loftet)", () => {
  // #2472 (16/7): loftet er kun alders-uafhængigt TIL OG MED peakAge (28) —
  // se taper-testene nedenfor for adfærden EFTER peak (den nye, tilsigtede ændring).
  const ab = allAbilities(20);
  const young = buildCapsForRider(ab, { potentiale: 5, age: 18 }, "climber", "tt");
  const adult = buildCapsForRider(ab, { potentiale: 5, age: 28 }, "climber", "tt");
  assert.deepEqual(adult, young, "alder må ikke ændre loftet før/på peakAge");
});

test("buildCapsForRider: loftet er aldrig under nuværende evne (gulvet)", () => {
  // Voksen med høj current og lavt potentiale: det absolutte loft (pot 1 → 35)
  // ligger langt under current 85 → gulvet skal vinde, ellers fratages spilleren evne.
  const caps = buildCapsForRider(allAbilities(85), { potentiale: 1, age: 29 }, "climber", "tt");
  for (const k of VISIBLE_ABILITIES) {
    assert.ok(caps[k] >= 85, `${k}: loft ${caps[k]} må ikke ligge under current 85`);
  }
});

test("buildCapsForRider: højere potentiale giver aldrig lavere loft", () => {
  const ab = allAbilities(10);
  let prev = -1;
  for (const p of [1, 2, 3, 4, 4.5, 5, 5.5, 6]) {
    const caps = buildCapsForRider(ab, { potentiale: p, age: 18 }, "climber", "tt");
    assert.ok(caps.climbing >= prev, `pot ${p}: loft ${caps.climbing} < forrige ${prev}`);
    prev = caps.climbing;
  }
});

test("buildCapsForRider: pot 6 slår pot 4,5 (prod-anomalien 813 > 737)", () => {
  const ab = allAbilities(10);
  const p45 = buildCapsForRider(ab, { potentiale: 4.5, age: 19 }, "climber", "tt");
  const p6 = buildCapsForRider(ab, { potentiale: 6, age: 19 }, "climber", "tt");
  assert.ok(p6.climbing > p45.climbing, `pot6 ${p6.climbing} skal slå pot4,5 ${p45.climbing}`);
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
// efter peakAge; gulvet (max(tapered, current)) er urørt — ingen konfiskation.

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

test("buildCapsForRider: post-peak taper lukker gappet — cap falder mod current med alderen", () => {
  // Lavt current, højt potentiale: absolut loft ligger langt over current, så
  // gulvet ikke binder ved 29 — men skal binde senere når taperen har spist gappet.
  const ab = { climbing: 40 };
  const at29 = buildCapsForRider(ab, { potentiale: 6, age: 29 }, "climber", "tt");
  const at36 = buildCapsForRider(ab, { potentiale: 6, age: 36 }, "climber", "tt");
  assert.ok(at36.climbing <= at29.climbing, `36 (${at36.climbing}) skal ≤ 29 (${at29.climbing})`);
  assert.ok(at36.climbing >= 40, "gulvet: loftet må aldrig gå under current (40)");
});

test("buildCapsForRider: gulvet vinder altid — taper konfiskerer ALDRIG evne rytteren allerede ejer", () => {
  for (const age of [28, 29, 33, 36, 40, 45]) {
    const caps = buildCapsForRider(allAbilities(70), { potentiale: 2, age }, "climber", "tt");
    for (const k of VISIBLE_ABILITIES) {
      assert.ok(caps[k] >= 70, `alder ${age}, ${k}: loft ${caps[k]} må ikke ligge under current 70`);
    }
  }
});
