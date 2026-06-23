import test from "node:test";
import assert from "node:assert/strict";

import {
  generateFictionalRiders,
  makeRng,
  STAT_KEYS,
  toInsertPayload,
  DEFAULT_TIER_FRACTIONS,
  DEFAULT_TIER_TYPE_WEIGHTS,
  ARCHETYPES,
  ARCHETYPE_BY_TYPE,
} from "./fictionalRiderGenerator.js";
import { foldNameNordic } from "./pcmRiderMatcher.js";

const REF_YEAR = 2026;
const FORBIDDEN_FIELDS = ["id", "price", "market_value", "salary", "team_id", "ai_team_id", "prize_earnings_bonus"];

function gen(opts = {}) {
  return generateFictionalRiders({ seed: 42, count: 100, referenceYear: REF_YEAR, ...opts });
}

// ── Determinisme ──────────────────────────────────────────────────────────────

test("samme seed → identisk output (determinisme)", () => {
  const a = gen();
  const b = gen();
  assert.deepEqual(a.riders, b.riders);
});

test("forskellig seed → forskelligt output", () => {
  const a = gen({ seed: 1 });
  const b = gen({ seed: 2 });
  assert.notDeepEqual(a.riders, b.riders);
});

test("makeRng er deterministisk og i [0,1)", () => {
  const r1 = makeRng(7);
  const r2 = makeRng(7);
  for (let i = 0; i < 50; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

// ── Kontrakt: hvad må/ikke må sættes ──────────────────────────────────────────

test("count respekteres", () => {
  assert.equal(gen({ count: 37 }).riders.length, 37);
});

test("pcm_id er ALTID null (egen-rytter-markør)", () => {
  for (const r of gen().riders) assert.equal(r.pcm_id, null);
});

test("generated-/auto-kolonner sættes ALDRIG", () => {
  for (const r of gen().riders) {
    for (const f of FORBIDDEN_FIELDS) {
      assert.equal(r[f], undefined, `feltet ${f} må ikke være sat`);
    }
  }
});

test("NOT NULL-felter er udfyldt", () => {
  for (const r of gen().riders) {
    assert.equal(typeof r.firstname, "string");
    assert.ok(r.firstname.length > 0);
    assert.equal(typeof r.lastname, "string");
    assert.ok(r.lastname.length > 0);
  }
});

// ── Feltværdier ───────────────────────────────────────────────────────────────

test("nationality_code er gyldig ISO2 (to store bogstaver)", () => {
  for (const r of gen().riders) assert.match(r.nationality_code, /^[A-Z]{2}$/);
});

test("alle 14 stats til stede som heltal i [50,85] (ægte PCM-skala)", () => {
  for (const r of gen().riders) {
    for (const key of STAT_KEYS) {
      assert.equal(typeof r[key], "number");
      assert.ok(Number.isInteger(r[key]), `${key} skal være heltal`);
      assert.ok(r[key] >= 50 && r[key] <= 85, `${key}=${r[key]} uden for [50,85]`);
    }
  }
});

// Forward-guard (#1122): den ægte PCM-skala er HÅRDT [50,85]; en fiktiv stat
// udenfor ville clampe evnerne til 1/99 ved kilden (abilityDerivation.js). Stor
// N fanger sjældne gaussiske haler som en 100-rytter-batch kan misse.
test("stat-skala holder [50,85] over stor population (forward-guard)", () => {
  const { riders } = generateFictionalRiders({ seed: 999, count: 3000, referenceYear: REF_YEAR });
  let min = Infinity;
  let max = -Infinity;
  for (const r of riders) {
    for (const key of STAT_KEYS) {
      if (r[key] < min) min = r[key];
      if (r[key] > max) max = r[key];
    }
  }
  assert.ok(min >= 50, `mindste stat ${min} < 50`);
  assert.ok(max <= 85, `største stat ${max} > 85`);
});

test("birthdate er YYYY-MM-DD og is_u25 er konsistent", () => {
  for (const r of gen().riders) {
    assert.match(r.birthdate, /^\d{4}-\d{2}-\d{2}$/);
    const birthYear = Number(r.birthdate.slice(0, 4));
    assert.equal(r.is_u25, birthYear > REF_YEAR - 25);
    const age = REF_YEAR - birthYear;
    assert.ok(age >= 18 && age <= 39, `urealistisk alder ${age}`);
  }
});

test("potentiale er 0.5-trin i [1.0, 6.0]", () => {
  for (const r of gen().riders) {
    assert.ok(r.potentiale >= 1.0 && r.potentiale <= 6.0);
    assert.equal((r.potentiale * 2) % 1, 0, "skal være multiplum af 0.5");
  }
});

test("height/weight er realistiske og uci_points >= 1", () => {
  for (const r of gen().riders) {
    assert.ok(r.height >= 165 && r.height <= 196);
    assert.ok(r.weight >= 50 && r.weight <= 100);
    assert.ok(r.uci_points >= 1);
  }
});

// ── Navne-unikhed (§3-fælden) ─────────────────────────────────────────────────

test("genererede navne er internt unikke (foldet)", () => {
  const { riders } = gen({ count: 200 });
  const folded = riders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`));
  assert.equal(new Set(folded).size, folded.length, "fandt foldede navne-dubletter");
});

test("respekterer existingFoldedNames — ingen kollision med 'eksisterende' DB-navne", () => {
  const first = gen({ seed: 11, count: 100 });
  const existing = new Set(
    first.riders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)),
  );
  const second = gen({ seed: 22, count: 100, existingFoldedNames: existing });
  for (const r of second.riders) {
    const key = foldNameNordic(`${r.firstname} ${r.lastname}`);
    assert.ok(!existing.has(key), `kolliderede med eksisterende navn: ${key}`);
  }
});

// ── Garanteret nationalitets-repræsentation ───────────────────────────────────

test("garanterede ikke-vestlige nationer er repræsenteret", () => {
  const { riders } = gen({ count: 60 });
  const nats = new Set(riders.map((r) => r.nationality_code));
  for (const iso of ["CN", "JP", "KR", "CO", "DZ", "ER"]) {
    assert.ok(nats.has(iso), `mangler garanteret nation ${iso}`);
  }
});

// ── Arketype ↔ stats korrelerer ───────────────────────────────────────────────

test("arketyper booster signatur-stats over andre arketyper (aggregeret)", () => {
  const { riders } = generateFictionalRiders({ seed: 5, count: 800, referenceYear: REF_YEAR });
  const avg = (archetype, key) => {
    const subset = riders.filter((r) => r._meta.archetype === archetype);
    return subset.reduce((s, r) => s + r[key], 0) / subset.length;
  };
  assert.ok(avg("sprinter", "stat_sp") > avg("climber", "stat_sp") + 5);
  assert.ok(avg("climber", "stat_bj") > avg("sprinter", "stat_bj") + 5);
  assert.ok(avg("tt", "stat_tt") > avg("sprinter", "stat_tt") + 5);
  assert.ok(avg("brostensrytter", "stat_bro") > avg("climber", "stat_bro") + 5);
});

// Rolle-svaghed ON (ejer-beslutning): off-type-stats dæmpes, så typen bliver skarp.
test("rolle-svagheder dæmper off-type-stats (signatur ≫ dæmpet)", () => {
  const { riders } = generateFictionalRiders({ seed: 5, count: 800, referenceYear: REF_YEAR });
  const avg = (archetype, key) => {
    const subset = riders.filter((r) => r._meta.archetype === archetype);
    return subset.reduce((s, r) => s + r[key], 0) / subset.length;
  };
  // climber dæmper stat_sp (sprint) → klart under dens boostede stat_bj (bjerg).
  assert.ok(avg("climber", "stat_bj") > avg("climber", "stat_sp") + 10);
  // sprinter dæmper stat_bj → klart under dens boostede stat_sp.
  assert.ok(avg("sprinter", "stat_sp") > avg("sprinter", "stat_bj") + 10);
});

// ── Tier-kvote (eksakt — løser star-rate-punktet) ─────────────────────────────

test("tier-kvote er eksakt ved launch-skala (12/60/230/498 @ 800)", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const byTier = {};
  for (const r of riders) byTier[r._meta.tier] = (byTier[r._meta.tier] || 0) + 1;
  assert.equal(byTier.superstar, 12);
  assert.equal(byTier.star, 60);
  assert.equal(byTier.solid, 230);
  assert.equal(byTier.domestique, 498);
});

test("tier-kvote summerer altid til count (også ved skæve tal)", () => {
  for (const count of [37, 113, 500, 1234]) {
    const { riders } = generateFictionalRiders({ seed: 3, count, referenceYear: REF_YEAR });
    const total = riders.length;
    assert.equal(total, count);
    const tiers = new Set(riders.map((r) => r._meta.tier));
    assert.ok(tiers.has("domestique"), "domestique-tier (rest) skal altid findes");
  }
});

// ── Type-gulv på sjældne typer (etape-variation) ──────────────────────────────

test("sjældne typer holder globalt gulv (gc≥30, sprinter≥40 @ 800)", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const byType = {};
  for (const r of riders) byType[r._meta.archetype] = (byType[r._meta.archetype] || 0) + 1;
  assert.ok(byType.gc >= 30, `gc=${byType.gc} under gulv 30`);
  assert.ok(byType.sprinter >= 40, `sprinter=${byType.sprinter} under gulv 40`);
  // Alle 8 typer skal være repræsenteret (dybde i hver disciplin).
  for (const t of ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"]) {
    assert.ok((byType[t] || 0) > 0, `type ${t} mangler helt`);
  }
});

// ── Coverage-rapport ──────────────────────────────────────────────────────────

test("coverage rapporterer cluster-fordeling og evt. fallback", () => {
  const { coverage } = gen({ count: 100 });
  const totalByCluster = Object.values(coverage.byCluster).reduce((s, n) => s + n, 0);
  assert.equal(totalByCluster, 100);
  assert.equal(typeof coverage.fallbackNationalities, "object");
});

// ── A3: Arketype-skæv fysiologi på hver rytter (#1122) ───────────────────────

test("#1122 hver rytter får en arketype-konsistent _meta.physiology (deterministisk)", () => {
  const a = generateFictionalRiders({ seed: 2026, count: 60, referenceYear: 2026 });
  const b = generateFictionalRiders({ seed: 2026, count: 60, referenceYear: 2026 });
  assert.deepEqual(a.riders.map((r) => r._meta.physiology), b.riders.map((r) => r._meta.physiology));
  for (const r of a.riders) {
    assert.ok(r._meta.physiology && Number.isFinite(r._meta.physiology.ftp_wkg), `mangler physiology for ${r._meta.archetype}`);
    assert.ok(Number.isFinite(r._meta.physiology.aero), "mangler aero-metric");
  }
});

test("#1122 climber-arketyper har i snit højere ftp_wkg end sprinter-arketyper", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: 2026 });
  const avg = (type) => {
    const xs = riders.filter((r) => r._meta.archetype === type).map((r) => r._meta.physiology.ftp_wkg);
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  assert.ok(avg("climber") > avg("sprinter"), `climber ftp_wkg ${avg("climber").toFixed(2)} ikke > sprinter ${avg("sprinter").toFixed(2)}`);
});

test("#1122 _meta.physiology fjernes af toInsertPayload (ikke en riders-kolonne)", () => {
  const { riders } = generateFictionalRiders({ seed: 1, count: 5, referenceYear: 2026 });
  for (const row of toInsertPayload(riders)) {
    assert.ok(!("physiology" in row) && !("_meta" in row), "physiology/_meta lækkede ind i INSERT-payload");
  }
});

// ── Komposition-override (#1420 mix-presets) ──────────────────────────────────
// generateFictionalRiders skal kunne tage tierFractions + tierTypeWeights, så
// dev-tooling kan variere feltets blanding. Default (ingen override) = uændret.

const countByArchetype = (riders) => {
  const by = {};
  for (const r of riders) by[r._meta.archetype] = (by[r._meta.archetype] || 0) + 1;
  return by;
};
const countByTier = (riders) => {
  const by = {};
  for (const r of riders) by[r._meta.tier] = (by[r._meta.tier] || 0) + 1;
  return by;
};

test("default-konstanter er eksporteret med forventet form", () => {
  // Brugt af presets-modulet til at bygge skews oven på.
  assert.equal(typeof DEFAULT_TIER_FRACTIONS.superstar, "number");
  assert.equal(DEFAULT_TIER_FRACTIONS.superstar, 12 / 800);
  assert.equal(DEFAULT_TIER_FRACTIONS.star, 60 / 800);
  assert.equal(DEFAULT_TIER_FRACTIONS.solid, 230 / 800);
  assert.equal(DEFAULT_TIER_FRACTIONS.domestique, undefined, "domestique er rest, ikke en fraktion");
  assert.ok(DEFAULT_TIER_TYPE_WEIGHTS.superstar, "tier-type-vægte eksporteret");
  assert.equal(typeof DEFAULT_TIER_TYPE_WEIGHTS.superstar.gc, "number");
});

test("eksplicit default-override === ingen override (byte-identisk determinisme)", () => {
  const plain = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const explicit = generateFictionalRiders({
    seed: 2026, count: 800, referenceYear: REF_YEAR,
    tierFractions: DEFAULT_TIER_FRACTIONS,
    tierTypeWeights: DEFAULT_TIER_TYPE_WEIGHTS,
  });
  assert.deepEqual(explicit.riders, plain.riders);
});

test("skewet tierTypeWeights flytter realiseret type-fordeling (sprinter op)", () => {
  const base = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const sprintHeavy = {};
  for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
    sprintHeavy[tier] = { ...weights, sprinter: (weights.sprinter ?? 1) * 5 };
  }
  const skewed = generateFictionalRiders({
    seed: 2026, count: 800, referenceYear: REF_YEAR, tierTypeWeights: sprintHeavy,
  });
  const baseSprint = countByArchetype(base.riders).sprinter || 0;
  const skewSprint = countByArchetype(skewed.riders).sprinter || 0;
  assert.ok(skewSprint > baseSprint + 50,
    `forventede markant flere sprintere ved skew (base ${baseSprint} → skew ${skewSprint})`);
});

test("tierFractions override ændrer tier-kvoterne (elite-dense)", () => {
  const base = countByTier(
    generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR }).riders,
  );
  const dense = countByTier(
    generateFictionalRiders({
      seed: 2026, count: 800, referenceYear: REF_YEAR,
      tierFractions: { superstar: 0.06, star: 0.16, solid: 0.35 },
    }).riders,
  );
  assert.ok(dense.superstar > base.superstar * 2,
    `elite-dense skal have markant flere superstars (base ${base.superstar} → ${dense.superstar})`);
  assert.equal(dense.superstar, Math.round(0.06 * 800));
  // Stadig en gyldig population: summerer til count.
  const total = Object.values(dense).reduce((s, n) => s + n, 0);
  assert.equal(total, 800);
});

// ── C1: ARCHETYPES + ARCHETYPE_BY_TYPE eksporteret ───────────────────────────

test("ARCHETYPES eksporteret med boost/damp pr. type", () => {
  assert.ok(Array.isArray(ARCHETYPES) && ARCHETYPES.length === 8);
  assert.ok(ARCHETYPE_BY_TYPE.climber?.boost?.stat_bj > 0);
});

test("override bevarer kontrakten (stats i [50,85], pcm_id null)", () => {
  const { riders } = generateFictionalRiders({
    seed: 7, count: 400, referenceYear: REF_YEAR,
    tierFractions: { superstar: 0.06, star: 0.16, solid: 0.35 },
    tierTypeWeights: (() => {
      const w = {};
      for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
        w[tier] = { ...weights, climber: (weights.climber ?? 1) * 2 };
      }
      return w;
    })(),
  });
  for (const r of riders) {
    assert.equal(r.pcm_id, null);
    for (const key of STAT_KEYS) {
      assert.ok(r[key] >= 50 && r[key] <= 85, `${key}=${r[key]} uden for [50,85]`);
    }
  }
});
