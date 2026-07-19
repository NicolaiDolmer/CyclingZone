import test from "node:test";
import assert from "node:assert/strict";
import { generateStaffCandidates, STAFF_NAME_POOL } from "./staffCandidates.js";
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
    assert.ok(STAFF_NAME_POOL.includes(c.name));
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

// ── #2643-opfølgning: navnepulje-udvidelse mod cross-team-kollisioner ──

test("STAFF_NAME_POOL er stor nok, unik og velformet", () => {
  // 40 navne gav ~78% kollisionsrate i prod (60 staff-rows, 40 hold). Puljen skal
  // holde trit med en liga på ~40-60 hold — gulvet er 120 så en fremtidig trim
  // ikke stille genindfører problemet.
  assert.ok(STAFF_NAME_POOL.length >= 120, `pool er ${STAFF_NAME_POOL.length}, skal være >= 120`);
  assert.equal(new Set(STAFF_NAME_POOL).size, STAFF_NAME_POOL.length, "dubletter i puljen");
  for (const name of STAFF_NAME_POOL) {
    assert.equal(name, name.trim());
    assert.ok(/^\S+.* \S+/.test(name), `"${name}" ligner ikke "Fornavn Efternavn"`);
  }
});

test("cross-team-kollisionsrate ved prod-skala er markant under gammel pulje", () => {
  // Prod-lignende scenarie: 40 hold, ~60 ansættelser (alle hyrer training, hver 2.
  // også scouting), hire = kandidat[0]. Deterministisk (faste seeds) → stabil rate.
  // Gammel 40-navns-pulje målte 75% kolliderende rows her (sim 2026-07-18, matcher
  // de 78% observeret i prod); 150-puljen måler 35%. Grænsen 50% er regression-guard
  // med margin — bider hvis puljen skrumper eller trækket skævvrides.
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
  assert.ok(rate < 0.5, `kollisionsrate ${(rate * 100).toFixed(1)}% (${collidingRows}/${hires.length}) — forventet < 50%`);
});

test("topSpecialization = etiket på den højest-scorende SKILL-akse (dimension/rolle) — #2695: levels (u23/senior alders-fokus) er udelukket, kan aldrig vinde", () => {
  for (const c of generateStaffCandidates(ARGS)) {
    const p = deriveStaffAbilities({ role: c.role, tier: c.tier, name: c.name });
    const axes = { ...p.dimensions, ...p.roleSkills };
    const maxVal = Math.max(...Object.values(axes));
    assert.equal(axes[c.topSpecialization], maxVal, "top-spec skal pege på maks-skill-aksen");
    assert.ok(!["u23", "senior"].includes(c.topSpecialization),
      "top-spec må aldrig pege på et levels-bånd (u23/senior)");
  }
});
