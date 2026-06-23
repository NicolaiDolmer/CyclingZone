import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "./fictionalRiderGenerator.js";
import { generateAcademyCandidates, generateYouthStats } from "./academyGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities } from "./abilityDerivation.js";

const REF_YEAR = 2026;

test("generateAcademyCandidates: 3-5 kandidater, 1-3 seriøse, alder 16-21", () => {
  const rng = makeRng(2026);
  const out = generateAcademyCandidates({ rng, referenceYear: REF_YEAR, existingNames: new Set() });
  assert.ok(out.length >= 3 && out.length <= 5, `antal ${out.length}`);
  const serious = out.filter((c) => c.is_serious).length;
  assert.ok(serious >= 1 && serious <= 3, `seriøse ${serious}`);
  for (const c of out) {
    const age = REF_YEAR - Number(c.rider.birthdate.slice(0, 4));
    assert.ok(age >= 16 && age <= 21, `alder ${age}`);
    assert.equal(c.rider.pcm_id, null);
    assert.equal(c.rider.is_academy, false, "kandidat er endnu ikke signet");
    assert.equal(c.rider.team_id ?? null, null, "kandidat er ikke ejet endnu");
    assert.ok(c.rider.firstname && c.rider.lastname);
    for (const k of ["stat_fl", "stat_sp", "stat_bj"]) assert.ok(c.rider[k] >= 50 && c.rider[k] <= 62);
  }
});

test("determinisme: samme seed → samme kuld", () => {
  const a = generateAcademyCandidates({ rng: makeRng(7), referenceYear: REF_YEAR, existingNames: new Set() });
  const b = generateAcademyCandidates({ rng: makeRng(7), referenceYear: REF_YEAR, existingNames: new Set() });
  assert.deepEqual(a.map((c) => c.rider.firstname), b.map((c) => c.rider.firstname));
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

test("generateYouthStats: 16-årig climber → afledt top ~15, bund ~7, ingen evne >25", () => {
  const rng = makeRng(2026);
  const { stats, archetypeType } = generateYouthStats({ rng, age: 16, potentiale: 6, archetypeType: "climber" });
  const rider = { id: "y1", birthdate: "2010-06-15", potentiale: 6, height: 175, weight: 60, ...stats };
  const abil = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
  const phys = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
  const vals = phys.map((k) => abil[k]);
  const top = Math.max(...vals), bottom = Math.min(...vals);
  assert.ok(top <= 25, `top-evne ${top} skal være lav for en 16-årig`);
  assert.ok(bottom >= 1, `bund ${bottom}`);
  assert.equal(archetypeType, "climber");
});

test("generateYouthStats: 19-årig fødes stærkere end 16-årig (alders-skalering)", () => {
  const young = generateYouthStats({ rng: makeRng(5), age: 16, potentiale: 5, archetypeType: "sprinter" });
  const older = generateYouthStats({ rng: makeRng(5), age: 19, potentiale: 5, archetypeType: "sprinter" });
  const sum = (s) => Object.values(s.stats).reduce((a, b) => a + b, 0);
  assert.ok(sum(older) > sum(young), `19-årig ${sum(older)} skal > 16-årig ${sum(young)}`);
});

test("akademi-kandidat har et anlæg (boostet signatur-stat) og lave stats", () => {
  const out = generateAcademyCandidates({ rng: makeRng(2026), referenceYear: REF_YEAR, existingNames: new Set() });
  for (const c of out) {
    const maxStat = Math.max(...["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_sp","stat_acc","stat_udh","stat_mod","stat_res"].map((k) => c.rider[k]));
    assert.ok(maxStat <= 62, `max stat ${maxStat} skal være i ungdoms-båndet`);
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

test("generateYouthStats: 16-årig kohorte har INGEN huller (afledt evne ≤3)", () => {
  const PHYS = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
  const archetypes = ["climber","sprinter","tt","gc","puncheur","brostensrytter","rouleur","baroudeur"];
  let holes = 0;
  for (const a of archetypes) for (let s = 0; s < 40; s++) {
    const { stats } = generateYouthStats({ rng: makeRng(s * 13 + 1), age: 16, potentiale: (s % 6) + 1, archetypeType: a });
    const rider = { id: `c${s}`, birthdate: "2010-06-15", potentiale: (s % 6) + 1, height: 175, weight: 62, ...stats };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
    holes += PHYS.filter((k) => (ab[k] ?? 0) <= 3).length;
  }
  assert.equal(holes, 0, `forventede 0 huller (≤3), fandt ${holes}`);
});
