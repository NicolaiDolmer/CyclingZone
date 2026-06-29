import test from "node:test";
import assert from "node:assert/strict";

import {
  PROGRESSION_CONFIG, seededUnit, signatureFactor, headroomForPotential,
  peakAgeForType, abilityCap, stepAbility, retirementDecision,
  developRiderSeason, buildCaps,
  youthRoleFactor, YOUTH_PROGRESSION_CONFIG,
  youthAbilityCap, buildYouthCaps,
  buildCapsForRider, buildProgressInit,
} from "./riderProgression.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

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
  const primary = youthRoleFactor("climber", "tt", "climbing");
  const secondary = youthRoleFactor("climber", "tt", "time_trial"); // tt.weights.time_trial=3>0, men kun secondary
  const neutral = youthRoleFactor("climber", "tt", "positioning");  // ingen type-vægt
  const opposite = youthRoleFactor("climber", "tt", "sprint");      // climber.weights.sprint=-2<0
  assert.equal(primary, YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor);
  assert.equal(secondary, YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor);
  assert.equal(neutral, YOUTH_PROGRESSION_CONFIG.neutralFactor);
  assert.equal(opposite, YOUTH_PROGRESSION_CONFIG.oppositeFactor);
  assert.ok(primary > secondary && secondary > neutral && neutral > opposite);
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

test("buildCapsForRider (voksen): identisk med buildCaps fra baseline (samme som motorens lazy-init)", () => {
  const abilities = { climbing: 60, sprint: 40, flat: 50, time_trial: 55, tempo: 45,
    acceleration: 42, punch: 48, endurance: 52, recovery: 50, durability: 47,
    descending: 44, cobblestone: 41, positioning: 46, aggression: 43, tactics: 49 };
  const viaHelper = buildCapsForRider(abilities, { potentiale: 5, age: 28 }, "climber", "tt");
  const viaBuildCaps = buildCaps(abilities, "climber", 5);
  assert.deepEqual(viaHelper, viaBuildCaps, "voksen-stien skal matche buildCaps eksakt");
  for (const k of VISIBLE_ABILITIES) assert.ok(viaHelper[k] >= 0 && viaHelper[k] <= 99);
});

test("buildCapsForRider (akademi-alder): afkoblede ungdoms-caps (buildYouthCaps), ikke baseline-bundet", () => {
  const lowBaseline = { climbing: 10, sprint: 5, flat: 8, time_trial: 7, tempo: 6,
    acceleration: 5, punch: 6, endurance: 9, recovery: 7, durability: 6,
    descending: 5, cobblestone: 4, positioning: 6, aggression: 5, tactics: 7 };
  // 18-årig (akademi-alder ved asOfYear via age-param) climber med højt potentiale.
  const caps = buildCapsForRider(lowBaseline, { potentiale: 6, age: 18 }, "climber", "tt");
  const expected = buildYouthCaps(6, "climber", "tt");
  assert.deepEqual(caps, expected, "akademi-alder skal bruge buildYouthCaps");
  // Afkoblet: loftet er IKKE bundet til den lave baseline (skal ligge langt over 10).
  assert.ok(caps.climbing > lowBaseline.climbing + 20,
    `ungdoms-loft ${caps.climbing} skal ligge langt over baseline ${lowBaseline.climbing}`);
});

test("buildCapsForRider: cap ≥ baseline for voksen signatur-evne (current kan vokse mod loft)", () => {
  const abilities = { climbing: 60, sprint: 30 };
  const caps = buildCapsForRider(abilities, { potentiale: 5, age: 30 }, "climber");
  assert.ok(caps.climbing >= 60, `signatur-cap ${caps.climbing} skal ≥ baseline 60`);
});
