# Race Hub — Fase 0b: proaktiv generator + afmeld-state Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afløs den reaktive "fyld ved afvikling"-autopick med en proaktiv assistent der ved sæsonstart/ny kalender genererer hele kalenderens trupper (binding-bevidst, idempotent), og giv hold mulighed for at afmelde sig et løb (frivillig deltagelse).

**Architecture:** Tre lag. (1) En migration tilføjer `race_withdrawals` + feature-flag. (2) Et afmeld-modul (service + endpoint) som generator og afvikling respekterer. (3) En generator-service (`raceEntryGenerator.js`) med en ren kronologisk, binding-bevidst tildelings-kerne (pure) + en tynd DB-orkestrator, hooket ind efter `materializeSeasonCalendar`. Generatoren bygger på Fase 0a's `raceBinding.js` og `raceAutopick.js`.

**Tech Stack:** Node.js (ESM), Supabase, `node:test`. Bygger oven på Fase 0a (branch `worktree-feat+race-hub-redesign`).

**Afgrænsning:** Manager-præferencer (a-kæde, faste roller, kaptajn 1/2/3, mål-løb) er IKKE med — generatoren bruger ren egnethed + friskhed + binding (= AI-hold-varianten). Præferencerne kobles på i Fase 2 (Lag 0 Holdstrategi). Bund-ryttere er Fase 0c. Generatoren er forward-looking: den rører ikke den allerede-kørende sæson 1 retroaktivt (kun ved næste sæsonstart/ny kalender, eller manuel admin-kørsel).

**Afhængighed:** Task 1 er en `database/*.sql`-migration → **ejeren merger PR'en** (auto-applies i prod). Fase 0a (PR #1808) bør være merged først, da 0b bygger på `raceBinding.js`.

---

### Task 1: Migration — `race_withdrawals` + feature-flag

**Files:**
- Create: `database/2026-06-23-race-withdrawals.sql`

- [ ] **Step 1: Skriv migrationen**

Opret `database/2026-06-23-race-withdrawals.sql`. Spejler RLS-mønstret fra `database/2026-06-07-race-engine-slice2.sql` (race_entries):

```sql
-- Race Hub Fase 0b: afmeld-state. Et hold kan trække sig fra et løb (frivillig
-- deltagelse). Generatoren + afviklingen springer afmeldte (race, team) over.

CREATE TABLE IF NOT EXISTS public.race_withdrawals (
  race_id          UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  withdrawn_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_reason TEXT,
  PRIMARY KEY (race_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_race_withdrawals_team ON public.race_withdrawals(team_id);

ALTER TABLE public.race_withdrawals ENABLE ROW LEVEL SECURITY;

-- Player-facing: alle authenticated kan læse (afmeldings-status vises i UI).
DROP POLICY IF EXISTS "race_withdrawals_select_authenticated" ON public.race_withdrawals;
CREATE POLICY "race_withdrawals_select_authenticated"
  ON public.race_withdrawals FOR SELECT TO authenticated USING (true);

-- Skrivning sker via service_role (backend-endpoint) — ingen direkte klient-write.
GRANT SELECT ON public.race_withdrawals TO authenticated;

COMMENT ON TABLE public.race_withdrawals IS
  'Race Hub Fase 0b: afmeld-tracking. (race_id, team_id) = holdet har trukket sig fra løbet.';

-- Feature-flag (fail-safe ON: generatoren er additiv; gammel fillMissingTeamEntries
-- bevares som fallback indtil flaget er bekræftet i prod).
INSERT INTO public.app_config (key, value)
VALUES ('auto_entry_generator_enabled', 'off')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Verificér SQL-syntaks mod en kopi (eller manuelt review)**

Kør (hvis lokal Postgres tilgængelig): `psql -f database/2026-06-23-race-withdrawals.sql` mod en wegkast-DB. Ellers: læs migrationen mod `2026-06-07-race-engine-slice2.sql` og bekræft samme mønster (CREATE TABLE IF NOT EXISTS, RLS-enable, policy, COMMENT). Bekræft `app_config`-skemaet matcher (key TEXT PK, value — tjek en eksisterende `INSERT INTO app_config` i `database/`).

Expected: konsistent med eksisterende migrations.

- [ ] **Step 3: Commit (push, men IKKE merge — ejeren merger migrations)**

```bash
git add database/2026-06-23-race-withdrawals.sql
git commit -m "feat(race): race_withdrawals-tabel + auto_entry_generator-flag (migration)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Afmeld-service (`raceWithdrawal.js`)

**Files:**
- Create: `backend/lib/raceWithdrawal.js`
- Test: `backend/lib/raceWithdrawal.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Opret `backend/lib/raceWithdrawal.test.js`. Mock-supabase følger `raceFatigue.test.js`-mønstret (thenable builder der husker tabel + op):

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { withdrawTeam, reinstateTeam, loadWithdrawnTeamIds } from "./raceWithdrawal.js";

function makeSupabase({ rows = [], upsertError = null, deleteError = null } = {}) {
  const calls = [];
  function from(table) {
    const f = {};
    const b = {
      select() { return b; },
      eq(c, v) { f[c] = v; return b; },
      upsert(r, opts) { calls.push({ table, op: "upsert", rows: r, opts }); return Promise.resolve({ error: upsertError }); },
      delete() { f.op = "delete"; return b; },
      then(resolve, reject) {
        if (f.op === "delete") { calls.push({ table, op: "delete", filters: { ...f } }); return Promise.resolve({ error: deleteError }).then(resolve, reject); }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from, __calls: calls };
}

test("withdrawTeam: upserter (race_id, team_id, reason)", async () => {
  const supabase = makeSupabase();
  await withdrawTeam({ supabase, raceId: "race1", teamId: "t1", reason: "budget" });
  const up = supabase.__calls.find((c) => c.op === "upsert");
  assert.equal(up.table, "race_withdrawals");
  assert.equal(up.rows.race_id, "race1");
  assert.equal(up.rows.team_id, "t1");
  assert.equal(up.rows.withdrawn_reason, "budget");
});

test("withdrawTeam: upsert-fejl kastes", async () => {
  const supabase = makeSupabase({ upsertError: { message: "rls denied" } });
  await assert.rejects(() => withdrawTeam({ supabase, raceId: "r", teamId: "t" }), /rls denied/);
});

test("reinstateTeam: sletter (race_id, team_id)-rækken", async () => {
  const supabase = makeSupabase();
  await reinstateTeam({ supabase, raceId: "race1", teamId: "t1" });
  const del = supabase.__calls.find((c) => c.op === "delete");
  assert.equal(del.table, "race_withdrawals");
  assert.equal(del.filters.race_id, "race1");
  assert.equal(del.filters.team_id, "t1");
});

test("loadWithdrawnTeamIds: returnerer Set af team_id for et løb", async () => {
  const supabase = makeSupabase({ rows: [{ team_id: "t1" }, { team_id: "t2" }] });
  const ids = await loadWithdrawnTeamIds({ supabase, raceId: "race1" });
  assert.ok(ids instanceof Set);
  assert.deepEqual([...ids].sort(), ["t1", "t2"]);
});
```

- [ ] **Step 2: Kør testen og verificér at den fejler**

Run: `cd backend && node --test lib/raceWithdrawal.test.js`
Expected: FAIL med "Cannot find module './raceWithdrawal.js'".

- [ ] **Step 3: Skriv `raceWithdrawal.js`**

```javascript
// backend/lib/raceWithdrawal.js
// Race Hub Fase 0b: afmelding fra løb (frivillig deltagelse). Et (race_id, team_id)
// i race_withdrawals = holdet deltager ikke. Generator + afvikling respekterer det.

export async function withdrawTeam({ supabase, raceId, teamId, reason = null }) {
  const { error } = await supabase
    .from("race_withdrawals")
    .upsert({ race_id: raceId, team_id: teamId, withdrawn_reason: reason }, { onConflict: "race_id,team_id" });
  if (error) throw new Error(`race_withdrawals upsert: ${error.message}`);
}

export async function reinstateTeam({ supabase, raceId, teamId }) {
  const { error } = await supabase
    .from("race_withdrawals").delete().eq("race_id", raceId).eq("team_id", teamId);
  if (error) throw new Error(`race_withdrawals delete: ${error.message}`);
}

// Set af team_id der har trukket sig fra et løb.
export async function loadWithdrawnTeamIds({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_withdrawals").select("team_id").eq("race_id", raceId);
  if (error) throw new Error(`race_withdrawals select: ${error.message}`);
  return new Set((data || []).map((r) => r.team_id));
}
```

- [ ] **Step 4: Kør testen og verificér at den passer**

Run: `cd backend && node --test lib/raceWithdrawal.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceWithdrawal.js backend/lib/raceWithdrawal.test.js
git commit -m "feat(race): afmeld-service (withdraw/reinstate/loadWithdrawn)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Afmeld respekteres i autofill ved afvikling

**Files:**
- Modify: `backend/lib/raceRunner.js` (`fillMissingTeamEntries`, ~linje 324-342)

- [ ] **Step 1: Skriv en fejlende test**

Tilføj i `backend/lib/raceRunnerAutofill.test.js` en test der sætter et hold som afmeldt og verificerer at det IKKE autofyldes. Brug den eksisterende `baseState()` + `makeSupabase`; tilføj `race_withdrawals` til mock-state:

```javascript
test("afmeldt hold autofyldes IKKE", async () => {
  const state = baseState();
  state.race_withdrawals = [{ race_id: "race1", team_id: "t2" }];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  assert.equal(entrants.filter((e) => e.team_id === "t2").length, 0, "t2 er afmeldt → ingen entries");
  assert.ok(entrants.filter((e) => e.team_id === "t1").length > 0, "t1 fyldes stadig");
});
```

(Bemærk: `makeSupabase` i den fil understøtter allerede vilkårlige tabeller via `state[table]` — `race_withdrawals` virker uden ændring af mocken.)

- [ ] **Step 2: Kør testen og verificér at den fejler**

Run: `cd backend && node --test lib/raceRunnerAutofill.test.js`
Expected: FAIL — t2 fyldes stadig (afmelding ignoreres i dag).

- [ ] **Step 3: Filtrér afmeldte hold fra i `fillMissingTeamEntries`**

I `backend/lib/raceRunner.js`, importér afmeld-loaderen øverst (ved de andre lib-imports):

```javascript
import { loadWithdrawnTeamIds } from "./raceWithdrawal.js";
```

I `fillMissingTeamEntries`, efter `teamsWithEntries`-sættet er bygget (~linje 330) og før `eligibleTeams`-filteret, hent afmeldte og udvid filteret:

```javascript
  const teamsWithEntries = new Set((existingEntries || []).map((e) => e.team_id));
  const withdrawnTeams = await loadWithdrawnTeamIds({ supabase, raceId: race.id });

  // ... (pulje-filter-kommentaren uændret) ...
  let eligibleTeams = (teams || []).filter(
    (t) => !t.is_frozen && !teamsWithEntries.has(t.id) && !withdrawnTeams.has(t.id)
  );
```

- [ ] **Step 4: Kør testen og verificér at den passer**

Run: `cd backend && node --test lib/raceRunnerAutofill.test.js`
Expected: PASS (alle tests inkl. den nye; ingen regression).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/raceRunnerAutofill.test.js
git commit -m "feat(race): afvikling springer afmeldte hold over (autofill)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Generator-kerne — kronologisk binding-bevidst tildeling (pure)

**Files:**
- Create: `backend/lib/raceEntryGenerator.js` (pure kerne i denne task)
- Test: `backend/lib/raceEntryGenerator.test.js`

**Algoritme (deterministisk):** Givet en pulje af løb (hver med tidsvindue + sizeRule) i kronologisk rækkefølge, og et holds ryttere: iterér løbene efter vindue-start; for hvert løb, find rytterne der IKKE er optaget i et overlappende, allerede-tildelt vindue, autopick blandt dem, og markér de valgte som optaget i dette løbs vindue. Respekterer binding på tværs af hele kalenderen.

- [ ] **Step 1: Skriv de fejlende tests**

Opret `backend/lib/raceEntryGenerator.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { assignTeamAcrossRaces } from "./raceEntryGenerator.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const flat = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
// 10 ryttere
const riders = Array.from({ length: 10 }, (_, i) => ({ rider_id: `r${i}`, abilities: ab(80 - i * 3), fatigue: 0 }));

test("assignTeamAcrossRaces: to ikke-overlappende løb kan dele samme ryttere", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 300, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const out = assignTeamAcrossRaces({ riders, races });
  assert.equal(out.A.length, 6);
  assert.equal(out.B.length, 6);
  // Ikke-overlappende → samme stærke ryttere kan gå igen
  assert.ok(out.A.some((e) => out.B.find((b) => b.rider_id === e.rider_id)), "delt rytter tilladt");
});

test("assignTeamAcrossRaces: overlappende løb deler ALDRIG en rytter", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 250 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 200, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } }, // overlapper A
  ];
  const out = assignTeamAcrossRaces({ riders, races });
  const aIds = new Set(out.A.map((e) => e.rider_id));
  for (const e of out.B) assert.ok(!aIds.has(e.rider_id), `${e.rider_id} dobbeltbooket`);
});

test("assignTeamAcrossRaces: for få ledige ryttere → mindre felt (ingen crash)", () => {
  const fewRiders = riders.slice(0, 8); // kun 8
  const races = [
    { race_id: "A", window: { start: 100, end: 250 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 200, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const out = assignTeamAcrossRaces({ riders: fewRiders, races });
  assert.equal(out.A.length, 6);          // A får sine 6 først (tidligst vindue)
  assert.equal(out.B.length, 2);          // kun 2 tilbage til B
});

test("assignTeamAcrossRaces: hvert pick har en kaptajn-rolle", () => {
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } }];
  const out = assignTeamAcrossRaces({ riders, races });
  assert.equal(out.A.filter((e) => e.race_role === "captain").length, 1);
});
```

- [ ] **Step 2: Kør testen og verificér at den fejler**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js`
Expected: FAIL med "Cannot find module './raceEntryGenerator.js'".

- [ ] **Step 3: Skriv generator-kernen**

Opret `backend/lib/raceEntryGenerator.js`:

```javascript
// backend/lib/raceEntryGenerator.js
// Race Hub Fase 0b: proaktiv entry-generator. Kerne = kronologisk binding-bevidst
// tildeling: ét holds ryttere fordeles over puljens løb, så ingen rytter er i to
// tidsoverlappende løb. Deterministisk (autopick er deterministisk; løb sorteres
// stabilt på vindue-start, så rider_id). Pure — ingen DB.

import { autopickTeamSelection } from "./raceAutopick.js";
import { windowsOverlap } from "./raceBinding.js";

/**
 * @param {{ riders: Array<{rider_id, abilities, fatigue?}>,
 *           races: Array<{race_id, window:{start,end}, stages, sizeRule}> }} args
 * @returns {Record<string, Array<{rider_id, race_role}>>} entries pr. race_id
 */
export function assignTeamAcrossRaces({ riders = [], races = [] }) {
  // Kronologisk, stabil rækkefølge: tidligste vindue først, så race_id.
  const ordered = [...races].sort(
    (a, b) => (a.window?.start ?? 0) - (b.window?.start ?? 0) || String(a.race_id).localeCompare(String(b.race_id))
  );
  // Optaget-liste pr. rytter: array af vinduer rytteren allerede er bundet i.
  const busy = new Map(); // rider_id → [{start,end}]
  const out = {};

  for (const race of ordered) {
    const available = riders.filter((r) => {
      const windows = busy.get(r.rider_id) || [];
      return !windows.some((w) => windowsOverlap(w, race.window));
    });
    const picks = autopickTeamSelection({ riders: available, stages: race.stages, sizeRule: race.sizeRule });
    out[race.race_id] = picks;
    for (const p of picks) {
      if (!busy.has(p.rider_id)) busy.set(p.rider_id, []);
      busy.get(p.rider_id).push(race.window);
    }
  }
  return out;
}
```

- [ ] **Step 4: Kør testen og verificér at den passer**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceEntryGenerator.js backend/lib/raceEntryGenerator.test.js
git commit -m "feat(race): generator-kerne — kronologisk binding-bevidst tildeling" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Generator DB-orkestrator + idempotens

**Files:**
- Modify: `backend/lib/raceEntryGenerator.js` (tilføj orkestrator)
- Test: `backend/lib/raceEntryGenerator.test.js` (tilføj mock-DB-tests)

**Orkestrator-ansvar:** For en sæson: hent puljer + løb (med tidsvinduer fra `race_stage_schedule`) + per-pulje hold (ekskl. afmeldte + hold med manuelle entries) + holdets ryttere/abilities, kald `assignTeamAcrossRaces` pr. hold, og skriv idempotent (slet `is_auto_filled=true` for de berørte løb, indsæt nye). Genbruger `loadWithdrawnTeamIds`. Manuelle entries (`is_auto_filled=false`) røres aldrig.

- [ ] **Step 1: Skriv den fejlende mock-DB-test**

Tilføj i `raceEntryGenerator.test.js` import + en test der verificerer idempotens (manuelle entries bevares; auto-filled slettes+gendannes). Følg den thenable-mock-stil fra `raceRunnerAutofill.test.js` (state pr. tabel, eq/in-filtre, insert/delete opsamles). Skriv mindst:

```javascript
import { runRaceEntryGenerator } from "./raceEntryGenerator.js";
// ... (mock-supabase med state: seasons, races, race_stage_schedule, teams, riders,
//      rider_derived_abilities, race_entries, race_withdrawals) ...

test("runRaceEntryGenerator: idempotent — manuelle entries bevares, auto-filled regenereres", async () => {
  // state med: 1 pulje, 2 løb (overlappende), 1 hold med 8 ryttere+abilities,
  //            1 manuel entry (is_auto_filled=false) på løb A.
  // Kør generator (dryRun=false). Assert:
  //  - den manuelle entry findes stadig (uændret)
  //  - løb B fik auto-filled entries der ikke deler rytter med løb A's vindue
  //  - gentag kørsel → samme resultat (deterministisk)
});

test("runRaceEntryGenerator: afmeldte hold får ingen entries", async () => {
  // state med 2 hold, 1 afmeldt. Assert kun det ikke-afmeldte hold får entries.
});

test("runRaceEntryGenerator: dryRun=true skriver intet", async () => {
  // Assert ingen insert/delete-kald i __calls; returnerer preview-tal.
});
```

(De fulde mock-state-objekter konstrueres i testen efter samme mønster som `raceRunnerAutofill.test.js:44-64`; controlleren giver implementeren det mønster.)

- [ ] **Step 2: Kør testen og verificér at den fejler**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js`
Expected: FAIL — `runRaceEntryGenerator` findes ikke.

- [ ] **Step 3: Skriv orkestratoren**

Tilføj `runRaceEntryGenerator` til `raceEntryGenerator.js`. Den skal:
1. Hente sæsonens løb (`races` join `race_stage_schedule` for vinduer; `race_stage_profiles` for stages; `selectionSizeForRace` for sizeRule).
2. Gruppere løb pr. `league_division_id` (pulje).
3. Pr. pulje: hente holdene (ikke-frosne, ikke-test), per hold hente afmeldte løb (`loadWithdrawnTeamIds`) + manuelle entries (is_auto_filled=false) + ryttere+abilities+fatigue.
4. For hvert hold: byg `races`-listen (ekskl. afmeldte + løb med manuelle entries for det hold), kald `assignTeamAcrossRaces`.
5. Idempotent skriv (kun ved `!dryRun`): per løb, slet `race_entries WHERE is_auto_filled=true AND race_id=? AND team_id=?`, indsæt nye med `is_auto_filled=true`.
6. Returnér `{ dryRun, races, teams, generated, skipped }`.

Implementeren følger I/O-mønstret fra `fillMissingTeamEntries` (raceRunner.js:324-424) for chunked `.in()`-opslag (`selectInChunks`) og `loadStageProfiles`. Genbrug `assignTeamAcrossRaces` (Task 4) til den rene tildeling.

(Controlleren forsyner implementeren med de præcise uddrag fra `raceRunner.js` ved dispatch — selectInChunks (284-295), loadStageProfiles (297-305), abilities/condition-load (388-402).)

- [ ] **Step 4: Kør testen og verificér at den passer**

Run: `cd backend && node --test lib/raceEntryGenerator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceEntryGenerator.js backend/lib/raceEntryGenerator.test.js
git commit -m "feat(race): generator DB-orkestrator (idempotent, afmeld-bevidst)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Hook generator efter kalender-materialisering + admin-trigger

**Files:**
- Modify: `backend/lib/seasonTransition.js` (`season_calendar`-fasen, ~linje 653-664)
- Modify: `backend/routes/api.js` (nyt admin-endpoint)
- Create: `backend/lib/autoEntryGeneratorFlag.js` (flag-loader, spejler `stageSchedulerFlag.js`)

- [ ] **Step 1: Flag-loader (spejl eksisterende mønster)**

Opret `backend/lib/autoEntryGeneratorFlag.js` magen til `backend/lib/stageSchedulerFlag.js` (læs `app_config.auto_entry_generator_enabled`, default off). Kopiér mønstret 1:1 med ny key.

- [ ] **Step 2: Wire ind i `transitionToNextSeason`**

I `season_calendar`-fasen i `seasonTransition.js` (efter `materializeSeasonCalendar` returnerer, hvis `auto_calendar_enabled`): kald `runRaceEntryGenerator({ supabase, seasonId: plan.to_season.id, dryRun: false })` bag `isAutoEntryGeneratorEnabled`-flaget. Fejl må ikke vælte transitionen (try/catch + log, mirror de andre additive trin).

- [ ] **Step 3: Admin-endpoint for manuel kørsel (preview + apply)**

Tilføj i `api.js` en admin-rute `POST /admin/seasons/:id/generate-entries` med `?dryRun=true|false` der kalder `runRaceEntryGenerator`. Følg auth/admin-guard-mønstret fra de øvrige `/admin/seasons/:id/*`-ruter (api.js:4576+).

- [ ] **Step 4: Verificér load + syntaks**

Run: `cd backend && node --check routes/api.js && node --check lib/seasonTransition.js && node --check lib/autoEntryGeneratorFlag.js`
Expected: rent.

Run: `cd backend && node --test`
Expected: hele suiten grøn (ingen regression).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/autoEntryGeneratorFlag.js backend/lib/seasonTransition.js backend/routes/api.js
git commit -m "feat(race): hook generator i sæson-transition + admin-trigger (flag-gated)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Verify-local + push

- [ ] **Step 1: Fuld lokal gate**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend + frontend tests + build grønne.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: PR-note**

PR'en indeholder `database/2026-06-23-race-withdrawals.sql` → **ejeren merger** (migration auto-applies i prod). PR-body skal have backend-only label + en note om migrationen og at generatoren er flag-gated (`auto_entry_generator_enabled=off` indtil bekræftet). Bemærk for senere: bund-ryttere (Fase 0c) gør at flere overlappende løb kan fyldes; manager-præferencer (Fase 2) gør generatoren personlig.

---

## Self-Review

**Spec-coverage (mod 2026-06-23-race-hub-redesign-design.md):**
- Beslutning 2 (frivillig deltagelse + afmelding) → Task 1-3. ✓
- Beslutning 4 (proaktiv assistent ved sæsonstart/ny kalender) → Task 4-6. ✓
- Mekanik-ændring 1 (autopick binding-side, generator) → Task 4-5. ✓
- Mekanik-ændring 2 (afløs tvungen fillMissingTeamEntries) → Task 3 (afmeld) + Task 6 (generator kører før afvikling; fillMissingTeamEntries bliver fallback). ✓
- Mekanik-ændring 3 (deltag/afmeld-state) → Task 1-2. ✓
- AI-hold = samme generator (ejer-besluttet) → generatoren skelner ikke AI/manager (Task 4-5). ✓
- Manager-præferencer → bevidst UDE (Fase 2). Idempotens beskytter manuelle entries, så Fase 2 kan bygge ovenpå. ✓

**Placeholder-scan:** Task 5 Step 1+3 beskriver mock-state/orkestrator-trin frem for at gentage 60+ linjers mock-opsætning — controlleren forsyner implementeren med de præcise uddrag (refereret med fil:linje). Det er en bevidst delegering, ikke en TBD; al adfærd + assertions er specificeret. Alle andre tasks har fuld kode.

**Type-konsistens:** `window:{start,end}` (epoch-ms) konsistent med Fase 0a's `raceBinding.js`. `assignTeamAcrossRaces` returnerer `Record<race_id, [{rider_id, race_role}]>`, matcher `autopickTeamSelection`-outputtet. `loadWithdrawnTeamIds` → `Set<team_id>` brugt konsistent i Task 3 + Task 5.

**Note:** Task 5 er den tungeste (DB-orkestrator) — hvis en implementer-subagent rapporterer BLOCKED, så split i 5a (load) + 5b (skriv) ved dispatch.
