import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "./fictionalRiderGenerator.js";
import { generateAcademyCandidates } from "./academyGenerator.js";

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
    for (const k of ["stat_fl", "stat_sp", "stat_bj"]) assert.ok(c.rider[k] >= 40 && c.rider[k] <= 85);
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
