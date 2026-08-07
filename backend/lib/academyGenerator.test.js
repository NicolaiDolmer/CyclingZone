import test from "node:test";
import assert from "node:assert/strict";
import { makeRng, STAT_KEYS } from "./fictionalRiderGenerator.js";
import { generateAcademyCandidates, generateYouthStats, drawPotentiale, POTENTIALE_TIERS } from "./academyGenerator.js";
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

// #3458 fase 2 (revideret 7/8): FØR denne PR var 16-årige universelt svage (top
// afledt evne <=25, ingen reel separation) — netop DERFOR kunne klassifikatoren
// aldrig genfinde det trukne anlæg (G1). Nu skal signatur-evnen (climbing for
// climber) skille sig markant ud fra en dæmpet modsat-evne (sprint, climber's
// eneste negative RIDER_TYPES-vægt) SELV ved 16 år — det ER separationen G1
// kræver. Se simArchetypeGeneration3458.js for den fulde G1-G4-måling.
test("generateYouthStats: 16-årig climber → signatur-evnen (climbing) adskiller sig markant fra den dæmpede modsat-evne (sprint)", () => {
  const rng = makeRng(2026);
  const { stats, archetypeType } = generateYouthStats({ rng, age: 16, potentiale: 6, archetypeType: "climber" });
  const rider = { id: "y1", birthdate: "2010-06-15", potentiale: 6, height: 175, weight: 60, ...stats };
  const abil = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
  assert.ok(abil.climbing >= 70, `climbing ${abil.climbing} skal være tydeligt boostet (signatur, RIDER_TYPES-vægt 3)`);
  assert.ok(abil.sprint <= 10, `sprint ${abil.sprint} skal være tydeligt dæmpet (climber's eneste negative vægt)`);
  assert.ok(abil.climbing - abil.sprint >= 50, `separation ${abil.climbing - abil.sprint} skal være markant`);
  assert.equal(archetypeType, "climber");
});

test("generateYouthStats: 19-årig fødes stærkere end 16-årig (alders-skalering)", () => {
  const young = generateYouthStats({ rng: makeRng(5), age: 16, potentiale: 5, archetypeType: "sprinter" });
  const older = generateYouthStats({ rng: makeRng(5), age: 19, potentiale: 5, archetypeType: "sprinter" });
  const sum = (s) => Object.values(s.stats).reduce((a, b) => a + b, 0);
  assert.ok(sum(older) > sum(young), `19-årig ${sum(older)} skal > 16-årig ${sum(young)}`);
});

// #3458 fase 2: signatur-stat(s) må nu legitimt nå det HØJERE loft
// (statCeilBoosted=99) — det er selve pointen (separation for G1). Testen
// beskytter i stedet det der STADIG skal holde: mindst én stat rammer det høje
// bånd (beviser boostet virker), og de IKKE-boostede stats forbliver i det
// oprindelige lave −3-bånd (statCeil=54).
test("akademi-kandidat har et anlæg: mindst én stat boostes højt, resten forbliver i ungdoms-båndet", () => {
  const out = generateAcademyCandidates({ rng: makeRng(2026), referenceYear: REF_YEAR, existingNames: new Set() });
  const allStatKeys = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_sp","stat_acc","stat_udh","stat_mod","stat_res","stat_ftr","stat_bro"];
  for (const c of out) {
    const maxStat = Math.max(...allStatKeys.map((k) => c.rider[k]));
    assert.ok(maxStat >= 60, `max stat ${maxStat} skal vise et boostet anlæg`);
    // Ikke ALLE stats må være boostede — mindst nogle skal forblive under det
    // gamle, ikke-boostede loft (54) plus lidt gaussian-støj-margin (en hybrid
    // kan have flere boostede nøgler end et rent anlæg, så tærsklen er løs).
    const belowCeil = allStatKeys.filter((k) => c.rider[k] <= 56);
    assert.ok(belowCeil.length >= 3, `for mange stats boostet: kun ${belowCeil.length}/${allStatKeys.length} under det lave bånd`);
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
