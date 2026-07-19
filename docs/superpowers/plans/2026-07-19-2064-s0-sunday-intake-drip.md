# S0: Søndags-drip af akademi-kandidater (#2064) — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hver søndag modtager hvert menneske-hold 2 nye akademi-kandidater (offered) via et idempotent cron-tick — live 19/7.

**Architecture:** Nyt modul `sundayIntakeTick.js` genbruger `seedAcademyCohortForTeam` (delt kerne fra `academyIntake.js`) med nye count-overrides; claim-først-idempotens via ny tabel `academy_intake_ticks` (mønster: `scout_sweep_runs`); alle nye ungdoms-ryttere stemples med `generation_tag` (\#2493-forberedelse). Konservative defaults (2/hold, ~35 % chance for 1 seriøs) — kalibrering sker i S1-sim-slicen.

**Tech Stack:** Node ESM backend, Supabase (service role), `node --test` med mock-supabase (mønster: `academyIntakeExpirySweep.test.js`), idempotent SQL-migration.

**Kontekst for executor:**
- Spec: `docs/superpowers/specs/2026-07-19-2064-soendags-aargangsmodel-influx-design.md`
- `academy_intake`-flowet (offered→sign/reject, 7-dages udløb) er live og genbruges 1:1. INGEN ændringer i sign/reject/expiry.
- #1799 er IKKE i scope (funktionen den ramte er fjernet med #2456; issuet lukkes separat som obsolete).
- Branch: `feat/2064-s0-sunday-intake-drip` i worktree (`scripts/new-worktree.ps1` / `superpowers:using-git-worktrees`).

---

### Task 1: Migration — `generation_tag` + claim-tabel

**Files:**
- Create: `database/2026-07-19-sunday-intake-drip.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- #2064 S0 — søndags-drip: generation_tag på riders (#2493-forberedelse:
-- stemples i ALLE ungdoms-genereringskanaler, format 's<sæsonnummer>') +
-- claim-tabel for søndags-tickets idempotens (mønster: scout_sweep_runs;
-- claim-FØRST pr. (hold, dato) gør boot-runs/replicas dobbelt-sikre, #2646-lærdommen).
-- Idempotent.

ALTER TABLE riders ADD COLUMN IF NOT EXISTS generation_tag TEXT;

CREATE TABLE IF NOT EXISTS academy_intake_ticks (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tick_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, tick_date)
);

-- Service-role-only (ingen policies = deny for anon/authenticated; service role bypasser RLS).
ALTER TABLE academy_intake_ticks ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Kør idempotens-lint lokalt**

Run: `node scripts/check-migration-idempotency.mjs` (findes scriptet ikke under det navn: `ls scripts | grep -i migration` og kør det matchende; CI-jobbet hedder migration-idempotency)
Expected: ny fil består (IF NOT EXISTS-mønster).

- [ ] **Step 3: Commit**

```bash
git add database/2026-07-19-sunday-intake-drip.sql
git commit -m "feat(academy): #2064 S0 - migration: riders.generation_tag + academy_intake_ticks claim-tabel"
```

---

### Task 2: Generator-overrides (`academyGenerator.js`)

**Files:**
- Modify: `backend/lib/academyGenerator.js:39-50` (signatur + count/seriousCount)
- Test: `backend/lib/academyGenerator.test.js` (tilføj cases)

- [ ] **Step 1: Skriv fejlende tests** (mirror eksisterende test-stil i filen; brug samme makeRng-import som eksisterende cases)

```js
test("countOverride=2 giver præcis 2 kandidater", () => {
  const candidates = generateAcademyCandidates({
    rng: makeRng(42), referenceYear: 2026, existingNames: new Set(), countOverride: 2,
  });
  assert.equal(candidates.length, 2);
});

test("seriousCountOverride=0 giver ingen seriøse", () => {
  const candidates = generateAcademyCandidates({
    rng: makeRng(42), referenceYear: 2026, existingNames: new Set(),
    countOverride: 2, seriousCountOverride: 0,
  });
  assert.equal(candidates.filter((c) => c.is_serious).length, 0);
});

test("uden overrides er adfærden uændret (3-5 kandidater)", () => {
  const candidates = generateAcademyCandidates({
    rng: makeRng(42), referenceYear: 2026, existingNames: new Set(),
  });
  assert.ok(candidates.length >= 3 && candidates.length <= 5);
});
```

- [ ] **Step 2: Kør tests — forvent FAIL** (`countOverride is not defined`-agtigt)

Run: `cd backend && node --test lib/academyGenerator.test.js`

- [ ] **Step 3: Implementér**

I `generateAcademyCandidates`-signaturen tilføj `countOverride = null, seriousCountOverride = null` og erstat de to beregninger. VIGTIGT: når overrides er null skal rng-trækkene ske i PRÆCIS samme rækkefølge som før (determinisme for eksisterende kald):

```js
export function generateAcademyCandidates({
  rng,
  referenceYear,
  existingNames,
  identityBasis = null,
  countOverride = null,
  seriousCountOverride = null,
}) {
  // ── Antal kandidater og seriøse ─────────────────────────────────────────────
  const count = countOverride ??
    (ACADEMY.INTAKE_MIN + Math.floor(rng() * (ACADEMY.INTAKE_MAX - ACADEMY.INTAKE_MIN + 1)));
  const seriousCount = Math.min(
    seriousCountOverride ??
      (ACADEMY.SERIOUS_MIN + Math.floor(rng() * (ACADEMY.SERIOUS_MAX - ACADEMY.SERIOUS_MIN + 1))),
    count
  );
```

- [ ] **Step 4: Kør tests — forvent PASS** (samme kommando)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/academyGenerator.js backend/lib/academyGenerator.test.js
git commit -m "feat(academy): #2064 S0 - count/serious-overrides i generateAcademyCandidates (drip-stoerrelse)"
```

---

### Task 3: `seedAcademyCohortForTeam` — overrides + generation_tag + exports

**Files:**
- Modify: `backend/lib/academyIntake.js:108-144` (delt kerne) + exports
- Test: `backend/lib/academyIntake.test.js` (tilføj case)

- [ ] **Step 1: Skriv fejlende test** (mirror eksisterende mock-supabase-stil i filen — den har allerede mocks for insert-kæderne)

```js
test("seedAcademyCohortForTeam stempler generation_tag og respekterer countOverride", async () => {
  // mock-supabase der opsamler riders-insert-payload (genbrug filens eksisterende mock-mønster)
  const inserted = [];
  const supabase = makeMockSupabase({ onRiderInsert: (rows) => inserted.push(...rows) }); // tilpas til filens faktiske mock-helper
  await seedAcademyCohortForTeam(supabase, {
    teamId: "team-1",
    season: { id: "s-id", number: 2, start_date: "2026-07-27" },
    referenceYear: 2026,
    existingNames: new Set(),
    rng: makeRng(7),
    countOverride: 2,
    seriousCountOverride: 1,
  });
  assert.equal(inserted.length, 2);
  assert.ok(inserted.every((r) => r.generation_tag === "s2"));
});
```

(Har filen ikke en genbrugelig mock-helper: byg en minimal inline-mock med `from("riders").insert(...).select("id")` → `{data:[{id:"r1"},{id:"r2"}],error:null}` og `from("academy_intake").insert(...)` → `{error:null}` — se `academyIntakeExpirySweep.test.js` for stilen.)

- [ ] **Step 2: Kør — forvent FAIL**

Run: `cd backend && node --test lib/academyIntake.test.js`

- [ ] **Step 3: Implementér i `academyIntake.js`**

1. Signatur: `async function seedAcademyCohortForTeam(supabase, { teamId, season, referenceYear, existingNames, rng, identityBasis = null, countOverride = null, seriousCountOverride = null })`
2. Videregiv overrides til generatoren og stempl generation_tag (ALLE kanaler — også signup-kuldet — stemples hermed automatisk):

```js
  const candidates = generateAcademyCandidates({
    rng,
    referenceYear,
    existingNames,
    identityBasis: identityBasis || null,
    countOverride,
    seriousCountOverride,
  });

  // #2064/#2493: generation_tag = 's<sæsonnummer>' på alle ungdoms-genererede ryttere.
  const generationTag = `s${season.number}`;
  const riderPayload = candidates.map((c) => ({ ...c.rider, generation_tag: generationTag }));
```

3. Ændr `export`-linjerne: eksportér `seedAcademyCohortForTeam`, `fetchActiveSeason` og `hashStringToSeed` (bruges af Task 4) — behold funktionerne hvor de er, tilføj blot `export` foran. Eksportér også `fetchExistingFoldedRiderNames`.

- [ ] **Step 4: Kør — forvent PASS** (+ hele filens suite: `node --test lib/academyIntake.test.js`)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/academyIntake.js backend/lib/academyIntake.test.js
git commit -m "feat(academy): #2064 S0 - generation_tag-stempling + overrides i delt kuld-kerne"
```

---

### Task 4: `sundayIntakeTick.js` (modul + tests)

**Files:**
- Create: `backend/lib/sundayIntakeTick.js`
- Create: `backend/lib/sundayIntakeTick.test.js`

- [ ] **Step 1: Skriv modulet**

```js
// backend/lib/sundayIntakeTick.js
// #2064 S0 — Søndags-drip: hvert menneske-hold får SUNDAY_DRIP_COUNT nye
// akademi-kandidater (offered) hver søndag (Europe/Copenhagen).
//
// Idempotens: claim-FØRST pr. (hold, søndags-dato) i academy_intake_ticks
// (PK-collision → allerede kørt). Boot-runs/replicas er dermed no-ops
// (#2646-lærdommen: dagsmarkør, aldrig pr.-boot-kvote). Fejler seeding EFTER
// claim, misser holdet denne søndag (bevidst valg: hellere miss end dobbelt-kuld);
// fejlen surfaces i errors[] → cron-log/Sentry.
//
// Konservative v1-defaults (2 kandidater, ~35 % chance for 1 seriøs) — sæson-
// budgettet (12+), talent-odds og facilitets-skalering kalibreres i S1-sim-slicen
// (spec §2/§7) FØR de røres.
import { isAcademyEnabled } from "./academyFlag.js";
import {
  seedAcademyCohortForTeam,
  fetchActiveSeason,
  fetchExistingFoldedRiderNames,
  hashStringToSeed,
} from "./academyIntake.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { notifyTeamOwner } from "./notificationService.js";

export const SUNDAY_DRIP_COUNT = 2;
export const SUNDAY_DRIP_SERIOUS_PROB = 0.35;
const DRIP_SEED_BASE = 2064;

export function copenhagenDateString(now = new Date()) {
  // en-CA giver YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(now);
}

export function isCopenhagenSunday(now = new Date()) {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Copenhagen", weekday: "short" })
      .format(now) === "Sun"
  );
}

export async function runSundayIntakeTick({
  supabase,
  now = new Date(),
  isEnabled = isAcademyEnabled,
  seedCohortFn = seedAcademyCohortForTeam,
  deriveRiders = deriveForRiderIds,
  notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!isCopenhagenSunday(now)) return { ran: false, reason: "not_sunday" };
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  const season = await fetchActiveSeason(supabase);
  if (!season) return { ran: false, reason: "no_active_season" };

  const tickDate = copenhagenDateString(now);
  const referenceYear = parseInt(String(season.start_date).slice(0, 4), 10) || 2026;

  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, season_1_identity_basis")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsErr) throw new Error(`sunday-intake teams lookup: ${teamsErr.message}`);
  if (!teams?.length) return { ran: true, tickDate, teams: 0, candidates: 0 };

  const existingNames = await fetchExistingFoldedRiderNames(supabase);

  let teamsSeeded = 0;
  const allNewIds = [];
  const errors = [];

  for (const team of teams) {
    // Claim-først: PK (team_id, tick_date). ignoreDuplicates → tom data = allerede claimet.
    const { data: claim, error: claimErr } = await supabase
      .from("academy_intake_ticks")
      .upsert(
        { team_id: team.id, tick_date: tickDate },
        { onConflict: "team_id,tick_date", ignoreDuplicates: true }
      )
      .select("team_id");
    if (claimErr) {
      errors.push(`claim ${team.id}: ${claimErr.message}`);
      continue;
    }
    if (!claim?.length) continue; // allerede kørt i dag (boot-run/replica)

    try {
      const rng = makeRng(((DRIP_SEED_BASE ^ hashStringToSeed(`${team.id}:${tickDate}`)) >>> 0));
      const seriousCount = rng() < SUNDAY_DRIP_SERIOUS_PROB ? 1 : 0;
      const newIds = await seedCohortFn(supabase, {
        teamId: team.id,
        season,
        referenceYear,
        existingNames,
        rng,
        identityBasis: team.season_1_identity_basis || null,
        countOverride: SUNDAY_DRIP_COUNT,
        seriousCountOverride: seriousCount,
      });
      teamsSeeded += 1;
      for (const id of newIds) allNewIds.push(id);

      await notify({
        supabase,
        teamId: team.id,
        type: "academy_drip",
        title: "New academy talent has arrived",
        message: "New candidates are waiting in your academy - sign or reject them.",
        relatedId: null,
        metadata: {
          titleCode: "notif.academyDrip.title",
          messageCode: "notif.academyDrip.message",
        },
      });
    } catch (e) {
      errors.push(`${team.id}: ${e?.message ?? e}`);
    }
  }

  // Afled-pipeline (#1478) i ÉT kald for alle nye ryttere.
  if (allNewIds.length > 0) {
    await deriveRiders(supabase, allNewIds, { dryRun: false });
  }

  return {
    ran: true,
    tickDate,
    teams: teamsSeeded,
    candidates: allNewIds.length,
    ...(errors.length ? { errors } : {}),
  };
}
```

- [ ] **Step 2: Skriv tests** (mock-stil fra `academyIntakeExpirySweep.test.js`; DI-hooks gør mocks små)

```js
// backend/lib/sundayIntakeTick.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  runSundayIntakeTick,
  isCopenhagenSunday,
  copenhagenDateString,
  SUNDAY_DRIP_COUNT,
} from "./sundayIntakeTick.js";

const SUNDAY = new Date("2026-07-19T10:00:00Z");
const MONDAY = new Date("2026-07-20T10:00:00Z");

function makeMockSupabase({ teams = [], claimAccepts = () => true } = {}) {
  return {
    from(table) {
      if (table === "seasons") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "season-1", number: 1, start_date: "2026-06-22" }, error: null }) }) }),
        };
      }
      if (table === "teams") {
        const chain = { eq: () => chain, then: undefined };
        return { select: () => {
          const c = { eq: () => c };
          c.eq = () => c;
          // sidste .eq skal resolve — brug thenable:
          c.then = (resolve) => resolve({ data: teams, error: null });
          return c;
        } };
      }
      if (table === "riders") {
        // fetchExistingFoldedRiderNames → fetchAllRows; giv tom side
        return { select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) };
      }
      if (table === "academy_intake_ticks") {
        return {
          upsert: (row) => ({ select: async () => ({ data: claimAccepts(row) ? [{ team_id: row.team_id }] : [], error: null }) }),
        };
      }
      throw new Error(`uventet tabel ${table}`);
    },
  };
}

test("ikke søndag → no-op", async () => {
  const r = await runSundayIntakeTick({ supabase: makeMockSupabase(), now: MONDAY });
  assert.deepEqual(r, { ran: false, reason: "not_sunday" });
});

test("flag off → no-op", async () => {
  const r = await runSundayIntakeTick({
    supabase: makeMockSupabase(), now: SUNDAY, isEnabled: async () => false,
  });
  assert.deepEqual(r, { ran: false, reason: "flag_off" });
});

test("happy path: 2 hold × 2 kandidater, derive én gang, notify pr. hold", async () => {
  const seeded = [];
  const notified = [];
  let derived = null;
  const r = await runSundayIntakeTick({
    supabase: makeMockSupabase({ teams: [{ id: "t1" }, { id: "t2" }] }),
    now: SUNDAY,
    isEnabled: async () => true,
    seedCohortFn: async (_s, opts) => {
      seeded.push(opts);
      return [`${opts.teamId}-r1`, `${opts.teamId}-r2`];
    },
    deriveRiders: async (_s, ids) => { derived = ids; },
    notify: async (n) => { notified.push(n.teamId); },
  });
  assert.equal(r.ran, true);
  assert.equal(r.teams, 2);
  assert.equal(r.candidates, 4);
  assert.equal(seeded.length, 2);
  assert.ok(seeded.every((o) => o.countOverride === SUNDAY_DRIP_COUNT));
  assert.ok(seeded.every((o) => o.seriousCountOverride === 0 || o.seriousCountOverride === 1));
  assert.deepEqual(derived, ["t1-r1", "t1-r2", "t2-r1", "t2-r2"]);
  assert.deepEqual(notified, ["t1", "t2"]);
});

test("allerede claimet (boot-run) → holdet springes over", async () => {
  const r = await runSundayIntakeTick({
    supabase: makeMockSupabase({ teams: [{ id: "t1" }], claimAccepts: () => false }),
    now: SUNDAY,
    isEnabled: async () => true,
    seedCohortFn: async () => { throw new Error("må ikke kaldes"); },
    deriveRiders: async () => { throw new Error("må ikke kaldes"); },
    notify: async () => {},
  });
  assert.equal(r.teams, 0);
  assert.equal(r.candidates, 0);
});

test("seed-fejl på ét hold vælter ikke de andre", async () => {
  const r = await runSundayIntakeTick({
    supabase: makeMockSupabase({ teams: [{ id: "t1" }, { id: "t2" }] }),
    now: SUNDAY,
    isEnabled: async () => true,
    seedCohortFn: async (_s, o) => {
      if (o.teamId === "t1") throw new Error("boom");
      return ["t2-r1", "t2-r2"];
    },
    deriveRiders: async () => {},
    notify: async () => {},
  });
  assert.equal(r.teams, 1);
  assert.equal(r.candidates, 2);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /t1: boom/);
});

test("dato-helpers: 19/7-2026 er søndag i København", () => {
  assert.equal(isCopenhagenSunday(SUNDAY), true);
  assert.equal(isCopenhagenSunday(MONDAY), false);
  assert.equal(copenhagenDateString(SUNDAY), "2026-07-19");
});
```

NB: `fetchExistingFoldedRiderNames` bruger `fetchAllRows` — tjek `supabasePagination.js` for hvilken query-kæde mocken skal matche (`.order().range()` eller lignende) og justér riders-mock-grenen så den matcher. Kør testen og lad fejlbeskederne guide mock-formen.

- [ ] **Step 3: Kør tests — forvent PASS**

Run: `cd backend && node --test lib/sundayIntakeTick.test.js`

- [ ] **Step 4: Kør HELE backend-suiten** (regression på academyIntake/generator)

Run: `cd backend && npm test` (eller `node --test` som `scripts/verify-local.ps1` gør)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/sundayIntakeTick.js backend/lib/sundayIntakeTick.test.js
git commit -m "feat(academy): #2064 S0 - sundayIntakeTick: soendags-drip 2 kandidater/hold, claim-foerst idempotens"
```

---

### Task 5: Cron-wiring

**Files:**
- Modify: `backend/cron.js` (import øverst ved de andre lib-imports; handler + registrering ved intake-offer-expiry-blokken, linje ~736/~1160/~1199)

- [ ] **Step 1: Tilføj import + handler + registrering**

```js
import { runSundayIntakeTick } from "./lib/sundayIntakeTick.js";
```

Handler (placeres ved `runIntakeOfferExpirySweepCron`, ~linje 736):

```js
// ─── Sunday Intake Drip (#2064 S0) ───────────────────────────────────────────
// Søndags-drip af akademi-kandidater. Modulet er selv søndags-gated + claim-
// idempotent, så timelig polling + boot-run er sikre.
async function runSundayIntakeTickCron() {
  try {
    const r = await runSundayIntakeTick({ supabase, now: new Date() });
    if (r.ran && r.candidates > 0) {
      console.log(`🎓 Søndags-drip: ${r.candidates} akademi-kandidater til ${r.teams} hold (${r.tickDate})`);
    }
    if (r.errors?.length) {
      console.error(`Søndags-drip delfejl (${r.errors.length}):`, r.errors.join("; "));
      sentryCapture(new Error(`sunday-intake-drip partial failures: ${r.errors.join("; ")}`), {
        tags: { cron: "sunday intake drip" },
      });
    }
  } catch (err) {
    console.error("Cron error (sunday intake drip):", err.message);
    sentryCapture(err, { tags: { cron: "sunday intake drip" } });
  }
}
```

Registrering (ved de andre `setInterval`-linjer omkring ~1160, + boot-run ved ~1199 hvor intake-offer-expiry boot-kører):

```js
  setInterval(trackedTick("sunday-intake-drip", runSundayIntakeTickCron), 60 * 60 * 1000);
```

```js
  trackedTick("sunday-intake-drip", runSundayIntakeTickCron)(); // boot-run: claim-idempotent, søndags-gated
```

(Brug IKKE `monitorCron` — den forventer succes i hvert monitor-vindue, og dette tick er reelt kun aktivt om søndagen.)

- [ ] **Step 2: Syntaks-tjek**

Run: `cd backend && node --check cron.js`
Expected: ingen output (OK).

- [ ] **Step 3: Commit**

```bash
git add backend/cron.js
git commit -m "feat(academy): #2064 S0 - cron-wiring for soendags-drip (timelig tick + boot-run)"
```

---

### Task 6: i18n + patch notes + help

**Files:**
- Modify: `frontend/public/locales/en/backendMessages.json` + `frontend/public/locales/da/backendMessages.json`
- Modify: `frontend/public/locales/en/help.json` + `frontend/public/locales/da/help.json`
- Modify: `frontend/src/data/patchNotes.js`

- [ ] **Step 1: backendMessages — tilføj notif-nøgler** (find `academySigned`-nøglerne i begge filer og spejl NØJAGTIG samme nøgle-struktur for `academyDrip`)

EN: title `"New academy talent has arrived"`, message `"New candidates are waiting in your academy - sign or reject them."`
DA: title `"Nyt akademi-talent er ankommet"`, message `"Nye kandidater venter i dit akademi - signér eller afvis dem."`

- [ ] **Step 2: help.json — opdatér akademi-afsnittet** (find det eksisterende academy-afsnit; tilføj/justér så det dækker søndags-drippen)

EN: `"New academy candidates arrive every Sunday. Candidates you don't sign or reject expire after 7 days."`
DA: `"Nye akademi-kandidater ankommer hver søndag. Kandidater du hverken signerer eller afviser, udløber efter 7 dage."`

- [ ] **Step 3: patchNotes.js — ny entry øverst i PATCHES**

```js
  {
    "version": "7.28",
    "date": "2026-07-19",
    "label": "Beta",
    "changes": [
      {
        "category": "new",
        "audience": "player",
        "topic": "Academy",
        "en": {
          "title": "New academy candidates arrive every Sunday",
          "body": "Your academy now receives fresh candidates every Sunday. Sign the ones you believe in or reject them - unanswered offers expire after 7 days. This is the first step of the season-cohort model, where the final Sunday of each season becomes the big intake day."
        },
        "da": {
          "title": "Nye akademi-kandidater ankommer hver søndag",
          "body": "Dit akademi modtager nu friske kandidater hver søndag. Signér dem du tror på, eller afvis dem - ubesvarede tilbud udløber efter 7 dage. Det er første skridt i sæson-årgangsmodellen, hvor sæsonens sidste søndag bliver den store intake-dag."
        },
        "refs": [2064]
      }
    ]
  },
```

- [ ] **Step 4: Kør i18n-leak-check + patch-notes-version-check**

Run: `node scripts/i18n-check-leaks.mjs` og `node scripts/check-patch-notes-version.js`
Expected: begge grønne (ingen nye DA-leaks i EN-værdier; version 7.28 registreret).

- [ ] **Step 5: Commit**

```bash
git add frontend/public/locales frontend/src/data/patchNotes.js
git commit -m "feat(academy): #2064 S0 - i18n (notif + help) + patch note 7.28 for soendags-drip"
```

---

### Task 7: Fuld lokal verifikation

- [ ] **Step 1:** `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + frontend-build) — alt grønt
- [ ] **Step 2:** `cd frontend && npm run lint` — 0 fejl (CI-only ellers, #2044-lærdommen)
- [ ] **Step 3:** Commit evt. rettelser

---

### Task 8: PR

- [ ] **Step 1:** Push branch, opret PR mod main med PULL_REQUEST_TEMPLATE (inkl. **Brugerverifikation**-sektion: "Søndag: åbn akademi-siden → 2 nye kandidater under 'Tilbudt' + notifikation modtaget").
- [ ] **Step 2:** PR-body: Refs #2064; beskriv S0-scope (konservative defaults, kalibrering i S1), migrationen (additiv/idempotent), og at deploy på en søndag udløser dagens drip via boot-run.

---

### Task 9 (post-merge, hoved-checkout — IKKE subagent): apply + prod-verify

- [ ] **Step 1:** Efter ejer-merge: apply `database/2026-07-19-sunday-intake-drip.sql` via MCP (#2642-rammer) ELLER afvent auto-migrate (~3 min); verificér derefter read-only: `SELECT column_name FROM information_schema.columns WHERE table_name='riders' AND column_name='generation_tag'` + `SELECT count(*) FROM academy_intake_ticks`.
- [ ] **Step 2:** Efter Railway-deploy (boot-run): read-only verify: `SELECT count(*) FROM academy_intake WHERE created_at::date = current_date AND status='offered'` (forventet ≈ 2 × antal menneske-hold) + stikprøve på `riders.generation_tag='s1'` for dagens nye ryttere.
- [ ] **Step 3:** Kommentér verifikationen på #2064; opdatér NOW.md; luk #1799 som obsolete (funktionen fjernet med #2456 — henvis til triagen 26/6).
