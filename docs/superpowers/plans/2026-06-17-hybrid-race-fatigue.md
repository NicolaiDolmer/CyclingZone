# Hybrid race-fatigue (cross-stage akkumulering + kalibrering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gøre in-race-træthed til en ægte faktor i Race Engine v2: træthed AKKUMULERER mellem etaper (en 21-etapers Grand Tour bliver en udmattelseskamp), og trætheds-vægten hæves empirisk så `durability` holder op med at være dødvægt — uden at vælte "stjerner vinder oftest".

**Architecture:** To uafhængige men komplementære ændringer bag det eksisterende `race_engine_v2_enabled`-flag (ingen nyt flag): (1) en ren akkumulerings-helper i `raceFatigue.js` der wires ind i den rene `buildRaceResults`-kerne i `raceRunner.js` (mutér hver rytters `fatigue` per etape, start = `rider_condition.fatigue` + summen af tidligere etapers belastning); (2) kalibrér `FATIGUE_RACE_WEIGHT` i `raceSimulator.js` via `race:gate:condition` (simulér-før-ship) til `durability` er levende. `simulateStage`-kontrakten er FROSSEN og røres ikke — det er præcis seamen `raceSimulator.js:74` beskriver ("fatigue — akkumuleret træthed over et etapeløb (kræver cross-stage state → runner)").

**Tech Stack:** Node.js (ESM, `node --test`), deterministisk seeded simulering (mulberry32). Ingen DB-ændringer, ingen migration, intet nyt flag. Kalibrerings-harness: `backend/scripts/raceGate.js` + `simulateSeasonDryRun.js`.

> **Alle kommandoer køres fra `backend/`.** Determinisme er en hård kontrakt: samme seed + input → identisk output (ingen `Math.random`/`Date`).
> **Acceptance for hele planen:** `npm test` grøn · `npm run race:gate` grøn (uændret) · `npm run race:gate:condition` grøn (`durability` ikke længere DØDVÆGT). Pre-eksisterende `race:gate:roles` itt-bånd + udbrud:flat er UDEN FOR scope (triages separat).

---

### Task 1: Ren akkumulerings-helper `stageEnteringFatigues`

**Files:**
- Modify: `backend/lib/raceFatigue.js` (tilføj eksport efter `raceFatigueLoad`, ~linje 27)
- Test: `backend/lib/raceFatigue.test.js` (tilføj tests)

- [ ] **Step 1: Skriv den fejlende test**

Tilføj i `backend/lib/raceFatigue.test.js` (importér helperen i den eksisterende import-blok fra `./raceFatigue.js`):

```js
import { stageEnteringFatigues } from "./raceFatigue.js";

test("stageEnteringFatigues: load lægges til EFTER hver etape, så etape 1 køres frisk", () => {
  // flat=10, mountain=18, high_mountain=20. Start 0.
  // Entering hver etape = [0, 0+10, 10+18] = [0, 10, 28].
  assert.deepEqual(stageEnteringFatigues(0, ["flat", "mountain", "high_mountain"]), [0, 10, 28]);
});

test("stageEnteringFatigues: start-træthed bæres med ind i etape 1", () => {
  assert.deepEqual(stageEnteringFatigues(40, ["flat", "flat"]), [40, 50]);
});

test("stageEnteringFatigues: null/undefined/NaN start → 0 (neutral, ikke worst-case)", () => {
  assert.deepEqual(stageEnteringFatigues(null, ["mountain"]), [0]);
  assert.deepEqual(stageEnteringFatigues(undefined, ["flat"]), [0]);
  assert.deepEqual(stageEnteringFatigues("x", ["flat"]), [0]);
});

test("stageEnteringFatigues: clamp ved 100 over en lang tour", () => {
  const seq = stageEnteringFatigues(0, Array(21).fill("high_mountain")); // load 20/etape
  assert.equal(seq[0], 0);
  assert.equal(seq[5], 100);                 // 0,20,40,60,80,100,...
  assert.ok(seq.every((v) => v >= 0 && v <= 100));
});

test("stageEnteringFatigues: tom etape-liste → tom sekvens", () => {
  assert.deepEqual(stageEnteringFatigues(50, []), []);
});
```

- [ ] **Step 2: Kør testen, bekræft den fejler**

Run: `node --test --import ./test-setup.js lib/raceFatigue.test.js`
Expected: FAIL — `stageEnteringFatigues is not a function` (eller `export` mangler).

- [ ] **Step 3: Implementér helperen**

I `backend/lib/raceFatigue.js`, efter `raceFatigueLoad` (linje 27):

```js
/**
 * Intra-løb trætheds-akkumulering (#1021-hybrid, ejer-valgt 2026-06-17).
 * Givet en rytters start-træthed (rider_condition.fatigue ved løbsstart, eller 0
 * hvis ingen condition-data) og etapeprofilerne i rækkefølge: returnér den træthed
 * rytteren GÅR IND TIL hver etape med. Etape i's belastning lægges til EFTER etape i
 * (rammer i+1, i+2 ...), så etape 1 køres på start-træthed og en 21-etapers tour
 * bliver en udmattelseskamp. Clamp 0–100. Ren + deterministisk.
 *
 * @param {number|null|undefined} startFatigue
 * @param {string[]} profileTypes  etapeprofiler i etape-rækkefølge
 * @returns {number[]} træthed ved START af hver etape (samme længde som profileTypes)
 */
export function stageEnteringFatigues(startFatigue, profileTypes) {
  let f = Number.isFinite(Number(startFatigue))
    ? Math.max(0, Math.min(100, Number(startFatigue)))
    : 0;
  const out = [];
  for (const p of profileTypes) {
    out.push(f);
    f = Math.min(100, f + raceFatigueLoad(p));
  }
  return out;
}
```

- [ ] **Step 4: Kør testen, bekræft den passer**

Run: `node --test --import ./test-setup.js lib/raceFatigue.test.js`
Expected: PASS (alle 5 nye + eksisterende `raceFatigue`-tests grønne).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceFatigue.js backend/lib/raceFatigue.test.js
git commit -m "feat(race): #1021 stageEnteringFatigues — ren cross-stage fatigue-akkumulering"
```

---

### Task 2: Wire akkumulering ind i `buildRaceResults`

**Files:**
- Modify: `backend/lib/raceRunner.js` (import ~linje 34; `buildRaceResults` ~linje 171-185 + return ~linje 245)
- Test: `backend/lib/raceRunner.test.js` (tilføj test)

- [ ] **Step 1: Skriv den fejlende test**

Tilføj i `backend/lib/raceRunner.test.js` (efter determinisme-testen, ~linje 141). `ENTRANTS` har ingen condition-data → start-træthed 0:

```js
test("træthed akkumulerer over etaper: finalFatigue afspejler entering sidste etape (#1021-hybrid)", () => {
  const { finalFatigue } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  // STAGES_3 = flat(10), mountain(18), high_mountain(20). Frisk rytter (ingen condition):
  // entering sidste etape (idx 2) = 0 + load(flat=10) + load(mountain=18) = 28.
  for (const e of ENTRANTS) assert.equal(finalFatigue[e.rider_id], 28);
});

test("akkumulering bevarer determinisme: finalFatigue identisk på tværs af kald", () => {
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const b = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  assert.deepEqual(a.finalFatigue, b.finalFatigue);
});
```

- [ ] **Step 2: Kør testen, bekræft den fejler**

Run: `node --test --import ./test-setup.js lib/raceRunner.test.js`
Expected: FAIL — `finalFatigue` er `undefined` (returneres ikke endnu).

- [ ] **Step 3: Tilføj import af helperen**

I `backend/lib/raceRunner.js`, linje 34, udvid den eksisterende import:

```js
import { applyRaceFatigue, stageEnteringFatigues } from "./raceFatigue.js";
```

- [ ] **Step 4: Precompute fatigue-sekvens + byg simEntrants med start-træthed**

Erstat `simEntrants`-konstruktionen (`backend/lib/raceRunner.js` linje 171-178):

```js
  const simEntrants = entrants.map((e) => ({
    rider_id: e.rider_id,
    team_id: e.team_id,
    abilities: e.abilities,
    ...(e.form != null ? { form: e.form } : {}),
    ...(e.fatigue != null ? { fatigue: e.fatigue } : {}),
    ...(e.race_role ? { race_role: e.race_role } : {}),
  }));
```

med:

```js
  // #1021-hybrid (ejer-valgt 2026-06-17): træthed AKKUMULERER mellem etaper — en
  // 21-etapers tour bliver en udmattelseskamp. Hver rytters start-træthed
  // (rider_condition.fatigue, eller 0) + summen af tidligere etapers belastning.
  // Fylder seamen raceSimulator.js:74 beskriver, uden at røre simulateStage-kontrakten.
  const stageProfiles = stagesSorted.map((s) => s.profile_type);
  const fatigueSeqById = new Map(
    entrants.map((e) => [e.rider_id, stageEnteringFatigues(e.fatigue, stageProfiles)])
  );

  const simEntrants = entrants.map((e) => ({
    rider_id: e.rider_id,
    team_id: e.team_id,
    abilities: e.abilities,
    ...(e.form != null ? { form: e.form } : {}),
    // fatigue sættes per etape i loopet (akkumulerende); start = etape 0's entering.
    fatigue: fatigueSeqById.get(e.rider_id)[0],
    ...(e.race_role ? { race_role: e.race_role } : {}),
  }));
```

- [ ] **Step 5: Sæt akkumuleret træthed før hvert simulateStage-kald**

I etape-loopet (`backend/lib/raceRunner.js`), umiddelbart efter `const stage = stagesSorted[i];` (linje 181) og FØR `simulateStage`-kaldet (linje 185), indsæt:

```js
    // Akkumuleret træthed gående ind til DENNE etape (idx i).
    for (const se of simEntrants) se.fatigue = fatigueSeqById.get(se.rider_id)[i];
```

- [ ] **Step 6: Returnér finalFatigue**

Erstat return-linjen (`backend/lib/raceRunner.js` linje 245) `return { resultRows, runs };` med:

```js
  // Træthed ved start af sidste etape pr. rytter (peak de reelt kørte på) — in-memory
  // observability + simulér-før-ship-verifikation. Persisteres ikke (intet DB-skema rørt).
  const lastIdx = stagesSorted.length - 1;
  const finalFatigue = Object.fromEntries(
    entrants.map((e) => [e.rider_id, fatigueSeqById.get(e.rider_id)[lastIdx]])
  );

  return { resultRows, runs, finalFatigue };
```

- [ ] **Step 7: Kør raceRunner-testen, bekræft den passer**

Run: `node --test --import ./test-setup.js lib/raceRunner.test.js`
Expected: PASS — alle eksisterende tests (emission, GC=klatrer-vinder, countback, determinisme) + de 2 nye grønne. Akkumulerings-effekten ved nuværende `FATIGUE_RACE_WEIGHT=0.008` er <1,5 % af terræn-scoren, så ingen eksisterende rangerings-test bør skifte. Hvis "klatreren vinder" eller "countback" fejler: STOP — det betyder vægten allerede er for høj eller der er en wiring-fejl; undersøg før du fortsætter.

- [ ] **Step 8: Kør hele backend-suiten (cross-file regression)**

Run: `npm test`
Expected: PASS — fuld suite. Særligt `raceRunnerPassthrough`, `raceDryRunOracles`, `raceSensitivity`, `raceBreakaway` (de rører motoren). Determinisme bevaret.

- [ ] **Step 9: Verificér base-gaten er stadig grøn MED akkumulering (uændret vægt)**

Run: `npm run race:gate`
Expected: `✅ race:gate grøn på alle 3 seeds`. Base-GT'en (21 etaper) akkumulerer nu træthed fra 0, men ved vægt 0.008 er effekten lille → "stjerner vinder oftest / GC = laveste tid / ingen monopol" holder. Hvis rød: STOP — akkumuleringen alene brækkede et oracle (uventet ved 0.008); undersøg før kalibrering.

- [ ] **Step 10: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/raceRunner.test.js
git commit -m "feat(race): #1021 cross-stage fatigue-akkumulering i buildRaceResults"
```

---

### Task 3: Kalibrér FATIGUE_RACE_WEIGHT (simulér-før-ship) + afled sanity-udskrift af konstanterne

**Files:**
- Modify: `backend/lib/raceSimulator.js` (linje 80 — `FATIGUE_RACE_WEIGHT`)
- Modify: `backend/scripts/simulateSeasonDryRun.js` (import + sanity-blok linje 722-737)

> **Dette er den balance-følsomme ændring.** Måltallet REGNES IKKE ud på forhånd — det FINDES via gaten. Stop-kriterium er eksplicit (Step 4). Estimat (ikke bindende): ~0.04–0.07 (5-9× nuværende 0.008).

- [ ] **Step 1: Mål baseline (durability-dødvægt nu)**

Run: `npm run race:gate:condition`
Expected: exit 1 — `durability ... ✗ DØDVÆGT` (⌀rank-gevinst ~0.01 < gulv 0.02). Notér rank-gevinsten. Dette er udgangspunktet vi skal flytte over 0.02.

- [ ] **Step 2: Afled sanity-udskriften af de FAKTISKE vægte (fjern stale tal)**

I `backend/scripts/simulateSeasonDryRun.js`, find den eksisterende import fra `./raceSimulator` (importerer bl.a. `NOISE_SD_SCALE`) og tilføj `FORM_RACE_WEIGHT, FATIGUE_RACE_WEIGHT`.

Erstat condition-mode-sanity-blokken (linje 722-737):

```js
if (CONDITION_MODE) {
  // Reelle vægte fra raceSimulator: FORM_RACE_WEIGHT=0.012, FATIGUE_RACE_WEIGHT=0.008.
  // formComponent  = ((form-50)/50)*0.012  → [30,90]-interval giver [-0.0048, +0.0096], swing 0.0144.
  // fatigueComponent = (fatigue/100)*0.008 → [0,70]-interval giver [0, +0.0056], swing 0.0056.
  // Kombineret max score-swing (condition-interval): 0.0144 + 0.0056 = 0.020.
  const forms    = field.map((r) => r.form    ?? 60);
  const fatigues = field.map((r) => r.fatigue ?? 0);
  const maxForm    = Math.max(...forms),    minForm    = Math.min(...forms);
  const maxFatigue = Math.max(...fatigues), minFatigue = Math.min(...fatigues);
  const meanForm    = Math.round(forms.reduce((s, v) => s + v, 0) / forms.length);
  const meanFatigue = Math.round(fatigues.reduce((s, v) => s + v, 0) / fatigues.length);
  console.log(`\n   condition-mode sanity (B4 — felt=${field.length} ryttere):`);
  console.log(`   form    range [${minForm}, ${maxForm}] ·  mean ${meanForm}  (tilsigtet [30, 90])`);
  console.log(`   fatigue range [${minFatigue}, ${maxFatigue}] · mean ${meanFatigue} (tilsigtet [0, 70])`);
  console.log(`   max score-swing (condition-interval): form 0.0144 + fatigue 0.0056 = 0.020`);
}
```

med (afleder swing fra konstanterne, så tallene aldrig drifter når vægten ændres):

```js
if (CONDITION_MODE) {
  // Score-swing AFLEDES af de faktiske vægte fra raceSimulator (ingen stale tal):
  //   formComponent  = ((form-50)/50)*FORM_RACE_WEIGHT     → [30,90]-interval
  //   fatigueComponent = (fatigue/100)*FATIGUE_RACE_WEIGHT → [0,70]-interval
  const forms    = field.map((r) => r.form    ?? 60);
  const fatigues = field.map((r) => r.fatigue ?? 0);
  const maxForm    = Math.max(...forms),    minForm    = Math.min(...forms);
  const maxFatigue = Math.max(...fatigues), minFatigue = Math.min(...fatigues);
  const meanForm    = Math.round(forms.reduce((s, v) => s + v, 0) / forms.length);
  const meanFatigue = Math.round(fatigues.reduce((s, v) => s + v, 0) / fatigues.length);
  const formSwing    = ((90 - 30) / 50) * FORM_RACE_WEIGHT;   // [30,90]-interval
  const fatigueSwing = (70 / 100) * FATIGUE_RACE_WEIGHT;      // [0,70]-interval
  console.log(`\n   condition-mode sanity (B4 — felt=${field.length} ryttere):`);
  console.log(`   form    range [${minForm}, ${maxForm}] ·  mean ${meanForm}  (tilsigtet [30, 90])`);
  console.log(`   fatigue range [${minFatigue}, ${maxFatigue}] · mean ${meanFatigue} (tilsigtet [0, 70])`);
  console.log(`   max score-swing (condition-interval): form ${formSwing.toFixed(4)} + fatigue ${fatigueSwing.toFixed(4)} = ${(formSwing + fatigueSwing).toFixed(4)}`);
}
```

- [ ] **Step 3: Hæv FATIGUE_RACE_WEIGHT (første kandidat)**

I `backend/lib/raceSimulator.js` linje 80, ændr:

```js
export const FATIGUE_RACE_WEIGHT = 0.008;  // træthed 100 → 0.008 (trækkes fra på call-site)
```

til (start-kandidat — justeres i Step 4):

```js
export const FATIGUE_RACE_WEIGHT = 0.045;  // #1021: træthed-følsomhed kalibreret via race:gate:condition (durability ikke-dødvægt)
```

- [ ] **Step 4: Kalibrerings-loop — find den laveste vægt der gør durability levende UDEN at vælte base-gaten**

Kør begge gates efter hver justering:

```
npm run race:gate            # må forblive grøn (stjerner vinder oftest, GC sane)
npm run race:gate:condition  # durability ⌀rank-gevinst skal ≥ 0.02 (ikke DØDVÆGT)
```

Stop-kriterium (ALLE skal holde):
1. `race:gate` grøn på alle 3 seeds (base-oracles uændret).
2. `race:gate:condition` melder IKKE `durability ... DØDVÆGT` (⌀rank-gevinst ≥ 0.02) og exit 0.
3. Vægten er den LAVESTE der opfylder 1+2 (juster i trin på 0.005: hvis condition stadig rød → hæv; hvis base-gaten vælter → sænk og acceptér evt. at durability lige akkurat rammer 0.02).

Hvis de to krav er i konflikt (durability kræver højere vægt end base-gaten tåler): STOP + rapportér til ejer — så er `DURABILITY_FATIGUE_DAMPING` (raceSimulator.js:84) eller `RACE_FATIGUE_BY_PROFILE` (raceFatigue.js:9) næste håndtag, og det er en ejer-beslutning (loop-guard: max 2 gate-runder på samme symptom → spørg, jf. learnings).

- [ ] **Step 5: Kør hele suiten igen (vægt-ændringen kan røre rangerings-tests)**

Run: `npm test`
Expected: PASS. Hvis `raceRunner`/`raceSensitivity`/`raceDryRunOracles` skifter pga. højere vægt: vurder om ændringen er korrekt (træthed SKAL nu flytte placeringer) og opdater de berørte assertions til den nye, tilsigtede adfærd — ikke omvendt. Determinisme-tests skal stadig passe uændret.

- [ ] **Step 6: Commit**

```bash
git add backend/lib/raceSimulator.js backend/scripts/simulateSeasonDryRun.js
git commit -m "feat(race): #1021 kalibrér FATIGUE_RACE_WEIGHT — durability ikke længere dødvægt + sanity afledt af konstanter"
```

---

### Task 4: Fuld verifikations-sweep + patch notes/help-beslutning + PR

**Files:**
- Verify: hele backend-suiten + alle 3 race-gates
- Modify (doc): `docs/superpowers/specs/2026-06-17-relaunch-hybrid-engine-1307-design.md` (markér Fase B trin 4 done + endelig vægt)

- [ ] **Step 1: Fuld lokal gate (samme sæt som CI + simulér-før-ship)**

Run (fra `backend/`):

```bash
npm test
npm run lint
npm run race:gate
npm run race:gate:condition
```

Expected: alle grønne. `race:gate:condition` viser nu `durability ... ✓` + den afledte score-swing-linje med de nye tal. Notér den endelige `FATIGUE_RACE_WEIGHT` + durability-rank-gevinst til PR-body.

- [ ] **Step 2: race:gate:roles — bekræft NÆR-uændret (kun pre-eksisterende reds)**

Run: `npm run race:gate:roles`
Expected: samme reds som baseline (`itt`-bånd under mål + `udbrud:flat` report-only) og INGEN nye. Kaptajn-sejre (roles vs neutral) skal forblive positive. Hvis et NYT bånd vælter pga. fatigue-vægten: notér det — det er in-scope at forstå (fatigue må ikke stjæle kaptajn-deltaet), men itt-båndet selv triages separat (uden for denne plan).

- [ ] **Step 3: Patch notes + help — dokumentér beslutning**

Ændringen er bag `race_engine_v2_enabled` (i dag `beta`, flippes `on` ved relaunch) → dormant for almindelige spillere indtil relaunch. **Beslutning:** patch notes + help.json udskydes til relaunch-comms (#1278), IKKE en separat note nu. Tilføj denne begrundelse i PR-body under "Patch notes" (opfylder patch-notes-reglen: opdatér ELLER skriv hvorfor ikke). Hvis du er i tvivl → spørg ejer.

- [ ] **Step 4: Opdatér relaunch-spec (Fase B trin 4 done)**

I `docs/superpowers/specs/2026-06-17-relaunch-hybrid-engine-1307-design.md` §5 Fase B, markér trin 4 som implementeret og indsæt den endelige `FATIGUE_RACE_WEIGHT` + durability-rank-gevinst (så acceptance-kriteriet er dokumenteret opfyldt).

- [ ] **Step 5: PR (feature → branch → PR, IKKE direkte på main)**

```bash
git add docs/superpowers/specs/2026-06-17-relaunch-hybrid-engine-1307-design.md
git commit -m "docs(relaunch): #1105 Fase B trin 4 — hybrid-fatigue implementeret + kalibreret"
git push -u origin HEAD
gh pr create --fill --base main
```

PR-body SKAL indeholde en **Brugerverifikation**-sektion (ellers fejler `PR user-verification check`) — her: backend-only motor-ændring bag flag, verificeret via `race:gate`/`race:gate:condition` (vedhæft scorecard-uddrag + endelig vægt). Ingen DB/migration → normal PR-flow (ikke ejer-merge-only). Følg branch-guard: verificér branch i selve commit-kæden (delt checkout).

---

## Self-Review (udført ved skrivning)

**Spec-dækning:** Spec §5 Fase B trin 4 ("cross-stage fatigue-akkumulering i raceRunner.js") = Task 1+2. Spec §6 simulér-før-ship-gate (punkt 2: "efter fatigue-ændring, gen-kør gaten, find den rigtige vægt") = Task 3. Acceptance-kriteriet fra NOW.md/§ (durability ikke dødvægt) = Task 3 Step 4. Patch-notes-reglen = Task 4 Step 3. ✓

**Placeholder-scan:** Ingen TBD/TODO. Den ENE empiriske værdi (`FATIGUE_RACE_WEIGHT`) har et eksplicit stop-kriterium + fallback-eskalering (Task 3 Step 3-4) — det er en kalibrerings-loop, ikke en placeholder. ✓

**Type/navne-konsistens:** `stageEnteringFatigues(startFatigue, profileTypes)` defineret i Task 1, brugt identisk i Task 2. `finalFatigue` returneres i Task 2 Step 6, asserteres i Task 2 Step 1. `fatigueSeqById` konsistent i Task 2. `FATIGUE_RACE_WEIGHT`/`FORM_RACE_WEIGHT` matcher `raceSimulator.js`-eksporterne. ✓

**Out-of-scope (eksplicit):** `race:gate:roles` itt-bånd + udbrud:flat (pre-eksisterende) · `runs[].input_checksum` inkluderer ikke fatigue (observability-gap, follow-up) · persistering af `finalFatigue` / spectation-UI (Fase D) · `simulateSeasonDryRun` GT-akkumulerings-oracle (Fase D trin 13). Intet nyt flag (gated af eksisterende `race_engine_v2_enabled`).
