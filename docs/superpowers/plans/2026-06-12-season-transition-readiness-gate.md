# Season-Transition Readiness-Gate Implementation Plan (#1346)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side readiness-gate på `POST /api/admin/season-transition` så et fejlklik ikke kan lukke en aktiv sæson med åbent transfervindue/uafviklede løb; UI viser gate-status og disabler knappen med årsager; eksplicit force-override (logget i admin_log).

**Architecture:** Ny lib-funktion `assessTransitionReadiness` (genbruger auto-cron'ens "wrapped window"-semantik: closed + closed_at + final whistle + squad enforcement, plus 0 aktive auktioner og alle løb afviklet). Gaten håndhæves KUN i admin-route-handleren — cron (`seasonAutoTransition.js`, pre-checker selv), relaunch-orchestratoren (#1103) og `scripts/executeSeasonTransition.js` kalder `transitionToNextSeason` direkte og er bevidst ugatede. Preview-endpointet returnerer samme readiness så UI og server aldrig driver.

**Tech Stack:** Node.js + Express (backend), node:test (begge ender), React + Vite (frontend), Supabase service-role client.

**Ejer-beslutninger (12/6, AskUserQuestion):** Force-override = ja, checkbox i UI + logget. "Alle løb afviklet" = kritisk (blokerende) check.

**Branch:** `fix/1346-season-transition-readiness-gate` fra `origin/main`. Ingen DB-migration → auto-merge tilladt efter grønne checks. PR-body SKAL have `## Brugerverifikation`-sektion med `- [x]`-punkter.

---

## File Structure

| Fil | Ansvar |
|-----|--------|
| Create: `backend/lib/seasonTransitionReadiness.js` | `assessTransitionReadiness({ supabase, fromSeasonId })` → `{ ready, checks, failed_critical }` |
| Create: `backend/lib/seasonTransitionReadiness.test.js` | Unit-tests med egen minimal mock-supabase |
| Modify: `backend/routes/api.js` (~linje 56 import; ~5516-5558 begge endpoints) | Import + readiness i preview-response + 409-gate/force-log i POST |
| Modify: `backend/lib/seasonTransitionRoute.test.js` | Regex-baserede route-tests for gate, 409, force, preview-readiness |
| Create: `frontend/src/lib/seasonTransitionGate.js` | Pure helper `summarizeTransitionReadiness` + danske labels |
| Create: `frontend/src/lib/seasonTransitionGate.test.js` | node:test af helperen |
| Modify: `frontend/src/components/admin/SeasonCycleSection.jsx` | Checklist-kort, disabled knap med årsager, force-checkbox, 409-håndtering |
| Create: `.claude/learnings/2026-06-12-season-transition-no-server-gate.md` | Postmortem (bugfix-rutine) |

**Domæne-noter til implementøren:**
- "Racing-window": `transitionToNextSeason` føder nye vinduer med `status='closed'` men `closed_at=null`. Et vindue er kun "rigtigt lukket" når BÅDE `status='closed'` OG `closed_at` er sat (samme skelnen som `seasonAutoTransition.js:25-39`, sæson-loop-bug 2026-05-21).
- Resume-stien (#578/#1166: fromSeason='completed' + toSeason eksisterer) passerer gaten naturligt i normal drift (deadline-vinduet var wrapped før transitionen startede). Force-flaget dækker unormale resume-tilstande.
- `dryRun=true` skal IKKE gates (ingen writes; bruges af sim-scripts).
- Admin-UI'et er hard-coded dansk (ingen i18n-keys) — følg `DeadlineReadinessSection.jsx`-konventionen. Undgå em-dash (tankestreg) i nye UI-strenge (#1336).
- `ADMIN_ACTION_TYPE.MANUAL_OVERRIDE` (`backend/lib/economyConstants.js:111`) bruges til force-loggen — IKKE `SEASON_TRANSITION`, for `dailySeasonCountCheck.js` tæller `season_transition`-rows som faktiske transitions (dobbelt-tælling ville udløse falsk alarm).
- Frontend-imports: `.jsx`-komponenter må importere extensionless (Vite), men test-filer og alt de transitivt importerer SKAL have `.js`-extension (Node ESM-loader i CI, #803).

---

### Task 1: Backend readiness-lib (TDD)

**Files:**
- Create: `backend/lib/seasonTransitionReadiness.test.js`
- Create: `backend/lib/seasonTransitionReadiness.js`

- [ ] **Step 1: Skriv den fejlende test**

Opret `backend/lib/seasonTransitionReadiness.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { assessTransitionReadiness } from "./seasonTransitionReadiness.js";

// ─── Mock Supabase ────────────────────────────────────────────────────────────
// Dækker præcis de tre queries assessTransitionReadiness laver:
//   transfer_windows: select().eq().order().limit().maybeSingle()
//   auctions:         select(_, {count,head}).in()  → thenable {count}
//   races:            select(_, {count,head}).eq().neq() → thenable {count}

function createMockSupabase({ win = null, activeAuctionCount = 0, unfinishedRaceCount = 0 } = {}) {
  const thenableCount = (count) => ({
    then: (resolve) => resolve({ data: null, count, error: null }),
  });
  return {
    from(table) {
      if (table === "transfer_windows") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: win, error: null }),
        };
        return { select: () => chain };
      }
      if (table === "auctions") {
        return { select: () => ({ in: () => thenableCount(activeAuctionCount) }) };
      }
      if (table === "races") {
        const chain = { eq: () => chain, neq: () => thenableCount(unfinishedRaceCount) };
        return { select: () => chain };
      }
      throw new Error(`Uventet tabel i mock: ${table}`);
    },
  };
}

const WRAPPED_WINDOW = {
  id: "w-1",
  status: "closed",
  closed_at: "2026-06-10T18:00:00Z",
  final_whistle_sent_at: "2026-06-10T18:05:00Z",
  squad_enforcement_completed_at: "2026-06-10T18:10:00Z",
};

const FROM_SEASON_ID = "00000000-0000-0000-0000-000000000001";

test("assessTransitionReadiness — wrapped vindue + 0 auktioner + 0 uafviklede løb = ready", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, true);
  assert.deepEqual(result.failed_critical, []);
  for (const [key, check] of Object.entries(result.checks)) {
    assert.equal(check.ok, true, `check '${key}' skulle være ok`);
    assert.equal(check.critical, true, `check '${key}' skal være kritisk`);
  }
  assert.deepEqual(
    Object.keys(result.checks).sort(),
    ["all_races_completed", "final_whistle_sent", "no_active_auctions", "squad_enforcement_completed", "window_closed"],
  );
});

test("assessTransitionReadiness — åbent vindue blokerer (window_closed=false)", async () => {
  const supabase = createMockSupabase({
    win: { id: "w-2", status: "open", closed_at: null, final_whistle_sent_at: null, squad_enforcement_completed_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false);
  assert.ok(result.failed_critical.includes("window_closed"));
});

test("assessTransitionReadiness — racing-window (closed men closed_at=null) blokerer", async () => {
  const supabase = createMockSupabase({
    win: { id: "w-3", status: "closed", closed_at: null, final_whistle_sent_at: null, squad_enforcement_completed_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false, "racing-window må ikke tælle som lukket deadline-vindue");
});

test("assessTransitionReadiness — manglende final whistle blokerer", async () => {
  const supabase = createMockSupabase({
    win: { ...WRAPPED_WINDOW, final_whistle_sent_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, true);
  assert.equal(result.checks.final_whistle_sent.ok, false);
});

test("assessTransitionReadiness — manglende squad enforcement blokerer", async () => {
  const supabase = createMockSupabase({
    win: { ...WRAPPED_WINDOW, squad_enforcement_completed_at: null },
  });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.squad_enforcement_completed.ok, false);
});

test("assessTransitionReadiness — aktive auktioner blokerer med antal i detail", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, activeAuctionCount: 2 });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.no_active_auctions.ok, false);
  assert.match(result.checks.no_active_auctions.detail, /2/);
});

test("assessTransitionReadiness — uafviklede løb blokerer med antal i detail", async () => {
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW, unfinishedRaceCount: 3 });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.all_races_completed.ok, false);
  assert.match(result.checks.all_races_completed.detail, /3/);
});

test("assessTransitionReadiness — intet vindue overhovedet blokerer", async () => {
  const supabase = createMockSupabase({ win: null });
  const result = await assessTransitionReadiness({ supabase, fromSeasonId: FROM_SEASON_ID });
  assert.equal(result.ready, false);
  assert.equal(result.checks.window_closed.ok, false);
  assert.equal(result.checks.final_whistle_sent.ok, false);
  assert.equal(result.checks.squad_enforcement_completed.ok, false);
});

test("assessTransitionReadiness — kræver supabase og fromSeasonId", async () => {
  await assert.rejects(() => assessTransitionReadiness({ supabase: null, fromSeasonId: FROM_SEASON_ID }));
  const supabase = createMockSupabase({ win: WRAPPED_WINDOW });
  await assert.rejects(() => assessTransitionReadiness({ supabase, fromSeasonId: null }));
});
```

- [ ] **Step 2: Kør testen og verificér at den fejler**

Kør (fra `backend/`): `node --test lib/seasonTransitionReadiness.test.js`
Forventet: FAIL med `Cannot find module ... seasonTransitionReadiness.js`

- [ ] **Step 3: Skriv implementeringen**

Opret `backend/lib/seasonTransitionReadiness.js`:

```js
/**
 * #1346 — Readiness-gate for manuel sæson-transition.
 * =====================================================
 * Genbruger auto-cron'ens "wrapped window"-semantik (seasonAutoTransition.js):
 * den afgående sæsons seneste transfervindue skal være lukket via deadline-
 * cyklussen (status='closed' OG closed_at sat — et racing-window født af
 * transitionToNextSeason har closed_at=null og tæller IKKE), final whistle
 * sendt og squad enforcement kørt. Dertil: ingen aktive auktioner og alle
 * sæsonens løb afviklet (ejer-beslutning 12/6: kritisk check).
 *
 * Gaten håndhæves i POST /api/admin/season-transition (routes/api.js).
 * Cron, relaunch-orchestratoren (#1103) og scripts/executeSeasonTransition.js
 * kalder transitionToNextSeason direkte og er bevidst ugatede.
 */

export async function assessTransitionReadiness({ supabase, fromSeasonId } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!fromSeasonId) throw new Error("fromSeasonId required");

  const [windowRes, auctionsRes, racesRes] = await Promise.all([
    supabase
      .from("transfer_windows")
      .select("id, status, closed_at, final_whistle_sent_at, squad_enforcement_completed_at")
      .eq("season_id", fromSeasonId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "extended"]),
    supabase
      .from("races")
      .select("id", { count: "exact", head: true })
      .eq("season_id", fromSeasonId)
      .neq("status", "completed"),
  ]);

  if (windowRes.error) throw new Error(`Kunne ikke læse transfervindue: ${windowRes.error.message}`);
  if (auctionsRes.error) throw new Error(`Kunne ikke tælle auktioner: ${auctionsRes.error.message}`);
  if (racesRes.error) throw new Error(`Kunne ikke tælle løb: ${racesRes.error.message}`);

  const win = windowRes.data;
  const activeAuctions = auctionsRes.count || 0;
  const unfinishedRaces = racesRes.count || 0;

  const windowClosed = Boolean(win && win.status === "closed" && win.closed_at);
  const windowDetail = !win
    ? "Intet transfervindue fundet for sæsonen, deadline-cyklussen er ikke kørt"
    : win.status !== "closed"
      ? `Vinduet har status '${win.status}'`
      : !win.closed_at
        ? "Vinduet er aldrig lukket via deadline-cyklussen (closed_at mangler)"
        : null;

  const checks = {
    window_closed: { ok: windowClosed, critical: true, detail: windowDetail },
    final_whistle_sent: {
      ok: Boolean(win?.final_whistle_sent_at),
      critical: true,
      detail: win?.final_whistle_sent_at ? null : "final_whistle_sent_at mangler på vinduet",
    },
    squad_enforcement_completed: {
      ok: Boolean(win?.squad_enforcement_completed_at),
      critical: true,
      detail: win?.squad_enforcement_completed_at ? null : "squad_enforcement_completed_at mangler på vinduet",
    },
    no_active_auctions: {
      ok: activeAuctions === 0,
      critical: true,
      detail: activeAuctions === 0 ? null : `${activeAuctions} aktive/forlængede auktioner`,
    },
    all_races_completed: {
      ok: unfinishedRaces === 0,
      critical: true,
      detail: unfinishedRaces === 0 ? null : `${unfinishedRaces} løb er ikke afviklet (status er ikke 'completed')`,
    },
  };

  const failed_critical = Object.entries(checks)
    .filter(([, c]) => c.critical && !c.ok)
    .map(([key]) => key);

  return { ready: failed_critical.length === 0, checks, failed_critical };
}
```

- [ ] **Step 4: Kør testen og verificér at den passerer**

Kør (fra `backend/`): `node --test lib/seasonTransitionReadiness.test.js`
Forventet: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/seasonTransitionReadiness.js backend/lib/seasonTransitionReadiness.test.js
git commit -m "fix(season): assessTransitionReadiness lib, wrapped-window-semantik som gate-grundlag

Refs #1346"
```

---

### Task 2: Route-wiring (preview + 409-gate + force-log)

**Files:**
- Modify: `backend/lib/seasonTransitionRoute.test.js` (tilføj tests i bunden)
- Modify: `backend/routes/api.js` (import ~linje 50-60; preview-handler ~5520-5529; POST-handler ~5534-5558)

- [ ] **Step 1: Skriv de fejlende route-tests**

Tilføj nederst i `backend/lib/seasonTransitionRoute.test.js`:

```js
// ============================================================
// #1346 — server-side readiness-gate på manuel transition.
// Endpointet må ikke kunne lukke en aktiv sæson med åbent
// vindue/uafviklede løb ved et fejlklik. Force-override er
// eksplicit og logges i admin_log (MANUAL_OVERRIDE, ikke
// SEASON_TRANSITION som dailySeasonCountCheck tæller på).
// ============================================================

test("routes/api.js importerer assessTransitionReadiness fra seasonTransitionReadiness.js (#1346)", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*assessTransitionReadiness[^}]*\}\s*from\s*"\.\.\/lib\/seasonTransitionReadiness\.js"/,
  );
});

test("udfør-handler kører readiness-gate FØR transitionToNextSeason og kan svare 409 (#1346)", () => {
  const block = isolateExecuteHandler();
  assert.match(block, /assessTransitionReadiness\(/, "POST skal beregne readiness");
  assert.match(block, /status\(409\)/, "rød gate uden force skal afvises med 409");
  assert.match(block, /force/, "force-flag fra body skal respekteres");
  assert.ok(
    block.indexOf("assessTransitionReadiness") < block.indexOf("transitionToNextSeason("),
    "gaten skal stå FØR transition-kaldet, ellers er writes allerede sket",
  );
});

test("udfør-handler logger force-override i admin_log med MANUAL_OVERRIDE (#1346)", () => {
  const block = isolateExecuteHandler();
  assert.match(block, /ADMIN_ACTION_TYPE\.MANUAL_OVERRIDE/, "force skal logges som manual_override");
  assert.doesNotMatch(
    block,
    /action_type:\s*ADMIN_ACTION_TYPE\.SEASON_TRANSITION/,
    "force-loggen må IKKE bruge season_transition (dobbelt-tælling i dailySeasonCountCheck)",
  );
});

test("preview-handler returnerer readiness sammen med planen (#1346)", () => {
  const block = isolatePreviewHandler();
  assert.match(block, /assessTransitionReadiness\(/, "preview skal beregne samme readiness som udfør");
  assert.match(block, /readiness/, "preview-response skal indeholde readiness");
});
```

- [ ] **Step 2: Kør testen og verificér at de nye tests fejler**

Kør (fra `backend/`): `node --test lib/seasonTransitionRoute.test.js`
Forventet: de 4 nye tests FAIL ("Kunne ikke..."), de 5 gamle PASS.

- [ ] **Step 3: Implementér route-ændringerne**

I `backend/routes/api.js`:

**(a) Import** — find import-blokken fra `../lib/seasonTransition.js` (~linje 50-60, indeholder `transitionToNextSeason`). Tilføj NY linje lige under den blok:

```js
import { assessTransitionReadiness } from "../lib/seasonTransitionReadiness.js";
```

**(b) Preview-handler** — erstat hele `router.get("/admin/season-transition/preview", ...)`-blokken (linje 5520-5529) med:

```js
router.get("/admin/season-transition/preview", requireAdmin, async (req, res) => {
  try {
    const fromSeason = await resolveTransitionSourceSeason({ supabase });
    if (!fromSeason) {
      return res.status(404).json({ error: "Ingen aktiv eller afsluttet sæson fundet" });
    }
    const plan = await buildTransitionPlan({ supabase, fromSeasonId: fromSeason.id });
    // #1346: samme readiness-beregning som udfør-endpointet, så UI'et kan
    // disable knappen med konkrete årsager uden at drive fra server-gaten.
    const readiness = await assessTransitionReadiness({ supabase, fromSeasonId: fromSeason.id });
    res.json({ ok: true, plan, readiness });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

**(c) POST-handler** — erstat hele `router.post("/admin/season-transition", ...)`-blokken (linje 5534-5558) med:

```js
router.post("/admin/season-transition", requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { fromSeasonId: bodyFromSeasonId, transitionAt, dryRun = false, force = false } = req.body || {};
    let fromSeasonId = bodyFromSeasonId;
    if (!fromSeasonId) {
      // #1166: samme fallback som preview-endpointet — seneste 'completed'
      // sæson når ingen 'active' findes (resume-stien, #578).
      const fromSeason = await resolveTransitionSourceSeason({ supabase });
      if (!fromSeason) {
        return res.status(404).json({ error: "Ingen aktiv eller afsluttet sæson fundet" });
      }
      fromSeasonId = fromSeason.id;
    }

    // #1346: readiness-gate FØR enhver transition-write. dryRun gates ikke
    // (ingen writes). Force er en bevidst, logget nødudgang (ejer-beslutning
    // 12/6) til resume-edge-cases og bevidst tidlig sæsonlukning.
    if (!dryRun) {
      const readiness = await assessTransitionReadiness({ supabase, fromSeasonId });
      if (!readiness.ready && !Boolean(force)) {
        return res.status(409).json({
          error: "Sæson-transition blokeret: readiness-gaten er rød",
          readiness,
        });
      }
      if (!readiness.ready && Boolean(force)) {
        await supabase.from("admin_log").insert({
          admin_user_id: req.user?.id ?? null,
          action_type: ADMIN_ACTION_TYPE.MANUAL_OVERRIDE,
          description: `Sæson-transition FORCED med rød readiness-gate (${readiness.failed_critical.join(", ")})`,
          target_team_id: null,
          meta: { source: "season_transition_force", failed_critical: readiness.failed_critical },
        });
      }
    }

    const result = await transitionToNextSeason({
      supabase,
      fromSeasonId,
      transitionAt: transitionAt ? new Date(transitionAt) : new Date(),
      dryRun: Boolean(dryRun),
      adminUserId: req.user?.id ?? null,
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

(`ADMIN_ACTION_TYPE` er allerede importeret i api.js — bruges fx i adjust-balance-handleren.)

- [ ] **Step 4: Kør tests og verificér at de passerer**

Kør (fra `backend/`):
`node --test lib/seasonTransitionRoute.test.js` — forventet: PASS, 9 tests.
`node --test lib/seasonTransition.test.js lib/seasonAutoTransition.test.js lib/seasonTransitionReadiness.test.js` — forventet: PASS (ingen regressioner i engine/cron).
`node --check routes/api.js` — forventet: ingen output (syntaks ok).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/api.js backend/lib/seasonTransitionRoute.test.js
git commit -m "fix(api): readiness-gate + force-override på POST /admin/season-transition, readiness i preview

Rød gate uden force afvises 409 før enhver write. Force logges i
admin_log som manual_override. Cron/orchestrator/scripts er bevidst
ugatede (kalder lib direkte).

Refs #1346"
```

---

### Task 3: Frontend gate-helper (TDD)

**Files:**
- Create: `frontend/src/lib/seasonTransitionGate.test.js`
- Create: `frontend/src/lib/seasonTransitionGate.js`

- [ ] **Step 1: Skriv den fejlende test**

Opret `frontend/src/lib/seasonTransitionGate.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { summarizeTransitionReadiness, TRANSITION_CHECK_LABELS } from "./seasonTransitionGate.js";

function readinessWith(overrides = {}) {
  const okCheck = { ok: true, critical: true, detail: null };
  return {
    ready: false,
    checks: {
      window_closed: { ...okCheck },
      final_whistle_sent: { ...okCheck },
      squad_enforcement_completed: { ...okCheck },
      no_active_auctions: { ...okCheck },
      all_races_completed: { ...okCheck },
      ...overrides,
    },
  };
}

test("summarizeTransitionReadiness — null/manglende readiness er known=false og blokerer ikke", () => {
  // Graceful degradation: gammel backend-deploy uden readiness i preview må
  // ikke fryse UI'et — server-gaten er den egentlige guard.
  for (const input of [null, undefined, {}, { checks: null }]) {
    const gate = summarizeTransitionReadiness(input);
    assert.equal(gate.known, false);
    assert.equal(gate.blocked, false);
    assert.deepEqual(gate.rows, []);
    assert.deepEqual(gate.failed, []);
  }
});

test("summarizeTransitionReadiness — alle checks ok giver blocked=false og 5 rækker", () => {
  const gate = summarizeTransitionReadiness(readinessWith());
  assert.equal(gate.known, true);
  assert.equal(gate.blocked, false);
  assert.equal(gate.rows.length, 5);
  assert.deepEqual(gate.failed, []);
});

test("summarizeTransitionReadiness — kritisk fail blokerer og bærer dansk label + detail", () => {
  const gate = summarizeTransitionReadiness(readinessWith({
    window_closed: { ok: false, critical: true, detail: "Vinduet har status 'open'" },
  }));
  assert.equal(gate.blocked, true);
  assert.equal(gate.failed.length, 1);
  assert.equal(gate.failed[0].key, "window_closed");
  assert.equal(gate.failed[0].label, TRANSITION_CHECK_LABELS.window_closed);
  assert.equal(gate.failed[0].detail, "Vinduet har status 'open'");
});

test("summarizeTransitionReadiness — ukendt check-key falder tilbage til key som label", () => {
  const gate = summarizeTransitionReadiness(readinessWith({
    future_check: { ok: false, critical: true, detail: null },
  }));
  const row = gate.rows.find((r) => r.key === "future_check");
  assert.equal(row.label, "future_check");
  assert.equal(gate.blocked, true);
});

test("summarizeTransitionReadiness — ikke-kritisk fail blokerer ikke men vises", () => {
  const gate = summarizeTransitionReadiness(readinessWith({
    all_races_completed: { ok: false, critical: false, detail: "1 løb mangler" },
  }));
  assert.equal(gate.blocked, false);
  const row = gate.rows.find((r) => r.key === "all_races_completed");
  assert.equal(row.ok, false);
  assert.deepEqual(gate.failed, []);
});
```

- [ ] **Step 2: Kør testen og verificér at den fejler**

Kør (fra `frontend/`): `node --test src/lib/seasonTransitionGate.test.js`
Forventet: FAIL med `Cannot find module ... seasonTransitionGate.js`

- [ ] **Step 3: Skriv implementeringen**

Opret `frontend/src/lib/seasonTransitionGate.js`:

```js
/**
 * #1346 — afled UI-gate-state fra season-transition-readiness.
 * Payload kommer fra GET /api/admin/season-transition/preview (felt:
 * readiness) og fra 409-svar på POST /api/admin/season-transition.
 * Server-gaten er den egentlige guard; mangler readiness (gammel
 * backend-deploy) degraderer UI'et gracefully til ikke-blokeret.
 */

export const TRANSITION_CHECK_LABELS = {
  window_closed: "Transfervindue lukket",
  final_whistle_sent: "Final whistle sendt",
  squad_enforcement_completed: "Squad enforcement kørt",
  no_active_auctions: "Ingen aktive auktioner",
  all_races_completed: "Alle løb afviklet",
};

export function summarizeTransitionReadiness(readiness) {
  if (!readiness || typeof readiness !== "object" || !readiness.checks) {
    return { known: false, blocked: false, rows: [], failed: [] };
  }
  const rows = Object.entries(readiness.checks).map(([key, check]) => ({
    key,
    label: TRANSITION_CHECK_LABELS[key] || key,
    ok: Boolean(check?.ok),
    critical: Boolean(check?.critical),
    detail: check?.detail ?? null,
  }));
  const failed = rows.filter((r) => r.critical && !r.ok);
  return { known: true, blocked: failed.length > 0, rows, failed };
}
```

- [ ] **Step 4: Kør testen og verificér at den passerer**

Kør (fra `frontend/`): `node --test src/lib/seasonTransitionGate.test.js`
Forventet: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/seasonTransitionGate.js frontend/src/lib/seasonTransitionGate.test.js
git commit -m "fix(admin): seasonTransitionGate helper, afleder UI-gate fra readiness-payload

Refs #1346"
```

---

### Task 4: SeasonCycleSection UI (checklist + disabled knap + force)

**Files:**
- Modify: `frontend/src/components/admin/SeasonCycleSection.jsx`

- [ ] **Step 1: Tilføj import, state og gate-afledning**

Øverst i filen, under eksisterende imports (extensionless er ok i .jsx, Vite-konvention):

```jsx
import { summarizeTransitionReadiness } from "../../lib/seasonTransitionGate";
```

I komponent-body, under de eksisterende useState-linjer (linje 19-22):

```jsx
  const [readiness, setReadiness] = useState(null);
  const [force, setForce] = useState(false);
```

Lige før `if (loading && !preview)` (linje 79), tilføj:

```jsx
  const gate = summarizeTransitionReadiness(readiness);
```

- [ ] **Step 2: Opdatér fetchPreview til at gemme readiness**

I `fetchPreview` (linje 24-38), erstat `setPreview(data.plan);` med:

```jsx
      setPreview(data.plan);
      setReadiness(data.readiness ?? null);
```

- [ ] **Step 3: Opdatér executeTransition (confirm-tekst, force-body, 409-håndtering)**

Erstat hele `executeTransition`-funktionen (linje 45-77) med:

```jsx
  async function executeTransition() {
    if (!preview) return;
    const forcing = gate.blocked && force;
    const confirmText =
      (forcing
        ? `⚠️ FORCE-OVERRIDE: readiness-gaten er RØD (${gate.failed.map((f) => f.label).join(", ")}).\n` +
          `Handlingen logges i admin-loggen.\n\n`
        : "") +
      `Du er ved at lukke sæson ${preview.from_season.number} og oprette sæson ${preview.to_season.number}.\n\n` +
      `Dette vil:\n` +
      `  • Markere sæson ${preview.from_season.number} som færdig\n` +
      `  • Oprette sæson ${preview.to_season.number} (status='active')\n` +
      `  • Udbetale ${formatCz(preview.sponsor_base_total)} i sponsor til ${preview.teams_affected} hold\n` +
      `  • Lukke sæson ${preview.from_season.number}'s transfervindue\n` +
      `  • Logge handlingen i admin-loggen\n\n` +
      `Er du sikker?`;
    if (!window.confirm(confirmText)) return;

    setExecuting(true);
    try {
      const headers = await getAuth();
      const res = await fetch(`${API}/api/admin/season-transition`, {
        method: "POST",
        headers,
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) {
        // #1346: 409 = readiness-gaten afviste server-side. Opdatér checklisten
        // så admin ser de aktuelle årsager (preview kan være stale).
        if (res.status === 409 && data.readiness) setReadiness(data.readiness);
        throw new Error(data.error || "Sæsonskifte fejlede");
      }
      setResult(data);
      setForce(false);
      onMsg(`✅ Sæsonskifte udført — sæson ${preview.to_season.number} er nu aktiv`);
      // Refresh preview så UI viser ny state
      await fetchPreview();
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setExecuting(false);
    }
  }
```

- [ ] **Step 4: Tilføj readiness-checklist-kort + force-checkbox i JSX**

Indsæt mellem `{/* Sponsor-breakdown */}`-blokkens slutning og `{/* Knapper */}`:

```jsx
      {/* #1346: Readiness-gate — spejler server-gaten så admin ser årsager før klik */}
      {gate.known && (
        <div className="bg-cz-subtle rounded-xl p-4">
          <p className="text-cz-2 font-medium text-sm mb-2">
            Readiness-gate: {gate.blocked ? "🔴 blokeret" : "🟢 klar"}
          </p>
          <div className="space-y-1">
            {gate.rows.map((row) => (
              <div key={row.key} className="flex items-center gap-2 text-sm">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${row.ok ? "bg-cz-success" : row.critical ? "bg-cz-danger" : "bg-cz-warning"}`}
                />
                <span className={row.ok ? "text-cz-2" : "text-cz-1 font-medium"}>{row.label}</span>
                {!row.ok && row.detail && (
                  <span className="text-cz-3 text-xs">({row.detail})</span>
                )}
              </div>
            ))}
          </div>
          {gate.blocked && (
            <label className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 cursor-pointer">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-bold">Force-override:</span> udfør sæsonskiftet selv om
                gaten er rød. Handlingen logges i admin-loggen. Brug kun ved bevidst tidlig
                sæsonlukning eller resume efter delvis fejl.
              </span>
            </label>
          )}
        </div>
      )}
```

- [ ] **Step 5: Disable Udfør-knappen på gate**

Erstat Udfør-knappens `disabled={loading || executing}` (linje 181) med:

```jsx
          disabled={loading || executing || (gate.blocked && !force)}
```

Og erstat knappens label-udtryk (linje 184-186) med:

```jsx
          {executing
            ? "Udfører…"
            : gate.blocked && !force
              ? "Blokeret af readiness-gate (se checks ovenfor)"
              : `Udfør sæsonskifte (sæson ${preview.from_season.number} → ${preview.to_season.number})`}
```

- [ ] **Step 6: Verificér lint + alle frontend-tests + build**

Kør (fra `frontend/`):
`npx eslint src/components/admin/SeasonCycleSection.jsx src/lib/seasonTransitionGate.js` — forventet: ingen fejl.
`node --test src/lib/` (eller projektets frontend-test-kommando) — forventet: PASS inkl. de 5 nye.
`npm run build` — forventet: build ok, ingen nye warnings (warning-budget).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/SeasonCycleSection.jsx
git commit -m "fix(admin): SeasonCycleSection viser readiness-gate, disabler Udfør og kræver eksplicit force

Refs #1346"
```

---

### Task 5: Fuld lokal verifikation + postmortem + PR

**Files:**
- Create: `.claude/learnings/2026-06-12-season-transition-no-server-gate.md`

- [ ] **Step 1: Kør fuld lokal verifikation**

Kør (fra repo-root): `pwsh -File scripts/verify-local.ps1`
Forventet: backend-tests + frontend-tests + frontend-build alle grønne.

Kør (fra `frontend/`): `npx playwright test core-smoke.spec.js`
Forventet: PASS alle 3 projekter (desktop-chromium, mobile-chromium, mobile-webkit). Admin-sektionen er ikke i core-smoke, så ingen snapshot-refresh forventes — men kør den per frontend-PR-pre-flight.

- [ ] **Step 2: Skriv postmortem (bugfix-rutine)**

Opret `.claude/learnings/2026-06-12-season-transition-no-server-gate.md`:

```markdown
# Season-transition havde ingen server-side gate (#1346)

**Symptom:** POST /api/admin/season-transition kunne lukke en aktiv sæson
med åbent transfervindue/uafviklede løb. Eneste guard var window.confirm i UI.

**Rod-årsag:** Readiness-disciplinen levede proceduralt (checkliste ved
1→2-skiftet #1155, cron-pre-checks i seasonAutoTransition.js), men blev
aldrig enforced i den manuelle endpoint-sti. Klassisk "UI-confirm er ikke
en guard"-fejl.

**Fix:** assessTransitionReadiness (genbruger cron'ens wrapped-window-
semantik) håndhæves i endpointet: rød gate uden force = 409. Force er
eksplicit, UI-synlig og logges som manual_override. Preview og POST deler
samme beregning så UI/server ikke driver.

**Læring:** Når en cron-sti har guards og en manuel admin-sti deler motor,
skal guarden ligge i motoren ELLER eksplicit i HVER caller-sti. En guard
der kun findes i én caller er en latent P0 i de andre.
```

- [ ] **Step 3: Push branch + opret PR**

```bash
git push -u origin fix/1346-season-transition-readiness-gate
```

Opret PR med `gh pr create` — titel: `fix(season): server-side readiness-gate på manuel sæson-transition (#1346)`. Body SKAL indeholde:

```markdown
## Hvad

Server-side readiness-gate på POST /api/admin/season-transition (#1346, P0 før 20/6):

- Ny `assessTransitionReadiness`: transfervindue lukket via deadline-cyklus (closed + closed_at, racing-windows tæller ikke), final whistle sendt, squad enforcement kørt, 0 aktive auktioner, alle løb afviklet. Alle kritiske.
- Rød gate uden force → 409 med årsager, FØR enhver write. dryRun gates ikke.
- Force-override (ejer-beslutning 12/6): eksplicit checkbox i UI + `force` i body, logges i admin_log som `manual_override` (ikke `season_transition`, så dailySeasonCountCheck ikke dobbelt-tæller).
- Preview-endpointet returnerer samme readiness; SeasonCycleSection viser checklist, disabler Udfør-knappen med årsager.
- Cron, relaunch-orchestratoren (#1103) og scripts/executeSeasonTransition.js kalder lib direkte og er bevidst ugatede (cron pre-checker selv samme betingelser).

## Patch notes

Ikke opdateret: ren admin-/sikkerhedsændring, ingen spillervendt adfærdsændring. Hjælp/FAQ: samme begrundelse.

## Brugerverifikation

- [x] Backend-tests grønne (`node --test` i backend/, inkl. 9 nye readiness-tests + 4 nye route-tests)
- [x] Frontend-tests grønne (`node --test` i frontend/, inkl. 5 nye gate-tests)
- [x] Frontend-build grøn lokalt (`npm run build`)
- [x] Playwright core-smoke grøn (alle 3 projekter)
- [x] Manuel UI-verify: checklist rendrer, knap disabled ved rød gate, force-checkbox aktiverer knap med advarsel i confirm

Refs #1346
```

(`- [x]`-punkterne udfyldes ærligt — kryds kun det der faktisk er kørt; manuel UI-verify via Playwright-mocks eller lokal dev-server.)

- [ ] **Step 4: Commit postmortem (kan gå med på branchen)**

```bash
git add .claude/learnings/2026-06-12-season-transition-no-server-gate.md
git commit -m "docs(learnings): postmortem for manglende server-gate på season-transition

Refs #1346"
git push
```

- [ ] **Step 5: Auto-merge + verifikation**

Ingen `database/*.sql` i PR'en → auto-merge er tilladt:
```bash
gh pr merge --auto --squash
```
Følg CI-checks (lokal verifikation er allerede kørt — bloker ikke på polling). Efter merge: verificér Vercel/Railway-deploy via `scripts/verify-deploy.ps1` eller deploy-logs.

---

### Task 6: Close-out

- [ ] **Step 1: Luk issuet med verifikations-kommentar**

```bash
gh issue close 1346 --reason completed --comment "Fixet i PR <link>. Server-side gate: assessTransitionReadiness (wrapped window + 0 auktioner + alle løb afviklet) håndhæves i POST /admin/season-transition, rød gate uden force = 409 før writes. Force = eksplicit UI-checkbox, logget som manual_override. UI viser checklist + disabler knappen. Tests: 9 lib + 4 route + 5 frontend. Acceptkriterier opfyldt: afvisning server-side med årsag ✓, UI viser hvorfor ✓, tests dækker afvisnings- + override-sti ✓."
```

- [ ] **Step 2: Opdatér docs/NOW.md**

Working agent → "Ingen aktiv session". Next action: fjern #1346 fra kandidatlisten, peg på #1308 ELLER #1309 som næste session. Hold budget ~1.200 tokens, trim direkte.

- [ ] **Step 3: FEATURE_STATUS**

Ingen kontraktændring (intern admin-guard) → ingen opdatering nødvendig.

- [ ] **Step 4: Token-hygiejne (lang session)**

```bash
pwsh -File scripts/check-agent-token-hygiene.ps1
```
