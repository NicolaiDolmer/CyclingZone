import test from "node:test";
import assert from "node:assert/strict";

import {
  generateFictionalRiders,
  makeRng,
  STAT_KEYS,
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

test("alle 14 stats til stede som heltal i [40,88]", () => {
  for (const r of gen().riders) {
    for (const key of STAT_KEYS) {
      assert.equal(typeof r[key], "number");
      assert.ok(Number.isInteger(r[key]), `${key} skal være heltal`);
      assert.ok(r[key] >= 40 && r[key] <= 88, `${key}=${r[key]} uden for [40,88]`);
    }
  }
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

test("sprintere har højere sprint end klatrere (aggregeret)", () => {
  const { riders } = generateFictionalRiders({ seed: 5, count: 400, referenceYear: REF_YEAR });
  const avg = (role, key) => {
    const subset = riders.filter((r) => r._meta.role === role);
    return subset.reduce((s, r) => s + r[key], 0) / subset.length;
  };
  assert.ok(avg("sprinter", "stat_sp") > avg("climber", "stat_sp") + 5);
  assert.ok(avg("climber", "stat_bj") > avg("sprinter", "stat_bj") + 5);
  assert.ok(avg("tt", "stat_tt") > avg("sprinter", "stat_tt") + 5);
});

// ── Coverage-rapport ──────────────────────────────────────────────────────────

test("coverage rapporterer cluster-fordeling og evt. fallback", () => {
  const { coverage } = gen({ count: 100 });
  const totalByCluster = Object.values(coverage.byCluster).reduce((s, n) => s + n, 0);
  assert.equal(totalByCluster, 100);
  assert.equal(typeof coverage.fallbackNationalities, "object");
});
