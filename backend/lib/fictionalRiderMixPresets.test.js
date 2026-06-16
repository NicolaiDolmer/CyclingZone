import test from "node:test";
import assert from "node:assert/strict";

import {
  MIX_PRESETS,
  MIX_PRESET_NAMES,
  resolveMix,
} from "./fictionalRiderMixPresets.js";
import {
  generateFictionalRiders,
  DEFAULT_TIER_TYPE_WEIGHTS,
} from "./fictionalRiderGenerator.js";

const REF_YEAR = 2026;
const countByArchetype = (riders) => {
  const by = {};
  for (const r of riders) by[r._meta.archetype] = (by[r._meta.archetype] || 0) + 1;
  return by;
};

// ── Preset-katalog ────────────────────────────────────────────────────────────

test("alle 6 aftalte presets findes", () => {
  for (const name of ["default", "random", "sprint-heavy", "climb-heavy", "elite-dense", "balanced"]) {
    assert.ok(MIX_PRESETS[name], `mangler preset ${name}`);
    assert.ok(MIX_PRESET_NAMES.includes(name), `${name} mangler i MIX_PRESET_NAMES`);
  }
});

test("ukendt preset kaster med liste over gyldige navne", () => {
  assert.throws(() => resolveMix("does-not-exist"), (err) => {
    assert.match(err.message, /does-not-exist/);
    assert.match(err.message, /sprint-heavy/); // listen vises
    return true;
  });
});

// ── default + random = ingen komposition-override ─────────────────────────────

test("default resolver til ingen override (uændret adfærd)", () => {
  const mix = resolveMix("default");
  assert.equal(mix.tierFractions ?? null, null);
  assert.equal(mix.tierTypeWeights ?? null, null);
});

test("random resolver til ingen override (kun seed-variation)", () => {
  const mix = resolveMix("random");
  assert.equal(mix.tierFractions ?? null, null);
  assert.equal(mix.tierTypeWeights ?? null, null);
});

// ── Type-skews ────────────────────────────────────────────────────────────────

test("sprint-heavy hæver sprinter-vægten (×3) i alle tiers", () => {
  const mix = resolveMix("sprint-heavy");
  const { tierTypeWeights } = mix;
  assert.ok(tierTypeWeights, "skal sætte tierTypeWeights");
  assert.equal(mix.tierFractions ?? null, null, "sprint-heavy rører ikke tier-fraktioner");
  for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
    if (weights.sprinter != null) {
      assert.equal(tierTypeWeights[tier].sprinter, weights.sprinter * 3,
        `${tier}.sprinter forventet ×3`);
    }
  }
});

test("climb-heavy hæver climber (×2) og gc (×2)", () => {
  const { tierTypeWeights } = resolveMix("climb-heavy");
  for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
    if (weights.climber != null) assert.equal(tierTypeWeights[tier].climber, weights.climber * 2);
    if (weights.gc != null) assert.equal(tierTypeWeights[tier].gc, weights.gc * 2);
  }
});

test("balanced flader vægtene (alle typer i en tier lige)", () => {
  const { tierTypeWeights } = resolveMix("balanced");
  for (const weights of Object.values(tierTypeWeights)) {
    const vals = Object.values(weights);
    assert.ok(vals.length > 0);
    assert.ok(vals.every((w) => w === vals[0]), "alle vægte i en tier skal være lige");
  }
  // Bevarer per-tier type-sættet (ingen leadout i superstar-tieren).
  assert.deepEqual(
    Object.keys(tierTypeWeights.superstar).sort(),
    Object.keys(DEFAULT_TIER_TYPE_WEIGHTS.superstar).sort(),
  );
});

// ── Tier-fraktion-skew ────────────────────────────────────────────────────────

test("elite-dense sætter tier-fraktioner (flere superstars), ikke type-vægte", () => {
  const { tierFractions, tierTypeWeights } = resolveMix("elite-dense");
  assert.ok(tierFractions, "skal sætte tierFractions");
  assert.equal(tierTypeWeights ?? null, null, "elite-dense rører ikke type-vægte");
  assert.ok(tierFractions.superstar > 0.015, "superstar-andel skal være hævet over default 1.5%");
});

// ── End-to-end: presets påvirker faktisk feltet via generatoren ───────────────

test("sprint-heavy giver markant flere sprintere end default (end-to-end)", () => {
  const opts = { seed: 2026, count: 800, referenceYear: REF_YEAR };
  const base = countByArchetype(generateFictionalRiders({ ...opts, ...resolveMix("default") }).riders);
  const sprint = countByArchetype(generateFictionalRiders({ ...opts, ...resolveMix("sprint-heavy") }).riders);
  assert.ok((sprint.sprinter || 0) > (base.sprinter || 0) + 50,
    `sprint-heavy ${sprint.sprinter} skal >> default ${base.sprinter}`);
});

test("elite-dense giver markant flere superstars end default (end-to-end)", () => {
  const opts = { seed: 2026, count: 800, referenceYear: REF_YEAR };
  const countTier = (riders) => riders.filter((r) => r._meta.tier === "superstar").length;
  const base = countTier(generateFictionalRiders({ ...opts, ...resolveMix("default") }).riders);
  const dense = countTier(generateFictionalRiders({ ...opts, ...resolveMix("elite-dense") }).riders);
  assert.ok(dense > base * 2, `elite-dense ${dense} superstars skal >> default ${base}`);
});
