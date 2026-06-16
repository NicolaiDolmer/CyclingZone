import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAbilities, FORMULA_VERSION, CALIBRATION, CONTRAST,
  VISIBLE_ABILITIES, ALL_ABILITY_KEYS, PRIMARY_STAT,
} from "./abilityDerivation.js";
import { seedArchetypePhysiology } from "./archetypePhysiology.js";
import { makeRng } from "./fictionalRiderGenerator.js";

const physFor = (archetype, tierLevel = 0.7) =>
  seedArchetypePhysiology({ archetype, tierLevel, height_cm: 178, weight_kg: 68, rng: makeRng(2026) });

const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];

function rider(stat = 60, extra = {}) {
  const r = { id: "r1", birthdate: "1998-01-01", potentiale: 3 };
  for (const k of STAT_KEYS) r[k] = stat;
  return { ...r, ...extra };
}

// ── v3-tests (#1122) ─────────────────────────────────────────────────────────

test("#1122 v3: formula_version=3, 15 synlige evner, INGEN prolog", () => {
  const a = deriveAbilities(physFor("climber"), rider(60));
  assert.equal(a.formula_version, 3);
  assert.equal(FORMULA_VERSION, 3);
  assert.equal(VISIBLE_ABILITIES.length, 15);
  assert.ok(!("prolog" in a), "prolog skal være fjernet i v3");
  assert.ok(!VISIBLE_ABILITIES.includes("prolog"));
});

test("#1122 v3 determinisme: samme fysiologi+row → identisk output", () => {
  const phys = physFor("gc");
  assert.deepEqual(deriveAbilities(phys, rider(60)), deriveAbilities(phys, rider(60)));
});

test("#1122 v3 fysiologi-drevet specialisering: climber climbing ≫ sprint; sprinter omvendt", () => {
  const clb = deriveAbilities(physFor("climber"), rider(60));
  const spr = deriveAbilities(physFor("sprinter"), rider(60));
  assert.ok(clb.climbing - clb.sprint > 25, `climber climbing(${clb.climbing}) ikke ≫ sprint(${clb.sprint})`);
  assert.ok(spr.sprint - spr.climbing > 25, `sprinter sprint(${spr.sprint}) ikke ≫ climbing(${spr.climbing})`);
});

// ── §5-B KONTRAST-FORSTÆRKNING (#1122 "A+B") ──────────────────────────────────

test("#1122 §5-B kontrast: TIER-UAFHÆNGIG — superstar-klatrer er tydeligt svag i NEUROMUSKULÆRE off-discipliner", () => {
  // Mætnings-problemet: en superstar (tierLevel 0.95) er ellers "god til alt".
  // Kontrasten skal skubbe superstar-klatrerens neuromuskulære evner (sprint/
  // acceleration) KLART under climbing — den deciderede off-disciplin-akse.
  // (time_trial/tempo drives også af ftp/vo2, så de forbliver høje for en monster-
  // aerob klatrer; det er KORREKT — adskillelsen mod born-tt afgøres i dry-run-
  // scorecardet, hvor aero-skewen sænker klatrerens time_trial relativt til tt.)
  const star = deriveAbilities(physFor("climber", 0.95), rider(60));
  assert.ok(star.climbing - star.sprint > 40,
    `superstar-klatrer climbing(${star.climbing}) ikke klart > sprint(${star.sprint}) — mætning ikke brudt`);
  assert.ok(star.climbing - star.acceleration > 40,
    `superstar-klatrer climbing(${star.climbing}) ikke klart > acceleration(${star.acceleration})`);
});

test("#1122 §5-B kontrast: forstærker spidskompetence-gap vs rå (k>1 spreder om egen median)", () => {
  // Sammenlign disciplin-spread ved k=1 (ingen kontrast) vs det tunede k via en
  // direkte median-beregning. En sprinters sprint-vs-svageste-gap skal vokse med k.
  const spr = deriveAbilities(physFor("sprinter", 0.85), rider(60));
  const weakest = Math.min(spr.climbing, spr.time_trial, spr.tempo);
  assert.ok(spr.sprint - weakest > 40,
    `sprinter sprint(${spr.sprint}) − svageste(${weakest}) = ${spr.sprint - weakest}, forventet stort gap efter kontrast`);
});

test("#1122 §5-B kontrast: FLOOR forhindrer karikatur — svageste evne ≥ CONTRAST.floor", () => {
  for (const arch of ["sprinter", "climber", "tt", "puncheur", "brostensrytter"]) {
    const a = deriveAbilities(physFor(arch, 0.9), rider(60));
    const physMin = Math.min(a.climbing, a.time_trial, a.flat, a.tempo, a.sprint,
      a.acceleration, a.punch, a.endurance, a.recovery, a.durability);
    assert.ok(physMin >= CONTRAST.floor, `${arch} har fysisk evne ${physMin} under floor ${CONTRAST.floor}`);
  }
});

test("#1122 §5-B kontrast: tekniske/mentale evner røres IKKE af kontrasten", () => {
  // descending afledes rent af stat_ned (uden for kontrast-sættet) → uændret af
  // kontrast-trinnet uanset rytterens fysiske profil. Verificér mod ren stat-mapping.
  const a = deriveAbilities(physFor("climber"), rider(55, { stat_ned: 70 }));
  const b = deriveAbilities(physFor("sprinter"), rider(55, { stat_ned: 70 }));
  assert.equal(a.descending, b.descending, "descending må ikke afhænge af den fysiske profil/kontrast");
});

test("#1122 §5-B kontrast anvendes KUN på fysiologi-stien (IKKE PCM-fallback)", () => {
  // Fallback-stien er en ren lineær stat-remap uden mætning; value-modellen er fittet
  // mod den. Kontrast her ville inflatere base_value. En PCM-rytter med ÉN høj stat
  // skal give præcis den lineære mapping (stat 84 → ~96), ikke en kontrast-spredt værdi.
  const a = deriveAbilities({}, rider(50, { stat_bj: 84 }));
  // climbing = scoreFrac(pcmFrac(84)) = 1 + round((84-50)/35 * 98) = 96; uændret af kontrast.
  assert.equal(a.climbing, 96, `fallback climbing ved stat_bj 84 = ${a.climbing}, forventet 96 (ren v2-mapping)`);
  // De øvrige (stat 50) forbliver 1 — IKKE løftet af en median-kontrast.
  assert.equal(a.sprint, 1, `fallback sprint ved stat 50 = ${a.sprint}, forventet 1 (ingen kontrast)`);
});

test("#1122 v3 VO2max-trekant: monster-aerob climber stærk på BÅDE tempo og climbing", () => {
  const clb = deriveAbilities(physFor("climber", 0.95), rider(60));
  assert.ok(clb.climbing > 70 && clb.tempo > 60, `climber climbing ${clb.climbing} / tempo ${clb.tempo} for lave for elite-aerob`);
});

test("#1122 v3 alle 15 evner + hidden ∈ [1,99]", () => {
  for (const arch of ["sprinter","tt","climber","gc","puncheur","rouleur","brostensrytter","baroudeur"]) {
    const a = deriveAbilities(physFor(arch), rider(60));
    for (const k of ALL_ABILITY_KEYS) assert.ok(Number.isInteger(a[k]) && a[k] >= 1 && a[k] <= 99, `${k}=${a[k]} (${arch})`);
  }
});

test("#1122 v3 tekniske/mentale evner følger stadig skill-stats (descending←stat_ned)", () => {
  const phys = physFor("baroudeur");
  const hi = deriveAbilities(phys, rider(55, { stat_ned: 84 }));
  const lo = deriveAbilities(phys, rider(55, { stat_ned: 52 }));
  assert.ok(hi.descending > lo.descending, "descending følger ikke stat_ned");
});

test("#1122 v3 fallback: uden fysiologi falder fysiske evner tilbage til PCM-stat-derivation", () => {
  const a = deriveAbilities({}, rider(85)); // ingen fysiologi → v2-fallback
  assert.equal(a.climbing, 99, `fallback climbing ved stat 85 = ${a.climbing}, forventet 99`);
  assert.ok(!("prolog" in a), "prolog skal være fjernet selv i fallback");
});

// ── Determinisme + kontrakt ───────────────────────────────────────────────────

test("samme input → identisk output (determinisme)", () => {
  assert.deepEqual(deriveAbilities({}, rider(64)), deriveAbilities({}, rider(64)));
});

test("rider_id + formula_version (=3) sættes", () => {
  const a = deriveAbilities({}, rider(60, { id: "xyz" }));
  assert.equal(a.rider_id, "xyz");
  assert.equal(a.formula_version, FORMULA_VERSION);
  assert.equal(FORMULA_VERSION, 3);
});

test("rider_id falder tilbage til physiology.rider_id", () => {
  const a = deriveAbilities({ rider_id: "phys-id" }, { ...rider(60), id: undefined });
  assert.equal(a.rider_id, "phys-id");
});

test("producerer alle 15 synlige + hidden_potential", () => {
  const a = deriveAbilities({}, rider(60));
  for (const k of ALL_ABILITY_KEYS) assert.ok(k in a, `mangler ${k}`);
  assert.equal(VISIBLE_ABILITIES.length, 15);
  assert.ok(!("prolog" in a), "prolog skal ikke forekomme i output");
});

// ── Ankre: fallback-sti (PCM 50 → spil 1, PCM 85 → spil 99) ─────────────────
// Disse tests kører MED tomt fysiologi-objekt for at aktivere fallback-stien.
// #1122 §5-B: kontrasten anvendes KUN på fysiologi-stien (mætning eksisterer kun
// dér + value-modellen er fittet mod fallback-fordelingen). Fallback-ankrene er
// derfor UÆNDREDE fra v2: PCM 50 → 1, PCM 85 → 99.

test("fallback: alle disciplin-evner = 1 ved stat = pcmFloor (50) — kontrast rører IKKE fallback", () => {
  const a = deriveAbilities({}, rider(CALIBRATION.pcmFloor));
  for (const ability of Object.keys(PRIMARY_STAT)) {
    assert.equal(a[ability], 1, `${ability} ved stat 50 = ${a[ability]}, forventet 1`);
  }
});

test("fallback: alle disciplin-evner = 99 ved stat = pcmCeil (85)", () => {
  const a = deriveAbilities({}, rider(CALIBRATION.pcmCeil));
  for (const ability of Object.keys(PRIMARY_STAT)) {
    assert.equal(a[ability], 99, `${ability} ved stat 85 = ${a[ability]}, forventet 99`);
  }
});

test("fallback: stats uden for [50,85] clampes (40 → 1, 92 → 99)", () => {
  const lo = deriveAbilities({}, rider(40));
  const hi = deriveAbilities({}, rider(92));
  assert.equal(lo.climbing, 1);
  assert.equal(hi.climbing, 99);
});

// ── Bounds ────────────────────────────────────────────────────────────────────

test("alle abilities ∈ [1,99] for bredt stat-spænd (fallback)", () => {
  for (const s of [40, 50, 55, 60, 67, 72, 80, 85, 90]) {
    const a = deriveAbilities({}, rider(s));
    for (const k of ALL_ABILITY_KEYS) {
      assert.ok(Number.isInteger(a[k]) && a[k] >= 1 && a[k] <= 99, `${k}=${a[k]} ved stat ${s}`);
    }
  }
});

// ── Specialisering via stats (fallback-sti) ───────────────────────────────────

test("fallback sprinter-stats: sprint ≫ climbing; klatrer-stats: climbing ≫ sprint", () => {
  const spr = deriveAbilities({}, rider(55, { stat_sp: 84, stat_acc: 84, stat_bj: 55 }));
  const clb = deriveAbilities({}, rider(55, { stat_bj: 84, stat_kb: 82, stat_sp: 55 }));
  assert.ok(spr.sprint - spr.climbing > 40, `sprinter sprint(${spr.sprint}) ikke ≫ climbing(${spr.climbing})`);
  assert.ok(clb.climbing - clb.sprint > 40, `klatrer climbing(${clb.climbing}) ikke ≫ sprint(${clb.sprint})`);
});

// ── acceleration ≠ flad sprint (ejer-feedback): klatrer kan accelerere ─────────

test("klatrer med høj acc-stat, lav sprint-stat: acceleration ≫ sprint (fallback)", () => {
  const climber = deriveAbilities({}, rider(58, { stat_acc: 78, stat_sp: 56 }));
  assert.ok(climber.acceleration > climber.sprint + 20,
    `acceleration(${climber.acceleration}) skal være ≫ sprint(${climber.sprint})`);
});

// ── Acceleration-mapping er korrekt koblet til stat_acc (ikke stat_sp) ─────────

test("hver disciplin-evne følger sin egen primær-stat (fallback)", () => {
  for (const [ability, stat] of Object.entries(PRIMARY_STAT)) {
    const high = deriveAbilities({}, rider(55, { [stat]: 84 }));
    const low = deriveAbilities({}, rider(55, { [stat]: 52 }));
    assert.ok(high[ability] > low[ability], `${ability} følger ikke ${stat}`);
  }
});

// ── Alders-effekt: erfaring driver tactics, ungdom driver hidden_potential ─────

test("ældre rytter har højere tactics; yngre har højere hidden_potential", () => {
  const young = deriveAbilities({}, rider(60, { birthdate: "2005-01-01", potentiale: 6 }));
  const old = deriveAbilities({}, rider(60, { birthdate: "1992-01-01", potentiale: 6 }));
  assert.ok(old.tactics > young.tactics, `tactics: old ${old.tactics} ikke > young ${young.tactics}`);
  assert.ok(young.hidden_potential > old.hidden_potential, `hidden: young ${young.hidden_potential} ikke > old ${old.hidden_potential}`);
});

// ── v1-profil (ufuldstændig) skal IKKE bruge fysiologi-stien (#1122 review-fund) ──

test("#1122 v3 hasPhysiology: v1-profil (ftp_wkg men ingen aero) falder til PCM-fallback", () => {
  // seedPhysiologyFromLegacy (v1) har ftp_wkg men mangler aero/power_2m/power_10m. Hvis
  // den slap ind i fysiologi-stien ville normPhys→0 underestimere time_trial/flat/punch.
  // Forventet: hasPhysiology=false → PCM-fallback → climbing følger stat_bj (=85 → 99).
  const v1 = { rider_id: "pcm1", ftp_wkg: 6.5, vo2max_power_wkg: 7.0, pmax_watts: 1500 }; // ingen aero
  const a = deriveAbilities(v1, rider(85));
  assert.equal(a.climbing, 99, `v1-profil skal bruge fallback (climbing ${a.climbing}, forventet 99)`);
});

test("#1122 v3 hasPhysiology: DB-NULL felter afvises (falder til fallback)", () => {
  const nullish = { rider_id: "x", ftp_wkg: null, aero: null };
  const a = deriveAbilities(nullish, rider(85));
  assert.equal(a.climbing, 99, "null-profil skal bruge fallback");
});
