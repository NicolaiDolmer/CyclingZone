import test from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_TIERS,
  PROFILE_NATIONS,
  PROFILE_REGIONS,
  PROFILE_DELAY_DAYS,
  buildProfileGeneratorOptions,
  candidatesForTier,
  clampProfileToTier,
  isValidOrigin,
  nationsForOrigin,
  resolveProfileRows,
  saveAcademyProfile,
  validateProfileInput,
} from "./academyIntakeProfile.ts";
import { generateAcademyCandidates } from "./academyGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";

test("model 1: flere kandidater pr. niveau, aldrig faerre", () => {
  for (let t = 1; t <= 5; t += 1) assert.ok(candidatesForTier(t) >= candidatesForTier(t - 1));
  assert.ok(candidatesForTier(5) > candidatesForTier(0));
});

test("model 1: overvaegten vokser med niveauet og naar aldrig 100 %", () => {
  for (let t = 1; t <= 5; t += 1) {
    assert.ok(PROFILE_TIERS[t].share >= PROFILE_TIERS[t - 1].share);
    assert.ok(PROFILE_TIERS[t].share < 1, `niveau ${t} maa aldrig vaere 100 %`);
  }
  assert.ok(PROFILE_TIERS[5].share > PROFILE_TIERS[2].share, "niveau 5 er staerkest");
  assert.equal(PROFILE_TIERS[0].share, 0);
});

test("regioner bestaar kun af nationer kuldet kan traekke", () => {
  for (const [key, nations] of Object.entries(PROFILE_REGIONS)) {
    for (const n of nations) assert.ok(PROFILE_NATIONS.includes(n), `${key}: ${n}`);
    assert.ok(isValidOrigin(`region:${key}`));
  }
  assert.deepEqual(nationsForOrigin("DK"), ["DK"]);
  assert.equal(isValidOrigin("region:atlantis"), false);
  assert.equal(isValidOrigin("XX"), false);
});

test("validateProfileInput: felterne laases op pr. niveau (model 1)", () => {
  assert.equal(validateProfileInput({ origins: ["DK"] }, 0).error, "profile_locked");
  assert.equal(validateProfileInput({ origins: [], types: [] }, 0).ok, true, "en tom profil er altid gyldig");
  assert.equal(validateProfileInput({ origins: ["DK"] }, 1).ok, true);
  assert.equal(validateProfileInput({ origins: ["DK"], types: ["climber"] }, 1).error, "type_locked");
  assert.equal(validateProfileInput({ origins: ["DK"], types: ["climber"] }, 2).ok, true);
  assert.equal(validateProfileInput({ origins: ["DK", "NO"] }, 3).error, "too_many_fields");
  // Niveau 4: EEN ekstra, paa nationalitet ELLER type, ikke begge.
  assert.equal(validateProfileInput({ origins: ["DK", "region:benelux"], types: ["climber"] }, 4).ok, true);
  assert.equal(validateProfileInput({ origins: ["DK"], types: ["climber", "gc"] }, 4).ok, true);
  assert.equal(validateProfileInput({ origins: ["DK", "NO"], types: ["climber", "gc"] }, 5).error, "too_many_fields");
  assert.equal(validateProfileInput({ origins: ["XX"] }, 5).error, "invalid_origin");
  assert.equal(validateProfileInput({ origins: ["DK"], types: ["wizard"] }, 5).error, "invalid_type");
});

test("resolveProfileRows: profilen virker foerst fra effective_from (punkt 5)", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const rows = [
    { origins: ["DK"], rider_types: [], effective_from: "2026-10-01T12:00:00Z", created_at: "2026-09-17T12:00:00Z" },
    { origins: ["NO"], rider_types: ["gc"], effective_from: "2026-10-29T12:00:00Z", created_at: "2026-10-15T12:00:00Z" },
  ];
  const { active, pending } = resolveProfileRows(rows, now);
  assert.deepEqual(active.origins, ["DK"]);
  assert.deepEqual(pending.origins, ["NO"]);
  assert.deepEqual(pending.types, ["gc"]);
  assert.equal(resolveProfileRows([], now).active, null);
});

test("clampProfileToTier: en nedgraderet facilitet beskaerer profilen i stedet for at slukke den", () => {
  const p = { origins: ["DK"], types: ["climber", "gc"] };
  assert.deepEqual(clampProfileToTier(p, 4), p);
  assert.deepEqual(clampProfileToTier(p, 2), { origins: ["DK"], types: ["climber"] });
  assert.deepEqual(clampProfileToTier(p, 1), { origins: ["DK"], types: [] });
  assert.equal(clampProfileToTier(p, 0), null);
});

test("buildProfileGeneratorOptions: blandede vaegte, profilen aldrig 100 %", () => {
  assert.equal(buildProfileGeneratorOptions({ origins: ["DK"], types: [] }, 0), null);
  const opts = buildProfileGeneratorOptions({ origins: ["DK"], types: ["climber"] }, 3);
  const total = opts.nationalityWeights.reduce((s, e) => s + e.weight, 0);
  const dk = opts.nationalityWeights.find((e) => e.value === "DK").weight / total;
  assert.ok(dk > PROFILE_TIERS[3].share && dk < 1, "DK overvaegtet men ikke eneste nation");
  assert.ok(opts.nationalityWeights.filter((e) => e.weight > 0).length === PROFILE_NATIONS.length);
  const dist = opts.primaryArchetypeDistribution;
  const others = Object.entries(dist).filter(([k]) => k !== "climber");
  assert.ok(others.every(([, w]) => w > 0), "andre typer forekommer stadig");
});

test("generator: profilen flytter nationalitet og type, IKKE potentialefordelingen (D-039)", () => {
  const N = 3000;
  const run = (generatorOptions) => {
    const cands = generateAcademyCandidates({
      rng: makeRng(6666), referenceYear: 2028, existingNames: new Set(), countOverride: N,
      mode: "pcm", ...(generatorOptions ?? {}),
    });
    const share = (pred) => cands.filter(pred).length / cands.length;
    const meanPot = cands.reduce((s, c) => s + c.rider.potentiale, 0) / cands.length;
    return {
      dk: share((c) => c.rider.nationality_code === "DK"),
      climber: share((c) => c.archetypeDraw.primary === "climber"),
      meanPot,
    };
  };
  const base = run(null);
  const profiled = run(buildProfileGeneratorOptions({ origins: ["DK"], types: ["climber"] }, 5));
  assert.ok(profiled.dk > base.dk * 3, `DK-andel ${profiled.dk} vs ${base.dk}`);
  assert.ok(profiled.dk < 0.95, "aldrig udelukkende profilen");
  assert.ok(profiled.climber > base.climber * 2, `klatrer-andel ${profiled.climber} vs ${base.climber}`);
  assert.ok(profiled.climber < 0.95);
  assert.ok(Math.abs(profiled.meanPot - base.meanPot) < 0.12, `potentiale-snit ${profiled.meanPot} vs ${base.meanPot}`);
});

test("generator: uden profil er traekkene bit-identiske med foer (determinisme)", () => {
  const a = generateAcademyCandidates({ rng: makeRng(42), referenceYear: 2028, existingNames: new Set(), countOverride: 5 });
  const b = generateAcademyCandidates({ rng: makeRng(42), referenceYear: 2028, existingNames: new Set(), countOverride: 5, primaryArchetypeDistribution: null });
  assert.deepEqual(a.map((c) => c.rider), b.map((c) => c.rider));
});

function buildSaveMock({ tier = 2, insertError = null } = {}) {
  const capture = { deletes: [], inserts: [], ops: [] };
  return {
    capture,
    from(table) {
      if (table === "team_facilities") {
        const api = { select() { return api; }, eq() { return api; }, maybeSingle: async () => ({ data: { tier }, error: null }) };
        return api;
      }
      if (table === "academy_intake_profiles") {
        return {
          delete() {
            capture.ops.push("delete");
            const filters = {};
            const api = {
              eq(col, val) { filters[`eq:${col}`] = val; return api; },
              gt(col, val) { filters[`gt:${col}`] = val; return api; },
              neq(col, val) {
                filters[`neq:${col}`] = val;
                capture.deletes.push(filters);
                return Promise.resolve({ error: null });
              },
            };
            return api;
          },
          insert(row) {
            capture.ops.push("insert");
            capture.inserts.push(row);
            const api = {
              select() { return api; },
              single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 99 }, error: null }),
            };
            return api;
          },
        };
      }
      throw new Error(`uventet tabel ${table}`);
    },
  };
}

test("saveAcademyProfile: indsaetter foer oprydning og rydder aldrig den nye raekke", async () => {
  const sb = buildSaveMock({ tier: 2 });
  await saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["DK"], types: [] } });
  assert.deepEqual(sb.capture.ops, ["insert", "delete"]);
  assert.equal(sb.capture.deletes[0]["neq:id"], 99);
  assert.equal(sb.capture.deletes[0]["eq:team_id"], "team-A");
});

test("saveAcademyProfile: fejler indsaettelsen, roeres den ventende profil ikke", async () => {
  const sb = buildSaveMock({ tier: 2, insertError: { message: "transient" } });
  await assert.rejects(
    saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["DK"], types: [] } }),
    /academy-profile save: transient/,
  );
  assert.deepEqual(sb.capture.ops, ["insert"], "ingen sletning naar indsaettelsen fejler");
});

test("saveAcademyProfile: gemmer med 14 dages forsinkelse og rydder en ventende aendring", async () => {
  const sb = buildSaveMock({ tier: 2 });
  const now = new Date("2026-10-15T12:00:00Z");
  const r = await saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["region:nordic"], types: ["climber"] }, now });
  assert.equal(r.ok, true);
  assert.equal(new Date(r.effectiveFrom).getTime() - now.getTime(), PROFILE_DELAY_DAYS * 86_400_000);
  assert.equal(sb.capture.deletes.length, 1);
  assert.deepEqual(sb.capture.inserts[0].origins, ["region:nordic"]);
  assert.deepEqual(sb.capture.inserts[0].rider_types, ["climber"]);
});

test("saveAcademyProfile: et laast felt afvises uden skrivning", async () => {
  const sb = buildSaveMock({ tier: 1 });
  const r = await saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["DK"], types: ["gc"] } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "type_locked");
  assert.equal(sb.capture.inserts.length, 0);
});
