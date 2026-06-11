# #1102 Race-motor: kalibrering, launch-gate + runtime-wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør den eksisterende light race-motor launch-klar: kalibrér mod ejer-målbånd, promovér dry-run-cockpittet til håndhævet launch-gate, og wire motoren ind i runtime via flag-gated admin-endpoints + admin-UI — uden at røre PCM-fallback-stien.

**Architecture:** Motoren (slice 1+2) er færdig og merged: `raceSimulator.js` (ren funktion) + `raceRunner.simulateRace` (I/O-orchestrator der spejler PCM-importens idempotens og kalder uændret `applyRaceResults` + board-weekend). Dette arbejde tilføjer KUN: (a) tuning af to konstant-sæt, (b) gate-håndhævelse i eksisterende cockpit-script, (c) et tyndt handler-lib + to admin-routes (spejler `adminImportResultsHandler`-mønstret), (d) admin-UI-sektion, (e) `race_viewed`-instrumentering. Flag-off = PCM-stien præcist uændret.

**Tech Stack:** Node/Express + Supabase (backend, `node --test`), React/Vite (frontend), feature-flag i `app_config`.

---

## Nuværende state (verificeret 11/6 mod runtime)

| Komponent | State |
|---|---|
| `backend/lib/raceSimulator.js` | ✅ Merged. `NOISE_SD_SCALE = 0.20` (linje 42) — ét tuning-punkt for varians |
| `backend/lib/raceStageProfileGenerator.js` | ✅ Merged. `DEMAND_VECTORS` (linje 38) — ét tuning-punkt for terræn-vægte. Eksporterer `generateRaceStageProfiles(race, { seed })` (linje 158) |
| `backend/lib/raceRunner.js` | ✅ Merged. `simulateRace` (linje 350) gør ALT: profiles→entrants→points→`buildRaceResults`→idempotent delete/insert→`applyRaceResults`→`persistRuns`→status completed→`recomputeRaceDays`→board-weekend→Discord. **0 call-sites** — det er gabet |
| `backend/lib/raceEngineFlag.js` | ✅ Merged. `isRaceEngineV2Enabled` fail-safe (fejl→false). Flag OFF i prod |
| `backend/scripts/simulateSeasonDryRun.js` | ✅ Cockpit virker. Strukturelle oracles håndhæves ALTID (exit 1); kalibrerings-bånd kun bag `--enforce-targets` (afventede ejer-beslutning). Kandidat-vægte dokumenteret i kalibreringsloggen linje 67-80 (reverteret) |
| Kalibrering | ❌ Baseline: flat 62% · itt tt 50% · cobbles 61% · hilly 19% · mountain 91% ✓. Ejer-mål 7/6 + benchmark-research: skærp motor, behold mål (cobbles-undtagelse) |
| Runtime-entrypoint | ❌ Findes ikke (admin "Simulér løb" mangler) |
| Stage-profiles ved løbs-oprettelse | ❌ `POST /admin/races` (api.js ~4140-4181) opretter løb UDEN profiles → motoren fejler med "kør backfill". `seasonTransition` opretter IKKE løb, så relaunch-kalenderen skabes ad denne vej |
| `race_viewed`-event | ❌ Mangler (skal lande samtidig med #1102 jf. #1168 + validerings-roadmap — ellers er løbs-pillaren blind i go/no-go-funnellen) |

**Afhængigheder afklaret:** #677 = ejer-besluttet 7/6 (V1-arketype-stats, fysiologi post-launch). #669 population merged (#1262/#1135). #1103 orchestrator dev-færdig, generalprøve 9/9 PASS (#1191).

## Ejer-beslutning indbygget i planen (bekræftet ved plan-godkendelse)

Gate-bånd sættes til **interim-bånd der kan nås med motor-tuning alene** (anbefaling fra genre-benchmark `docs/research/genre-benchmark-june-2026.md`): flat ≥90% · cobbles ≥80% (research: kaotisk terræn irl) · hilly ≥35% interim (content-bundet: puncheurer ~6% af feltet; fuldt 50%-mål kræver population-berigelse) · itt tt ≥60% interim + tt+gc ≥95% (population-design: gc-ryttere ER tempo-ryttere; fuldt 85%-mål følger evne-system v2 #1122) · mountain-gruppe ≥85% + udbruds-andel rapporteres. Fulde mål bevares som kommentar + follow-up-issue (Task 10).

## Out of scope (bevidst)

- **Slice 3 spiller-UI** (etape-preview-badges, manager-lineup-UI) — egen session/plan.
- **Flag-flip** — sker på relaunch-dagen efter #1103-harnesset + denne gate er grøn. Flagget forbliver OFF i alt hvad denne plan shipper.
- **#1021** fuld fysiologisk motor; **population-berigelse** (flere brosten-/puncheur-specialister).

## Fil-oversigt

**PR 1 — `feat/1102-engine-gate` (backend-only label):**
- Modify: `backend/scripts/simulateSeasonDryRun.js` (TARGETS-bånd + udbruds-metrik)
- Modify: `backend/lib/raceStageProfileGenerator.js` (DEMAND_VECTORS)
- Modify: `backend/lib/raceSimulator.js` (NOISE_SD_SCALE)
- Modify: `backend/package.json` (script `race:gate`), `.github/workflows/ci.yml` (gate-step)

**PR 2 — `feat/1102-runtime-wiring` (Brugerverifikation-sektion i PR-body):**
- Modify: `backend/lib/raceRunner.js` (additiv `dryRun`-param)
- Create: `backend/lib/adminSimulateRace.js` + `backend/lib/adminSimulateRace.test.js`
- Modify: `backend/routes/api.js` (2 nye admin-routes + profiles-ved-oprettelse i `POST /admin/races`)
- Modify: `frontend/src/pages/admin/AdminDataTab.jsx` (Race-motor-sektion)
- Modify: `frontend/src/lib/logEvent.js` + `frontend/src/pages/RaceDetailPage.jsx` (`race_viewed`)

**Forudsætninger ved execution-start:** claim 🤖 Working agent i `docs/NOW.md` · branch fra `origin/main` · verificér branch i selve commit-kæden (`git branch --show-current`).

---

## PR 1 — Kalibrering + launch-gate

### Task 1: Gate-bånd + udbruds-metrik i cockpittet

**Files:**
- Modify: `backend/scripts/simulateSeasonDryRun.js:55-80`

- [ ] **Step 1: Opdatér TARGETS til de besluttede interim-bånd**

Erstat TARGETS-blokken (linje 58-66) med:

```js
// ── Ejer-besluttede gate-bånd (2026-06-11, jf. genre-benchmark-research) ──────
// Interim-bånd nåelige med motor-tuning alene. FULDE mål (7/6) bevaret nedenfor;
// hæves via population-berigelse (cobbles/hilly) + evne-system v2 #1122 (itt).
//   Fulde mål: flat 90 · itt tt 85 · cobbles 90→80 (research) · hilly 50 · mountain 85.
const TARGETS = {
  flat:          { label: "sprinter ≥90%", types: ["sprinter"], pct: 0.90 },
  itt:           { label: "tt ≥60% (interim)", types: ["tt"], pct: 0.60 },
  itt_tempo:     { label: "tt+gc ≥95%", terrain: "itt", types: ["tt", "gc"], pct: 0.95 },
  cobbles:       { label: "brostensrytter ≥80%", types: ["brostensrytter"], pct: 0.80 },
  hilly:         { label: "puncheur ≥35% (interim)", types: ["puncheur"], pct: 0.35 },
  mountain:      { label: "gc+climber+baroudeur ≥85%", types: ["gc", "climber", "baroudeur"], pct: 0.85 },
  high_mountain: { label: "gc+climber+baroudeur ≥85%", types: ["gc", "climber", "baroudeur"], pct: 0.85 },
};
```

`itt_tempo` er et EKSTRA bånd på samme terræn — tjek hvordan scorecard-loopet (sektion B) itererer TARGETS: hvis det antager `key === terrain`, brug `t.terrain ?? key` som opslagsnøgle. Lille, mekanisk justering.

- [ ] **Step 2: Tilføj udbruds-andel som rapporteret metrik (ikke hard gate)**

I scorecard-sektionen, hvor mountain/high_mountain-vinderne tælles pr. type, tilføj en linje der rapporterer baroudeur/fighter-andelen af gruppens sejre (research: udbrud vinder 40%+ af bjergetaper irl — 0% = for deterministisk):

```js
const mountainWins = /* eksisterende vinder-liste for mountain+high_mountain */;
const breakawayShare = pct1(
  mountainWins.filter((w) => ["baroudeur", "fighter"].includes(w.winnerType)).length,
  mountainWins.length,
);
console.log(`   udbruds-andel (baroudeur/fighter) af bjergsejre: ${breakawayShare}% (irl ~40%; 0% = rød flag, rapport-only)`);
```

(Tilpas variabelnavne til scorecard-loopets faktiske akkumulatorer — mønstret findes allerede for type-histogrammerne, genbrug det.)

- [ ] **Step 3: Kør cockpittet og verificér ny baseline-output**

Kør: `cd backend && node scripts/simulateSeasonDryRun.js --no-html`
Forventet: scorecard viser de nye bånd-labels + udbruds-andel-linjen; exit 0 (targets håndhæves ikke uden flag).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/simulateSeasonDryRun.js
git commit -m "feat(race-engine): gate-bånd (interim, ejer 11/6) + udbruds-metrik i dry-run-cockpit (Refs #1102)"
```

### Task 2: Tuning — DEMAND_VECTORS + NOISE_SD_SCALE

**Files:**
- Modify: `backend/lib/raceStageProfileGenerator.js:38-…` (DEMAND_VECTORS)
- Modify: `backend/lib/raceSimulator.js:42` (NOISE_SD_SCALE)
- Modify: `backend/scripts/simulateSeasonDryRun.js:67-80` (kalibreringslog ajourføres)

- [ ] **Step 1: Anvend kandidat-vægtene fra kalibreringsloggen**

I `DEMAND_VECTORS` (raceStageProfileGenerator.js linje 38) erstat `flat`, `cobbles` og `hilly` med de dokumenterede kandidater (simulateSeasonDryRun.js linje 72-74 — afprøvet 7/6, gav flat 92% / cobbles 84% / hilly 29%):

```js
flat:    { sprint: 0.56, acceleration: 0.22, positioning: 0.10, endurance: 0.04, randomness: 0.08 },
cobbles: { cobblestone: 0.70, punch: 0.08, positioning: 0.08, endurance: 0.06, randomness: 0.08 },
hilly:   { punch: 0.42, climbing: 0.10, acceleration: 0.12, endurance: 0.08, positioning: 0.06, sprint: 0.06, randomness: 0.16 },
```

OBS: hver vektor skal summe til 1.0 (slice-1-invariant, struktur-oracles fanger brud).

- [ ] **Step 2: Sænk støjen**

`raceSimulator.js:42`: `NOISE_SD_SCALE = 0.20` → `0.16` (startpunkt; research: sænk støj for at skærpe itt/hilly uden at re-vægte alt).

- [ ] **Step 3: Iterér til gate er grøn på 3 seeds**

Kør (gentag, justér vægte/støj i små skridt):
```
node scripts/simulateSeasonDryRun.js --enforce-targets --no-html --seed=2026
node scripts/simulateSeasonDryRun.js --enforce-targets --no-html --seed=7
node scripts/simulateSeasonDryRun.js --enforce-targets --no-html --seed=42
```
Forventet: exit 0 på alle tre. Knapper at dreje på, i prioriteret rækkefølge: (1) `randomness`-komponenten pr. terræn, (2) nøgle-evnens vægt (fx `time_trial` i itt-vektoren), (3) global `NOISE_SD_SCALE` (sidst — rammer alle terræner). Tjek samtidig at udbruds-andelen på bjerg IKKE går i 0% (for lav støj = for deterministisk; afvej).

- [ ] **Step 4: Kør backend-suiten**

Kør: `cd backend && npm test`
Forventet: grøn. Distributions-/golden-seed-tests i `raceSimulator.test.js`/`raceRunner.test.js` asserter egenskaber (sprinter > klatrer på flad osv.) og determinisme — de bør overleve vægt-ændringer. Hvis en test asserter en EKSAKT rang-rækkefølge der skifter: opdatér forventningen og skriv i commit-beskeden hvorfor (determinisme-egenskaben er intakt; kun den konkrete orden flyttede sig).

- [ ] **Step 5: Ajourfør kalibreringsloggen i cockpittet**

Erstat "tuning IKKE committet"-loggen (linje 67-80) med en kort log: dato, endelige vægte committet, opnåede rater pr. terræn pr. seed, NOISE_SD_SCALE-værdi.

- [ ] **Step 6: Commit**

```bash
git add backend/lib/raceStageProfileGenerator.js backend/lib/raceSimulator.js backend/scripts/simulateSeasonDryRun.js
git commit -m "feat(race-engine): kalibrér DEMAND_VECTORS + NOISE_SD_SCALE mod gate-bånd — grøn på seeds 2026/7/42 (Refs #1102)"
```

**Note (ingen prod-handling nødvendig):** eksisterende `race_stage_profiles`-rækker i prod har gamle demand_vectors, men flag er OFF og profiles er ikke spiller-synlige endnu; relaunch-backfillen (Task 7/relaunch-checklisten) regenererer med de nye vægte.

### Task 3: `race:gate` npm-script + CI-step

**Files:**
- Modify: `backend/package.json` (scripts)
- Modify: `.github/workflows/ci.yml` (backend-tests-job)

- [ ] **Step 1: Tilføj script**

I `backend/package.json` scripts (efter `"gates:mutation-audit"`):

```json
"race:gate": "node scripts/simulateSeasonDryRun.js --enforce-targets --no-html --seed=2026",
```

- [ ] **Step 2: Verificér køretid lokalt**

Kør: `cd backend && npm run race:gate` — notér køretid. Forventet: exit 0. Hvis >90 s: tilføj `--races=150` til scriptet og re-verificér at båndene stadig er grønne (bånd er valgt med margin; notér i kalibreringsloggen).

- [ ] **Step 3: Tilføj CI-step**

I `.github/workflows/ci.yml`, `backend-tests`-jobbet, efter lint-steppet (linje ~41) — match jobbets eksisterende `working-directory`-konvention (se npm ci-steppet linje ~35):

```yaml
      - name: Race-engine launch-gate (#1102)
        run: npm run race:gate
```

- [ ] **Step 4: Commit + push + opret PR 1**

```bash
git add backend/package.json .github/workflows/ci.yml
git commit -m "feat(race-engine): promovér dry-run til håndhævet launch-gate (npm run race:gate + CI) (Refs #1102)"
git push -u origin feat/1102-engine-gate
gh pr create --label backend-only --title "feat(race-engine): kalibrering + launch-gate (#1102 PR 1/2)" --body-file <skriv body via Write-tool — aldrig heredoc>
```
PR-body: hvad/hvorfor + rater før/efter pr. terræn + `Refs #1102`. Verificér CI grøn (gate-steppet kører!), merge, slet branch.

---

## PR 2 — Runtime-wiring + admin-UI + instrumentering

Branch fra opdateret `origin/main` efter PR 1-merge: `feat/1102-runtime-wiring`.

### Task 4: Additiv `dryRun`-param i `simulateRace`

**Files:**
- Modify: `backend/lib/raceRunner.js:350-435`
- Test: `backend/lib/raceRunner.test.js`

- [ ] **Step 1: Skriv fejlende test**

I `raceRunner.test.js` (genbrug eksisterende mock-supabase-mønster fra simulateRace-testene + `ENTRANTS`/`STAGES_3`-fixtures):

```js
test("simulateRace dryRun: returnerer preview uden DB-writes", async () => {
  const calls = [];
  const supabase = makeMockSupabase({ onWrite: (op) => calls.push(op) }); // spejl eksisterende mock-helper
  const result = await simulateRace({
    supabase, race: STAGE_RACE, dryRun: true,
    applyRaceResults: async () => { throw new Error("må ikke kaldes i dryRun"); },
  });
  assert.equal(result.dryRun, true);
  assert.ok(result.rows > 0);
  assert.ok(Array.isArray(result.stageWinners) && result.stageWinners.length === 3);
  assert.ok(result.gcPodium.length === 3 && result.gcPodium[0].rank === 1);
  assert.equal(calls.filter((c) => ["delete", "insert", "update"].includes(c.op)).length, 0);
});
```

- [ ] **Step 2: Kør testen — forventet FAIL** (`dryRun` ukendt → motoren skriver / applyRaceResults kastes)

Kør: `cd backend && node --test --import ./test-setup.js lib/raceRunner.test.js`

- [ ] **Step 3: Implementér**

I `simulateRace`-signaturen tilføj `dryRun = false`. Lige EFTER `const { resultRows, runs } = buildRaceResults(...)` (linje ~381), FØR den idempotente delete:

```js
  // Dry-run-preview (#1102 runtime-wiring): alt loades og beregnes som ved en
  // ægte afvikling, men INTET skrives — admin kan inspicere udfaldet før flip.
  if (dryRun) {
    const stageWinners = resultRows
      .filter((r) => r.result_type === "stage" && r.rank === 1)
      .map((r) => ({ stage: r.stage_number, rider: r.rider_name }));
    const gcPodium = resultRows
      .filter((r) => r.result_type === "gc" && r.rank <= 3)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ rank: r.rank, rider: r.rider_name }));
    return {
      dryRun: true,
      rows: resultRows.length, stages: stages.length, entrants: entrants.length,
      stageWinners, gcPodium,
    };
  }
```

OBS: `loadEntrantsForRace` auto-fill'er `race_entries` hvis tomt (DB-write). I dryRun: kald `autoFillEntries`-stien med persist slået fra — tjek `loadEntrantsForRace`/`autoFillEntries` (linje 250-316): hvis auto-fill skriver, tilføj additiv `{ persist = true }`-option der i dryRun beregner feltet in-memory uden insert. Testen i Step 1 fanger det (mock tæller inserts).

- [ ] **Step 4: Kør testen igen — forventet PASS** + hele filens suite grøn

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/raceRunner.test.js
git commit -m "feat(race-engine): additiv dryRun-preview i simulateRace — ingen DB-writes (Refs #1102)"
```

### Task 5: Handler-lib `adminSimulateRace.js`

**Files:**
- Create: `backend/lib/adminSimulateRace.js`
- Test: `backend/lib/adminSimulateRace.test.js`

- [ ] **Step 1: Skriv fejlende tests** (mock-supabase-mønster fra `raceRunner.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getRaceEngineStatus, runAdminSimulateRace, buildRaceSimEmbed } from "./adminSimulateRace.js";

test("runAdminSimulateRace: flag OFF + ægte kørsel → 409, ingen simulering", async () => {
  const supabase = mockDb({ app_config: [], races: [SCHEDULED_RACE] });
  await assert.rejects(
    () => runAdminSimulateRace({ supabase, raceId: SCHEDULED_RACE.id, dryRun: false }),
    (e) => e.status === 409,
  );
});

test("runAdminSimulateRace: flag OFF + dryRun → preview tilladt", async () => { /* simulateRace-dep injiceres som stub, assert den kaldes med dryRun: true */ });
test("runAdminSimulateRace: ukendt race → 404", async () => { /* ... */ });
test("runAdminSimulateRace: status=completed → 409 (gen-afvikling kræver bevidst status-ændring)", async () => { /* ... */ });
test("getRaceEngineStatus: returnerer flag + scheduled races med profile_count/entry_count/ready", async () => { /* ... */ });
test("buildRaceSimEmbed: GC-vinder + etapevindere i embed", () => {
  const embed = buildRaceSimEmbed({ race: { name: "Test GP" }, resultRows: [
    { result_type: "gc", rank: 1, rider_name: "A" },
    { result_type: "stage", rank: 1, stage_number: 1, rider_name: "B" },
    { result_type: "stage", rank: 1, stage_number: 2, rider_name: "C" },
  ]});
  assert.match(embed.title, /Test GP/);
  assert.match(embed.description, /A/);
});
```

(Testbarhed: `runAdminSimulateRace` tager `simulateRace` som injicerbar dep med default-import — samme DI-mønster som `simulateRace` selv bruger.)

- [ ] **Step 2: Kør — forventet FAIL** (modul findes ikke)

- [ ] **Step 3: Implementér `backend/lib/adminSimulateRace.js`**

```js
// Admin-runtime-entrypoint for race-motoren (#1102) — tyndt handler-lib der
// spejler adminImportResultsHandler-mønstret: routes i api.js er ren transport.
// Fail-safe: ægte afvikling kræver RACE_ENGINE_V2_ENABLED; preview er altid tilladt.
import { isRaceEngineV2Enabled, RACE_ENGINE_V2_FLAG_KEY } from "./raceEngineFlag.js";
import { simulateRace as simulateRaceDefault } from "./raceRunner.js";

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export async function getRaceEngineStatus({ supabase }) {
  const enabled = await isRaceEngineV2Enabled(supabase);
  const { data: season } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (!season) return { enabled, flag_key: RACE_ENGINE_V2_FLAG_KEY, season: null, races: [] };

  const { data: races, error } = await supabase
    .from("races")
    .select("id, name, race_type, race_class, stages, status")
    .eq("season_id", season.id).eq("status", "scheduled").order("name");
  if (error) throw new Error(error.message);

  const out = [];
  for (const race of races || []) {
    const [profiles, entries] = await Promise.all([
      supabase.from("race_stage_profiles").select("id", { count: "exact", head: true }).eq("race_id", race.id),
      supabase.from("race_entries").select("rider_id", { count: "exact", head: true }).eq("race_id", race.id),
    ]);
    const profileCount = profiles.count ?? 0;
    out.push({
      ...race,
      profile_count: profileCount,
      entry_count: entries.count ?? 0, // 0 er OK — loadEntrantsForRace auto-fill'er
      ready: profileCount > 0,
    });
  }
  return { enabled, flag_key: RACE_ENGINE_V2_FLAG_KEY, season, races: out };
}

export async function runAdminSimulateRace({
  supabase, raceId, dryRun = false,
  ensureSeasonStandings, updateStandings, notifyDiscord = null,
  simulateRace = simulateRaceDefault,
}) {
  if (!raceId) throw httpError(400, "race_id påkrævet");
  const { data: race, error } = await supabase
    .from("races")
    .select("id, season_id, name, race_type, race_class, stages, edition_year, status")
    .eq("id", raceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!race) throw httpError(404, "Løb ikke fundet");
  if (race.status === "completed") {
    throw httpError(409, "Løbet er allerede afviklet — sæt status tilbage via løbs-redigering hvis gen-afvikling er bevidst");
  }
  if (!dryRun) {
    const enabled = await isRaceEngineV2Enabled(supabase);
    if (!enabled) throw httpError(409, "RACE_ENGINE_V2_ENABLED er OFF — ægte afvikling blokeret (preview er tilladt)");
  }
  return simulateRace({ supabase, race, dryRun, ensureSeasonStandings, updateStandings, notifyDiscord });
}

export function buildRaceSimEmbed({ race, resultRows }) {
  const rows = resultRows || [];
  const gcWinner = rows.find((r) => r.result_type === "gc" && r.rank === 1);
  const stageWinners = rows.filter((r) => r.result_type === "stage" && r.rank === 1)
    .sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));
  return {
    title: `🏁 ${race.name} afviklet (race-motor V2)`,
    description: [
      gcWinner ? `**Vinder:** ${gcWinner.rider_name}` : null,
      stageWinners.length > 1
        ? `**Etapevindere:** ${stageWinners.map((r) => `${r.stage_number}. ${r.rider_name}`).join(" · ")}`
        : null,
    ].filter(Boolean).join("\n"),
    color: 0x2ecc71,
  };
}
```

OBS `simulateRace` returnerer ikke `resultRows` ved ægte kørsel (kun counts) — Discord-embed får rows via `notifyDiscord`-callbacken inde i `simulateRace` (samme mønster som PCM-routen). Embed-relevant data flyder altså gennem callbacken, ikke return-værdien.

- [ ] **Step 4: Kør tests — forventet PASS** (`node --test --import ./test-setup.js lib/adminSimulateRace.test.js`)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/adminSimulateRace.js backend/lib/adminSimulateRace.test.js
git commit -m "feat(race-engine): adminSimulateRace handler-lib — status + flag-gated afvikling + embed (Refs #1102)"
```

### Task 6: Routes i `api.js`

**Files:**
- Modify: `backend/routes/api.js` (imports ~linje 197 + routes efter PCM-routen ~linje 5777)

- [ ] **Step 1: Tilføj routes** (spejler PCM-routens transport-mønster, api.js:5737-5777; `ensureSeasonStandings`/`updateStandings`/`getDefaultWebhook`/`sendWebhook` er allerede i scope):

```js
import { getRaceEngineStatus, runAdminSimulateRace, buildRaceSimEmbed } from "../lib/adminSimulateRace.js";

// GET /api/admin/race-engine-status — flag-state + scheduled løb med readiness (#1102)
router.get("/admin/race-engine-status", requireAdmin, async (req, res) => {
  try {
    res.json(await getRaceEngineStatus({ supabase }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/simulate-race — afvikl ét løb via race-motoren (#1102).
// body: { race_id, dry_run } — dry_run=true giver preview uden DB-writes (tilladt ved flag OFF).
router.post("/admin/simulate-race", requireAdmin, adminWriteLimiter, async (req, res) => {
  const dryRun = req.body?.dry_run === true || req.body?.dry_run === "true";
  const notifyDiscord = dryRun
    ? null
    : async ({ race, resultRows }) => {
        const url = await getDefaultWebhook();
        if (!url) return;
        const embed = buildRaceSimEmbed({ race, resultRows });
        await sendWebhook(url, { embeds: [{ ...embed, footer: { text: "Cycling Zone" } }] });
      };
  try {
    const result = await runAdminSimulateRace({
      supabase, raceId: req.body?.race_id, dryRun,
      ensureSeasonStandings, updateStandings, notifyDiscord,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
```

Verificér først at `simulateRace`s `notifyDiscord`-callback faktisk modtager `{ race, resultRows }` (raceRunner.js ~linje 421-425) — ellers tilpas embed-kaldet.

- [ ] **Step 2: Lint + fuld backend-suite**

Kør: `cd backend && npm run lint && npm test` — forventet grøn.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(race-engine): admin-routes — race-engine-status + simulate-race bag flag (Refs #1102)"
```

### Task 7: Forward-guard — stage-profiles ved løbs-oprettelse

**Files:**
- Modify: `backend/routes/api.js` `POST /admin/races`-handleren (~linje 4140-4181, efter `createRaceRecord`-kaldet linje ~4173)

- [ ] **Step 1: Generér profiles ved oprettelse** (best-effort — fejl må ikke vælte oprettelsen, motoren fejler alligevel højt og backfill reparerer):

```js
    // #1102: nye løb får stage-profiles med det samme (motoren kræver dem;
    // backfillRaceStageProfiles dækker historiske). Best-effort — fejl rapporteres.
    let stageProfilesCreated = 0;
    try {
      const profiles = generateRaceStageProfiles(createdRace);
      const { error: profileError } = await supabase.from("race_stage_profiles").insert(profiles);
      if (profileError) throw new Error(profileError.message);
      stageProfilesCreated = profiles.length;
    } catch (e) {
      console.error("  ⚠️ stage-profiles ved løbs-oprettelse fejlede:", e.message);
    }

    invalidateNamespace("races");
    res.status(201).json({ ...createdRace, stage_profiles_created: stageProfilesCreated });
```

Import øverst: `import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";`
**Verificér insert-mappingen mod `backend/scripts/backfillRaceStageProfiles.js`** — generatorens output skal matche tabellens kolonner (`race_id, stage_number, profile_type, finale_type, demand_vector, generator_version, is_manual`); genbrug præcis backfillens row-mapping hvis generatoren ikke returnerer DB-klare rækker.

- [ ] **Step 2: Test** — udvid eksisterende route-tests hvis `POST /admin/races` har dækning (grep `admin/races` i `backend/`); ellers manuel verifikation i Step 3 + backfill som sikkerhedsnet. Kør `npm test`.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(race-engine): generér race_stage_profiles ved løbs-oprettelse (forward-guard) (Refs #1102)"
```

### Task 8: Admin-UI — Race-motor-sektion i AdminDataTab

**Files:**
- Modify: `frontend/src/pages/admin/AdminDataTab.jsx`

- [ ] **Step 1: Tilføj state + loader + handlers** (spejl filens eksisterende fetch-mønster — token-header som PCM-upload linje 237-249, `readAdminJson`/`adminErrorMessage`/`showMsg` som linje 55-66; admin-UI er dansk, ingen i18n-keys):

```jsx
  const [engineStatus, setEngineStatus] = useState(null);
  const [simBusyId, setSimBusyId] = useState(null);
  const [simPreview, setSimPreview] = useState(null);

  async function loadEngineStatus() { /* GET /api/admin/race-engine-status → setEngineStatus(data) */ }

  async function handleSimulate(race, dryRun) {
    if (!dryRun && !window.confirm(`Afvikl "${race.name}" med race-motoren? Resultater skrives og bestyrelsen opdateres.`)) return;
    setSimBusyId(race.id);
    try {
      // POST /api/admin/simulate-race { race_id: race.id, dry_run: dryRun }
      // dryRun → setSimPreview({ race, ...data })
      // ellers → showMsg(`✅ ${race.name}: ${data.rows} resultatrækker skrevet via motoren`); loadEngineStatus();
    } finally {
      setSimBusyId(null);
    }
  }
```

(Fetch-kroppen skrives 1:1 efter PCM-handlerens mønster — fejl via `adminErrorMessage`.)

- [ ] **Step 2: Tilføj sektion-JSX** under PCM-import-sektionen:

```jsx
      <section className="admin-section">
        <h3>🏁 Race-motor V2 (#1102)</h3>
        <p>
          Flag: <strong>{engineStatus?.enabled ? "✅ ON" : "⛔ OFF (PCM-import er resultat-kilden)"}</strong>
          {" — "}preview virker altid; ægte afvikling kræver flag ON.
          <button onClick={loadEngineStatus}>Genindlæs</button>
        </p>
        {engineStatus?.races?.length > 0 && (
          <table>
            <thead><tr><th>Løb</th><th>Etaper</th><th>Profiler</th><th>Startfelt</th><th></th></tr></thead>
            <tbody>
              {engineStatus.races.map((race) => (
                <tr key={race.id}>
                  <td>{race.name}</td>
                  <td>{race.stages}</td>
                  <td>{race.ready ? `✅ ${race.profile_count}` : "❌ kør backfill"}</td>
                  <td>{race.entry_count > 0 ? race.entry_count : "auto-fill"}</td>
                  <td>
                    <button disabled={!race.ready || simBusyId === race.id} onClick={() => handleSimulate(race, true)}>Preview</button>
                    <button disabled={!race.ready || !engineStatus.enabled || simBusyId === race.id} onClick={() => handleSimulate(race, false)}>Afvikl</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {simPreview && (
          <div className="sim-preview">
            <h4>Preview: {simPreview.race?.name}</h4>
            <p>{simPreview.entrants} ryttere · {simPreview.stages} etaper · {simPreview.rows} resultatrækker</p>
            <p><strong>GC-podie:</strong> {simPreview.gcPodium?.map((p) => `${p.rank}. ${p.rider}`).join(" · ")}</p>
            <p><strong>Etapevindere:</strong> {simPreview.stageWinners?.map((w) => `${w.stage}. ${w.rider}`).join(" · ")}</p>
            <button onClick={() => setSimPreview(null)}>Luk</button>
          </div>
        )}
      </section>
```

(Tilpas klassenavne/knap-styling til filens eksisterende sektioner — genbrug, opfind ikke nye mønstre.)

- [ ] **Step 3: Verificér lokalt via Playwright-mock-setup eller dev-server** (logget-ind admin-UI verificeres lokalt jf. memory: fixtures mocker Supabase). Minimum: `npm run build` + visuel kontrol af sektionen med flag OFF (preview-knap aktiv, afvikl-knap disabled).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminDataTab.jsx
git commit -m "feat(admin): Race-motor V2-sektion — status, preview + flag-gated afvikling (Refs #1102)"
```

### Task 9: `race_viewed`-instrumentering

**Files:**
- Modify: `frontend/src/lib/logEvent.js:53-62` (KNOWN_EVENTS)
- Modify: `frontend/src/pages/RaceDetailPage.jsx` (~linje 52/82: race-state + load)

- [ ] **Step 1: Fyr eventet i render-stien** — i RaceDetailPage, efter race er loadet:

```jsx
import { logEvent } from "../lib/logEvent";
// ...
useEffect(() => {
  if (race?.id) logEvent("race_viewed");
}, [race?.id]);
```

(Match `logEvent`-signaturen — se eksisterende kald af fx `auction_view`; tilføj kun payload hvis konventionen har det.)

- [ ] **Step 2: Tilføj til KNOWN_EVENTS SAMTIDIG** (#1168-checklisten: aldrig før firing-stien findes — det gør den nu fra Step 1). I `logEvent.js:60-62` opdatér kommentaren og tilføj:

```js
  // Pillar-events til go/no-go-funnellen (#1168): training_focus_set (useTraining),
  // race_viewed (RaceDetailPage, landede med #1102 runtime-wiring).
  "training_focus_set",
  "race_viewed",
```

- [ ] **Step 3: Frontend-tests + build** — `cd frontend && node --test && npm run build` (obligatorisk pre-flight; Nodes ESM-loader fanger extensionless imports som Vite tilgiver).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/logEvent.js frontend/src/pages/RaceDetailPage.jsx
git commit -m "feat(telemetry): race_viewed pillar-event — løbs-pillaren synlig i go/no-go-funnel (Refs #1102, #1168)"
```

### Task 10: Pre-flight, PR 2 + close-out

- [ ] **Step 1: Fuld lokal pre-flight**

```
pwsh -File scripts/verify-local.ps1
npx playwright test core-smoke.spec.js
```
Forventet: backend-tests + frontend-tests + build grøn; alle 3 playwright-projekter (desktop + mobile-chromium + mobile-webkit). Admin-sektionen er ny UI — hvis core-smoke har snapshots der rammer admin-siden, refresh alle 3 projekter (`--update-snapshots`) og commit PNG'erne.

- [ ] **Step 2: PatchNotes + Hjælp** — flag er OFF: ingen spiller-synlig adfærdsændring → skriv eksplicit i PR-body hvorfor PatchNotes/help.json IKKE opdateres ("motor-wiring bag OFF-flag; patch note følger flag-flip på relaunch-dagen"). `race_viewed` er usynlig telemetri.

- [ ] **Step 3: Opret PR 2** — body med **Brugerverifikation**-sektion (`- [x]`-krav, jf. fleet-playbook):

```markdown
## Brugerverifikation
- [ ] Admin → Data: "Race-motor V2"-sektionen viser flag OFF + scheduled løb
- [ ] "Preview" på et løb viser GC-podie + etapevindere uden at ændre noget (løbet står stadig som scheduled)
- [ ] "Afvikl"-knappen er disabled mens flag er OFF
```
Push, verificér CI grøn (inkl. race:gate fra PR 1), merge, slet branch, `verify-deploy.ps1`.

- [ ] **Step 4: Prod-verifikation (read-only)** — som admin mod prod: `GET /api/admin/race-engine-status` → flag `enabled: false`, scheduled-løb listes. Kør evt. ét `dry_run`-preview mod et scheduled løb (skriver intet) og sanity-tjek vindertyperne.

- [ ] **Step 5: GitHub close-out**
  - Issue-kommentar på #1102: leveret (kalibrering + gate + wiring + instrumentering), rater pr. terræn, hvad der BEVIDST udestår: slice 3 spiller-UI + flag-flip (relaunch-dag, efter #1103-harness + `npm run race:gate` grøn).
  - **Opret follow-up-issue:** "Population-berigelse: brosten-/puncheur-specialister → hæv gate-bånd til fulde mål (cobbles 80→? · hilly 35→50 · itt 60→85)" — refs #1102/#669/#1122.
  - **Relaunch-checkliste-tilføjelse** (kommentar på #1103/#1105): efter kalender-oprettelse for frisk sæson 1 → kør `node scripts/backfillRaceStageProfiles.js --season=<uuid>` (dækker løb oprettet før forward-guarden) + verificér via race-engine-status at alle løb er `ready` FØR flag-flip.
  - `docs/NOW.md`: opdatér 🎯 Next action + nulstil 🤖 Working agent (budget ≤1.200 tok).
  - `FEATURE_STATUS.md`: nye admin-endpoints + gate noteres.

---

## Self-review (udført ved plan-skrivning)

- **Spec-dækning:** Briefens 4 punkter (bevar kontrakter ✓ Task 4-6 er additive · promovér dry-run til gate ✓ Task 1-3 · tunér vægte/støj ✓ Task 2 · runtime-entrypoint bag flag ✓ Task 5-6) + acceptance-kriteriernes rest (hel sæson uden PCM = gate-kørslen + relaunch-generalprøve; flag-off-fallback = eksisterende tests + 409-gate) + #1168-instrumentering ✓ Task 9 + udbruds-verifikation ✓ Task 1.
- **Kendte verifikationspunkter for executor (markeret i opgaverne):** scorecard-loopets TARGETS-iteration (Task 1), auto-fill-write i dryRun (Task 4), notifyDiscord-payload (Task 6), generator-output vs. tabel-kolonner (Task 7), logEvent-signatur (Task 9).
- **Konsistens:** `dryRun`-param (Task 4) ↔ `runAdminSimulateRace` (Task 5) ↔ route `dry_run` (Task 6) ↔ UI `handleSimulate(race, dryRun)` (Task 8). `generateRaceStageProfiles` (Task 7) = verificeret eksport (raceStageProfileGenerator.js:158).
