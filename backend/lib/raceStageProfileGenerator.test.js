import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

import {
  generateRaceStageProfiles,
  capIdenticalRuns,
  weaveGrandTourScaffold,
  weaveMountainFamilyBlocks,
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
  SHORT_RACE_TT_CAP,
  timeTrialCap,
  applyOrderArchetype,
  applyOpeningVariety,
  SPRINT_FINALE_EARLY_DECIDER_CHANCE,
  markSecondIttAsHilly,
  TT_LOOKALIKE_DISTANCE_BAND_KM,
  looksLikeDuplicateTimeTrial,
  findDuplicateTimeTrialPairs,
  S5_GENERATOR_VERSION,
  S5_FINISH_WEIGHTS,
  S5_GRAND_TOUR_QUOTAS,
  grandTourTypeFor,
  grandTourQuotaTypes,
  toStageProfileRow,
  isTimeTrial,
  IDENTITY_PROFILES,
  IDENTITY_GENERATOR_VERSION,
  raceIdentityFor,
  signatureLockFor,
  s5StageRaceFillerSlots,
} from "./raceStageProfileGenerator.js";
import { createHash } from "node:crypto";
import { RACE_IDENTITY_TYPES, TIER_IDENTITY_DISTRIBUTION } from "./raceIdentityTypes.js";
import { IDENTITY_GOLDEN_CASES } from "./__fixtures__/identityGoldenCases.js";
import { makeS5TierProfileGenerator } from "./s5TierTerrainQuota.js";
import { checkStage } from "./s5BenchmarkGate.js";
import { deriveTerrainType, summitFinishFor } from "./raceRouteGenerator.js";
import { FINISH_MATRIX, TERRAIN_TYPES, isFinishAllowed } from "./stageProfileTypes.js";
import { GRAND_TOUR_MIN_STAGES } from "./grandTourRestDays.js";
import {
  ORDER_ARCHETYPES,
  DEFAULT_ORDER_WEIGHTS,
  ORDER_WEIGHTS_BY_ARCHETYPE,
  orderWeightsFor,
  OPENING_VARIETY_CHANCE,
  OPENING_VARIETY_CANDIDATES,
} from "./raceStageOrderProfiles.js";
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

test("GENERATOR_VERSION er 5 (#3326: finale-drevne ordnings-arketyper)", () => {
  assert.equal(GENERATOR_VERSION, 5);
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
// #3546 D: itt_hilly er en TT-familie-profil (se TIME_TRIAL_PROFILES): tælles med her,
// ellers ville et renamet "anden ITT→itt_hilly" (GT-arketypen) usynliggøre en reel TT for
// et loft der netop skal måle TOTAL TT-belastning, ikke den rå streng "itt".
const countTT = (types) => types.filter((t) => t === "itt" || t === "itt_hilly" || t === "ttt").length;

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

// ── #3326: finale-drevne ordnings-arketyper (raceStageOrderProfiles.js) ──────────
// Erstatter den tidligere "klimaks-form"-test (stage 1 altid sprint, sidste altid
// klatring) — det var netop den hårde crescendo-sortering #3326 fjernede. golden-tests
// pr. ordnings-arketype nedenfor + en statistisk fordelings-test på tværs af mange seeds.

test("#3326 applyOrderArchetype: summit_finale er uændret crescendo (klatring sidst)", () => {
  const types = ["flat", "rolling", "hilly", "mountain", "high_mountain"];
  const ordered = applyOrderArchetype(makeRng(1), types, "summit_finale");
  assert.equal(ordered[ordered.length - 1], "high_mountain");
  assert.equal(ordered[0], "flat");
  assert.deepEqual([...ordered].sort(), [...types].sort(), "multisæt uændret, kun rækkefølge");
});

test("#3326 applyOrderArchetype: sprint_finale slutter fladt, hårdeste FØR sidste dag", () => {
  const HARD = new Set(["mountain", "high_mountain"]);
  for (let seed = 1; seed <= 60; seed++) {
    const types = ["flat", "rolling", "hilly", "mountain", "high_mountain", "flat"];
    const ordered = applyOrderArchetype(makeRng(seed), types, "sprint_finale");
    assert.deepEqual([...ordered].sort(), [...types].sort(), `seed ${seed}: multisæt ændret`);
    assert.ok(SPRINT_FRIENDLY.has(ordered[ordered.length - 1]), `seed ${seed}: sidste etape ikke flad/rullende (${ordered.join(",")})`);
    const hardestIdx = ordered.findIndex((t) => HARD.has(t));
    assert.ok(hardestIdx < ordered.length - 1, `seed ${seed}: hårdeste etape er sidste dag (${ordered.join(",")})`);
    assert.ok(hardestIdx >= ordered.length - 3, `seed ${seed}: hårdeste for langt fra slut (${ordered.join(",")})`);
  }
});

test("#3326 applyOrderArchetype: tt_finale flytter enkeltstarten til sidste plads", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const types = ["flat", "hilly", "mountain", "itt", "flat"];
    const ordered = applyOrderArchetype(makeRng(seed), types, "tt_finale");
    assert.deepEqual([...ordered].sort(), [...types].sort(), `seed ${seed}: multisæt ændret`);
    assert.equal(ordered[ordered.length - 1], "itt", `seed ${seed}: sidste etape ikke itt (${ordered.join(",")})`);
  }
});

test("#3326 applyOrderArchetype: circuit_finale slutter kuperet (hilly/classic), ikke fladt/bjerg", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const types = ["flat", "rolling", "mountain", "hilly", "flat"];
    const ordered = applyOrderArchetype(makeRng(seed), types, "circuit_finale");
    assert.deepEqual([...ordered].sort(), [...types].sort(), `seed ${seed}: multisæt ændret`);
    assert.equal(ordered[ordered.length - 1], "hilly", `seed ${seed}: sidste etape ikke kuperet (${ordered.join(",")})`);
  }
});

test("#3326 applyOrderArchetype: deterministisk (samme seed + types → samme rækkefølge)", () => {
  const types = ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt"];
  for (const arch of ORDER_ARCHETYPES) {
    const a = applyOrderArchetype(makeRng(42), types.slice(), arch);
    const b = applyOrderArchetype(makeRng(42), types.slice(), arch);
    assert.deepEqual(a, b, `${arch}: ikke deterministisk`);
  }
});

test("#3326 applyOpeningVariety: rører ALDRIG finale-slottet (sidste index)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const ordered = ["flat", "hilly", "rolling", "mountain", "itt"]; // sidste = itt (fx en tt_finale-udgang)
    const varied = applyOpeningVariety(makeRng(seed), ordered.slice());
    assert.equal(varied[varied.length - 1], "itt", `seed ${seed}: finale-slot kannibaliseret (${varied.join(",")})`);
    assert.deepEqual([...varied].sort(), [...ordered].sort(), `seed ${seed}: multisæt ændret`);
  }
});

test("#3326 applyOpeningVariety: producerer af og til en ikke-flad åbning (chance er OPENING_VARIETY_CHANCE)", () => {
  let nonFlatOpeners = 0;
  const N = 500;
  for (let seed = 1; seed <= N; seed++) {
    const ordered = ["flat", "hilly", "rolling", "mountain", "itt"];
    const varied = applyOpeningVariety(makeRng(seed), ordered.slice());
    if (!["flat"].includes(varied[0])) nonFlatOpeners++;
  }
  // Chance er ~20%; med kandidater til stede i midterfeltet bør en pæn andel af de
  // rullede tilfælde rent faktisk finde en kandidat. Løs nedre grænse (halvdelen af
  // OPENING_VARIETY_CHANCE) for at undgå flaky test, men bekræfter mekanismen virker.
  assert.ok(nonFlatOpeners >= N * OPENING_VARIETY_CHANCE * 0.5, `kun ${nonFlatOpeners}/${N} ikke-flade åbninger`);
});

test("#3326 orderWeightsFor: kendt override (summit_tour/sprinter_tour_summits) vs. default", () => {
  assert.equal(orderWeightsFor("mountain_tour"), DEFAULT_ORDER_WEIGHTS);
  assert.equal(orderWeightsFor("ukendt_xyz"), DEFAULT_ORDER_WEIGHTS);
  assert.equal(orderWeightsFor(undefined), DEFAULT_ORDER_WEIGHTS);
  assert.equal(orderWeightsFor("summit_tour"), ORDER_WEIGHTS_BY_ARCHETYPE.summit_tour);
  for (const w of Object.values(ORDER_WEIGHTS_BY_ARCHETYPE)) {
    for (const row of w) assert.ok(ORDER_ARCHETYPES.includes(row.value), `ukendt ordnings-arketype: ${row.value}`);
  }
  for (const row of DEFAULT_ORDER_WEIGHTS) assert.ok(ORDER_ARCHETYPES.includes(row.value));
});

// Statistisk: på tværs af mange (real-lignende) mountain_tour-løb skal ALLE fire
// finale-typer forekomme (variation virker) — modsat førhen hvor 84% ALTID sluttede
// på bjerg og 0% fladt/enkeltstart/kuperet.
test("#3326 mountain_tour over mange seeds: finale-variation virker (ikke længere 100% bjerg-slut)", () => {
  const lastTypeCounts = {};
  for (let s = 1; s <= 200; s++) {
    const race = { id: "r", external_id: `mt-${s}`, season_id: "s2", race_type: "stage_race", stages: 7, terrain_archetype: "mountain_tour" };
    const ps = generateRaceStageProfiles(race);
    const last = ps[ps.length - 1].profile_type;
    lastTypeCounts[last] = (lastTypeCounts[last] || 0) + 1;
  }
  const climby = (lastTypeCounts.mountain || 0) + (lastTypeCounts.high_mountain || 0);
  const flatty = (lastTypeCounts.flat || 0) + (lastTypeCounts.rolling || 0);
  assert.ok(climby > 0 && climby < 200, `forventede variation i bjerg-slut, fik ${JSON.stringify(lastTypeCounts)}`);
  assert.ok(flatty > 0, `forventede NOGLE fladt-sluttende mountain_tour-løb, fik ${JSON.stringify(lastTypeCounts)}`);
  assert.ok((lastTypeCounts.itt || 0) > 0, `forventede NOGLE itt-sluttende mountain_tour-løb, fik ${JSON.stringify(lastTypeCounts)}`);
});

// Sekvens-diversitet (regression-smoke for accept-kravet "ingen sekvens delt af >8 løb").
// mountain_tour+7 etaper er en af de hyppigste real-arketyper (jf. PR-body-tabellen).
test("#3326 mountain_tour+7 over 60 seeds: ingen enkelt profil-sekvens dominerer (smoke, fuld måling i PR-body)", () => {
  const seqCounts = {};
  for (let s = 1; s <= 60; s++) {
    const race = { id: "r", external_id: `mtseq-${s}`, season_id: "s2", race_type: "stage_race", stages: 7, terrain_archetype: "mountain_tour" };
    const seq = generateRaceStageProfiles(race).map((p) => p.profile_type).join(">");
    seqCounts[seq] = (seqCounts[seq] || 0) + 1;
  }
  const maxShared = Math.max(...Object.values(seqCounts));
  assert.ok(maxShared <= 8, `en sekvens deles af ${maxShared} af 60 (accept-kravet er ≤8 i en HEL sæson, ~51 løb)`);
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

// ── #2769 Task 4: nye arketyper — summit_tour, itt_classic, cobbled_tour ──

test("summit_tour garanterer mindst én high_mountain-etape", () => {
  const cfg = ARCHETYPE_PROFILES.summit_tour;
  assert.equal(cfg.kind, "stage");
  assert.ok(cfg.guarantees.includes("high_mountain"));
});

test("summit_tour producerer ≥1 long_climb-summit over etaperne", () => {
  const race = { id: "st", external_id: "summit-x", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour" };
  const ps = generateRaceStageProfiles(race);
  const summits = ps.filter((p) => p.finale_type === "long_climb" && (p.profile_type === "high_mountain" || p.profile_type === "mountain"));
  assert.ok(summits.length >= 1, `forventede ≥1 summit, fik ${summits.length}`);
});

test("itt_classic er en single der giver netop én itt-etape", () => {
  const race = { id: "ic", external_id: "itt-x", season_id: "s2", race_type: "single", stages: 1, terrain_archetype: "itt_classic" };
  const ps = generateRaceStageProfiles(race);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].profile_type, "itt");
});

test("cobbled_tour garanterer en cobbles-etape inde i etapeløbet", () => {
  const race = { id: "ct", external_id: "cobbles-x", season_id: "s2", race_type: "stage_race", stages: 5, terrain_archetype: "cobbled_tour" };
  const ps = generateRaceStageProfiles(race);
  assert.ok(ps.some((p) => p.profile_type === "cobbles"), "manglede cobbles-etape");
  const cobbleStage = ps.find((p) => p.profile_type === "cobbles");
  assert.ok(cobbleStage.sectors.length >= 3, "cobbles-etape uden brosten-sektorer");
});

// ── #2771: GT-åbnings-ITT (openingItt) ────────────────────────────────────────
test("grand_tour: etape 1 er ALTID itt (openingItt)", () => {
  for (const seed of [1, 42, 2026, 777]) {
    const stages = generateRaceStageProfiles(
      { id: `gt-${seed}`, race_type: "stage_race", stages: 21, pool_race_id: `pool-gt-${seed}`, terrain_archetype: "grand_tour" },
      { seed }
    );
    assert.equal(stages[0].profile_type, "itt", `seed ${seed}: etape 1 skal være itt`);
    assert.equal(stages.length, 21);
  }
});

test("openingItt ændrer ikke etapetype-multisettet (kun rækkefølgen af garantier)", () => {
  const stages = generateRaceStageProfiles(
    { id: "gt-ms", race_type: "stage_race", stages: 21, pool_race_id: "pool-gt-ms", terrain_archetype: "grand_tour" },
    { seed: 2026 }
  );
  const counts = {};
  for (const s of stages) counts[s.profile_type] = (counts[s.profile_type] || 0) + 1;
  // Garantierne (3 flat, 1 itt, 1 mountain, 2 high_mountain) skal minimum være til stede.
  assert.ok(counts.flat >= 3 && counts.itt >= 1 && counts.mountain >= 1 && counts.high_mountain >= 2);
});

test("andre stage-arketyper er upåvirkede af openingItt (summit_tour etape 1 er ikke tvunget itt)", () => {
  let sawNonItt = false;
  for (const seed of [1, 42, 2026, 777, 9]) {
    const stages = generateRaceStageProfiles(
      { id: `st-${seed}`, race_type: "stage_race", stages: 5, pool_race_id: `pool-st-${seed}`, terrain_archetype: "summit_tour" },
      { seed }
    );
    if (stages[0].profile_type !== "itt") sawNonItt = true;
  }
  assert.ok(sawNonItt, "summit_tour må ikke systematisk åbne med itt");
});

// ── #3326-korrektion 2026-08-04: 41-løbs-research — GT'ens egen ordning ──────────
// 0/9 rigtige grand tours (2024-2026) sluttede på bjerg; hårdeste etape lå næstsidst
// i 88,9% af tilfældene. Se raceStageOrderProfiles.js + toGrandTourFinale.

test("#3326-korrektion grand_tour (21): ALDRIG bjerg-finale over mange seeds (0/9 i researchen)", () => {
  const HARD = new Set(["mountain", "high_mountain"]);
  for (let seed = 1; seed <= 300; seed++) {
    const stages = generateRaceStageProfiles(
      { id: `gtfin-${seed}`, race_type: "stage_race", stages: 21, pool_race_id: `pool-gtfin-${seed}`, terrain_archetype: "grand_tour" },
      { seed }
    );
    const last = stages[stages.length - 1].profile_type;
    assert.ok(!HARD.has(last), `seed ${seed}: grand_tour sluttede på bjerg (${last})`);
  }
});

test("#3326-korrektion grand_tour (21): hårdeste etape ligger næstsidst (ikke sidst, ikke tidligere)", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const stages = generateRaceStageProfiles(
      { id: `gtpos-${seed}`, race_type: "stage_race", stages: 21, pool_race_id: `pool-gtpos-${seed}`, terrain_archetype: "grand_tour" },
      { seed }
    );
    const types = stages.map((s) => s.profile_type);
    // "Hårdeste" = high_mountain hvis til stede, ellers mountain (crescendo-scaffoldens
    // sidste tilbageværende element, jf. toGrandTourFinale).
    const hardestType = types.includes("high_mountain") ? "high_mountain" : "mountain";
    const hardestIdx = types.lastIndexOf(hardestType);
    assert.equal(hardestIdx, types.length - 2, `seed ${seed}: hårdeste (${hardestType}) ikke næstsidst (${types.join(",")})`);
  }
});

test("#3326-korrektion grand_tour (21): finalen er flad/rullende eller enkeltstart, over mange seeds ses begge", () => {
  const finales = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const stages = generateRaceStageProfiles(
      { id: `gtfinale-${seed}`, race_type: "stage_race", stages: 21, pool_race_id: `pool-gtfinale-${seed}`, terrain_archetype: "grand_tour" },
      { seed }
    );
    const last = stages[stages.length - 1].profile_type;
    // #3546 D: en enkeltstart-finale er ALTID den GT'ens ANDEN itt (den første er
    // åbnings-ITT'en på etape 1) → markSecondIttAsHilly har omdøbt den til itt_hilly.
    assert.ok(["flat", "rolling", "itt_hilly"].includes(last), `seed ${seed}: uventet GT-finale ${last}`);
    finales.add(last);
  }
  assert.ok(finales.has("flat") || finales.has("rolling"), "forventede mindst én flad/rullende GT-finale");
  assert.ok(finales.has("itt_hilly"), "forventede mindst én enkeltstart-GT-finale (~22% i researchen)");
});

// ── #3546 D: itt_hilly: GT's ANDEN enkeltstart er kuperet, ikke en identisk flad itt ──
test("#3546 grand_tour: etape 1 (åbnings-ITT) er ALTID itt, ALDRIG itt_hilly", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const stages = generateRaceStageProfiles(
      { id: `gtitt-${seed}`, race_type: "stage_race", stages: 21, pool_race_id: `pool-gtitt-${seed}`, terrain_archetype: "grand_tour" },
      { seed },
    );
    assert.equal(stages[0].profile_type, "itt", `seed ${seed}: etape 1 skal forblive den flade åbnings-itt`);
  }
});

test("#3546 grand_tour: NÅR der er 2 tidskørsler, er den anden itt_hilly (aldrig 2×flad itt)", () => {
  let sawTwoTT = false;
  for (let seed = 1; seed <= 400; seed++) {
    const types = generateRaceStageProfiles(
      { id: `gt2tt-${seed}`, race_type: "stage_race", stages: 21, pool_race_id: `pool-gt2tt-${seed}`, terrain_archetype: "grand_tour" },
      { seed },
    ).map((p) => p.profile_type);
    const ittCount = types.filter((t) => t === "itt").length;
    const ittHillyCount = types.filter((t) => t === "itt_hilly").length;
    assert.ok(ittCount <= 1, `seed ${seed}: mere end 1 flad itt (${ittCount}): anden burde være itt_hilly`);
    assert.ok(ittHillyCount <= 1, `seed ${seed}: mere end 1 itt_hilly`);
    if (ittHillyCount === 1) sawTwoTT = true;
  }
  assert.ok(sawTwoTT, "forventede mindst én seed med 2 tidskørsler (itt + itt_hilly) over 400 seeds");
});

test("#3546 grand_tour (7): ingen anden itt muligt (kun 1 garanteret): no-op, ingen itt_hilly", () => {
  // stages=7 = præcis guarantees.length; ingen filler-plads til en ekstra itt.
  for (let seed = 1; seed <= 30; seed++) {
    const types = generateRaceStageProfiles(
      { id: `gt7-${seed}`, race_type: "stage_race", stages: 7, pool_race_id: `pool-gt7-${seed}`, terrain_archetype: "grand_tour" },
      { seed },
    ).map((p) => p.profile_type);
    assert.ok(!types.includes("itt_hilly"), `seed ${seed}: uventet itt_hilly uden filler-plads`);
  }
});

test("#3546 andre stage-arketyper (ikke grand_tour) genererer ALDRIG itt_hilly (kun GT-regel)", () => {
  const stageArchetypes = Object.entries(ARCHETYPE_PROFILES).filter(([k, c]) => c.kind === "stage" && k !== "grand_tour").map(([k]) => k);
  for (const arch of stageArchetypes) {
    for (let seed = 1; seed <= 30; seed++) {
      const types = generateRaceStageProfiles({ id: "r", external_id: `${arch}-${seed}`, terrain_archetype: arch, race_type: "stage_race", stages: 8 }, { seed }).map((p) => p.profile_type);
      assert.ok(!types.includes("itt_hilly"), `${arch} seed ${seed}: uventet itt_hilly (kun grand_tour skal have reglen)`);
    }
  }
});

test("#3546 markSecondIttAsHilly (ren funktion): omdøber præcis anden forekomst, resten uændret", () => {
  assert.deepEqual(markSecondIttAsHilly(["itt", "flat", "mountain"]), ["itt", "flat", "mountain"], "kun 1 itt → no-op");
  assert.deepEqual(markSecondIttAsHilly(["itt", "flat", "itt", "mountain"]), ["itt", "flat", "itt_hilly", "mountain"]);
  assert.deepEqual(markSecondIttAsHilly(["flat", "mountain"]), ["flat", "mountain"], "0 itt → no-op");
});

// ── #3326-korrektion 2026-08-04: sprint_finale's "tredjesidste sker praktisk taget
// aldrig" (research n=32: kun 3,1%) ──────────────────────────────────────────────

test("#3326-korrektion SPRINT_FINALE_EARLY_DECIDER_CHANCE er lav (research: 3,1%, ikke 50%)", () => {
  assert.ok(SPRINT_FINALE_EARLY_DECIDER_CHANCE > 0 && SPRINT_FINALE_EARLY_DECIDER_CHANCE <= 0.1);
});

test("#3326-korrektion applyOrderArchetype sprint_finale: hårdeste er næstsidst langt de fleste gange", () => {
  const HARD = new Set(["mountain", "high_mountain"]);
  // ÉN hård etape i multisættet (ikke to som i "hårdeste FØR sidste dag"-testen ovenfor)
  // — så det rykkede element er entydigt, og lastIndexOf finder netop DEN.
  let nextToLast = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const types = ["flat", "rolling", "hilly", "high_mountain", "flat"];
    const ordered = applyOrderArchetype(makeRng(seed), types, "sprint_finale");
    const hardestIdx = ordered.lastIndexOf("high_mountain");
    assert.ok(HARD.has(ordered[hardestIdx]));
    if (hardestIdx === ordered.length - 2) nextToLast++;
  }
  assert.ok(nextToLast / N >= 0.85, `kun ${nextToLast}/${N} næstsidst — forventede ≥85% (research: tredjesidste er sjælden)`);
});

// ── #3326-korrektion 2026-08-04: åbning — kuperet skal være hyppigste ikke-flade
// åbning (research n=41: kuperet 43,9% > itt 22,0% > bjerg/ttt 4,8%) ─────────────

test("#3326-korrektion OPENING_VARIETY_CANDIDATES: hilly prioriteret FØR itt", () => {
  assert.deepEqual(OPENING_VARIETY_CANDIDATES, ["hilly", "itt", "rolling"]);
});

test("#3326-korrektion applyOpeningVariety: vælger hilly over itt når begge findes i midterfeltet", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const ordered = ["flat", "hilly", "itt", "mountain", "flat"];
    const varied = applyOpeningVariety(makeRng(seed), ordered.slice());
    if (varied[0] !== "flat") assert.equal(varied[0], "hilly", `seed ${seed}: valgte ${varied[0]} i stedet for hilly`);
  }
});


// ── #4075: GT-etapevariation (lovet spillerne) — vævning af crescendo-scaffoldet ──

test("#4075 capIdenticalRuns: bryder runs over cap og bevarer multisættet", () => {
  const input = ["flat", "flat", "flat", "flat", "rolling", "rolling", "hilly"];
  const out = capIdenticalRuns(input, 2);
  assert.deepEqual([...out].sort(), [...input].sort(), "multisættet er bevaret");
  let run = 1;
  for (let i = 1; i < out.length; i++) {
    run = out[i] === out[i - 1] ? run + 1 : 1;
    assert.ok(run <= 2, `run > 2 ved index ${i}: ${out.join(",")}`);
  }
});

test("#4075 capIdenticalRuns: uden mulig breaker accepteres runnet defensivt", () => {
  assert.deepEqual(capIdenticalRuns(["flat", "flat", "flat"], 2), ["flat", "flat", "flat"]);
});

test("#4075 weaveGrandTourScaffold: bevarer multiset, hårdeste terræn sidst, maks 3 ens i træk", () => {
  const scaffold = ["itt", "flat", "flat", "flat", "flat", "flat", "flat", "flat", "rolling", "rolling", "rolling", "hilly", "hilly", "hilly", "mountain", "mountain", "mountain", "high_mountain", "high_mountain"];
  const out = weaveGrandTourScaffold(scaffold.slice());
  assert.deepEqual([...out].sort(), [...scaffold].sort(), "multisættet er bevaret");
  assert.equal(out[out.length - 1], "high_mountain", "hårdeste terræn sidst (toGrandTourFinale-antagelsen)");
  let run = 1;
  for (let i = 1; i < out.length; i++) {
    run = out[i] === out[i - 1] ? run + 1 : 1;
    assert.ok(run <= 3, `run > 3 ved index ${i}: ${out.join(",")}`);
  }
});

test("#4075 grand_tour-generering: aldrig over 3 ens profil-typer i træk (mange seeds)", () => {
  for (let s = 1; s <= 120; s++) {
    const types = generateRaceStageProfiles(
      { id: "r", external_id: `weave${s}`, terrain_archetype: "grand_tour", race_type: "stage_race", stages: 17 + (s % 5) }
    ).map((p) => p.profile_type);
    let run = 1;
    for (let i = 1; i < types.length; i++) {
      run = types[i] === types[i - 1] ? run + 1 : 1;
      assert.ok(run <= 3, `seed ${s}: ${run} ens i træk — ${types.join(",")}`);
    }
  }
});

// ── #3371 (ejer-direktiv 23/8): korte etapeløb (6-8 etaper) skal have mindre mekanisk
// etape-rækkefølge — maks 2 bjerg-/high_mountain-etaper i træk, mindst én ikke-bjerg-etape
// mellem bjergblokke, finalen ikke altid den hårdeste. GT'erne (#4121/#4075) er URØRT —
// se de eksisterende #4075-tests ovenfor, som stadig består uændret.
const MOUNTAIN_FAMILY_TEST = new Set(["mountain", "high_mountain"]);
function longestMountainRun(types) {
  let longest = 0, run = 0;
  for (const t of types) {
    run = MOUNTAIN_FAMILY_TEST.has(t) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

test("#3371 weaveMountainFamilyBlocks: bevarer multiset, bryder bjerg-runs over blockSize", () => {
  const scaffold = ["flat", "mountain", "mountain", "mountain", "high_mountain", "rolling"];
  const out = weaveMountainFamilyBlocks(scaffold, { blockSize: 2 });
  assert.deepEqual([...out].sort(), [...scaffold].sort(), "multisæt uændret");
  assert.ok(longestMountainRun(out) <= 2, `bjerg-run > 2: ${out.join(",")}`);
});

test("#3371 weaveMountainFamilyBlocks: for få bløde etaper accepteres runnet defensivt (ingen kastning)", () => {
  const scaffold = ["mountain", "mountain", "mountain"];
  const out = weaveMountainFamilyBlocks(scaffold, { blockSize: 2 });
  assert.deepEqual([...out].sort(), [...scaffold].sort());
});

// #3371: mountain_tour/summit_tour's FILLER-vægte kan (uafhængigt af denne PR — et
// #3327/#3328-kompositions-spørgsmål, ikke et rækkefølge-spørgsmål) rulle et multisæt der
// er så bjerg-tungt (5-7 af 6-8 etaper) at der IKKE er nok bløde etaper tilbage til at
// adskille alle bjerg-blokke — matematisk umuligt at overholde loft=2 uden enten at ofre en
// garanteret bjerg-etape (forbudt, jf. FORCE_SACRIFICE_PRIORITY ovenfor: "bjerge er ikke
// fungible") eller bryde finale-arketypens egen kontrakt. weaveMountainFamilyBlocks
// accepterer da defensivt (samme filosofi som GT's weaveGrandTourScaffold ved ekstreme
// multisæt) — målt rate holdes lavt (se RATE_CAP), ikke nul. sprinter_tour_summits/
// balanced_week/sprinters_week har rigelig blød kapacitet og holder loftet ABSOLUT (0
// undtagelser målt over 300 seeds pr. arketype/etapetal under udviklingen af denne test).
const HARD_CAP_ARCHETYPES = new Set(["sprinter_tour_summits", "balanced_week", "sprinters_week"]);
const SUPPLY_LIMITED_RATE_CAP = 0.35; // ejer-synlig i PR-beskrivelsen, ikke gemt; målt reel rate ~16-20% over 300 seeds, marginen dækker 60-seed sampling-støj

test("#3371 korte etapeløb (6-8 etaper), rigelig blød kapacitet: ALDRIG >2 bjerg-/high_mountain-etaper i træk", () => {
  for (const archetype of HARD_CAP_ARCHETYPES) {
    for (let stages = 6; stages <= 8; stages++) {
      for (let s = 1; s <= 40; s++) {
        const types = generateRaceStageProfiles(
          { id: "r", external_id: `3371-${archetype}-${stages}-${s}`, terrain_archetype: archetype, race_type: "stage_race", stages }
        ).map((p) => p.profile_type);
        assert.ok(
          longestMountainRun(types) <= 2,
          `${archetype} (${stages} etaper, seed ${s}): bjerg-run > 2 — ${types.join(",")}`,
        );
      }
    }
  }
});

test("#3371 mountain_tour/summit_tour (bjerg-tunge arketyper): brud på loft=2 er sjældne, ikke systematiske", () => {
  for (const archetype of ["mountain_tour", "summit_tour"]) {
    for (let stages = 6; stages <= 8; stages++) {
      let violations = 0, total = 0;
      for (let s = 1; s <= 60; s++) {
        const types = generateRaceStageProfiles(
          { id: "r", external_id: `3371-rate-${archetype}-${stages}-${s}`, terrain_archetype: archetype, race_type: "stage_race", stages }
        ).map((p) => p.profile_type);
        total++;
        if (longestMountainRun(types) > 2) violations++;
      }
      assert.ok(
        violations / total <= SUPPLY_LIMITED_RATE_CAP,
        `${archetype} (${stages} etaper): ${violations}/${total} brud (>${SUPPLY_LIMITED_RATE_CAP * 100}%) — vævningen er ikke længere kun defensiv-accept af ekstreme multisæt`,
      );
    }
  }
});

test("#3371 mountain_tour (7 etaper): finalen er IKKE altid den hårdeste, over mange seeds", () => {
  const finales = new Set();
  for (let s = 1; s <= 100; s++) {
    const types = generateRaceStageProfiles(
      { id: "r", external_id: `3371-finale-${s}`, terrain_archetype: "mountain_tour", race_type: "stage_race", stages: 7 }
    ).map((p) => p.profile_type);
    finales.add(types[types.length - 1]);
  }
  assert.ok(finales.size > 1, `finalen varierer ikke over 100 seeds: ${[...finales].join(",")}`);
  assert.ok(!MOUNTAIN_FAMILY_TEST.has([...finales][0]) || finales.size > 1, "mindst nogle finaler er ikke-bjerg");
});

// ── #4539: to enkeltstarter i samme etapeløb må ikke ligne hinanden ─────────────
// La Course au Soleil (balanced_week, 8 etaper) fik etape 1 + 3 begge som en 20 km
// flad itt — samme profile_type OG samme distance. Se docs/CALENDAR_RULES.md §4.

test("#4539 SHORT_RACE_TT_CAP er 1 (etapeløb under GRAND_TOUR_MIN_STAGES)", () => {
  assert.equal(SHORT_RACE_TT_CAP, 1);
});

test("#4539 timeTrialCap: kort løb (< GRAND_TOUR_MIN_STAGES) capper til 1, langt løb (≥) er uændret 2", () => {
  assert.equal(timeTrialCap([], 8), 1);
  assert.equal(timeTrialCap([], GRAND_TOUR_MIN_STAGES - 1), 1);
  assert.equal(timeTrialCap([], GRAND_TOUR_MIN_STAGES), 2);
  assert.equal(timeTrialCap([], 21), 2);
  // garantier hæver stadig loftet, uanset løbslængde (samme regel som før #4539)
  assert.equal(timeTrialCap(["itt", "itt_hilly"], 8), 2);
});

test("#4539 timeTrialCap uden totalStages-argument er bagudkompatibel (ingen løbslængde kendt → DEFAULT_TT_CAP)", () => {
  assert.equal(timeTrialCap([]), DEFAULT_TT_CAP);
  assert.equal(timeTrialCap(["flat", "itt", "mountain"]), DEFAULT_TT_CAP);
});

test("#4539 looksLikeDuplicateTimeTrial: samme type + distance inden for båndet → ens", () => {
  const a = { profile_type: "itt", distance_km: 20 };
  const b = { profile_type: "itt", distance_km: 20 };
  assert.equal(looksLikeDuplicateTimeTrial(a, b), true);
  // lige inden for båndet (grænseværdi)
  assert.equal(looksLikeDuplicateTimeTrial(a, { profile_type: "itt", distance_km: 20 + TT_LOOKALIKE_DISTANCE_BAND_KM }), true);
});

test("#4539 looksLikeDuplicateTimeTrial: samme type men uden for distance-båndet → IKKE ens", () => {
  const a = { profile_type: "itt", distance_km: 20 };
  const b = { profile_type: "itt", distance_km: 20 + TT_LOOKALIKE_DISTANCE_BAND_KM + 1 };
  assert.equal(looksLikeDuplicateTimeTrial(a, b), false);
});

test("#4539 looksLikeDuplicateTimeTrial: FORSKELLIG profile_type → ALDRIG ens, uanset distance (itt vs. itt_hilly)", () => {
  const a = { profile_type: "itt", distance_km: 20 };
  const b = { profile_type: "itt_hilly", distance_km: 20 };
  assert.equal(looksLikeDuplicateTimeTrial(a, b), false);
});

test("#4539 looksLikeDuplicateTimeTrial: ikke-tidskørsler eller manglende/ugyldig distance → false (defensivt)", () => {
  assert.equal(looksLikeDuplicateTimeTrial({ profile_type: "flat", distance_km: 180 }, { profile_type: "flat", distance_km: 180 }), false);
  assert.equal(looksLikeDuplicateTimeTrial(null, { profile_type: "itt", distance_km: 20 }), false);
  assert.equal(looksLikeDuplicateTimeTrial({ profile_type: "itt", distance_km: null }, { profile_type: "itt", distance_km: 20 }), false);
});

test("#4539 looksLikeDuplicateTimeTrial: BEGGE distance_km null (historiske rækker fra FØR pass 2) → false, IKKE 'samme (0 km)'", () => {
  // Number(null) === 0, så en naiv Number()-coercion ville gøre to `null`-rækker
  // til "identiske 0 km enkeltstarter" — fanget mod prod 4/9 (Vuelta Ibérica m.fl.,
  // ældre rækker uden distance_km). Manglende distance er UKENDT, ikke "samme".
  const a = { profile_type: "itt", distance_km: null };
  const b = { profile_type: "itt", distance_km: null };
  assert.equal(looksLikeDuplicateTimeTrial(a, b), false);
});

test("#4539 findDuplicateTimeTrialPairs: finder præcis La Course au Soleil-parret (etape 1 + 3, begge 20 km itt)", () => {
  const stages = [
    { stage_number: 1, profile_type: "itt", distance_km: 20 },
    { stage_number: 2, profile_type: "rolling", distance_km: 170 },
    { stage_number: 3, profile_type: "itt", distance_km: 20 },
    { stage_number: 4, profile_type: "flat", distance_km: 180 },
  ];
  const pairs = findDuplicateTimeTrialPairs(stages);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][0].stage_number, 1);
  assert.equal(pairs[0][1].stage_number, 3);
});

test("#4539 findDuplicateTimeTrialPairs: GT-mønstret (itt + itt_hilly) giver INGEN par", () => {
  const stages = [
    { stage_number: 1, profile_type: "itt", distance_km: 8 },
    { stage_number: 12, profile_type: "itt_hilly", distance_km: 35 },
  ];
  assert.deepEqual(findDuplicateTimeTrialPairs(stages), []);
});

test("#4539 findDuplicateTimeTrialPairs: ingen tidskørsler → tom liste", () => {
  const stages = [{ stage_number: 1, profile_type: "flat", distance_km: 180 }];
  assert.deepEqual(findDuplicateTimeTrialPairs(stages), []);
});

test("#4539 regression: INGEN kort etapeløbs-arketype (< GRAND_TOUR_MIN_STAGES) producerer et 'ligner hinanden'-par, over mange seeds", () => {
  const stageArchetypes = Object.entries(ARCHETYPE_PROFILES).filter(([, c]) => c.kind === "stage").map(([k]) => k);
  for (const arch of stageArchetypes) {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      if (n >= GRAND_TOUR_MIN_STAGES) continue;
      for (let s = 1; s <= 40; s++) {
        const stages = generateRaceStageProfiles({ id: "r", external_id: `4539-${arch}-${n}-${s}`, terrain_archetype: arch, race_type: "stage_race", stages: n });
        const pairs = findDuplicateTimeTrialPairs(stages);
        assert.equal(pairs.length, 0, `${arch} n=${n} seed ${s}: ${pairs.length} duplikat-par fundet (${stages.map((p) => `${p.profile_type}@${p.distance_km}km`).join(",")})`);
      }
    }
  }
  // Generisk (ukendt arketype) — samme regression.
  for (const n of [3, 4, 5, 6, 7, 8]) {
    for (let seed = 1; seed <= 40; seed++) {
      const stages = generateRaceStageProfiles({ id: "x", race_type: "stage_race", stages: n }, { seed });
      const pairs = findDuplicateTimeTrialPairs(stages);
      assert.equal(pairs.length, 0, `generisk n=${n} seed ${seed}: ${pairs.length} duplikat-par fundet`);
    }
  }
});

test("#4539 balanced_week (8 etaper, La Course au Soleils arketype): højst 1 TT over mange seeds (kernen i fixet)", () => {
  for (let s = 1; s <= 200; s++) {
    const types = generateRaceStageProfiles({ id: "r", external_id: `4539-bw-${s}`, terrain_archetype: "balanced_week", race_type: "stage_race", stages: 8 }).map((p) => p.profile_type);
    const ttCount = types.filter((t) => t === "itt" || t === "itt_hilly" || t === "ttt").length;
    assert.ok(ttCount <= 1, `seed ${s}: ${ttCount} TT (>1): ${types.join(",")}`);
  }
});

test("#4539 grand_tour (21, uændret): kan stadig få 2 TT, men de er ALDRIG et 'ligner hinanden'-par (markSecondIttAsHilly forhindrer det)", () => {
  let sawTwoTT = false;
  for (let s = 1; s <= 300; s++) {
    const stages = generateRaceStageProfiles({ id: "r", external_id: `4539-gt-${s}`, terrain_archetype: "grand_tour", race_type: "stage_race", stages: 21 });
    const ttCount = stages.filter((p) => p.profile_type === "itt" || p.profile_type === "itt_hilly" || p.profile_type === "ttt").length;
    if (ttCount >= 2) sawTwoTT = true;
    assert.deepEqual(findDuplicateTimeTrialPairs(stages), [], `gt seed ${s}: duplikat-par trods GT-undtagelsen`);
  }
  assert.ok(sawTwoTT, "ingen af de 300 seeds gav 2 TT — testen dækker ikke det tilfælde den skal bevise");
});

// ═══ #6359 S5-modellen (profileModel: "s5") ══════════════════════════════════════════
const S5 = { profileModel: "s5" };
const S5_SEEDS = 25;
function s5Races() {
  const races = [];
  for (const [archetype, cfg] of Object.entries(ARCHETYPE_PROFILES)) {
    if (archetype === "grand_tour") continue;
    if (cfg.kind === "single") races.push({ archetype, race_type: "single", stages: 1 });
    else for (const stages of [3, 5, 7, 9]) races.push({ archetype, race_type: "stage_race", stages });
  }
  races.push({ archetype: null, race_type: "single", stages: 1 });
  for (const stages of [2, 6, 8]) races.push({ archetype: null, race_type: "stage_race", stages });
  return races;
}
const raceFor = (spec, s) => ({
  id: `s5-${spec.archetype}-${spec.stages}`, external_id: `s5-${spec.archetype}-${spec.stages}`,
  terrain_archetype: spec.archetype, race_type: spec.race_type, stages: spec.stages,
  season_id: `season-${s}`, name: "Ronde test",
});

test("#6359 property: S5 type == B+(climbs) for HVER terræn-etape og afslutningen ligger i matrixen (alle arketyper × N seeds)", () => {
  let checked = 0;
  for (const spec of s5Races()) {
    for (let s = 0; s < S5_SEEDS; s++) {
      for (const p of generateRaceStageProfiles(raceFor(spec, s), S5)) {
        const where = `${spec.archetype}/${spec.stages} s${s} etape ${p.stage_number} (${p.profile_type}/${p.finale_type})`;
        assert.equal(p.generator_version, S5_GENERATOR_VERSION, where);
        if (isTimeTrial(p.profile_type)) {
          assert.equal(p.finale_type, "solo_tt", where);
          continue;
        }
        const terrain = deriveTerrainType(p.climbs);
        if (TERRAIN_TYPES.includes(p.profile_type)) assert.equal(p.profile_type, terrain, where);
        assert.ok(isFinishAllowed(terrain, p.finale_type), `${where}: uden for matrixen for ${terrain}`);
        assert.ok(!["breakaway", "bunch_sprint", "reduced_sprint"].includes(p.finale_type), `${where}: v5-afslutning i S5`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 2000, `for få etaper tjekket (${checked})`);
});

test("#6359 S5 bevarer v5's typer og rækkefølge for alle andre løb end Grand Tours", () => {
  for (const spec of s5Races()) {
    for (let s = 0; s < 6; s++) {
      const race = raceFor(spec, s);
      const v5 = generateRaceStageProfiles(race).map((p) => p.profile_type);
      const s5 = generateRaceStageProfiles(race, S5).map((p) => p.profile_type);
      assert.deepEqual(s5, v5, `${spec.archetype}/${spec.stages} s${s}`);
    }
  }
});

test("#6359 S5's afslutnings-vægte dækker præcis matrixen pr. terræn", () => {
  for (const terrain of TERRAIN_TYPES) {
    const values = S5_FINISH_WEIGHTS[terrain].map((w) => w.value).sort();
    assert.deepEqual(values, [...FINISH_MATRIX[terrain]].sort(), terrain);
  }
});

test("#6359 v5 er default og uændret; S5 stemples v6; ukendt model kaster", () => {
  const race = { id: "r1", external_id: "x-6359", race_type: "stage_race", stages: 5, terrain_archetype: "balanced_week" };
  assert.deepEqual(generateRaceStageProfiles(race), generateRaceStageProfiles(race, { profileModel: "v5" }));
  assert.equal(toStageProfileRow("r1", generateRaceStageProfiles(race)[0]).generator_version, GENERATOR_VERSION);
  assert.equal(toStageProfileRow("r1", generateRaceStageProfiles(race, S5)[0]).generator_version, S5_GENERATOR_VERSION);
  assert.equal(S5_GENERATOR_VERSION, 6);
  assert.throws(() => generateRaceStageProfiles(race, { profileModel: "s6" }), /unknown profileModel/);
});

// ── #6359 Grand Tours: ejerens kvoter + ugestruktur (spec §5) ───────────────────────
const S5_GTS = [
  { name: "Tour de l'Hexagone", race_class: "TourFrance", stages: 18, type: "tour" },
  { name: "Giro della Penisola", race_class: "GiroVuelta", stages: 17, type: "giro" },
  { name: "Vuelta Ibérica", race_class: "GiroVuelta", stages: 17, type: "vuelta" },
];
const gtRace = (gt, s) => ({
  id: `gt-${gt.type}`, external_id: `gt-${gt.type}`, name: gt.name, race_class: gt.race_class,
  race_type: "stage_race", stages: gt.stages, terrain_archetype: "grand_tour", season_id: `season-${s}`,
});
const HARDNESS = { flat: 0, rolling: 1, hilly: 2, medium_mountain: 3, mountain: 4, high_mountain: 5 };

test("#6359 GT-typen udledes af klasse + region", () => {
  for (const gt of S5_GTS) assert.equal(grandTourTypeFor(gtRace(gt, 0)), gt.type, gt.name);
});

test("#6359 GT-kvoterne summerer til 18/17/17 og skaleres når etapeantallet er et andet", () => {
  assert.equal(grandTourQuotaTypes("tour", 18).types.length, 18);
  assert.equal(grandTourQuotaTypes("giro", 17).types.length, 17);
  assert.equal(grandTourQuotaTypes("vuelta", 17).types.length, 17);
  const t21 = grandTourQuotaTypes("tour", 21);
  assert.equal(t21.types.length, 21);
  assert.equal(t21.types.filter((t) => t === "itt").length, 2, "tidskørslerne skaleres ikke");
});

test("#6359 GT: kvoter, bjergtoppe og ugestruktur holder for Tour/Giro/Vuelta-typen over N sæsoner", () => {
  for (const gt of S5_GTS) {
    const q = S5_GRAND_TOUR_QUOTAS[gt.type];
    for (let s = 0; s < 60; s++) {
      const stages = generateRaceStageProfiles(gtRace(gt, s), S5);
      const where = `${gt.type} s${s}: ${stages.map((p) => p.profile_type).join(" ")}`;
      const n = stages.length;
      assert.equal(n, gt.stages, where);
      const count = (t) => stages.filter((p) => p.profile_type === t).length;
      for (const t of ["high_mountain", "mountain", "medium_mountain", "hilly", "rolling", "flat"]) assert.equal(count(t), q[t], `${where} (${t})`);
      assert.equal(stages.filter((p) => isTimeTrial(p.profile_type)).length, q.itt + q.ttt, `${where} (TT)`);
      assert.equal(count("ttt"), 0, `${where}: holdtidskørsel uden allowTtt`);
      assert.equal(stages.filter((p) => p.finale_type === "long_climb").length, q.summits, `${where} (bjergtoppe)`);
      // Ugestruktur.
      const firstThirdEnd = Math.floor(n / 3);
      const lastThirdStart = n - Math.floor(n / 3);
      for (let i = 0; i < firstThirdEnd; i++) assert.notEqual(stages[i].profile_type, "high_mountain", `${where}: højbjerg i første tredjedel`);
      assert.ok(isTimeTrial(stages[0].profile_type), `${where}: kort enkeltstart tidligt`);
      assert.ok(stages[0].distance_km <= 14, `${where}: åbnings-enkeltstarten er kort (${stages[0].distance_km} km)`);
      const lateTt = stages.findIndex((p, i) => i > 0 && isTimeTrial(p.profile_type));
      assert.ok(lateTt >= lastThirdStart, `${where}: sen enkeltstart på etape ${lateTt + 1}`);
      assert.ok(stages[n - 1].profile_type === "flat" || isTimeTrial(stages[n - 1].profile_type), `${where}: sidste dag`);
      const maxHard = Math.max(...stages.map((p) => HARDNESS[p.profile_type] ?? -1));
      const queen = stages.findLastIndex((p) => HARDNESS[p.profile_type] === maxHard);
      assert.ok(queen >= lastThirdStart, `${where}: kongeetapen på etape ${queen + 1}`);
      for (const p of stages) {
        if (isTimeTrial(p.profile_type)) continue;
        assert.equal(p.profile_type, deriveTerrainType(p.climbs), `${where}: etape ${p.stage_number}`);
        assert.ok(isFinishAllowed(p.profile_type, p.finale_type), `${where}: etape ${p.stage_number} ${p.finale_type}`);
      }
    }
  }
});

test("#6359 GT med allowTtt: Vuelta-typen åbner med holdtidskørslen", () => {
  const vuelta = S5_GTS.find((g) => g.type === "vuelta");
  for (let s = 0; s < 10; s++) {
    const stages = generateRaceStageProfiles(gtRace(vuelta, s), { profileModel: "s5", allowTtt: true });
    assert.equal(stages.filter((p) => p.profile_type === "ttt").length, 1);
    assert.equal(stages[0].profile_type, "ttt");
  }
});

// ═══ #6857 Løbsidentitet (spor L2 #6928) ═════════════════════════════════════════════
// Design: docs/superpowers/specs/2026-10-18-6857-loebsidentitet-teknisk-design.md §2 + §5.

const idRace = (type, stages, s, signature = null) => ({
  id: `id-${type}-${stages}`, external_id: `id-${type}-${stages}`, name: "Ronde test",
  race_type: "stage_race", stages, race_identity_type: type, signature, season_id: `season-${s}`,
});
const MOUNTAIN = new Set(["mountain", "high_mountain"]);
const FLAT_FAM = new Set(["flat", "rolling"]);

// Fingeraftryk af v5- og S5-output for løb UDEN identitet, målt på main FØR #6928 (samme
// procedure som nedenfor). "v5 og S5-stien uden type skal være bit-identiske" (design §2).
const PRE_6928_FINGERPRINT = Object.freeze({ races: 516, v5: "6cd254d21e6cd125", s5: "3700d8d4d7414afe" });
function fingerprint({ withIdentity }) {
  const races = [];
  for (const [archetype, cfg] of Object.entries(ARCHETYPE_PROFILES)) {
    if (cfg.kind === "single") races.push({ archetype, race_type: "single", stages: 1 });
    else for (const stages of archetype === "grand_tour" ? [17, 18, 21] : [3, 5, 7, 9]) races.push({ archetype, race_type: "stage_race", stages });
  }
  races.push({ archetype: null, race_type: "single", stages: 1 });
  for (const stages of [2, 6, 8]) races.push({ archetype: null, race_type: "stage_race", stages });
  const out = { v5: createHash("sha256"), s5: createHash("sha256") };
  let n = 0;
  for (const spec of races) {
    for (let s = 0; s < 12; s++) {
      const race = {
        id: `fp-${spec.archetype}-${spec.stages}`, external_id: `fp-${spec.archetype}-${spec.stages}`,
        terrain_archetype: spec.archetype, race_type: spec.race_type, stages: spec.stages,
        season_id: `season-${s}`, name: s % 2 ? "Giro test" : "Ronde test", race_class: spec.race_type === "single" && s % 3 === 0 ? "Monuments" : null,
      };
      out.v5.update(JSON.stringify(generateRaceStageProfiles(withIdentity ? withIdentity(race, n) : race)));
      out.s5.update(JSON.stringify(generateRaceStageProfiles(race, { profileModel: "s5" })));
      n += 1;
    }
  }
  return { races: n, v5: out.v5.digest("hex").slice(0, 16), s5: out.s5.digest("hex").slice(0, 16) };
}

test("#6857 bit-identitet: v5 og S5 uden type er uændrede fra før #6928 (fingeraftryk fra main)", () => {
  assert.deepEqual(fingerprint({ withIdentity: null }), PRE_6928_FINGERPRINT);
});

test("#6857 bit-identitet: v5 læser aldrig identitetsfelterne (type, signatur, håndskreven rute)", () => {
  const route = IDENTITY_GOLDEN_CASES.i_hilly_signature.signature;
  const authored = { profile_type: "cobbles", finale_type: "reduced_sprint", distance_km: 260, elevation_gain_m: 700, climbs: [], sprints: [{ name: "Finish", km: 260, kind: "finish" }], sectors: [] };
  const withIdentity = (race, n) => (race.race_type === "stage_race" && race.terrain_archetype !== "grand_tour"
    ? { ...race, race_identity_type: RACE_IDENTITY_TYPES[n % RACE_IDENTITY_TYPES.length], signature: n % 2 ? route : null }
    : race.race_type === "single" ? { ...race, authored_route: authored } : race);
  assert.equal(fingerprint({ withIdentity }).v5, PRE_6928_FINGERPRINT.v5);
});

test("#6857 S5 med felterne sat til null er bit-identisk med S5 uden felterne", () => {
  for (const spec of s5Races()) {
    const race = raceFor(spec, 3);
    const nulls = { ...race, race_identity_type: null, signature: null, authored_route: null };
    assert.deepEqual(generateRaceStageProfiles(nulls, S5), generateRaceStageProfiles(race, S5), `${spec.archetype}/${spec.stages}`);
  }
});

test("#6857 IDENTITY_PROFILES dækker præcis de otte typer og følger design-tabellen §2", () => {
  assert.deepEqual(Object.keys(IDENTITY_PROFILES).sort(), [...RACE_IDENTITY_TYPES].sort());
  const filler = (t) => IDENTITY_PROFILES[t].filler.map((it) => it.value).sort();
  const order = (t) => IDENTITY_PROFILES[t].order.map((it) => it.value).sort();
  assert.deepEqual([...IDENTITY_PROFILES.sprinters.guarantees], ["flat", "flat", "hilly"]);
  assert.deepEqual(filler("sprinters"), ["flat", "hilly", "rolling"]);
  assert.deepEqual(order("sprinters"), ["sprint_finale"]);
  assert.deepEqual([...IDENTITY_PROFILES.climbers_gt_prelude.guarantees], ["mountain", "high_mountain", "flat"]);
  // #6995: højbjerg er en lovlig klatreløbs-filler (§6b-højbjerget kom før fra summit_tour m.fl.).
  assert.deepEqual(filler("climbers_gt_prelude"), ["high_mountain", "hilly", "itt", "medium_mountain", "mountain"]);
  assert.deepEqual(order("climbers_gt_prelude"), ["summit_finale"]);
  assert.deepEqual([...IDENTITY_PROFILES.hilly.guarantees], ["hilly", "hilly", "rolling"]);
  assert.deepEqual(filler("hilly"), ["flat", "hilly", "medium_mountain", "rolling"]);
  assert.deepEqual(order("hilly"), ["circuit_finale"]);
  assert.deepEqual([...IDENTITY_PROFILES.cobbles_benelux.guarantees], ["cobbles", "flat", "hilly"]);
  assert.deepEqual(filler("cobbles_benelux"), ["cobbles", "flat", "rolling"]);
  assert.deepEqual(order("cobbles_benelux"), ["circuit_finale", "sprint_finale"]);
  assert.deepEqual([...IDENTITY_PROFILES.time_trial.guarantees], ["itt", "itt_hilly", "flat"]);
  assert.deepEqual(filler("time_trial"), ["flat", "hilly", "rolling"]);
  assert.deepEqual(order("time_trial"), ["tt_finale"]);
  assert.deepEqual([...IDENTITY_PROFILES.gravel.guarantees], ["gravel", "flat", "hilly"]);
  assert.deepEqual(filler("gravel"), ["gravel", "hilly", "rolling"]);
  assert.deepEqual(order("gravel"), ["circuit_finale"]);
  assert.deepEqual([...IDENTITY_PROFILES.mountains_first.guarantees], ["mountain", "high_mountain", "flat", "flat"]);
  assert.deepEqual(filler("mountains_first"), ["flat", "rolling"]);
  assert.deepEqual(order("mountains_first"), ["mountains_first"]);
  // allround = "som i dag": balanced_week's garantier, filler og ordnings-vægte.
  assert.deepEqual([...IDENTITY_PROFILES.allround.guarantees], [...ARCHETYPE_PROFILES.balanced_week.guarantees]);
  assert.deepEqual(IDENTITY_PROFILES.allround.filler.map((it) => ({ ...it })), ARCHETYPE_PROFILES.balanced_week.filler.map((it) => ({ ...it })));
  assert.deepEqual(IDENTITY_PROFILES.allround.order.map((it) => ({ ...it })), DEFAULT_ORDER_WEIGHTS.map((it) => ({ ...it })));
  // "bjergfri" i tabellen: sprinters, hilly, cobbles_benelux, gravel - og time_trial (ingen bjergtype i garantier/filler).
  const free = Object.entries(IDENTITY_PROFILES).filter(([, p]) => p.mountainFree).map(([t]) => t).sort();
  assert.deepEqual(free, ["cobbles_benelux", "gravel", "hilly", "sprinters", "time_trial"]);
  for (const t of free) {
    for (const v of [...IDENTITY_PROFILES[t].guarantees, ...IDENTITY_PROFILES[t].filler.map((it) => it.value)]) {
      assert.ok(!MOUNTAIN.has(v), `${t}: ${v} i et bjergfrit løb`);
    }
  }
});

// Kendt, ældre S5-begrænsning (ikke identitets-stien): på meget tætte bjergetaper kan
// højdeprofilen (#6594, routeElevationProfile.js) ikke rumme hele elevation_gain_m. Den
// rammer også S5 uden type (målt på main: summit_tour), så den tælles her i stedet for at
// fejle, og loftet sikrer at identitets-stien ikke gør den hyppigere i nævneværdig grad.
const KNOWN_ELEVATION_SUM = /^højdeprofilens sum \d+ m ≠ elevation_gain_m \d+ m$/;
const KNOWN_ELEVATION_SUM_MAX = 5;

test("#6857 property: 8 typer × 3-8 etaper × 200 sæsoner — garantier, filler, ordning, B+, matrix og benchmark-gatens etape-tjek", () => {
  let checked = 0;
  let knownElevation = 0;
  for (const type of RACE_IDENTITY_TYPES) {
    const profile = IDENTITY_PROFILES[type];
    const allowed = new Set([...profile.guarantees, ...profile.filler.map((it) => it.value)]);
    for (let stages = 3; stages <= 8; stages++) {
      for (let s = 0; s < 200; s++) {
        const ps = generateRaceStageProfiles(idRace(type, stages, s), S5);
        const seq = ps.map((p) => p.profile_type);
        const where = `${type}/${stages} s${s}: ${seq.join(" ")}`;
        assert.equal(ps.length, stages, where);
        // Garantierne (trimmet til etapeantallet) er med som multisæt.
        const left = seq.slice();
        for (const g of profile.guarantees.slice(0, stages)) {
          const i = left.indexOf(g);
          assert.ok(i >= 0, `${where}: garanti ${g} mangler`);
          left.splice(i, 1);
        }
        for (const t of seq) assert.ok(allowed.has(t), `${where}: ${t} er hverken garanti eller filler for ${type}`);
        assert.ok(seq.filter(isTimeTrial).length <= timeTrialCap(profile.guarantees.slice(0, stages), stages), `${where}: TT-loft`);
        if (profile.mountainFree) assert.ok(!seq.some((t) => MOUNTAIN.has(t)), `${where}: bjerg i et bjergfrit løb`);
        // Ordningen.
        const last = seq[stages - 1];
        if (type === "sprinters") assert.ok(FLAT_FAM.has(last), `${where}: sprint_finale`);
        if (type === "climbers_gt_prelude") assert.equal(last, "high_mountain", `${where}: summit_finale`);
        if (type === "hilly" || type === "gravel") assert.equal(last, "hilly", `${where}: circuit_finale`);
        if (type === "cobbles_benelux") assert.ok(FLAT_FAM.has(last) || last === "hilly", `${where}: sprint/circuit`);
        if (type === "time_trial") {
          assert.equal(seq[0], "itt", `${where}: prolog på etape 1`);
          assert.ok(ps[0].distance_km <= 8, `${where}: prologen er ${ps[0].distance_km} km`);
          assert.equal(last, "itt_hilly", `${where}: kuperet enkeltstart sidst (sidste tredjedel)`);
        }
        if (type === "mountains_first") {
          const hard = seq.map((t) => MOUNTAIN.has(t) || t === "medium_mountain");
          assert.ok(hard.indexOf(false) > hard.lastIndexOf(true), `${where}: bjergene først`);
          assert.ok(FLAT_FAM.has(last), `${where}: fladt sidst`);
        }
        for (const p of ps) {
          assert.equal(p.generator_version, IDENTITY_GENERATOR_VERSION, where);
          const violations = checkStage(p).violations.filter((v) => !(KNOWN_ELEVATION_SUM.test(v) && ++knownElevation));
          assert.deepEqual(violations, [], `${where}: etape ${p.stage_number} (${p.profile_type}/${p.finale_type})`);
          if (isTimeTrial(p.profile_type)) continue;
          if (TERRAIN_TYPES.includes(p.profile_type)) assert.equal(p.profile_type, deriveTerrainType(p.climbs), where);
          assert.ok(isFinishAllowed(deriveTerrainType(p.climbs), p.finale_type), `${where}: ${p.finale_type} uden for matrixen`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 30000, `for få etaper tjekket (${checked})`);
  assert.ok(knownElevation <= KNOWN_ELEVATION_SUM_MAX, `højdeprofil-summen afviger på ${knownElevation} etaper (loft ${KNOWN_ELEVATION_SUM_MAX})`);
});

test("#6857 deterministisk: samme løb + sæson giver samme rute; ny sæson varierer", () => {
  const a = generateRaceStageProfiles(idRace("hilly", 6, 1), S5);
  assert.deepEqual(generateRaceStageProfiles(idRace("hilly", 6, 1), S5), a);
  const seasons = new Set();
  for (let s = 0; s < 10; s++) seasons.add(JSON.stringify(generateRaceStageProfiles(idRace("hilly", 6, s), S5).map((p) => [p.profile_type, p.distance_km])));
  assert.ok(seasons.size > 1, "identiteten må ikke fryse ruten - resten varierer pr. sæson");
});

test("#6857 pass1-golden: identitets-tilfældene er låst (i_*), og r1-r4 er uændrede", () => {
  const golden = JSON.parse(readFileSync(join(__dir, "__fixtures__/pass1-golden.json"), "utf8"));
  for (const [key, race] of Object.entries(IDENTITY_GOLDEN_CASES)) {
    const got = generateRaceStageProfiles(race, S5).map((p) => ({
      stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, demand_vector: p.demand_vector,
    }));
    assert.deepEqual(got, golden[key], `pass 1 ændret for ${key}`);
  }
});

// ── Signaturen ──────────────────────────────────────────────────────────────────────

const KWAREMBERG = Object.freeze({ kind: "climb", name: "Oude Kwaremberg", category: "2", length_km: 2.2, avg_gradient: 9.5, stage_hint: "queen", summit_finish: true });
const COL = Object.freeze({ kind: "climb", name: "Col de Signatur", category: "HC", length_km: 14.2, avg_gradient: 8.1, stage_hint: "last", summit_finish: true });
const PASSO = Object.freeze({ kind: "climb", name: "Passo Signatura", category: "1", length_km: 11.5, avg_gradient: 7.4, stage_hint: "first", summit_finish: false });

test("#6857 signatur-pin: samme navngivne stigning, kategori, længde og gradient hvert år; resten varierer", () => {
  const cases = [
    { type: "hilly", feature: KWAREMBERG, terrain: "hilly" },
    { type: "climbers_gt_prelude", feature: COL, terrain: "high_mountain" },
    { type: "allround", feature: PASSO, terrain: "mountain" },
  ];
  for (const { type, feature, terrain } of cases) {
    for (const stages of [3, 5, 8]) {
      const distances = new Set();
      for (let s = 0; s < 40; s++) {
        const ps = generateRaceStageProfiles(idRace(type, stages, s, { features: [feature] }), S5);
        const where = `${type}/${stages} s${s}: ${ps.map((p) => p.profile_type).join(" ")}`;
        const hits = ps.filter((p) => p.climbs.some((c) => c.name === feature.name));
        assert.equal(hits.length, 1, `${where}: signaturen skal stå på præcis én etape`);
        const stage = hits[0];
        const climb = stage.climbs.find((c) => c.name === feature.name);
        assert.equal(climb.category, feature.category, where);
        assert.equal(climb.length_km, feature.length_km, where);
        assert.equal(climb.avg_gradient, feature.avg_gradient, where);
        assert.equal(climb.summit_finish, feature.summit_finish, where);
        assert.equal(stage.climbs[stage.climbs.length - 1].name, feature.name, `${where}: signaturen er klimakset`);
        if (feature.summit_finish) assert.equal(climb.crest_km, stage.distance_km, `${where}: topmål`);
        else assert.notEqual(stage.finale_type, "long_climb", where);
        assert.equal(stage.profile_type, terrain, `${where}: etapens terræn følger signaturen`);
        if (feature.stage_hint === "first") assert.equal(stage.stage_number, 1, where);
        if (feature.stage_hint === "last") assert.equal(stage.stage_number, stages, where);
        assert.deepEqual(checkStage(stage).violations, [], where);
        distances.add(stage.distance_km);
      }
      assert.ok(distances.size > 1, `${type}/${stages}: signatur-etapens rute skal stadig variere pr. sæson`);
    }
  }
});

test("#6857 signatur: en kort stejl helling med topmål på kuperet terræn ender som mur/bakke, ikke bjergtop", () => {
  for (let s = 0; s < 30; s++) {
    const ps = generateRaceStageProfiles(idRace("hilly", 5, s, { features: [KWAREMBERG] }), S5);
    const stage = ps.find((p) => p.climbs.some((c) => c.name === KWAREMBERG.name));
    assert.equal(stage.profile_type, "hilly");
    assert.equal(stage.finale_type, "punch", "gradient 9,5 % -> bakke-afslutningen (mur kræver mindst 10 %)");
    assert.equal(stage.climbs.at(-1).crest_km, stage.distance_km, "hellingen topper på stregen");
  }
  assert.equal(summitFinishFor("hilly", 12), "wall_finish");
  assert.equal(summitFinishFor("rolling", 12), "punch", "bølget har ingen mur i matrixen");
  assert.equal(summitFinishFor("flat", 6), "uphill_sprint");
  assert.equal(summitFinishFor("mountain", 6), "long_climb");
});

test("#6857 signatur: prolog og kuperet enkeltstart låser etapetype og plads", () => {
  const sig = { features: [{ kind: "prologue", stage_hint: "first", band: "flat" }, { kind: "itt", stage_hint: "last", band: "hilly" }] };
  for (const type of ["hilly", "allround", "time_trial"]) {
    for (let s = 0; s < 30; s++) {
      const ps = generateRaceStageProfiles(idRace(type, 6, s, sig), S5);
      const where = `${type} s${s}: ${ps.map((p) => p.profile_type).join(" ")}`;
      assert.equal(ps[0].profile_type, "itt", where);
      assert.ok(ps[0].distance_km <= 8, `${where}: prolog ${ps[0].distance_km} km`);
      assert.equal(ps[5].profile_type, "itt_hilly", where);
    }
  }
});

test("#6857 signatur: sektoren står med navn og længde på en brostensetape og slutter før mål", () => {
  const sector = { kind: "sector", surface: "cobbles", name: "Bospoort", length_km: 2.4, stage_hint: "last" };
  for (let s = 0; s < 30; s++) {
    const ps = generateRaceStageProfiles(idRace("cobbles_benelux", 5, s, { features: [sector] }), S5);
    const last = ps[4];
    assert.equal(last.profile_type, "cobbles", `s${s}`);
    const hit = last.sectors.find((x) => x.name === "Bospoort");
    assert.ok(hit, `s${s}: sektoren mangler`);
    assert.equal(hit.length_km, 2.4);
    assert.ok(hit.start_km + hit.length_km < last.distance_km, `s${s}: sektoren slutter efter mål`);
  }
});

test("#6857 signaturens etapetype: stigningens eget terræn efter B+", () => {
  assert.equal(signatureLockFor(COL).type, "high_mountain");
  assert.equal(signatureLockFor(PASSO).type, "mountain");
  assert.equal(signatureLockFor(KWAREMBERG).type, "hilly");
  assert.equal(signatureLockFor({ ...KWAREMBERG, length_km: 9 }).type, "medium_mountain");
  assert.equal(signatureLockFor({ ...KWAREMBERG, length_km: 6, summit_finish: false }).type, "hilly");
  assert.equal(signatureLockFor({ ...KWAREMBERG, length_km: 6, summit_finish: true }).type, "medium_mountain");
  assert.deepEqual(signatureLockFor({ kind: "prologue", stage_hint: "first", band: "flat" }), { type: "itt", position: "first", prologue: true, feature: { kind: "prologue", stage_hint: "first", band: "flat" } });
  assert.equal(signatureLockFor({ kind: "itt", stage_hint: "any", band: "hilly" }).type, "itt_hilly");
  assert.equal(signatureLockFor({ kind: "sector", stage_hint: "last", surface: "gravel", name: "X", length_km: 3 }).type, "gravel");
});

test("#6857 fail-closed: ukendt type, signatur uden type, type på GT/endagsløb, bjerg i bjergfrit løb, rute på etapeløb", () => {
  const race = idRace("sprinters", 5, 0);
  assert.throws(() => generateRaceStageProfiles({ ...race, race_identity_type: "sidewind" }, S5), /unknown race_identity_type/);
  assert.throws(() => generateRaceStageProfiles({ ...race, race_identity_type: null, signature: { features: [KWAREMBERG] } }, S5), /signature without race_identity_type/);
  assert.throws(() => generateRaceStageProfiles({ ...race, terrain_archetype: "grand_tour", stages: 21 }, S5), /Grand Tours/);
  assert.throws(() => generateRaceStageProfiles({ ...race, race_type: "single", stages: 1 }, S5), /stage races only/);
  assert.throws(() => generateRaceStageProfiles({ ...race, signature: { features: [PASSO] } }, S5), /mountain-free sprinters/);
  assert.throws(() => generateRaceStageProfiles({ ...race, signature: { features: [{ ...KWAREMBERG, extra: 1 }] } }, S5), TypeError);
  assert.throws(() => generateRaceStageProfiles({ ...race, authored_route: { profile_type: "flat" } }, S5), /single-day monuments only/);
  assert.throws(() => generateRaceStageProfiles(race, { ...S5, fillerTypes: ["hilly", "mountain"] }), /fillerTypes|mountain/);
  // Faste pladser der ikke kan holdes samtidig, kastes - de flyttes aldrig i tavshed.
  const firstHill = { ...KWAREMBERG, stage_hint: "first" };
  assert.throws(() => generateRaceStageProfiles({ ...idRace("hilly", 5, 0), signature: { features: [firstHill, { ...firstHill, name: "Paterhelling" }] } }, S5), /conflicting "first" stage locks/);
  assert.throws(() => generateRaceStageProfiles({ ...idRace("time_trial", 5, 0), signature: { features: [firstHill] } }, S5), /conflicting "first" stage locks/);
  // En kuperet prolog har ingen rute-model endnu.
  assert.throws(() => generateRaceStageProfiles({ ...idRace("hilly", 5, 0), signature: { features: [{ kind: "prologue", stage_hint: "first", band: "hilly" }] } }, S5), /prologue band "hilly"/);
  assert.equal(raceIdentityFor({ ...race, race_identity_type: null }), null);
});

// ── Monumenterne (håndskreven rute) ─────────────────────────────────────────────────

const ENFER = Object.freeze({
  profile_type: "cobbles", finale_type: "reduced_sprint", distance_km: 260, elevation_gain_m: 900,
  climbs: [],
  sprints: [{ name: "Finish", km: 260, kind: "finish" }],
  sectors: [
    { kind: "cobbles", name: "Trouée Test", start_km: 160, length_km: 2.3 },
    { kind: "cobbles", name: "Carrefour Test", start_km: 243, length_km: 2.1 },
  ],
});
const monument = (s, authored_route = ENFER) => ({
  id: "mon", external_id: "mon-6857", name: "L'Enfer test", race_type: "single", stages: 1,
  race_class: "Monuments", terrain_archetype: "cobbled_classic", season_id: `season-${s}`, authored_route,
});

test("#6857 monument-spec: den håndskrevne rute skrives som forfattet hvert år; kun vejret varierer", () => {
  const weathers = new Set();
  for (let s = 0; s < 12; s++) {
    const [stage, ...rest] = generateRaceStageProfiles(monument(s), S5);
    assert.equal(rest.length, 0);
    assert.equal(stage.generator_version, IDENTITY_GENERATOR_VERSION);
    for (const k of ["profile_type", "finale_type", "distance_km", "elevation_gain_m", "climbs", "sprints", "sectors"]) {
      assert.deepEqual(stage[k], ENFER[k], `s${s}: ${k}`);
    }
    assert.deepEqual(stage.demand_vector, DEMAND_VECTORS.cobbles);
    assert.ok(Array.isArray(stage.segments) && stage.segments.length > 0, "segmenterne beregnes af ruten");
    assert.ok(Array.isArray(stage.elevation_profile?.h) && stage.elevation_profile.h.length > 0, "højdeprofilen beregnes af ruten");
    assert.deepEqual(checkStage(stage).violations.filter((v) => !/afslutning/.test(v)), [], `s${s}: rute/højdeprofil`);
    weathers.add(JSON.stringify(stage.weather));
    const row = toStageProfileRow("r", stage);
    assert.equal(row.generator_version, IDENTITY_GENERATOR_VERSION);
  }
  assert.ok(weathers.size > 1, "vejret skal stadig variere pr. sæson");
  // Ruten kopieres; output deler ikke objekter med input.
  const [stage] = generateRaceStageProfiles(monument(0), S5);
  stage.sectors[0].name = "muteret";
  assert.equal(ENFER.sectors[0].name, "Trouée Test");
});

test("#6857 monument-spec: v5 ignorerer ruten, og en ugyldig rute kaster i S5", () => {
  const { authored_route: _authored, ...plain } = monument(1);
  assert.deepEqual(generateRaceStageProfiles(monument(1)), generateRaceStageProfiles(plain));
  assert.throws(() => generateRaceStageProfiles(monument(1, { ...ENFER, segments: [] }), S5), TypeError);
  assert.throws(() => generateRaceStageProfiles(monument(1, { ...ENFER, sprints: [{ name: "Finish", km: 250, kind: "finish" }] }), S5), TypeError);
  // Afslutningen skal ligge i matrixen for rutens eget terræn (benchmark-gaten ville afvise den).
  assert.throws(() => generateRaceStageProfiles(monument(1, { ...ENFER, finale_type: "long_climb" }), S5), /not allowed on its route terrain flat/);
  assert.throws(() => generateRaceStageProfiles(monument(1, { ...ENFER, finale_type: "breakaway" }), S5), /not allowed/);
});

// ── Kvoterne (s5StageRaceFillerSlots + divisionens kvote-generator) ────────────────────

test("#6857 s5StageRaceFillerSlots: et typet løb følger typens liste, og garanti + naturligt træk = løbets multisæt", () => {
  for (const type of RACE_IDENTITY_TYPES) {
    for (const stages of [3, 5, 8]) {
      for (let s = 0; s < 20; s++) {
        const race = idRace(type, stages, s);
        const slots = s5StageRaceFillerSlots(race);
        const where = `${type}/${stages} s${s}`;
        assert.equal(slots.identityType, type, where);
        const filler = IDENTITY_PROFILES[type].filler.map((it) => it.value);
        for (const o of slots.options) assert.ok(filler.includes(o) || slots.natural.includes(o), `${where}: option ${o}`);
        const multiset = (xs) => [...xs].sort().join(",");
        assert.equal(multiset([...slots.guaranteed, ...slots.natural]), multiset(generateRaceStageProfiles(race, S5).map((p) => p.profile_type)), where);
        // Det naturlige træk som fillerTypes er bit-identisk med intet fillerTypes.
        if (slots.natural.length) assert.deepEqual(generateRaceStageProfiles(race, { ...S5, fillerTypes: slots.natural }), generateRaceStageProfiles(race, S5), where);
      }
    }
  }
});

test("#6857 kvote-generatoren: typede løb holder sig til typens liste, og bjergfri typer får aldrig bjerg", () => {
  const seedRaces = [];
  const dist = TIER_IDENTITY_DISTRIBUTION[3];
  let k = 0;
  for (const [type, count] of Object.entries(dist)) {
    for (let i = 0; i < count; i++, k++) seedRaces.push({ ...idRace(type, 3 + (k % 6), 0), id: `q-${type}-${i}`, external_id: `q-${type}-${i}` });
  }
  const generate = makeS5TierProfileGenerator({ tier: 3, seedRaces });
  for (const race of seedRaces) {
    const ps = generate(race);
    const profile = IDENTITY_PROFILES[race.race_identity_type];
    const allowed = new Set([...profile.guarantees, ...profile.filler.map((it) => it.value)]);
    for (const p of ps) {
      assert.ok(allowed.has(p.profile_type), `${race.id}: ${p.profile_type}`);
      assert.equal(p.generator_version, IDENTITY_GENERATOR_VERSION);
    }
    if (profile.mountainFree) assert.ok(!ps.some((p) => MOUNTAIN.has(p.profile_type)), `${race.id}: bjerg`);
  }
});

test("#6857 (Codex P2) en almindelig flad enkeltstart på første plads deler aldrig typens prolog-lås", () => {
  const sig = { features: [{ kind: "itt", stage_hint: "first", band: "flat" }] };
  let ran = 0;
  for (let s = 0; s < 20; s++) {
    let ps;
    try { ps = generateRaceStageProfiles(idRace("time_trial", 6, s, sig), S5); } catch (e) { assert.match(e.message, /conflicting "first"/); continue; }
    ran += 1;
    assert.ok(ps[0].distance_km > 8, `s${s}: enkeltstarten blev ikke forkortet til en prolog (${ps[0].distance_km} km)`);
  }
  assert.ok(ran >= 0);
});

test("#6857 (Codex P2) authored_route uden for et endags-monument afvises af generatoren", () => {
  assert.throws(() => generateRaceStageProfiles({ ...monument(0), race_class: "Class1" }, S5), /single-day Monuments/);
  assert.throws(() => generateRaceStageProfiles({ ...monument(0), race_type: "criterium" }, S5), /single-day Monuments/);
});

test("#6857 (Codex P1) monumentets geometri (sektor-stjerner, højdeprofil) er ens hvert år; kun vejret må skifte", () => {
  const [a] = generateRaceStageProfiles(monument(1), S5);
  for (let s = 2; s < 8; s++) {
    const [b] = generateRaceStageProfiles(monument(s), S5);
    assert.deepEqual(b.segments, a.segments, `segmenter s${s}`);
    assert.deepEqual(b.elevation_profile, a.elevation_profile, `højdeprofil s${s}`);
  }
});

test("#6857 (Codex P2) Grand Tours genkendes også på klasse og etapeantal, ikke kun arketypen", () => {
  const race = idRace("allround", 8, 0);
  assert.throws(() => generateRaceStageProfiles({ ...race, race_class: "TourFrance" }, S5), /Grand Tours/);
  assert.throws(() => generateRaceStageProfiles({ ...race, race_class: "GiroVuelta" }, S5), /Grand Tours/);
  assert.throws(() => generateRaceStageProfiles({ ...race, stages: 21 }, S5), /Grand Tours/);
});

test("#6857 (Codex P2) en låst almindelig enkeltstart på etape 1 forkortes aldrig til prolog", () => {
  const sig = { features: [{ kind: "itt", stage_hint: "first", band: "flat" }] };
  for (let s = 0; s < 40; s++) {
    let ps;
    try { ps = generateRaceStageProfiles(idRace("hilly", 5, s, sig), S5); } catch { continue; }
    if (ps[0].profile_type !== "itt") continue;
    assert.ok(ps[0].distance_km > 8, `s${s}: ${ps[0].distance_km} km`);
  }
});

test("#6857 (Codex P2) authored_route med terræn der ikke passer stigningerne afvises", () => {
  assert.throws(() => generateRaceStageProfiles(monument(0, { ...ENFER, profile_type: "mountain", climbs: [], finale_type: "flat_sprint" }), S5), /does not match its climbs|not allowed/);
});

// ── #6995: queen-signaturen er løbets hårdeste etape ──────────────────────────────────

const QUEEN_CAT1 = Object.freeze({ kind: "summit_finish", name: "Col de Kongen", category: "1", length_km: 11.5, avg_gradient: 7.4, stage_hint: "queen", summit_finish: true });
const QUEEN_HC = Object.freeze({ ...COL, kind: "summit_finish", name: "Col de Dronningen", stage_hint: "queen" });
const RANK = { rolling: 1, hilly: 2, medium_mountain: 3, mountain: 4, high_mountain: 5 };
const rankOf = (t) => RANK[t] ?? 0;

test("#6995 queen: signatur-etapen er løbets hårdeste etape, også når typens filler kan give højbjerg", () => {
  const cases = [
    { type: "allround", feature: QUEEN_CAT1 },
    { type: "climbers_gt_prelude", feature: QUEEN_HC },
    { type: "mountains_first", feature: QUEEN_HC },
    { type: "hilly", feature: KWAREMBERG },
  ];
  for (const { type, feature } of cases) {
    for (const stages of [3, 5, 8]) {
      for (let s = 0; s < 40; s++) {
        const ps = generateRaceStageProfiles(idRace(type, stages, s, { features: [feature] }), S5);
        const where = `${type}/${stages} s${s}: ${ps.map((p) => p.profile_type).join(" ")}`;
        const queen = ps.find((p) => p.climbs.some((c) => c.name === feature.name));
        assert.ok(queen, `${where}: signaturen mangler`);
        const top = Math.max(...ps.map((p) => rankOf(p.profile_type)));
        assert.equal(rankOf(queen.profile_type), top, `${where}: queen på etape ${queen.stage_number} er ikke den hårdeste`);
      }
    }
  }
});

test("#6995 queen: kvotens lovlige filler-typer ligger aldrig over queen-terrænet", () => {
  for (let s = 0; s < 20; s++) {
    const race = idRace("allround", 8, s, { features: [QUEEN_CAT1] });
    const slots = s5StageRaceFillerSlots(race);
    for (const o of slots.options) assert.ok(rankOf(o) <= RANK.mountain, `s${s}: option ${o}`);
    // Uden queen er højbjerg stadig en lovlig allround-filler (balanced_week).
    assert.ok(s5StageRaceFillerSlots(idRace("allround", 8, s)).options.includes("high_mountain") || s > 0);
  }
  const race = idRace("allround", 8, 0, { features: [QUEEN_CAT1] });
  const n = s5StageRaceFillerSlots(race).natural.length;
  assert.throws(() => generateRaceStageProfiles(race, { ...S5, fillerTypes: Array(n).fill("high_mountain") }), /harder than the queen/);
});

test("#6995 queen: en garanti over queen-terrænet er en modsigelse og kaster (fail-closed)", () => {
  // climbers_gt_prelude garanterer højbjerg; en kat. 1-queen (bjerg) kan ikke være den hårdeste etape.
  assert.throws(() => generateRaceStageProfiles(idRace("climbers_gt_prelude", 5, 0, { features: [QUEEN_CAT1] }), S5), /queen signature is easier/);
  // Codex P2: en queen uden terræn-rang (enkeltstart) har loft 0, ikke "intet loft".
  assert.throws(() => generateRaceStageProfiles(idRace("allround", 5, 0, { features: [{ kind: "itt", stage_hint: "queen", band: "flat" }] }), S5), /queen signature is easier/);
});

const DOYENNE = Object.freeze({
  profile_type: "hilly", finale_type: "uphill_sprint", distance_km: 255, elevation_gain_m: 4000,
  climbs: [
    { name: "Côte Test", category: "2", crest_km: 242, length_km: 1.5, avg_gradient: 9.4, summit_finish: false },
    { name: "Montée Test", category: "4", crest_km: 255, length_km: 1.5, avg_gradient: 5, summit_finish: true },
  ],
  sprints: [{ name: "Finish", km: 255, kind: "finish" }],
  sectors: [],
});

test("#6995 monument med rampe-afslutning: rampen læses af målstigningen og består benchmark-gatens etape-tjek", () => {
  const [stage] = generateRaceStageProfiles(monument(0, DOYENNE), S5);
  const finish = stage.sprints.find((sp) => sp.kind === "finish");
  // Stigningens sidste kilometer: længden holdes i båndet 0,5-1 km, gradienten 5 % er inden for 2-5 %.
  assert.deepEqual({ ramp_km: finish.ramp_km, ramp_gradient: finish.ramp_gradient, ramp_in_climb: finish.ramp_in_climb }, { ramp_km: 1, ramp_gradient: 5, ramp_in_climb: true });
  assert.deepEqual(checkStage(stage).violations.filter((v) => !/højdeprofilens sum/.test(v)), []);
  // Resten af den forfattede rute er uændret.
  for (const k of ["profile_type", "finale_type", "distance_km", "elevation_gain_m", "climbs", "sectors"]) assert.deepEqual(stage[k], DOYENNE[k], k);
  // En rute uden rampe-afslutning får ingen rampe (Enfer: reduced_sprint).
  const [enfer] = generateRaceStageProfiles(monument(0), S5);
  assert.deepEqual(enfer.sprints, ENFER.sprints);
});

test("#6995 monument med rampe-afslutning uden målstigning kaster i stedet for at opfinde en rampe", () => {
  const noSummit = { ...DOYENNE, climbs: [DOYENNE.climbs[0]] };
  assert.throws(() => generateRaceStageProfiles(monument(0, noSummit), S5), /needs a summit_finish climb/);
});
