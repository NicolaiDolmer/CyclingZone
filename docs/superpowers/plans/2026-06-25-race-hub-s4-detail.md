# Race Hub S4 — Løbs-detalje (Lag 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør løbet til et klikbart, status-bevidst objekt: klik → resultater (kørt) eller ruteprofil + terrain-DNA + din opstilling med per-etape rute-match (kommende), med ét visuelt etape-stribe-navigationsmønster overalt.

**Architecture:** Tynd backend-udvidelse (per-etape suitability i eksisterende `/selection`-kontekst, ingen migration) + frontend-genbrug af S1/S2a/S3-fundament (`deriveRaceStatus`, `fitTier`, `freshnessTier`, `FitBar`, `StageProfileSilhouette`). Nye leaf-komponenter (RaceLink, StageStripe, TerrainDNABar, StageDetailPanel) komponeres ind i en udvidet `RaceDetailPage`. Pure logik isoleres i testbare `.js`-helpers (`stageTerrain.js`, `lineupInsight.js`).

**Tech Stack:** React + Vite (frontend, `node --test`), Node + Express (backend, `node:test`), Supabase. i18n via react-i18next (`races`-namespace, en+da). Spec: `docs/superpowers/specs/2026-06-25-race-hub-s4-detail-design.md`.

---

## File structure

**Nye filer:**
- `frontend/src/lib/stageTerrain.js` (+`.test.js`) — pure: terrainBucket, bucketCounts, topDemands.
- `frontend/src/lib/lineupInsight.js` (+`.test.js`) — pure: effectiveStageFit, bestFitRiderId, whyKey.
- `frontend/src/components/RaceLink.jsx` — løb-som-link (model: RiderLink).
- `frontend/src/components/race/TerrainDNABar.jsx` — demand_vector → bar.
- `frontend/src/components/race/StageDetailPanel.jsx` — silhuet + finale-markør + DNA-bar.
- `frontend/src/components/race/StageStripe.jsx` — klikbar etape-stribe (kommende + kørt).

**Ændrede filer:**
- `backend/lib/raceAutopick.js` — ny `stageSuitabilityScores()` export.
- `backend/lib/raceSelection.js:109` — tilføj `stageSuitability` til riderRows.
- `backend/lib/raceSelection.test.js` / `raceAutopick.test.js` — tests.
- `frontend/src/components/race/RaceSelectionPanel.jsx` — per-etape fit + best-fit + why-line (nye props).
- `frontend/src/pages/RaceDetailPage.jsx` — stripe + panel; fetch demand_vector + schedule; kontekst-back-link.
- `frontend/src/components/racehub/RaceHubBoard.jsx:54` — RaceLink i kolonne-header.
- `frontend/src/pages/DashboardPage.jsx:731` — direkte løb-link.
- `frontend/public/locales/{en,da}/races.json` — nye keys.
- `frontend/public/locales/{en,da}/help.json` — race-detalje-sektion.
- `frontend/src/data/patchNotes.js` — v6.11 change-entry.

---

## Task 1: Frontend pure terræn-helpers (`stageTerrain.js`)

**Files:**
- Create: `frontend/src/lib/stageTerrain.js`
- Test: `frontend/src/lib/stageTerrain.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/stageTerrain.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { terrainBucket, bucketCounts, topDemands, TERRAIN_BUCKETS } from "./stageTerrain.js";

test("terrainBucket: 9 profiltyper → 5 buckets (mirror af backend raceTerrain.js)", () => {
  assert.equal(terrainBucket("flat"), "flat");
  assert.equal(terrainBucket("rolling"), "flat");
  assert.equal(terrainBucket("hilly"), "hilly");
  assert.equal(terrainBucket("classic"), "hilly");
  assert.equal(terrainBucket("mountain"), "mountain");
  assert.equal(terrainBucket("high_mountain"), "mountain");
  assert.equal(terrainBucket("cobbles"), "cobbles");
  assert.equal(terrainBucket("itt"), "itt");
  assert.equal(terrainBucket("ttt"), "itt");
});

test("terrainBucket: ukendt/null → flat (defensiv default)", () => {
  assert.equal(terrainBucket("nonsense"), "flat");
  assert.equal(terrainBucket(null), "flat");
  assert.equal(terrainBucket(undefined), "flat");
});

test("TERRAIN_BUCKETS: 5 i stabil rækkefølge", () => {
  assert.deepEqual(TERRAIN_BUCKETS, ["flat", "hilly", "mountain", "cobbles", "itt"]);
});

test("bucketCounts: tæller pr. bucket, sorteret count desc, tiebreak bucket-rækkefølge", () => {
  const stages = [
    { profile_type: "mountain" }, { profile_type: "high_mountain" },
    { profile_type: "flat" }, { profile_type: "rolling" }, { profile_type: "itt" },
  ];
  assert.deepEqual(bucketCounts(stages), [
    { bucket: "flat", count: 2 },
    { bucket: "mountain", count: 2 },
    { bucket: "itt", count: 1 },
  ]);
});

test("bucketCounts: tom → tom liste", () => {
  assert.deepEqual(bucketCounts([]), []);
  assert.deepEqual(bucketCounts(null), []);
});

test("topDemands: top-N evner, ekskl. randomness, sorteret vægt desc", () => {
  const dv = { climbing: 0.52, endurance: 0.18, tempo: 0.08, recovery: 0.06, randomness: 0.10 };
  assert.deepEqual(topDemands(dv, 3), [
    { ability: "climbing", weight: 0.52 },
    { ability: "endurance", weight: 0.18 },
    { ability: "tempo", weight: 0.08 },
  ]);
});

test("topDemands: tom/null demand_vector → tom liste", () => {
  assert.deepEqual(topDemands(null), []);
  assert.deepEqual(topDemands({}), []);
  assert.deepEqual(topDemands({ randomness: 0.5 }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/stageTerrain.test.js`
Expected: FAIL — `Cannot find module './stageTerrain.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/lib/stageTerrain.js
// Race Hub S4: rene terræn-helpers til løbs-detaljen. Ingen React, ingen I/O.
// terrainBucket SPEJLER backend/lib/raceTerrain.js (samme 9→5 mapping) — drift-guard
// i stageTerrain.test.js (mønstret som strategyLogic.js/TERRAIN_BUCKETS).

export const TERRAIN_BUCKETS = ["flat", "hilly", "mountain", "cobbles", "itt"];

const PROFILE_TO_BUCKET = {
  flat: "flat", rolling: "flat",
  hilly: "hilly", classic: "hilly",
  mountain: "mountain", high_mountain: "mountain",
  cobbles: "cobbles",
  itt: "itt", ttt: "itt",
};

export function terrainBucket(profileType) {
  return PROFILE_TO_BUCKET[profileType] || "flat";
}

// [{bucket, count}] sorteret count desc, tiebreak = TERRAIN_BUCKETS-index (stabil).
export function bucketCounts(stages) {
  if (!Array.isArray(stages) || !stages.length) return [];
  const counts = new Map();
  for (const s of stages) {
    const b = terrainBucket(s?.profile_type);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count || TERRAIN_BUCKETS.indexOf(a.bucket) - TERRAIN_BUCKETS.indexOf(b.bucket));
}

// Top-N evner ruten belønner, ekskl. randomness. [{ability, weight}] vægt desc.
export function topDemands(demandVector, n = 5) {
  if (!demandVector || typeof demandVector !== "object") return [];
  return Object.entries(demandVector)
    .filter(([k, w]) => k !== "randomness" && Number.isFinite(w) && w > 0)
    .map(([ability, weight]) => ({ ability, weight }))
    .sort((a, b) => b.weight - a.weight || a.ability.localeCompare(b.ability))
    .slice(0, n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/stageTerrain.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/lib/stageTerrain.js frontend/src/lib/stageTerrain.test.js
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 pure terræn-helpers (terrainBucket/bucketCounts/topDemands) (#1834)"
```

---

## Task 2: Backend per-etape suitability (`stageSuitabilityScores`)

**Files:**
- Modify: `backend/lib/raceAutopick.js` (tilføj export efter `suitabilityScore`, ~:38)
- Test: `backend/lib/raceAutopick.test.js`

- [ ] **Step 1: Write the failing test** (tilføj nederst i raceAutopick.test.js)

```js
import { stageSuitabilityScores, suitabilityScore } from "./raceAutopick.js";

test("stageSuitabilityScores: ét 0-100-tal pr. etape, samme skala som suitabilityScore-snit", () => {
  const climber = ab({ climbing: 90, sprint: 20 });
  const stages = [flatStage, mtnStage];
  const perStage = stageSuitabilityScores(climber, stages);
  assert.equal(perStage.length, 2);
  // Klatrer scorer højere på bjerg-etapen end på flad.
  assert.ok(perStage[1] > perStage[0]);
  // Snit af per-etape ≈ det eksisterende løb-snit (×100), tolerance for afrunding.
  const avg = (perStage[0] + perStage[1]) / 2;
  assert.ok(Math.abs(avg - Math.round(suitabilityScore(climber, stages) * 100)) <= 1);
});

test("stageSuitabilityScores: tom stages → tom liste; manglende demand_vector → 0", () => {
  assert.deepEqual(stageSuitabilityScores(ab(), []), []);
  assert.deepEqual(stageSuitabilityScores(ab(), [{ stage_number: 1 }]), [0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceAutopick.test.js`
Expected: FAIL — `stageSuitabilityScores is not a function`.

- [ ] **Step 3: Write minimal implementation** (i `backend/lib/raceAutopick.js`, lige efter `suitabilityScore`, før `FLAT_PROFILES`)

```js
// Per-etape egnethed (0-100) — samme terrainScore som suitabilityScore, men ÉT tal
// pr. etape i stedet for snittet. Til S4 rute-match: rytter mod hver etapes krav.
export function stageSuitabilityScores(abilities, stages) {
  if (!Array.isArray(stages)) return [];
  return stages.map((s) => Math.round(terrainScore(abilities, s.demand_vector || {}) * 100));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test lib/raceAutopick.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add backend/lib/raceAutopick.js backend/lib/raceAutopick.test.js
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 per-etape suitability-helper (stageSuitabilityScores) (#1834)"
```

---

## Task 3: Eksponér `stageSuitability` i selection-kontekst

**Files:**
- Modify: `backend/lib/raceSelection.js` (import + riderRows, :5 og :100-113)
- Test: `backend/lib/raceSelection.test.js`

- [ ] **Step 1: Write the failing test** — verificér at riderRows får `stageSuitability` (array, længde = antal etaper). Hvis `raceSelection.test.js` ikke allerede tester `getSelectionContext` med en mock-supabase, tilføj en fokuseret enhedstest af mapping-laget ved at importere en udtrukket helper. **Konkret:** ekstrahér mapping til en pure `buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr })` og test den:

```js
import { buildRiderRows } from "./raceSelection.js";

test("buildRiderRows: hver rytter får stageSuitability-array (længde = antal etaper)", () => {
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, randomness: 0.5 } },
    { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, randomness: 0.4 } },
  ];
  const riders = [{ id: "r1", firstname: "A", lastname: "B", primary_type: "climber", secondary_type: null }];
  const abilityByRider = new Map([["r1", { climbing: 90, sprint: 20 }]]);
  const conditionByRider = new Map([["r1", { form: 60, fatigue: 10, injured_until: null }]]);
  const rows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr: "2026-06-25" });
  assert.equal(rows[0].stageSuitability.length, 2);
  assert.ok(rows[0].stageSuitability[1] > rows[0].stageSuitability[0]); // klatrer: bjerg > flad
  assert.equal(typeof rows[0].suitability, "number"); // løb-snit bevaret
});

test("buildRiderRows: ingen evner → suitability null + stageSuitability null", () => {
  const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }];
  const rows = buildRiderRows({
    riders: [{ id: "r1", firstname: "A", lastname: "B" }],
    stages, abilityByRider: new Map(), conditionByRider: new Map(), todayStr: "2026-06-25",
  });
  assert.equal(rows[0].suitability, null);
  assert.equal(rows[0].stageSuitability, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test lib/raceSelection.test.js`
Expected: FAIL — `buildRiderRows is not a function`.

- [ ] **Step 3: Write minimal implementation** — i `backend/lib/raceSelection.js`: opdatér import (:5) til også at hente `stageSuitabilityScores`, ekstrahér `buildRiderRows` og brug den i `getSelectionContext`.

```js
// :5 — udvid import
import { selectionSizeForRace, suitabilityScore, stageSuitabilityScores } from "./raceAutopick.js";
```

```js
// Ny export (placér før getSelectionContext). Ren mapping — testbar uden DB.
export function buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr }) {
  return riders.map((r) => {
    const cond = conditionByRider.get(r.id);
    const ab = abilityByRider.get(r.id);
    const hasFit = ab && stages.length;
    return {
      id: r.id,
      name: [r.firstname, r.lastname].filter(Boolean).join(" "),
      primaryType: r.primary_type ?? null,
      secondaryType: r.secondary_type ?? null,
      suitability: hasFit ? Math.round(suitabilityScore(ab, stages) * 100) : null,
      // S4: per-etape rute-match. null når evner mangler (graceful degrade på klienten).
      stageSuitability: hasFit ? stageSuitabilityScores(ab, stages) : null,
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
      injured: !!(cond?.injured_until && cond.injured_until >= todayStr),
    };
  });
}
```

Erstat den inline `riders.map(...)` i `getSelectionContext` (:100-114) med:

```js
  const riderRows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test lib/raceSelection.test.js`
Expected: PASS. Kør også hele backend-suiten: `cd backend && npm test` → grøn.

- [ ] **Step 5: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add backend/lib/raceSelection.js backend/lib/raceSelection.test.js
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 eksponér per-etape stageSuitability i /selection (ingen migration) (#1834)"
```

---

## Task 4: `lineupInsight.js` — pure rute-match-logik

**Files:**
- Create: `frontend/src/lib/lineupInsight.js`
- Test: `frontend/src/lib/lineupInsight.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/lineupInsight.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveStageFit, bestFitRiderId } from "./lineupInsight.js";

const rider = (id, suitability, stageSuitability) => ({ id, suitability, stageSuitability });

test("effectiveStageFit: bruger per-etape når stageIndex sat, ellers løb-snit", () => {
  const r = rider("r1", 70, [40, 90]);
  assert.equal(effectiveStageFit(r, 1), 90);
  assert.equal(effectiveStageFit(r, 0), 40);
  assert.equal(effectiveStageFit(r, null), 70);
});

test("effectiveStageFit: manglende stageSuitability → fald tilbage til løb-snit", () => {
  const r = rider("r1", 70, null);
  assert.equal(effectiveStageFit(r, 1), 70);
});

test("effectiveStageFit: intet fit → null", () => {
  assert.equal(effectiveStageFit(rider("r1", null, null), 0), null);
});

test("bestFitRiderId: id med højest effektiv fit blandt valgte (tiebreak id asc)", () => {
  const riders = [rider("r1", 50, [50, 60]), rider("r2", 50, [50, 80]), rider("r3", 50, [50, 80])];
  assert.equal(bestFitRiderId(riders, ["r1", "r2", "r3"], 1), "r2");
  assert.equal(bestFitRiderId(riders, ["r1"], 1), "r1");
  assert.equal(bestFitRiderId(riders, [], 1), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/lineupInsight.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/lib/lineupInsight.js
// Race Hub S4: rene helpers til opstilling-rute-match. Ingen React.

// Effektivt fit for en rytter på en valgt etape: per-etape når tilgængelig,
// ellers løb-snit. null når intet fit findes (graceful degrade).
export function effectiveStageFit(rider, stageIndex) {
  if (stageIndex != null && Array.isArray(rider?.stageSuitability)) {
    const v = rider.stageSuitability[stageIndex];
    if (Number.isFinite(v)) return v;
  }
  return Number.isFinite(rider?.suitability) ? rider.suitability : null;
}

// id på den valgte rytter med højest effektivt fit (best-fit-nudge). Tiebreak id asc.
export function bestFitRiderId(riders, selectedIds, stageIndex) {
  let best = null, bestScore = -Infinity;
  for (const r of riders) {
    if (!selectedIds.includes(r.id)) continue;
    const f = effectiveStageFit(r, stageIndex);
    if (f == null) continue;
    if (f > bestScore || (f === bestScore && best != null && String(r.id) < String(best))) {
      best = r.id; bestScore = f;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/lineupInsight.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/lib/lineupInsight.js frontend/src/lib/lineupInsight.test.js
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 pure rute-match-helpers (effectiveStageFit/bestFitRiderId) (#1834)"
```

---

## Task 5: `RaceLink.jsx`

**Files:**
- Create: `frontend/src/components/RaceLink.jsx`

- [ ] **Step 1: Implementér** (model: `RiderLink.jsx`/`TeamLink.jsx` — samme graceful-`<span>`-mønster, valgfri `?stage=`)

```jsx
import { Link } from "react-router-dom";

// Løbet som førsteklasses klikbart objekt → /races/:id (valgfri ?stage=N).
// id mangler → ren <span> (graceful, som RiderLink/TeamLink). Rygrad for S5/S6.
export default function RaceLink({ id, stage, className = "", stopPropagation = false, children, ...rest }) {
  if (!id) {
    return <span className={className} {...rest}>{children}</span>;
  }
  const handleClick = stopPropagation ? (e) => e.stopPropagation() : undefined;
  const to = stage != null ? `/races/${id}?stage=${stage}` : `/races/${id}`;
  return (
    <Link to={to} onClick={handleClick} className={className} {...rest}>
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Verificér import-paritet** — `node --check` via build senere; her: bekræft at filen følger RiderLink (default export, react-router `Link`).

- [ ] **Step 3: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/components/RaceLink.jsx
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 RaceLink — løb som klikbart objekt (#1834)"
```

---

## Task 6: `TerrainDNABar.jsx`

**Files:**
- Create: `frontend/src/components/race/TerrainDNABar.jsx`

- [ ] **Step 1: Implementér** — segmenteret bar fra `topDemands(demand_vector)`. Top-demand = guld (`bg-cz-accent`), resten = navy-tints via cz-tokens. Labels med evne-navn + procent. Skjuler sig (`return null`) ved tom demand_vector (graceful degrade).

```jsx
import { useTranslation } from "react-i18next";
import { topDemands } from "../../lib/stageTerrain.js";

// Editorial "terrain DNA"-bar: hvilke evner etapen belønner (ægte demand_vector).
// Tom/manglende demand_vector → null (ingen falsk visning).
const SEG_FILL = ["bg-cz-accent", "bg-cz-2", "bg-cz-3", "bg-cz-border", "bg-cz-border"];

export default function TerrainDNABar({ demandVector, max = 5 }) {
  const { t } = useTranslation("races");
  const demands = topDemands(demandVector, max);
  if (!demands.length) return null;
  return (
    <div>
      <p className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold mb-1.5">
        {t("detail.terrainDna.label")}
      </p>
      <div className="flex h-3 rounded-cz overflow-hidden border border-cz-border" role="img"
        aria-label={demands.map((d) => `${t(`detail.ability.${d.ability}`)} ${Math.round(d.weight * 100)}%`).join(", ")}>
        {demands.map((d, i) => (
          <div key={d.ability} className={SEG_FILL[i] || "bg-cz-border"}
            style={{ width: `${Math.round(d.weight * 100)}%` }} title={`${t(`detail.ability.${d.ability}`)} ${Math.round(d.weight * 100)}%`} />
        ))}
      </div>
      <p className="text-cz-2 text-[11px] font-mono mt-1.5 leading-relaxed">
        {demands.map((d, i) => (
          <span key={d.ability} className={i === 0 ? "text-cz-accent-t font-semibold" : ""}>
            {i > 0 && " · "}{t(`detail.ability.${d.ability}`)} {Math.round(d.weight * 100)}%
          </span>
        ))}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/components/race/TerrainDNABar.jsx
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 TerrainDNABar — demand_vector → editorial bar (#1834)"
```

---

## Task 7: `StageDetailPanel.jsx` (silhuet + finale-markør + DNA)

**Files:**
- Create: `frontend/src/components/race/StageDetailPanel.jsx`

- [ ] **Step 1: Implementér** — genbrug silhuet-geometri (`profileShape`) + terræn/finale-label (`profileLabelKey`/`finaleLabelKey`) + `TerrainDNABar`. Finale-markør = lille guld-element ved silhuettens mål-ende. Stor silhuet (`preserveAspectRatio="none"`, viewBox 100×26 med fyldt areal under linjen).

```jsx
import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey, finaleLabelKey } from "../../lib/stageProfileConfig.js";
import TerrainDNABar from "./TerrainDNABar.jsx";

// Valgt-etape-panel: stor silhuet + finale-markør + terræn-navn + terrain-DNA.
// profile mangler/ukendt terræn → null (graceful, som StageProfileCard).
export default function StageDetailPanel({ profile, stageLabel }) {
  const { t } = useTranslation("races");
  const labelKey = profile && profileLabelKey(profile.profile_type);
  if (!labelKey) return null;
  const finaleKey = finaleLabelKey(profile.finale_type);
  const { points } = profileShape(profile.profile_type);

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <div className="relative">
        <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="w-full h-24 block text-cz-1" aria-hidden="true">
          <polyline points={`${points} 100,24 0,24`} fill="currentColor" fillOpacity="0.06" stroke="none" />
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {/* Finale-markør ved målet (højre ende). */}
        <span className="absolute -top-0.5 right-0 text-cz-accent-t" aria-hidden="true" title={finaleKey ? t(`detail.${finaleKey}`) : ""}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1 V13" stroke="currentColor" strokeWidth="1.5" /><path d="M3.6 1.5 L11 3.2 L7 5 L11 6.8 L3.6 5" fill="currentColor" fillOpacity="0.85" /></svg>
        </span>
      </div>
      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        <p className="text-cz-1 text-sm font-semibold">
          {stageLabel && <span className="text-cz-3 font-normal me-1.5">{stageLabel} ·</span>}
          {t(`detail.${labelKey}`)}
        </p>
        {finaleKey && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30">
            {t(`detail.${finaleKey}`)}
          </span>
        )}
      </div>
      <div className="mt-3">
        <TerrainDNABar demandVector={profile.demand_vector} />
      </div>
      <p className="text-cz-3 text-[11px] mt-2">{t("detail.stageProfile.note")}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/components/race/StageDetailPanel.jsx
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 StageDetailPanel — silhuet + finale-markør + terrain-DNA (#1747)"
```

---

## Task 8: `StageStripe.jsx` (klikbar etape-stribe)

**Files:**
- Create: `frontend/src/components/race/StageStripe.jsx`

- [ ] **Step 1: Implementér** — vandret stribe af etape-chips. Props: `stages` (array `{stage_number, profile_type, finale_type}`), `activeStage` (nr|"overall"), `onSelect(stageOrOverall)`, valgfri `times` (map stage_number→{timeLabel}), valgfri `showOverall` (kørt løb → leder/GC-chip først). Hver chip: mini-silhuet (`profileShape`) + nr + (tid hvis kommende). Valgt chip = guld-ramme. One-day (1 etape) → render intet (parent viser panelet direkte).

```jsx
import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey } from "../../lib/stageProfileConfig.js";

function MiniSilhouette({ profileType }) {
  const { points } = profileShape(profileType);
  return (
    <svg viewBox="0 0 100 24" className="w-full h-4 block" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// Klikbar etape-stribe — ét navigations-mønster på kommende OG kørte løb.
// stages.length < 2 og ingen overall → null (one-day: parent viser panelet direkte).
export default function StageStripe({ stages = [], activeStage, onSelect, times = null, showOverall = false }) {
  const { t } = useTranslation("races");
  if (stages.length < 2 && !showOverall) return null;

  const chip = (active, key, content, onClick, title) => (
    <button key={key} type="button" onClick={onClick} title={title}
      className={`flex-1 min-w-0 rounded-cz px-1.5 pt-1.5 pb-1 text-center border transition-colors
        ${active ? "border-cz-accent bg-cz-accent/[0.06]" : "border-cz-border bg-cz-card hover:bg-cz-subtle"}`}>
      {content}
    </button>
  );

  return (
    <div className="flex gap-1.5">
      {showOverall && chip(
        activeStage === "overall", "overall",
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${activeStage === "overall" ? "text-cz-accent-t" : "text-cz-2"}`}>{t("detail.tabOverall")}</span>,
        () => onSelect("overall"), t("detail.tabOverall"),
      )}
      {stages.map((s) => {
        const n = s.stage_number ?? 1;
        const active = activeStage === n;
        const label = profileLabelKey(s.profile_type);
        return chip(active, n, (
          <span className={active ? "text-cz-accent-t" : "text-cz-2"}>
            <MiniSilhouette profileType={s.profile_type} />
            <span className="block text-[10px] font-mono mt-0.5">{n}</span>
            {times?.[n]?.timeLabel && <span className="block text-[9px] font-mono text-cz-3 leading-none">{times[n].timeLabel}</span>}
          </span>
        ), () => onSelect(n), label ? t(`detail.${label}`) : undefined);
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/components/race/StageStripe.jsx
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 StageStripe — visuel etape-navigation (#1834)"
```

---

## Task 9: Forbedr `RaceSelectionPanel` med per-etape rute-match

**Files:**
- Modify: `frontend/src/components/race/RaceSelectionPanel.jsx`

- [ ] **Step 1: Tilføj props + imports.** Nye props: `selectedStageIndex` (0-based nr|null), `selectedStageBucket` (string|null). Importér `FitBar`, `effectiveStageFit`, `bestFitRiderId`.

```jsx
import FitBar from "../racehub/FitBar.jsx";
import { effectiveStageFit, bestFitRiderId } from "../../lib/lineupInsight.js";
```

Signatur: `export default function RaceSelectionPanel({ raceId, selectedStageIndex = null, selectedStageBucket = null }) {`

- [ ] **Step 2: Beregn best-fit + skift suitability-kolonnen til FitBar.** Efter `selectedRiders` (:73):

```jsx
  const bestId = bestFitRiderId(riders, sel.riderIds, selectedStageIndex);
```

Erstat suitability-cellen (:216) med per-etape FitBar + best-fit-markør:

```jsx
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-2 justify-end">
                      {rider.id === bestId && (
                        <span className="text-[9px] uppercase tracking-wide text-cz-accent-t" title={t("selection.bestForStage")}>{t("selection.best")}</span>
                      )}
                      <FitBar score={effectiveStageFit(rider, selectedStageIndex)} />
                    </span>
                  </td>
```

- [ ] **Step 3: "Why this rider"-linje + dynamisk kolonne-header.** Kolonne-header (:185) bliver kontekst-bevidst:

```jsx
              <th scope="col" className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">
                {selectedStageIndex != null ? t("selection.routeMatch") : t("selection.suitability")}
              </th>
```

Tilføj en kort linje under suitability-help (:158) når en etape + best-fit er valgt (delt "why this rider"-hint, datakonstrueret af bucket + fit):

```jsx
        {selectedStageBucket && bestId && (
          <p className="text-cz-2 text-[11px] leading-snug">
            {t("selection.whyBest", {
              bucket: t(`strategy.buckets.${selectedStageBucket}`),
              name: riders.find((r) => r.id === bestId)?.name ?? "",
            })}
          </p>
        )}
```

- [ ] **Step 4: Verificér build + manuel logik.** Kør `cd frontend && npm run build` → grøn (ingen manglende imports/extensionless — jf. #803). Panelet renderer stadig uden de nye props (default null → løb-snit-fit, ingen best-markør).

- [ ] **Step 5: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/components/race/RaceSelectionPanel.jsx
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 opstilling med per-etape rute-match + best-fit (#1834)"
```

---

## Task 10: Integrér i `RaceDetailPage` (stribe + panel + nav-konsolidering)

**Files:**
- Modify: `frontend/src/pages/RaceDetailPage.jsx`

- [ ] **Step 1: Imports + selected-stage-state.** Tilføj imports: `StageStripe`, `StageDetailPanel`, `bucketCounts`, `terrainBucket` (fra `stageTerrain.js`). Behold `useSearchParams`-mønstret. Udvid `races`-select (ingen — bruger eksisterende) og **udvid `race_stage_profiles`-select (:134)** med `demand_vector`:

```jsx
      .from("race_stage_profiles")
      .select("stage_number, profile_type, finale_type, demand_vector")
```

- [ ] **Step 2: Kommende-gren — erstat stablede profilkort + skema-kort med stribe + panel.** Erstat blokkene :238-252 (StageScheduleCard + stablede StageProfileCard). Ny struktur for `race.status === "scheduled"`:
  - Udled `scheduledStages` = `stageProfiles` (allerede sorteret).
  - `activeStage` fra `?stage=N` (default = laveste etape-nr; one-day → 1).
  - `<StageStripe stages={scheduledStages} activeStage={activeStage} onSelect={changeStage} />` (kun ved ≥2 etaper).
  - `<StageDetailPanel profile={profileByStage[activeStage]} stageLabel={isMulti ? t("detail.tabStage", {number: activeStage}) : undefined} />`.
  - Race-DNA-gestalt over striben (kun stage race): `bucketCounts(scheduledStages)` → "3 mountain · 2 flat" via `t("detail.raceDna")`.
  - Næste-start-countdown i header: behold via en let inline-fetch af `race_stage_schedule` (genbrug `stageScheduleConfig.js`-helpers) ELLER behold `StageScheduleCard` KUN hvis stripe-tider er for tunge — **men per D4/konsolidering fjernes kortet**; tider hentes i `loadAll` og gives til `<StageStripe times=...>`. (Implementér schedule-fetch i `loadAll`, map stage_number→timeLabel via `Intl.DateTimeFormat` i `RACE_TIMEZONE`.)

- [ ] **Step 3: Opstilling med valgt etape.** Send valgt etape til panelet:

```jsx
        <RaceSelectionPanel
          raceId={race.id}
          selectedStageIndex={isMulti ? activeStage - 1 : 0}
          selectedStageBucket={terrainBucket(profileByStage[activeStage]?.profile_type)}
        />
```

- [ ] **Step 4: Kørte løb — stribe erstatter tekst-faner.** Erstat `TabButton`-rækken (:277-286) med `<StageStripe stages={stageProfilesForResults} activeStage={activeTab === "samlet" ? "overall" : Number(activeTab.slice(6))} showOverall onSelect={(v) => changeTab(v === "overall" ? "samlet" : `stage-${v}`)} />`. Behold `OverallTab`/`StageTab`/`ResultTable` uændret. `stageProfilesForResults` = profiler for de etaper der har resultater (`stageNumbers`).

- [ ] **Step 5: Kontekst-bevarende back-link.** Erstat hårdkodet `/races?tab=library` (:193, :207) med en `useLocation().state?.from`-baseret tilbage-destination (fald tilbage til `/races?tab=library` når ingen referrer). RaceLink-kaldere sender `state={{ from: ... }}` hvor relevant (board/dashboard).

- [ ] **Step 6: Verificér.** `cd frontend && npm run build` grøn. Manuel: scheduled-gren viser stribe+panel+DNA; completed-gren navigerer via stribe; one-day viser panel uden stribe; manglende demand_vector → ingen DNA-bar; ikke-deltager → panel skjult, profil+DNA vist.

- [ ] **Step 7: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/pages/RaceDetailPage.jsx
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 løbs-detalje — stribe+panel+DNA, nav-konsolidering, demand_vector (#1834, #1747)"
```

---

## Task 11: RaceLink i board + dashboard + sweep

**Files:**
- Modify: `frontend/src/components/racehub/RaceHubBoard.jsx:54`
- Modify: `frontend/src/pages/DashboardPage.jsx:731`

- [ ] **Step 1: Board-header.** Importér `RaceLink`. Erstat `<p className="text-sm font-semibold text-cz-1">{column.name}</p>` (:54) med:

```jsx
<RaceLink id={column.id} state={{ from: "board" }} className="text-sm font-semibold text-cz-1 hover:text-cz-accent-t transition-colors">{column.name}</RaceLink>
```

- [ ] **Step 2: Dashboard upcoming.** Erstat `<Link key={race.id} to="/races" ...>` (:731) med `to={`/races/${race.id}`}` (behold className + state={{ from: "dashboard" }}). Importér intet nyt (Link findes).

- [ ] **Step 3: Sweep øvrige løbsnavne** (resultater/standings hvor et løbsnavn vises) → `RaceLink`. Hold konsistent; ingen funktionsændring udover klikbarhed.

- [ ] **Step 4: Verificér + commit.** `cd frontend && npm run build` grøn.

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/components/racehub/RaceHubBoard.jsx frontend/src/pages/DashboardPage.jsx
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "feat(race-hub): S4 RaceLink i board-header + direkte dashboard-link (#1834)"
```

---

## Task 12: i18n-nøgler (`races.json` en+da)

**Files:**
- Modify: `frontend/public/locales/en/races.json` (under `detail` + `selection`)
- Modify: `frontend/public/locales/da/races.json`

- [ ] **Step 1: Tilføj nøgler.** EN (under `detail`): `terrainDna.label` = "Terrain DNA", `raceDna` = "This race: {summary}", `ability.*` for de 15 evner (climbing="Climbing", time_trial="Time trial", sprint="Sprint", punch="Punch", endurance="Endurance", cobblestone="Cobbles", acceleration="Acceleration", recovery="Recovery", tactics="Tactics", positioning="Positioning", flat="Flat", tempo="Tempo", durability="Durability", aggression="Aggression", descending="Descending"). Under `selection`: `routeMatch` = "Route match", `best` = "Best", `bestForStage` = "Your strongest fit for this stage", `whyBest` = "This {bucket} stage rewards your strongest fit: {name}." DA spejler. Genbrug eksisterende `strategy.buckets.*`.

- [ ] **Step 2: i18n-leak-gate.** Kør i18n-key-tjek (del af CI-gate) → ingen manglende/uoversatte nøgler en↔da.

- [ ] **Step 3: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/public/locales/en/races.json frontend/public/locales/da/races.json
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "i18n(race-hub): S4 terrain-DNA + rute-match nøgler (en+da)"
```

---

## Task 13: Patch notes + help.json

**Files:**
- Modify: `frontend/src/data/patchNotes.js` (tilføj change-entry i v6.11 `changes`-array)
- Modify: `frontend/public/locales/{en,da}/help.json`

- [ ] **Step 1: Patch note** — tilføj i v6.11 `changes`:

```js
      {
        "category": "improved",
        "audience": "player",
        "topic": "Races",
        "en": {
          "title": "Click any race to see its route, terrain and your lineup",
          "body": "Race names are now clickable everywhere. Each race opens a detail view: results if it has run, or the route profile per stage with a terrain-DNA breakdown of what each stage rewards and your lineup's route match. Stages are navigated with one visual stage stripe on both upcoming and finished races."
        },
        "da": {
          "title": "Klik et løb for at se rute, terræn og din opstilling",
          "body": "Løbsnavne er nu klikbare overalt. Hvert løb åbner en detalje-visning: resultater hvis det er kørt, ellers ruteprofilen pr. etape med en terræn-DNA-opdeling af hvad hver etape belønner og din opstillings rute-match. Etaper navigeres med én visuel etape-stribe på både kommende og kørte løb."
        },
        "refs": [1834, 1747]
      },
```

- [ ] **Step 2: help.json** — tilføj under `sections.season` (en+da) en undersektion `raceDetail` med `title` + `text` der forklarer: klikbart løb, ruteprofil pr. etape, terrain-DNA (kategori-baseret, ikke målt højde — ÆRLIG), rute-match pr. etape. DA spejler.

- [ ] **Step 3: Commit**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/src/data/patchNotes.js frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "docs(race-hub): S4 patch note + help (en+da) — løbs-detalje (#1834)"
```

---

## Task 14: CI-gate + playwright + snapshot-refresh

- [ ] **Step 1: Lokal verifikation** — `pwsh -File scripts/verify-local.ps1` (backend-tests + frontend-tests + build) grøn.
- [ ] **Step 2: Fulde gates** — `cd frontend && npm run lint` + i18n-leak + tone-em-dash + warning-budget grøn.
- [ ] **Step 3: Playwright alle 3 projekter** — `cd frontend && npx playwright test core-smoke.spec.js` (desktop-chromium + mobile-chromium + mobile-webkit). Visuel ændring på detalje/resultat → `npx playwright test core-smoke --update-snapshots` + commit PNG'erne (alle 3, win32).
- [ ] **Step 4: Commit snapshots**

```bash
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail add frontend/tests
git -C C:/dev/CyclingZone-worktrees/feat-race-hub-s4-detail commit -m "test(race-hub): S4 snapshot-refresh (alle 3 playwright-projekter)"
```

---

## Task 15: Adversariel review + PR

- [ ] **Step 1: Workflow-review** — fan-out adversarielle reviewers på diffen (korrekthed, graceful-degrade, i18n-fuldstændighed, AI-slop-tjek, idempotens af backend-helper). Ret bekræftede fund.
- [ ] **Step 2: PR** — `gh pr create` med fuld **Brugerverifikation**-sektion (afkryds-bokse). Body: hvad/hvorfor, skærmbilleder, `Refs #1834, #1747`. **Ingen `database/*.sql` → AI kan selv-merge efter grøn CI + ejer-verifikation** (men afvent ejer-go hvis ønsket).
- [ ] **Step 3: Efter merge** — markér #1834-detalje-del + #1747-ruteprofil-del; opdatér `docs/NOW.md` (🎯 Next action → S5/S6/S7; 🤖 Working agent → Ingen) + `FEATURE_STATUS.md` hvis kontrakter ændret.

---

## Self-review (mod spec)

**Spec-dækning:** D1 manager-centrisk (T9/T10) · D2 per-etape (T2/T3/T4/T9) · D3 kategori udskudt (ikke i plan) · D4 stribe overalt (T8/T10) · D5 opportunity-cost udskudt (ikke i plan) · D6 RaceLink app-bredt (T5/T11) · D7 konsolidering (T10: slet stablede kort + skema-kort + tekst-faner; genbrug panel/silhuet). World-class: stribe-kontroltårn (T8), race-DNA (T10), DNA-bar (T6), why/best-fit (T4/T9), finale-markør (T7). Test: backend (T2/T3), frontend (T1/T4), playwright (T14).

**Placeholder-scan:** Pure helpers + tests har komplet kode. Komponenter har komplet JSX. Integration (T10) beskriver præcise erstatninger med file:line; udfør mod den læste kildekode.

**Type-konsistens:** `stageSuitability: number[]|null` (T3) ↔ `effectiveStageFit(rider, stageIndex)` læser `rider.stageSuitability[stageIndex]` (T4) ↔ `selectedStageIndex` 0-based (T9/T10). `bestFitRiderId(riders, selectedIds, stageIndex)` (T4) ↔ kaldt i T9. `topDemands`/`terrainBucket`/`bucketCounts` (T1) ↔ brugt i T6/T7/T10. Konsistent.
</content>
