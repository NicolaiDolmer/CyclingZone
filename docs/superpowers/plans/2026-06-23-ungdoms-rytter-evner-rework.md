# Ungdoms-rytter-evner rework — implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ungdomsryttere fødes svage og flade (top ~15 ved 16) og gennemgår en reel rejse mod et potentiale+anlæg-bestemt loft; de 76 eksisterende akademi-ryttere migreres ned til samme model.

**Architecture:** Tre rene mekanik-ændringer (lav anlægs-formet ungdoms-generering · afkoblet loft fra potentiale+anlæg · potentiale→træningsfart) testes på invarianter/relationer, ikke på magiske tal. De præcise tal kalibreres empirisk i et sim-scorecard som ejeren godkender (Fase D), før migreringen (Fase E) køres mod en prod-klon og dernæst prod.

**Tech Stack:** Node.js (ESM), `node:test`, Supabase (Postgres), eksisterende rene motor-moduler i `backend/lib/`.

**Spec:** `docs/superpowers/specs/2026-06-23-ungdoms-rytter-evner-rework-design.md`

---

## Designgrundlag (verificeret kode-fakta)

- `backend/lib/academyGenerator.js` laver i dag flade `gaussian(58/52, 6)` stats clamp [40,85] — for høje/brede.
- `backend/lib/fictionalRiderGenerator.js` har intern `buildStats(rng, tier, archetype)` + `ARCHETYPES` (boost/damp pr. type) + `STAT_FLOOR=50`/`STAT_CEIL=85`. Disse er IKKE eksporteret i dag.
- `backend/lib/abilityDerivation.js`: akademi-ryttere har v1-legacy-fysiologi → **PCM-fallback** (`stat 50→evne 1`, `85→evne 99`; ingen kontrast). Røres IKKE.
- `backend/lib/riderProgression.js`: `abilityCap(baseline, type, ability, potentiale) = baseline + headroom(potentiale)×signatureFactor`, `headroomByPotential {1:4…6:38}`. `signatureFactor` slår op i `RIDER_TYPES`-vægte (positiv=1.0, negativ=0, neutral=0.35). `stepAbility(...)` har INGEN potentiale-rate i dag. `buildCaps` bygger caps lazy fra baseline-abilities.
- `backend/lib/riderTypes.js`: `RIDER_TYPES[].weights` (positiv=speciale, negativ=modsat). `computeRiderTypes(abilities)` → `{primary, secondary}` udledt EFTER derive.
- `backend/lib/backfillCores.js`: `deriveForRiderIds(supabase, ids)` kører physiology→abilities→type→base_value for et id-sæt; akademi-intake kalder den. `seedPhysiologyFromLegacy` laver v1-profil (uden `aero`).
- Test-kommando (backend): `node --test backend/lib/<fil>.test.js` fra repo-root.

## Fil-struktur

| Fil | Ansvar | Ændring |
|---|---|---|
| `backend/lib/riderProgression.js` | Loft + sæson-vækst | Tilføj `YOUTH_PROGRESSION_CONFIG`, `youthRoleFactor`, `youthAbilityCap`, `buildYouthCaps`; potentiale-rate i `stepAbility`/`developRiderSeason`. |
| `backend/lib/academyGenerator.js` | Ungdoms-generering | Erstat flade stats med lave, anlægs-formede, alders-skalerede stats; eksportér `generateYouthStats`. |
| `backend/lib/fictionalRiderGenerator.js` | Arketype-data | Eksportér `ARCHETYPES`/`ARCHETYPE_BY_TYPE` + `pickYouthArchetype` så akademi-stien genbruger anlægs-formningen (DRY). |
| `backend/scripts/youthModelSimulation.js` | Sim-scorecard (NY) | Kør kohorte gennem generering + N sæsoners progression → scorecard (peak-rejse, top-evne-fordeling, værdi). |
| `backend/scripts/migrateAcademyRiders.js` | Migrering (NY) | Deterministisk, identitets-bevarende re-generering af `is_academy`-ryttere + re-derive + base_value. |
| `backend/lib/*.test.js` | Tests | Relations-tests pr. ny funktion. |
| `frontend/src/data/patchNotes.js`, `frontend/public/locales/{en,da}/help.json` | Brugerrettet | Patch notes + FAQ. |

---

## Fase A — Afkoblet ungdoms-loft (`riderProgression.js`)

### Task A1: Rolle-faktor for en evne ift. 2 anlægs-retninger

**Files:**
- Modify: `backend/lib/riderProgression.js`
- Test: `backend/lib/riderProgression.test.js`

- [ ] **Step 1: Skriv den fejlende test**

Tilføj i `backend/lib/riderProgression.test.js`:

```js
import { youthRoleFactor, YOUTH_PROGRESSION_CONFIG } from "./riderProgression.js";

test("youthRoleFactor: primær-naturlig > sekundær-naturlig > neutral > modsat", () => {
  // climber primary, tt secondary. climbing er primær-naturlig (climber.weights.climbing=3>0).
  const primary = youthRoleFactor("climber", "tt", "climbing");
  const secondary = youthRoleFactor("climber", "tt", "time_trial"); // tt.weights.time_trial=3>0, men kun secondary
  const neutral = youthRoleFactor("climber", "tt", "positioning");  // ingen type-vægt
  const opposite = youthRoleFactor("climber", "tt", "sprint");      // climber.weights.sprint=-2<0
  assert.equal(primary, YOUTH_PROGRESSION_CONFIG.naturalPrimaryFactor);
  assert.equal(secondary, YOUTH_PROGRESSION_CONFIG.naturalSecondaryFactor);
  assert.equal(neutral, YOUTH_PROGRESSION_CONFIG.neutralFactor);
  assert.equal(opposite, YOUTH_PROGRESSION_CONFIG.oppositeFactor);
  assert.ok(primary > secondary && secondary > neutral && neutral > opposite);
});
```

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/riderProgression.test.js`
Expected: FAIL (`youthRoleFactor is not a function` / `YOUTH_PROGRESSION_CONFIG` undefined).

- [ ] **Step 3: Implementér**

Tilføj i `backend/lib/riderProgression.js` (efter `PROGRESSION_CONFIG`):

```js
// ── Ungdoms-loft (#akademi-rework 2026-06-23) — START-værdier, kalibreres i Fase D ──
export const YOUTH_PROGRESSION_CONFIG = Object.freeze({
  // Mål-niveau på en PRIMÆR naturlig evne ved fuldt indfriet potentiale.
  loftByPotential: Object.freeze({ 1: 35, 2: 48, 3: 60, 4: 70, 5: 80, 6: 88 }),
  // Andel af loftet en evne får efter dens rolle ift. de 2 anlægs-retninger.
  naturalPrimaryFactor: 1.0,
  naturalSecondaryFactor: 0.82,
  neutralFactor: 0.45,
  oppositeFactor: 0.12,
  // Potentiale → træningsfart-multiplikator (Fase B).
  rateByPotential: Object.freeze({ 1: 0.6, 2: 0.78, 3: 0.92, 4: 1.06, 5: 1.2, 6: 1.35 }),
});

// Rolle-faktor for én evne givet primær+sekundær type. Positiv vægt i primary →
// primær-naturlig; ellers positiv i secondary → sekundær-naturlig; negativ i primary
// (eller secondary uden positiv) → modsat; ellers neutral.
export function youthRoleFactor(primaryType, secondaryType, ability, cfg = YOUTH_PROGRESSION_CONFIG) {
  const wp = WEIGHTS_BY_TYPE[primaryType]?.[ability];
  const ws = WEIGHTS_BY_TYPE[secondaryType]?.[ability];
  if (wp > 0) return cfg.naturalPrimaryFactor;
  if (ws > 0) return cfg.naturalSecondaryFactor;
  if (wp < 0 || ws < 0) return cfg.oppositeFactor;
  return cfg.neutralFactor;
}
```

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `node --test backend/lib/riderProgression.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/riderProgression.js backend/lib/riderProgression.test.js
git commit -m "feat(progression): youthRoleFactor + YOUTH_PROGRESSION_CONFIG for afkoblet ungdoms-loft"
```

### Task A2: Afkoblet ungdoms-loft (`youthAbilityCap` + `buildYouthCaps`)

**Files:**
- Modify: `backend/lib/riderProgression.js`
- Test: `backend/lib/riderProgression.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
import { youthAbilityCap, buildYouthCaps } from "./riderProgression.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

test("youthAbilityCap: afkoblet fra start-evne, stiger med potentiale", () => {
  // Samme rytter, to potentialer → højere pot giver højere loft, UANSET baseline.
  const lowPot = youthAbilityCap(2, "climber", "tt", "climbing");
  const highPot = youthAbilityCap(6, "climber", "tt", "climbing");
  assert.ok(highPot > lowPot, `pot6 ${highPot} skal > pot2 ${lowPot}`);
  // Afkobling: loftet afhænger IKKE af en start-evne (ingen baseline-parameter).
  assert.equal(youthAbilityCap.length, 5); // (potentiale, primary, secondary, ability, cfg)
});

test("buildYouthCaps: primær-evne højest, modsat lavest, alle ≤99", () => {
  const caps = buildYouthCaps(6, "climber", "tt");
  for (const k of VISIBLE_ABILITIES) assert.ok(caps[k] >= 0 && caps[k] <= 99);
  assert.ok(caps.climbing > caps.sprint, `climbing ${caps.climbing} skal > sprint ${caps.sprint}`);
});
```

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/riderProgression.test.js`
Expected: FAIL (`youthAbilityCap is not a function`).

- [ ] **Step 3: Implementér**

Tilføj i `backend/lib/riderProgression.js`:

```js
// Lineær interpolation af ungdoms-loft-ankret på potentiale (1..6).
function youthLoftForPotential(potentiale, cfg = YOUTH_PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg.loftByPotential[lo] ?? 0;
  const b = cfg.loftByPotential[hi] ?? a;
  return a + (b - a) * (p - lo);
}

// Afkoblet ungdoms-loft for én evne: potentiale-ankret niveau × rolle-faktor.
// IKKE en funktion af start-evnen (det er hele pointen — den lange rejse).
export function youthAbilityCap(potentiale, primaryType, secondaryType, ability, cfg = YOUTH_PROGRESSION_CONFIG) {
  const target = youthLoftForPotential(potentiale, cfg) * youthRoleFactor(primaryType, secondaryType, ability, cfg);
  return clamp(Math.round(target), 0, 99);
}

// Byg caps-sættet for en ung over alle synlige evner.
export function buildYouthCaps(potentiale, primaryType, secondaryType, cfg = YOUTH_PROGRESSION_CONFIG) {
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    caps[ability] = youthAbilityCap(potentiale, primaryType, secondaryType, ability, cfg);
  }
  return caps;
}
```

Tilføj `import { VISIBLE_ABILITIES } from "./abilityDerivation.js";` øverst hvis ikke allerede importeret (det er det — `riderProgression.js` importerer den allerede).

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `node --test backend/lib/riderProgression.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/riderProgression.js backend/lib/riderProgression.test.js
git commit -m "feat(progression): youthAbilityCap + buildYouthCaps (loft fra potentiale+anlaeg)"
```

---

## Fase B — Potentiale → træningsfart

### Task B1: Potentiale-rate i `stepAbility`/`developRiderSeason`

**Files:**
- Modify: `backend/lib/riderProgression.js`
- Test: `backend/lib/riderProgression.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
import { developRiderSeason } from "./riderProgression.js";

test("potentiale styrer træningsfart: pot6 vokser hurtigere end pot2 fra samme start mod samme loft", () => {
  const abilities = { climbing: 20 };
  const caps = { climbing: 80 };
  const low = developRiderSeason({ id: "r1", primary_type: "climber", potentiale: 2, age: 18 }, abilities, caps, 1);
  const high = developRiderSeason({ id: "r1", primary_type: "climber", potentiale: 6, age: 18 }, abilities, caps, 1);
  assert.ok(high.next.climbing > low.next.climbing,
    `pot6 ${high.next.climbing} skal > pot2 ${low.next.climbing} efter én sæson`);
});
```

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/riderProgression.test.js`
Expected: FAIL (pot påvirker ikke vækst i dag → ens resultat).

- [ ] **Step 3: Implementér**

I `backend/lib/riderProgression.js`, tilføj rate-helper:

```js
// Potentiale → vækst-rate-multiplikator (lineær interpolation på rateByPotential).
export function youthRateForPotential(potentiale, cfg = YOUTH_PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg.rateByPotential[lo] ?? 1;
  const b = cfg.rateByPotential[hi] ?? a;
  return a + (b - a) * (p - lo);
}
```

I `developRiderSeason`, fold potentiale-raten ind i `growthMult` (gælder kun vækst-fasen, ikke decline — `stepAbility` anvender allerede `growthMult` kun ved `age <= peakAge`):

```js
const potRate = youthRateForPotential(rider.potentiale, cfg);
const growthMult = (training
  ? (training.focusAbilities.has(ability) ? training.focusMult : training.offFocusMult)
  : 1) * potRate;
```

(Erstat den eksisterende `growthMult`-linje i loopet med ovenstående.)

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `node --test backend/lib/riderProgression.test.js`
Expected: PASS.

- [ ] **Step 5: Kør HELE progression-suiten (regression for voksne)**

Run: `node --test backend/lib/riderProgression.test.js backend/lib/riderProgressionEngine.test.js`
Expected: PASS (ingen eksisterende test brydes; voksne nær peak har lille gap → minimal effekt).

- [ ] **Step 6: Commit**

```bash
git add backend/lib/riderProgression.js backend/lib/riderProgression.test.js
git commit -m "feat(progression): potentiale styrer traeningsfart (youthRateForPotential)"
```

### Task B2: Potentiale-rate i daglig træning

**Files:**
- Modify: `backend/lib/dailyTraining.js`
- Test: `backend/lib/dailyTraining.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
import { dailyAbilityDelta } from "./dailyTraining.js";

test("potentiale skalerer daglig vækst: pot6 > pot2 ved samme gap/alder/program", () => {
  const base = { ability: "climbing", current: 20, cap: 80, age: 18,
    program: { focus: "climbing", intensity: "hard" }, conditionMult: 1, bonus: false, noise: 1 };
  const low = dailyAbilityDelta({ ...base, potentiale: 2 });
  const high = dailyAbilityDelta({ ...base, potentiale: 6 });
  assert.ok(high > low, `pot6 ${high} skal > pot2 ${low}`);
});
```

(Bemærk: `TRAINING_FOCUSES["climbing"]` skal inkludere `climbing` — verificér i `training.js`; hvis fokus-nøglen hedder noget andet, brug den korrekte focus-nøgle der rummer climbing.)

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/dailyTraining.test.js`
Expected: FAIL (potentiale ignoreres i dag).

- [ ] **Step 3: Implementér**

I `backend/lib/dailyTraining.js`, importér rate-helper og gang den ind i `dailyAbilityDelta`:

```js
import { PROGRESSION_CONFIG, seededUnit, youthRateForPotential } from "./riderProgression.js";
```

Udvid `dailyAbilityDelta`-signaturen med `potentiale` og gang `youthRateForPotential(potentiale)` ind i returneringen:

```js
export function dailyAbilityDelta({ ability, current, cap, age, program, conditionMult, bonus, noise, potentiale }) {
  const gap = Math.max(0, (cap ?? current) - current);
  if (gap === 0) return 0;
  const mult = abilityMult(ability, program);
  if (mult === 0) return 0;
  const cfg = DAILY_TRAINING_CONFIG;
  const base = (gap * growthFractionForAge(age) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  return base * mult * conditionMult * youthMultiplier(age) * youthRateForPotential(potentiale)
    * (bonus ? cfg.bonusMult : 1) * noise;
}
```

I `applyDailyTick`, videregiv `potentiale` til `dailyAbilityDelta` (tilføj `potentiale` til `applyDailyTick`-parametrene og til kaldet i loopet):

```js
export function applyDailyTick({ riderId, dateStr, age, abilities, caps, progress, program, conditionMult, bonus, potentiale }) {
  // ... uændret indtil delta-kaldet:
    const delta = dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age, program, conditionMult, bonus, noise, potentiale,
    });
  // ... resten uændret
```

I `backend/lib/dailyTrainingEngine.js`, videregiv `rider.potentiale` til `applyDailyTick` (tilføj `potentiale: rider.potentiale` til kaldet ~linje 165).

- [ ] **Step 4: Kør testene — forvent PASS**

Run: `node --test backend/lib/dailyTraining.test.js backend/lib/dailyTrainingEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/dailyTraining.js backend/lib/dailyTrainingEngine.js backend/lib/dailyTraining.test.js
git commit -m "feat(training): potentiale skalerer daglig traeningsfart"
```

---

## Fase C — Lav, anlægs-formet ungdoms-generering

### Task C1: Eksportér arketype-data fra `fictionalRiderGenerator.js`

**Files:**
- Modify: `backend/lib/fictionalRiderGenerator.js`
- Test: `backend/lib/fictionalRiderGenerator.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
import { ARCHETYPE_BY_TYPE, ARCHETYPES } from "./fictionalRiderGenerator.js";

test("ARCHETYPES eksporteret med boost/damp pr. type", () => {
  assert.ok(Array.isArray(ARCHETYPES) && ARCHETYPES.length === 8);
  assert.ok(ARCHETYPE_BY_TYPE.climber?.boost?.stat_bj > 0);
});
```

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/fictionalRiderGenerator.test.js`
Expected: FAIL (`ARCHETYPES` ikke eksporteret).

- [ ] **Step 3: Implementér**

I `backend/lib/fictionalRiderGenerator.js`, tilføj `export` foran `const ARCHETYPES` og `const ARCHETYPE_BY_TYPE` (linje ~87 og ~97). Ingen anden ændring.

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `node --test backend/lib/fictionalRiderGenerator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/fictionalRiderGenerator.js backend/lib/fictionalRiderGenerator.test.js
git commit -m "refactor(generator): eksportér ARCHETYPES til genbrug i akademi-stien"
```

### Task C2: Lav anlægs-formet stat-generering for unge

**Files:**
- Modify: `backend/lib/academyGenerator.js`
- Test: `backend/lib/academyGenerator.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```js
import { generateYouthStats, YOUTH_GEN_CONFIG } from "./academyGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities } from "./abilityDerivation.js";

test("generateYouthStats: 16-årig climber → afledt top ~15, bund ~7, ingen evne >25", () => {
  const rng = makeRng(2026);
  const { stats, archetypeType } = generateYouthStats({ rng, age: 16, potentiale: 6, archetypeType: "climber" });
  const rider = { id: "y1", birthdate: "2010-06-15", potentiale: 6, height: 175, weight: 60, ...stats };
  const abil = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
  const phys = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
  const vals = phys.map((k) => abil[k]);
  const top = Math.max(...vals), bottom = Math.min(...vals);
  assert.ok(top <= 25, `top-evne ${top} skal være lav for en 16-årig`);
  assert.ok(bottom >= 1, `bund ${bottom}`);
  assert.equal(archetypeType, "climber");
});

test("generateYouthStats: 19-årig fødes stærkere end 16-årig (alders-skalering)", () => {
  const young = generateYouthStats({ rng: makeRng(5), age: 16, potentiale: 5, archetypeType: "sprinter" });
  const older = generateYouthStats({ rng: makeRng(5), age: 19, potentiale: 5, archetypeType: "sprinter" });
  const sum = (s) => Object.values(s.stats).reduce((a, b) => a + b, 0);
  assert.ok(sum(older) > sum(young), `19-årig ${sum(older)} skal > 16-årig ${sum(young)}`);
});
```

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/academyGenerator.test.js`
Expected: FAIL (`generateYouthStats` ikke defineret).

- [ ] **Step 3: Implementér**

I `backend/lib/academyGenerator.js`, tilføj imports og en lav stat-generator. Stats holdes i et lavt bånd lige over PCM-floor (50), med en let anlægs-hældning og en alders-skalering. START-værdier kalibreres i Fase D.

```js
import { ARCHETYPE_BY_TYPE } from "./fictionalRiderGenerator.js";

export const YOUTH_GEN_CONFIG = Object.freeze({
  // Basis-stat-niveau ved 16 år (lige over PCM-floor 50 → afledt evne ~1-7).
  baseStatAt16: 51.5,
  // Stat-løft pr. år over 16 (alders-skalering = "spol frem").
  statPerYearOver16: 1.4,
  // Signatur-løft: arketypens boostede stats løftes (skaleret ned fra voksen-niveau).
  signatureBoostScale: 0.45,
  // Spredning (lille → flad profil).
  sd: 1.2,
  // Hårde grænser så afledte evner bliver i ungdoms-båndet (stat 50 → evne 1).
  statFloor: 50,
  statCeil: 62,
});

// Generér lave, anlægs-formede, alders-skalerede stats for én ung.
// archetypeType: en af de 8 typer (vælges af kalderen via pickYouthArchetype).
export function generateYouthStats({ rng, age, potentiale, archetypeType, cfg = YOUTH_GEN_CONFIG }) {
  const arch = ARCHETYPE_BY_TYPE[archetypeType];
  if (!arch) throw new Error(`generateYouthStats: ukendt arketype ${archetypeType}`);
  const ageLift = Math.max(0, (Number(age) || 16) - 16) * cfg.statPerYearOver16;
  const base = cfg.baseStatAt16 + ageLift;
  const stats = {};
  for (const key of STAT_KEYS) {
    let v = gaussian(rng, base, cfg.sd);
    if (arch.boost[key]) v += arch.boost[key] * cfg.signatureBoostScale;
    else if (arch.damp?.includes(key)) v -= 1; // let dæmpning af modsatte
    stats[key] = Math.round(clamp(v, cfg.statFloor, cfg.statCeil));
  }
  return { stats, archetypeType };
}
```

(`gaussian`, `STAT_KEYS`, `clamp` er allerede importeret/defineret i filen.)

- [ ] **Step 4: Kør testen — forvent PASS**

Run: `node --test backend/lib/academyGenerator.test.js`
Expected: PASS. (Hvis top-evne > 25, sænk `baseStatAt16`/`signatureBoostScale` — kalibreres endeligt i Fase D, men testen skal passere på START-værdierne.)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/academyGenerator.js backend/lib/academyGenerator.test.js
git commit -m "feat(academy): lav anlaegs-formet alders-skaleret ungdoms-stat-generering"
```

### Task C3: Brug `generateYouthStats` + anlægs-valg i `generateAcademyCandidates`

**Files:**
- Modify: `backend/lib/academyGenerator.js`
- Test: `backend/lib/academyGenerator.test.js`

- [ ] **Step 1: Opdatér den eksisterende stat-range-assertion**

I `backend/lib/academyGenerator.test.js`, ændr den eksisterende assertion (linje ~21) fra `>= 40 && <= 85` til ungdoms-båndet:

```js
    for (const k of ["stat_fl", "stat_sp", "stat_bj"]) assert.ok(c.rider[k] >= 50 && c.rider[k] <= 62);
```

Tilføj en ny test:

```js
test("akademi-kandidat har et anlæg (boostet signatur-stat) og lave stats", () => {
  const out = generateAcademyCandidates({ rng: makeRng(2026), referenceYear: REF_YEAR, existingNames: new Set() });
  for (const c of out) {
    const maxStat = Math.max(...["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_sp","stat_acc","stat_udh","stat_mod","stat_res"].map((k) => c.rider[k]));
    assert.ok(maxStat <= 62, `max stat ${maxStat} skal være i ungdoms-båndet`);
  }
});
```

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/academyGenerator.test.js`
Expected: FAIL (gamle generator laver stats op til 85).

- [ ] **Step 3: Implementér**

I `backend/lib/academyGenerator.js`, erstat stat-genererings-blokken i `generateAcademyCandidates` (linjerne der laver `statMean`/`stats` via `gaussian(rng, statMean, 6)`) med et arketype-valg + `generateYouthStats`. Tilføj en deterministisk arketype-vælger (genbruger seriøsitet til at vægte typer let):

```js
// Vælg et ungdoms-anlæg (én af de 8 typer). Seriøse må trække mod leder-typer;
// ikke-seriøse mod hjælper-typer. Holdt enkelt; nation-bias rører ikke type.
const YOUTH_ARCHETYPE_POOL = ["climber", "sprinter", "tt", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"];
function pickYouthArchetype(rng) {
  return YOUTH_ARCHETYPE_POOL[Math.floor(rng() * YOUTH_ARCHETYPE_POOL.length)];
}
```

I kandidat-loopet, erstat stats-blokken:

```js
    const archetypeType = pickYouthArchetype(rng);
    const { stats } = generateYouthStats({ rng, age, potentiale, archetypeType });
```

(Behold `potentiale`-beregningen, men flyt den FØR `generateYouthStats`-kaldet så `potentiale` er defineret. `is_serious` styrer fortsat potentiale-båndet som i dag.)

- [ ] **Step 4: Kør HELE akademi-suiten — forvent PASS**

Run: `node --test backend/lib/academyGenerator.test.js backend/lib/academyIntake.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/academyGenerator.js backend/lib/academyGenerator.test.js
git commit -m "feat(academy): generér kandidater via lav anlaegs-formet ungdoms-model"
```

### Task C4: Sæt ungdoms-caps i `deriveForRiderIds` for akademi-ryttere

**Files:**
- Modify: `backend/lib/backfillCores.js`
- Test: `backend/lib/backfillCores.test.js`

**Kontekst:** `deriveForRiderIds` skriver `rider_derived_abilities` men sætter i dag ikke `ability_caps`. Caps bygges ellers lazy i progression-motoren via `buildCaps` (baseline+headroom) — forkert for unge. Vi sætter `ability_caps` eksplicit til `buildYouthCaps` for akademi-alder-ryttere, så det afkoblede loft gælder fra fødslen.

- [ ] **Step 1: Skriv den fejlende test**

```js
import { computeYouthCapsForRider } from "./backfillCores.js";

test("computeYouthCapsForRider: akademi-alder rytter får afkoblede caps; voksen får null", () => {
  const youth = computeYouthCapsForRider({ birthdate: "2010-06-15", potentiale: 6 }, "climber", "tt", 2026);
  assert.ok(youth && youth.climbing >= youth.sprint, "ung climber: climbing-cap ≥ sprint-cap");
  const adult = computeYouthCapsForRider({ birthdate: "1996-06-15", potentiale: 6 }, "climber", "tt", 2026);
  assert.equal(adult, null, "voksen (30) får ikke ungdoms-caps");
});
```

- [ ] **Step 2: Kør testen — forvent fejl**

Run: `node --test backend/lib/backfillCores.test.js`
Expected: FAIL (`computeYouthCapsForRider` ikke defineret).

- [ ] **Step 3: Implementér**

I `backend/lib/backfillCores.js`, importér og tilføj helper + skriv caps i derive-stien:

```js
import { buildYouthCaps } from "./riderProgression.js";
import { isAcademyAge } from "./academyFlag.js";

// Ungdoms-caps for akademi-alder-ryttere (16-21). Voksne → null (behold lazy baseline+headroom).
export function computeYouthCapsForRider(rider, primaryType, secondaryType, asOfYear = 2026) {
  const birthYear = rider?.birthdate ? new Date(rider.birthdate).getFullYear() : null;
  if (!Number.isFinite(birthYear)) return null;
  const age = asOfYear - birthYear;
  if (!isAcademyAge(age)) return null;
  return buildYouthCaps(rider.potentiale, primaryType, secondaryType);
}
```

I `deriveForRiderIds`, i `riderUpdates`-map'en, tilføj `ability_caps` til `rider_derived_abilities`-payloaden (NB: caps hører til `rider_derived_abilities`, ikke `riders`). Udvid `abilities`-map'en før upsert:

```js
  // ungdoms-caps: skriv afkoblet loft på akademi-alder-ryttere (sat ved derive, uforanderligt).
  const abilitiesWithCaps = abilities.map((a) => {
    const r = riders.find((rr) => rr.id === a.rider_id);
    const t = typeByRider.get(a.rider_id) || {};
    const caps = computeYouthCapsForRider(r, t.primary_type, t.secondary_type, CALIBRATION_ASOF_YEAR);
    return caps ? { ...a, ability_caps: caps } : a;
  });
```

og brug `abilitiesWithCaps` i upsert-kaldet (`upsertBatched(supabase, "rider_derived_abilities", abilitiesWithCaps, "rider_id")`). Definér `const CALIBRATION_ASOF_YEAR = 2026;` øverst i filen (eller importér fra `abilityDerivation.CALIBRATION.asOfYear`).

- [ ] **Step 4: Kør testene — forvent PASS**

Run: `node --test backend/lib/backfillCores.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/backfillCores.js backend/lib/backfillCores.test.js
git commit -m "feat(derive): saet afkoblede ungdoms-caps for akademi-alder ved derive"
```

---

## Fase D — Sim-harness + ejer-kalibrering (balance-gate)

### Task D1: Sim-scorecard for ungdoms-modellen

**Files:**
- Create: `backend/scripts/youthModelSimulation.js`

- [ ] **Step 1: Skriv sim-scriptet**

Et rent simulerings-script (ingen DB-writes) der genererer en kohorte på tværs af potentialer/anlæg, kører dem gennem `generateYouthStats` → derive → `buildYouthCaps` → N sæsoners `developRiderSeason`, og printer et scorecard.

```js
// Sim-scorecard for ungdoms-modellen (#akademi-rework). Ingen DB. Kalibrerings-loop:
// kør → læs scorecard → justér YOUTH_GEN_CONFIG/YOUTH_PROGRESSION_CONFIG → gentag.
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { generateYouthStats } from "../lib/academyGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { buildYouthCaps, developRiderSeason } from "../lib/riderProgression.js";

const PHYS = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
const archetypes = ["climber","sprinter","tt","gc","puncheur","brostensrytter","rouleur","baroudeur"];

function topOf(ab) { return Math.max(...PHYS.map((k) => ab[k] ?? 0)); }

function simulateOne({ rng, potentiale, archetypeType, startAge, seasons }) {
  const { stats } = generateYouthStats({ rng, age: startAge, potentiale, archetypeType });
  const rider = { id: `sim-${potentiale}-${archetypeType}`, birthdate: `${2026 - startAge}-06-15`, potentiale, height: 178, weight: 66, ...stats };
  let ab = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
  const { primary, secondary } = computeRiderTypes(ab);
  const caps = buildYouthCaps(potentiale, primary.key, secondary.key);
  const startTop = topOf(ab);
  const journey = [{ age: startAge, top: startTop }];
  for (let s = 1; s <= seasons; s++) {
    const age = startAge + s;
    const dev = developRiderSeason({ id: rider.id, primary_type: primary.key, potentiale, age }, ab, caps, s);
    ab = dev.next;
    journey.push({ age, top: topOf(ab) });
  }
  return { potentiale, archetypeType, primaryType: primary.key, startTop, endTop: topOf(ab), journey };
}

function main() {
  const seasons = 14;
  console.log("=== Ungdoms-model scorecard ===");
  console.log("Start-evne ved 16 (top-evne) pr. potentiale:");
  for (const p of [2, 4, 6]) {
    const tops = archetypes.map((a) => simulateOne({ rng: makeRng(100 + p), potentiale: p, archetypeType: a, startAge: 16, seasons }).startTop);
    console.log(`  pot ${p}: top ved 16 = min ${Math.min(...tops)} · max ${Math.max(...tops)}`);
  }
  console.log("\nRejse (top-evne over alder) for en climber:");
  for (const p of [2, 4, 6]) {
    const r = simulateOne({ rng: makeRng(7), potentiale: p, archetypeType: "climber", startAge: 16, seasons });
    console.log(`  pot ${p}: ${r.journey.map((j) => `${j.age}:${j.top}`).join("  ")}  → loft-nået ${r.endTop}`);
  }
  console.log("\nKARIKATUR-CHECK (16-årige): evner på gulv (≤8) bør være FÅ:");
  let floorCount = 0, n = 0;
  for (const a of archetypes) for (const p of [2, 4, 6]) {
    const { stats } = generateYouthStats({ rng: makeRng(n + 1), age: 16, potentiale: p, archetypeType: a });
    const rider = { id: `c${n}`, birthdate: "2010-06-15", potentiale: p, height: 175, weight: 62, ...stats };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
    floorCount += PHYS.filter((k) => (ab[k] ?? 0) <= 8).length; n++;
  }
  console.log(`  snit fysiske evner på gulv pr. ung: ${(floorCount / n).toFixed(1)} (mål: lavt, < ~1)`);
}

main();
```

- [ ] **Step 2: Kør sim'en**

Run: `node backend/scripts/youthModelSimulation.js`
Expected: Et scorecard printes (start-evner, rejse-kurver, karikatur-check).

- [ ] **Step 3: Commit sim-scriptet**

```bash
git add backend/scripts/youthModelSimulation.js
git commit -m "feat(sim): scorecard-harness for ungdoms-modellen"
```

### Task D2: Ejer-kalibrering (HUMAN GATE)

- [ ] **Step 1: Præsentér scorecard for ejeren**

Kør `node backend/scripts/youthModelSimulation.js`, og vis ejeren: (a) top-evne ved 16 pr. potentiale (mål: ~15 for de bedste, lavere for resten), (b) rejse-kurverne (når et stort talent ~loft over en plausibel årrække?), (c) karikatur-check (gulv-evner pr. ung skal være lavt).

- [ ] **Step 2: Justér config mod ejer-feedback**

Tun `YOUTH_GEN_CONFIG` (`baseStatAt16`, `statPerYearOver16`, `signatureBoostScale`, `statCeil`) og `YOUTH_PROGRESSION_CONFIG` (`loftByPotential`, rolle-faktorer, `rateByPotential`) i `riderProgression.js`/`academyGenerator.js`, gentag sim, indtil ejeren godkender scorecardet.

- [ ] **Step 3: Lås kalibreringen + commit**

```bash
git add backend/lib/riderProgression.js backend/lib/academyGenerator.js
git commit -m "balance(academy): ejer-godkendte ungdoms-kalibreringstal (sim-scorecard)"
```

**STOP-gate:** Gå ikke videre til migrering (Fase E) før ejeren har godkendt scorecardet.

---

## Fase E — Migrering af de 76 `is_academy` (kun efter D2)

### Task E1: Migrerings-script (deterministisk, identitets-bevarende)

**Files:**
- Create: `backend/scripts/migrateAcademyRiders.js`

- [ ] **Step 1: Skriv scriptet**

Henter alle `is_academy=true`-ryttere, re-genererer deres stats med `generateYouthStats` ud fra deres EKSISTERENDE alder + potentiale + nuværende primary_type som anlæg (identitets-bevarende), og kører `deriveForRiderIds` (som nu sætter ungdoms-caps + base_value). `--dry-run` default; `--apply` skriver.

```js
// Migrér eksisterende is_academy-ryttere til den nye ungdoms-model. Deterministisk
// pr. rytter (seed = hash(rider.id)), identitets-bevarende (navn/alder/potentiale/
// type/hold/kontrakt urørt). Default dry-run; --apply for at skrive.
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { generateYouthStats } from "../lib/academyGenerator.js";
import { deriveForRiderIds } from "../lib/backfillCores.js";
import { STAT_KEYS } from "../lib/fictionalRiderGenerator.js";

function hashSeed(id) { let h = 0x811c9dc5; const s = String(id); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const riders = await fetchAllRows(() => supabase.from("riders")
    .select("id, birthdate, potentiale, primary_type, firstname, lastname").eq("is_academy", true).order("id"));
  console.log(`Migrerer ${riders.length} akademi-ryttere (apply=${apply})`);

  const updates = [];
  for (const r of riders) {
    const age = 2026 - new Date(r.birthdate).getFullYear();
    const archetypeType = r.primary_type || "rouleur"; // bevar anlæg; fallback hvis null
    const { stats } = generateYouthStats({ rng: makeRng(hashSeed(r.id)), age, potentiale: r.potentiale, archetypeType });
    updates.push({ id: r.id, ...Object.fromEntries(STAT_KEYS.map((k) => [k, stats[k]])) });
  }

  if (!apply) {
    console.log("DRY-RUN. Eksempel:", updates.slice(0, 3));
    return;
  }
  // 1) Skriv nye (lave) stats.
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase.from("riders").update(patch).eq("id", id);
    if (error) throw new Error(`stats update ${id}: ${error.message}`);
  }
  // 2) Re-derive (physiology→abilities→type→base_value + ungdoms-caps via Fase C4).
  await deriveForRiderIds(supabase, riders.map((r) => r.id), { dryRun: false, log: console.log });
  console.log("Migrering fuldført.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Kør dry-run lokalt mod prod-klon**

Opret en Supabase preview-branch (prod-klon) og peg env mod den. Run: `node backend/scripts/migrateAcademyRiders.js` (dry-run).
Expected: Printer 76 ryttere + eksempel-stats i ungdoms-båndet (50-62).

- [ ] **Step 3: Commit scriptet**

```bash
git add backend/scripts/migrateAcademyRiders.js
git commit -m "feat(migration): script til at migrere is_academy-ryttere til ungdoms-modellen"
```

### Task E2: Verificér mod prod-klon, kør, verificér prod

- [ ] **Step 1: Apply mod prod-klon (Supabase preview-branch)**

Run: `node backend/scripts/migrateAcademyRiders.js --apply` (mod klon-env).

- [ ] **Step 2: Verificér scorecard på klonen (SQL)**

Kør samme audit-query som i analysen mod klonen:

```sql
SELECT count(*) AS hentede,
  count(*) FILTER (WHERE top_evne >= 55) AS top_55_plus,
  round(avg(top_evne),1) AS avg_top, round(avg(snit),1) AS avg_snit
FROM (
  SELECT greatest(da.climbing,da.time_trial,da.flat,da.tempo,da.sprint,da.acceleration,da.punch,
    da.endurance,da.recovery,da.durability,da.descending,da.cobblestone,da.positioning,da.aggression,da.tactics) AS top_evne,
    (da.climbing+da.time_trial+da.flat+da.tempo+da.sprint+da.acceleration+da.punch+da.endurance+da.recovery+
     da.durability+da.descending+da.cobblestone+da.positioning+da.aggression+da.tactics)/15.0 AS snit
  FROM riders r JOIN rider_derived_abilities da ON da.rider_id = r.id
  WHERE r.is_academy = true AND r.team_id IS NOT NULL) x;
```

Expected: `top_55_plus` ≈ 0, `avg_top` markant lavere end de oprindelige 57,5.

- [ ] **Step 3: HUMAN GATE — ejer godkender klon-resultat, så kør mod prod**

Efter ejer-go: peg env mod prod, Run: `node backend/scripts/migrateAcademyRiders.js --apply`. Verificér med samme SQL mod prod.

---

## Fase F — Integration, gates, kommunikation, close-out

### Task F1: Fuldt CI-gate-sæt

- [ ] **Step 1: Kør backend-tests + lokal verifikation**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend-tests + frontend-tests + frontend-build PASS.

- [ ] **Step 2: Kør lint + warning-budget**

Run: `npm run lint`
Expected: PASS.

### Task F2: Patch notes + FAQ/hjælp

**Files:**
- Modify: `frontend/src/data/patchNotes.js`
- Modify: `frontend/public/locales/en/help.json`, `frontend/public/locales/da/help.json`

- [ ] **Step 1: Tilføj patch-note-entry**

Tilføj en ny version-entry i `patchNotes.js` (EN-first, DA-second) der forklarer: ungdomsryttere starter nu svagt og udvikles via træning; potentiale styrer hvor højt og hvor hurtigt; eksisterende akademi-ryttere er nedjusteret som varslet. (Tjek den nuværende seneste version og inkrementer.)

- [ ] **Step 2: Opdatér help.json (en+da)**

Opdatér akademi-/ungdoms-sektionen i begge `help.json` så den beskriver den nye model (svag start, træn dem op, potentiale = talent-loft + træningsfart).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/data/patchNotes.js frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git commit -m "docs(patch-notes): ungdoms-rytter-rework + opdateret FAQ"
```

### Task F3: PR + close-out

- [ ] **Step 1: Verificér branch + push**

Bekræft at arbejdet er på en feature-branch (ikke main). Push.

- [ ] **Step 2: Opret PR med Brugerverifikation-sektion**

PR-body skal have en `## Brugerverifikation`-sektion med `- [ ]`-punkter (ny ung er svag; rejse virker; de 76 migreret). NB: PR rører `database`/migrering-stier kun via script (ingen `database/*.sql`), men ÆNDRER prod-data ved kørsel → **ejer kører migrering + merger** (ingen auto-merge).

- [ ] **Step 3: Opdatér `docs/NOW.md` + markér issue**

Peg `🎯 Next action` videre; nulstil `🤖 Working agent`. Kommentér på akademi-epic [#932] med hvad der landede.

---

## Self-review (udført ved skrivning)

- **Spec-dækning:** §3-beslutninger 1-6 → Fase A/B/C; §4.1 start-form → C2/C3; §4.2 loft → A1/A2/C4; §4.3 rate → B1/B2; §6 migrering → E1/E2; §7 sim → D1/D2; §4.4 derive-konsistens → C4 (caps ved derive, ingen `abilityDerivation`-ændring). ✓
- **Placeholders:** Kalibrerings-tal er bevidste START-værdier i config, der tunes i D2 (eksplicit metode, ikke "TODO"). Ingen tomme steps.
- **Type-konsistens:** `youthRoleFactor`/`youthAbilityCap`/`buildYouthCaps`/`youthRateForPotential`/`generateYouthStats`/`computeYouthCapsForRider` bruges med samme signatur på tværs af tasks. `YOUTH_PROGRESSION_CONFIG` (riderProgression) vs `YOUTH_GEN_CONFIG` (academyGenerator) er bevidst adskilte.

## Åbne afhængigheder at verificere under eksekvering

- `TRAINING_FOCUSES`-nøgler i `training.js` (B2-testen antager en focus der rummer `climbing`) — verificér den rigtige nøgle.
- `ability_caps`-kolonnen findes på `rider_derived_abilities` (bekræftet brugt i `riderProgressionEngine`/`dailyTrainingEngine`).
- Supabase preview-branch (prod-klon) tilgængelig for E2 (ellers verificér mod en frisk kopi — ikke en tom DB, jf. column-privilege-læring).
