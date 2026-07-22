import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

import {
  generateRaceStageProfiles,
  seedIdentityFor,
  ARCHETYPE_PROFILES,
  archetypeFor,
  finaleFor,
  DEMAND_VECTORS,
  ABILITY_DIMENSIONS,
  PROFILE_TYPES,
  FINALE_TYPES,
  GENERATOR_VERSION,
  DEFAULT_TT_CAP,
  timeTrialCap,
} from "./raceStageProfileGenerator.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { makeRng } from "./fictionalRiderGenerator.js";

const ALLOWED_DEMAND_KEYS = new Set([...ABILITY_DIMENSIONS, "randomness"]);
const SPRINT_FRIENDLY = new Set(["flat", "rolling"]);
const CLIMBY = new Set(["mountain", "high_mountain"]);

function single(id = "race-single-1") {
  return { id, race_type: "single", stages: 1 };
}
function stageRace(stages, id = `race-stage-${stages}`) {
  return { id, race_type: "stage_race", stages };
}

test("GENERATOR_VERSION er 4 (pass 2: rute-berigelse wired ind, #2769)", () => {
  assert.equal(GENERATOR_VERSION, 4);
});

// ── v2 seed-identitet (#fix): samme rigtige løb → samme parcours i alle puljer ──
test("seedIdentityFor: external_id > pool_race_id > id", () => {
  assert.equal(seedIdentityFor({ id: "i", pool_race_id: "p", external_id: "e" }), "e");
  assert.equal(seedIdentityFor({ id: "i", pool_race_id: "p" }), "p");
  assert.equal(seedIdentityFor({ id: "i" }), "i");
});

test("v2: samme external_id, FORSKELLIG race.id → IDENTISK parcours (kernen i fixet)", () => {
  // En divisions puljer har hver sin races.id for samme rigtige løb. Før v2 gav det
  // hver pulje sit eget parcours; nu binder external_id dem sammen.
  const poolA = { id: "pool-A-uuid", external_id: "tour-de-x", race_type: "stage_race", stages: 5 };
  const poolB = { id: "pool-B-uuid", external_id: "tour-de-x", race_type: "stage_race", stages: 5 };
  assert.deepEqual(generateRaceStageProfiles(poolA), generateRaceStageProfiles(poolB));
});

test("v2: FORSKELLIG external_id → forskelligt parcours (variation mellem løb bevaret)", () => {
  const raceA = { id: "x", external_id: "race-1", race_type: "stage_race", stages: 6 };
  const raceB = { id: "x", external_id: "race-2", race_type: "stage_race", stages: 6 };
  assert.notDeepEqual(generateRaceStageProfiles(raceA), generateRaceStageProfiles(raceB));
});

test("v2 fallback: uden external_id/pool_race_id seedes på race.id (bagudkompatibel)", () => {
  // Seed-nøglen er ren streng: id="race-stage-5" og external_id="race-stage-5" → samme output.
  const byId = generateRaceStageProfiles({ id: "race-stage-5", race_type: "stage_race", stages: 5 });
  const byExternal = generateRaceStageProfiles({ id: "anden-uuid", external_id: "race-stage-5", race_type: "stage_race", stages: 5 });
  assert.deepEqual(byId, byExternal);
});

test("v2 fallback-trin: samme pool_race_id (uden external_id), FORSKELLIG race.id → identisk", () => {
  // Sæson-rollover-stien kan ramme dette hvis en legacy-katalog-række mangler external_id.
  const a = { id: "pool-A", pool_race_id: "rp-42", race_type: "stage_race", stages: 4 };
  const b = { id: "pool-B", pool_race_id: "rp-42", race_type: "stage_race", stages: 4 };
  assert.deepEqual(generateRaceStageProfiles(a), generateRaceStageProfiles(b));
  assert.equal(seedIdentityFor(a), "rp-42");
});

test("v2 hærdning: tom/whitespace external_id behandles som fraværende → falder til pool_race_id", () => {
  assert.equal(seedIdentityFor({ id: "i", pool_race_id: "p", external_id: "" }), "p");
  assert.equal(seedIdentityFor({ id: "i", pool_race_id: "p", external_id: "   " }), "p");
  assert.equal(seedIdentityFor({ id: "i", external_id: "" }), "i");
  // To DISTINKTE løb med blank external_id må IKKE kollapse til samme parcours.
  const x = { id: "race-x", pool_race_id: "rp-x", external_id: "", race_type: "stage_race", stages: 5 };
  const y = { id: "race-y", pool_race_id: "rp-y", external_id: "", race_type: "stage_race", stages: 5 };
  assert.notDeepEqual(generateRaceStageProfiles(x), generateRaceStageProfiles(y));
});

// ── Sæson-akse: variation pr. sæson, konsistens inden for en sæson ──
test("sæson-akse: samme løb + samme sæson, FORSKELLIG races.id → identisk (konsistens bevaret)", () => {
  const a = { id: "pool-A", external_id: "tour-x", season_id: "s1", race_type: "stage_race", stages: 5 };
  const b = { id: "pool-B", external_id: "tour-x", season_id: "s1", race_type: "stage_race", stages: 5 };
  assert.deepEqual(generateRaceStageProfiles(a), generateRaceStageProfiles(b));
});

test("sæson-akse: samme løb, FORSKELLIG sæson → forskelligt parcours (variation pr. sæson)", () => {
  const s1 = { id: "x", external_id: "tour-x", season_id: "s1", race_type: "stage_race", stages: 6 };
  const s2 = { id: "x", external_id: "tour-x", season_id: "s2", race_type: "stage_race", stages: 6 };
  assert.notDeepEqual(generateRaceStageProfiles(s1), generateRaceStageProfiles(s2));
});

test("sæson-akse: uden season_id seedes på identitet alene (bagudkompatibel)", () => {
  const withSeason = { id: "x", external_id: "tour-x", race_type: "stage_race", stages: 5 };
  const same = { id: "y", external_id: "tour-x", race_type: "stage_race", stages: 5 };
  assert.deepEqual(generateRaceStageProfiles(withSeason), generateRaceStageProfiles(same));
});

// ── Arketype: endagsløb ──
test("arketype endagsløb: cobbled_classic → ALTID brosten (fast karakter, intet flad-flip)", () => {
  const seen = {};
  for (let s = 1; s <= 60; s++) {
    const p = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "cobbled_classic", race_type: "single", stages: 1 })[0];
    seen[p.profile_type] = (seen[p.profile_type] || 0) + 1;
  }
  assert.equal(seen.cobbles || 0, 60, `cobbled_classic skal ALTID være brosten, fik ${JSON.stringify(seen)}`);
});

test("arketype endagsløb: fast kerneterræn — ingen karakterskift på tværs af seeds", () => {
  const allowed = { flat_sprint: ["flat"], cobbled_classic: ["cobbles"], puncheur: ["hilly"], hilly_classic: ["hilly", "classic"], mountain_classic: ["mountain", "high_mountain"], long_sprint_classic: ["rolling"] };
  for (const [arch, ok] of Object.entries(allowed)) {
    for (let s = 1; s <= 40; s++) {
      const t = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: arch, race_type: "single", stages: 1 })[0].profile_type;
      assert.ok(ok.includes(t), `${arch} seed ${s}: uventet ${t} (tilladt: ${ok.join("/")})`);
    }
  }
});

test("arketype endagsløb: flat_sprint → fladt + bunch_sprint dominerer", () => {
  let sprint = 0;
  for (let s = 1; s <= 60; s++) {
    const p = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "flat_sprint", race_type: "single", stages: 1 })[0];
    assert.ok(["flat", "rolling"].includes(p.profile_type), `uventet ${p.profile_type}`);
    if (p.finale_type === "bunch_sprint") sprint++;
  }
  assert.ok(sprint >= 30, `forventede mange bunch_sprint, fik ${sprint}`);
});

test("ukendt/NULL arketype endagsløb → generisk fordeling (bagudkompatibel)", () => {
  const a = generateRaceStageProfiles({ id: "x", race_type: "single", stages: 1, external_id: "race-single-1" });
  const b = generateRaceStageProfiles({ id: "x", race_type: "single", stages: 1, external_id: "race-single-1", terrain_archetype: "ukendt_xyz" });
  assert.deepEqual(a, b);
});

test("archetypeFor: kendt arketype → config, ukendt → null", () => {
  assert.ok(archetypeFor({ terrain_archetype: "cobbled_classic" }));
  assert.equal(archetypeFor({ terrain_archetype: "vrøvl" }), null);
  assert.equal(archetypeFor({}), null);
  assert.ok(ARCHETYPE_PROFILES.grand_tour, "grand_tour findes");
});

// ── Arketype: etapeløb ──
test("arketype etapeløb: sprinters_week → mest flad, ingen high_mountain", () => {
  const counts = {};
  for (let s = 1; s <= 30; s++) {
    for (const p of generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "sprinters_week", race_type: "stage_race", stages: 6 })) {
      counts[p.profile_type] = (counts[p.profile_type] || 0) + 1;
    }
  }
  assert.equal(counts.high_mountain || 0, 0, "sprinters_week må ikke have high_mountain");
  assert.ok((counts.flat || 0) > (counts.mountain || 0), `flad skal dominere: ${JSON.stringify(counts)}`);
});

test("arketype etapeløb: mountain_tour garanterer ≥2 bjerg-etaper + ≥1 flad", () => {
  for (let s = 1; s <= 30; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "mountain_tour", race_type: "stage_race", stages: 6 }).map((p) => p.profile_type);
    const climby = types.filter((t) => ["mountain", "high_mountain"].includes(t)).length;
    assert.ok(climby >= 2, `mountain_tour ${s}: kun ${climby} bjerg-etaper`);
    assert.ok(types.includes("flat"), `mountain_tour ${s}: ingen flad`);
  }
});

test("arketype etapeløb: grand_tour (21) har ≥2 high_mountain + ≥1 itt", () => {
  for (let s = 1; s <= 20; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "grand_tour", race_type: "stage_race", stages: 21 }).map((p) => p.profile_type);
    assert.ok(types.filter((t) => t === "high_mountain").length >= 2, `gt ${s}: <2 high_mountain`);
    assert.ok(types.includes("itt"), `gt ${s}: ingen itt`);
  }
});

// ── #2029: TT-loft — Grand Tour må ikke få 5 enkeltstarter ───────────────────
const countTT = (types) => types.filter((t) => t === "itt" || t === "ttt").length;

test("#2029 DEFAULT_TT_CAP er 2 (konservativ balance-default, flaget til ejer)", () => {
  assert.equal(DEFAULT_TT_CAP, 2);
});

test("#2029 timeTrialCap: default 2, men respekterer flere garanterede TT", () => {
  assert.equal(timeTrialCap([]), 2);
  assert.equal(timeTrialCap(["flat", "itt", "mountain"]), 2);
  assert.equal(timeTrialCap(["itt", "itt", "ttt"]), 3); // hæves af garantier, trimmes ikke
});

test("#2029 grand_tour (21): ≤2 TT (itt+ttt) over MANGE seeds (kernen i fixet)", () => {
  // Før fixet gav ~2 af 3 GT'er 3-5 TT (verificeret mod prod). Loftet skal holde
  // uanset seed. 400 seeds dækker filler-rulle-varians rigeligt.
  for (let s = 1; s <= 400; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `gt${s}`, terrain_archetype: "grand_tour", race_type: "stage_race", stages: 21 }).map((p) => p.profile_type);
    assert.ok(countTT(types) <= 2, `gt seed ${s}: ${countTT(types)} TT (>2): ${types.join(",")}`);
  }
});

test("#2029 grand_tour bevarer stadig ≥1 itt trods loftet (garanti ikke trimmet)", () => {
  for (let s = 1; s <= 100; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `gt${s}`, terrain_archetype: "grand_tour", race_type: "stage_race", stages: 21 }).map((p) => p.profile_type);
    assert.ok(types.includes("itt"), `gt seed ${s}: garanteret itt tabt`);
  }
});

test("#2029 loftet gælder ALLE etapeløbs-arketyper + generisk (≤2 TT), på tværs af seeds", () => {
  const stageArchetypes = Object.entries(ARCHETYPE_PROFILES).filter(([, c]) => c.kind === "stage").map(([k]) => k);
  for (const arch of stageArchetypes) {
    for (const n of [3, 4, 5, 6, 8, 21]) {
      for (let s = 1; s <= 30; s++) {
        const types = generateRaceStageProfiles({ id: "r", external_id: `${arch}-${n}-${s}`, terrain_archetype: arch, race_type: "stage_race", stages: n }).map((p) => p.profile_type);
        assert.ok(countTT(types) <= 2, `${arch} n=${n} seed ${s}: ${countTT(types)} TT (>2)`);
      }
    }
  }
  // Generisk (ukendt arketype): STAGE_FILLER_WEIGHTS har ingen TT, men loftet må
  // heller ikke bryde her.
  for (const n of [3, 4, 5, 6, 8, 21]) {
    for (let seed = 1; seed <= 30; seed++) {
      const types = generateRaceStageProfiles({ id: "x", race_type: "stage_race", stages: n }, { seed }).map((p) => p.profile_type);
      assert.ok(countTT(types) <= 2, `generisk n=${n} seed ${seed}: ${countTT(types)} TT (>2)`);
    }
  }
});

test("arketype etapeløb: sprinter_tour_summits → præcis 1 TT + 2 bjerg, resten flad/rullende", () => {
  for (let s = 1; s <= 30; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `e${s}`, terrain_archetype: "sprinter_tour_summits", race_type: "stage_race", stages: 7 }).map((p) => p.profile_type);
    assert.equal(types.filter((t) => t === "itt").length, 1, `s${s}: TT-antal`);
    assert.equal(types.filter((t) => ["mountain", "high_mountain"].includes(t)).length, 2, `s${s}: bjerg-antal`);
    assert.ok(types.filter((t) => ["flat", "rolling"].includes(t)).length >= 3, `s${s}: for få flade`);
  }
});

test("#2411 TTT pauset: INGEN arketype/generisk genererer 'ttt' (individuel enkeltstart-scoring er misvisende for holdtidskørsel)", () => {
  const stageArchetypes = Object.entries(ARCHETYPE_PROFILES).filter(([, c]) => c.kind === "stage").map(([k]) => k);
  for (const arch of stageArchetypes) {
    for (const n of [3, 4, 5, 6, 8, 21]) {
      for (let s = 1; s <= 30; s++) {
        const types = generateRaceStageProfiles({ id: "r", external_id: `${arch}-ttt-${n}-${s}`, terrain_archetype: arch, race_type: "stage_race", stages: n }).map((p) => p.profile_type);
        assert.ok(!types.includes("ttt"), `${arch} n=${n} seed ${s}: ttt genereret trods pause`);
      }
    }
  }
  // Generisk (ukendt arketype) + endagsløb genererede aldrig ttt — dokumenteret uændret.
  for (const n of [2, 4, 5, 6, 21]) {
    for (let seed = 1; seed <= 20; seed++) {
      const types = generateRaceStageProfiles({ id: "x", race_type: "stage_race", stages: n }, { seed }).map((p) => p.profile_type);
      assert.ok(!types.includes("ttt"), `generisk n=${n} seed=${seed}: ttt genereret`);
    }
  }
  for (let seed = 1; seed <= 20; seed++) {
    const types = generateRaceStageProfiles({ id: "single", race_type: "single" }, { seed }).map((p) => p.profile_type);
    assert.ok(!types.includes("ttt"), `endagsløb seed=${seed}: ttt genereret`);
  }
});

test("ukendt/NULL arketype etapeløb → uændret generisk adfærd (garanterer flad+bjerg)", () => {
  for (const n of [2, 4, 5, 6]) {
    for (let seed = 1; seed <= 20; seed++) {
      const types = generateRaceStageProfiles({ id: "x", race_type: "stage_race", stages: n }, { seed }).map((p) => p.profile_type);
      assert.ok(types.some((t) => ["flat", "rolling"].includes(t)), `n=${n} seed=${seed}: ingen flad`);
      assert.ok(types.some((t) => ["mountain", "high_mountain"].includes(t)), `n=${n} seed=${seed}: ingen bjerg`);
    }
  }
});

test("alle DEMAND_VECTORS er normaliserede + gyldige nøgler", () => {
  for (const profileType of PROFILE_TYPES) {
    const vec = DEMAND_VECTORS[profileType];
    assert.ok(vec, `mangler demand_vector for ${profileType}`);
    let sum = 0;
    for (const [key, w] of Object.entries(vec)) {
      assert.ok(ALLOWED_DEMAND_KEYS.has(key), `${profileType}: ugyldig nøgle ${key}`);
      assert.ok(w > 0 && w <= 1, `${profileType}.${key} uden for (0,1]: ${w}`);
      sum += w;
    }
    assert.ok(Math.abs(sum - 1) < 1e-9, `${profileType}: sum ${sum} ≠ 1.0`);
  }
});

test("determinisme: samme race.id → identisk output (ingen seed)", () => {
  const r = stageRace(5);
  assert.deepEqual(generateRaceStageProfiles(r), generateRaceStageProfiles(r));
});

test("determinisme: samme eksplicitte seed → identisk output", () => {
  const r = stageRace(6);
  assert.deepEqual(
    generateRaceStageProfiles(r, { seed: 12345 }),
    generateRaceStageProfiles(r, { seed: 12345 }),
  );
});

test("endagsløb → præcis 1 etape, gyldigt terræn", () => {
  const profiles = generateRaceStageProfiles(single());
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].stage_number, 1);
  assert.ok(PROFILE_TYPES.includes(profiles[0].profile_type));
});

test("etapeløb → N etaper med sekventielle numre 1..N", () => {
  for (const n of [2, 3, 4, 5, 6, 7]) {
    const profiles = generateRaceStageProfiles(stageRace(n));
    assert.equal(profiles.length, n, `stages=${n}`);
    profiles.forEach((p, i) => assert.equal(p.stage_number, i + 1));
  }
});

test("etapeløb garanterer ≥1 sprint-egnet + ≥1 bjerg-etape", () => {
  for (const n of [2, 4, 5, 6]) {
    // Test på tværs af mange seeds — garantierne skal holde uanset seed.
    for (let seed = 1; seed <= 40; seed++) {
      const types = generateRaceStageProfiles(stageRace(n), { seed }).map((p) => p.profile_type);
      assert.ok(types.some((t) => SPRINT_FRIENDLY.has(t)), `stages=${n} seed=${seed}: ingen sprint-etape`);
      assert.ok(types.some((t) => CLIMBY.has(t)), `stages=${n} seed=${seed}: ingen bjerg-etape`);
    }
  }
});

test("klimaks-form: stage 1 sprint-egnet, sidste etape klatre-finale", () => {
  for (const n of [3, 4, 5, 6]) {
    for (let seed = 1; seed <= 20; seed++) {
      const profiles = generateRaceStageProfiles(stageRace(n), { seed });
      assert.ok(SPRINT_FRIENDLY.has(profiles[0].profile_type), `stages=${n} seed=${seed}: stage 1 ikke sprint-egnet`);
      assert.ok(CLIMBY.has(profiles[n - 1].profile_type), `stages=${n} seed=${seed}: sidste ikke klatre-finale`);
    }
  }
});

test("hver etapes demand_vector matcher DEMAND_VECTORS for dens terræn", () => {
  const profiles = generateRaceStageProfiles(stageRace(6), { seed: 7 });
  for (const p of profiles) {
    assert.deepEqual(p.demand_vector, DEMAND_VECTORS[p.profile_type]);
    // Returnér en KOPI, ikke det frosne objekt (så persistering kan mutere frit).
    assert.notEqual(p.demand_vector, DEMAND_VECTORS[p.profile_type]);
  }
});

test("finale_type er gyldig eller null", () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const p of generateRaceStageProfiles(stageRace(6), { seed })) {
      assert.ok(p.finale_type === null || FINALE_TYPES.includes(p.finale_type), `ugyldig finale ${p.finale_type}`);
    }
  }
});

test("endagsløb varierer terræn på tværs af seeds (fordeling virker)", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    seen.add(generateRaceStageProfiles(single(), { seed })[0].profile_type);
  }
  assert.ok(seen.size >= 3, `forventede varieret terræn, fik kun ${[...seen].join(",")}`);
});

test("manglende race.id kaster", () => {
  assert.throws(() => generateRaceStageProfiles({ race_type: "single" }), /race\.id/);
});

test("ukendt race_type behandles som endagsløb", () => {
  const profiles = generateRaceStageProfiles({ id: "x", race_type: "weird", stages: 5 });
  assert.equal(profiles.length, 1);
});

// ── #1122 Plan 1: motor-vokabular udvidet med flat + tempo ────────────────────
test("#1122 ABILITY_DIMENSIONS matcher ABILITY_KEYS (motor-paritet)", () => {
  assert.deepEqual([...ABILITY_DIMENSIONS].sort(), [...ABILITY_KEYS].sort());
});

test("#1122 flat og tempo har vægt i mindst ét terræn (ikke døde)", () => {
  const hasWeight = (ab) => Object.values(DEMAND_VECTORS).some((v) => (v[ab] || 0) > 0);
  assert.ok(hasWeight("flat"), "flat skal vægtes et sted");
  assert.ok(hasWeight("tempo"), "tempo skal vægtes et sted");
});

// ── #1021 Fase 1: finale-variation (driver udbruds-bonussen) ─────────────────
test("#1021 high_mountain kan slutte på descent (ikke-summit dag), ikke kun long_climb", () => {
  const seen = new Set();
  for (let s = 1; s <= 300; s++) seen.add(finaleFor(makeRng(s), "high_mountain"));
  assert.ok(seen.has("long_climb"), "high_mountain skal stadig oftest være summit");
  assert.ok(seen.has("descent"), "high_mountain skal nogle gange slutte på descent");
});

test("#1021 finaleFor er eksporteret og deterministisk", () => {
  assert.equal(finaleFor(makeRng(42), "flat"), finaleFor(makeRng(42), "flat"));
});

// ── #2769 Sub-1 Task 3: pass 2 (rute) wired ind — pass 1 skal forblive bit-identisk ──
test("pass 1 (profile/finale/demand) er bit-identisk efter pass 2 (golden)", () => {
  const golden = JSON.parse(readFileSync(join(__dir, "__fixtures__/pass1-golden.json"), "utf8"));
  const cases = {
    r1: { id: "r1", external_id: "8fe98b9f788c3b06", season_id: "s2", race_type: "stage_race", stages: 4, terrain_archetype: "mountain_tour" },
    r2: { id: "r2", external_id: "241b2846959aa1c7", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "balanced_week" },
    r3: { id: "r3", external_id: "50c62405df6384e4", season_id: "s2", race_type: "single", stages: 1, terrain_archetype: "puncheur" },
    r4: { id: "r4", external_id: "37e566b5829adb99", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "sprinters_week" },
  };
  for (const [key, race] of Object.entries(cases)) {
    const got = generateRaceStageProfiles(race).map((p) => ({
      stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, demand_vector: p.demand_vector,
    }));
    assert.deepEqual(got, golden[key], `pass 1 ændret for ${key}`);
  }
});

test("pass 2 er additivt: rute-felter er til stede på hver etape", () => {
  const ps = generateRaceStageProfiles({ id: "r1", external_id: "8fe98b9f788c3b06", season_id: "s2", race_type: "stage_race", stages: 4, terrain_archetype: "mountain_tour" });
  for (const p of ps) {
    assert.equal(typeof p.distance_km, "number");
    assert.ok(Array.isArray(p.climbs) && Array.isArray(p.sprints) && Array.isArray(p.sectors));
    assert.equal(typeof p.elevation_gain_m, "number");
  }
});
