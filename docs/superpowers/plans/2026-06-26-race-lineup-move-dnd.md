# Race-lineup move + drag-and-drop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make moving a rider between overlapping races reliable and intuitive — an atomic backend "place rider (evicting overlapping source)" operation, draft-aware binding so the UI reflects live edits, and native desktop drag-and-drop (mobile/keyboard keep the improved tap-flow).

**Architecture:** A new atomic operation `POST /api/races/lineup/move { riderId, toRaceId }` finds the rider's current entry in any race that time-overlaps the target (for this team), and in one transaction deletes it and inserts into the target (role `helper`), allowing the source to go understaffed. The board offers targets from the DRAFT (so the popover reflects unsaved edits) but dispatches move-vs-add from the SERVER binding (so the eviction hits the DB). Drag-and-drop is native HTML5 (desktop pointer); the click/tap flow is the mobile/a11y baseline.

**Tech Stack:** Node + Express (backend), Supabase Postgres RPC, React (frontend), native HTML5 Drag and Drop API, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-26-race-lineup-move-dnd-design.md`

---

## File structure

- `backend/lib/raceLineupMove.js` (new, pure) — overlap-source detection + move validation. Tested.
- `backend/lib/raceLineupMove.test.js` (new).
- `database/2026-06-26-race-lineup-move.sql` (new) — `move_race_entry` RPC (atomic delete+insert+cap-check under advisory lock). **Owner merges.**
- `backend/routes/api.js` (modify) — `POST /api/races/lineup/move` handler.
- `frontend/src/lib/raceHubLogic.js` (modify) — add `draftBindingMap(effectiveColumns)`.
- `frontend/src/lib/raceHubLogic.test.js` (modify) — tests for `draftBindingMap`.
- `frontend/src/lib/raceHubDnd.js` (new, pure) — drag payload encode/decode + `dropAction({fromKind, toKind, riderInOverlap, targetFull, targetLocked})`. Tested.
- `frontend/src/lib/raceHubDnd.test.js` (new).
- `frontend/src/components/racehub/RaceHubBoard.jsx` (modify) — draft-aware binding, move dispatch, DnD orchestration.
- `frontend/src/components/racehub/AvailableRidersPool.jsx` (modify) — draggable chips + pool drop zone.
- `frontend/src/components/racehub/RaceColumn.jsx` (modify) — draggable rider rows + column drop zone.
- `frontend/public/locales/{en,da}/races.json` (modify) — move error codes + drag hint.
- `frontend/src/data/patchNotes.js` + `docs/NOW.md` + snapshots — patch note v6.26.
- `frontend/public/locales/{en,da}/help.json` (modify) — "move rider between races / drag-and-drop".

---

## Task 1: Backend pure move-logic

**Files:**
- Create: `backend/lib/raceLineupMove.js`
- Test: `backend/lib/raceLineupMove.test.js`

- [ ] **Step 1: Write failing tests**

```js
// backend/lib/raceLineupMove.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { findOverlappingSourceRaceId, validateMoveTarget } from "./raceLineupMove.js";

test("findOverlappingSourceRaceId: returnerer det overlappende kilde-løb (ekskl. target)", () => {
  // rytteren er i A og C; A overlapper target, C gør ikke.
  const entriesByRace = { A: true, C: true };
  const windowByRace = { target: { start: 10, end: 10 }, A: { start: 10, end: 11 }, C: { start: 20, end: 20 } };
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: ["A", "C"], toRaceId: "target", windowByRace }), "A");
});

test("findOverlappingSourceRaceId: ingen overlappende kilde → null (ren tilføj)", () => {
  const windowByRace = { target: { start: 10, end: 10 }, C: { start: 20, end: 20 } };
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: ["C"], toRaceId: "target", windowByRace }), null);
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: [], toRaceId: "target", windowByRace }), null);
});

test("findOverlappingSourceRaceId: rytteren allerede i target → null (no-op)", () => {
  const windowByRace = { target: { start: 10, end: 10 } };
  assert.equal(findOverlappingSourceRaceId({ riderRaceIds: ["target"], toRaceId: "target", windowByRace }), null);
});

test("validateMoveTarget: fuldt mål afvises", () => {
  assert.deepEqual(
    validateMoveTarget({ targetCount: 6, fieldSize: 6, teamInPool: true, frozen: false, eligible: true }),
    { ok: false, error: "move_target_full" });
});

test("validateMoveTarget: frosset/forkert-pulje/uberettiget afvises i rækkefølge", () => {
  assert.equal(validateMoveTarget({ targetCount: 2, fieldSize: 6, teamInPool: false, frozen: false, eligible: true }).error, "move_wrong_pool");
  assert.equal(validateMoveTarget({ targetCount: 2, fieldSize: 6, teamInPool: true, frozen: true, eligible: true }).error, "move_target_locked");
  assert.equal(validateMoveTarget({ targetCount: 2, fieldSize: 6, teamInPool: true, frozen: false, eligible: false }).error, "move_rider_ineligible");
});

test("validateMoveTarget: gyldigt mål → ok", () => {
  assert.deepEqual(validateMoveTarget({ targetCount: 5, fieldSize: 6, teamInPool: true, frozen: false, eligible: true }), { ok: true });
});
```

- [ ] **Step 2: Run, verify fail** — `cd backend && node --test lib/raceLineupMove.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// backend/lib/raceLineupMove.js
// Ren logik for "flyt rytter til løb" (atomisk move-operation, #1925-followup).
// I/O (entries, windows, RPC) ligger i api.js-handleren; her kun det testbare.
import { windowsOverlap } from "./raceBinding.js";

// Find det løb (≠ target) hvor rytteren allerede er udtaget OG som tids-overlapper
// target — det er kilden der skal evicte's ved et move. Ingen overlap → null (ren
// tilføj). Rytteren allerede i target → null (no-op).
export function findOverlappingSourceRaceId({ riderRaceIds = [], toRaceId, windowByRace = {} }) {
  const targetWindow = windowByRace[toRaceId];
  for (const raceId of riderRaceIds) {
    if (raceId === toRaceId) continue;
    if (windowsOverlap(targetWindow, windowByRace[raceId])) return raceId;
  }
  return null;
}

// Validér mål-løbet. Rækkefølge afgør hvilken fejl der vises. fieldSize = max.
export function validateMoveTarget({ targetCount, fieldSize, teamInPool, frozen, eligible }) {
  if (!teamInPool) return { ok: false, error: "move_wrong_pool" };
  if (frozen) return { ok: false, error: "move_target_locked" };
  if (!eligible) return { ok: false, error: "move_rider_ineligible" };
  if (targetCount >= fieldSize) return { ok: false, error: "move_target_full" };
  return { ok: true };
}
```

- [ ] **Step 4: Run, verify pass** — `cd backend && node --test lib/raceLineupMove.test.js` → PASS (5 tests).

- [ ] **Step 5: Commit** — `git add backend/lib/raceLineupMove.js backend/lib/raceLineupMove.test.js && git commit -m "feat(race-move): pure overlap-source + move-target validering"`

---

## Task 2: Move RPC migration (owner merges)

**Files:**
- Create: `database/2026-06-26-race-lineup-move.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 2026-06-26 — Atomisk "flyt rytter til løb" (#1925-followup, race-lineup move).
-- Sletter rytterens entry i kilde-løbet (hvis givet) og indsætter i mål-løbet i ÉN
-- transaktion under advisory-lås på holdet (undgår dobbelt-booking-race + #1924's
-- ikke-transaktionelle saveSelection-degrade). Cap-tjek på målet sker inde i låsen.
-- p_from_race_id NULL = ren tilføj (intet at evicte). Idempotent på re-kør.
CREATE OR REPLACE FUNCTION public.move_race_entry(
  p_team_id uuid, p_rider_id uuid, p_from_race_id uuid, p_to_race_id uuid, p_max int
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));

  IF p_from_race_id IS NOT NULL THEN
    DELETE FROM race_entries
      WHERE team_id = p_team_id AND rider_id = p_rider_id AND race_id = p_from_race_id;
  END IF;

  -- Allerede i målet? Så er der intet at gøre (idempotent).
  IF EXISTS (SELECT 1 FROM race_entries WHERE race_id = p_to_race_id AND rider_id = p_rider_id) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM race_entries WHERE race_id = p_to_race_id AND team_id = p_team_id;
  IF v_count >= p_max THEN
    RAISE EXCEPTION 'move_target_full' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
    VALUES (p_to_race_id, p_rider_id, p_team_id, 'helper', false);
END;
$$;
```

- [ ] **Step 2: Commit** — `git add database/2026-06-26-race-lineup-move.sql && git commit -m "feat(race-move): atomisk move_race_entry RPC (owner merger)"`

> CI `migration-idempotency` validerer at den er re-kørbar (CREATE OR REPLACE). Ingen lokal apply.

---

## Task 3: Move endpoint

**Files:**
- Modify: `backend/routes/api.js` (ny handler nær de øvrige race-selection-ruter, fx efter `PUT /api/races/:raceId/selection`)

- [ ] **Step 1: Read context** — `grep -n "races/:raceId/selection" backend/routes/api.js` og læs handleren + dens guards (auth, team-opslag, flag-gate, `getSelectionContext`, `loadTeamBindingContext`, `selectionSizeForRace`, `teamInRacePool`, `isEligibleRider`). Genbrug de samme helpers.

- [ ] **Step 2: Add the handler** (mønster fra PUT /selection; bruger Task 1's helpers + RPC fra Task 2)

```js
// POST /api/races/lineup/move — flyt rytter til et løb (evicter overlappende kilde).
// Body: { riderId, toRaceId }. Atomisk via move_race_entry-RPC.
app.post("/api/races/lineup/move", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { riderId, toRaceId } = req.body || {};
  if (!riderId || !toRaceId) return res.status(400).json({ error: "move_invalid_body" });

  // Hold + flag-gate (samme mønster som selection-handleren).
  const { data: team } = await supabase.from("teams").select("id, league_division_id").eq("user_id", userId).single();
  if (!team) return res.status(404).json({ error: "team_not_found" });

  // Mål-løbet: status/frys/pulje.
  const { data: toRace } = await supabase.from("races")
    .select("id, race_class, status, stages_completed, league_division_id").eq("id", toRaceId).single();
  if (!toRace) return res.status(404).json({ error: "race_not_found" });
  const frozen = toRace.status !== "scheduled" || (toRace.stages_completed ?? 0) > 0;
  const teamInPool = teamInRacePool({ teamDivisionId: team.league_division_id, racePoolId: toRace.league_division_id });

  // Rytter-berettigelse (genbrug #1924-eligibility incl. loan).
  const { data: riderRow } = await supabase.from("riders").select("id, team_id, is_academy, is_retired").eq("id", riderId).single();
  const { data: loanedOut } = await loadLoanedOutRiderIds({ supabase, riderIds: [riderId] });
  const eligible = isEligibleRider(riderRow, { teamId: team.id, loanedOutRiderIds: loanedOut });

  // Target count.
  const { count: targetCount } = await supabase.from("race_entries")
    .select("rider_id", { count: "exact", head: true }).eq("race_id", toRaceId).eq("team_id", team.id);
  const fieldSize = selectionSizeForRace(toRace).max;

  const check = validateMoveTarget({ targetCount: targetCount ?? 0, fieldSize, teamInPool, frozen, eligible });
  if (!check.ok) return res.status(409).json({ error: check.error });

  // Find overlappende kilde via holdets fremtidige entries + deres vinduer.
  const { data: myEntries } = await supabase.from("race_entries")
    .select("race_id").eq("team_id", team.id).neq("race_id", toRaceId);
  const riderRaceIds = (myEntries || []).map((e) => e.race_id); // (filtreres til rytterens egne nedenfor)
  const { data: riderEntries } = await supabase.from("race_entries")
    .select("race_id").eq("team_id", team.id).eq("rider_id", riderId);
  const riderRaceIdSet = (riderEntries || []).map((e) => e.race_id);

  // Vinduer for target + rytterens løb.
  const raceIds = [...new Set([toRaceId, ...riderRaceIdSet])];
  const { data: scheds } = await supabase.from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", raceIds);
  const schedByRace = {};
  for (const s of scheds || []) (schedByRace[s.race_id] ||= []).push(s);
  const windowByRace = {};
  for (const id of raceIds) windowByRace[id] = raceBindingWindow(schedByRace[id]);

  const fromRaceId = findOverlappingSourceRaceId({ riderRaceIds: riderRaceIdSet, toRaceId, windowByRace });

  const { error } = await supabase.rpc("move_race_entry", {
    p_team_id: team.id, p_rider_id: riderId, p_from_race_id: fromRaceId, p_to_race_id: toRaceId, p_max: fieldSize,
  });
  if (error) {
    if (/move_target_full/.test(error.message || "")) return res.status(409).json({ error: "move_target_full" });
    return res.status(500).json({ error: "move_failed" });
  }
  return res.json({ ok: true, fromRaceId, toRaceId });
});
```

(Importér `findOverlappingSourceRaceId`, `validateMoveTarget` fra `../lib/raceLineupMove.js` og `raceBindingWindow` fra `../lib/raceBinding.js` øverst i api.js hvis ikke allerede.)

- [ ] **Step 3: Verify** — `cd backend && node --test` (ingen regression; endpointet har ingen unit-test, men handler-logikken er dækket af Task 1's pure helpers). Bekræft `node --check backend/routes/api.js`.

- [ ] **Step 4: Commit** — `git add backend/routes/api.js && git commit -m "feat(race-move): POST /api/races/lineup/move endpoint"`

---

## Task 4: Frontend draft-aware binding

**Files:**
- Modify: `frontend/src/lib/raceHubLogic.js`
- Test: `frontend/src/lib/raceHubLogic.test.js`

- [ ] **Step 1: Write failing test**

```js
test("draftBindingMap: binder rytter til de kolonner han er i kladden (ekskl. afmeldte)", () => {
  const cols = [
    { id: "A", withdrawn: false, selection: { rider_ids: ["r1", "r2"] } },
    { id: "B", withdrawn: false, selection: { rider_ids: ["r2"] } },
    { id: "C", withdrawn: true, selection: { rider_ids: ["r1"] } },
  ];
  const map = draftBindingMap(cols);
  assert.deepEqual(map.r1, ["A"]);          // C er afmeldt → tæller ikke
  assert.deepEqual(map.r2.sort(), ["A", "B"]);
});
```

(Importér `draftBindingMap` i test-headeren.)

- [ ] **Step 2: Run, verify fail** — `cd frontend && node --test src/lib/raceHubLogic.test.js` → FAIL.

- [ ] **Step 3: Implement** (append i raceHubLogic.js)

```js
// #1925: kladde-bevidst binding. Boardets kolonner overlapper alle den valgte dag
// (#1823 dag-granulær binding), så en rytter er "bundet væk" fra et løb hvis han er i
// en ANDEN ikke-afmeldt kolonnes kladde-selection. Erstatter den stale server-bindingMap
// i popover/pulje, så live-redigeringer (fjern/flyt) afspejles med det samme.
export function draftBindingMap(columns = []) {
  const map = {};
  for (const c of columns) {
    if (c.withdrawn) continue;
    for (const id of c.selection?.rider_ids || []) (map[id] ||= []).push(c.id);
  }
  return map;
}
```

- [ ] **Step 4: Run, verify pass** — `cd frontend && node --test src/lib/raceHubLogic.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add frontend/src/lib/raceHubLogic.js frontend/src/lib/raceHubLogic.test.js && git commit -m "feat(race-move): kladde-bevidst draftBindingMap"`

---

## Task 5: Wire draft-aware binding + move dispatch in RaceHubBoard

**Files:**
- Modify: `frontend/src/components/racehub/RaceHubBoard.jsx`

- [ ] **Step 1: Import** — tilføj `draftBindingMap` til importen fra `../../lib/raceHubLogic.js`.

- [ ] **Step 2: Replace the bindingMap passed to the pool** — beregn kladde-binding fra `effectiveColumns` og send den til `AvailableRidersPool` i stedet for `data.bindingMap`:

```js
  const liveBindingMap = draftBindingMap(effectiveColumns);
```
og i render: `<AvailableRidersPool ... bindingMap={liveBindingMap} ... />`

- [ ] **Step 3: Add move dispatch** — ny funktion + brug den i `addRider` når rytteren er i et overlappende SERVER-løb (brug `data.bindingMap` for at detektere kilden, så eviction rammer DB):

```js
  async function moveRiderToRace(riderId, toRaceId) {
    await mutate((headers) => fetch(`${API}/api/races/lineup/move`, {
      method: "POST", headers, body: JSON.stringify({ riderId, toRaceId }),
    }));
  }

  const addRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId);
    if (!col) return;
    // Er rytteren udtaget i et ANDET (overlappende) løb iflg. SERVER-tilstanden? Så er det
    // et MOVE (atomisk eviction + indsæt) — ikke en lokal kladde-add (ellers 409 ved gem).
    const serverBound = (data.bindingMap?.[riderId] || []).some((id) => id !== raceId);
    if (serverBound) { moveRiderToRace(riderId, raceId); return; }
    const cur = draftOf(col);
    if (cur.rider_ids.includes(riderId)) return;
    commitDraft(col, { ...cur, rider_ids: [...cur.rider_ids, riderId] });
  };
```

- [ ] **Step 4: Verify build** — `cd frontend && npm run build` → grøn. `node --test` → grøn (788+).

- [ ] **Step 5: Commit** — `git add frontend/src/components/racehub/RaceHubBoard.jsx && git commit -m "feat(race-move): kladde-binding i pulje + move-dispatch ved overlap"`

---

## Task 6: D&D pure helpers

**Files:**
- Create: `frontend/src/lib/raceHubDnd.js`
- Test: `frontend/src/lib/raceHubDnd.test.js`

- [ ] **Step 1: Write failing tests**

```js
// frontend/src/lib/raceHubDnd.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { encodeDrag, decodeDrag, dropAction } from "./raceHubDnd.js";

test("encode/decode round-trips drag-payload", () => {
  assert.deepEqual(decodeDrag(encodeDrag({ riderId: "r1", fromRaceId: "A" })), { riderId: "r1", fromRaceId: "A" });
  assert.deepEqual(decodeDrag(encodeDrag({ riderId: "r1", fromRaceId: null })), { riderId: "r1", fromRaceId: null });
  assert.equal(decodeDrag("not-json"), null);
});

test("dropAction: pulje→kolonne = add; kolonne→kolonne = move; kolonne→pulje = remove", () => {
  assert.equal(dropAction({ fromRaceId: null, toKind: "column", targetFull: false, targetLocked: false }), "add");
  assert.equal(dropAction({ fromRaceId: "A", toKind: "column", targetFull: false, targetLocked: false }), "move");
  assert.equal(dropAction({ fromRaceId: "A", toKind: "pool" }), "remove");
});

test("dropAction: fuldt/frosset mål eller samme kolonne = none", () => {
  assert.equal(dropAction({ fromRaceId: null, toKind: "column", targetFull: true, targetLocked: false }), "none");
  assert.equal(dropAction({ fromRaceId: "A", toKind: "column", targetFull: false, targetLocked: true }), "none");
  assert.equal(dropAction({ fromRaceId: "A", toRaceId: "A", toKind: "column", targetFull: false, targetLocked: false }), "none");
  assert.equal(dropAction({ fromRaceId: null, toKind: "pool" }), "none"); // pulje→pulje
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```js
// frontend/src/lib/raceHubDnd.js
// Rene helpers til native HTML5 drag-and-drop på trup-fordeling-boardet (#1925).
// Ingen React/DOM — kun payload-kodning + drop-beslutning, så det er node-testbart.
export function encodeDrag({ riderId, fromRaceId }) {
  return JSON.stringify({ riderId, fromRaceId: fromRaceId ?? null });
}
export function decodeDrag(raw) {
  try { const o = JSON.parse(raw); return o && o.riderId ? { riderId: o.riderId, fromRaceId: o.fromRaceId ?? null } : null; }
  catch { return null; }
}

// Hvilken handling skal et drop udløse? "add" | "move" | "remove" | "none".
export function dropAction({ fromRaceId, toRaceId = null, toKind, targetFull = false, targetLocked = false }) {
  if (toKind === "pool") return fromRaceId ? "remove" : "none";
  if (toKind === "column") {
    if (targetFull || targetLocked) return "none";
    if (fromRaceId && fromRaceId === toRaceId) return "none";
    return fromRaceId ? "move" : "add";
  }
  return "none";
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add frontend/src/lib/raceHubDnd.* && git commit -m "feat(race-move): rene DnD-helpers (payload + dropAction)"`

---

## Task 7: Wire native HTML5 drag-and-drop

**Files:**
- Modify: `AvailableRidersPool.jsx`, `RaceColumn.jsx`, `RaceHubBoard.jsx`

- [ ] **Step 1: RaceHubBoard — pass DnD handlers + remove handler.** Tilføj en `onDropRider(toKind, toRaceId, payload)`-orkestrator der oversætter `dropAction(...)` til `addRider` / `moveRiderToRace` / `removeRider`, og giv den + `roster`/`columns` ned. Pass `onDropToPool` til puljen og `onDropToColumn` til kolonnerne. Brug `effectiveColumns`-counts til `targetFull` og `c.lineup_locked`/frys til `targetLocked`.

```js
  function handleDrop(toKind, toRaceId, raw) {
    const payload = decodeDrag(raw); if (!payload) return;
    const target = effectiveColumns.find((c) => c.id === toRaceId);
    const targetFull = target ? (target.counts.selected >= (target.size?.max ?? Infinity)) : false;
    const targetLocked = target ? (!!target.lineup_locked || (target.stages_completed ?? 0) > 0) : false;
    const action = dropAction({ fromRaceId: payload.fromRaceId, toRaceId, toKind, targetFull, targetLocked });
    if (action === "add" || action === "move") addRider(toRaceId, payload.riderId);
    else if (action === "remove") removeRider(payload.fromRaceId, payload.riderId);
  }
```
(Importér `decodeDrag, dropAction` fra `../../lib/raceHubDnd.js`.)

- [ ] **Step 2: AvailableRidersPool — draggable chips + pool drop zone.**
  - Gør hver fri (ikke-låst) rytter-chip `draggable`, med `onDragStart={(e) => e.dataTransfer.setData("text/plain", encodeDrag({ riderId: r.id, fromRaceId: null }))}`.
  - Wrap puljen i en drop-zone: `onDragOver={(e) => e.preventDefault()}` + `onDrop={(e) => onDropToPool(e.dataTransfer.getData("text/plain"))}` + visuel highlight via en `dragOver`-state.

- [ ] **Step 3: RaceColumn — draggable rider rows + column drop zone.**
  - Gør hver rytter-række `draggable` med `fromRaceId: column.id` i payload. (Bevar rolle-chevron-klikket — drag starter kun på pointer-træk, klik forbliver klik.)
  - Wrap kolonnen i en drop-zone (`onDragOver` preventDefault + highlight + `onDrop` → `onDropToColumn(column.id, raw)`). Frosne/afmeldte kolonner accepterer ikke drop (ingen highlight).

- [ ] **Step 4: Verify** — `cd frontend && npm run build` grøn + `node --test` grøn. Manuelt på preview (Task 10): træk rytter mellem kolonner, fra/til pulje.

- [ ] **Step 5: Commit** — `git add frontend/src/components/racehub/*.jsx && git commit -m "feat(race-move): native HTML5 drag-and-drop på board (desktop)"`

---

## Task 8: i18n — move error codes + drag hint

**Files:**
- Modify: `frontend/public/locales/en/races.json`, `frontend/public/locales/da/races.json`

- [ ] **Step 1: Add keys under `selection.errors`** (INGEN em-dash — tone-guard):

en: `"move_target_full": "That race is already full. Remove a rider there first.", "move_target_locked": "That race has started, so its lineup is locked.", "move_wrong_pool": "You can only enter races in your own division.", "move_rider_ineligible": "That rider can't race for your team right now.", "move_invalid_body": "Couldn't move the rider. Try again.", "move_failed": "Couldn't move the rider. Try again."`

da: `"move_target_full": "Det løb er allerede fuldt. Fjern en rytter der først.", "move_target_locked": "Det løb er startet, så opstillingen er låst.", "move_wrong_pool": "Du kan kun stille op i din egen divisions løb.", "move_rider_ineligible": "Den rytter kan ikke køre for dit hold lige nu.", "move_invalid_body": "Kunne ikke flytte rytteren. Prøv igen.", "move_failed": "Kunne ikke flytte rytteren. Prøv igen."`

- [ ] **Step 2: Verify** — `cd frontend && node scripts/../../scripts/tone-check-em-dash.mjs` (fra repo-rod) grøn + key-coverage (begge sprog har samme nøgler).

- [ ] **Step 3: Commit** — `git commit -am "feat(race-move): i18n move-fejlkoder (en+da)"`

---

## Task 9: Patch note + help.json

**Files:**
- Modify: `frontend/src/data/patchNotes.js` (ny top-version 6.26), `docs/NOW.md`, `frontend/public/locales/{en,da}/help.json`, + refresh patch-notes snapshots.

- [ ] **Step 1: Add patch note 6.26** øverst i PATCHES (kategori `improved`, audience `player`, topic "Team selection", refs [1925]). Tekst (uden em-dash): EN "Move riders between races by dragging" / "On desktop you can now drag a rider straight from one race to another (or to and from the free-rider pool). The race you move them out of shows as understaffed until you fill it again. On phones the tap flow does the same thing." DA tilsvarende.

- [ ] **Step 2: help.json** — tilføj en kort sektion (en+da) under holdudtagelse: "Flyt rytter mellem løb" + at fuld opstilling kræves og afmeld er alternativet (jf. #1925-followup-noten om manglende help).

- [ ] **Step 3: NOW.md** — kort linje: move+DnD shippet (krævet af patch-notes-version-check sammen med patchNotes.js).

- [ ] **Step 4: Refresh snapshots** — `cd frontend && npx playwright test core-smoke.spec.js --update-snapshots` → commit de ændrede `patch-notes-*.png`.

- [ ] **Step 5: Commit** — `git add ... && git commit -m "docs(patch-notes): v6.26 flyt rytter + drag-and-drop + help.json"`

---

## Task 10: Verify + PR

- [ ] **Step 1: Full verify** — `pwsh -File scripts/verify-local.ps1` (backend + frontend tests + build) grøn. Desktop+mobile-chromium `npx playwright test core-smoke.spec.js` grøn (mobile-webkit-flake ignoreres).
- [ ] **Step 2: Preview-test** — manuelt: træk en rytter A→B (move), pulje→kolonne (add), kolonne→pulje (remove); bekræft popover/pulje afspejler kladden; bekræft mobil tap-flow stadig virker.
- [ ] **Step 3: Push + PR** — branch `feat/race-lineup-move-dnd`; PR-body med `## Brugerverifikation`-sektion; label `type:feature`, `cat:user-feature`. **Indeholder migration → ejer merger.** Linkes til #1925.
- [ ] **Step 4: Mark #1925** — kommentér at move+DnD-delen er shippet i denne PR.

---

## Notes / known edges

- **Move-detektion bruger SERVER-binding** (`data.bindingMap`), mens popover-OFFERING bruger kladde-binding (`draftBindingMap`). Bevidst: offering skal afspejle dine edits; eviction skal ramme DB.
- Hvis manageren har flere ustagede kladde-fjernelser i andre kolonner og laver et move, re-henter boardet server-sandheden (kladderne ryddes). Acceptabelt: move er en server-mutation. Granular persist-immediately for ALLE board-handlinger er en større, separat forenkling (ikke i scope).
