# Sub-3: Rute-bevidst motor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gap-model læser ruten (summit/dal/kategori/ITT-distance), distance skalerer fatigue + endurance, udbrud forfines, prolog-arketype, tekniske finaler — alt data-gated så etaper uden rutedata er bit-identiske.

**Architecture:** Ankret modifier-model bag én grænseflade `stageGapModel(stageProfile) → {bunch, spread}` (ejer-beslutning 22/7 — en senere kontinuerlig model er drop-in bag samme interface). Alle nye komponenter aktiveres KUN af rutedata-felter; uden dem er hver kodesti en identitet. Rekalibrering via A/B-harness (3 gate-seeds) FØR merge.

**Tech Stack:** Node ESM, `node --test`, dry-run-harness (`simulateSeasonDryRun.js` + `raceGate.js`). INGEN migration (tekniske finaler afledes; prolog bruger eksisterende kolonner).

**Spec:** `docs/superpowers/specs/2026-07-22-sub3-route-aware-engine-design.md`. **Issue:** #2771. **Branch:** `feat/2771-route-aware-engine` (worktree, EFTER Sub-2 er merged — Task 5 bygger på at `loadStageProfiles` allerede SELECT'er rutefelter). **Deadline:** merged + S2-regen før cutover ~27/7.

**⚠️ Motoren ÆNDRES.** Kontrakt: `simulateStage`-signaturen er frossen; alle ændringer er INDE i loopet (samme mønster som #1021-seams). Deep-equal-testen (etaper uden rutedata ≡ main) er den hårde gate.

---

### Task 1: `stageGapModel` — ankret modifier-model (TDD)

**Files:**
- Modify: `backend/lib/raceSimulator.js` (GAP_MODEL ~71-83, gapFor ~347-351, kaldet ~474)
- Test: `backend/lib/raceSimulator.test.js` (tilføj sektion)

- [ ] **Step 1: Failing tests:**

```js
import { stageGapModel } from "./raceSimulator.js";

test("stageGapModel uden rutedata = anker-værdier (identitet)", () => {
  assert.deepEqual(stageGapModel({ profile_type: "mountain" }), { bunch: 0.0, spread: 600 });
  assert.deepEqual(stageGapModel({ profile_type: "flat" }), { bunch: 0.06, spread: 40 });
  assert.deepEqual(stageGapModel({ profile_type: "ukendt" }), { bunch: 0.03, spread: 150 });
});

test("summit-finish åbner gab: spread ×1.3, bunch 0", () => {
  const m = stageGapModel({
    profile_type: "mountain", distance_km: 160,
    climbs: [{ category: "1", crest_km: 160, summit_finish: true }],
  });
  // kategori-faktor 1 (×1.10) · summit (×1.3): 600·1.1·1.3 = 858
  assert.equal(m.spread, Math.round(600 * 1.1 * 1.3));
  assert.equal(m.bunch, 0);
});

test("dal-finish komprimerer: ≥10 km efter sidste top → ×0.6", () => {
  const m = stageGapModel({
    profile_type: "mountain", distance_km: 170,
    climbs: [{ category: "2", crest_km: 150, summit_finish: false }],
  });
  assert.equal(m.spread, Math.round(600 * 1.0 * 0.6)); // cat2 ×1.0 · dal ×0.6
});

test("HC-kategori skalerer hårdest", () => {
  const hc = stageGapModel({ profile_type: "high_mountain", distance_km: 150, climbs: [{ category: "HC", crest_km: 150, summit_finish: true }] });
  const c3 = stageGapModel({ profile_type: "high_mountain", distance_km: 150, climbs: [{ category: "3", crest_km: 150, summit_finish: true }] });
  assert.ok(hc.spread > c3.spread);
});

test("ITT skalerer med distance; prolog-distance giver små gab", () => {
  assert.equal(stageGapModel({ profile_type: "itt", distance_km: 30 }).spread, 700);
  assert.equal(stageGapModel({ profile_type: "itt", distance_km: 6 }).spread, 150);  // clamp-gulv
  assert.equal(stageGapModel({ profile_type: "itt", distance_km: 40 }).spread, Math.round(700 * 40 / 30));
});

test("samlet spread-clamp [40, 1000]", () => {
  const m = stageGapModel({ profile_type: "high_mountain", distance_km: 140, climbs: [{ category: "HC", crest_km: 140, summit_finish: true }] });
  assert.ok(m.spread <= 1000);
});
```

- [ ] **Step 2: Kør → FAIL.**
- [ ] **Step 3: Implementér** (eksportér; `gapFor` refaktoreres til at tage stageProfile):

```js
// Sub-3 (#2771): rute-bevidst gap-model — ankret modifier-model (ejer-valgt 22/7).
// GAP_MODEL-tabellen er ANKERET (gate-kalibreret); rute-signaler ganger faktorer
// på spread. Uden rutedata er alle faktorer 1.0 → bit-identisk med main.
// En fuld kontinuerlig model er senere drop-in bag SAMME grænseflade.
export const SUMMIT_SPREAD_FACTOR = 1.3;        // bånd 1.2-1.4 (kalibrering)
export const VALLEY_SPREAD_FACTOR = 0.6;        // bånd 0.5-0.75
export const VALLEY_MIN_DESCENT_KM = 10;
export const LAST_CLIMB_CATEGORY_FACTORS = Object.freeze({ HC: 1.25, "1": 1.10, "2": 1.0, "3": 0.85, "4": 0.7 });
export const ITT_REFERENCE_KM = 30;
const CLIMB_GAP_PROFILES = new Set(["mountain", "high_mountain", "hilly"]);
const SPREAD_CLAMP = [40, 1000];

export function stageGapModel(stageProfile = {}) {
  const anchor = GAP_MODEL[stageProfile.profile_type] || GAP_MODEL_DEFAULT;
  let { bunch, spread } = anchor;
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const distance = Number(stageProfile.distance_km);
  const pt = stageProfile.profile_type;

  if (pt === "itt" || pt === "ttt") {
    if (Number.isFinite(distance) && distance > 0) {
      spread = clamp(Math.round(anchor.spread * (distance / ITT_REFERENCE_KM)), 150, 900);
    }
    return { bunch, spread };
  }
  const last = climbs.length ? climbs[climbs.length - 1] : null;
  if (last && CLIMB_GAP_PROFILES.has(pt)) {
    spread *= LAST_CLIMB_CATEGORY_FACTORS[last.category] ?? 1.0;
    if (last.summit_finish) {
      spread *= SUMMIT_SPREAD_FACTOR;
      bunch = 0;
    } else if (Number.isFinite(distance) && distance - Number(last.crest_km) >= VALLEY_MIN_DESCENT_KM) {
      spread *= VALLEY_SPREAD_FACTOR;
    }
  }
  return { bunch, spread: Math.round(clamp(spread, SPREAD_CLAMP[0], SPREAD_CLAMP[1])) };
}

function gapFor(stageProfile, deficit) {
  const m = stageGapModel(stageProfile);
  if (deficit <= m.bunch) return 0;
  return Math.round(clamp((deficit - m.bunch) * m.spread, 0, MAX_STAGE_GAP_SECONDS));
}
```
   Opdatér call-sitet (~474): `stageGap: gapFor(stageProfile, winnerScore - r.finalScore)`.
- [ ] **Step 4: Kør raceSimulator-tests + HELE backend-suiten → PASS** (eksisterende tests sender bare profiler → identitet).
- [ ] **Step 5: Commit** — `feat: #2771 stageGapModel — ankret rute-modifier-model`

---

### Task 2: Distance→fatigue + endurance-term (TDD)

**Files:**
- Modify: `backend/lib/raceSimulator.js` (fatigueComponent ~112-120, simulateStage-loopet ~416-446)
- Test: `backend/lib/raceSimulator.test.js`

- [ ] **Step 1: Failing tests:**

```js
test("distFactor skalerer fatigue-straf på lange dage; ingen distance → identitet", () => {
  const e = { fatigue: 60, abilities: { durability: 0 } };
  const base = { profile_type: "mountain", demand_vector: { climbing: 1, randomness: 0 } };
  const long = { ...base, distance_km: 204 };  // bandMid mountain = 170 → factor 1.2
  const r1 = simulateStage({ entrants: [{ rider_id: "a", abilities: { climbing: 50, durability: 0 }, fatigue: 60 }], stageProfile: base, seed: 1 });
  const r2 = simulateStage({ entrants: [{ rider_id: "a", abilities: { climbing: 50, durability: 0 }, fatigue: 60 }], stageProfile: long, seed: 1 });
  assert.ok(r2.ranked[0].components.fatigue > r1.ranked[0].components.fatigue);
});

test("endurance-term: lang dag favoriserer endurance; kort dag straffer; components.long_day sat", () => {
  const long = { profile_type: "mountain", distance_km: 204, demand_vector: { climbing: 1, randomness: 0 } };
  const hi = simulateStage({ entrants: [{ rider_id: "a", abilities: { climbing: 50, endurance: 99 } }], stageProfile: long, seed: 1 });
  const lo = simulateStage({ entrants: [{ rider_id: "a", abilities: { climbing: 50, endurance: 0 } }], stageProfile: long, seed: 1 });
  assert.ok(hi.ranked[0].components.long_day > 0);
  assert.ok(lo.ranked[0].components.long_day < 0);
});

test("flag-off-ækvivalent: uden distance_km er components.long_day 0 og alt uændret", () => {
  const bare = { profile_type: "mountain", demand_vector: { climbing: 1, randomness: 0.5 } };
  const r = simulateStage({ entrants: [...], stageProfile: bare, seed: 7 });
  assert.ok(r.ranked.every((x) => x.components.long_day === 0));
});
```

- [ ] **Step 2: Kør → FAIL.**
- [ ] **Step 3: Implementér:**

```js
// Sub-3 (#2771): distance→fatigue. bandMid = midtpunkt af Sub-1's DISTANCE_BANDS
// (dupliceret her som frossen tabel for at undgå import-cyklus; kontrakt-test
// i raceRouteGenerator.test.js holder dem i sync).
export const DISTANCE_BAND_MIDPOINTS = Object.freeze({
  flat: 175, rolling: 170, hilly: 185, mountain: 170, high_mountain: 160,
  cobbles: 160, classic: 230, itt: 27.5, ttt: 35,
});
export const LONG_DAY_ENDURANCE_WEIGHT = 0.05;
export function distanceFactor(stageProfile) {
  const d = Number(stageProfile?.distance_km);
  const mid = DISTANCE_BAND_MIDPOINTS[stageProfile?.profile_type];
  if (!Number.isFinite(d) || !mid) return 1;
  return clamp(d / mid, 0.85, 1.2);
}
function longDayComponent(entrant, distFactor) {
  if (distFactor === 1) return 0;
  const end = Number(entrant?.abilities?.endurance);
  if (!Number.isFinite(end)) return 0;
  return (distFactor - 1) * LONG_DAY_ENDURANCE_WEIGHT * ((clamp(end, 0, 99) - 50) / 49);
}
```
   I `fatigueComponent`: gang `distFactor` på (send stageProfile med fra loopet — signaturen har allerede den udkommenterede parameter). I score-loopet: `const longDay = longDayComponent(e, dFactor);` → `finalScore += longDay`, `components.long_day = longDay`. `dFactor` beregnes ÉN gang før loopet.
   **NB flag-off-deepEqual-testen** (`raceEngineV3FlagOff.test.js`): `long_day`-nøglen skal (som `incident`) være til stede ubetinget med 0 når inaktiv.
- [ ] **Step 4: Kør hele backend-suiten → PASS.**
- [ ] **Step 5: Commit** — `feat: #2771 distance skalerer fatigue + endurance-term (long_day)`

---

### Task 3: Tekniske finaler (afledt, TDD)

**Files:**
- Modify: `backend/lib/raceSimulator.js` (finaleModifier ~145-150)
- Test: `backend/lib/raceSimulator.test.js`

- [ ] **Step 1: Failing tests:**

```js
import { isTechnicalFinale } from "./raceSimulator.js";

test("teknisk finale afledes af rutedata", () => {
  assert.equal(isTechnicalFinale({ finale_type: "descent" }), true);
  assert.equal(isTechnicalFinale({ distance_km: 170, climbs: [{ crest_km: 162, category: "2" }] }), true);  // 8 km efter top
  assert.equal(isTechnicalFinale({ distance_km: 170, climbs: [{ crest_km: 140, category: "2" }] }), false); // 30 km — for langt
  assert.equal(isTechnicalFinale({ distance_km: 160, sectors: [{ start_km: 152, length_km: 2 }] }), true);  // brosten i finalen
  assert.equal(isTechnicalFinale({ profile_type: "flat" }), false);
});

test("teknisk finale vægter descending+positioning (±, centreret om 50)", () => {
  const sp = { profile_type: "mountain", finale_type: "reduced_sprint", distance_km: 170, demand_vector: { climbing: 1, randomness: 0 },
    climbs: [{ crest_km: 165, category: "1", summit_finish: false }] };
  const good = simulateStage({ entrants: [{ rider_id: "a", abilities: { climbing: 50, descending: 99, positioning: 99 } }], stageProfile: sp, seed: 1 });
  const bad = simulateStage({ entrants: [{ rider_id: "a", abilities: { climbing: 50, descending: 0, positioning: 0 } }], stageProfile: sp, seed: 1 });
  assert.ok(good.ranked[0].components.finale > bad.ranked[0].components.finale);
});
```

- [ ] **Step 2: Kør → FAIL.**
- [ ] **Step 3: Implementér:**

```js
// Sub-3 (#2771): teknisk finale AFLEDES af rutedata — persisteres ikke.
export const TECHNICAL_DESCENT_WINDOW_KM = [3, 12];
export const TECHNICAL_FINALE_WEIGHT = 0.06; // samlet ±, fordeles 60/40 descending/positioning
export function isTechnicalFinale(sp = {}) {
  if (DESCENT_FINALES.has(sp.finale_type)) return true;
  const d = Number(sp.distance_km);
  const climbs = Array.isArray(sp.climbs) ? sp.climbs : [];
  const last = climbs.length ? climbs[climbs.length - 1] : null;
  if (last && Number.isFinite(d)) {
    const gap = d - Number(last.crest_km);
    if (gap >= TECHNICAL_DESCENT_WINDOW_KM[0] && gap <= TECHNICAL_DESCENT_WINDOW_KM[1]) return true;
  }
  const sectors = Array.isArray(sp.sectors) ? sp.sectors : [];
  if (Number.isFinite(d) && sectors.some((s) => Number(s.start_km) + Number(s.length_km) >= d - 10)) return true;
  return false;
}
```
   `finaleModifier` udvides: eksisterende descent-gren består (bagudkompatibel identitet); NÅR `isTechnicalFinale(sp)` og der findes rutedata (climbs/sectors/distance) → brug i stedet `0.6·descending + 0.4·positioning`-blend centreret om 50 × `TECHNICAL_FINALE_WEIGHT`. Uden rutedata: præcis gammel adfærd (kun `finale_type === "descent"`, kun descending, vægt 0.04).
- [ ] **Step 4: Kør suite → PASS. Commit** — `feat: #2771 tekniske finaler (afledt af rute)`

---

### Task 4: Udbruds-forfining (TDD)

**Files:**
- Modify: `backend/lib/raceSimulator.js` (selectBreakawayBonuses ~281-318, breakawayMaxBonus ~262-267)
- Test: `backend/lib/raceSimulator.test.js`

- [ ] **Step 1: Failing tests:**

```js
import { routeBreakawayFactor } from "./raceSimulator.js";

test("distance-faktor: lang etape → let forhøjet udbruds-bonus; uden distance → 1", () => {
  assert.equal(routeBreakawayFactor({ profile_type: "mountain" }, []), 1);
  const long = routeBreakawayFactor({ profile_type: "mountain", distance_km: 204 }, []);
  assert.ok(long > 1 && long < 1.15); // sqrt(1.2) ≈ 1.095
});

test("sprinter-tæthed dæmper på flat: mange sprint_captains → faktor < 1", () => {
  const mkE = (n, withSC) => Array.from({ length: n }, (_, i) => ({
    rider_id: `r${i}`, team_id: `t${i % 10}`,
    race_role: withSC && i < 8 ? "sprint_captain" : "helper", abilities: {},
  }));
  const dense = routeBreakawayFactor({ profile_type: "flat", distance_km: 175 }, mkE(60, true));
  const sparse = routeBreakawayFactor({ profile_type: "flat", distance_km: 175 }, mkE(60, false));
  assert.ok(dense < 1);
  assert.ok(sparse > 1);
});

test("clamp: samlet maxBonus overskrider ALDRIG kalibrerings-loftet (flat ≤ 0.30)", () => {
  // breakawayMaxBonus("flat", "bunch_sprint") = 0.30; faktor > 1 må ikke skubbe over.
});
```

- [ ] **Step 2: Kør → FAIL.**
- [ ] **Step 3: Implementér:**

```js
// Sub-3 (#2771): rute/felt-faktorer på udbruds-bonus. Bounded: produktet clampes
// til profilens kalibrerede loft (BREAKAWAY_BONUS-værdien selv), så gate-bånd-
// lofterne fra kalibrerings-loggen aldrig kan overskrides.
export const SPRINTER_DENSITY_PROFILES = new Set(["flat", "rolling"]);
export const SPRINTER_DENSITY_RANGE = [0.85, 1.15]; // faktor ved høj hhv. lav tæthed
export function routeBreakawayFactor(stageProfile, entrants = []) {
  let f = Math.sqrt(distanceFactor(stageProfile));
  if (SPRINTER_DENSITY_PROFILES.has(stageProfile?.profile_type) && entrants.length) {
    const teams = new Set(entrants.map((e) => e.team_id).filter(Boolean));
    const scTeams = new Set(entrants.filter((e) => e.race_role === "sprint_captain").map((e) => e.team_id));
    if (teams.size > 0) {
      const density = scTeams.size / teams.size; // 0..1
      f *= SPRINTER_DENSITY_RANGE[1] - (SPRINTER_DENSITY_RANGE[1] - SPRINTER_DENSITY_RANGE[0]) * density;
    }
  }
  return f;
}
```
   I `selectBreakawayBonuses`: `const maxBonus = Math.min(breakawayMaxBonus(profileType, finaleType) * routeBreakawayFactor(stageProfile, ordered), breakawayMaxBonus(profileType, finaleType) * 1.0);` — NB: clampen er til det UMODIFICEREDE loft, dvs. faktorer > 1 øger kun via u²-fordelingen op til loftet… **Ret design:** clamp til `BREAKAWAY_BONUS`-profilens maksimale finale-værdi i stedet. Skriv testen så den fanger den faktiske invariant: flat-effektiv-maxBonus ≤ 0.30. `selectBreakawayBonuses` får `stageProfile` som parameter (den har allerede profileType/finaleType — send hele objektet ind og behold destrukturering).
   **rng-invariant:** faktorberegningen bruger INGEN rng → udvælgelses-sekvensen er uændret; kun bonus-størrelsen skaleres. Uden rutedata: faktor 1 → bit-identisk.
- [ ] **Step 4: Kør suite → PASS. Commit** — `feat: #2771 udbruds-forfining (distance + sprinter-tæthed)`

---

### Task 5: Bit-identitets-gate + runner-feed (TDD)

**Files:**
- Test: `backend/lib/raceRunnerRouteAware.test.js` (NY)
- Verify: `backend/lib/raceRunner.js` `loadStageProfiles` SELECT'er rutefelter (landede i Sub-2 Task 5 — verificér, ellers STOP og flag)

- [ ] **Step 1: Skriv DEN HÅRDE GATE-TEST:**

```js
// Sub-3-invarianten: en etape UDEN rutedata simuleres BIT-IDENTISK med main.
// Fixture: kør simulateStage på bare profiler (alle 9 profile_types, v3 on+off,
// 3 seeds) og deep-equal HELE ranked-outputtet (scores, gaps, components) mod
// golden-values genereret FØR Sub-3-ændringerne (commit golden-fil i Task 1-
// branchen INDEN implementering — kør scriptet på main-koden).
import golden from "./raceRunnerRouteAware.golden.json" with { type: "json" };
test("bare profiler er bit-identiske med pre-Sub-3 golden", () => {
  for (const c of golden.cases) {
    const r = simulateStage({ entrants: rebuild(c.entrants), stageProfile: c.stageProfile, seed: c.seed, v3: c.v3 });
    assert.deepEqual(JSON.parse(JSON.stringify(r)), c.expected);
  }
});
```
   Golden-fil: lav `backend/scripts/dev/genRouteAwareGolden.js` der bygger 20 cases (blandede profiler/seeds/v3) og skriver JSON — kør den på MAIN (før Task 1 merges ind i branchen), commit golden-filen som Task 5's første commit.
- [ ] **Step 2: Kør → PASS på branchen** (hvis FAIL: en Task 1-4-ændring lækker udenfor data-gaten — find og fix FØR videre arbejde).
- [ ] **Step 3: Commit** — `test: #2771 bit-identitets-golden-gate for etaper uden rutedata`

---

### Task 6: Prolog-arketype (TDD)

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js` (ARCHETYPE_PROFILES ~125-149)
- Modify: `backend/lib/raceRouteGenerator.js` (DISTANCE_BANDS ~33-38, attachRoute ~186-200)
- Test: `backend/lib/raceStageProfileGenerator.test.js` + `backend/lib/raceRouteGenerator.test.js`

- [ ] **Step 1: Failing tests:**

```js
test("prolog-arketype: etape 1 er kort ITT (5-8 km)", () => {
  // Byg et syntetisk race med terrain_archetype-varianten der garanterer prolog
  // (fx grand_tour-style archetype med prolog-guarantee) og generér profiler.
  // Assert: stage 1 har profile_type 'itt' og distance_km ∈ [5, 8] efter attachRoute.
});
test("attachRoute: itt-etape med stage_number 1 i prolog-arketype får 5-8 km", () => {
  // attachRoute tager isProlog-hint (nyt tredje/fjerde argument-felt) → distance 5-8.
});
```

- [ ] **Step 2: Design-beslutning (låst i spec §6):** `profile_type` FORBLIVER `"itt"`; prolog er en DISTANCE-egenskab. Implementering:
  - `raceStageProfileGenerator.js`: GT-/summit_tour-/større stage-arketyper: `guarantees`-listen kan starte med `"itt"` som etape 1 med seeded sandsynlighed (~40 % for 15+-etapers løb, dedikeret rng-træk fra hoved-strømmen? NEJ — hoved-strømmen er frossen (pass 1-bit-identitet). Brug i stedet PASS 2: prolog afgøres i attachRoute-laget som distance-valg på en allerede-ITT etape 1).
  - **Simplest korrekte løsning:** i `attachRoute`: hvis `stage.profile_type === "itt"` OG `stage.stage_number === 1` OG etapeløb → rute-rng'en vælger prolog-distance (5-8 km) med 60 % sandsynlighed, ellers normal ITT-bånd. Pass 1 er urørt (ingen ny arketype nødvendig for prolog-effekten; `summit_tour` m.fl. har allerede itt i filler/guarantees). Dokumentér afvigelsen fra spec §6 i PR (ingen ny arketype — prolog via pass 2; #2177-arketyperne itt_classic findes allerede fra Sub-1).
- [ ] **Step 3: Implementér + kør tests → PASS.** Verificér pass 1-bit-identitet: eksisterende generator-determinisme-tests skal være grønne.
- [ ] **Step 4: Commit** — `feat: #2771 prolog via rute-pass (5-8 km aabnings-itt)`

---

### Task 7: Harness — ruter i dry-run + A/B + nye bånd

**Files:**
- Modify: `backend/scripts/simulateSeasonDryRun.js` (stageProfile-konstruktion ~598/675/839; ny sektion G)
- Modify: `backend/scripts/raceGate.js` (ekstra route-kørsel)
- Modify: `backend/package.json` (scripts)

- [ ] **Step 1: `--routes`-flag:** når sat, beriges hvert inline-bygget stageProfile med `attachRoute(stage, syntheticRace, isStageRace)`-felter (syntheticRace = `{ id: "dryrun-" + terrain, name: <region-neutral> }` — deterministisk pr. terrain+etape). GT-sektionen (~839) beriges altid når flaget er sat.
- [ ] **Step 2: Sektion G — rute-realisme-bånd (kun med `--routes --enforce-route-bands`):**

| Bånd | Krav |
|---|---|
| `summitValleyGapRatio` | p90 GC-relevant etape-gab (summit) / p90 (dal) ≥ 1.5 |
| `prologP90Gap` | ≤ 25 s (itt ≤ 8 km) |
| `ittDistanceGapRatio` | p90 gab 40 km ITT / 15 km ITT ≥ 2 |
| `longDayEnduranceLift` | endurance-top-kvartil vinderandel på etaper >110 % bandMid − baseline > +3 pp |
| `technicalFinaleLift` | descending+positioning-top-kvartil vinderandel på tekniske finaler − ikke-tekniske > 0 |
| Eksisterende TARGETS/BREAKAWAY/DOMINANCE | ALLE grønne OGSÅ med `--routes` |

- [ ] **Step 3: A/B-rapport:** med `--routes` printes delta-tabel (win-rates pr. terrain med/uden ruter — kør begge varianter i samme proces, samme seeds).
- [ ] **Step 4: `raceGate.js`:** udvid til pr. seed at køre BÅDE standard-varianten (uændret — beviser bit-identitet ved at eksisterende bånd står præcis som før) OG `--routes --enforce-targets --enforce-route-bands`-varianten. npm: `"race:gate"` uændret + nyt `"race:gate:routes"`.
- [ ] **Step 5: KØR + KALIBRÉR.** Iterér på modifier-konstanterne (SUMMIT_SPREAD_FACTOR ∈ [1.2, 1.4], VALLEY ∈ [0.5, 0.75], LONG_DAY_ENDURANCE_WEIGHT op fra 0.05 til målbart løft, TECHNICAL_FINALE_WEIGHT) til alle bånd er grønne på alle 3 seeds. Dokumentér HVER iteration i KALIBRERINGS-LOG-kommentaren (konvention: simulateSeasonDryRun.js linje 148-262). **Ankre og ejer-låste bånd røres ALDRIG.** 2 iterationer uden fremdrift på samme bånd → STOP, rapportér til arkitekten (loop-guard).
- [ ] **Step 6: Commit** — `feat: #2771 harness: --routes + sektion G-baand + A/B (kalibreret, 3 seeds groenne)`

---

### Task 8: Patch notes + help + PR

- [ ] **Step 1: Patch note** (version efter Sub-2's, category "improved", topic "Race engine", refs [2771]): EN "Routes now drive the racing: summit finishes open real gaps, valley finishes regroup, long stages wear riders down, technical finales reward bike handlers. Short prologue time trials can open big stage races." + DA. Help: udvid race-sektionen (en+da) med 2-3 sætninger om tidsforskelle/prolog.
- [ ] **Step 2: Fuld verifikation:** `pwsh -File scripts/verify-local.ps1` + `npm run race:gate` + `npm run race:gate:routes` + `npm run race:competitions` (Sub-2's — skal STADIG være grøn oven på Sub-3, da passage-laget nu kører på ændrede gaps: kør og verificér).
- [ ] **Step 3: PR** mod main, Refs #2771; body med FULD scorecard-dokumentation: A/B-delta-tabel, alle bånd alle seeds, golden-gate-status. Ejeren skal se tallene FØR merge (spec §8 pkt. 5).
- [ ] **Step 4: Efter merge (arkitekt):** S2-profil-regen for prolog-effekt: `node scripts/backfillRaceStageProfiles.js` -varianten der regenererer FULDE profiler for S2-løb uden `race_entries` — kør `--dry-run` FØRST, vis ejeren tallene (antal løb/etaper ændret), få go, apply, kør `raceRouteRealismScorecard --season 2` som post-verify. Flip #2771 → done; NOW.md + MASTERPLAN.

---

## Self-review-noter (22/7)

- Spec-dækning: §3 (Task 1), §4 (Task 2), §5 (Task 4), §6 (Task 6 — med dokumenteret forenkling: prolog via pass 2, ikke ny arketype; pass 1 forbliver bit-identisk hvilket er et HÅRDERE krav end spec'en), §7 (Task 3), §8 (Task 5 golden + Task 7).
- Rækkefølge-afhængighed: kræver Sub-2 merged (loadStageProfiles-SELECT + race:competitions-scorecard). Golden-fil genereres fra main FØR motor-ændringer.
- Typer: `stageGapModel`/`distanceFactor`/`isTechnicalFinale`/`routeBreakawayFactor` navngivet konsistent på tværs af tasks.
