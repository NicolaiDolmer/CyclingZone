# Race Hub — bund-rytter-dybde (0c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Udvid hvert holds start-trup fra 8 til 12 ryttere (4 unge + 4 kerne-domestiques + 4 ekstra-svage hale-domestiques) og top alle eksisterende live-hold op, så overlappende løb kan bemandes — uden at gøre felterne stærke.

**Architecture:** Afkobl `STARTER_SQUAD`-konstanterne fra `MIN_RIDERS_FOR_RACE` (CORE_SIZE=8, TAIL_SIZE=4, TOTAL_SIZE=12). Generér to svage pools (kerne-vindue [50,57] + hale-vindue [50,52]) via den eksisterende `buildWeakStarterPool` + derive-kæde, på begge allokerings-call-sites (relaunch-batch + single-team-signup). En separat, idempotent engangs-top-up (egen markør-kolonne) tilføjer hale-ryttere til alle eksisterende eligible hold. Simulér-før-ship er allerede udført (N=12, hale [50,52] valgt). Aktivering (reschedule + flag-flip) er en ejer-go-handling efter merge.

**Tech Stack:** Node.js (ESM), `node:test`, Supabase (service-role), `database/*.sql`-migrationer (auto-applies i prod), Infisical for prod-secrets.

**Spec:** [`docs/superpowers/specs/2026-06-23-race-hub-base-riders-design.md`](../specs/2026-06-23-race-hub-base-riders-design.md)

**Branch:** `feat/race-hub-0c-base-riders` (PR med `database/*.sql` → **ejer merger**; migration auto-applies i prod).

---

## Filstruktur

| Fil | Ansvar | Handling |
|-----|--------|----------|
| `backend/lib/starterSquadAllocator.js` | Konstanter + to-puljes generering + begge allokerings-call-sites | Modify |
| `backend/lib/starterSquadAllocator.test.js` | Enheds-tests (konstanter, tail-distribution, begge call-sites) | Modify |
| `database/2026-06-23-starter-depth-topup-marker.sql` | Ny markør-kolonne `starter_depth_topped_up_at` | Create |
| `backend/scripts/dev/topup-starter-depth.mjs` | Engangs additiv top-up af alle eligible hold (dry-run default) | Create |
| `backend/scripts/moneySupplyScorecard.js` | Økonomi-antagelse: 8-trup → 12-trup | Modify |
| `backend/scripts/prizeDistributionScorecard.js` | Samme antagelses-kommentar | Modify |
| `frontend/src/pages/PatchNotesPage.jsx` | Patch note (brugerrettet ændring) | Modify |
| `docs/FEATURE_STATUS.md` · `docs/NOW.md` | Status-opdatering | Modify |

**Designvalg (lås decomposition):** `allocateStarterSquads` forbliver fokuseret på KERNEN (8 fra kerne-puljen). En ny lille ren funktion `distributeTailRiders` snake-drafter halen (4 fra hale-puljen). DB-wrapperne kombinerer. `TAIL_SIZE = 0` reproducerer nuværende adfærd (regression-sikkerhed).

---

## Task 1: Afkobl konstanterne (CORE/TAIL/TOTAL)

**Files:**
- Modify: `backend/lib/starterSquadAllocator.js:24-44`
- Test: `backend/lib/starterSquadAllocator.test.js:131-134`

- [ ] **Step 1: Opdatér den eksisterende konstant-invariant-test**

I `starterSquadAllocator.test.js`, erstat testen på linje 131-134:

```js
test("STARTER_SQUAD: kerne = unge + kerne-domestiques = MIN_RIDERS_FOR_RACE; total = kerne + hale", () => {
  assert.equal(STARTER_SQUAD.YOUTH_PER_TEAM + STARTER_SQUAD.DOMESTIQUE_PER_TEAM, STARTER_SQUAD.CORE_SIZE);
  assert.equal(STARTER_SQUAD.CORE_SIZE, MIN_RIDERS_FOR_RACE, "kernen forbliver løbs-minimummet");
  assert.equal(STARTER_SQUAD.TOTAL_SIZE, STARTER_SQUAD.CORE_SIZE + STARTER_SQUAD.TAIL_SIZE);
  assert.equal(STARTER_SQUAD.TOTAL_SIZE, 12);
});
```

- [ ] **Step 2: Kør testen og se den fejle**

Run: `cd backend && node --test --test-name-pattern="kerne = unge" starterSquadAllocator.test.js`
Expected: FAIL — `STARTER_SQUAD.CORE_SIZE` er `undefined`.

- [ ] **Step 3: Tilføj de nye konstanter**

I `starterSquadAllocator.js`, erstat `STARTER_SQUAD`-blokken (linje 24-33):

```js
export const STARTER_SQUAD = Object.freeze({
  CORE_SIZE: MIN_RIDERS_FOR_RACE,         // 8 — den løbsklare kerne (= løbs-minimum)
  TAIL_SIZE: 4,                           // ekstra svage hale-domestiques (race-hub 0c)
  TOTAL_SIZE: MIN_RIDERS_FOR_RACE + 4,    // 12 — fuld start-trup (kerne + hale)
  YOUTH_PER_TEAM: 4,
  DOMESTIQUE_PER_TEAM: 4,                  // kerne-domestiques (halen er adskilt)
  YOUNG_AGE_MIN: 18,
  YOUNG_AGE_MAX: 21,
  YOUNG_POTENTIAL_MIN: 4.0,
  STAR_CUTOFF_FRACTION: 0.10,
  FAIRNESS_TOLERANCE_FRACTION: 0.15,
});
```

Tilføj efter `STARTER_POOL_STAT_WINDOW` (efter linje 44):

```js
// Race-hub 0c (ejer-valgt 2026-06-23, sim-kalibreret): hale-ryttere er ENDNU svagere
// end kernen. [50,52] → afledte top-evner ~7 (mod kernens ~21) via den lineære
// PCM-fallback-remap. Skarpest "nød-fyldere vs kerne"-tekstur + stærkest byg-selv-pres.
export const STARTER_TAIL_STAT_WINDOW = Object.freeze({ lo: 50, hi: 52 });
```

- [ ] **Step 4: Kør testen og se den passe**

Run: `cd backend && node --test --test-name-pattern="kerne = unge" starterSquadAllocator.test.js`
Expected: PASS.

- [ ] **Step 5: Migrér alle `SQUAD_SIZE`-referencer i allocatoren til CORE_SIZE/TOTAL_SIZE**

`SQUAD_SIZE` findes ikke længere. Ret hver brug i `starterSquadAllocator.js`:
- Linje 96-98 (`allocateStarterSquads`) bruger `C.SQUAD_SIZE` i top-up-loopet (linje 129) → `C.CORE_SIZE` (kernen allokerer 8).
- Linje 313 (`const SIZE = STARTER_SQUAD.SQUAD_SIZE;`) → `const SIZE = STARTER_SQUAD.TOTAL_SIZE;` (et fuldt-bootstrappet hold har nu 12).
- Linje 359 (`const count = teamIds.length * STARTER_SQUAD.SQUAD_SIZE;`) → fjernes i Task 3 (to-puljer); lad den stå urørt indtil da.
- Linje 267 (`count: STARTER_SQUAD.SQUAD_SIZE` i `insertWeakSquadForTeam`) → håndteres i Task 4; lad den stå urørt indtil da.
- Kommentaren linje 10 (`SQUAD_SIZE = MIN_RIDERS_FOR_RACE (8)`) → opdatér til at nævne CORE/TOTAL.

For DENNE task, ret KUN linje 129 (`C.SQUAD_SIZE` → `C.CORE_SIZE`) og linje 313 (`SQUAD_SIZE` → `TOTAL_SIZE`). De øvrige (267/359) ændres i deres respektive tasks.

- [ ] **Step 6: Opdatér alle `SQUAD_SIZE`-referencer i test-filen**

I `starterSquadAllocator.test.js` bruges `STARTER_SQUAD.SQUAD_SIZE` mange steder. For tests der vedrører **kernen/allokeringen** (`allocateStarterSquads`, linje 141-149, 174-179) → `CORE_SIZE`. For tests der vedrører **single-team total-trup** (`allocateStarterSquadForTeam`, linje 336-477) → `TOTAL_SIZE` (et nyt hold får nu 12). For `runStarterSquadAllocation` (linje 254-324) → afhænger af Task 3; lad de tests stå urørt nu (de opdateres i Task 3).

Konkret i denne task — kun `allocateStarterSquads`-rene tests (ingen DB):
- Linje 145: `assert.equal(assignments[t].length, STARTER_SQUAD.SQUAD_SIZE)` → `CORE_SIZE`.
- Linje 178: `STARTER_SQUAD.SQUAD_SIZE` → `CORE_SIZE`.

(`allocateStarterSquadForTeam`- og `runStarterSquadAllocation`-tests opdateres i Task 4 hhv. Task 3, hvor deres adfærd faktisk ændres.)

- [ ] **Step 7: Kør de rene allokerings-tests**

Run: `cd backend && node --test --test-name-pattern="hver manager får præcis|skæv pool" starterSquadAllocator.test.js`
Expected: PASS (kernen allokerer stadig 8 = CORE_SIZE).

- [ ] **Step 8: Commit**

```bash
git add backend/lib/starterSquadAllocator.js backend/lib/starterSquadAllocator.test.js
git commit -F .git/COMMIT_EDITMSG_TMP   # se nedenfor
```

Commit-besked (skriv til `.git/COMMIT_EDITMSG_TMP` med Write, IKKE heredoc):
```
refactor(starter-squad): afkobl CORE/TAIL/TOTAL fra MIN_RIDERS_FOR_RACE (0c)

CORE_SIZE=8 (løbs-minimum, uændret), TAIL_SIZE=4, TOTAL_SIZE=12. Ny
STARTER_TAIL_STAT_WINDOW [50,52]. Ingen adfærdsændring endnu (tail bruges i
Task 2-4). Refs #1798
```

---

## Task 2: Ren tail-distribution

**Files:**
- Modify: `backend/lib/starterSquadAllocator.js` (ny eksporteret funktion efter `allocateStarterSquads`, ~linje 145)
- Test: `backend/lib/starterSquadAllocator.test.js` (ny test efter `allocateStarterSquads`-testene, ~linje 195)

- [ ] **Step 1: Skriv den fejlende test**

Tilføj i `starterSquadAllocator.test.js` (importér `distributeTailRiders` i import-blokken linje 4-14):

```js
test("distributeTailRiders: hvert hold får perTeam hale-ryttere, balanceret, ingen overlap", () => {
  const teamIds = ["t1", "t2", "t3"];
  const tailPool = Array.from({ length: 30 }, (_, i) => ({ id: `tail-${i}`, base_value: 7000 - i * 10 }));
  const { tailAssignments, leftToMarket } = distributeTailRiders(tailPool, teamIds, 4, { seed: 2026 });
  for (const t of teamIds) assert.equal(tailAssignments[t].length, 4, `${t} hale`);
  const assigned = teamIds.flatMap((t) => tailAssignments[t]);
  assert.equal(new Set(assigned).size, assigned.length, "ingen hale-rytter på to hold");
  assert.equal(assigned.length, 12);
  assert.equal(leftToMarket.length, 30 - 12, "resten falder ud (skal ikke ske ved korrekt pulje-størrelse)");
});

test("distributeTailRiders: deterministisk (samme seed → samme resultat)", () => {
  const teamIds = ["t1", "t2"];
  const tailPool = Array.from({ length: 8 }, (_, i) => ({ id: `tail-${i}`, base_value: 7000 - i }));
  const a = distributeTailRiders(tailPool, teamIds, 4, { seed: 2026 });
  const b = distributeTailRiders(tailPool, teamIds, 4, { seed: 2026 });
  assert.deepEqual(a.tailAssignments, b.tailAssignments);
});
```

- [ ] **Step 2: Kør og se den fejle**

Run: `cd backend && node --test --test-name-pattern="distributeTailRiders" starterSquadAllocator.test.js`
Expected: FAIL — `distributeTailRiders is not a function`.

- [ ] **Step 3: Implementér `distributeTailRiders`**

Tilføj i `starterSquadAllocator.js` efter `allocateStarterSquads` (efter linje 145). Genbruger `seededShuffle` + `snakeDraft` (begge allerede i filen):

```js
// Race-hub 0c: snake-draft af den svage HALE (perTeam pr. hold) fra en separat
// hale-pulje. Adskilt fra allocateStarterSquads (kernen) så kernens fairness/
// stjerne-logik er urørt; halen er flade domestiques (ingen unge, ingen stjerner)
// → ren base_value-balanceret snake-draft. Determinisk (seeded shuffle inden for
// værdi-bånd → sortér desc → snake).
export function distributeTailRiders(tailPool, teamIds, perTeam, { seed = LAUNCH_POPULATION.seed } = {}) {
  const rng = makeRng(seed);
  const prepped = seededShuffle(tailPool, rng).sort((a, b) => (b.base_value || 0) - (a.base_value || 0));
  const tailAssignments = Object.fromEntries(teamIds.map((t) => [t, []]));
  const totals = Object.fromEntries(teamIds.map((t) => [t, 0]));
  const used = snakeDraft(prepped, teamIds, perTeam, tailAssignments, totals);
  const leftToMarket = prepped.slice(used).map((r) => r.id);
  return { tailAssignments, leftToMarket };
}
```

- [ ] **Step 4: Kør og se den passe**

Run: `cd backend && node --test --test-name-pattern="distributeTailRiders" starterSquadAllocator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Skriv besked til `.git/COMMIT_EDITMSG_TMP` og commit:
```
feat(starter-squad): ren distributeTailRiders til den svage hale (0c)

Refs #1798
```
```bash
git add backend/lib/starterSquadAllocator.js backend/lib/starterSquadAllocator.test.js
git commit -F .git/COMMIT_EDITMSG_TMP
```

---

## Task 3: To-puljer i relaunch-batch (`runStarterSquadAllocation`)

**Files:**
- Modify: `backend/lib/starterSquadAllocator.js:341-399` (`runStarterSquadAllocation`) + `STARTER_POOL_STAT_WINDOW` import-brug
- Test: `backend/lib/starterSquadAllocator.test.js:254-324`

- [ ] **Step 1: Opdatér `runStarterSquadAllocation`-testen til to-puljer (12 pr. hold)**

I testen (linje 254-324), ændr forventningerne fra `SQUAD_SIZE` (8) til `TOTAL_SIZE` (12). Mocken indsætter nu **to** pools (kerne 8 + hale 4 pr. hold). Erstat de tre nøgle-assertions:
- Linje 312: `assert.equal(inserted.length, 2 * STARTER_SQUAD.SQUAD_SIZE, ...)` → `assert.equal(inserted.length, 2 * STARTER_SQUAD.TOTAL_SIZE, "24 svage ryttere indsat (12/hold)");`
- Linje 316: `assert.equal(derived.length, 2 * STARTER_SQUAD.SQUAD_SIZE, ...)` → `2 * STARTER_SQUAD.TOTAL_SIZE`.
- Linje 317: `assert.equal(applied.assigned, 2 * STARTER_SQUAD.SQUAD_SIZE)` → `2 * STARTER_SQUAD.TOTAL_SIZE`.
- Linje 321: `assert.equal(teamIdUpdates.length, 2 * STARTER_SQUAD.SQUAD_SIZE, ...)` → `2 * STARTER_SQUAD.TOTAL_SIZE`.

Mocken (linje 282-291) returnerer i `range()` for `inIds` en række pr. id med `base_value: 5000`. Det dur stadig (begge pools læses tilbage). Bevar resten.

- [ ] **Step 2: Kør og se den fejle**

Run: `cd backend && node --test --test-name-pattern="runStarterSquadAllocation" starterSquadAllocator.test.js`
Expected: FAIL — `inserted.length` er 16, ikke 24 (kun kerne-puljen indsættes endnu).

- [ ] **Step 3: Implementér to-puljer i `runStarterSquadAllocation`**

Erstat kroppen fra `const count = ...` (linje 359) til allokeringen. Ny version (erstat linje 359-385):

```js
  const corePerPool = teamIds.length * STARTER_SQUAD.CORE_SIZE;
  const tailPerPool = teamIds.length * STARTER_SQUAD.TAIL_SIZE;

  const existingFoldedNames = await fetchExistingFoldedNames(supabase);

  // To svage pools: kerne [50,57] + hale [50,52]. Eget seed-offset pr. pulje så de
  // ikke spejler hinanden eller markeds-populationen.
  const corePayload = buildWeakStarterPool({
    count: corePerPool, seed: (seed + 1487) >>> 0, referenceYear,
    existingFoldedNames, window: STARTER_POOL_STAT_WINDOW, generate: d.generate,
  });
  const tailPayload = buildWeakStarterPool({
    count: tailPerPool, seed: (seed + 1487 + 7) >>> 0, referenceYear,
    existingFoldedNames, window: STARTER_TAIL_STAT_WINDOW, generate: d.generate,
  });

  if (dryRun) {
    return { dryRun: true, teams: teamIds.length, poolSize: corePerPool + tailPerPool, assigned: 0, toAssign: corePerPool + tailPerPool };
  }

  // Delt kerne: insert → derive (data-hale) → læs allokerings-pulje tilbage (begge pools).
  const corePool = await insertDeriveAndReadPool(supabase, corePayload, { referenceYear, derive: d.derive });
  const tailPool = await insertDeriveAndReadPool(supabase, tailPayload, { referenceYear, derive: d.derive });

  // Kerne: 4 unge + 4 kerne-dom (starCutoffFraction 0 — hele puljen er svag).
  const { assignments, leftToMarket, stats } = allocateStarterSquads(corePool, teamIds, { seed, starCutoffFraction: 0 });
  // Hale: 4 ekstra-svage dom pr. hold.
  const { tailAssignments } = distributeTailRiders(tailPool, teamIds, STARTER_SQUAD.TAIL_SIZE, { seed });
  for (const t of teamIds) assignments[t].push(...tailAssignments[t]);

  const pairs = Object.entries(assignments).flatMap(([teamId, ids]) =>
    ids.map((id) => ({ id, team_id: teamId })));
```

Bemærk: `buildWeakStarterPool`'s `existingFoldedNames` deles mellem de to kald — ved et ekstremt navne-sammenfald kan halen genbruge et navn fra kernen (begge genereres fra samme `existingFoldedNames`-snapshot). Risiko er minimal (forskellige seeds), men for at være eksakt: dette accepteres som kosmetisk (navne, ikke id'er; ingen DB-unik-constraint på navn). Hvis det skal lukkes helt, hører det i en opfølger.

`poolSize` i retur-objektet (linje 398): ændr `poolSize: pool.length` → `poolSize: corePool.length + tailPool.length`.

- [ ] **Step 4: Kør og se den passe**

Run: `cd backend && node --test --test-name-pattern="runStarterSquadAllocation" starterSquadAllocator.test.js`
Expected: PASS (24 indsat, 24 derivet, 24 team_id-tildelinger).

- [ ] **Step 5: Kør HELE allocator-test-filen (ingen regression)**

Run: `cd backend && node --test starterSquadAllocator.test.js`
Expected: alle PASS undtagen evt. `allocateStarterSquadForTeam`-tests der venter på Task 4 (de bør stadig passe — single-team røres ikke endnu, men forventer nu TOTAL_SIZE fra Task 1 step 6; hvis de fejler her, er det fordi single-team stadig kun laver 8 → forventet, fixes i Task 4). Noter hvilke der fejler.

- [ ] **Step 6: Commit**

Besked til `.git/COMMIT_EDITMSG_TMP`:
```
feat(starter-squad): to-puljer (kerne+hale) i relaunch-batch (0c)

Hvert relaunch-hold får nu 12 ryttere: 4 unge + 4 kerne-dom [50,57] + 4
hale-dom [50,52]. Refs #1798
```
```bash
git add backend/lib/starterSquadAllocator.js backend/lib/starterSquadAllocator.test.js
git commit -F .git/COMMIT_EDITMSG_TMP
```

---

## Task 4: To-tier i single-team-signup (`insertWeakSquadForTeam` + heal)

**Files:**
- Modify: `backend/lib/starterSquadAllocator.js:262-281` (`insertWeakSquadForTeam`) + `:296-335` (`allocateStarterSquadForTeam` heal-grene)
- Test: `backend/lib/starterSquadAllocator.test.js:336-477`

- [ ] **Step 1: Opdatér single-team-tests til TOTAL_SIZE (12)**

I `allocateStarterSquadForTeam`-testene (linje 336-477), erstat `STARTER_SQUAD.SQUAD_SIZE` → `STARTER_SQUAD.TOTAL_SIZE` overalt (happy-path, idempotens, heal-grene). Konkret linjer: 342, 344, 345, 400, 405, 406, 443, 444, 457, 458, 472, 473. Den delvise-insert-heal-test (linje 463-477) seeder 3 ryttere og forventer oprydning + 12 friske.

Forward-guard-testen (linje 360-378) bruger `STARTER_SQUAD.SQUAD_SIZE` til at bygge en ren kerne-pulje (linje 363-364). Den test verificerer KERNENS svaghed → behold `CORE_SIZE` der (ikke TOTAL_SIZE): `count: STARTER_SQUAD.CORE_SIZE`. Tilføj en tvilling-assertion for halen efter den (se step 5).

- [ ] **Step 2: Kør og se dem fejle**

Run: `cd backend && node --test --test-name-pattern="single-team|#1560|#1563" starterSquadAllocator.test.js`
Expected: FAIL — single-team laver stadig kun 8, tests forventer 12.

- [ ] **Step 3: Lav `insertWeakSquadForTeam` to-tier**

Erstat kroppen (linje 262-281). Generér kerne (8, [50,57]) + hale (4, [50,52]), begge med `team_id` sat, indsæt alle, derive alle:

```js
async function insertWeakSquadForTeam(supabase, teamId, { seed, referenceYear, generate, derive }) {
  const existingFoldedNames = await fetchExistingFoldedNames(supabase);
  // Per-hold seed: basis-offset (+1487, samme som relaunch) XOR hash(teamId).
  const coreSeed = deriveTeamSeed((seed + 1487) >>> 0, teamId);
  const tailSeed = deriveTeamSeed((seed + 1487 + 7) >>> 0, teamId);
  const corePayload = buildWeakStarterPool({
    count: STARTER_SQUAD.CORE_SIZE, seed: coreSeed, referenceYear, existingFoldedNames,
    window: STARTER_POOL_STAT_WINDOW, generate,
  }).map((r) => ({ ...r, team_id: teamId }));
  const tailPayload = buildWeakStarterPool({
    count: STARTER_SQUAD.TAIL_SIZE, seed: tailSeed, referenceYear, existingFoldedNames,
    window: STARTER_TAIL_STAT_WINDOW, generate,
  }).map((r) => ({ ...r, team_id: teamId }));
  const poolPayload = [...corePayload, ...tailPayload];

  const insertedIds = [];
  for (let i = 0; i < poolPayload.length; i += INSERT_BATCH) {
    const batch = poolPayload.slice(i, i + INSERT_BATCH);
    const { data, error } = await supabase.from("riders").insert(batch).select("id");
    if (error) throw new Error(`starter-squad insert ${teamId} ved ${i}: ${error.message}`);
    insertedIds.push(...(data || []).map((r) => r.id));
  }

  // Data-hale-garanti: physiology→abilities→type→base_value for de nye ryttere.
  await derive(supabase, insertedIds, { dryRun: false });
  return insertedIds;
}
```

(De heal-grene i `allocateStarterSquadForTeam` bruger allerede `SIZE = STARTER_SQUAD.TOTAL_SIZE` efter Task 1 step 5 → `n === SIZE` betyder nu 12, `0 < n < SIZE` rydder & re-allokerer til 12. Ingen yderligere ændring nødvendig der.)

- [ ] **Step 4: Kør og se dem passe**

Run: `cd backend && node --test --test-name-pattern="single-team|#1560|#1563" starterSquadAllocator.test.js`
Expected: PASS (12 ryttere pr. nyt hold; idempotens + heal-grene bevaret).

- [ ] **Step 5: Tilføj hale-svaghed til forward-guarden**

I forward-guard-testen (linje 360-378), efter kerne-tjekket, tilføj en hale-pulje-assertion (top-evne endnu lavere):

```js
  // Halen ([50,52]) er endnu svagere end kernen.
  const tailSeed = deriveTeamSeed((2026 + 1487 + 7) >>> 0, "fwd-guard-team");
  const tailPool = buildWeakStarterPool({ count: STARTER_SQUAD.TAIL_SIZE, seed: tailSeed, referenceYear: 2026, window: STARTER_TAIL_STAT_WINDOW });
  let tailMax = 0;
  for (const r of tailPool) {
    for (const k of STAT_KEYS) {
      assert.ok(r[k] >= STARTER_TAIL_STAT_WINDOW.lo && r[k] <= STARTER_TAIL_STAT_WINDOW.hi, `${k}=${r[k]} udenfor hale-vindue`);
    }
    const abilities = deriveAbilities({}, r, { asOfYear: 2026 });
    tailMax = Math.max(tailMax, ...STAT_DRIVEN.map((k) => abilities[k]));
  }
  assert.ok(tailMax <= 12, `hale-top-evne ${tailMax} > 12 — halen er ikke ekstra-svag`);
```

Importér `STARTER_TAIL_STAT_WINDOW` i import-blokken (linje 4-14).

- [ ] **Step 6: Kør hele test-filen**

Run: `cd backend && node --test starterSquadAllocator.test.js`
Expected: alle PASS.

- [ ] **Step 7: Commit**

Besked til `.git/COMMIT_EDITMSG_TMP`:
```
feat(starter-squad): to-tier (kerne+hale) i single-team-signup (0c)

Nye hold får nu 12 ved signup (8 kerne + 4 hale [50,52]); heal-grene bringer
til 12. Refs #1798
```
```bash
git add backend/lib/starterSquadAllocator.js backend/lib/starterSquadAllocator.test.js
git commit -F .git/COMMIT_EDITMSG_TMP
```

---

## Task 5: Markør-migration for dybde-top-up

**Files:**
- Create: `database/2026-06-23-starter-depth-topup-marker.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- Race-hub 0c: markør-kolonne for ENGANGS dybde-top-up (8→12-trup).
--
-- starter_squad_allocated_at markerer "fik dette hold sin oprindelige (8-)trup?".
-- Dybde-top-up'en (8→12) er et SEPARAT engangs-event → egen markør, så de to ikke
-- forveksles. Top-up'en tilføjer KUN svage hale-domestiques op til 12 og giver
-- aldrig gratis kerne-ryttere (samme anti-exploit-filosofi som #1563): markøren er
-- sandheden, ikke rytter-antallet → et hold der har solgt ned får ikke gratis trup
-- ved en gentaget kørsel.
--
-- IKKE backfilled: alle eksisterende hold har markør NULL → de ER målet for den
-- ene top-up-kørsel (topup-starter-depth.mjs --live). Efter kørslen er markøren sat
-- → idempotent (gentagne kørsler = no-op).
--
-- Service-role-only (læses/skrives kun server-side) → ingen klient-GRANT nødvendig.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS starter_depth_topped_up_at timestamptz;
```

- [ ] **Step 2: Verificér SQL-syntaks lokalt (parse-tjek)**

Run: `cd backend && node -e "const fs=require('fs');const s=fs.readFileSync('../database/2026-06-23-starter-depth-topup-marker.sql','utf8');if(!/ADD COLUMN IF NOT EXISTS starter_depth_topped_up_at/.test(s))throw new Error('mangler kolonne');console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

Besked til `.git/COMMIT_EDITMSG_TMP`:
```
feat(db): markør for engangs dybde-top-up (starter_depth_topped_up_at) (0c)

Refs #1798
```
```bash
git add database/2026-06-23-starter-depth-topup-marker.sql
git commit -F .git/COMMIT_EDITMSG_TMP
```

> **Bemærk:** denne PR indeholder `database/*.sql` → migration auto-applies i prod ved merge → **ejer merger PR'en**, ikke auto-merge.

---

## Task 6: Engangs dybde-top-up-script

**Files:**
- Create: `backend/scripts/dev/topup-starter-depth.mjs`

Genbruger den svage hale-mekanik + derive-kæden. Selector = alle eligible konkurrerende hold (managere + AI; ekskludér bank/frozen/test, NULL-tolerant som sim'en). Additiv: tilføj hale-ryttere op til TOTAL_SIZE, sæt markør. Dry-run default.

- [ ] **Step 1: Skriv scriptet**

```js
// Race-hub 0c: ENGANGS additiv dybde-top-up. For hvert eligible hold uden
// starter_depth_topped_up_at-markør: tilføj svage hale-domestiques ([50,52]) op til
// STARTER_SQUAD.TOTAL_SIZE (12), derive dem (data-hale), sæt markør. Additiv — rører
// ALDRIG eksisterende ryttere; giver aldrig kerne-ryttere. Idempotent på markøren.
//
// Selector: alle konkurrerende hold (managere OG AI), ekskl. bank/frosset/test
// (NULL-tolerant) — så overlap-løb har fulde modstander-felter (ejer-valg 23/6).
//
// Dry-run (default): rapportér hold + ryttere der VILLE tilføjes. Ingen writes.
//   infisical run --env=prod -- node backend/scripts/dev/topup-starter-depth.mjs
// Live (ejer-go): faktisk insert + derive + markør.
//   infisical run --env=prod -- node backend/scripts/dev/topup-starter-depth.mjs --live
import { createClient } from "@supabase/supabase-js";
import { STARTER_SQUAD, STARTER_TAIL_STAT_WINDOW, buildWeakStarterPool, deriveTeamSeed } from "../../lib/starterSquadAllocator.js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { foldNameNordic } from "../../lib/pcmRiderMatcher.js";
import { LAUNCH_POPULATION } from "../../lib/fictionalLaunchPopulation.js";

const LIVE = process.argv.includes("--live");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE secrets (infisical run --env=prod)"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SIZE = STARTER_SQUAD.TOTAL_SIZE;
const INSERT_BATCH = 500;

// Eligible konkurrerende hold uden top-up-markør (NULL-tolerant flags; inkl. AI).
const { data: teams, error: tErr } = await sb.from("teams")
  .select("id, starter_depth_topped_up_at")
  .or("is_bank.is.null,is_bank.eq.false")
  .or("is_frozen.is.null,is_frozen.eq.false")
  .or("is_test_account.is.null,is_test_account.eq.false");
if (tErr) { console.error("teams:", tErr.message); process.exit(1); }
const pending = (teams || []).filter((t) => !t.starter_depth_topped_up_at);
console.log(`${LIVE ? "LIVE" : "DRY-RUN"} — ${pending.length}/${teams.length} hold uden top-up-markør\n`);

// Nuværende rytter-antal pr. hold (ikke-pensioneret).
const ids = pending.map((t) => t.id);
const riderCounts = new Map(ids.map((id) => [id, 0]));
const riders = await fetchAllRows(() =>
  sb.from("riders").select("team_id").in("team_id", ids).or("is_retired.is.null,is_retired.eq.false"));
for (const r of riders) riderCounts.set(r.team_id, (riderCounts.get(r.team_id) || 0) + 1);

// Navne-unikhed mod ALLE eksisterende ryttere.
const existing = await fetchAllRows(() => sb.from("riders").select("firstname, lastname").order("id"));
const existingFoldedNames = new Set(existing.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));

let totalToAdd = 0;
const plan = [];
for (const t of pending) {
  const need = Math.max(0, SIZE - (riderCounts.get(t.id) || 0));
  if (need > 0) { totalToAdd += need; plan.push({ teamId: t.id, need }); }
}
console.log(`Hale-ryttere der tilføjes: ${totalToAdd} (på ${plan.length} hold; ${pending.length - plan.length} hold er allerede ≥${SIZE})`);

if (!LIVE) {
  console.log("\n(dry-run — intet skrevet. Kør med --live efter ejer-go.)");
  process.exit(0);
}

const nowIso = new Date().toISOString();
let added = 0;
for (const { teamId, need } of plan) {
  const tailSeed = deriveTeamSeed((LAUNCH_POPULATION.seed + 1487 + 7) >>> 0, teamId);
  const payload = buildWeakStarterPool({
    count: need, seed: tailSeed, referenceYear: LAUNCH_POPULATION.referenceYear,
    existingFoldedNames, window: STARTER_TAIL_STAT_WINDOW,
  }).map((r) => ({ ...r, team_id: teamId }));

  const insertedIds = [];
  for (let i = 0; i < payload.length; i += INSERT_BATCH) {
    const batch = payload.slice(i, i + INSERT_BATCH);
    const { data, error } = await sb.from("riders").insert(batch).select("id");
    if (error) { console.error(`insert ${teamId}:`, error.message); process.exit(1); }
    insertedIds.push(...(data || []).map((r) => r.id));
  }
  await deriveForRiderIds(sb, insertedIds, { dryRun: false });
  added += insertedIds.length;
}
// Sæt markør på ALLE pending hold (også dem der allerede var ≥SIZE → markér no-op).
for (const t of pending) {
  const { error } = await sb.from("teams").update({ starter_depth_topped_up_at: nowIso }).eq("id", t.id);
  if (error) console.error(`markør ${t.id}:`, error.message);
}
console.log(`\nLIVE færdig: ${added} hale-ryttere tilføjet, ${pending.length} hold markeret.`);
process.exit(0);
```

- [ ] **Step 2: Kør dry-run mod prod (read-only — ingen writes i dry-run)**

Run: `cd backend && infisical run --env=prod -- node scripts/dev/topup-starter-depth.mjs`
Expected: rapporterer ~168 pending hold + et `totalToAdd`-tal (≈ summen af 12−nuværende; sim'en viste 27 managere + 141 AI). INGEN writes. Verificér tallet er plausibelt (>0, < 168×12).

- [ ] **Step 3: Commit**

Besked til `.git/COMMIT_EDITMSG_TMP`:
```
feat(scripts): engangs dybde-top-up til 12 for alle eligible hold (0c)

Dry-run default; --live kræver ejer-go (prod-write: riders insert + markør).
Refs #1798
```
```bash
git add backend/scripts/dev/topup-starter-depth.mjs
git commit -F .git/COMMIT_EDITMSG_TMP
```

---

## Task 7: Økonomi-scorecard-antagelser

**Files:**
- Modify: `backend/scripts/moneySupplyScorecard.js:57`
- Modify: `backend/scripts/prizeDistributionScorecard.js:23`

- [ ] **Step 1: Opdatér antagelses-kommentarerne**

I `moneySupplyScorecard.js` linje 57, erstat:
```
// Autoritativ kilde: starterSquadAllocator.STARTER_SQUAD.SQUAD_SIZE (= MIN_RIDERS_FOR_RACE = 8).
```
med:
```
// Autoritativ kilde: starterSquadAllocator.STARTER_SQUAD.TOTAL_SIZE (= 12 efter race-hub 0c;
// 8 kerne + 4 svage hale-dom). Halen er base_value ~7k/lav løn → negligibel pengeudbuds-effekt.
```

I `prizeDistributionScorecard.js` linje 23, erstat:
```
//    8-rytters trup (= STARTER_SQUAD.SQUAD_SIZE, MIN_RIDERS_FOR_RACE) draftet fra et
```
med:
```
//    12-rytters trup (= STARTER_SQUAD.TOTAL_SIZE; 8 kerne + 4 svage hale efter 0c) draftet fra et
```

- [ ] **Step 2: Hvis scripts importerer `STARTER_SQUAD.SQUAD_SIZE` i kode (ikke kun kommentar), ret det**

Run: `cd backend && grep -rn "STARTER_SQUAD.SQUAD_SIZE\|SQUAD_SIZE" scripts/moneySupplyScorecard.js scripts/prizeDistributionScorecard.js`
Hvis der er en kode-reference (ikke kommentar) til `SQUAD_SIZE`, ret til `TOTAL_SIZE` (den tilsigtede økonomiske trup-størrelse). Hvis kun kommentarer: ingen kode-ændring.

- [ ] **Step 3: Verificér scripts stadig importerer rent (smoke)**

Run: `cd backend && node --check scripts/moneySupplyScorecard.js && node --check scripts/prizeDistributionScorecard.js`
Expected: ingen syntaksfejl.

- [ ] **Step 4: Commit**

Besked til `.git/COMMIT_EDITMSG_TMP`:
```
docs(scorecard): økonomi-antagelse 8→12-trup efter race-hub 0c

Refs #1798
```
```bash
git add backend/scripts/moneySupplyScorecard.js backend/scripts/prizeDistributionScorecard.js
git commit -F .git/COMMIT_EDITMSG_TMP
```

---

## Task 8: Patch notes + status-docs

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `docs/FEATURE_STATUS.md`, `docs/NOW.md`

- [ ] **Step 1: Tilføj patch note**

Åbn `PatchNotesPage.jsx`, find den nyeste version-blok øverst, og tilføj en ny note over den (følg den eksisterende struktur/komponent-form i filen — kopiér mønstret fra den seneste entry). Indhold (EN først, DA under, ingen em-dash):

- EN: "Teams now start with a deeper squad (12 riders) so you can field overlapping races. The extra riders are deliberately weak domestiques you'll want to upgrade."
- DA: "Hold starter nu med en dybere trup (12 ryttere), så du kan stille hold til overlappende løb. De ekstra ryttere er bevidst svage domestiques, du vil opgradere."

(Hvis patch-note-systemet er version-tjekket i CI: bump versionen efter den eksisterende konvention i filen.)

- [ ] **Step 2: Opdatér FEATURE_STATUS.md**

Tilføj/opdatér race-hub-linjen: bund-rytter-dybde (0c) = trup 8→12 (4 unge + 4 kerne + 4 hale [50,52]), top-up klar, aktivering afventer ejer-go (reschedule + flag).

- [ ] **Step 3: Opdatér NOW.md** (budget ≤ ~1.200 tokens — trim gammelt)

Sæt aktiv slice = race-hub 0c implementeret, afventer ejer-go på aktivering (reschedule-overlap --live + topup-starter-depth --live + flip auto_entry_generator_enabled). Opdatér 🎯 Next action + nulstil 🤖 Working agent ved close-out.

- [ ] **Step 4: Commit**

Besked til `.git/COMMIT_EDITMSG_TMP`:
```
docs(patch-notes): dybere start-trup (12) — race-hub 0c

Refs #1798
```
```bash
git add frontend/src/pages/PatchNotesPage.jsx docs/FEATURE_STATUS.md docs/NOW.md
git commit -F .git/COMMIT_EDITMSG_TMP
```

---

## Færdiggørelse (efter alle tasks)

- [ ] **Fuldt CI-gate-sæt før PR:** `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + frontend-build) + `cd backend && npm run lint` + i18n-leak + tone-em-dash + warning-budget. Frontend kun rørt i Task 8 (patch notes) → kør frontend `node --test` + playwright core-smoke hvis PatchNotesPage rendering ændrede sig.
- [ ] **PR:** opret mod `main` med Brugerverifikation-sektion. PR indeholder `database/*.sql` → **ejer merger** (ikke auto-merge).
- [ ] **Postmortem:** ikke en bugfix → ingen `.claude/learnings/`-fil påkrævet.

## Aktivering (ejer-go, EFTER merge — alt samtidig, IKKE en kode-task)

1. `infisical run --env=prod -- node backend/scripts/dev/topup-starter-depth.mjs` (dry-run, verificér tal) → derefter `--live` (ejer-go).
2. `infisical run --env=prod -- node backend/scripts/dev/reschedule-overlap.mjs --live` (sæson 1 → overlap; dry-run allerede ren: peak=2, 0 binding-konflikter).
3. Flip flag `auto_entry_generator_enabled` ON.
4. Verificér: kør `simulate-base-rider-depth.mjs` igen (read-only) → fuldt-hold-grad skal nu matche ~100% for managere live.

---

## Self-review-noter (udført ved planskrivning)

- **Spec-dækning:** §3 (struktur) → Task 1-2; §4 (begge call-sites) → Task 3-4; §5 (top-up + markør) → Task 5-6; §6 (sim) → allerede udført; §7 (økonomi) → Task 7; §8 (aktivering) → dokumenteret, ejer-go. Patch notes (CLAUDE.md-krav) → Task 8.
- **Type-konsistens:** `CORE_SIZE`/`TAIL_SIZE`/`TOTAL_SIZE`/`STARTER_TAIL_STAT_WINDOW`/`distributeTailRiders` brugt konsistent på tværs af Task 1-6. `SQUAD_SIZE` fjernet (ingen rest-reference efter Task 1+7).
- **Regression:** `TAIL_SIZE=0` ville reproducere gammel adfærd; alle eksisterende invariant-/forward-guard-tests bevaret (opdateret til CORE/TOTAL).
- **Heredoc-forbud:** alle commits via Write→`.git/COMMIT_EDITMSG_TMP` + `git commit -F` (aldrig `<<EOF`).
