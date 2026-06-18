# Akademi-promotion-flow ved 22 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luk akademi-blindgyden: når en akademirytter passerer 21 ved sæson-skift, sættes rytteren i en pending-graduerings-tilstand hvor holdet vælger promover/sælg/slip inden for et override-vindue; handler spilleren ikke, auto-resolverer en daglig sweep via en soft default-kæde (promover → sælg → slip).

**Architecture:** En ny `academy_graduation`-join-tabel (spejler `academy_intake`) holder pending graduates med `status` + `deadline`. Detektion sker i season-transition (`developRidersForSeason`) hvor aldring allerede beregnes via `ageForSeason`. En resolution-service (`academyPromotion.js`) udfører de tre udfald; en sweep (`academyGraduationSweep.js`, samme mønster som `trainingSweep.js`) kører default-kæden ved deadline-udløb. Salg genbruger den eksisterende auktions-listing; auktions-finalization udvides med en graduate-gren (vinder → senior, ingen bud → free agent). Alt gated på `academy_enabled`.

**Tech Stack:** Node.js/Express (backend), Supabase/Postgres (DB; `apply_migration` mod disposabel branch — ALDRIG prod), React+Vite (frontend), `node --test` (backend+frontend unit-tests), i18n namespace-JSON (en+da), determinisme via `ageForSeason` (sæson-diskret, ikke seeded).

---

## Locked decisions (ejer, 2026-06-18)

Fra design-spec'en `docs/superpowers/specs/2026-06-18-academy-promotion-flow-design.md`:

1. **Default = soft default + override.** Pending-tilstand + notifikation + deadline-vindue; auto-resolution via default-kæde hvis ingen handling.
2. **Sælg → normalt marked** (`auctions.is_youth=false`, `seller_team_id`=holdet). Andre managers kan byde.
3. **Promover-løn = ny senior-løn** via standard-formlen (`computeFrozenSalary`), IKKE den arvede akademi-løn.
4. **Fuld model** — alle tre udfald + default-kæde + graduerings-UI.

## Seams (verificeret 2026-06-18, fil:linje)

- Aldring: `backend/lib/riderProgressionEngine.js:30-35` `ageForSeason(birthdate, seasonNumber)` (LAUNCH_REFERENCE_YEAR=2026); hovedløkke `developRidersForSeason()` linje ~68-241; `skipGrowth`-guard linje 163.
- Sign-mønster: `backend/lib/academyIntake.js` `signAcademyCandidate` (~170-247), `getTeamAcademyCount` (~23-31), `incrementBalanceWithAudit`-brug, `notifyTeamOwner`-brug.
- Kontrakt/løn: `backend/lib/contractSeed.js` `CONTRACT` (DEFAULT_ACQUIRE_LENGTH=2, SALARY_RATE=0.067), `computeFrozenSalary(rider)`, `computeContractEndSeason(seasonNumber, length)`.
- Markedsværdi: `backend/lib/marketUtils.js:84-100` `calculateRiderMarketValue`; senior-cap `getTeamMarketState` (~114-186) returnerer `rider_count`, `future_count`, `squad_limits` (division-baseret via `getSquadLimits`).
- Auktion-oprettelse: `backend/routes/api.js` POST `/auctions` (~1334-1559) — insert i `auctions` med `seller_team_id`, `starting_price`, `current_price`, `calculated_end`, `is_flash`, `is_youth`(default false).
- Auktions-finalization: `backend/lib/auctionFinalization.js` (har allerede `is_youth`-gren fra #1308 Fase B).
- Sweep-mønster: `backend/lib/trainingSweep.js` (`SWEEP_FROM_HOUR=22`, `shouldSweepNow`, hold-filter, idempotens); cron-registrering i `backend/cron.js`.
- Akademi-rute-mønster: `backend/routes/api.js` POST `/academy/sign` (~8216-8250) — `requireAuth`, `req.team`, `isAcademyEnabled`, fejl-format. GET `/academy/me`.
- Migration-mønster: `database/2026-06-13-academy-mvp.sql` (academy_intake-tabel + RLS; notifications/finance type-CHECK).
- Flag: `backend/lib/academyFlag.js` `isAcademyEnabled(supabase, {isBetaTester})`.

## File Structure

**Created:**
- `database/2026-06-18-academy-graduation.sql` — `academy_graduation`-tabel + RLS + notification-typer (`academy_graduation_ready`, `academy_graduated`). EJEREN merger.
- `backend/lib/academyGraduation.js` — konstanter (`GRADUATION`) + `isGraduateAge` + `detectGraduates` + `resolveGraduation` (promote/sell/release) + `defaultResolveGraduate`. + `academyGraduation.test.js`.
- `backend/lib/academyGraduationSweep.js` — `runAcademyGraduationSweep` (deadline-udløb → default-kæde). + `academyGraduationSweep.test.js`.

**Modified:**
- `database/schema.sql` — afspejl `academy_graduation` + type-CHECK-kommentarer.
- `backend/lib/riderProgressionEngine.js` — kald `detectGraduates` i `developRidersForSeason` (efter aldring, DI-injiceret).
- `backend/lib/auctionFinalization.js` — graduate-salgs-gren (vinder → `is_academy=false`; ingen bud → free agent + graduation `expired`).
- `backend/routes/api.js` — `POST /api/academy/graduate` (`{ riderId, action }`); udvid `GET /api/academy/me` med `graduations`.
- `backend/cron.js` — registrér `runAcademyGraduationSweep` i main-loop.
- `frontend/src/pages/AcademyPage.jsx` + `frontend/src/lib/useAcademy.js` — graduerings-sektion + actions.
- `frontend/public/locales/{en,da}/academy.json`, `help.json`, `PatchNotesPage.jsx`, `docs/FEATURE_STATUS.md`.

---

## Task 1: DB-migration — academy_graduation-skema (EJEREN merger)

**Files:**
- Create: `database/2026-06-18-academy-graduation.sql`
- Modify: `database/schema.sql`

> ⚠️ `database/*.sql` → **EJEREN merger PR'en** (migration auto-applies i prod). Ingen auto-merge. Verificér FØRST mod disposabel Supabase-branch.

- [ ] **Step 1: Skriv migrationen**

Create `database/2026-06-18-academy-graduation.sql`:

```sql
-- #932 akademi-promotion-flow ved 22: pending-graduerings-tabel + notification-typer.
-- Beslutninger (ejer 18/6): soft default + override; sælg på normalt marked;
-- promover via ny senior-løn. Spec: docs/superpowers/specs/2026-06-18-academy-promotion-flow-design.md

BEGIN;

-- 1. academy_graduation: pending graduates (akademiryttere der har passeret 21).
CREATE TABLE IF NOT EXISTS academy_graduation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','promoted','sold','released','expired')),
  deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (rider_id, season_id)
);
COMMENT ON TABLE academy_graduation IS
  'Akademi-graduering (#932): akademiryttere der har passeret 21 og afventer '
  'promover/sælg/slip. status pending→promoted/sold/released/expired. '
  'Mens pending: rytteren beholder is_academy=true (uden for senior-cap).';
CREATE INDEX IF NOT EXISTS idx_academy_graduation_team_status
  ON academy_graduation(team_id, status);

ALTER TABLE academy_graduation ENABLE ROW LEVEL SECURITY;
-- Hold-ejeren læser eget; skrivning sker service-role (backend).
CREATE POLICY academy_graduation_owner_read ON academy_graduation
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

COMMIT;

-- 2. Notification-typer: HENT NUVÆRENDE def fra DB og tilføj graduerings-typer.
--    (Constraint ALTER'es flere gange — seneste vinder. Gæt ikke fra historik.)
--    Kør FØRST queryen i Step 3, indsæt så den fulde liste + nye typer:
--      + 'academy_graduation_ready'  (kuld af graduates klar til håndtering)
--      + 'academy_graduated'         (en graduate er resolveret: promoveret/solgt/sluppet)
-- ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
-- ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
--   CHECK (type IN (<CURRENT_NOTIF_TYPES>, 'academy_graduation_ready','academy_graduated'));
```

- [ ] **Step 2: Afspejl i schema.sql**

Tilføj `academy_graduation`-tabel-definitionen (kopiér fra migrationen) til `database/schema.sql` i nærheden af `academy_intake`-blokken, og opdatér notifications-type-CHECK-kommentaren med de to nye typer.

- [ ] **Step 3: Verificér mod disposabel Supabase-branch (ALDRIG prod)**

Opret en branch (Supabase MCP `create_branch`). Hent FØRST den nuværende notification-constraint:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='notifications_type_check';
```

Indsæt den fulde liste i migrationens Step-2-blok (afkommentér), kør hele migrationen via `apply_migration`. Verificér:

```sql
SELECT relrowsecurity FROM pg_class WHERE relname='academy_graduation';  -- forventet: t
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='academy_graduation_status_check';
-- forventet: indeholder 'pending','promoted','sold','released','expired'
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='notifications_type_check';
-- forventet: indeholder 'academy_graduation_ready','academy_graduated'
```

Expected: alle grønne. Ryd branchen op (`delete_branch`).

- [ ] **Step 4: Commit**

```bash
git add database/2026-06-18-academy-graduation.sql database/schema.sql
git commit -F .git/COMMIT_EDITMSG_GRAD_1
```
Besked:
```
feat(db): academy_graduation-tabel + notification-typer (#932)

Pending-graduerings-tabel (status pending/promoted/sold/released/expired
+ deadline) + RLS owner-read. Nye notification-typer academy_graduation_ready
+ academy_graduated. Migration auto-applies i prod ved merge — EJEREN merger.

Refs #932
```

---

## Task 2: Konstanter + alders-helper (pure) + tests

**Files:**
- Create: `backend/lib/academyGraduation.js` (kun konstanter + `isGraduateAge` i denne task), `backend/lib/academyGraduation.test.js`

- [ ] **Step 1: Skriv den fejlende test**

Create `backend/lib/academyGraduation.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { GRADUATION, isGraduateAge } from "./academyGraduation.js";

test("GRADUATION-konstanter", () => {
  assert.equal(GRADUATION.GRADUATE_AGE, 22);
  assert.ok(GRADUATION.DEADLINE_DAYS >= 1, "override-vindue mindst 1 dag");
});

test("isGraduateAge: 22+ er graduate, 21 og under er ikke", () => {
  assert.equal(isGraduateAge(21), false);
  assert.equal(isGraduateAge(22), true);
  assert.equal(isGraduateAge(25), true);
  assert.equal(isGraduateAge(null), false);
});
```

- [ ] **Step 2: Kør → fejl**

Run: `node --test backend/lib/academyGraduation.test.js`
Expected: FAIL — "Cannot find module './academyGraduation.js'".

- [ ] **Step 3: Implementér**

Create `backend/lib/academyGraduation.js` (kun toppen i denne task — funktionerne tilføjes i Task 3-5):

```js
// Akademi-promotion-flow ved 22 (#932). Akademiryttere der passerer 21 ved
// sæson-skift sættes i pending-graduering; holdet vælger promover/sælg/slip i et
// override-vindue, ellers auto-resolverer sweepet via default-kæden.
// DEADLINE_DAYS kalibreres + ejer-godkendes før relaunch-relevans (sim, Task 9).

export const GRADUATION = Object.freeze({
  GRADUATE_AGE: 22,     // alder hvor akademi-ophold slutter (MAX_AGE 21 + 1)
  DEADLINE_DAYS: 7,     // override-vindue i dage. SIM-STARTPUNKT — ejer-godkendes.
});

export function isGraduateAge(age) {
  return Number.isFinite(age) && age >= GRADUATION.GRADUATE_AGE;
}
```

- [ ] **Step 4: Kør → pass**

Run: `node --test backend/lib/academyGraduation.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/academyGraduation.js backend/lib/academyGraduation.test.js
git commit -F .git/COMMIT_EDITMSG_GRAD_2
```
Besked: `feat(academy): graduerings-konstanter + alders-helper (pure) (#932)`

---

## Task 3: Detektion — opret pending-rows ved sæson-skift + tests

**Files:**
- Modify: `backend/lib/academyGraduation.js` (tilføj `detectGraduates`)
- Modify: `backend/lib/riderProgressionEngine.js` (kald `detectGraduates`, DI)
- Test: `backend/lib/academyGraduation.test.js`

- [ ] **Step 1: Skriv den fejlende test**

Tilføj til `backend/lib/academyGraduation.test.js` (mock-supabase i stilen fra `academyIntake.test.js`):

```js
import { detectGraduates } from "./academyGraduation.js";

test("detectGraduates: opretter pending-row for akademirytter der fylder 22", async () => {
  // arranger: 1 akademirytter (is_academy=true) birthdate => age 22 i seasonNumber;
  //           1 akademirytter age 19 (skal IKKE detekteres); ingen eksisterende grad-rows
  // assert: ét insert i academy_graduation status='pending' for 22-årigen + deadline sat;
  //         notifikation 'academy_graduation_ready' til holdet
});

test("detectGraduates: idempotent — rytter med eksisterende grad-row for sæsonen skippes", async () => {
  // arranger: 22-årig har allerede academy_graduation-row for season_id
  // assert: ingen nye inserts
});

test("detectGraduates (dryRun): tæller uden writes", async () => {
  // assert: res.dryRun === true, res.graduates === N, ingen insert-kald
});
```

- [ ] **Step 2: Kør → fejl**

Run: `node --test backend/lib/academyGraduation.test.js`
Expected: FAIL — `detectGraduates is not a function`.

- [ ] **Step 3: Implementér `detectGraduates`**

Tilføj til `backend/lib/academyGraduation.js`. Genbrug `ageForSeason` fra `riderProgressionEngine.js` og `notifyTeamOwner`-mønsteret (find import-sti via grep i `academyIntake.js`):

```js
import { ageForSeason } from "./riderProgressionEngine.js";
import { fetchAllRows } from "./supabasePagination.js";
import { notifyTeamOwner } from "./notify.js"; // EKSEKUTOR: verificér sti via grep i academyIntake.js

// Opret pending-graduerings-rows for akademiryttere der har passeret 21 i den
// aktive sæson. Idempotent: rytter med eksisterende grad-row for season skippes.
// deadline = now + GRADUATION.DEADLINE_DAYS dage. Kaldes i season-transition.
export async function detectGraduates(supabase, { seasonId, seasonNumber, now = new Date(), dryRun = false } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const academy = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, firstname, lastname, birthdate")
      .eq("is_academy", true).eq("is_retired", false).order("id"));

  const existing = await fetchAllRows(() =>
    supabase.from("academy_graduation").select("rider_id").eq("season_id", seasonId));
  const alreadyRowed = new Set(existing.map((r) => r.rider_id));

  const deadline = new Date(now.getTime() + GRADUATION.DEADLINE_DAYS * 86400_000).toISOString();
  let created = 0;
  for (const r of academy) {
    if (alreadyRowed.has(r.id)) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (!isGraduateAge(age)) continue;
    if (dryRun) { created++; continue; }
    const { error } = await supabase.from("academy_graduation").insert({
      team_id: r.team_id, rider_id: r.id, season_id: seasonId, status: "pending", deadline,
    });
    if (error) throw new Error(`detectGraduates insert (${r.id}): ${error.message}`);
    await notifyTeamOwner({
      supabase, teamId: r.team_id, type: "academy_graduation_ready", relatedId: r.id,
      title: "Academy graduation", message: `${r.firstname} ${r.lastname} has aged out of your academy. Promote, sell or release before the deadline.`,
      metadata: { titleCode: "notif.academyGraduationReady.title", messageCode: "notif.academyGraduationReady.message", titleParams: { name: `${r.firstname} ${r.lastname}` } },
    });
    created++;
  }
  return { dryRun, graduates: created };
}
```

> **Eksekutor:** verificér `notifyTeamOwner`-import-stien (grep i `academyIntake.js`). Bekræft `fetchAllRows`-signaturen (samme som i `academyIntake.js`). `ageForSeason` er allerede eksporteret fra `riderProgressionEngine.js:30`.

- [ ] **Step 4: Kør → pass**

Run: `node --test backend/lib/academyGraduation.test.js`
Expected: PASS.

- [ ] **Step 5: Wire ind i season-transition**

I `backend/lib/riderProgressionEngine.js`, i `developRidersForSeason` EFTER aldrings-/retirement-fasen (efter løkken der kalder `developRiderSeason`), tilføj et gated detektions-trin. Tilføj `detectGraduatesFn = detectGraduates` til funktions-parametrene (DI), og:

```js
// Akademi-graduering: detektér akademiryttere der har passeret 21 → pending-valg.
// Gated på academy_enabled (no-op uden akademi). Import øverst:
//   import { isAcademyEnabled } from "./academyFlag.js";
//   import { detectGraduates } from "./academyGraduation.js";
if (await isAcademyEnabled(supabase)) {
  await detectGraduatesFn(supabase, { seasonId, seasonNumber, now });
}
```

> **Eksekutor:** undgå cirkulær import — `academyGraduation.js` importerer `ageForSeason` fra `riderProgressionEngine.js`, og engine importerer `detectGraduates`. Hvis Node's ESM klager over cyklus, flyt `ageForSeason` til en lille delt helper (`backend/lib/riderAge.js`) og importér derfra begge steder. Verificér med `node --check`.

- [ ] **Step 6: Kør progression-tests**

Run: `node --test backend/lib/riderProgressionEngine.test.js backend/lib/academyGraduation.test.js`
Expected: PASS (uændret eksisterende adfærd + nye).

- [ ] **Step 7: Commit**

```bash
git add backend/lib/academyGraduation.js backend/lib/academyGraduation.test.js backend/lib/riderProgressionEngine.js
git commit -F .git/COMMIT_EDITMSG_GRAD_3
```
Besked: `feat(academy): detektér graduates i season-transition (pending-rows) (#932)`

---

## Task 4: Resolution-service — promover/sælg/slip + tests

**Files:**
- Modify: `backend/lib/academyGraduation.js` (tilføj `resolveGraduation`)
- Test: `backend/lib/academyGraduation.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Tilføj til `backend/lib/academyGraduation.test.js`:

```js
import { resolveGraduation } from "./academyGraduation.js";

test("resolveGraduation promote: is_academy=false + NY senior-løn + grad status promoted", async () => {
  // arranger: pending grad-row; hold under senior-cap; rytter med base_value
  // assert: rider-update { is_academy:false, salary: computeFrozenSalary(rider), contract_length:2,
  //         contract_end_season }; grad.status='promoted', resolved_at sat; notif 'academy_graduated'
});

test("resolveGraduation promote: afviser ved fuld senior-trup (squad_cap)", async () => {
  // arranger: future_count === squad_limit
  // assert: throw 'squad_cap_violation'; ingen rider-update
});

test("resolveGraduation sell: opretter auktion (seller=hold, is_youth=false); rytter forbliver is_academy=true; grad status sold", async () => {
  // assert: auctions-insert seller_team_id=hold, is_youth=false; ingen is_academy-ændring endnu;
  //         grad.status='sold'
});

test("resolveGraduation release: team_id=NULL, is_academy=false, grad status released", async () => {
  // assert: rider-update { team_id:null, is_academy:false }; grad.status='released'
});

test("resolveGraduation: afviser hvis ingen pending grad-row for (team,rider)", async () => {
  // assert: throw 'not_pending'
});
```

- [ ] **Step 2: Kør → fejl**

Run: `node --test backend/lib/academyGraduation.test.js`
Expected: FAIL — `resolveGraduation is not a function`.

- [ ] **Step 3: Implementér `resolveGraduation`**

Tilføj til `backend/lib/academyGraduation.js`. Genbrug `computeFrozenSalary`/`computeContractEndSeason` fra `contractSeed.js`, `calculateRiderMarketValue`/`getTeamMarketState` fra `marketUtils.js`:

```js
import { computeFrozenSalary, computeContractEndSeason, CONTRACT } from "./contractSeed.js";
import { getTeamMarketState } from "./marketUtils.js";

const VALID_ACTIONS = new Set(["promote", "sell", "release"]);

// Udfør ét graduerings-udfald. action ∈ promote|sell|release.
export async function resolveGraduation(supabase, { teamId, riderId, action, seasonNumber, now = new Date() }) {
  if (!VALID_ACTIONS.has(action)) throw new Error("invalid_action");

  // 1. verificér pending grad-row for (team, rider)
  const { data: grad } = await supabase.from("academy_graduation")
    .select("id, status").eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();
  if (!grad || grad.status !== "pending") throw new Error("not_pending");

  const { data: rider } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, base_value, prize_earnings_bonus, market_value, salary")
    .eq("id", riderId).maybeSingle();
  if (!rider) throw new Error("rider_not_found");

  if (action === "promote") {
    // cap-check: future_count må ikke overstige division-cap efter +1
    const state = await getTeamMarketState(supabase, teamId);
    const cap = state.squad_limits?.max ?? 30;
    if ((state.future_count ?? state.rider_count) + 1 > cap) throw new Error("squad_cap_violation");
    // NY senior-løn (overskriv arvet akademi-løn — beslutning 3)
    const salary = computeFrozenSalary(rider);
    const length = CONTRACT.DEFAULT_ACQUIRE_LENGTH;
    await supabase.from("riders").update({
      is_academy: false, salary,
      contract_length: length,
      contract_end_season: computeContractEndSeason(seasonNumber, length),
    }).eq("id", riderId);
    await finishGraduation(supabase, { gradId: grad.id, status: "promoted", teamId, rider, now, action });
    return { riderId, action: "promoted", salary };
  }

  if (action === "sell") {
    // Opret senior-auktion (seller=hold). Rytteren forbliver is_academy=true (uden for
    // cap) indtil auktions-finalization afgør udfaldet (Task 6).
    await createGraduateAuction(supabase, { teamId, rider, now });
    await finishGraduation(supabase, { gradId: grad.id, status: "sold", teamId, rider, now, action });
    return { riderId, action: "sold" };
  }

  // release
  await supabase.from("riders").update({ team_id: null, is_academy: false }).eq("id", riderId);
  await finishGraduation(supabase, { gradId: grad.id, status: "released", teamId, rider, now, action });
  return { riderId, action: "released" };
}

async function finishGraduation(supabase, { gradId, status, teamId, rider, now, action }) {
  await supabase.from("academy_graduation")
    .update({ status, resolved_at: now.toISOString() }).eq("id", gradId);
  await notifyTeamOwner({
    supabase, teamId, type: "academy_graduated", relatedId: rider.id,
    title: "Academy graduate resolved",
    message: `${rider.firstname} ${rider.lastname} was ${action === "promote" ? "promoted to your senior squad" : action === "sell" ? "listed for transfer" : "released"}.`,
    metadata: { titleCode: "notif.academyGraduated.title", messageCode: `notif.academyGraduated.${action}`, titleParams: { name: `${rider.firstname} ${rider.lastname}` } },
  });
}

// Spejl POST /auctions-insert (api.js ~1484). EKSEKUTOR: læs den faktiske insert + brug
// samme felt-sæt (starting_price, current_price, min_increment, calculated_end). is_youth=false.
async function createGraduateAuction(supabase, { teamId, rider, now }) {
  const startingPrice = Math.max(1, Math.round((rider.market_value ?? rider.base_value ?? 1000)));
  const calculatedEnd = new Date(now.getTime() + 24 * 3600_000).toISOString(); // EKSEKUTOR: brug samme varighed som standard-auktioner
  const { error } = await supabase.from("auctions").insert({
    rider_id: rider.id, seller_team_id: teamId,
    starting_price: startingPrice, current_price: startingPrice,
    min_increment: 1, calculated_end: calculatedEnd, is_youth: false,
  });
  if (error) throw new Error(`createGraduateAuction: ${error.message}`);
}
```

> **Eksekutor:** (1) `createGraduateAuction` skal spejle den FAKTISKE auktions-insert i `api.js` POST `/auctions` — brug samme felt-navne, default-varighed og evt. `notifyNewAuction`/`logActivity`-kald. (2) `getTeamMarketState`'s cap-felt: bekræft `squad_limits.max`-navnet (læs `getSquadLimits`). (3) Solvens-/råd-check ved promote: spec'en nævner "råd til lønnen" — tilføj en simpel guard (fx `state.balance < 0` → `insufficient_funds`) HVIS balance er tilgængelig i `getTeamMarketState`; ellers noter som åbent punkt og spring over i MVP.

- [ ] **Step 4: Kør → pass**

Run: `node --test backend/lib/academyGraduation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/academyGraduation.js backend/lib/academyGraduation.test.js
git commit -F .git/COMMIT_EDITMSG_GRAD_4
```
Besked: `feat(academy): graduerings-resolution promover/sælg/slip (#932)`

---

## Task 5: Default-kæde + sweep + cron + tests

**Files:**
- Modify: `backend/lib/academyGraduation.js` (tilføj `defaultResolveGraduate`)
- Create: `backend/lib/academyGraduationSweep.js`, `backend/lib/academyGraduationSweep.test.js`
- Modify: `backend/cron.js`

- [ ] **Step 1: Skriv den fejlende test (default-kæde)**

Tilføj til `backend/lib/academyGraduation.test.js`:

```js
import { defaultResolveGraduate } from "./academyGraduation.js";

test("defaultResolveGraduate: promover når plads + (råd); ellers sælg", async () => {
  // arranger: plads ledig → forventer action 'promote'
  // arranger: cap fuld → forventer action 'sell'
});
```

Og create `backend/lib/academyGraduationSweep.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runAcademyGraduationSweep } from "./academyGraduationSweep.js";

test("sweep: før kl. 22 → skip", async () => {
  const before = new Date("2026-06-18T05:00:00Z"); // EKSEKUTOR: vælg en tid < 22 CET
  const res = await runAcademyGraduationSweep({ supabase: {}, now: before });
  assert.equal(res.skipped, "before_window");
});

test("sweep: flag OFF → skip", async () => {
  // mock isAcademyEnabled=false → res.skipped === 'flag_off'
});

test("sweep: resolver kun pending-rows med passeret deadline via default-kæde", async () => {
  // arranger: 1 pending med deadline i fortiden, 1 med deadline i fremtiden
  // assert: kun den udløbne resolveres (injiceret resolveFn kaldt 1×)
});
```

- [ ] **Step 2: Kør → fejl**

Run: `node --test backend/lib/academyGraduation.test.js backend/lib/academyGraduationSweep.test.js`
Expected: FAIL — moduler/funktioner mangler.

- [ ] **Step 3: Implementér `defaultResolveGraduate`**

Tilføj til `backend/lib/academyGraduation.js`:

```js
// Soft default: promover hvis plads (+ råd) → ellers sælg. (Usolgt salg → release
// håndteres i auktions-finalization, Task 6.)
export async function defaultResolveGraduate(supabase, { teamId, riderId, seasonNumber, now = new Date() }) {
  const state = await getTeamMarketState(supabase, teamId);
  const cap = state.squad_limits?.max ?? 30;
  const hasRoom = (state.future_count ?? state.rider_count) + 1 <= cap;
  const action = hasRoom ? "promote" : "sell";
  try {
    return await resolveGraduation(supabase, { teamId, riderId, action, seasonNumber, now });
  } catch (err) {
    if (action === "promote") {
      // promover fejlede (fx råd) → fald til sælg
      return await resolveGraduation(supabase, { teamId, riderId, action: "sell", seasonNumber, now });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Implementér sweepet**

Create `backend/lib/academyGraduationSweep.js` (spejl `trainingSweep.js`-strukturen):

```js
import { shouldSweepNow } from "./trainingSweep.js"; // EKSEKUTOR: verificér at shouldSweepNow er eksporteret; ellers genbrug copenhagenHour-helper
import { isAcademyEnabled } from "./academyFlag.js";
import { fetchAllRows } from "./supabasePagination.js";
import { defaultResolveGraduate } from "./academyGraduation.js";

// Auto-resolver pending graduates hvor override-vinduet (deadline) er udløbet.
// Idempotent: kun status='pending' med deadline < now røres; resolveGraduation
// flytter status, så gentaget kørsel er en no-op.
export async function runAcademyGraduationSweep({ supabase, now = new Date(), resolveFn = defaultResolveGraduate } = {}) {
  if (!shouldSweepNow(now)) return { processed: 0, skipped: "before_window" };
  if (!(await isAcademyEnabled(supabase))) return { processed: 0, skipped: "flag_off" };

  const { data: season } = await supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (!season) return { processed: 0, skipped: "no_active_season" };

  const pending = await fetchAllRows(() =>
    supabase.from("academy_graduation")
      .select("team_id, rider_id, deadline").eq("status", "pending").order("created_at"));

  let resolved = 0, failed = 0;
  for (const g of pending) {
    if (new Date(g.deadline) > now) continue; // vindue ikke udløbet endnu
    try {
      await resolveFn(supabase, { teamId: g.team_id, riderId: g.rider_id, seasonNumber: season.number, now });
      resolved++;
    } catch (err) {
      failed++;
      console.error(`graduation sweep failed (${g.rider_id}):`, err.message);
    }
  }
  return { processed: resolved + failed, resolved, failed };
}
```

> **Eksekutor:** hvis `shouldSweepNow` ikke er eksporteret fra `trainingSweep.js`, eksportér den (eller genbrug `copenhagenHour` direkte). Sweep-vinduet (kl. 22) er bevidst genbrugt for konsistens.

- [ ] **Step 5: Kør → pass**

Run: `node --test backend/lib/academyGraduation.test.js backend/lib/academyGraduationSweep.test.js`
Expected: PASS.

- [ ] **Step 6: Cron-hook**

I `backend/cron.js`: importér `runAcademyGraduationSweep` og kald den i main-loopet sammen med `runTrainingSweep` (samme kadence). Spejl `runTrainingAssistantSweep`-wrapperens fejl-håndtering/logging.

```js
import { runAcademyGraduationSweep } from "./lib/academyGraduationSweep.js";
// ... i main-loopet, nær training-sweep-kaldet:
try {
  const g = await runAcademyGraduationSweep({ supabase });
  if (g.resolved > 0) console.log(`🎓 Graduation sweep: ${g.resolved} resolved`);
} catch (err) { console.error("Graduation sweep error:", err.message); }
```

- [ ] **Step 7: Kør backend-suite**

Run: `cd backend; node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/lib/academyGraduation.js backend/lib/academyGraduation.test.js backend/lib/academyGraduationSweep.js backend/lib/academyGraduationSweep.test.js backend/cron.js
git commit -F .git/COMMIT_EDITMSG_GRAD_5
```
Besked: `feat(academy): default-kæde + graduerings-sweep + cron (#932)`

---

## Task 6: Auktions-finalization — graduate-salgs-gren + tests

**Files:**
- Modify: `backend/lib/auctionFinalization.js`
- Test: `backend/lib/auctionFinalization.test.js`

En graduate-salgs-auktion = `seller_team_id != NULL` + rytter `is_academy=true` + `is_youth=false`. Skiller sig fra normal senior-auktion (rytter `is_academy=false`) og fra youth-auktion (`is_youth=true`).

- [ ] **Step 1: Skriv den fejlende test**

Tilføj til `backend/lib/auctionFinalization.test.js`:

```js
test("finalize graduate-auktion med vinder: rytter → is_academy=false hos køber; grad ikke rørt (allerede sold)", async () => {
  // arranger: auktion seller_team_id sat, rider is_academy=true, en vinder-bidder
  // assert: rider-update team_id=vinder + is_academy=false
});

test("finalize graduate-auktion uden bud: rytter → free agent (team_id=NULL, is_academy=false); grad status → expired", async () => {
  // arranger: auktion seller sat, rider is_academy=true, ingen bud
  // assert: rider team_id=NULL + is_academy=false; academy_graduation.status='expired'
});
```

- [ ] **Step 2: Kør → fejl**

Run: `node --test backend/lib/auctionFinalization.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementér grenen**

I `backend/lib/auctionFinalization.js`: i finalization-logikken, efter at vinder/ingen-bud er afgjort, tilføj en graduate-gren. EKSEKUTOR: find hvor rytter-overdragelsen sker, og guard på `rider.is_academy === true && auction.seller_team_id != null && !auction.is_youth`:

```js
// Graduate-salgs-auktion (#932): rytteren forlader akademiet via salg.
// Vinder → senior hos køber (is_academy=false). Ingen bud → free agent + grad expired.
if (rider.is_academy && auction.seller_team_id && !auction.is_youth) {
  if (winnerTeamId) {
    // normal overdragelse til vinder MEN sæt is_academy=false (bliver senior)
    riderUpdate.is_academy = false; // tilføj til den eksisterende rider-update-payload
  } else {
    await supabase.from("riders").update({ team_id: null, is_academy: false }).eq("id", rider.id);
    await supabase.from("academy_graduation")
      .update({ status: "expired", resolved_at: new Date().toISOString() })
      .eq("rider_id", rider.id).eq("status", "sold");
  }
}
```

> **Eksekutor:** integrér med den EKSISTERENDE rider-update i finalization frem for en separat update (undgå dobbelt-write). Læs hvordan `is_youth`-grenen allerede er struktureret og spejl den. Sørg for at auktions-queryen SELECT'er `is_academy` (join på rider) + `seller_team_id` + `is_youth`.

- [ ] **Step 4: Kør → pass**

Run: `node --test backend/lib/auctionFinalization.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/auctionFinalization.js backend/lib/auctionFinalization.test.js
git commit -F .git/COMMIT_EDITMSG_GRAD_6
```
Besked: `feat(academy): graduate-salgs-gren i auktions-finalization (#932)`

---

## Task 7: Ruter — graduate-action + udvid /academy/me

**Files:**
- Modify: `backend/routes/api.js`

- [ ] **Step 1: Tilføj ruten `POST /api/academy/graduate`**

Spejl `POST /api/academy/sign` (api.js ~8216). Body `{ riderId, action }` (action ∈ promote|sell|release):

```js
import { resolveGraduation } from "../lib/academyGraduation.js";

router.post("/academy/graduate", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const isBetaTester = await isViewerBetaTester(req);
    if (!(await isAcademyEnabled(supabase, { isBetaTester }))) return res.status(409).json({ error: "academy_disabled" });
    const { riderId, action } = req.body || {};
    if (!riderId || !action) return res.status(400).json({ error: "riderId and action required" });
    const { data: season } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
    const result = await resolveGraduation(supabase, { teamId: req.team.id, riderId, action, seasonNumber: season?.number ?? 1 });
    res.json(result);
  } catch (err) {
    const msg = err?.message ?? "";
    if (["not_pending","squad_cap_violation","invalid_action","insufficient_funds"].includes(msg)) return res.status(409).json({ error: msg });
    captureException(err);
    res.status(500).json({ error: msg });
  }
});
```

- [ ] **Step 2: Udvid `GET /api/academy/me`**

Find den eksisterende `GET /api/academy/me`-handler og tilføj en `graduations`-nøgle til responsen: pending grad-rows for holdet, beriget med rytter-navn/alder + `deadline`. EKSEKUTOR: spejl hvordan `intake`/`roster` allerede hentes i samme handler.

```js
// pending graduates for holdet (join rider-navn):
const { data: gradRows } = await supabase.from("academy_graduation")
  .select("rider_id, deadline, status, riders(firstname, lastname, birthdate)")
  .eq("team_id", req.team.id).eq("status", "pending");
// → map til { riderId, name, age, deadline } og inkludér i JSON
```

- [ ] **Step 3: Kør backend-suite + manuel rute-smoke**

Run: `cd backend; node --test`
Expected: PASS. (Rute-niveau dækkes af service-tests; ingen ny supertest medmindre mønsteret allerede findes.)

- [ ] **Step 4: Commit**

```bash
git add backend/routes/api.js
git commit -F .git/COMMIT_EDITMSG_GRAD_7
```
Besked: `feat(academy): graduate-action-rute + graduations i /academy/me (#932)`

---

## Task 8: Frontend — graduerings-sektion + i18n + patch notes

**Files:**
- Modify: `frontend/src/pages/AcademyPage.jsx`, `frontend/src/lib/useAcademy.js`
- Modify: `frontend/public/locales/{en,da}/academy.json`, `help.json`, `PatchNotesPage.jsx`, `docs/FEATURE_STATUS.md`

- [ ] **Step 1: useAcademy — graduations + action**

I `frontend/src/lib/useAcademy.js`: eksponér `graduations` fra `GET /api/academy/me` og tilføj `resolveGraduate(riderId, action)` → `POST /api/academy/graduate`. Spejl den eksisterende `signCandidate`/`rejectCandidate`-struktur.

- [ ] **Step 2: AcademyPage — graduerings-sektion**

Tilføj en sektion (over INTAKE) der vises når `graduations.length > 0`: pr. rytter navn + alder + deadline-nedtælling + tre knapper (Promote / Sell / Release). Promote-knap disabled + begrundelse når senior-trup fuld (vis fra en cap-state eller fang 409 `squad_cap_violation` og vis besked). Spejl intake-kortets JSX/styling. EN-først/DA via `academy.json`.

- [ ] **Step 3: i18n + help + patch notes + FEATURE_STATUS**

- `academy.json` (en+da): sektions-titel, knap-labels, deadline-tekst, fejl-beskeder (`squad_cap_violation` → "Senior squad full — free a slot, sell or release"). Ingen em-dash.
- `help.json` (en+da): forklar graduering ved 22 (promover/sælg/slip + auto-default).
- `PatchNotesPage.jsx`: version-bump med graduerings-feature.
- `docs/FEATURE_STATUS.md`: opdatér akademi-status (promotion-flow nu live).

- [ ] **Step 4: Frontend-tests + build + snapshots**

Run: `cd frontend; node --test; npm run build`
Hvis graduerings-sektionen ændrer akademi-siden visuelt og der er snapshots: `npx playwright test core-smoke --update-snapshots` (alle 3 projekter, win32) + commit PNG'erne.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AcademyPage.jsx frontend/src/lib/useAcademy.js frontend/public/locales frontend/src/pages/PatchNotesPage.jsx docs/FEATURE_STATUS.md frontend/tests
git commit -F .git/COMMIT_EDITMSG_GRAD_8
```
Besked: `feat(academy): graduerings-UI + i18n + patch notes (#932)`

---

## Task 9: Sim-dry-run + scorecard

**Files:**
- Create: `backend/scripts/academyGraduationDryRun.js` (eller udvid `academyEconomySimulation.js`)

- [ ] **Step 1: Skriv dry-run**

Simulér ét sæson-skift mod en fiktiv akademi-population (genbrug `academyEconomySimulation.js`-stilen): generér akademiryttere i forskellige aldre, kør `detectGraduates`, kør så `defaultResolveGraduate` for alle (deadline udløbet). Rapportér fordeling: hvor mange promoveret / solgt / sluppet, og om nogen cap brydes (forventet: 0 cap-brud).

- [ ] **Step 2: Kør + scorecard**

Run: `node backend/scripts/academyGraduationDryRun.js`
Forventet: plausibel fordeling, 0 cap-brud, ingen exceptions. Skriv resultatet til `docs/metrics/academy-graduation-scorecard-2026-06-18.md`. **`GRADUATION.DEADLINE_DAYS` ejer-godkendes** ud fra dette før relaunch-relevans.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/academyGraduationDryRun.js docs/metrics/academy-graduation-scorecard-2026-06-18.md
git commit -F .git/COMMIT_EDITMSG_GRAD_9
```
Besked: `chore(academy): graduerings-dry-run + scorecard (#932)`

---

## Self-Review

**1. Spec coverage** (mod `2026-06-18-academy-promotion-flow-design.md`):
- §3 tre udfald (promover/sælg/slip) → Task 4. ✅
- §4 pending-graduation-tilstand (academy_graduation-tabel) → Task 1 + 3. ✅
- §5 default-kæde (soft default) → Task 5 (`defaultResolveGraduate` + sweep). ✅
- §6 edge cases (fuld trup → sælg; usolgt → slip; idempotens) → Task 4 (cap-guard) + Task 6 (usolgt→free agent) + Task 3/5 (idempotens via status-gating). ✅
- §7 datamodel (notification-typer) → Task 1. ✅
- §8 seams → alle tasks bruger verificerede fil:linje. ✅
- §9 UI & comms → Task 8. ✅
- §10 fairness/determinisme → ingen rigtige penge; sæson-diskret detektion (idempotent). ✅
- §11 test-strategi → unit (Task 2-6), sim (Task 9), frontend+playwright (Task 8). ✅
- §13 implementerings-rækkefølge → Task 1→9 følger den. ✅

**2. Placeholder-scan:** Eksekutor-noter (verificér import-sti, spejl faktisk auktions-insert, bekræft squad_limits-felt) er bevidste — kontrakt-kritiske flader (migration, kerne-funktions-signaturer, tests, default-kæde) har fuld kode; omkringliggende eksisterende mønstre læses i konteksten (samme stil som #1308/#1309-planerne). §4-spec'ens "provenu ved auto-salg" + "solvens-check" er markeret som åbne punkter (Task 4 eksekutor-note).

**3. Type-konsistens:** `GRADUATION.GRADUATE_AGE/DEADLINE_DAYS`, `isGraduateAge(age)`, `detectGraduates(supabase,{seasonId,seasonNumber,now,dryRun})`, `resolveGraduation(supabase,{teamId,riderId,action,seasonNumber,now})`, `defaultResolveGraduate(supabase,{teamId,riderId,seasonNumber,now})`, `runAcademyGraduationSweep({supabase,now,resolveFn})` — konsistente på tværs af Task 2-7. `academy_graduation.status ∈ {pending,promoted,sold,released,expired}` ens i migration + alle services. Notification-typer `academy_graduation_ready`/`academy_graduated` matcher migration (Task 1) + brug (Task 3/4).

## Bevidst scope-note

- **Promotion er IKKE et automatisk auto-promote ved 22** (Explore-agentens forenkling) — det er pending-valg + soft default. Dette er det spec-korrekte.
- **Solvens-/råd-check ved promote** holdes minimal (Task 4 eksekutor-note) — fuld balance-økonomi-effekt verificeres i sim (Task 9).
- Junior/U23 (#958), "akademi-output"-stats, facilitet-niveauer = out of scope (separate spor).

## Execution Handoff

Fase med `database/*.sql` (Task 1) → **ejeren merger PR'en**. Resten kan landes i samme branch. Eksekvér via subagent-driven-development (frisk subagent pr. task, two-stage review) i en isoleret git-worktree (branch fra origin/main).
