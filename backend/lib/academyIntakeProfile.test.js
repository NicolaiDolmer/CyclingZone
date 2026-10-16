import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  assert.equal(validateProfileInput({ origins: ["DK"], types: ["climber"] }, 2).error, "type_locked", "forslag D: type fra niveau 3");
  assert.equal(validateProfileInput({ origins: ["DK"], types: ["climber"] }, 3).ok, true);
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
  assert.deepEqual(clampProfileToTier(p, 3), { origins: ["DK"], types: ["climber"] });
  assert.deepEqual(clampProfileToTier(p, 2), { origins: ["DK"], types: [] });
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

// Gem gaar gennem RPC'en save_academy_intake_profile (oprydning + indsaettelse i
// een transaktion bag en advisory-laas pr. hold). Mocken fanger rpc-kaldene;
// enhver direkte insert/delete paa tabellen er en regression og kaster.
function buildSaveMock({ tier = 2, rpcError = null } = {}) {
  const capture = { inserts: [], ops: [] };
  return {
    capture,
    from(table) {
      if (table === "team_facilities") {
        const api = { select() { return api; }, eq() { return api; }, maybeSingle: async () => ({ data: { tier }, error: null }) };
        return api;
      }
      if (table === "academy_intake_profiles") {
        throw new Error("direkte skrivning til academy_intake_profiles: brug RPC'en (atomisk pr. hold)");
      }
      throw new Error(`uventet tabel ${table}`);
    },
    async rpc(name, args) {
      capture.ops.push(name);
      capture.inserts.push(args);
      return rpcError ? { data: null, error: rpcError } : { data: 99, error: null };
    },
  };
}

test("saveAcademyProfile: gemmer via een atomisk RPC, aldrig separat insert + delete", async () => {
  const sb = buildSaveMock({ tier: 2 });
  const now = new Date("2026-10-15T12:00:00Z");
  await saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["DK"], types: [] }, now });
  assert.deepEqual(sb.capture.ops, ["save_academy_intake_profile"]);
  assert.equal(sb.capture.inserts[0].p_team_id, "team-A");
  assert.equal(sb.capture.inserts[0].p_now, now.toISOString(), "oprydningen maaler 'ventende' mod samme tidspunkt som gemningen");
});

test("saveAcademyProfile: fejler RPC'en, kastes fejlen (transaktionen ruller sletningen tilbage)", async () => {
  const sb = buildSaveMock({ tier: 2, rpcError: { message: "transient" } });
  const now = new Date("2026-10-15T12:00:00Z");
  await assert.rejects(
    saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["DK"], types: [] }, now }),
    /academy-profile save: transient/,
  );
  assert.equal(sb.capture.ops.length, 1, "eet forsoeg, ingen efterfoelgende oprydning uden for transaktionen");
});

test("saveAcademyProfile: gemmer med 14 dages forsinkelse", async () => {
  const sb = buildSaveMock({ tier: 3 });
  const now = new Date("2026-10-15T12:00:00Z");
  const r = await saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["region:nordic"], types: ["climber"] }, now });
  assert.equal(r.ok, true);
  assert.equal(new Date(r.effectiveFrom).getTime() - now.getTime(), PROFILE_DELAY_DAYS * 86_400_000);
  assert.equal(sb.capture.inserts[0].p_effective_from, r.effectiveFrom);
  assert.deepEqual(sb.capture.inserts[0].p_origins, ["region:nordic"]);
  assert.deepEqual(sb.capture.inserts[0].p_rider_types, ["climber"]);
});

// SQL-kontrakten bag RPC'en: laas pr. hold, oprydning FOER indsaettelse i samme
// funktion (= samme transaktion), og kun service_role maa kalde den.
test("save_academy_intake_profile: serialiseret pr. hold og service-role-only", () => {
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "database", "2026-10-15-6666-academy-intake-profiles.sql"),
    "utf8",
  );
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.save_academy_intake_profile(");
  assert.ok(start > 0, "RPC'en findes i migrationen");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const lock = body.indexOf("pg_advisory_xact_lock(");
  const del = body.indexOf("DELETE FROM public.academy_intake_profiles");
  const ins = body.indexOf("INSERT INTO public.academy_intake_profiles");
  assert.ok(lock > 0 && lock < del && del < ins, "laas, saa oprydning, saa indsaettelse");
  assert.match(body, /p_team_id::text/, "laasen er pr. hold");
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.save_academy_intake_profile\([^)]*\) FROM anon, authenticated;/);
  assert.match(sql, /GRANT {2}EXECUTE ON FUNCTION public\.save_academy_intake_profile\([^)]*\) TO service_role;/);
});

test("saveAcademyProfile: et laast felt afvises uden skrivning", async () => {
  const sb = buildSaveMock({ tier: 1 });
  const r = await saveAcademyProfile(sb, { teamId: "team-A", input: { origins: ["DK"], types: ["gc"] }, now: new Date("2026-10-15T12:00:00Z") });
  assert.equal(r.ok, false);
  assert.equal(r.error, "type_locked");
  assert.equal(sb.capture.inserts.length, 0);
});

// Ejer 16/10 (forslag D): trappen skal kunne udvides til 15 niveauer uden at
// tage noget fra spillerne. Intet niveau maa give mindre end det forrige, og
// hvert niveau over 0 skal give noget mere (share stiger altid).
test("PROFILE_TIERS: monoton paa alle felter, og hvert niveau giver mere (forslag D)", () => {
  const tiers = Object.keys(PROFILE_TIERS).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < tiers.length; i += 1) {
    const prev = PROFILE_TIERS[tiers[i - 1]];
    const cur = PROFILE_TIERS[tiers[i]];
    for (const k of ["candidates", "origins", "types", "extra", "share"]) {
      assert.ok(cur[k] >= prev[k], `niveau ${tiers[i]}: ${k} falder`);
    }
    assert.ok(cur.share > prev.share, `niveau ${tiers[i]} skal goere profilen staerkere`);
  }
  assert.deepEqual(tiers.map((t) => PROFILE_TIERS[t].candidates), [2, 2, 3, 3, 3, 4]);
});
