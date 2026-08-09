import test from "node:test";
import assert from "node:assert/strict";
import { makeRng, STAT_KEYS } from "./fictionalRiderGenerator.js";
import { generateAcademyCandidates, generateYouthStats, drawPotentiale, POTENTIALE_TIERS, YOUTH_GEN_CONFIG } from "./academyGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities } from "./abilityDerivation.js";

const REF_YEAR = 2026;

test("generateAcademyCandidates: 3-5 kandidater, is_serious afledt (pot>=4.5), alder 16-21", () => {
  const rng = makeRng(2026);
  const out = generateAcademyCandidates({ rng, referenceYear: REF_YEAR, existingNames: new Set() });
  assert.ok(out.length >= 3 && out.length <= 5, `antal ${out.length}`);
  for (const c of out) {
    assert.equal(c.is_serious, c.rider.potentiale >= 4.5, "is_serious afledes af potentiale");
  }
  for (const c of out) {
    const age = REF_YEAR - Number(c.rider.birthdate.slice(0, 4));
    assert.ok(age >= 16 && age <= 21, `alder ${age}`);
    assert.equal(c.rider.pcm_id, null);
    assert.equal(c.rider.is_academy, false, "kandidat er endnu ikke signet");
    assert.equal(c.rider.team_id ?? null, null, "kandidat er ikke ejet endnu");
    assert.ok(c.rider.firstname && c.rider.lastname);
    // #3458 fase 2: stats er IKKE længere universelt lave — den boostede
    // signatur-stat (arketype-prior) kan lovligt nå helt op mod 99 (se
    // "akademi-kandidat har et anlæg"-testen nedenfor for det specifikke krav).
    // Her tjekkes kun den generelle skema-sanitet: alle 14 PCM-stats er heltal i
    // det lovlige 0-99-bånd.
    for (const k of STAT_KEYS) {
      assert.ok(Number.isInteger(c.rider[k]), `${k}=${c.rider[k]} skal være et heltal`);
      assert.ok(c.rider[k] >= 0 && c.rider[k] <= 99, `${k}=${c.rider[k]} uden for [0,99]`);
    }
  }
});

test("determinisme: samme seed → samme kuld", () => {
  const a = generateAcademyCandidates({ rng: makeRng(7), referenceYear: REF_YEAR, existingNames: new Set() });
  const b = generateAcademyCandidates({ rng: makeRng(7), referenceYear: REF_YEAR, existingNames: new Set() });
  assert.deepEqual(a.map((c) => c.rider.firstname), b.map((c) => c.rider.firstname));
});

// ─── #2064 S0: count/serious-overrides (søndags-drip) ──────────────────────────

test("countOverride=2 giver præcis 2 kandidater", () => {
  const out = generateAcademyCandidates({
    rng: makeRng(42),
    referenceYear: REF_YEAR,
    existingNames: new Set(),
    countOverride: 2,
  });
  assert.equal(out.length, 2);
});

test("drawPotentiale: geometrisk fordeling — monotont faldende og topstyret", () => {
  const rng = makeRng(20640719);
  const counts = new Map();
  const N = 200000;
  for (let i = 0; i < N; i++) {
    const p = drawPotentiale(rng);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  // Monotont faldende over tiers
  for (let k = 1; k < POTENTIALE_TIERS.length; k++) {
    const prev = counts.get(POTENTIALE_TIERS[k - 1]) ?? 0;
    const cur = counts.get(POTENTIALE_TIERS[k]) ?? 0;
    assert.ok(cur < prev, `tier ${POTENTIALE_TIERS[k]} (${cur}) skal være sjældnere end ${POTENTIALE_TIERS[k - 1]} (${prev})`);
  }
  // Toppen: P(6.0) ≈ 0.114% — accepter 0.05%-0.2% ved N=200k
  const p6 = (counts.get(6) ?? 0) / N;
  assert.ok(p6 > 0.0005 && p6 < 0.002, `P(6.0)=${(p6 * 100).toFixed(3)}% uden for [0.05%, 0.2%]`);
  // Bunden: P(1.0) ≈ 45%
  const p1 = (counts.get(1) ?? 0) / N;
  assert.ok(p1 > 0.42 && p1 < 0.48, `P(1.0)=${(p1 * 100).toFixed(1)}% uden for [42%, 48%]`);
});

test("generateAcademyCandidates: is_serious afledes af potentiale (>= 4.5)", () => {
  const rng = makeRng(99);
  for (let i = 0; i < 50; i++) {
    const cands = generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: new Set(), countOverride: 2 });
    for (const c of cands) assert.equal(c.is_serious, c.rider.potentiale >= 4.5);
  }
});

test("uden overrides er adfærden uændret (3-5 kandidater)", () => {
  const out = generateAcademyCandidates({
    rng: makeRng(42),
    referenceYear: REF_YEAR,
    existingNames: new Set(),
  });
  assert.ok(out.length >= 3 && out.length <= 5, `antal ${out.length}`);
});

test("nation-bias: identityBasis vægter dominant_nationality højere", () => {
  let dkBiased = 0, dkPlain = 0;
  for (let i = 0; i < 40; i++) {
    dkBiased += generateAcademyCandidates({ rng: makeRng(i), referenceYear: REF_YEAR, existingNames: new Set(),
      identityBasis: { dominant_nationality: "DK" } }).filter((c) => c.rider.nationality_code === "DK").length;
    dkPlain += generateAcademyCandidates({ rng: makeRng(i), referenceYear: REF_YEAR, existingNames: new Set() })
      .filter((c) => c.rider.nationality_code === "DK").length;
  }
  assert.ok(dkBiased > dkPlain, `biased ${dkBiased} skal > plain ${dkPlain}`);
});

// #3458 fase 2 (7/8) krævede her `climbing >= 70` på en 16-ÅRIG — og det var præcis
// den assertion der lod #3561 slippe i produktion: evne 70+ på en teenager er over
// spillets 50 dyreste ryttere (snit 80) og langt over senior-medianen (21). Testen
// hævdede at måle SEPARATION, men målte i virkeligheden absolut STYRKE.
//
// Omskrevet 2026-08-09: separationen skal stadig være der — den er reel og nødvendig —
// men INDEN FOR ungdomsbåndet (afledt top ~12, #2064's ejer-godkendte anker). En
// signatur-evne der topper båndet mens den dæmpede modsat-evne ligger i bunden ER
// separation; at hæve begge til voksen-niveau er ikke.
test("generateYouthStats: 16-årig climber → signatur-evnen (climbing) adskiller sig fra den dæmpede modsat-evne (sprint) INDEN FOR ungdomsbåndet", () => {
  const rng = makeRng(2026);
  const { stats, archetypeType } = generateYouthStats({ rng, age: 16, potentiale: 6, archetypeType: "climber" });
  const rider = { id: "y1", birthdate: "2010-06-15", potentiale: 6, height: 175, weight: 60, ...stats };
  const abil = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
  assert.ok(abil.climbing >= 10, `climbing ${abil.climbing} skal ligge i toppen af ungdomsbåndet (signatur, RIDER_TYPES-vægt 3)`);
  assert.ok(abil.climbing <= 15, `climbing ${abil.climbing} må IKKE forlade ungdomsbåndet — en 16-årig må ikke starte over senior-medianen (#3561)`);
  assert.ok(abil.sprint <= 5, `sprint ${abil.sprint} skal være tydeligt dæmpet (climber's eneste negative vægt)`);
  assert.ok(abil.climbing - abil.sprint >= 8, `separation ${abil.climbing - abil.sprint} skal være tydelig inden for båndet`);
  assert.equal(archetypeType, "climber");
});

test("generateYouthStats: 19-årig fødes stærkere end 16-årig (alders-skalering)", () => {
  const young = generateYouthStats({ rng: makeRng(5), age: 16, potentiale: 5, archetypeType: "sprinter" });
  const older = generateYouthStats({ rng: makeRng(5), age: 19, potentiale: 5, archetypeType: "sprinter" });
  const sum = (s) => Object.values(s.stats).reduce((a, b) => a + b, 0);
  assert.ok(sum(older) > sum(young), `19-årig ${sum(older)} skal > 16-årig ${sum(young)}`);
});

// #3458 fase 2 krævede her `maxStat >= 60`, dvs. at rå stats SKULLE bryde ungdoms-
// loftet (54) — assertionen håndhævede altså aktivt den regression der ramte prod 9/8.
// Omskrevet 2026-08-09 (#3561) til den modsatte, korrekte invariant: INGEN rå stat må
// overstige statCeil, og signaturen viser sig ved at ramme TOPPEN af båndet.
test("akademi-kandidat holder sig i ungdoms-båndet, med signaturen i toppen", () => {
  const out = generateAcademyCandidates({ rng: makeRng(2026), referenceYear: REF_YEAR, existingNames: new Set() });
  const allStatKeys = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_sp","stat_acc","stat_udh","stat_mod","stat_res","stat_ftr","stat_bro"];
  for (const c of out) {
    const maxStat = Math.max(...allStatKeys.map((k) => c.rider[k]));
    assert.ok(
      maxStat <= YOUTH_GEN_CONFIG.statCeil,
      `rå stat ${maxStat} over ungdoms-loftet ${YOUTH_GEN_CONFIG.statCeil} — start-evnen ville løfte ability_caps over potentiale-loftet (#3561)`
    );
    // Signaturen skal stadig VÆRE der: mindst én stat i toppen af båndet.
    assert.ok(maxStat >= YOUTH_GEN_CONFIG.statCeil - 2, `max stat ${maxStat} viser intet anlæg — signatur-boostet virker ikke`);
  }
});

test("generateYouthStats: høj-potentiale TENDERER mod stærkere start (gns), men overlapper", () => {
  const archetypes = ["climber","sprinter","tt","gc","puncheur","brostensrytter","rouleur","baroudeur"];
  const avgTop = (pot) => {
    let sum = 0, n = 0;
    for (const a of archetypes) for (let s = 0; s < 40; s++) {
      const { stats } = generateYouthStats({ rng: makeRng(s * 97 + 3), age: 16, potentiale: pot, archetypeType: a });
      sum += Math.max(...Object.values(stats)); n++;
    }
    return sum / n;
  };
  assert.ok(avgTop(6) > avgTop(2), "pot6 skal i snit starte stærkere end pot2");
});

// #1791-hul-garden OMDEFINERET 2026-07-19 (ejer-valg "−3", #2064 S0): 16-årige STARTER
// nu bevidst med afledte evner helt ned til ~1 (rå talenter langt under senior-niveau),
// så den gamle "≤3 = hul"-grænse er ikke længere kontrakten. Det testen reelt skal
// beskytte: ingen MANGLENDE/0/ugyldige evner (ægte datahuller), og profilen må ikke
// kollapse totalt (bedste anlæg for et top-talent skal stadig være mærkbart > bund).
test("generateYouthStats: 16-årig kohorte har ingen ÆGTE datahuller (evne mangler/0) og profilen bevarer signal", () => {
  const PHYS = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
  const archetypes = ["climber","sprinter","tt","gc","puncheur","brostensrytter","rouleur","baroudeur"];
  let dataHoles = 0;
  let pot6BestSum = 0;
  let pot6N = 0;
  for (const a of archetypes) for (let s = 0; s < 40; s++) {
    const pot = (s % 6) + 1;
    const { stats } = generateYouthStats({ rng: makeRng(s * 13 + 1), age: 16, potentiale: pot, archetypeType: a });
    const rider = { id: `c${s}`, birthdate: "2010-06-15", potentiale: pot, height: 175, weight: 62, ...stats };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
    dataHoles += PHYS.filter((k) => !Number.isFinite(ab[k]) || ab[k] < 1).length;
    if (pot === 6) {
      pot6BestSum += Math.max(...PHYS.map((k) => ab[k]));
      pot6N += 1;
    }
  }
  assert.equal(dataHoles, 0, `forventede 0 ægte datahuller (mangler/<1), fandt ${dataHoles}`);
  assert.ok(pot6BestSum / pot6N >= 5, `pot-6-talenter skal i snit have bedste anlæg ≥5 (signal bevaret), fik ${(pot6BestSum / pot6N).toFixed(1)}`);
});
