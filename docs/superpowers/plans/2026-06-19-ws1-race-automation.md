# WS1 — Race-automatisering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status (2026-06-19):** Fase 1 (auto-prize) + Fase 2 (season-cron re-enable) er implementerbare nu. **Fase 3 (race-scheduler) er GATED** af to ejer-beslutninger i Fase 0 (schema-model + migration som ejer selv merger). Implementér IKKE Fase 3 før Fase 0-B er afgjort.
>
> **Kilder:** [`2026-06-19-forever-relaunch-readiness-design.md`](../specs/2026-06-19-forever-relaunch-readiness-design.md) §WS1 (godkendt design) · research-sweep 2026-06-19 (8 domæne-scannere, verificeret mod kode).

**Goal:** Fjerne den manuelle drift af spillet (løb-afvikling, præmie-udbetaling, sæson-skift) så CyclingZone kan slippes til ægte nye spillere uden daglig admin-indgriben — forudsætning for forever-relaunch.

**Architecture:** Tre uafhængige cron-jobs der hægter på `backend/cron.js`' eksisterende `setInterval(trackedTick(...))`-mønster, hver gated bag et runtime `app_config`-flag (flippes uden re-deploy, fail-safe OFF). Hvert job genbruger en eksisterende, testet, idempotent engine i stedet for at bygge ny mekanik. Risiko stiger pr. fase: auto-prize (genbruger idempotent payout) → season-cron (re-enable hærdet cron + ny readiness-gate) → race-scheduler (ny kalender-struktur, loop-følsom, beta-testes først).

**Tech Stack:** Node.js (ESM), `backend/cron.js` setInterval-scheduler, `featureStage.js` runtime-flags (`app_config`-tabel), `copenhagenTime.js` for danske tidsvinduer, `node --test` for unit-tests, Supabase service-role client, Sentry `captureException`.

---

## Fil-struktur (hvad oprettes/ændres)

| Fil | Ansvar | Fase |
|-----|--------|------|
| `backend/lib/autoPrizeSweep.js` (ny) | Cron-sweep: find aktiv sæson, kald `paySeasonPrizesToDate` idempotent | 1 |
| `backend/lib/autoPrizeFlag.js` (ny) | Runtime-flag `auto_prize_enabled` (spejler `raceEngineFlag.js`) | 1 |
| `backend/lib/prizePayoutEngine.js` (ændr) | Parametrisér `actorType` så cron kan logge som SYSTEM, ikke ADMIN | 1 |
| `backend/cron.js` (ændr) | Registrér de tre nye jobs + immediate-run hvor relevant | 1,2,3 |
| `backend/lib/seasonAutoTransition.js` (ændr) | Tilføj readiness-gate + min-interval-guard i auto-stien | 2 |
| `backend/lib/economyConstants.js` (ændr) | `SEASON_AUTO_TRANSITION_ENABLED = true` (efter Fase 2-verifikation) | 2 |
| `backend/lib/raceSchedulerFlag.js` (ny) | Runtime-flag `race_scheduler_enabled` | 3 |
| `backend/lib/raceScheduler.js` (ny) | Cron-sweep: find dagens kandidat-løb, kør via `runAdminSimulateRace`, max-1-løb/dag-guard | 3 |
| `database/<dato>-races-schedule.sql` (ny, **ejer merger**) | Schema for "dagens løb"-model (afhænger af Fase 0-B) | 3 |
| `*.test.js` (ny pr. modul) | Unit-tests for hver ny engine | 1,2,3 |

---

## Fase 0 — Ejer-beslutninger (afgør FØR de gatede dele bygges)

Disse er ikke kode-tasks. De afklares i en ejer-session (kan kombineres med granit-frys §7). Fase 1-2 er **ikke** gated af dem; Fase 3 er.

- [ ] **Beslutning A — Auto-prize-timing (gater ikke, men bekræft før Fase 1 ship):**
  Auto-prize sætter `races.prize_paid_at` ved udbetaling. To paths (`rederiveSeasonRacePoints` i `raceResultsEngine.js:125-155` + `POST /admin/seasons/:id/rederive-points` i `api.js:4474`) springer betalte løb HELT over. Dvs. så snart et løb er udbetalt, kan dets race-points ikke længere re-deriveres (race_points-config-ændringer slår ikke igennem). Dette er allerede invarianten i dag — auto-prize fremrykker blot tidspunktet fra "manuelt admin-tryk" til "automatisk efter X". **Plan vælger cron-sweep med interval (ikke inline-ved-completion)** netop for at bevare et justeringsvindue: et løb afvikles, og admin har indtil næste sweep-tick til at re-derivere point hvis nødvendigt. Bekræft at dette vindue (interval-længden, se Task 1.6) er acceptabelt, eller om auto-prize skal være helt off indtil race-scheduler er live.

- [ ] **Beslutning B — Race-scheduler "dagens løb"-model (GATER Fase 3):**
  `races`-tabellen har INGEN dato/sekvens-kolonne i dag (`schema.sql:113-124`); "dagens løb" findes ikke som koncept. Vælg én:
  - **(A) Sekvens uden dato** — ny `races.race_order INT`; afvikl næste i rækkefølge, ét pr. dag. Migration (lille). Ingen kalender-UI-værdi.
  - **(B) Ægte kalender** — ny `races.scheduled_for TIMESTAMPTZ`; afvikl løb hvor dato = i dag. Migration + `seasonRaceSelection.js` udfylder datoer ved seed/relaunch. **Anbefalet** — matcher forever-relaunch's "løb/ruter/kalender"-mål (spec §WS3, NOW.md) og giver spillerne en synlig løbskalender.
  - **(C) N race-days/uge** — genbrug `seasons.race_days_completed`-counter, afvikl indtil dagligt mål nås. Ingen ny kolonne, men ingen kalender-koncept.
  - **Konsekvens:** A og B kræver `database/*.sql` der auto-applies i prod ved merge → **ejer merger selv** (aldrig auto-merge). Additiv `ADD COLUMN IF NOT EXISTS` er lav-risiko i sig selv. Hvis B vælges og kolonnen skal være player-facing (vis kalender) → kræver `GRANT SELECT (scheduled_for) TO anon, authenticated` i SAMME migration (jf. #1162-mønstret).

- [ ] **Beslutning C — Stress-test-vindue:**
  Spec §WS1 kræver "stress-test live på den nuværende beta-sæson før forever". Afgør hvornår de tre jobs tændes på beta (runtime-flag ON) og hvor længe de observeres (mål: ≥1 fuld dag-cyklus med løb-afvikling + præmie-udbetaling + ét sæson-skift uden manuel indgriben, spec §6.1).

---

## Fase 1 — Auto-prize cron-sweep  *(LAV risiko · implementerbar nu)*

**Princip:** Genbrug den fuldt idempotente `paySeasonPrizesToDate(seasonId, actorId, supabase)` (`prizePayoutEngine.js:194`). Den looper allerede pending (løb, hold), krediterer via `incrementBalanceWithAudit` med `idempotency_key: race_prize:<race>:<team>`, og sætter `prize_paid_at`. En sweep behøver kun finde den aktive sæson og kalde den periodisk. Idempotensen gør gentagne ticks harmløse.

### Task 1.1: Runtime-flag for auto-prize

**Files:**
- Create: `backend/lib/autoPrizeFlag.js`

- [ ] **Step 1: Skriv flag-modulet** (spejl `raceEngineFlag.js` præcist)

```js
// Auto-prize cron-flag. Bor i app_config (key/value) → flippes runtime UDEN
// re-deploy. Fail-safe: fejl/fravær → false (ingen utilsigtet automatisk udbetaling).
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const AUTO_PRIZE_FLAG_KEY = "auto_prize_enabled";

export async function isAutoPrizeEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, AUTO_PRIZE_FLAG_KEY), opts);
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/lib/autoPrizeFlag.js
git commit -F <besked-fil>   # "feat(cron): runtime-flag for auto-prize sweep (#WS1)"
```

### Task 1.2: Parametrisér actor_type i payout-engine

**Files:**
- Modify: `backend/lib/prizePayoutEngine.js:194-263`
- Test: `backend/lib/prizePayoutEngine.test.js`

Begrundelse: `paySeasonPrizesToDate` hardcoder `actor_type: FINANCE_ACTOR_TYPE.ADMIN` (linje 214). En cron-udbetaling bør logge som system, ikke admin, for en ærlig audit-trail.

- [ ] **Step 1: Skriv fejlende test** — at en system-payout logger `actor_type=system`

```js
// I prizePayoutEngine.test.js, ny test:
test("paySeasonPrizesToDate logger actor_type=system når actorType=SYSTEM", async () => {
  const calls = [];
  const supabase = makePrizeStub({ pending: [{ race_id: "r1", race_name: "Tour", by_team: [{ team_id: "t1", prize: 1000 }], total_prize: 1000 }] });
  // stub incrementBalanceWithAudit via DI eller spioner på payload.actor_type
  await paySeasonPrizesToDate("s1", null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });
  assert.equal(capturedPayload.actor_type, FINANCE_ACTOR_TYPE.SYSTEM);
});
```

Hvis `FINANCE_ACTOR_TYPE.SYSTEM` ikke findes i `economyConstants.js`, tilføj den der først (verificér med Grep `FINANCE_ACTOR_TYPE`).

- [ ] **Step 2: Kør testen, verificér FAIL**

Run: `cd backend && node --test --test-name-pattern="actor_type=system"`
Expected: FAIL (parameter findes ikke endnu)

- [ ] **Step 3: Tilføj fjerde valgfri parameter**

```js
export async function paySeasonPrizesToDate(seasonId, adminUserId, supabase, opts = {}) {
  const actorType = opts.actorType ?? FINANCE_ACTOR_TYPE.ADMIN;  // default = uændret adfærd
  // ... i payload: actor_type: actorType,  (linje 214 ændres fra hardcoded ADMIN)
```

- [ ] **Step 4: Kør tests, verificér PASS** — både den nye + alle eksisterende i filen forbliver grønne.

Run: `cd backend && node --test backend/lib/prizePayoutEngine.test.js`
Expected: PASS (default-arg bevarer ADMIN for det manuelle endpoint i `api.js:6248`)

- [ ] **Step 5: Commit** — `refactor(prize): valgfri actorType i paySeasonPrizesToDate`

### Task 1.3: Auto-prize-sweep-modulet

**Files:**
- Create: `backend/lib/autoPrizeSweep.js`
- Test: `backend/lib/autoPrizeSweep.test.js`

- [ ] **Step 1: Skriv fejlende tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runAutoPrizeSweep } from "./autoPrizeSweep.js";

test("skip når flag OFF", async () => {
  const r = await runAutoPrizeSweep({ supabase: {}, isEnabled: async () => false, payFn: async () => { throw new Error("burde ikke kaldes"); } });
  assert.deepEqual(r, { paid: 0, skipped: "flag_off" });
});

test("skip når ingen aktiv sæson", async () => {
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  const r = await runAutoPrizeSweep({ supabase, isEnabled: async () => true, payFn: async () => ({}) });
  assert.deepEqual(r, { paid: 0, skipped: "no_active_season" });
});

test("kalder payFn med aktiv sæson + actorType SYSTEM", async () => {
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1" }, error: null }) }) }) }) };
  let called = null;
  const payFn = async (seasonId, actorId, sb, opts) => { called = { seasonId, actorId, opts }; return { races_paid: 2, total_paid: 5000 }; };
  const r = await runAutoPrizeSweep({ supabase, isEnabled: async () => true, payFn });
  assert.equal(called.seasonId, "s1");
  assert.equal(called.actorId, null);
  assert.equal(r.paid, 2);
});
```

- [ ] **Step 2: Kør, verificér FAIL** — `node --test backend/lib/autoPrizeSweep.test.js` → modul findes ikke.

- [ ] **Step 3: Implementér modulet**

```js
// Auto-prize sweep (#WS1): udbetaler udestående præmier for completede løb i den
// aktive sæson. Genbruger den idempotente paySeasonPrizesToDate (prize_paid_at +
// idempotency_key gør gentagne ticks harmløse). Gated bag runtime-flag.
import { isAutoPrizeEnabled } from "./autoPrizeFlag.js";
import { paySeasonPrizesToDate } from "./prizePayoutEngine.js";
import { FINANCE_ACTOR_TYPE } from "./economyConstants.js";

export async function runAutoPrizeSweep({
  supabase,
  isEnabled = isAutoPrizeEnabled,
  payFn = paySeasonPrizesToDate,
} = {}) {
  if (!(await isEnabled(supabase))) return { paid: 0, skipped: "flag_off" };

  const { data: season, error } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);
  if (!season) return { paid: 0, skipped: "no_active_season" };

  const result = await payFn(season.id, null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });
  return { paid: result.races_paid ?? 0, total: result.total_paid ?? 0 };
}
```

- [ ] **Step 4: Kør tests, verificér PASS.**

- [ ] **Step 5: Commit** — `feat(cron): auto-prize sweep-modul (#WS1)`

### Task 1.4: Hægt auto-prize på cron-scheduleren

**Files:**
- Modify: `backend/cron.js` (import-blok øverst + wrapper ~linje 286 + `startCron` ~linje 469)

- [ ] **Step 1: Tilføj import + wrapper** (følg `runTrainingSweepCron`-mønstret)

```js
// øverst, ved de andre lib-imports:
import { runAutoPrizeSweep } from "./lib/autoPrizeSweep.js";

// ny wrapper ved de andre cron-wrappers:
async function runAutoPrizeSweepCron() {
  const r = await runAutoPrizeSweep({ supabase });
  if (r.paid > 0) console.log(`💰 Auto-prize: ${r.paid} løb udbetalt (${r.total} kr)`);
}
```

- [ ] **Step 2: Registrér i `startCron()`** (ved de andre 5-min sweeps, ~linje 469)

```js
  // Auto-prize: udbetal udestående præmier for completede løb (#WS1).
  // trackedTick giver Sentry-capture + graceful-shutdown gratis. Idempotent via prize_paid_at.
  setInterval(trackedTick("auto-prize sweep", runAutoPrizeSweepCron), 5 * 60 * 1000);
```

Bevidst INGEN immediate-run-linje (i 475-480) — auto-prize skal ikke fyre ved hver server-genstart; det periodiske tick er nok.

- [ ] **Step 3: Verificér** — `pwsh -File scripts/verify-local.ps1` grøn (backend node --test + frontend).

- [ ] **Step 4: Commit** — `feat(cron): registrér auto-prize sweep (5-min, flag-gated) (#WS1)`

### Task 1.5: Beta-aktivering + verifikation (manuel, ejer/ops)

- [ ] Sæt `auto_prize_enabled` → `on` i `app_config` (Supabase/admin-flag-UI). Afvikl et beta-løb manuelt. Verificér inden 5-10 min at de relevante hold modtog præmiepenge (`finance_transactions` reason_code `RACE_PRIZE_PAYOUT`) + `races.prize_paid_at` sat. Verificér idempotens: kør sweep igen → 0 nye transaktioner.
- [ ] Observér Sentry for `cron:auto-prize sweep`-fejl første døgn.

---

## Fase 2 — Re-enable season-transition-cron  *(MEDIUM risiko · implementerbar nu)*

**Princip:** Rod-årsags-fixet fra 2026-05-21-incidenten (`closed_at`-discriminator + DB CHECK constraint) er allerede deployet og dækket af tests. Re-enable er derfor at genaktivere en cron mod et hærdet filter — MEN to huller skal lukkes først: (1) auto-cron'en er ugated mod readiness (kan skifte sæson midt i uafsluttede løb), og (2) loop-guarden *opdager* kun (alert ved >1/24h), den *forhindrer* ikke. Vi tilføjer readiness-gate + en prævention (min-interval-guard) før vi flipper flaget.

### Task 2.1: Readiness-gate i auto-transition-stien

**Files:**
- Modify: `backend/lib/seasonAutoTransition.js:18-69`
- Test: `backend/lib/seasonAutoTransition.test.js`

I dag deler `processSeasonAutoTransitionCron` IKKE `assessTransitionReadiness`-checket (`seasonTransitionReadiness.js:16`) som den manuelle endpoint har. Resultat: auto-skift kan ske med 0 aktive auktioner/alle løb completed ikke verificeret.

- [ ] **Step 1: Skriv fejlende test** — at cron'en IKKE transitionerer hvis readiness fejler

```js
test("auto-transition afbryder hvis readiness ikke er opfyldt", async () => {
  const supabase = stubWithWrappedWindow({ seasonId: "s1", seasonStatus: "active" });
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase, now: new Date(),
    transitionFn: async () => { transitioned = true; return {}; },
    assessReadiness: async () => ({ ready: false, reason: "active_auctions" }),
  });
  assert.equal(transitioned, false);
  assert.equal(r.transitioned, false);
  assert.equal(r.reason, "not_ready_active_auctions");
});
```

- [ ] **Step 2: Kør, verificér FAIL** (parameter findes ikke).

- [ ] **Step 3: Tilføj readiness-gate** — efter season-status-tjekket (linje 54), før `transitionFn`-kaldet:

```js
// import øverst:
import { assessTransitionReadiness } from "./seasonTransitionReadiness.js";

// signatur: tilføj assessReadiness = assessTransitionReadiness til destructuring.
// efter season.status-tjekket, før transitionFn:
const readiness = await assessReadiness({ supabase, seasonId: window.season_id });
if (!readiness.ready) {
  return { transitioned: false, reason: `not_ready_${readiness.reason}` };
}
```

Verificér `assessTransitionReadiness`' faktiske signatur + retur-form med Read (`seasonTransitionReadiness.js:16-45`) og tilpas kaldet, så det matcher (felter `ready`/`reason` kan hedde andet).

- [ ] **Step 4: Kør tests, verificér PASS** (ny + eksisterende grønne).

- [ ] **Step 5: Commit** — `fix(season): readiness-gate i auto-transition cron (#WS1)`

### Task 2.2: Min-interval-guard (prævention, ikke kun detektion)

**Files:**
- Modify: `backend/lib/seasonAutoTransition.js`
- Test: `backend/lib/seasonAutoTransition.test.js`

Loop-guarden (`dailySeasonCountCheck`) alerter først EFTER den 2. transition. Tilføj en hård prævention: auto-cron'en må maks fyre én transition per N timer, læst fra `admin_log` (samme kilde som loop-guarden).

- [ ] **Step 1: Skriv fejlende test**

```js
test("auto-transition blokeres hvis en transition allerede er logget inden for min-interval", async () => {
  const supabase = stubWithWrappedWindow({ seasonId: "s1", seasonStatus: "active", recentTransitionWithinHours: 1 });
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase, now: new Date(),
    transitionFn: async () => { transitioned = true; return {}; },
    assessReadiness: async () => ({ ready: true }),
  });
  assert.equal(transitioned, false);
  assert.equal(r.reason, "recent_transition_guard");
});
```

- [ ] **Step 2: Kør, verificér FAIL.**

- [ ] **Step 3: Implementér guard** — før `transitionFn`, tjek `admin_log` for en `SEASON_TRANSITION` inden for `MIN_TRANSITION_INTERVAL_HOURS` (fx 12):

```js
const MIN_TRANSITION_INTERVAL_HOURS = 12;
// ...
const guardSince = new Date(now.getTime() - MIN_TRANSITION_INTERVAL_HOURS * 3600 * 1000).toISOString();
const { count: recent } = await supabase
  .from("admin_log").select("id", { count: "exact", head: true })
  .eq("action_type", ADMIN_ACTION_TYPE.SEASON_TRANSITION)
  .gte("created_at", guardSince);
if ((recent ?? 0) > 0) return { transitioned: false, reason: "recent_transition_guard" };
```

(Importér `ADMIN_ACTION_TYPE` fra `economyConstants.js`.)

- [ ] **Step 4: Kør tests, verificér PASS.**

- [ ] **Step 5: Commit** — `fix(season): min-interval prævention mod transition-loop (#WS1)`

### Task 2.3: Pre-flip-verifikation af eksisterende forsvar (manuel, ops)

- [ ] Verificér Lag 1 (filter) + Lag 2 (DB CHECK) stadig aktive: kør `pwsh -File scripts/verify-local.ps1` + bekræft `database/2026-05-22-transfer-window-racing-guard.sql`-constraints findes i prod (Supabase MCP `execute_sql` mod `pg_constraint`).
- [ ] Bekræft loop-guardens kanal lever: at `getDefaultWebhook()` returnerer en gyldig URL + Sentry-tag `cron:daily-season-count-check` leverer (test-fyr en harmløs capture). En død webhook gør Lag 3 nyttesløs (jf. token-drift-historik #1115).

### Task 2.4: Flip flaget

**Files:**
- Modify: `backend/lib/economyConstants.js:97`

- [ ] **Step 1:** `export const SEASON_AUTO_TRANSITION_ENABLED = true;` (opdatér kommentaren 93-96 så den afspejler at readiness-gate + min-interval-guard nu beskytter auto-stien).
- [ ] **Step 2: Commit** — `feat(season): re-enable auto-transition cron med readiness+interval-guards (#WS1)`. **Dette er en brugerrettet adfærdsændring → patch note (konsolideres centralt).**
- [ ] **Step 3: Rollout (ops):** deploy tidligt i et sæson-vindue (ikke lige op til en deadline-close). Observér én fuld deadline→wrap→transition-cyklus i Sentry + `admin_log`. Behold den manuelle endpoint (`POST /api/admin/season-transition`) som fallback.

---

## Fase 3 — Race-scheduler  *(MEDIUM-HØJ risiko · GATED af Fase 0-B · beta-testes før prod)*

> **Byg IKKE før Beslutning B er truffet.** Strukturen nedenfor antager **Model B (kalender, `races.scheduled_for`)** — den anbefalede. Tilpas Task 3.1+3.3 hvis A eller C vælges. Migrationen (`database/*.sql`) **merger ejeren selv** (auto-applies i prod).

**Princip:** Genbrug `runAdminSimulateRace` (`adminSimulateRace.js:69`) uændret — den har allerede al validering + idempotens (status-guard 409, profil-completeness, flag-check, delete-then-insert). Scheduleren tilføjer kun: tidsvindue + "hvilket løb er dagens" + en hård max-1-løb/dag-guard mod loop-historikken.

### Task 3.1: Schema — `races.scheduled_for` *(ejer merger)*

**Files:**
- Create: `database/<dato>-races-schedule.sql`

- [ ] **Step 1:** Additiv kolonne + index:

```sql
-- WS1: kalender-dato pr. løb så race-scheduler kan finde "dagens løb".
ALTER TABLE public.races ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS races_scheduled_for_idx ON public.races (scheduled_for) WHERE status = 'scheduled';
-- Player-facing (vis løbskalender) → kolonne-læseadgang (jf. #1162):
GRANT SELECT (scheduled_for) ON public.races TO anon, authenticated;
```

Verificér GRANT-mønstret mod en eksisterende riders-kolonne-migration før du skriver det (kun nødvendigt hvis `races` bruger kolonne-privilegier; hvis `races` har table-level RLS som `race_stage_profiles`, er GRANT'en unødvendig — tjek `schema.sql` + eksisterende races-GRANTs).

- [ ] **Step 2:** Udfyld `scheduled_for` ved seed/relaunch i `seasonRaceSelection.js` (eller relaunch-orchestratoren) — fordel de valgte løb over sæson-kalenderen. Dette er en separat ændring; spec'ér rækkefølge med ejer (matcher START_DATE-parameteriseringen i forever-spec §WS4).

### Task 3.2: Runtime-flag for race-scheduler

**Files:** Create `backend/lib/raceSchedulerFlag.js` (spejl `autoPrizeFlag.js`, key `race_scheduler_enabled`). TDD som Task 1.1. Commit.

### Task 3.3: Scheduler-modulet med max-1-løb/dag-guard

**Files:**
- Create: `backend/lib/raceScheduler.js`
- Test: `backend/lib/raceScheduler.test.js`

- [ ] **Step 1: Skriv fejlende tests** — dæk: flag-off skip; før-tidsvindue skip; allerede-kørt-i-dag-guard (max 1); spredt timing (deterministisk offset pr. race.id); kalder `runAdminSimulateRace` for dagens forfaldne `scheduled`-løb.

```js
test("max 1 løb pr. dag — skip hvis et løb allerede afviklet i dag", async () => {
  const supabase = stubRaces({ scheduledToday: ["r2"], completedToday: ["r1"] });
  let ran = [];
  const r = await runRaceScheduler({
    supabase, now: at22Copenhagen(),
    isEnabled: async () => true,
    runRaceFn: async ({ raceId }) => { ran.push(raceId); return { ok: true }; },
  });
  assert.deepEqual(ran, []);                 // intet kørt — dagskvoten brugt
  assert.equal(r.skipped, "daily_cap_reached");
});
```

- [ ] **Step 2: Kør, verificér FAIL.**

- [ ] **Step 3: Implementér** (følg `trainingSweep.js`-strukturen):

```js
import { copenhagenHour, copenhagenDateString } from "./copenhagenTime.js";
import { isRaceSchedulerEnabled } from "./raceSchedulerFlag.js";
import { runAdminSimulateRace } from "./adminSimulateRace.js";
import { stableSeed } from "./raceRunner.js";   // verificér eksport-navn

export const RACE_SWEEP_FROM_HOUR = 22;

export async function runRaceScheduler({
  supabase, now = new Date(),
  isEnabled = isRaceSchedulerEnabled,
  runRaceFn = (args) => runAdminSimulateRace(args),
} = {}) {
  if (copenhagenHour(now) < RACE_SWEEP_FROM_HOUR) return { ran: 0, skipped: "before_window" };
  if (!(await isEnabled(supabase))) return { ran: 0, skipped: "flag_off" };

  const today = copenhagenDateString(now);
  // 1) dagskvote: maks 1 løb afviklet pr. kalenderdag (loop-prævention, 2026-05-21).
  //    Tæl races completed i dag (via prize/completion-timestamp eller admin_log).
  const alreadyRanToday = await countRacesRanToday(supabase, today);
  if (alreadyRanToday >= 1) return { ran: 0, skipped: "daily_cap_reached" };

  // 2) find dagens forfaldne scheduled-løb i aktiv sæson.
  const race = await findDueScheduledRace(supabase, now);
  if (!race) return { ran: 0, skipped: "no_due_race" };

  // 3) spredt timing: deterministisk offset pr. race.id så ikke alt kl 22:00 præcist.
  const offsetMin = stableSeed(`sched:${race.id}`) % 90;   // 0-89 min ind i vinduet
  const minutesIntoWindow = (copenhagenHour(now) - RACE_SWEEP_FROM_HOUR) * 60 + now.getMinutes();
  if (minutesIntoWindow < offsetMin) return { ran: 0, skipped: "awaiting_offset" };

  const result = await runRaceFn({ supabase, raceId: race.id, dryRun: false });
  return { ran: 1, raceId: race.id, result };
}
```

`countRacesRanToday` + `findDueScheduledRace` er små helpers i samme fil (TDD hver). `findDueScheduledRace`: `status='scheduled'` AND `scheduled_for::date <= today` i aktiv sæson, ordnet på `scheduled_for` ASC, limit 1.

- [ ] **Step 4: Kør tests, verificér PASS.**
- [ ] **Step 5: Commit** — `feat(cron): race-scheduler med dagskvote + spredt timing (#WS1)`

### Task 3.4: Hægt på cron + beta-stress-test

- [ ] Registrér `setInterval(trackedTick("race scheduler", runRaceSchedulerCron), 5 * 60 * 1000)` i `startCron()` (ingen immediate-run). Verify-local grøn. Commit.
- [ ] **Beta-stress-test (Beslutning C):** tænd `race_scheduler_enabled` + `auto_prize_enabled` på beta. Observér ≥1 fuld dag: ét løb afvikles automatisk i vinduet → præmier udbetales inden for næste auto-prize-tick → dagskvoten forhindrer flere løb samme dag. Verificér i Sentry + `admin_log` + `finance_transactions`. **Dette er forever-gate §6.1.**

---

## Forever-gate-kobling (spec §6)

| Gate-krav (§6) | Opfyldes af |
|----------------|-------------|
| §6.1 — løb afvikles + præmier udbetales + sæson-skift kører ≥1 cyklus uden manuel indgriben | Fase 1 (auto-prize) + Fase 2 (season-cron) + Fase 3 (race-scheduler), bevist på beta (Task 1.5, 2.4-rollout, 3.4-stress-test) |
| §6.2 — WS2+WS3 merged | Separate planer (PCM-sletning #1532-followup; egne løbsnavne) |

**Hård regel:** Ingen del af Fase 3's migration auto-merges — ejeren merger `database/*.sql` selv (auto-applies i prod). Alle tre jobs er fail-safe OFF via runtime-flag indtil beta-bevist.

## Self-review-noter

- **Spec-dækning:** WS1's tre punkter (race-scheduler, auto-prize, season-transition-re-enable) + "stress-test på beta" + "loop-guard aktiv" er hver mappet til en fase. Random±timing (spec linje 38) = Task 3.3 step 3. Sentry-alert (spec linje 38) = `trackedTick`-genbrug gratis i hver fase.
- **Type-konsistens:** `runAutoPrizeSweep`/`runRaceScheduler`/`processSeasonAutoTransitionCron` retur-former (`{paid/ran, skipped}`) er ensartede og matcher `trainingSweep.js`-konventionen. `paySeasonPrizesToDate`'s nye `opts.actorType` bruges konsistent i Task 1.2 + 1.3.
- **Åbne afhængigheder til ejer:** Beslutning B (schema-model) gater Fase 3; Beslutning A (timing) bekræfter Fase 1's interval-vindue; Beslutning C sætter stress-test-omfang. Fase 1+2 kan bygges uafhængigt nu.
