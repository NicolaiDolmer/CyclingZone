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
  applyOrderArchetype,
  applyOpeningVariety,
  SPRINT_FINALE_EARLY_DECIDER_CHANCE,
} from "./raceStageProfileGenerator.js";
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
    assert.ok(["flat", "rolling", "itt"].includes(last), `seed ${seed}: uventet GT-finale ${last}`);
    finales.add(last);
  }
  assert.ok(finales.has("flat") || finales.has("rolling"), "forventede mindst én flad/rullende GT-finale");
  assert.ok(finales.has("itt"), "forventede mindst én enkeltstart-GT-finale (~22% i researchen)");
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
