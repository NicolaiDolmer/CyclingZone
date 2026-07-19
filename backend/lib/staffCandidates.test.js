import test from "node:test";
import assert from "node:assert/strict";
import { generateStaffCandidates, STAFF_NAME_COMBINATION_COUNT } from "./staffCandidates.js";
import { staffSalaryFor } from "./facilityConstants.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";

const ARGS = { teamId: "11111111-1111-1111-1111-111111111111", seasonNumber: 3, role: "training", facilityTier: 3 };

test("genererer 3 kandidater, deterministisk på samme seed", () => {
  const a = generateStaffCandidates(ARGS);
  const b = generateStaffCandidates(ARGS);
  assert.equal(a.length, 3);
  assert.deepEqual(a, b); // ingen reroll ved refresh
});

test("kandidat-tiers overstiger aldrig facilitets-tier og salary er rating-drevet (Q1)", () => {
  for (const c of generateStaffCandidates(ARGS)) {
    assert.ok(c.tier >= 1 && c.tier <= 3);
    assert.equal(typeof c.name, "string");
    assert.ok(/^\S+.* \S+$/.test(c.name), `"${c.name}" ligner ikke "Fornavn Efternavn"`);
    assert.ok(c.salary > 0);
    // #2216 A4 (Q1): løn = staffSalaryFor(overall), ikke den flade tier-tabel.
    assert.equal(c.salary, staffSalaryFor(c.overall));
  }
});

test("forskellige seeds giver (som regel) forskellige kandidater", () => {
  const other = generateStaffCandidates({ ...ARGS, seasonNumber: 4 });
  assert.notDeepEqual(generateStaffCandidates(ARGS), other);
});

// ── #2216 A4: kandidater beriges med overall + topSpecialization til visning ──

test("kandidater har overall (fra derivation) + topSpecialization, deterministisk", () => {
  const cands = generateStaffCandidates(ARGS);
  for (const c of cands) {
    const profile = deriveStaffAbilities({ role: c.role, tier: c.tier, name: c.name });
    assert.equal(c.overall, profile.overall, "overall skal matche derivation");
    assert.equal(typeof c.topSpecialization, "string");
    assert.ok(c.topSpecialization.length > 0);
  }
  // Deterministisk: samme seed → samme berigede felter.
  assert.deepEqual(generateStaffCandidates(ARGS), cands);
});

// ── #2657 (opfølgning på #2643/#2658): fast liste → fornavn×efternavn-kombinatorik ──
// #2658 udvidede den faste STAFF_NAME_POOL 40→150 (stadig et hårdt loft, ~35%
// kollisionsrate ved prod-skala). #2657 erstatter listen med kombinatorik fra
// NAME_CLUSTERS (samme kilde som rytter-generatoren) — se kommentar i
// staffCandidates.js for regnestykket.

test("kombinationsrummet er markant større end den gamle 150-navns-pulje", () => {
  // Gulv med solid margin: en fremtidig trimning af NAME_CLUSTERS skal ikke
  // stille genindføre birthday-paradox-problemet (regression-guard).
  assert.ok(
    STAFF_NAME_COMBINATION_COUNT >= 2000,
    `kombinationsrum er ${STAFF_NAME_COMBINATION_COUNT}, skal være >= 2000`,
  );
});

test("cross-team-kollisionsrate ved prod-skala (60 ansættelser) er ~0, markant under gammel pulje", () => {
  // Samme scenarie som #2658-regressionstesten: 40 hold, ~60 ansættelser (alle
  // hyrer training, hver 2. også scouting), hire = kandidat[0]. Deterministisk
  // (faste seeds) → stabil rate. Gammel 40-navns-pulje: 75%; 150-pulje: 35%.
  // Kombinatorik (7k+ kombinationer): målt 0% i sim (2026-07-19). Grænsen 10% er
  // regression-guard med rigelig margin.
  const hires = [];
  for (let t = 0; t < 40; t++) {
    const teamId = `00000000-0000-4000-8000-${String(t).padStart(12, "0")}`;
    const roles = t % 2 === 0 ? ["training", "scouting"] : ["training"];
    for (const role of roles) {
      const [first] = generateStaffCandidates({ teamId, seasonNumber: 3, role, facilityTier: 3 });
      hires.push({ team: teamId, name: first.name });
    }
  }
  const teamsByName = new Map();
  for (const h of hires) {
    if (!teamsByName.has(h.name)) teamsByName.set(h.name, new Set());
    teamsByName.get(h.name).add(h.team);
  }
  const collidingRows = hires.filter((h) => teamsByName.get(h.name).size >= 2).length;
  const rate = collidingRows / hires.length;
  assert.ok(rate < 0.1, `kollisionsrate ${(rate * 100).toFixed(1)}% (${collidingRows}/${hires.length}) — forventet < 10%`);
});

test("kollisionssandsynlighed forbliver lav (nær nul) selv ved 200+ staff (issuets mål)", () => {
  // 40 hold × alle 5 roller = 200 ansættelser — issuets eksplicitte skala-mål.
  const hires = [];
  for (let t = 0; t < 40; t++) {
    const teamId = `00000000-0000-4000-8000-${String(t).padStart(12, "0")}`;
    for (const role of ["training", "scouting", "medical", "academy", "commercial"]) {
      const [first] = generateStaffCandidates({ teamId, seasonNumber: 3, role, facilityTier: 3 });
      hires.push({ team: teamId, name: first.name });
    }
  }
  assert.equal(hires.length, 200);
  const teamsByName = new Map();
  for (const h of hires) {
    if (!teamsByName.has(h.name)) teamsByName.set(h.name, new Set());
    teamsByName.get(h.name).add(h.team);
  }
  const collidingRows = hires.filter((h) => teamsByName.get(h.name).size >= 2).length;
  const rate = collidingRows / hires.length;
  // Sim (2026-07-19) målte 5% ved 200 hires (7272 kombinationer) — grænsen 15% er
  // regression-guard med margin, langt under den gamle puljes 75-78%.
  assert.ok(rate < 0.15, `kollisionsrate ${(rate * 100).toFixed(1)}% (${collidingRows}/${hires.length}) — forventet < 15%`);
});

test("topSpecialization = etiket på den højest-scorende akse (dimension/niveau/rolle)", () => {
  for (const c of generateStaffCandidates(ARGS)) {
    const p = deriveStaffAbilities({ role: c.role, tier: c.tier, name: c.name });
    const axes = { ...p.dimensions, ...p.levels, ...p.roleSkills };
    const maxVal = Math.max(...Object.values(axes));
    assert.equal(axes[c.topSpecialization], maxVal, "top-spec skal pege på maks-aksen");
  }
});
