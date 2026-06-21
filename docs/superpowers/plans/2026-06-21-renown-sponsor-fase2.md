# Renown-skaleret sponsor + forhandlbare kontrakter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør store klubber bæredygtige ved at lade sponsor-basen skalere med klub-omdømme + forhandlbare kontrakter (vælg-blandt-tilbud) + per-løbsdag-aktivitets-indkomst, kalibreret via harness før ship.

**Architecture:** Ren renown-multiplier-motor (division + resultat-historik) → deterministisk tilbuds-generering (base/per-dag/længde-split) → `sponsor_contracts`-tabel (én aktiv pr. hold) → sæson-start betaler låst garanteret base (board-modificeret, capped); per-løbsdag-indkomst krediteres ved race-finalisering (genbruger prize-payout-stien). Hybrid UI: forhandlings-modal på Board + kontrakt-fane i Finance. Harness-sweep kalibrerer konstanterne mod break-even uden at bryde fresh-gaten.

**Tech Stack:** Node.js/Express backend, `node:test`, Supabase (Postgres + RLS + RPC), React/Vite frontend, i18next, Playwright (UI-verify).

**Spec:** [docs/superpowers/specs/2026-06-21-renown-sponsor-fase2-design.md](../specs/2026-06-21-renown-sponsor-fase2-design.md)

**Branch:** `feat/1663-renown-sponsor` (feat → branch + PR; PR indeholder `database/*.sql` → **ejer merger**).

---

## File Structure

**Backend — nye filer:**
- `backend/lib/renownEngine.js` — ren: `computeRenownMultiplier`, `renownTarget`, konstanter `W_RESULTS`/`MAX_MULTIPLIER`.
- `backend/lib/sponsorOffers.js` — `generateOffers` (deterministisk), `SPONSOR_NAME_POOL`, split-varianter.
- `backend/lib/sponsorContractsService.js` — DB-CRUD: aktiv kontrakt, accepter tilbud, udløb/forny ved sæson-skifte.
- `backend/lib/sponsorRaceDayIncome.js` — per-løbsdag-kreditering (spejler `prizePayoutEngine`).
- `*.test.js` ved siden af hver.

**Backend — modificeres:**
- `backend/lib/economyConstants.js` — `FINANCE_REASON.SPONSOR_RACE_DAY`, `MAX_BOARD_MODIFIER = 1.20`.
- `backend/lib/sponsorEngine.js` — `computeSponsorForSeason` bruger aktiv-kontraktens `guaranteed_base`.
- `backend/lib/economyEngine.js` — `processSeasonStart`: load kontrakt + kontrakt-bevidst loft.
- `backend/lib/seasonTransition.js` — udløb/forny kontrakter ved skifte.
- `backend/lib/autoPrizeSweep.js` — kald per-løbsdag-sweep efter prize-sweep.
- `backend/routes/api.js` — `/api/sponsor/contract`, `/api/sponsor/offers`, `POST /api/sponsor/offers/accept`.

**Database:**
- `database/migrations/2026-06-21-sponsor-contracts.sql` — tabel + index + RLS + grants + backfill.
- `database/schema.sql` — spejl tabellen.

**Frontend — nye filer:**
- `frontend/src/components/SponsorOfferModal.jsx`
- `frontend/src/components/SponsorContractPanel.jsx`
- `frontend/public/locales/en/sponsor.json` + `frontend/public/locales/da/sponsor.json`
- `*.test.js` for ren logik.

**Frontend — modificeres:**
- `frontend/src/pages/FinancePage.jsx` — "sponsors"-fane.
- `frontend/src/pages/BoardPage.jsx` — tilbuds-modal-trigger + CTA.
- `frontend/src/i18n/index.js` — registrér `sponsor`-namespace.

**Harness:**
- `backend/scripts/lib/economyCalibrationOverrides.js`, `prizeDistributionScorecard.js`, `economyCalibrationSweep.js`, `moneySupplyScorecard.js`.
- `docs/audits/2026-06-21-renown-sponsor-calibration.md` (rapport).

**Close-out:** `PatchNotesPage.jsx`, `help.json` (en+da), `FEATURE_STATUS.md`, `docs/NOW.md`.

---

## Phase A — Renown-motor (ren, ingen DB)

### Task A1: `renownEngine.js` med konstanter + multiplier

**Files:**
- Create: `backend/lib/renownEngine.js`
- Test: `backend/lib/renownEngine.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```javascript
// backend/lib/renownEngine.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRenownMultiplier,
  renownTarget,
  W_RESULTS,
  MAX_MULTIPLIER,
} from "./renownEngine.js";

test("frisk hold (ingen historik) → multiplier 1,0", () => {
  const m = computeRenownMultiplier({ division: 3, lastSeasonStanding: null, divisionStandings: [] });
  assert.equal(m, 1.0);
});

test("dominerende hold clamp'es til MAX_MULTIPLIER", () => {
  const standings = [
    { team_id: "a", total_points: 1000, rank_in_division: 1, division: 1 },
    { team_id: "b", total_points: 100, rank_in_division: 2, division: 1 },
  ];
  const m = computeRenownMultiplier({
    division: 1,
    lastSeasonStanding: standings[0],
    divisionStandings: standings,
  });
  assert.equal(m, MAX_MULTIPLIER);
});

test("renownTarget = division-base × multiplier", () => {
  // frisk D3: 340000 × 1.0
  assert.equal(renownTarget({ division: 3, lastSeasonStanding: null, divisionStandings: [] }), 340000);
});

test("W_RESULTS giver top-hold ≈ MAX (sanity)", () => {
  assert.ok(1 + W_RESULTS >= MAX_MULTIPLIER - 1e-9);
});
```

- [ ] **Step 2: Kør testen, bekræft fejl**

Run: `node --test backend/lib/renownEngine.test.js`
Expected: FAIL — `Cannot find module './renownEngine.js'`.

- [ ] **Step 3: Implementér `renownEngine.js`**

```javascript
// backend/lib/renownEngine.js
// Renown-multiplier (Fase 2, #1663): sponsor-basen skalerer med klub-omdømme
// (division + resultat-historik). Ren funktion — ingen I/O. Aktivitet er IKKE en
// multiplier-faktor (det er per-løbsdag-indkomst, se sponsorRaceDayIncome.js).
// Default-konstanter er START-GÆT; kalibreres empirisk i harness (#1663 §7) før ship.
import { SPONSOR_INCOME_BY_DIVISION, SPONSOR_INCOME_BASE } from "./economyConstants.js";

// PLACEHOLDER indtil harness-kalibrering (Phase J). W_RESULTS sat så et top-hold
// (resultsScore 1,0) rammer MAX_MULTIPLIER.
export const W_RESULTS = 0.60;
export const MAX_MULTIPLIER = 1.60;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// resultsScore ∈ [0,1]: sidste sæsons point relativt til divisions-median × rank-faktor,
// clamp'et. 0 hvis ingen historik (frisk hold → multiplier 1,0).
export function computeResultsScore({ lastSeasonStanding, divisionStandings = [] }) {
  if (!lastSeasonStanding) return 0;
  const points = Math.max(0, Number(lastSeasonStanding.total_points) || 0);
  const divisionPoints = divisionStandings.map((s) => Math.max(0, Number(s.total_points) || 0));
  const medianPoints = median(divisionPoints);
  const pointsFactor = medianPoints > 0 ? points / medianPoints : points > 0 ? 1 : 0;
  const size = divisionStandings.length;
  const rank = Number.isInteger(lastSeasonStanding.rank_in_division)
    ? lastSeasonStanding.rank_in_division
    : null;
  const rankNormalized = rank === null ? 1 : size > 1 ? clamp((rank - 1) / (size - 1), 0, 1) : 0;
  const rankFactor = clamp(1 - rankNormalized, 0, 1);
  return clamp(pointsFactor * rankFactor, 0, 1);
}

export function computeRenownMultiplier({ division, lastSeasonStanding, divisionStandings = [] }) {
  const resultsScore = computeResultsScore({ lastSeasonStanding, divisionStandings });
  return clamp(1 + W_RESULTS * resultsScore, 1.0, MAX_MULTIPLIER);
}

// renownTarget = den SAMLEDE sponsor et hold tjener ved fuld aktivitet.
// Splittes i garanteret base + per-løbsdag i sponsorOffers.js.
export function renownTarget({ division, lastSeasonStanding, divisionStandings = [] }) {
  const base = SPONSOR_INCOME_BY_DIVISION[division] ?? SPONSOR_INCOME_BASE;
  return Math.round(base * computeRenownMultiplier({ division, lastSeasonStanding, divisionStandings }));
}
```

- [ ] **Step 4: Kør testen, bekræft pass**

Run: `node --test backend/lib/renownEngine.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/renownEngine.js backend/lib/renownEngine.test.js
git commit -m "feat(economy): renown-multiplier-motor (division + resultat-historik) (#1663)"
```

---

## Phase B — Sponsor-tilbud (ren, deterministisk)

### Task B1: `sponsorOffers.js` — deterministiske tilbud

**Files:**
- Create: `backend/lib/sponsorOffers.js`
- Test: `backend/lib/sponsorOffers.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```javascript
// backend/lib/sponsorOffers.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { generateOffers, SPONSOR_NAME_POOL, FULL_CALENDAR_DAYS } from "./sponsorOffers.js";

const ctx = { teamId: "team-1", seasonNumber: 2, renownTargetValue: 520000 };

test("genererer præcis 3 tilbud", () => {
  assert.equal(generateOffers(ctx).length, 3);
});

test("er deterministisk på samme input (ingen reroll ved reload)", () => {
  assert.deepEqual(generateOffers(ctx), generateOffers(ctx));
});

test("forskellige hold/sæsoner → forskellige navne", () => {
  const a = generateOffers(ctx).map((o) => o.sponsorName);
  const b = generateOffers({ ...ctx, teamId: "team-2" }).map((o) => o.sponsorName);
  assert.notDeepEqual(a, b);
});

test("hver variant ≈ renownTarget ved fuld kalender (±2%)", () => {
  for (const o of generateOffers(ctx)) {
    const total = o.guaranteedBase + o.perRaceDayRate * FULL_CALENDAR_DAYS;
    assert.ok(Math.abs(total - ctx.renownTargetValue) / ctx.renownTargetValue < 0.02,
      `${o.variant}: total ${total} vs target ${ctx.renownTargetValue}`);
  }
});

test("varianterne har stigende per-dag-andel (forudsigelig < sikker < aktivitets-drevet)", () => {
  const byVariant = Object.fromEntries(generateOffers(ctx).map((o) => [o.variant, o]));
  assert.ok(byVariant.predictable.perRaceDayRate < byVariant.activity.perRaceDayRate);
  assert.ok(byVariant.predictable.lengthSeasons === 1);
  assert.ok(byVariant.long.lengthSeasons === 3);
});

test("navne kommer fra puljen", () => {
  for (const o of generateOffers(ctx)) assert.ok(SPONSOR_NAME_POOL.includes(o.sponsorName));
});
```

- [ ] **Step 2: Kør testen, bekræft fejl**

Run: `node --test backend/lib/sponsorOffers.test.js`
Expected: FAIL — module ikke fundet.

- [ ] **Step 3: Implementér `sponsorOffers.js`**

```javascript
// backend/lib/sponsorOffers.js
// Deterministisk sponsor-tilbuds-generering (#1663). Givet et holds renownTarget
// (samlet sponsor ved fuld kalender) splittes den i 3 varianter: garanteret base +
// per-løbsdag-rate + længde. Seedet på team+season → stabil på tværs af reloads
// (spilleren kan ikke "reroll'e" ved refresh). Split-faktorer er justérbare og
// kalibreres i harness (Phase J).

// FULL_CALENDAR_DAYS: forventede løbsdage pr. sæson (sæson 1 = ProSeries). Læses i
// produktion fra seasons.race_days_total (default 60); her som kalibrerings-konstant.
export const FULL_CALENDAR_DAYS = 60;

// ~50 fiktive sponsor-navne. Kuratér for tone (ingen ægte mærker, ingen AI-slop-klang).
export const SPONSOR_NAME_POOL = Object.freeze([
  "Meridian Bank", "Alta Cycles", "Provincia Forsikring", "Northwind Energy",
  "Sundberg Group", "Kettler & Vos", "Halcyon Telecom", "Verema Pharma",
  "Borealis Steel", "Falcon Logistics", "Marisol Wines", "Cobalt Mobility",
  "Hartmann Bau", "Lumen Optics", "Sable Aerospace", "Granvik Maritime",
  "Otero Foods", "Brennan Whisky", "Vesna Robotics", "Kestrel Outdoor",
  "Dalmar Cement", "Polaris Insurance", "Rendal Timber", "Solveig Dairy",
  "Tagliani Olive", "Vanguard Motors", "Eldfell Geothermal", "Marquez Coffee",
  "Nordhavn Shipping", "Cygnus Media", "Brandt Pharma", "Aurelia Jewelers",
  "Stenmark Tools", "Larkin Brewing", "Castell Vineyards", "Ferro Metals",
  "Aiden Outdoor", "Vossberg Optics", "Calluna Botanics", "Drummond Whisky",
  "Saber Security", "Wexler Foods", "Nilsen Marine", "Petra Stone",
  "Halvorsen Bank", "Corvus Aviation", "Mistral Energy", "Bjarke Design",
  "Ravensburg Glass", "Thorne Logistics",
]);

// Lille deterministisk hash (FNV-1a-agtig) → uint32. Ingen Math.random (banned i harness).
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Split-varianter: guaranteedFraction = andel af target lagt i garanteret base; resten
// dækkes af per-dag × FULL_CALENDAR_DAYS, så total ≈ target ved fuld kalender.
const VARIANTS = [
  { variant: "predictable", guaranteedFraction: 0.88, lengthSeasons: 1 },
  { variant: "activity",    guaranteedFraction: 0.55, lengthSeasons: 2 },
  { variant: "long",        guaranteedFraction: 0.73, lengthSeasons: 3 },
];

export function generateOffers({ teamId, seasonNumber, renownTargetValue }) {
  const seed = hashSeed(`${teamId}:${seasonNumber}`);
  // Vælg 3 forskellige navne deterministisk.
  const names = [];
  let cursor = seed % SPONSOR_NAME_POOL.length;
  while (names.length < 3) {
    const name = SPONSOR_NAME_POOL[cursor % SPONSOR_NAME_POOL.length];
    if (!names.includes(name)) names.push(name);
    cursor += 1 + (seed % 7);
  }

  return VARIANTS.map((v, i) => {
    const guaranteedBase = Math.round(renownTargetValue * v.guaranteedFraction);
    const perRaceDayRate = Math.round((renownTargetValue - guaranteedBase) / FULL_CALENDAR_DAYS);
    return {
      variant: v.variant,
      sponsorName: names[i],
      guaranteedBase,
      perRaceDayRate,
      lengthSeasons: v.lengthSeasons,
    };
  });
}
```

- [ ] **Step 4: Kør testen, bekræft pass**

Run: `node --test backend/lib/sponsorOffers.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/sponsorOffers.js backend/lib/sponsorOffers.test.js
git commit -m "feat(economy): deterministisk sponsor-tilbuds-generering (#1663)"
```

---

## Phase C — Migration + schema

### Task C1: `sponsor_contracts`-tabel + RLS + backfill

**Files:**
- Create: `database/migrations/2026-06-21-sponsor-contracts.sql`
- Modify: `database/schema.sql` (spejl)

- [ ] **Step 1: Skriv migrationen**

```sql
-- database/migrations/2026-06-21-sponsor-contracts.sql
-- #1663 Økonomi Fase 2: forhandlbare sponsor-kontrakter. Én aktiv pr. hold + historik.
-- Idempotent (kan køres flere gange). RLS: holdet ser kun egne kontrakter.

CREATE TABLE IF NOT EXISTS sponsor_contracts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  sponsor_name         TEXT NOT NULL,
  guaranteed_base      BIGINT NOT NULL,
  per_race_day_rate    BIGINT NOT NULL DEFAULT 0,
  length_seasons       INTEGER NOT NULL CHECK (length_seasons BETWEEN 1 AND 3),
  start_season         INTEGER NOT NULL,
  expires_after_season INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_contracts_team_active
  ON sponsor_contracts(team_id) WHERE status = 'active';

ALTER TABLE sponsor_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsor_contracts_select_own ON sponsor_contracts;
CREATE POLICY sponsor_contracts_select_own ON sponsor_contracts
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

-- Skrivning sker kun via service_role (backend) → ingen insert/update-policy for authenticated.
GRANT SELECT ON sponsor_contracts TO authenticated;

-- Backfill: alle ikke-AI/ikke-bank/ikke-frosne hold får renown-neutral kontrakt
-- (hele division-basen som garanteret base, per_race_day_rate=0) → nul saldo-chok.
-- Sponsor-navn: deterministisk fra teams.id (stabilt). current_season fra seasons.is_current.
INSERT INTO sponsor_contracts
  (team_id, sponsor_name, guaranteed_base, per_race_day_rate, length_seasons,
   start_season, expires_after_season, status)
SELECT
  t.id,
  'Founding Partner',
  CASE t.division WHEN 1 THEN 600000 WHEN 2 THEN 400000 ELSE 340000 END,
  0,
  1,
  COALESCE(s.season_number, 1),
  COALESCE(s.season_number, 1),
  'active'
FROM teams t
LEFT JOIN seasons s ON s.is_current = true
WHERE t.is_ai = false AND t.is_bank = false AND t.is_frozen = false
  AND NOT EXISTS (
    SELECT 1 FROM sponsor_contracts c WHERE c.team_id = t.id AND c.status = 'active'
  );
```

> **Verificér mod prod-klon** (ikke frisk DB): kør migrationen, så `SELECT` som en `authenticated`-bruger på et andet holds kontrakt → 0 rækker; eget hold → 1 række. Bekræft `division`-CASE matcher `SPONSOR_INCOME_BY_DIVISION` og `seasons`-kolonnenavnene (`is_current`, `season_number`) findes (juster hvis schema afviger).

- [ ] **Step 2: Spejl i `database/schema.sql`**

Tilføj `CREATE TABLE sponsor_contracts (...)`-blokken (uden backfill) + index + RLS-policy i `schema.sql`, placeret nær de øvrige team-relaterede tabeller. (Backfill hører kun til migrationen.)

- [ ] **Step 3: Verificér idempotens-linter**

Run: `node scripts/migration-idempotency-linter.js database/migrations/2026-06-21-sponsor-contracts.sql` (hvis linteren tager fil-arg; ellers kør `npm run lint:migrations` el. tilsvarende fra `package.json`).
Expected: PASS (alle statements idempotente: `IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `NOT EXISTS`-guarded insert).

- [ ] **Step 4: Commit (IKKE merge — ejer merger PR'en)**

```bash
git add database/migrations/2026-06-21-sponsor-contracts.sql database/schema.sql
git commit -m "feat(db): sponsor_contracts-tabel + RLS + renown-neutral backfill (#1663)"
```

---

## Phase D — Kontrakt-service (DB CRUD)

### Task D1: `sponsorContractsService.js`

**Files:**
- Create: `backend/lib/sponsorContractsService.js`
- Test: `backend/lib/sponsorContractsService.test.js`

- [ ] **Step 1: Skriv den fejlende test** (mock-supabase efter `prizePayoutEngine.test.js`-mønster)

```javascript
// backend/lib/sponsorContractsService.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { getActiveContract, getOffers, acceptOffer } from "./sponsorContractsService.js";

function makeSupabase({ contract = null, standings = [], team = null, inserted = [] } = {}) {
  return {
    _inserted: inserted,
    from(table) {
      const api = {
        select: () => api, eq: () => api, is: () => api, order: () => api,
        maybeSingle: () => Promise.resolve({ data: table === "sponsor_contracts" ? contract : team, error: null }),
        single: () => Promise.resolve({ data: team, error: null }),
        then: (resolve) => resolve({ data: table === "season_standings" ? standings : [], error: null }),
        insert: (rows) => { inserted.push(...[].concat(rows)); return { select: () => ({ single: () => Promise.resolve({ data: rows, error: null }) }) }; },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      };
      return api;
    },
  };
}

test("getActiveContract returnerer holdets aktive kontrakt", async () => {
  const supabase = makeSupabase({ contract: { id: "c1", team_id: "t1", status: "active" } });
  const c = await getActiveContract({ supabase, teamId: "t1" });
  assert.equal(c.id, "c1");
});

test("getOffers returnerer 3 deterministiske tilbud baseret på renown", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    standings: [{ team_id: "t1", total_points: 200, rank_in_division: 3, division: 2 }],
  });
  const offers = await getOffers({ supabase, teamId: "t1", seasonNumber: 2 });
  assert.equal(offers.length, 3);
});

test("acceptOffer skriver en aktiv kontrakt fra valgt variant", async () => {
  const inserted = [];
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    standings: [{ team_id: "t1", total_points: 200, rank_in_division: 3, division: 2 }],
    inserted,
  });
  await acceptOffer({ supabase, teamId: "t1", seasonNumber: 2, variant: "long" });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].status, "active");
  assert.equal(inserted[0].length_seasons, 3);
});
```

- [ ] **Step 2: Kør testen, bekræft fejl**

Run: `node --test backend/lib/sponsorContractsService.test.js`
Expected: FAIL — module ikke fundet.

- [ ] **Step 3: Implementér `sponsorContractsService.js`**

```javascript
// backend/lib/sponsorContractsService.js
// DB-laget for sponsor-kontrakter (#1663). Service_role-klient injiceres (deps.supabase).
// Tilbud genereres deterministisk on-demand (ingen offers-tabel) — accept skriver kontrakt.
import { renownTarget } from "./renownEngine.js";
import { generateOffers } from "./sponsorOffers.js";

export async function getActiveContract({ supabase, teamId }) {
  const { data, error } = await supabase
    .from("sponsor_contracts")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadRenownTargetValue({ supabase, teamId, seasonNumber }) {
  const { data: team } = await supabase.from("teams").select("id, division").eq("id", teamId).single();
  // Sidste sæsons standings (seasonNumber er den KOMMENDE sæson → forrige = seasonNumber-1).
  const { data: standings } = await supabase
    .from("season_standings")
    .select("team_id, total_points, rank_in_division, division")
    .eq("season_number", seasonNumber - 1);
  const all = standings || [];
  const mine = all.find((s) => s.team_id === teamId) || null;
  const divisionStandings = all.filter((s) => s.division === team.division);
  return renownTarget({ division: team.division, lastSeasonStanding: mine, divisionStandings });
}

export async function getOffers({ supabase, teamId, seasonNumber }) {
  const renownTargetValue = await loadRenownTargetValue({ supabase, teamId, seasonNumber });
  return generateOffers({ teamId, seasonNumber, renownTargetValue });
}

export async function acceptOffer({ supabase, teamId, seasonNumber, variant }) {
  const offers = await getOffers({ supabase, teamId, seasonNumber });
  const chosen = offers.find((o) => o.variant === variant);
  if (!chosen) throw new Error(`Ukendt variant: ${variant}`);

  // Erstat evt. eksisterende aktiv kontrakt (manager kan skifte indtil sæson-start).
  await supabase.from("sponsor_contracts").update({ status: "expired" })
    .eq("team_id", teamId).eq("status", "active");

  const row = {
    team_id: teamId,
    sponsor_name: chosen.sponsorName,
    guaranteed_base: chosen.guaranteedBase,
    per_race_day_rate: chosen.perRaceDayRate,
    length_seasons: chosen.lengthSeasons,
    start_season: seasonNumber,
    expires_after_season: seasonNumber + chosen.lengthSeasons - 1,
    status: "active",
  };
  const { error } = await supabase.from("sponsor_contracts").insert(row).select().single();
  if (error) throw error;
  return row;
}

// Kaldes ved sæson-skifte: udløb kontrakter hvis expires_after_season < ny sæson, og
// auto-tildel et default-tilbud (balanceret/"long") så hvert hold ALTID har en aktiv kontrakt.
export async function expireAndRenewContracts({ supabase, newSeasonNumber, teamIds }) {
  for (const teamId of teamIds) {
    const active = await getActiveContract({ supabase, teamId });
    if (active && active.expires_after_season >= newSeasonNumber) continue; // stadig låst
    if (active) {
      await supabase.from("sponsor_contracts").update({ status: "expired" })
        .eq("id", active.id);
    }
    // Default ved manglende valg = "long" (sikker/stabil).
    await acceptOffer({ supabase, teamId, seasonNumber: newSeasonNumber, variant: "long" });
  }
}
```

- [ ] **Step 4: Kør testen, bekræft pass**

Run: `node --test backend/lib/sponsorContractsService.test.js`
Expected: PASS (3 tests). (Justér mock-builder hvis `single()`/`maybeSingle()`-stubs skal returnere forskelligt pr. tabel — udvid `makeSupabase` om nødvendigt.)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/sponsorContractsService.js backend/lib/sponsorContractsService.test.js
git commit -m "feat(economy): sponsor-kontrakt-service (hent/tilbud/accept/forny) (#1663)"
```

---

## Phase E — Sæson-start: betal låst kontrakt-base + kontrakt-bevidst loft

### Task E1: Konstanter — `MAX_BOARD_MODIFIER` + ny finance-reason

**Files:**
- Modify: `backend/lib/economyConstants.js`

- [ ] **Step 1: Tilføj konstant + enum-værdi**

I `economyConstants.js`, efter `FINAL_SPONSOR_PAYOUT_CEILING` (linje ~38):

```javascript
// Maks board-satisfaction-modifier (bekræftet boardEvaluation.js satisfactionToModifier:
// ≥80 satisfaction → 1.20). Bruges som kontrakt-bevidst sponsor-loft-faktor (#1663):
// ceiling = guaranteed_base × MAX_BOARD_MODIFIER (guarder board-modifier-bypass uden at
// cappe legitim renown-skalering).
export const MAX_BOARD_MODIFIER = 1.20;
```

I `FINANCE_REASON`-objektet (nær `RACE_PRIZE_PAYOUT`):

```javascript
  SPONSOR_RACE_DAY: "sponsor_race_day",
```

- [ ] **Step 2: Verificér ingen lint-brud**

Run: `cd backend && node --check lib/economyConstants.js`
Expected: ingen output (OK).

- [ ] **Step 3: Commit**

```bash
git add backend/lib/economyConstants.js
git commit -m "feat(economy): MAX_BOARD_MODIFIER + SPONSOR_RACE_DAY finance-reason (#1663)"
```

### Task E2: `sponsorEngine.computeSponsorForSeason` bruger aktiv kontrakt

**Files:**
- Modify: `backend/lib/sponsorEngine.js`
- Test: `backend/lib/sponsorEngine.test.js` (tilføj — opret hvis ikke findes)

- [ ] **Step 1: Skriv den fejlende test**

```javascript
// backend/lib/sponsorEngine.test.js  (tilføj denne test)
import test from "node:test";
import assert from "node:assert/strict";
import { computeSponsorForSeason } from "./sponsorEngine.js";

test("aktiv kontrakt vinder: gross_sponsor = guaranteed_base", () => {
  const res = computeSponsorForSeason({
    seasonNumber: 2,
    team: { division: 1, sponsor_income: 240000 },
    activeContract: { guaranteed_base: 845000, per_race_day_rate: 1900 },
    lastSeasonStanding: { total_points: 500, rank_in_division: 1, division: 1 },
    divisionStandings: [{ total_points: 500 }],
  });
  assert.equal(res.gross_sponsor, 845000);
  assert.equal(res.mode, "contract");
});

test("ingen kontrakt → falder tilbage til division-base (bagudkompatibelt)", () => {
  const res = computeSponsorForSeason({
    seasonNumber: 1,
    team: { division: 3 },
    activeContract: null,
    lastSeasonStanding: null,
  });
  assert.equal(res.gross_sponsor, 340000);
});
```

- [ ] **Step 2: Kør, bekræft fejl** — `node --test backend/lib/sponsorEngine.test.js` → FAIL (contract-gren findes ikke).

- [ ] **Step 3: Implementér** — tilføj kontrakt-gren øverst i `computeSponsorForSeason` ([sponsorEngine.js:86](../../backend/lib/sponsorEngine.js)):

```javascript
export function computeSponsorForSeason({
  seasonNumber = null,
  team = {},
  activeContract = null,        // NY
  lastSeasonStanding = null,
  divisionStandings = [],
} = {}) {
  // #1663: en aktiv kontrakt definerer den (låste) garanterede base. Den vinder over
  // den gamle division-flade-base. Per-løbsdag betales separat (sponsorRaceDayIncome).
  if (activeContract && Number.isFinite(Number(activeContract.guaranteed_base))) {
    const base = Number(activeContract.guaranteed_base);
    return {
      mode: "contract",
      season_number: seasonNumber,
      base,
      variable: 0,
      gross_sponsor: base,
      capped: false,
      per_race_day_rate: Number(activeContract.per_race_day_rate) || 0,
      explanation: `Kontrakt-garanteret base ${base}.`,
    };
  }
  // ... eksisterende intro/variable/fallback-logik uændret ...
```

- [ ] **Step 4: Kør, bekræft pass** — `node --test backend/lib/sponsorEngine.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/sponsorEngine.js backend/lib/sponsorEngine.test.js
git commit -m "feat(economy): sponsor bruger aktiv kontrakts garanterede base (#1663)"
```

### Task E3: `processSeasonStart` loader kontrakt + kontrakt-bevidst loft

**Files:**
- Modify: `backend/lib/economyEngine.js` (omkring linje 232-267, sponsor-loop)

- [ ] **Step 1: Load aktiv kontrakt pr. hold** — i `processSeasonStart`, før `computeSponsorForSeason`-kaldet (linje ~232), tilføj:

```javascript
import { getActiveContract } from "./sponsorContractsService.js";
import { MAX_BOARD_MODIFIER } from "./economyConstants.js";
// ... i loopet, før computeSponsorForSeason:
const activeContract = await getActiveContract({ supabase: supabaseClient, teamId: team.id });
```

Send `activeContract` ind i `computeSponsorForSeason({ ..., activeContract })`.

- [ ] **Step 2: Kontrakt-bevidst loft** — hvor loftet (`FINAL_SPONSOR_PAYOUT_CEILING`) anvendes (linje ~243), erstat den flade cap med:

```javascript
// #1663: loft afledt af den (låste) garanterede base × maks board-modifier — capper
// board-modifier-bypass, men ikke legitim renown-skalering.
const ceilingBase = activeContract?.guaranteed_base ?? sponsorBreakdown.gross_sponsor;
const ceiling = Math.round(Number(ceilingBase) * MAX_BOARD_MODIFIER);
const sponsorPayout = Math.min(grossAfterModifiers, ceiling);
```

- [ ] **Step 3: Verificér eksisterende økonomi-tests stadig grønne**

Run: `node --test backend/lib/economyEngine.test.js`
Expected: PASS (justér evt. tests der hardcodede det gamle flade loft — opdatér forventning til kontrakt-baseret loft).

- [ ] **Step 4: Commit**

```bash
git add backend/lib/economyEngine.js
git commit -m "feat(economy): sæson-start betaler kontrakt-base + kontrakt-bevidst loft (#1663)"
```

---

## Phase F — Per-løbsdag-indkomst

### Task F1: `sponsorRaceDayIncome.js` — kreditér per race

**Files:**
- Create: `backend/lib/sponsorRaceDayIncome.js`
- Test: `backend/lib/sponsorRaceDayIncome.test.js`

- [ ] **Step 1: Skriv den fejlende test**

```javascript
// backend/lib/sponsorRaceDayIncome.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { computeRaceDayCredits } from "./sponsorRaceDayIncome.js";

test("kreditér per_race_day_rate × stages for hvert deltagende hold", () => {
  const credits = computeRaceDayCredits({
    race: { id: "r1", stages: 3 },
    participatingTeamIds: ["t1", "t2"],
    contractsByTeam: { t1: { per_race_day_rate: 2000 }, t2: { per_race_day_rate: 0 } },
  });
  assert.deepEqual(credits, [
    { teamId: "t1", amount: 6000, idempotencyKey: "sponsor_race_day:r1:t1" },
  ]); // t2 har rate 0 → ingen kreditering
});

test("endagsløb (stages udefineret) tæller som 1 dag", () => {
  const credits = computeRaceDayCredits({
    race: { id: "r2" },
    participatingTeamIds: ["t1"],
    contractsByTeam: { t1: { per_race_day_rate: 1500 } },
  });
  assert.equal(credits[0].amount, 1500);
});
```

- [ ] **Step 2: Kør, bekræft fejl** — `node --test backend/lib/sponsorRaceDayIncome.test.js` → FAIL.

- [ ] **Step 3: Implementér `sponsorRaceDayIncome.js`** (ren beregning + DB-sweep der genbruger `incrementBalanceWithAudit`)

```javascript
// backend/lib/sponsorRaceDayIncome.js
// Per-løbsdag-sponsor-indkomst (#1663). For hvert gennemført løb krediteres hvert
// deltagende hold per_race_day_rate × stages (rå, IKKE board-modificeret). Spejler
// prizePayoutEngine: samme per-race-iteration, idempotent pr. (race, team).
import { FINANCE_REASON, FINANCE_RELATED_ENTITY, FINANCE_ACTOR_TYPE } from "./economyConstants.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";

// Ren beregning (testbar uden DB).
export function computeRaceDayCredits({ race, participatingTeamIds, contractsByTeam }) {
  const stages = Number(race?.stages) || 1;
  const credits = [];
  for (const teamId of participatingTeamIds) {
    const rate = Number(contractsByTeam?.[teamId]?.per_race_day_rate) || 0;
    if (rate <= 0) continue;
    credits.push({
      teamId,
      amount: rate * stages,
      idempotencyKey: `sponsor_race_day:${race.id}:${teamId}`,
    });
  }
  return credits;
}

// DB-sweep: kaldes efter prize-sweep for samme sæson. Idempotent (genbrug af nøgle
// → 23505 → skip). teams uden aktiv per-dag-kontrakt springes over.
export async function payRaceDaySponsorsToDate(seasonId, supabase, opts = {}) {
  const { data: races } = await supabase
    .from("races").select("id, stages, status").eq("season_id", seasonId).eq("status", "completed");
  if (!races?.length) return { credited: 0 };

  const { data: contracts } = await supabase
    .from("sponsor_contracts").select("team_id, per_race_day_rate").eq("status", "active");
  const contractsByTeam = Object.fromEntries((contracts || []).map((c) => [c.team_id, c]));

  let credited = 0;
  for (const race of races) {
    const { data: results } = await supabase
      .from("race_results").select("team_id").eq("race_id", race.id);
    const participatingTeamIds = [...new Set((results || []).map((r) => r.team_id))];
    const credits = computeRaceDayCredits({ race, participatingTeamIds, contractsByTeam });
    for (const c of credits) {
      const { skipped } = await incrementBalanceWithAudit(supabase, {
        teamId: c.teamId,
        delta: c.amount,
        payload: {
          type: "sponsor_race_day",
          amount: c.amount,
          description: "Sponsor — race-day income",
          reason_code: FINANCE_REASON.SPONSOR_RACE_DAY,
          related_entity_type: FINANCE_RELATED_ENTITY.RACE,
          related_entity_id: race.id,
          idempotency_key: c.idempotencyKey,
        },
      }, { allowDuplicate: true });
      if (!skipped) credited += 1;
    }
  }
  return { credited };
}
```

- [ ] **Step 4: Kør, bekræft pass** — `node --test backend/lib/sponsorRaceDayIncome.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/sponsorRaceDayIncome.js backend/lib/sponsorRaceDayIncome.test.js
git commit -m "feat(economy): per-løbsdag-sponsor-indkomst (kreditér ved race-finalisering) (#1663)"
```

### Task F2: Hook per-løbsdag-sweep ind efter prize-sweep

**Files:**
- Modify: `backend/lib/autoPrizeSweep.js` (kald `payRaceDaySponsorsToDate` efter `paySeasonPrizesToDate`)
- Modify: `backend/routes/api.js` (`POST /admin/prizes/pay` — kald begge)

- [ ] **Step 1: I `autoPrizeSweep.js`**, efter prize-betalingen:

```javascript
import { payRaceDaySponsorsToDate } from "./sponsorRaceDayIncome.js";
// ... efter paySeasonPrizesToDate(seasonId, ...):
await payRaceDaySponsorsToDate(seasonId, supabase);
```

- [ ] **Step 2: I `routes/api.js`** `POST /admin/prizes/pay`-handleren, tilføj samme kald efter prize-payout så manuel trigger også betaler per-dag.

- [ ] **Step 3: Verificér** — `node --test backend/lib/autoPrizeSweep.test.js` (hvis findes) → PASS; ellers `cd backend && node --check lib/autoPrizeSweep.js routes/api.js`.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/autoPrizeSweep.js backend/routes/api.js
git commit -m "feat(economy): kør per-løbsdag-sponsor-sweep med prize-sweep (#1663)"
```

---

## Phase G — Sæson-skifte: udløb + forny kontrakter

### Task G1: Hook `expireAndRenewContracts` i `transitionToNextSeason`

**Files:**
- Modify: `backend/lib/seasonTransition.js` (fase 6, omkring linje 546-563)

- [ ] **Step 1: Kald før `processSeasonStart`** — i `transitionToNextSeason`, før sponsor-payout (så hvert hold har en aktiv kontrakt når sæson-start betaler):

```javascript
import { expireAndRenewContracts } from "./sponsorContractsService.js";
// ... fase 6, før processSeasonStartFn:
if (!dryRun) {
  const { data: teams } = await supabase
    .from("teams").select("id").eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false);
  await expireAndRenewContracts({
    supabase,
    newSeasonNumber: plan.to_season.season_number,
    teamIds: (teams || []).map((t) => t.id),
  });
}
```

- [ ] **Step 2: Verificér** — `node --test backend/lib/seasonTransition.test.js` (hvis findes) → PASS; ellers `cd backend && node --check lib/seasonTransition.js`.

- [ ] **Step 3: Commit**

```bash
git add backend/lib/seasonTransition.js
git commit -m "feat(economy): udløb + forny sponsor-kontrakter ved sæson-skifte (#1663)"
```

---

## Phase H — API-routes

### Task H1: `/api/sponsor/*`

**Files:**
- Modify: `backend/routes/api.js`

- [ ] **Step 1: Tilføj routes** (efter et eksisterende `requireAuth`-route, fx nær linje 644):

```javascript
import { getActiveContract, getOffers, acceptOffer } from "../lib/sponsorContractsService.js";
import { getCurrentSeasonNumber } from "../lib/seasonUtils.js"; // brug eksisterende helper; ellers læs seasons.is_current

router.get("/sponsor/contract", requireAuth, async (req, res) => {
  try {
    const contract = await getActiveContract({ supabase, teamId: req.team.id });
    res.json({ contract });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/sponsor/offers", requireAuth, async (req, res) => {
  try {
    const seasonNumber = (await getCurrentSeasonNumber(supabase)) + 1; // kommende sæson
    const offers = await getOffers({ supabase, teamId: req.team.id, seasonNumber });
    res.json({ offers, seasonNumber });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/sponsor/offers/accept", requireAuth, async (req, res) => {
  try {
    const { variant } = req.body || {};
    const seasonNumber = (await getCurrentSeasonNumber(supabase)) + 1;
    const contract = await acceptOffer({ supabase, teamId: req.team.id, seasonNumber, variant });
    res.json({ contract });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

> Bekræft `getCurrentSeasonNumber`-helper eksisterer; ellers inline en `seasons`-query (`is_current = true`). Sørg for `express.json()`-body-parser er aktiv (det er den for øvrige POST-routes).

- [ ] **Step 2: Verificér** — `cd backend && node --check routes/api.js` → OK. Manuel smoke (hvis dev-server kører): `GET /api/sponsor/contract` med gyldig Bearer-token returnerer `{contract}`.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(api): /api/sponsor/contract|offers|accept (#1663)"
```

---

## Phase I — Frontend (hybrid UI)

### Task I1: i18n-namespace `sponsor`

**Files:**
- Create: `frontend/public/locales/en/sponsor.json`, `frontend/public/locales/da/sponsor.json`
- Modify: `frontend/src/i18n/index.js`

- [ ] **Step 1: Opret locale-filer** (EN først).

`en/sponsor.json`:
```json
{
  "tab": "Sponsors",
  "offers": {
    "title": "Sponsor offers for season {{season}}",
    "subtitle": "Your club's reputation shapes the offers. Pick one — it locks for the contract length.",
    "guaranteedBase": "Guaranteed base",
    "perRaceDay": "Per race day",
    "length": "Length",
    "seasons": "{{count}} season",
    "seasons_plural": "{{count}} seasons",
    "choose": "Choose",
    "variant": {
      "predictable": "Predictable",
      "activity": "Activity-driven",
      "long": "Safe / long"
    }
  },
  "contract": {
    "title": "Current sponsor",
    "name": "Sponsor",
    "guaranteedBase": "Guaranteed base",
    "perRaceDay": "Per race day",
    "expires": "Runs through season {{season}}",
    "raceDayEarned": "Race-day income this season",
    "none": "No active contract."
  }
}
```

`da/sponsor.json` — samme nøgler, dansk værdi (fx `"tab": "Sponsorer"`, `"choose": "Vælg"`).

- [ ] **Step 2: Registrér namespace** i `frontend/src/i18n/index.js` (følg `finance`-mønsteret, linje ~59-60):

```javascript
import sponsorDa from "../../public/locales/da/sponsor.json";
import sponsorEn from "../../public/locales/en/sponsor.json";
// ... tilføj 'sponsor' i resources for begge sprog.
```

- [ ] **Step 3: Verificér i18n-leak-check** — `npm run lint` (eller i18n-key-check-scriptet) → ingen manglende nøgler.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/locales/en/sponsor.json frontend/public/locales/da/sponsor.json frontend/src/i18n/index.js
git commit -m "feat(i18n): sponsor-namespace (en+da) (#1663)"
```

### Task I2: `SponsorOfferModal.jsx`

**Files:**
- Create: `frontend/src/components/SponsorOfferModal.jsx`

- [ ] **Step 1: Implementér** (genbrug `ui/Modal` + cz-tokens + `formatNumber`):

```jsx
// frontend/src/components/SponsorOfferModal.jsx
import { useTranslation } from "react-i18next";
import Modal from "./ui/Modal";
import { formatNumber } from "../lib/intl";

export default function SponsorOfferModal({ open, onClose, offers, season, onAccept, accepting }) {
  const { t } = useTranslation("sponsor");
  return (
    <Modal open={open} onClose={onClose} size="lg"
      closeLabel={t("offers.choose")} ariaLabelledby="sponsor-offer-title">
      <h2 id="sponsor-offer-title" className="text-cz-1 font-semibold text-base">
        {t("offers.title", { season })}
      </h2>
      <p className="text-cz-3 text-xs mt-0.5 mb-4">{t("offers.subtitle")}</p>
      <div className="grid gap-3 md:grid-cols-3">
        {offers.map((o) => (
          <div key={o.variant} className="bg-cz-card border border-cz-border rounded-cz p-4 flex flex-col">
            <p className="text-cz-3 text-[11px] uppercase tracking-wider">{t(`offers.variant.${o.variant}`)}</p>
            <p className="text-cz-1 font-semibold text-sm mt-0.5 mb-3">{o.sponsorName}</p>
            <dl className="text-cz-2 text-xs space-y-1 flex-1">
              <div className="flex justify-between"><dt>{t("offers.guaranteedBase")}</dt>
                <dd className="font-mono text-cz-1">{formatNumber(o.guaranteedBase)}</dd></div>
              <div className="flex justify-between"><dt>{t("offers.perRaceDay")}</dt>
                <dd className="font-mono text-cz-1">{formatNumber(o.perRaceDayRate)}</dd></div>
              <div className="flex justify-between"><dt>{t("offers.length")}</dt>
                <dd className="text-cz-1">{t("offers.seasons", { count: o.lengthSeasons })}</dd></div>
            </dl>
            <button type="button" disabled={accepting}
              onClick={() => onAccept(o.variant)}
              className="mt-3 px-3 py-2 rounded-cz bg-cz-accent/15 text-cz-accent-t text-sm font-medium disabled:opacity-50">
              {t("offers.choose")}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificér build** — `cd frontend && npm run build` → ingen fejl.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SponsorOfferModal.jsx
git commit -m "feat(ui): SponsorOfferModal — vælg-blandt-tilbud (#1663)"
```

### Task I3: `SponsorContractPanel.jsx` + Finance-fane

**Files:**
- Create: `frontend/src/components/SponsorContractPanel.jsx`
- Modify: `frontend/src/pages/FinancePage.jsx` (FINANCE_TABS linje 22, TabList linje ~375, TabPanel)

- [ ] **Step 1: Implementér panel** (fetch via backend-API, loading/error-mønster fra `refetchForecast`):

```jsx
// frontend/src/components/SponsorContractPanel.jsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";

const API = import.meta.env.VITE_API_URL;

export default function SponsorContractPanel() {
  const { t } = useTranslation("sponsor");
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(false);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API}/api/sponsor/contract`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();
        if (alive) setContract(json.contract);
      } catch { if (alive) setError(true); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <p className="text-cz-3 text-sm">…</p>;
  if (error) return <p className="text-cz-danger text-sm">—</p>;
  if (!contract) return <p className="text-cz-3 text-sm">{t("contract.none")}</p>;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5">
      <h2 className="text-cz-1 font-semibold text-sm mb-3">{t("contract.title")}</h2>
      <dl className="text-cz-2 text-sm space-y-1.5">
        <div className="flex justify-between"><dt>{t("contract.name")}</dt>
          <dd className="text-cz-1 font-medium">{contract.sponsor_name}</dd></div>
        <div className="flex justify-between"><dt>{t("contract.guaranteedBase")}</dt>
          <dd className="font-mono text-cz-1">{formatNumber(contract.guaranteed_base)}</dd></div>
        <div className="flex justify-between"><dt>{t("contract.perRaceDay")}</dt>
          <dd className="font-mono text-cz-1">{formatNumber(contract.per_race_day_rate)}</dd></div>
        <div className="flex justify-between"><dt>{t("contract.expires", { season: contract.expires_after_season })}</dt><dd /></div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 2: Tilføj fane i `FinancePage.jsx`** — `FINANCE_TABS` (linje 22) → tilføj `"sponsors"`; i TabList (linje ~375): `<Tab value="sponsors">{t("tabs.sponsors")}</Tab>` (brug `finance`-namespace key `tabs.sponsors` ELLER skift til sponsor-namespace label); tilføj panel:

```jsx
<TabPanel value="sponsors"><SponsorContractPanel /></TabPanel>
```

Tilføj `tabs.sponsors` til `finance.json` (en+da) ELLER importer `t("tab")` fra sponsor-namespace direkte.

- [ ] **Step 3: Verificér build + frontend-tests** — `cd frontend && npm run build && node --test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SponsorContractPanel.jsx frontend/src/pages/FinancePage.jsx frontend/public/locales/en/finance.json frontend/public/locales/da/finance.json
git commit -m "feat(ui): sponsor-kontrakt-fane i Finance (#1663)"
```

### Task I4: Board-trigger til tilbuds-modal

**Files:**
- Modify: `frontend/src/pages/BoardPage.jsx`

- [ ] **Step 1: Hent tilbud + vis CTA/modal** — i BoardPage, tilføj state + fetch af `/api/sponsor/offers`; hvis der findes tilbud for den kommende sæson (kontrakt udløber), vis en CTA-banner "Choose your sponsor for season N" der åbner `SponsorOfferModal`. Ved accept: `POST /api/sponsor/offers/accept` med valgt `variant`, luk modal, vis succes.

```jsx
import SponsorOfferModal from "../components/SponsorOfferModal";
// state: offers, offersSeason, sponsorModalOpen, accepting
// fetch i useEffect (samme Bearer-mønster). Vis CTA hvis offers?.length.
// onAccept(variant): POST accept → refetch contract → setSponsorModalOpen(false).
```

> CTA vises kun når kontrakten faktisk er ved at udløbe (backend kan signalere via `offers`-endpoint kun returnerer tilbud når en ny kontrakt skal vælges; ellers tom liste). Hold det enkelt: hvis `/api/sponsor/offers` returnerer ikke-tom liste OG holdets aktive kontrakt-`expires_after_season < kommende sæson`, vis CTA.

- [ ] **Step 2: Verificér build** — `cd frontend && npm run build` → OK.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/BoardPage.jsx
git commit -m "feat(ui): Board-CTA + tilbuds-modal-trigger ved sæson-skifte (#1663)"
```

---

## Phase J — Harness-kalibrering (SIMULÉR-FØR-SHIP, merge-gate)

> Dette er den obligatoriske gate ([[feedback_simulate_before_ship_balance]]). INGEN ship før den er grøn.

### Task J1: Modellér renown + per-løbsdag i overrides

**Files:**
- Modify: `backend/scripts/lib/economyCalibrationOverrides.js`

- [ ] **Step 1:** Tilføj override-felter `wResults`, `maxMultiplier`, og per-dag-split. Eksportér en hjælpefunktion `applyRenownSponsor({division, standing, divisionStandings, fullDays})` der returnerer `{guaranteedBase, perRaceDayTotal}` ved fuld kalender — genbruger `renownTarget` fra `renownEngine.js` (ingen duplikeret matematik), så harness = prod bit-for-bit.

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/lib/economyCalibrationOverrides.js
git commit -m "feat(harness): modellér renown-sponsor + per-løbsdag i overrides (#1663)"
```

### Task J2: Anvend renown-sponsor i scorecards

**Files:**
- Modify: `backend/scripts/prizeDistributionScorecard.js`, `backend/scripts/moneySupplyScorecard.js`

- [ ] **Step 1:** I `prizeDistributionScorecard.runScorecard`: beregn hvert holds renownTarget fra dets simulerede standing → guaranteret base (sæson-start) + per-dag × simulerede løbsdage. Modent felt skal trækkes mod break-even.

- [ ] **Step 2:** I `moneySupplyScorecard --synthetic-only`: friske hold ved FULD kalender skal ramme renownTarget (multiplier 1,0 → uændret total) → D1 +3,6k / D2 +13,6k / D3 +8,6k. **Må ikke regressere.**

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/prizeDistributionScorecard.js backend/scripts/moneySupplyScorecard.js
git commit -m "feat(harness): renown-skaleret sponsor i scorecards (#1663)"
```

### Task J3: Sweep + bag kalibrerede konstanter ind

**Files:**
- Modify: `backend/scripts/economyCalibrationSweep.js`, `backend/lib/renownEngine.js`
- Create: `docs/audits/2026-06-21-renown-sponsor-calibration.md`

- [ ] **Step 1: Kør sweep**

Run: `cd backend && node scripts/economyCalibrationSweep.js --markdown`
Expected: rangeret tabel over `W_RESULTS × MAX_MULTIPLIER × split`-kandidater × 3 seeds. Vælg kandidaten der (i) trækker modent felt mod break-even, (ii) **holder fresh-gaten grøn**, (iii) **sænker Gini/p10–p90** (anti-snowball).

- [ ] **Step 2: Bag de valgte konstanter ind** i `renownEngine.js` (`W_RESULTS`, `MAX_MULTIPLIER`) + split-faktorer i `sponsorOffers.js`. Fjern "PLACEHOLDER indtil harness"-kommentaren.

- [ ] **Step 3: Gen-tjek begge gates**

Run:
```bash
cd backend
node scripts/prizeDistributionScorecard.js --seed=2026
node scripts/prizeDistributionScorecard.js --seed=2027
node scripts/prizeDistributionScorecard.js --seed=2028
node scripts/moneySupplyScorecard.js --synthetic-only
```
Expected: modent felt trukket mod 0,8–1,3×-båndet; fresh-gate ✅ (D1 +3,6k / D2 +13,6k / D3 +8,6k); Gini falder.

- [ ] **Step 4: Skriv kalibrerings-rapport** `docs/audits/2026-06-21-renown-sponsor-calibration.md` (før/efter-divergens, valgte konstanter, fresh-gate-bevis, seed-spænd) — samme struktur som `2026-06-21-economy-fase2-calibration.md`.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/economyCalibrationSweep.js backend/lib/renownEngine.js backend/lib/sponsorOffers.js docs/audits/2026-06-21-renown-sponsor-calibration.md
git commit -m "feat(economy): kalibrér renown-sponsor-konstanter via harness-sweep (#1663)"
```

---

## Phase K — Close-out + verifikation

### Task K1: Fuld lokal CI-gate

- [ ] **Step 1: Kør alt**

Run:
```bash
pwsh -File scripts/verify-local.ps1
cd frontend && npm run lint && npx playwright test core-smoke.spec.js
```
Expected: backend-tests + frontend-tests + frontend-build + lint + core-smoke (alle 3 projekter) grønne. Refresh snapshots hvis visuel ændring (`--update-snapshots`, commit PNG'er).

### Task K2: Patch notes + help/FAQ

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `frontend/public/locales/{en,da}/help.json`

- [ ] **Step 1:** Tilføj patch-note (næste version) der beskriver: sponsor skalerer nu med klub-omdømme + forhandlbare kontrakter + per-løbsdag-indkomst. EN først, DA under. Ingen em-dash/invented content.
- [ ] **Step 2:** Tilføj/opdatér help.json-FAQ om sponsor-forhandling (en+da).
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PatchNotesPage.jsx frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git commit -m "docs(patch-notes): renown-sponsor + forhandlbare kontrakter (#1663)"
```

### Task K3: UI-verify (Playwright-mocks, logget-ind)

- [ ] **Step 1:** Tilføj/genbrug fixtures der mocker `/api/sponsor/offers` + `/api/sponsor/contract`; tag umasket engangs-screenshot af offer-modal + contract-fane. Verificér rendering + ingen console-errors.

### Task K4: FEATURE_STATUS + NOW.md + PR

**Files:**
- Modify: `docs/FEATURE_STATUS.md`, `docs/NOW.md`

- [ ] **Step 1:** Opdatér FEATURE_STATUS (sponsor-kontrakt-kontrakt + per-dag-indkomst).
- [ ] **Step 2:** Opdatér NOW.md (🎯 Next action + 🤖 Working agent reset), budget ≤1.200 tok.
- [ ] **Step 3: Åbn PR** (IKKE auto-merge — indeholder `database/*.sql` → **ejer merger**). PR-body med Brugerverifikation-sektion (`- [ ]`-krav) + link til kalibrerings-rapport.

```bash
git push -u origin feat/1663-renown-sponsor
gh pr create --title "feat(economy): renown-skaleret sponsor + forhandlbare kontrakter (#1663)" --body-file <pr-body>
```

---

## Self-Review (udført ved plan-skrivning)

**Spec-dækning:** §3 renown → Phase A · §4 kontrakter/per-dag → Phase B/D/F · §5 migration → Phase C · §6 arkitektur → Phase E/H/I + loft i E3 · §7 harness → Phase J · §8 verifikation → Phase K. Alle spec-sektioner har en task.

**Placeholder-scan:** Default-konstanter i A1/B1 er eksplicit mærket "PLACEHOLDER indtil harness" og bages ind i J3 — bevidst, ikke et hul. SQL-værdier konkrete. Ingen "TODO/TBD".

**Type-konsistens:** `guaranteed_base`/`per_race_day_rate`/`length_seasons`/`expires_after_season` ens i DB (C1), service (D1), engine (E2), per-dag (F1), API (H1) og UI (I2/I3). `variant`-værdier (`predictable`/`activity`/`long`) ens i sponsorOffers (B1), service-default (D1), modal-i18n (I1/I2). `renownTarget`/`computeRenownMultiplier`-signaturer ens A1→D1→J.
