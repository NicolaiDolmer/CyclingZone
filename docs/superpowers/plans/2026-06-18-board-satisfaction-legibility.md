# Bestyrelses-tilfredshed bliver læsbar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log og vis bestyrelsens tilfredsheds-bevægelse løb-for-løb (retning ▲/▼, glat kurve, "hvorfor"), uden at røre selve mekanikken.

**Architecture:** Ny tabel `board_satisfaction_events` logges af den eksisterende weekend-mekanik (`boardWeekendFinalization.js`) hver gang den allerede opdaterer et board; kalderne (`raceRunner`, `pcmResultsImport`) sender løbs-kontekst med; `/board/status` returnerer de seneste events; `BoardPage.jsx` viser trend-pil in-season + en weekend-timeline + sparkline + en "hvorfor"-linje. **Visnings-only** — ingen ændring af tal/mekanik → ikke balance-følsom.

**Tech Stack:** Node.js + Express (backend), Supabase/Postgres (migration auto-applies i prod ved merge → **ejer merger PR'en**), React + Vite (frontend), `node --test` (begge), Playwright (visuel).

**Spec:** `docs/superpowers/specs/2026-06-18-board-satisfaction-legibility-design.md` · **Issue:** #1451 (afløser #1187).

---

## Task 0: Branch

- [ ] **Step 1: Opret feature-branch fra origin/main**

```bash
git fetch origin && git switch -c feat/1451-board-satisfaction-legibility origin/main
```

---

## Task 1: Migration — `board_satisfaction_events`

**Files:**
- Create: `database/2026-06-18-board-satisfaction-events.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- 2026-06-18 · board_satisfaction_events (#1451, afløser #1187).
-- Løb-for-løb log af bestyrelses-tilfredshedens bevægelse. VISNINGS-ONLY:
-- mekanikken (boardWeekendFinalization.js) er uændret — dette logger blot det
-- den allerede gør, så frontend kan vise retning + historik + "hvorfor".
-- Serveres KUN server-side via /board/status (service-role) → ingen anon GRANT.
CREATE TABLE IF NOT EXISTS public.board_satisfaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.board_profiles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  race_id uuid REFERENCES public.races(id) ON DELETE SET NULL,
  race_name text,
  race_days_completed integer,
  satisfaction_before integer NOT NULL,
  satisfaction_after integer NOT NULL,
  satisfaction_delta integer NOT NULL,
  goals_met integer NOT NULL DEFAULT 0,
  goals_total integer NOT NULL DEFAULT 0,
  reason_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotens: ét event pr. board pr. løb (re-import upserter samme row).
CREATE UNIQUE INDEX IF NOT EXISTS board_satisfaction_events_board_race_uniq
  ON public.board_satisfaction_events (board_id, race_id);

-- Hyppigste query: seneste events pr. board.
CREATE INDEX IF NOT EXISTS board_satisfaction_events_board_created_idx
  ON public.board_satisfaction_events (board_id, created_at DESC);
```

> Note: `race_id` er NOT-genereret men i praksis altid sat (begge kaldere har `race.id`). Koden (Task 3) skriver kun et event når `race_id` findes, så unique-indexet over `(board_id, race_id)` er altid det aktive — ingen NULL-dedup-kompleksitet.

- [ ] **Step 2: Syntaks-sanity (lokalt, ingen prod-kontakt)**

Læs filen igennem: alle FK-targets findes (`board_profiles`, `teams`, `seasons`, `races`), `gen_random_uuid()` er tilgængelig (pgcrypto er aktiv i prod). Ingen `GRANT` (server-side only).

- [ ] **Step 3: Commit**

```bash
git add database/2026-06-18-board-satisfaction-events.sql
git commit -m "feat(board): board_satisfaction_events tabel — løb-for-løb tilfredsheds-log (#1451)"
```

---

## Task 2: Ren helper `resolveReasonCategory`

**Files:**
- Modify: `backend/lib/boardWeekendUpdate.js`
- Test: `backend/lib/boardWeekendUpdate.test.js`

- [ ] **Step 1: Skriv den fejlende test**

Tilføj i `backend/lib/boardWeekendUpdate.test.js`:

```js
import { resolveReasonCategory } from "./boardWeekendUpdate.js";

test("resolveReasonCategory: positiv delta → strongest_category", () => {
  const evaluation = { feedback: { strongest_category: "results", weakest_category: "identity" } };
  assert.equal(resolveReasonCategory({ evaluation, satisfactionDelta: 3 }), "results");
});

test("resolveReasonCategory: negativ delta → weakest_category", () => {
  const evaluation = { feedback: { strongest_category: "results", weakest_category: "identity" } };
  assert.equal(resolveReasonCategory({ evaluation, satisfactionDelta: -2 }), "identity");
});

test("resolveReasonCategory: delta 0 eller manglende feedback → null", () => {
  assert.equal(resolveReasonCategory({ evaluation: { feedback: { strongest_category: "results" } }, satisfactionDelta: 0 }), null);
  assert.equal(resolveReasonCategory({ evaluation: null, satisfactionDelta: 3 }), null);
});
```

- [ ] **Step 2: Kør testen — verificér FAIL**

Run: `cd backend && node --test --test-name-pattern="resolveReasonCategory" lib/boardWeekendUpdate.test.js`
Expected: FAIL ("resolveReasonCategory is not a function" / import-fejl).

- [ ] **Step 3: Implementér helperen**

Tilføj i `backend/lib/boardWeekendUpdate.js` (efter `WEEKEND_SATISFACTION_CLAMP`-eksporten):

```js
/**
 * #1451 · "Hvorfor"-kategori for et weekend-event. Positiv bevægelse drives af
 * den stærkeste kategori, negativ af den svageste; flad bevægelse har ingen grund.
 * Ren funktion — ingen DB. Bruges af weekend-finalization-loggen + UI'et.
 */
export function resolveReasonCategory({ evaluation, satisfactionDelta } = {}) {
  const feedback = evaluation?.feedback;
  if (!feedback) return null;
  if (satisfactionDelta > 0) return feedback.strongest_category ?? null;
  if (satisfactionDelta < 0) return feedback.weakest_category ?? null;
  return null;
}
```

- [ ] **Step 4: Kør testen — verificér PASS**

Run: `cd backend && node --test --test-name-pattern="resolveReasonCategory" lib/boardWeekendUpdate.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/boardWeekendUpdate.js backend/lib/boardWeekendUpdate.test.js
git commit -m "feat(board): resolveReasonCategory helper til weekend-event hvorfor (#1451)"
```

---

## Task 3: Log eventet i `boardWeekendFinalization.js`

**Files:**
- Modify: `backend/lib/boardWeekendFinalization.js`
- Test: `backend/lib/boardWeekendFinalization.test.js`

- [ ] **Step 1: Udvid fake-supabase i testen med upsert**

I `backend/lib/boardWeekendFinalization.test.js`, i `makeFakeSupabase`'s `makeQuery`, tilføj en `upsert`-action ved siden af `update` (inde i `execute()`):

```js
      if (action === "upsert") {
        const rows = tableRows(table);
        const payloadArr = Array.isArray(payload) ? payload : [payload];
        for (const row of payloadArr) rows.push(clone(row));
        updates.push({ table, action: "upsert", payload: clone(payload) });
        return Promise.resolve({ data: clone(payloadArr), error: null });
      }
```

Og tilføj `upsert` til query-byggerens metoder (samme sted som `update`/`select` returneres):

```js
    upsert: (payload, _opts) => makeQuery(table, "upsert", payload),
```

- [ ] **Step 2: Skriv den fejlende test**

Tilføj en test der kører `processBoardWeekendFinalization` med `race` og asserterer at et event skrives:

```js
test("skriver board_satisfaction_events pr. board når race medsendes", async () => {
  const season = { id: "s2", number: 2, status: "active", race_days_completed: 10, race_days_total: 40 };
  const state = {
    teams: [{ id: "t1", user_id: "u1", name: "Alpha", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    board_profiles: [{ id: "b1", team_id: "t1", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 50, seasons_completed: 0 }],
    season_standings: [{ team_id: "t1", season_id: "s2", division: 1, stage_wins: 1, gc_wins: 0 }],
    riders: [], loans: [], board_plan_snapshots: [], board_satisfaction_events: [],
  };
  const supabase = makeFakeSupabase(state);
  await processBoardWeekendFinalization({
    supabase, season, previousRaceDaysCompleted: 8,
    race: { id: "r9", name: "Critérium du Dauphiné" },
    deps: {
      isBoardTestModeActive: async () => false,
      loadGoalContext: async () => ({}),
      computeWeekendUpdate: () => ({
        previousSatisfaction: 50, newSatisfaction: 53, appliedDelta: 3,
        newModifier: 1.0, goalsMet: 2, goalsTotal: 3,
        evaluation: { feedback: { strongest_category: "results", weakest_category: "identity" } },
      }),
    },
  });
  assert.equal(state.board_satisfaction_events.length, 1);
  const ev = state.board_satisfaction_events[0];
  assert.equal(ev.board_id, "b1");
  assert.equal(ev.race_id, "r9");
  assert.equal(ev.race_name, "Critérium du Dauphiné");
  assert.equal(ev.satisfaction_delta, 3);
  assert.equal(ev.reason_category, "results");
});

test("skriver IKKE event når race mangler", async () => {
  const season = { id: "s2", number: 2, status: "active", race_days_completed: 10, race_days_total: 40 };
  const state = {
    teams: [{ id: "t1", user_id: "u1", name: "Alpha", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    board_profiles: [{ id: "b1", team_id: "t1", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 50, seasons_completed: 0 }],
    season_standings: [{ team_id: "t1", season_id: "s2", division: 1, stage_wins: 0, gc_wins: 0 }],
    riders: [], loans: [], board_plan_snapshots: [], board_satisfaction_events: [],
  };
  const supabase = makeFakeSupabase(state);
  await processBoardWeekendFinalization({
    supabase, season, previousRaceDaysCompleted: 8,
    deps: {
      isBoardTestModeActive: async () => false,
      loadGoalContext: async () => ({}),
      computeWeekendUpdate: () => ({
        previousSatisfaction: 50, newSatisfaction: 53, appliedDelta: 3,
        newModifier: 1.0, goalsMet: 2, goalsTotal: 3, evaluation: { feedback: {} },
      }),
    },
  });
  assert.equal(state.board_satisfaction_events.length, 0);
});
```

- [ ] **Step 3: Kør testen — verificér FAIL**

Run: `cd backend && node --test --test-name-pattern="board_satisfaction_events|IKKE event" lib/boardWeekendFinalization.test.js`
Expected: FAIL (0 events skrevet — endnu ingen logning).

- [ ] **Step 4: Implementér event-loggen**

I `backend/lib/boardWeekendFinalization.js`:

(a) Udvid importen fra boardWeekendUpdate:
```js
import {
  computeWeekendSatisfactionUpdate,
  resolveReasonCategory,
  CHECKPOINT_KINDS,
} from "./boardWeekendUpdate.js";
```

(b) Tilføj `race = null` til funktions-parametrene på `processBoardWeekendFinalization({ ... })`.

(c) Initialisér `summary.events_written = 0` ved siden af de andre summary-felter.

(d) Lige EFTER den vellykkede `board_profiles`-update (efter `summary.boards_updated += 1;`, ~linje 303), indsæt:
```js
        if (race?.id) {
          const { error: eventError } = await supabase
            .from("board_satisfaction_events")
            .upsert({
              board_id: board.id,
              team_id: team.id,
              season_id: season.id,
              race_id: race.id,
              race_name: race.name ?? null,
              race_days_completed: season.race_days_completed ?? null,
              satisfaction_before: update.previousSatisfaction,
              satisfaction_after: update.newSatisfaction,
              satisfaction_delta: update.appliedDelta,
              goals_met: update.goalsMet,
              goals_total: update.goalsTotal,
              reason_category: resolveReasonCategory({
                evaluation: update.evaluation,
                satisfactionDelta: update.appliedDelta,
              }),
            }, { onConflict: "board_id,race_id" });
          if (eventError) {
            summary.errors += 1;
            console.error(`  ⚠️  board satisfaction event failed for ${team.name}:`, eventError.message);
          } else {
            summary.events_written += 1;
          }
        }
```

- [ ] **Step 5: Kør testen — verificér PASS**

Run: `cd backend && node --test lib/boardWeekendFinalization.test.js`
Expected: PASS (inkl. de to nye + alle eksisterende).

- [ ] **Step 6: Commit**

```bash
git add backend/lib/boardWeekendFinalization.js backend/lib/boardWeekendFinalization.test.js
git commit -m "feat(board): log board_satisfaction_events i weekend-finalization (#1451)"
```

---

## Task 4: Send løbs-kontekst fra kalderne

**Files:**
- Modify: `backend/lib/raceRunner.js` (board-weekend-kaldet, ~linje 562-571)
- Modify: `backend/lib/pcmResultsImport.js` (board-weekend-kaldet, ~linje 511)

- [ ] **Step 1: raceRunner — tilføj race-kontekst**

I `backend/lib/raceRunner.js`, i `processBoardWeekend({ ... })`-kaldet, tilføj `race`:
```js
      await processBoardWeekend({
        supabase,
        season: {
          ...seasonBefore,
          race_days_completed: Number.isFinite(Number(newRaceDaysCompleted))
            ? newRaceDaysCompleted
            : seasonBefore.race_days_completed,
        },
        previousRaceDaysCompleted: seasonBefore.race_days_completed ?? null,
        race: { id: race.id, name: race.name },
      });
```

- [ ] **Step 2: pcmResultsImport — tilføj race-kontekst**

I `backend/lib/pcmResultsImport.js`, i `processBoardWeekend({ ... })`-kaldet (~linje 511), tilføj `race: { id: race.id, name: race.name }` på samme måde.

- [ ] **Step 3: Verificér eksisterende caller-tests stadig passerer**

Run: `cd backend && node --test lib/raceRunner.test.js lib/pcmResultsImport.test.js`
Expected: PASS (race-feltet er additivt; ingen eksisterende assertion brydes). Hvis en caller-test mocker `processBoardWeekend` og asserterer argument-shape, opdatér den til at forvente `race`.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/pcmResultsImport.js backend/lib/raceRunner.test.js backend/lib/pcmResultsImport.test.js
git commit -m "feat(board): send løbs-kontekst til weekend-event-loggen (#1451)"
```

---

## Task 5: Eksponér `satisfaction_events` på `/board/status`

**Files:**
- Modify: `backend/routes/api.js` (`/board/status`-handler, ~linje 7059-7076 + plan-bygge-loopet ~7197-7201)

- [ ] **Step 1: Hent events parallelt med snapshots**

I `if (boardIds.length > 0) {`-blokken (~7060), tilføj en tredje query i `Promise.all` + udpak den med `isMissingTable`-guard (samme mønster som `board_request_log`):

```js
      const [snapshotsRes, requestsRes, eventsRes] = await Promise.all([
        supabase.from("board_plan_snapshots").select("*")
          .in("board_id", boardIds)
          .order("season_within_plan", { ascending: true }),
        supabase.from("board_request_log")
          .select("id, board_id, request_type, outcome, title, summary, tradeoff_summary, request_payload, board_changes, season_number, created_at")
          .in("board_id", boardIds)
          .order("created_at", { ascending: false }),
        supabase.from("board_satisfaction_events")
          .select("board_id, race_name, race_days_completed, satisfaction_before, satisfaction_after, satisfaction_delta, goals_met, goals_total, reason_category, created_at")
          .in("board_id", boardIds)
          .order("created_at", { ascending: false }),
      ]);
```

Efter `allSnapshots = ...`/`allRequestLogs = ...` (~7074), tilføj:
```js
      const eventsSupported = !isMissingTable(eventsRes.error, "board_satisfaction_events");
      if (eventsRes.error && eventsSupported) return res.status(500).json({ error: eventsRes.error.message });
      allEvents = eventsSupported ? (eventsRes.data || []) : [];
```

Og deklarér `let allEvents = [];` ved siden af `let allSnapshots = [];` (~7055).

- [ ] **Step 2: Attach seneste 10 events pr. plan**

Find linjen i plan-bygge-loopet hvor `boardSnapshots` udledes (filtrering af `allSnapshots` på `board.id`). Lige før `plans[planType] = {` tilføj:
```js
      const boardEvents = allEvents.filter((e) => e.board_id === board.id).slice(0, 10);
```
Og i `plans[planType] = { ... }`-objektet, ved siden af `snapshots: boardSnapshots,` tilføj:
```js
        satisfaction_events: boardEvents,
```

- [ ] **Step 3: Verificér backend starter + endpoint svarer**

Run: `cd backend && node --check routes/api.js && node --test lib/boardWeekendFinalization.test.js`
Expected: `node --check` exit 0; eksisterende tests PASS. (Endpoint-svar verificeres end-to-end i frontend-tasken via Playwright-mock.)

- [ ] **Step 4: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(board): /board/status returnerer satisfaction_events (#1451)"
```

---

## Task 6: Frontend — trend in-season + weekend-timeline + sparkline + hvorfor

**Files:**
- Modify: `frontend/src/lib/boardUtils.js`
- Test: `frontend/src/lib/boardUtils.test.js`
- Create: `frontend/src/components/board/BoardSatisfactionTimeline.jsx`
- Modify: `frontend/src/pages/BoardPage.jsx`
- Modify: `frontend/src/locales/en/board.json` + `frontend/src/locales/da/board.json` (i18n-keys)

- [ ] **Step 1: Skriv fejlende test for trend-fra-events helper**

Tilføj i `frontend/src/lib/boardUtils.test.js`:
```js
import { getEventSatisfactionTrend } from "./boardUtils";

test("getEventSatisfactionTrend: seneste event styrer pilen", () => {
  const events = [
    { created_at: "2026-06-18T10:00:00Z", satisfaction_delta: 3 },
    { created_at: "2026-06-17T10:00:00Z", satisfaction_delta: -2 },
  ];
  assert.equal(getEventSatisfactionTrend(events).key, "up");
});
test("getEventSatisfactionTrend: tom liste → null", () => {
  assert.equal(getEventSatisfactionTrend([]), null);
});
```

- [ ] **Step 2: Kør test — verificér FAIL**

Run: `cd frontend && node --test src/lib/boardUtils.test.js`
Expected: FAIL (`getEventSatisfactionTrend` ikke eksporteret).

- [ ] **Step 3: Implementér helperen**

Tilføj i `frontend/src/lib/boardUtils.js`:
```js
// #1451 · Trend-pil fra det seneste løbs-event (in-season, modsat den
// sæson-slut-baserede getSatisfactionTrend). Returnerer null når ingen events.
export function getEventSatisfactionTrend(events) {
  if (!events?.length) return null;
  const latest = events.reduce((a, b) =>
    (b.created_at ?? "") > (a.created_at ?? "") ? b : a);
  const delta = latest?.satisfaction_delta ?? 0;
  if (delta > 0) return { glyph: "▲", color: "text-cz-success", key: "up", delta };
  if (delta < 0) return { glyph: "▼", color: "text-cz-danger", key: "down", delta };
  return { glyph: "→", color: "text-cz-3", key: "flat", delta: 0 };
}
```

- [ ] **Step 4: Kør test — verificér PASS**

Run: `cd frontend && node --test src/lib/boardUtils.test.js`
Expected: PASS.

- [ ] **Step 5: Byg timeline-komponenten**

Create `frontend/src/components/board/BoardSatisfactionTimeline.jsx` (editorial brand, cz-tokens; EN-først/DA via i18n):
```jsx
import { useTranslation } from "react-i18next";

// #1451 · Løb-for-løb historik for bestyrelsens tilfredshed. Visnings-only:
// renderer board_satisfaction_events fra /board/status. Tom → render intet
// (så panelet ikke står med en gabende boks før første weekend).
export default function BoardSatisfactionTimeline({ events = [] }) {
  const { t } = useTranslation("board");
  if (!events.length) return null;
  const rows = [...events].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return (
    <div className="mt-4">
      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("satisfactionTimeline.heading")}</p>
      <div className="divide-y divide-cz-border">
        {rows.map((e, i) => {
          const up = e.satisfaction_delta > 0;
          const flat = e.satisfaction_delta === 0;
          const deltaColor = flat ? "text-cz-3" : up ? "text-cz-success" : "text-cz-danger";
          const sign = up ? "+" : "";
          return (
            <div key={`${e.race_name}-${e.created_at}-${i}`} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="text-cz-1 text-sm font-medium truncate">{e.race_name || t("satisfactionTimeline.unknownRace")}</p>
                <p className="text-cz-3 text-xs">
                  {t("satisfactionTimeline.goals", { met: e.goals_met, total: e.goals_total })}
                  {e.reason_category ? ` · ${t(`category.${e.reason_category}`, { defaultValue: e.reason_category })}` : ""}
                </p>
              </div>
              <span className={`text-sm font-medium tabular-nums ${deltaColor}`}>
                {flat ? t("satisfactionTimeline.flat") : `${sign}${e.satisfaction_delta}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Tilføj i18n-keys**

I `frontend/src/locales/en/board.json` tilføj:
```json
"satisfactionTimeline": {
  "heading": "Weekend by weekend",
  "goals": "{{met}}/{{total}} goals met",
  "flat": "no change",
  "unknownRace": "Race weekend"
},
"category": { "results": "Results", "economy": "Finances", "identity": "Identity", "ranking": "Ranking" }
```
I `frontend/src/locales/da/board.json` tilføj samme nøgler:
```json
"satisfactionTimeline": {
  "heading": "Weekend for weekend",
  "goals": "{{met}}/{{total}} mål nået",
  "flat": "ingen ændring",
  "unknownRace": "Løbsweekend"
},
"category": { "results": "Resultater", "economy": "Økonomi", "identity": "Identitet", "ranking": "Rangering" }
```
> Hvis `category.*` allerede findes i board.json, genbrug de eksisterende og udelad dubletten.

- [ ] **Step 7: Wire ind i BoardPage plan-panelet**

I `frontend/src/pages/BoardPage.jsx`:
- Importér: `import BoardSatisfactionTimeline from "../components/board/BoardSatisfactionTimeline";` og tilføj `getEventSatisfactionTrend` til den eksisterende boardUtils-import.
- I plan-panel-komponenten (hvor `trend = getSatisfactionTrend(snapshots)` sættes, ~linje 1367): foretræk in-season-event-trenden:
```jsx
  const events = plan?.satisfaction_events ?? [];
  const trend = getEventSatisfactionTrend(events) ?? getSatisfactionTrend(snapshots);
```
- Render `<BoardSatisfactionTimeline events={events} />` lige under `SatisfactionMeter`/tilfredsheds-blokken i plan-panelet (samme sted historik-tabellen ellers vises).

- [ ] **Step 8: Kør frontend-tests + lint**

Run: `cd frontend && node --test src/lib/boardUtils.test.js && npm run lint`
Expected: PASS, 0 lint-fejl. (Bekræfter også at den nye komponents import-sti er korrekt — Node's ESM-loader er strengere end Vite.)

- [ ] **Step 9: Verificér visuelt via Playwright-mock (logget-ind)**

Run: `cd frontend && npx playwright test core-smoke.spec.js`
Hvis board-panelet ændrer sig visuelt: `npx playwright test core-smoke --update-snapshots` (alle 3 projekter) og commit PNG'erne.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/boardUtils.js frontend/src/lib/boardUtils.test.js frontend/src/components/board/BoardSatisfactionTimeline.jsx frontend/src/pages/BoardPage.jsx frontend/src/locales/en/board.json frontend/src/locales/da/board.json
git commit -m "feat(board): in-season trend + weekend-timeline + hvorfor på board-siden (#1451)"
```

---

## Task 7: Patch notes + help

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `frontend/src/locales/en/help.json` + `frontend/src/locales/da/help.json` (hvis board-FAQ findes)

- [ ] **Step 1: Tilføj patch-note-entry**

Tilføj en ny version-entry øverst i `PatchNotesPage.jsx` (følg eksisterende format/versions-nummerering): "Bestyrelsen viser nu løb-for-løb hvorfor jeres tilfredshed flytter sig — med retning og historik." (EN + DA).

- [ ] **Step 2: Opdatér board-hjælp hvis relevant**

Hvis `help.json` har en board/tilfredsheds-sektion: tilføj en linje om at tilfredsheden nu bevæger sig løb-for-løb og kan følges på board-siden. Ellers skriv i commit-beskeden hvorfor ikke.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PatchNotesPage.jsx frontend/src/locales/en/help.json frontend/src/locales/da/help.json
git commit -m "docs(board): patch notes + help for løb-for-løb tilfredshed (#1451)"
```

---

## Task 8: Fuld gate + PR

- [ ] **Step 1: Kør hele lokale gate-sættet**

Run: `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + build)
Derefter: `cd frontend && npm run lint` + i18n-leak + tone-em-dash + warning-budget (jf. CLAUDE.md pre-flight).
Expected: alt grønt.

- [ ] **Step 2: Push + opret PR**

```bash
git push -u origin feat/1451-board-satisfaction-legibility
gh pr create --title "feat(board): bestyrelses-tilfredshed bliver læsbar — løb-for-løb (#1451)" --body "<Brugerverifikation-sektion + Refs #1451>"
```

> **PR'en indeholder en `database/*.sql`-migration → AUTO-MERGE FORBUDT. Ejer merger** (migrationen auto-applies i prod ved merge). PR-body SKAL have en udfyldt Brugerverifikation-sektion (ellers fejler `PR user-verification check`).

- [ ] **Step 3: Efter ejer-merge — verificér i prod**

Når migrationen er anvendt: bekræft at næste løbs-finalisering skriver et event (`select count(*) from board_satisfaction_events`) og at board-siden viser timeline + pil for et ægte hold.

---

## Self-review (udført)

- **Spec-dækning:** §4.1 tabel → Task 1 · §4.2 backend-log → Task 2+3 · kalder-kontekst → Task 4 · §4.3 API → Task 5 · §4.4 frontend → Task 6 · §6 verifikation → Task 6/8 · patch notes/help → Task 7. Alle dækket.
- **Placeholders:** ingen "TBD/TODO"; alle kode-steps har faktisk kode; PR-body-Brugerverifikation udfyldes ved Task 8 (kan ikke forudskrives generisk).
- **Type-konsistens:** `resolveReasonCategory({ evaluation, satisfactionDelta })` ens i Task 2/3 · event-felter ens i migration (Task 1), write (Task 3), API-select (Task 5), frontend-forbrug (Task 6) · `satisfaction_events` brugt ens i API (Task 5) og frontend (`plan.satisfaction_events`, Task 6).
