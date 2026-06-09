# Relaunch-orchestrator (#1103) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygge `backend/scripts/relaunchSeason1.js` — en dry-run-default orchestrator der nulstiller spillet til en frisk, uafhængig sæson 1 med fiktiv population, løbsklare startholds og founder-badges.

**Architecture:** Orchestratoren *komponerer* eksisterende verificerede byggeklodser (`runFullBetaReset`, `generateLaunchPopulation`, `transitionToNextSeason`) plus tre net-nye lib-moduler (population-swap, startholds-allokering, founder-badge) og tre backfill-kerner ekstraheret fra eksisterende CLI-scripts. Alt seeded/deterministisk så dry-run = rigtig kørsel. Prod kræver lagdelt opt-in.

**Tech Stack:** Node.js (ESM), `@supabase/supabase-js`, `node:test` + `node:assert/strict`, eksisterende `supabasePagination.js`.

**Spec:** `docs/superpowers/specs/2026-06-09-relaunch-season1-orchestrator-design.md`

**⛔ Hård gate:** #1101 base_value-cutover (ejer-verifikation) blokerer den *rigtige* prod-relaunch. Hele denne plan kan bygges + dry-run-verificeres mod preview uden #1101. Kør ALDRIG `--target-prod` før #1101-cutover er kvitteret.

**Tunbare konstanter (fra spec, åbne for ejer-justering):** `STARTER_YOUTH = 4`, `STARTER_DOMESTIQUES = 4` (sum skal = `MIN_RIDERS_FOR_RACE = 8`), startholds tages fra de 800.

---

## File Structure

| Fil | Ansvar | Create/Modify |
|---|---|---|
| `backend/lib/backfillCores.js` | Importérbare kerner: `runPhysiologyBackfill`, `runRiderTypesBackfill`, `runBaseValueBackfill` (ekstraheret fra de 3 CLI-scripts) | Create |
| `backend/scripts/backfillRacePhysiology.js` | Tynd CLI-wrapper om `runPhysiologyBackfill` | Modify |
| `backend/scripts/backfillRiderTypes.js` | Tynd CLI-wrapper om `runRiderTypesBackfill` | Modify |
| `backend/scripts/backfillRiderBaseValue.js` | Tynd CLI-wrapper om `runBaseValueBackfill` | Modify |
| `backend/lib/legacyRiderRetirement.js` | `retireLegacyRiders(supabase, {dryRun})` — population-swap | Create |
| `backend/lib/starterSquadAllocator.js` | `allocateStarterSquads(supabase, {seed, dryRun})` — seeded, stratificeret 8-mands trup pr. manager | Create |
| `backend/lib/founderBadge.js` | `FOUNDER_BADGE_KEY`, `grantFounderBadges(supabase, {dryRun})` | Create |
| `backend/lib/betaResetService.js` | `resetBetaAchievements` undtager `founder_badge` | Modify |
| `backend/scripts/relaunchSeason1.js` | Orchestrator (CLI + sekvens) | Create |
| `*.test.js` ved siden af hver lib | Unit + forward-guards | Create |

Build-rækkefølge: backfill-refaktor → net-nye libs → reset-exemption → orchestrator. Hver lib er testbar isoleret før orchestratoren komponerer dem.

---

## Task 1: Ekstrahér backfill-kerner til importérbare funktioner

**Files:**
- Create: `backend/lib/backfillCores.js`
- Test: `backend/lib/backfillCores.test.js`
- Modify: `backend/scripts/backfillRacePhysiology.js`, `backend/scripts/backfillRiderTypes.js`, `backend/scripts/backfillRiderBaseValue.js`

- [ ] **Step 1: Læs de tre scripts fuldt ud FØR du rører dem.**

Run: åbn `backend/scripts/backfillRacePhysiology.js`, `backfillRiderTypes.js`, `backfillRiderBaseValue.js` fuldt. Noter for hvert: hvilke tabeller læses/skrives, in-memory pool-building (physiology percentil-skalerer mod hele pool'en), `--dry-run`-grenen, og hvilke lib-funktioner de allerede importerer (`seedPhysiologyFromLegacy`, `deriveAbilities`, `computeRiderTypes`, `predictBaseValue`).
Expected: du kan skrive den eksakte nuværende signatur for hver kerne-operation ned. Opfind ALDRIG en signatur — den skal komme fra den læste kode.

- [ ] **Step 2: Skriv golden-output regressionstest FØR refaktor.**

Mål: bevise at ekstraktionen ikke ændrer adfærd. Test mod et lille deterministisk in-memory/mock-datasæt at hver ny kerne-funktion returnerer samme beregnede rækker som den nuværende script-logik (sammenlign den rene beregning, ikke DB-IO).

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runBaseValueBackfill } from "./backfillCores.js";
// Mock supabase: returnér faste riders + rider_derived_abilities, fang updates.
test("runBaseValueBackfill (dryRun) beregner base_value uden writes", async () => {
  const writes = [];
  const supabase = makeMockSupabase({ writes /* + faste fixtures */ });
  const res = await runBaseValueBackfill(supabase, { dryRun: true });
  assert.equal(writes.length, 0, "dry-run må ikke skrive");
  assert.ok(res.valued > 0);
});
```

- [ ] **Step 3: Kør testen — verificér FAIL.** Run: `node --test backend/lib/backfillCores.test.js` · Expected: FAIL ("runBaseValueBackfill is not a function").

- [ ] **Step 4: Ekstrahér kernerne.** Flyt beregnings-/DB-orkestreringen fra hvert script ind i `backfillCores.js` som `runPhysiologyBackfill(supabase, {dryRun, physiologyOnly})`, `runRiderTypesBackfill(supabase, {dryRun})`, `runBaseValueBackfill(supabase, {dryRun})`. Funktionerne modtager `supabase` (ingen egen `createClient`), returnerer en summary, og logger via en injicerbar `log = console.log`. Brug de EKSAKTE signaturer fra Step 1.

- [ ] **Step 5: Gør CLI'erne til tynde wrappers.** Hvert script beholder kun: env-load → `createClient` → parse `--dry-run` → kald kernen → `process.exit`. Den hardcodede prod-deny (hvor den findes) bevares i wrapperen.

- [ ] **Step 6: Kør testen + verificér uændret CLI-output.** Run: `node --test backend/lib/backfillCores.test.js` (Expected: PASS) og `node backend/scripts/backfillRiderBaseValue.js --dry-run` mod preview (Expected: samme fordelings-tabel som før refaktor).

- [ ] **Step 7: Commit.** `git add backend/lib/backfillCores.js backend/lib/backfillCores.test.js backend/scripts/backfill*.js && git commit -F <msg>` — `refactor(#1103): extract backfill cores to importable lib`.

---

## Task 2: Population-swap — pensionér legacy-ryttere

**Files:**
- Create: `backend/lib/legacyRiderRetirement.js`, `backend/lib/legacyRiderRetirement.test.js`

- [ ] **Step 1: Skriv den fejlende test.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { retireLegacyRiders } from "./legacyRiderRetirement.js";
test("retireLegacyRiders sætter is_retired+team_id=null kun for pcm_id IS NOT NULL", async () => {
  const calls = [];
  const supabase = { from: (t) => ({ update: (p) => ({ not: (c, op, v) => { calls.push({ t, p, c, op, v }); return Promise.resolve({ data: [{ id: 1 }], error: null }); } }) }) };
  const res = await retireLegacyRiders(supabase, { dryRun: false });
  assert.deepEqual(calls[0].p, { is_retired: true, team_id: null });
  assert.equal(calls[0].c, "pcm_id"); assert.equal(calls[0].op, "is");
});
test("dryRun gør ingen writes", async () => {
  let wrote = false;
  const supabase = { from: () => ({ update: () => { wrote = true; return { not: () => Promise.resolve({}) }; } }) };
  await retireLegacyRiders(supabase, { dryRun: true });
  assert.equal(wrote, false);
});
```

- [ ] **Step 2: Kør — verificér FAIL.** Run: `node --test backend/lib/legacyRiderRetirement.test.js` · Expected: FAIL.

- [ ] **Step 3: Implementér.**

```js
export async function retireLegacyRiders(supabase, { dryRun = true } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const { count } = await supabase.from("riders").select("id", { count: "exact", head: true }).not("pcm_id", "is", null);
  if (dryRun) return { dryRun: true, wouldRetire: count ?? null };
  const { data, error } = await supabase.from("riders")
    .update({ is_retired: true, team_id: null }).not("pcm_id", "is", null).select("id");
  if (error) throw new Error(`retireLegacyRiders: ${error.message}`);
  return { dryRun: false, retired: data?.length ?? 0 };
}
```

- [ ] **Step 4: Kør — verificér PASS.** Run: `node --test backend/lib/legacyRiderRetirement.test.js` · Expected: PASS.

- [ ] **Step 5: Commit.** `feat(#1103): legacy rider retirement (population swap)`.

---

## Task 3: Founder-badge + reset-undtagelse

**Files:**
- Create: `backend/lib/founderBadge.js`, `backend/lib/founderBadge.test.js`
- Modify: `backend/lib/betaResetService.js` (`resetBetaAchievements`), `backend/lib/betaResetService.test.js`

- [ ] **Step 1: Læs `achievements`/`manager_achievements`-skemaet.** Bekræft kolonner (achievement key, FK, unik-constraint) via `database/schema.sql` og en eksisterende achievement-INSERT i `api.js`. Skriv den eksakte INSERT-form ned. Opfind ikke kolonner.

- [ ] **Step 2: Skriv fejlende test for reset-undtagelse.**

```js
test("resetBetaAchievements sletter alt UNDTAGEN founder_badge", async () => {
  const del = [];
  const supabase = makeMockManagerTeams([{ user_id: "u1" }]);
  supabase.from = wrapDelete(supabase.from, "manager_achievements", del);
  await resetBetaAchievements(supabase);
  // Forvent en .neq("achievement_key","founder_badge") eller tilsvarende filter på delete
  assert.ok(del[0].excludesFounder, "delete skal undtage founder_badge");
});
```

- [ ] **Step 3: Kør — FAIL.** Run: `node --test backend/lib/betaResetService.test.js` · Expected: FAIL.

- [ ] **Step 4: Modificér `resetBetaAchievements`.** Tilføj `.neq(<achievement-key-kolonne>, FOUNDER_BADGE_KEY)` til delete-queryen ([betaResetService.js:396-400](../../../backend/lib/betaResetService.js)). Importér `FOUNDER_BADGE_KEY` fra `founderBadge.js`. Brug den eksakte kolonne fra Step 1.

- [ ] **Step 5: Skriv + implementér `grantFounderBadges`.**

```js
export const FOUNDER_BADGE_KEY = "founder_badge";
export async function grantFounderBadges(supabase, { dryRun = true } = {}) {
  const { getBetaManagerTeams } = await import("./betaResetService.js");
  const teams = await getBetaManagerTeams(supabase);
  const userIds = [...new Set(teams.map((t) => t.user_id).filter(Boolean))];
  if (dryRun) return { dryRun: true, wouldGrant: userIds.length };
  // 1) sikr achievement-def findes (upsert founder_badge-def — eksakt form fra Step 1)
  // 2) INSERT manager_achievements pr. userId, idempotent (onConflict user_id+key)
  ...
  return { dryRun: false, granted: userIds.length };
}
```

Test: `grantFounderBadges` bruger samme selector som reset (mock `getBetaManagerTeams`), idempotent ved re-run, `dryRun` skriver intet.

- [ ] **Step 6: Kør — PASS.** Run: `node --test backend/lib/founderBadge.test.js backend/lib/betaResetService.test.js` · Expected: PASS.

- [ ] **Step 7: Commit.** `feat(#1103): founder badge grant + survive reset`.

---

## Task 4: Startholds-allokering

**Files:**
- Create: `backend/lib/starterSquadAllocator.js`, `backend/lib/starterSquadAllocator.test.js`

- [ ] **Step 1: Bekræft kontrakter.** `MIN_RIDERS_FOR_RACE` fra `marketUtils.js`; manager-selector `getBetaManagerTeams`; hvordan en rytters alder/ungdom + tier udledes (fra generator-`_meta` eller DB-kolonner — bekræft hvilke felter findes på `riders` efter insert). Genbrug `makeRng` fra `fictionalRiderGenerator.js` for seeded determinisme.

- [ ] **Step 2: Skriv fejlende tests (kontrakten).**

```js
test("hver manager får præcis MIN_RIDERS_FOR_RACE ryttere", ...)
test("trup = STARTER_YOUTH unge + STARTER_DOMESTIQUES domestiques", ...)
test("ingen stjerne/solid allokeres (kun domestik-tier + youth)", ...)
test("fairness: holdenes samlede base_value-spænd ≤ tærskel", ...)
test("seeded: samme seed → samme allokering (dry-run = apply)", ...)
test("dryRun skriver ingen team_id", ...)
```

- [ ] **Step 3: Kør — FAIL.**

- [ ] **Step 4: Implementér `allocateStarterSquads(supabase, {seed, dryRun})`.** Hent managers + ledige fiktive ryttere (pcm_id null, team_id null), partitionér i youth-pool og domestique-pool, seeded round-robin/snake-draft så holdene bliver ~lige stærke (fairness via base_value-balancering), assign `team_id` (kun ved apply). Returnér per-team summary + fairness-metrik.

- [ ] **Step 5: Kør — PASS.**

- [ ] **Step 6: Commit.** `feat(#1103): seeded race-ready starter squad allocator`.

---

## Task 5: Orchestrator + prod-guard

**Files:**
- Create: `backend/scripts/relaunchSeason1.js`, `backend/lib/relaunchSeason1.test.js`

- [ ] **Step 1: Skriv fejlende test for sekvens + dry-run.** Mock alle byggeklodser (inject via deps-objekt) og assert kald-rækkefølge: retire → reset → population → physiology → types → baseValue → starterSquads → season(0→1) → founderBadges. `dryRun` propagerer til alle. Test at `--target-prod` uden typed-confirm afviser.

- [ ] **Step 2: Kør — FAIL.**

- [ ] **Step 3: Implementér orchestrator-kernen `runRelaunch(supabase, {dryRun, deps})`** der kalder byggeklodserne i rækkefølge og samler summary. Sæson 0→1: indsæt sæson 0-row (deterministisk UUID via `computeSeasonUuid(0)`) + dens transfer_window, derefter `transitionToNextSeason({ supabase, fromSeasonId: computeSeasonUuid(0), dryRun })`.

- [ ] **Step 4: Implementér CLI-laget** med lagdelt prod-guard: default dry-run; `--apply` kræver `--supabase-url`/`--key`; `--target-prod` kræver tillige stdin typed-confirm af en fast sætning OG at url matcher prod-ref (allowlist). Kopiér deny/print-mønster fra `generateFictionalRiders.js`. Print fuld dry-run-summary FØR enhver write.

- [ ] **Step 5: Kør — PASS.**

- [ ] **Step 6: Commit.** `feat(#1103): relaunch orchestrator with layered prod guard`.

---

## Task 6: End-to-end dry-run mod preview-DB

- [ ] **Step 1: Provisionér preview/branch-DB** (Supabase branch) med en kopi af skemaet. Sæt `--supabase-url`/`--key` til preview.
- [ ] **Step 2: Kør `node backend/scripts/relaunchSeason1.js --dry-run --supabase-url <preview> --supabase-key <key>`.** Expected: summary uden writes — wouldRetire ~legacy-count, wouldGenerate 800, 18×8 startholds, season 0→1 plan, wouldGrant badges.
- [ ] **Step 3: Kør rigtig mod preview (`--apply`, IKKE --target-prod).** Verificér mod spec'ens verifikationssti: ingen legacy aktive, 8 ryttere pr. manager, ingen stjerne forhåndstildelt, badge tildelt + overlever en efterfølgende `runFullBetaReset`, brugerkonti intakte.
- [ ] **Step 4: Dokumentér rollback** (`UPDATE riders SET is_retired=false WHERE pcm_id IS NOT NULL`) i scriptets header + spec.
- [ ] **Step 5: Postmortem/learning hvis noget overraskede.** Opdatér `docs/NOW.md` + #1103-kommentar med dry-run-resultatet.

---

## Self-Review (udført)

- **Spec-dækning:** retire (T2), reset (T5 komponerer runFullBetaReset), population (T5), backfill-kæde (T1+T5), startholds (T4), sæson 0→1 (T5), founder-badge+undtagelse (T3), prod-guard (T5), dry-run-verifikation (T6). Alle spec-krav har en task.
- **Type-konsistens:** `runPhysiologyBackfill`/`runRiderTypesBackfill`/`runBaseValueBackfill`, `retireLegacyRiders`, `grantFounderBadges`/`FOUNDER_BADGE_KEY`, `allocateStarterSquads`, `runRelaunch` — navne bruges konsistent på tværs af tasks.
- **Bevidste ikke-placeholders:** Task 1, 3 og 4 har et eksplicit "læs filen / bekræft skema FØR du skriver kode"-trin frem for opfundne signaturer. Det er ikke et placeholder — det er kravet om at de eksakte interne signaturer hentes fra runtime-koden ved eksekvering (verificér-før-claim). De ydre kontrakter (argument- og return-form) ER defineret her.

---

## Runtime-kontrakter (verificeret 2026-06-09, build-session)

> Disse blev læst direkte fra runtime/DB denne session, så Task 1/3/4's "bekræft skema"-trin allerede er afdækket. Verificér stadig at koden ikke er drevet siden, men opfind ikke nyt.

**`achievements`-tabel (DB, prod-skema):** `id text PK · category text NOT NULL · title text NOT NULL · description text NOT NULL · icon text DEFAULT '🏆' · is_secret bool DEFAULT false · sort_order int DEFAULT 0`. Eksisterende rows er **danske** (fx `{id:"auction_10_wins", category:"auktioner", title:"10 auktioner vundet", ...}`).

**`manager_achievements`-INSERT-form** (`achievementEngine.js:296`): `{ user_id, achievement_id, unlocked_at }`. **Nøglekolonnen er `achievement_id`** (ikke `achievement_key`) — Task 3's `.neq(...)` skal bruge `achievement_id`.

**`resetBetaAchievements`** ([betaResetService.js:389-403](../../../backend/lib/betaResetService.js)) sletter i dag `manager_achievements.delete().in("user_id", userIds).select("id")`. Founder-undtagelse = tilføj `.neq("achievement_id", FOUNDER_BADGE_KEY)` før `.select`. Sæt `FOUNDER_BADGE_KEY = "founder_badge"`.

**Founder-badge-def til upsert** (matcher kontrakten + DA-konvention — `category` afgøres af ejer, se nedenfor): `{ id:"founder_badge", category:<…>, title:<…>, description:<…>, icon:<…>, is_secret:false, sort_order:0 }`.

**Backfill-kerner — alle 3 funktioner er allerede eksporteret + rene:** `seedPhysiologyFromLegacy`/`deriveAbilities` (physiology), `computeRiderTypes`+`ABILITY_KEYS`/`RIDER_TYPE_KEYS` (types, baseline `riderTypesBaseline.json`), `predictBaseValue` (base_value, model `riderValuationModel.json`). De 3 CLI'er deler mønster: env→`createClient`→`fetchAllRows`→compute→`updateInBatches`/`upsertBatched`(500)/`WRITE_CONCURRENCY=25`→`--dry-run`-gren. Ekstraktion = flyt `main()`-kroppen til `run*Backfill(supabase,{dryRun})`. base_value er bekræftet **SHADOW** (kun `riders.base_value`, ikke wired til price/market/salary).

**Allokerings-input (Task 4):** efter insert har fiktive ryttere IKKE `_meta` (kun in-memory). Pool læses fra DB-kolonner: `birthdate` (→ alder vs `referenceYear=2026`), `potentiale` (decimal 1.0-6.0), `base_value` (SHADOW, fra backfill). "Ingen stjerne" = ekskludér top-fraktion på `base_value`; "ung" = alder 18-21 & `potentiale ≥ tærskel`; fairness = snake-draft på `base_value`.

**Test-konvention:** in-memory fake-supabase fra [betaResetService.test.js:18-125](../../../backend/lib/betaResetService.test.js) — understøtter `eq/in/not/select/update/delete/insert`. Genbrug/udvid den (tilføj `.neq()`) for Task 3's reset-test frem for at opfinde en ny mock. `node --test` (built-in), `*.test.js` ved siden af kilden.

**`getBetaManagerTeams(supabase)`** ([betaResetService.js:42](../../../backend/lib/betaResetService.js)) selekterer `id, user_id, balance, sponsor_income` for `is_ai=false ∧ is_bank=false ∧ is_frozen=false ∧ is_test_account=false`. Samme selector til både startholds-allokering (`.id`) og founder-grant (`.user_id`).

**To åbne ejer-beslutninger (spec-review, blokerer kun Task 3/4-kode):**
1. **Founder-badge copy + sprog** — `achievements`-tabellen er i dag 100% dansk; EN-first-reglen trækker mod engelsk. Default: matchede dansk for tabel-konsistens (`category:"milepæle"`). Kræver ejer-OK på endelig title/description/icon (permanent, ses for evigt).
2. **Startholds-konstanter** — `STARTER_YOUTH=4 + STARTER_DOMESTIQUES=4`, ung-alder 18-21, `potentiale`-tærskel, stjerne-cutoff-fraktion, fairness-tolerance. Default-sæt i `starterSquadAllocator.js`, tunbart.
