# Faciliteter + Staff (Slice A, bølge A3: "Klub"-UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg den bruger-vendte "Klub"-flade (faciliteter-oversigt med 5 spor × 5 tiers, priser i CZ$ + "≈ X sæsoners overskud", per-sæson drift, og staff-panel med kandidater/ansæt/fyr) mod den eksisterende A1-backend-kontrakt, gated bag `FACILITIES_ENABLED` via API-svaret (skjult indtil ejer-flip), med en **statefuld preview-mock** så ejeren kan klikke hele flowet igennem FØR merge.

**Architecture:** Data-drevet React-side (`KlubPage`) der læser den beregnede kontrakt fra `GET /api/club/facilities` og muterer via de fire POST-endpoints — nøjagtig samme hook-mønster som `useAcademy` (fetch + Bearer, graceful `enabled`-state på 403). Al display-logik (spor-/rolle-labels, effekt-formatering, tid-som-valuta) ligger i **rene lib-funktioner** (`facilityDisplay.js`) der unit-testes via `node --test`; siden selv dækkes af source/wiring-tests (samme mønster som `TrainingPage.wiring.test.js` + `academyNavVisibility.test.js`). Nav-item + side gates på en ren visibility-funktion. Preview-mocken er statefuld (køb hæver tier, ansæt fylder slot) så gennemklikket er ægte. Backend udvides additivt (ingen migration) med to display-felter (`seasonsEquivalent`, `effectLive`) så tid-som-valuta og live-vs-target holdes SSOT på backend.

**Tech Stack:** React + Vite, react-i18next (ICU), Tailwind + CZ-design-tokens (`font-display`=Bebas, `font-mono`/`font-data`=Inter Tight, `cz-*`-farver, `rounded-cz`), Node.js ESM backend, `node --test` (backend + frontend).

**Spec:** `docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md` §2.1/§2.2/§2.4/§2.7. A1-kontrakt: PR #2213. A2-kalibrering: `docs/audits/2026-07-05-facility-investment-calibration.md`.

**Ejer-beslutninger (design-runde 2026-07-05, LÅST):**
- **Q1 → Udvid util-modellen** (staff-løn skal bide): **engine-arbejde i Plan B**, ikke her. A3-UI er data-drevet og viser blot hvad API returnerer → uændret af rekalibreringen.
- **Q2 → Kommerciel = rent sink** (payback ∞ bevidst): UI mærker det ærligt ("Pure sink · Phase 4 payoff"). Ingen ekstra arbejde.
- **Q3 → Wire training-effekt før flip**: **engine-arbejde i Plan B**. A3-UI viser `effectLive`-flag per spor (alle `false` her; training→`true` når Plan B lander).
- **Flip er ejer-only**: Plan A ændrer IKKE `FACILITIES_ENABLED` (forbliver `false`). Nav/side er skjult i prod indtil flip. Preview-mocken serverer `enabled` uafhængigt, så gennemklikket virker.

**Mekaniske rammer (ikke-omsættelige):**
- Alt arbejde i dedikeret worktree, branch `feat/1441-facilities-staff-a3`. Verificér branch i selve commit-kæden på HVER commit (`git branch --show-current` som del af commit-kommandoen).
- **INGEN migration i denne PR** (A1 skabte allerede `team_facilities`/`team_staff`/finance-typerne) → normal PR-merge efter CI grøn.
- Patch note + help skrives som **staged draft** (`docs/superpowers/drafts/`), IKKE i `patchNotes.js`/`help.json` live — de lander sammen med flippet (Plan B) så changelog'et ikke annoncerer en skjult feature. Skriv "hvorfor ikke nu" i PR-body.
- EN først, DA under i al player-facing copy.
- `pwsh -File scripts/verify-local.ps1` + `npx playwright test core-smoke.spec.js` (alle 3 projekter hvis snapshots rør) + `npm run lint` (frontend) FØR push.
- Anti-AI-slop: ingen `rounded-xl/2xl/3xl`, ingen glow/gradient/emoji-ikoner. Bebas-overskrifter + Inter Tight-tal + cz-tokens.

---

### Task 1: Worktree + branch

- [ ] **Step 1: Opret worktree**

```powershell
pwsh -File scripts/new-worktree.ps1 -Branch feat/1441-facilities-staff-a3
```

Fallback hvis scriptet ikke findes i forventet form:

```bash
git worktree add C:/Dev/CyclingZone-worktrees/a3-klub-ui -b feat/1441-facilities-staff-a3 origin/main
```

- [ ] **Step 2: Installér deps i worktree** — `cd <worktree>/backend && npm ci` og `cd <worktree>/frontend && npm ci`.

- [ ] **Step 3: Verificér baseline** — `git rev-parse --show-toplevel` peger på worktree-stien; `git branch --show-current` = `feat/1441-facilities-staff-a3`. `cd backend && npm test` grønt; `cd frontend && node --test` grønt (baseline før ændringer).

**Alle efterfølgende tasks eksekveres i worktree'et.**

---

### Task 2: Backend — additive display-felter på `GET /api/club/facilities`

Tilføj to display-felter til facilitet-objekterne, så tid-som-valuta og live-vs-target holdes SSOT på backend (spec §4.2 co-SSOT-disciplin). Ingen migration, ingen balance-ændring.

**Files:**
- Modify: `backend/lib/facilityConstants.js` (tilføj `PRIZE_PROXY_BY_DIVISION` + `EFFECT_LIVE_BY_TRACK`)
- Modify: `backend/lib/facilityRoutesHandlers.js` (`getClubFacilitiesHandler` — beregn felterne)
- Modify: `backend/lib/facilityRoutes.test.js` (dæk de nye felter)

- [ ] **Step 1: Tilføj konstanter i `facilityConstants.js`** (efter `COMMERCIAL_MIN_PAYBACK_SEASONS`):

```js
// Repræsentativ præmie-indkomst pr. division ("overskuds-laget") — SSOT for
// tid-som-valuta-visningen (§2.4). Samme proxy som facilityInvestmentModel
// (harness). BLØDT display-input; ingen gameplay-effekt.
export const PRIZE_PROXY_BY_DIVISION = Object.freeze({ 1: 160_000, 2: 70_000, 3: 25_000, 4: 25_000 });

// Hvilke spor har en LIVE gameplay-effekt (motor-hook findes). Alle false i A3;
// training flippes til true i Plan B når multiplikatoren wires. UI'et bruger det
// til ærlig "live vs. target"-mærkning, så vi aldrig lover en effekt der ikke virker.
export const EFFECT_LIVE_BY_TRACK = Object.freeze({
  training: false, scouting: false, medical: false, academy: false, commercial: false,
});
```

- [ ] **Step 2: Skriv fejlende test-tilføjelse** i `facilityRoutes.test.js` (find den eksisterende `GET /api/club/facilities`-test, ~linje 101-128, og tilføj assertions på et facilitet-objekt):

```js
test("GET /api/club/facilities returnerer seasonsEquivalent + effectLive per spor", async () => {
  // (genbrug testens eksisterende setup: seedet hold i division 2, flag enabled=true)
  const { status, body } = await getClubFacilitiesHandler(
    { teamId: TEAM_ID }, supabase, { flags: { facilitiesEnabled: true } }
  );
  assert.equal(status, 200);
  const training = body.facilities.find((f) => f.track === "training");
  // seasonsEquivalent = upgradePrice / PRIZE_PROXY_BY_DIVISION[team.division].
  // Tier 0→1 = 12.000 / 70.000 (D2) ≈ 0,171. Rundet til 2 decimaler i handleren.
  assert.equal(training.seasonsEquivalent, 0.17);
  assert.equal(training.effectLive, false);
  // Max-tier facilitet (upgradePrice=null) → seasonsEquivalent=null.
  const maxed = body.facilities.find((f) => f.upgradePrice == null);
  if (maxed) assert.equal(maxed.seasonsEquivalent, null);
});
```

- [ ] **Step 3: Kør — verificér FAIL** — `cd backend && node --test lib/facilityRoutes.test.js` → FAIL (felterne findes ikke).

- [ ] **Step 4: Implementér i `getClubFacilitiesHandler`** — importér de nye konstanter og berig hvert facilitet-objekt. Find team.division (allerede tilgængelig via team-load i handleren; hvis ikke, load `division` sammen med balance). Tilføj i map'en der bygger facilitet-objektet:

```js
import { PRIZE_PROXY_BY_DIVISION, EFFECT_LIVE_BY_TRACK } from "./facilityConstants.js";

// … inde i map'en, hvor upgradePrice allerede beregnes:
const prizeProxy = PRIZE_PROXY_BY_DIVISION[team.division] || PRIZE_PROXY_BY_DIVISION[3];
const seasonsEquivalent = upgradePrice == null ? null : Math.round((upgradePrice / prizeProxy) * 100) / 100;
return {
  track, tier, upgradePrice, tierUpkeep, staff, effectiveBonus,
  seasonsEquivalent,
  effectLive: EFFECT_LIVE_BY_TRACK[track] ?? false,
};
```

- [ ] **Step 5: Kør — verificér PASS** — `cd backend && node --test lib/facilityRoutes.test.js` → PASS. Kør `npm test` (fuld backend-suite grøn).

- [ ] **Step 6: Commit**

```bash
git branch --show-current && git add backend/lib/facilityConstants.js backend/lib/facilityRoutesHandlers.js backend/lib/facilityRoutes.test.js && git commit -m "feat(economy): seasonsEquivalent + effectLive display-felter på club/facilities (#1441 A3)"
```

---

### Task 3: Frontend display-lib `facilityDisplay.js` (rene funktioner, TDD)

Al ikke-triviel display-logik samlet ét sted, unit-testet. Ingen React.

**Files:**
- Create: `frontend/src/lib/facilityDisplay.js`
- Create: `frontend/src/lib/facilityDisplay.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_ORDER, trackDisplayKey, roleDisplayKey, formatSeasons, effectStatusKey, tierPips,
} from "./facilityDisplay.js";

test("TRACK_ORDER er de 5 spor i fast rækkefølge", () => {
  assert.deepEqual(TRACK_ORDER, ["training", "scouting", "medical", "academy", "commercial"]);
});

test("trackDisplayKey/roleDisplayKey mapper til i18n-nøgler", () => {
  assert.equal(trackDisplayKey("training"), "tracks.training.name");
  assert.equal(roleDisplayKey("commercial"), "roles.commercial");
});

test("formatSeasons: 1 decimal, håndterer null (max tier)", () => {
  assert.equal(formatSeasons(0.171), "0.2");
  assert.equal(formatSeasons(6.114), "6.1");
  assert.equal(formatSeasons(null), null);
});

test("effectStatusKey: live→active, ellers target", () => {
  assert.equal(effectStatusKey(true), "effect.live");
  assert.equal(effectStatusKey(false), "effect.target");
});

test("tierPips: array af 5 bool (filled op til tier)", () => {
  assert.deepEqual(tierPips(0), [false, false, false, false, false]);
  assert.deepEqual(tierPips(2), [true, true, false, false, false]);
  assert.deepEqual(tierPips(5), [true, true, true, true, true]);
});
```

- [ ] **Step 2: Kør — verificér FAIL** — `cd frontend && node --test src/lib/facilityDisplay.test.js` → FAIL.

- [ ] **Step 3: Implementér `facilityDisplay.js`**

```js
// Rene display-helpers for Klub-fladen (#1441 A3). Ingen React, ingen I/O — så
// logikken er unit-testet og siden forbliver tynd. Labels er i18n-NØGLER (ikke
// tekst): copy'en bor i public/locales/{en,da}/klub.json (EN først, DA under).

export const TRACK_ORDER = ["training", "scouting", "medical", "academy", "commercial"];

export function trackDisplayKey(track) { return `tracks.${track}.name`; }
export function roleDisplayKey(track) { return `roles.${track}`; }

// Tid-som-valuta: sæsoner med 1 decimal; null (max tier) videreføres som null.
export function formatSeasons(seasons) {
  return seasons == null ? null : (Math.round(seasons * 10) / 10).toFixed(1);
}

// Ærlig live-vs-target-mærkning af effekt-kolonnen (Q3).
export function effectStatusKey(effectLive) { return effectLive ? "effect.live" : "effect.target"; }

// Tier-ladder: 5 pips, fyldt op til (og med) det ejede tier.
export function tierPips(tier, max = 5) {
  return Array.from({ length: max }, (_, i) => i < tier);
}
```

- [ ] **Step 4: Kør — verificér PASS** — `cd frontend && node --test src/lib/facilityDisplay.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current && git add frontend/src/lib/facilityDisplay.js frontend/src/lib/facilityDisplay.test.js && git commit -m "feat(klub): rene display-helpers for facilitets-fladen (#1441 A3)"
```

---

### Task 4: Frontend nav-gating `facilitiesNavVisibility` (TDD) + Layout-wiring

Spejler `academyNavVisibility` (eksisterende test-mønster). Nav-item vises kun når featuren er enabled.

**Files:**
- Create: `frontend/src/lib/facilitiesNavVisibility.js`
- Create: `frontend/src/lib/facilitiesNavVisibility.test.js`
- Modify: `frontend/src/components/Layout.jsx`

- [ ] **Step 1: Læs skabelonen** — `frontend/src/lib/academyNavVisibility.test.js` + den tilhørende kilde, så signatur/mønster matcher 1:1.

- [ ] **Step 2: Skriv fejlende test** (`facilitiesNavVisibility.test.js`)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { facilitiesNavItem } from "./facilitiesNavVisibility.js";

const t = (k) => k; // identitets-oversætter til test

test("facilitiesNavItem: [] når disabled, ét item når enabled", () => {
  assert.deepEqual(facilitiesNavItem(false, t), []);
  const items = facilitiesNavItem(true, t);
  assert.equal(items.length, 1);
  assert.equal(items[0].to, "/klub");
  assert.equal(items[0].label, "nav.item.klub");
});
```

- [ ] **Step 3: Kør — verificér FAIL** — `cd frontend && node --test src/lib/facilitiesNavVisibility.test.js` → FAIL.

- [ ] **Step 4: Implementér `facilitiesNavVisibility.js`**

```js
// Nav-synlighed for Klub-fladen (#1441 A3). Ren funktion → unit-testet.
// Spejler academyNavVisibility: tom liste når disabled, så spread'en i
// buildNavGroups blot udelader item'et.
export function facilitiesNavItem(facilitiesEnabled, t) {
  return facilitiesEnabled ? [{ to: "/klub", label: t("nav.item.klub") }] : [];
}
```

- [ ] **Step 5: Wire ind i `Layout.jsx`** — importér funktionen; udvid `buildNavGroups`-signaturen med `facilitiesEnabled`; indsæt item'et i klubhus-gruppen efter Finance (før Notifications). Følg NØJAGTIG academyEnabled-mønsteret (state + cached read + dependency-array):

I `buildNavGroups(team, t, academyEnabled = false)` → `buildNavGroups(team, t, academyEnabled = false, facilitiesEnabled = false)`, og i klubhus-items efter `{ to: "/finance", … }`:

```jsx
...facilitiesNavItem(facilitiesEnabled, t),
```

I komponenten: tilføj `const { enabled: facilitiesEnabled } = useFacilities();` (Task 5-hooken) og send den med i BEGGE `buildNavGroups(...)`-kald (linje ~297 + ~451). Tilføj `facilitiesEnabled` til de relevante dependency-arrays.

- [ ] **Step 6: Kør test + verify** — `cd frontend && node --test src/lib/facilitiesNavVisibility.test.js` → PASS. `node --test` (fuld frontend-suite grøn).

- [ ] **Step 7: Commit**

```bash
git branch --show-current && git add frontend/src/lib/facilitiesNavVisibility.js frontend/src/lib/facilitiesNavVisibility.test.js frontend/src/components/Layout.jsx && git commit -m "feat(klub): flag-gated nav-item i Klubhus-gruppen (#1441 A3)"
```

---

### Task 5: `useFacilities` hook (spejler useAcademy)

**Files:**
- Create: `frontend/src/lib/useFacilities.js`

- [ ] **Step 1: Læs `frontend/src/lib/useAcademy.js`** som skabelon (fetch + Bearer, graceful disabled på 403, refresh efter mutation, `logEvent` pillar-events).

- [ ] **Step 2: Implementér `useFacilities.js`**

```js
// useFacilities — frontend-state for Klub (faciliteter + staff, #1441 A3).
// Henter /api/club/facilities (flag-gated: 403 facilities_disabled → enabled=false,
// præcis som useAcademy's 409). Eksponerer upgrade/hire/fire + candidates-loader.
// Backend er eneste flag-kilde → nav + side gater på `enabled` uden dobbelt-flag.
import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";
import { logEvent } from "./logEvent.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useFacilities() {
  const [enabled, setEnabled] = useState(false);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/club/facilities`, { headers });
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "facilities_disabled") { setEnabled(false); setLoading(false); return; }
      }
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || "failed"); setLoading(false); return; }
      const data = await res.json();
      setEnabled(true);
      setFacilities(data.facilities ?? []);
      setError(null);
    } catch { /* netværk — behold state */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const upgrade = useCallback(async (track) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/facilities/upgrade`, { method: "POST", headers, body: JSON.stringify({ track }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("facility_upgrade", { track, tier: data.tier });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  const loadCandidates = useCallback(async (role) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/staff/candidates?role=${encodeURIComponent(role)}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      return { ok: true, candidates: data.candidates ?? [], facilityTier: data.facilityTier ?? 0 };
    } catch { return { ok: false, error: "network" }; }
  }, []);

  const hire = useCallback(async (role, candidateName) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/staff/hire`, { method: "POST", headers, body: JSON.stringify({ role, candidateName }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("staff_hire", { role });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  const fire = useCallback(async (role) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/staff/fire`, { method: "POST", headers, body: JSON.stringify({ role }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("staff_fire", { role });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  return { enabled, facilities, loading, error, refresh, upgrade, loadCandidates, hire, fire };
}
```

- [ ] **Step 3: Verificér import-hygiejne** — `cd frontend && node --check src/lib/useFacilities.js` (ingen extensionless imports — alle `.js`). `node --test` grøn.

- [ ] **Step 4: Commit**

```bash
git branch --show-current && git add frontend/src/lib/useFacilities.js && git commit -m "feat(klub): useFacilities hook (spejler useAcademy, 403-graceful) (#1441 A3)"
```

---

### Task 6: i18n — `klub.json` (en + da) + namespace-registrering

**Files:**
- Create: `frontend/public/locales/en/klub.json`
- Create: `frontend/public/locales/da/klub.json`
- Modify: `frontend/src/i18n/index.js`
- Modify: `frontend/public/locales/en/common.json` + `da/common.json` (nav-label `nav.item.klub`)

- [ ] **Step 1: Opret `en/klub.json`** (EN — primær):

```json
{
  "page": {
    "title": "Club",
    "subtitle": "Facilities and staff",
    "balance": "Balance",
    "division": "Division {division}"
  },
  "sections": {
    "facilities": "Facilities",
    "staff": "Staff"
  },
  "facilities": {
    "tier": "Tier {tier} / {max}",
    "notBuilt": "Not built",
    "upgradeTo": "Upgrade to T{tier}",
    "buildTier": "Build T{tier}",
    "seasonsProfit": "≈ {seasons} seasons' profit",
    "upkeep": "Upkeep {amount}/season",
    "maxed": "Fully upgraded",
    "fullTree": "Full tree (all tracks T5)",
    "fullTreeSeasons": "≈ {seasons} Division-{division} seasons of profit"
  },
  "effect": {
    "label": "Effect",
    "live": "live",
    "target": "target",
    "note": "Effect column shows the target model — each track's in-game effect activates as its engine lands."
  },
  "tracks": {
    "training": { "name": "Training Center", "effect": "training" },
    "scouting": { "name": "Scouting Network", "effect": "rider insight" },
    "medical": { "name": "Medical Department", "effect": "recovery" },
    "academy": { "name": "Academy Expansion", "effect": "intake slots" },
    "commercial": { "name": "Commercial Department", "effect": "sponsor (capped)" }
  },
  "commercial": { "sinkTag": "Pure sink · Phase 4 payoff", "sinkNote": "Never pays for itself by design." },
  "roles": {
    "training": "Sports Director",
    "scouting": "Chief Scout",
    "medical": "Team Doctor",
    "academy": "Academy Director",
    "commercial": "Commercial Director"
  },
  "staff": {
    "none": "No staff hired",
    "locked": "Locked — build tier 1 first",
    "hired": "Hired",
    "salary": "Salary {amount} CZ$/season",
    "candidates": "Candidates",
    "candidate": "Tier {tier} · {amount}/season",
    "hire": "Hire",
    "release": "Release",
    "severance": "Severance {amount}",
    "tierGate": "Higher tiers unlock as you upgrade the facility",
    "billNote": "Salary is billed at season start"
  },
  "errors": {
    "insufficient_funds": "Not enough balance for that upgrade.",
    "max_tier": "This track is already fully upgraded.",
    "role_occupied": "You already have staff in this role.",
    "staff_tier_exceeds_facility": "Upgrade the facility before hiring a higher-tier chief.",
    "invalid_candidate": "That candidate is no longer available.",
    "failed": "Something went wrong. Try again.",
    "network": "Couldn't reach the server. Try again."
  },
  "empty": { "title": "The club is closed", "description": "Facilities and staff aren't available yet." }
}
```

- [ ] **Step 2: Opret `da/klub.json`** (DA — sekundær, samme nøgler):

```json
{
  "page": {
    "title": "Klub",
    "subtitle": "Faciliteter og staff",
    "balance": "Saldo",
    "division": "Division {division}"
  },
  "sections": { "facilities": "Faciliteter", "staff": "Staff" },
  "facilities": {
    "tier": "Tier {tier} / {max}",
    "notBuilt": "Ikke bygget",
    "upgradeTo": "Opgradér til T{tier}",
    "buildTier": "Byg T{tier}",
    "seasonsProfit": "≈ {seasons} sæsoners overskud",
    "upkeep": "Drift {amount}/sæson",
    "maxed": "Fuldt udbygget",
    "fullTree": "Hele træet (alle spor T5)",
    "fullTreeSeasons": "≈ {seasons} Division-{division}-sæsoners overskud"
  },
  "effect": {
    "label": "Effekt",
    "live": "live",
    "target": "mål",
    "note": "Effekt-kolonnen viser mål-modellen — hvert spors effekt i spillet aktiveres når dets motor lander."
  },
  "tracks": {
    "training": { "name": "Træningscenter", "effect": "træning" },
    "scouting": { "name": "Scouting-netværk", "effect": "rytter-indsigt" },
    "medical": { "name": "Medicinsk afdeling", "effect": "restitution" },
    "academy": { "name": "Akademi-udvidelse", "effect": "intake-slots" },
    "commercial": { "name": "Kommerciel afdeling", "effect": "sponsor (loftet)" }
  },
  "commercial": { "sinkTag": "Rent sink · Fase 4-payoff", "sinkNote": "Betaler sig aldrig tilbage — bevidst design." },
  "roles": {
    "training": "Sportsdirektør",
    "scouting": "Chefscout",
    "medical": "Læge",
    "academy": "Akademichef",
    "commercial": "Kommerciel direktør"
  },
  "staff": {
    "none": "Ingen staff ansat",
    "locked": "Låst — byg tier 1 først",
    "hired": "Ansat",
    "salary": "Løn {amount} CZ$/sæson",
    "candidates": "Kandidater",
    "candidate": "Tier {tier} · {amount}/sæson",
    "hire": "Ansæt",
    "release": "Fyr",
    "severance": "Fratrædelse {amount}",
    "tierGate": "Højere tiers låses op når du opgraderer faciliteten",
    "billNote": "Lønnen trækkes ved sæsonstart"
  },
  "errors": {
    "insufficient_funds": "Ikke nok saldo til den opgradering.",
    "max_tier": "Dette spor er allerede fuldt udbygget.",
    "role_occupied": "Du har allerede staff i denne rolle.",
    "staff_tier_exceeds_facility": "Opgradér faciliteten før du ansætter en højere-tier chef.",
    "invalid_candidate": "Den kandidat er ikke længere tilgængelig.",
    "failed": "Noget gik galt. Prøv igen.",
    "network": "Kunne ikke nå serveren. Prøv igen."
  },
  "empty": { "title": "Klubben er lukket", "description": "Faciliteter og staff er ikke tilgængelige endnu." }
}
```

- [ ] **Step 3: Registrér namespace i `i18n/index.js`** — importér `klubEn`/`klubDa`, tilføj `"klub"` i `ns`-arrayet, og tilføj i `resources.en.klub`/`resources.da.klub`. Følg nøjagtig den eksisterende import+resource-blok (spejl fx `academy`).

- [ ] **Step 4: Tilføj nav-label** — i `en/common.json` + `da/common.json`, tilføj under `nav.item`: `"klub": "Club"` (en) / `"klub": "Klub"` (da).

- [ ] **Step 5: Verify** — `cd frontend && npm run build` (fejler ved manglende/ugyldig JSON eller manglende namespace-registrering — inline-bundling-check). `node --test` grøn.

- [ ] **Step 6: Commit**

```bash
git branch --show-current && git add frontend/public/locales frontend/src/i18n/index.js && git commit -m "feat(klub): i18n-namespace en+da + nav-label (#1441 A3)"
```

---

### Task 7: Sub-komponenter — `TierLadder`, `FacilityTrackCard`, `StaffPanel`

Fokuserede komponenter (én ansvar hver), matcher mockup'et. Bruger UI-kit'et (`Card`, `Button`, `StatusBadge`, `Modal`) + cz-tokens.

**Files:**
- Create: `frontend/src/components/klub/TierLadder.jsx`
- Create: `frontend/src/components/klub/FacilityTrackCard.jsx`
- Create: `frontend/src/components/klub/StaffPanel.jsx`

- [ ] **Step 1: `TierLadder.jsx`** — 5 pips, guld når fyldt, subtle når tom (editorial stat-bar, ingen glow):

```jsx
import { tierPips } from "../../lib/facilityDisplay";

// 5-trins tier-ladder. Fyldte pips = guld (brand-accent), tomme = subtle inset.
export default function TierLadder({ tier, max = 5 }) {
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`Tier ${tier} of ${max}`}>
      {tierPips(tier, max).map((filled, i) => (
        <span
          key={i}
          className={`inline-block h-[7px] w-5 rounded-[1px] border border-cz-accent/60 ${filled ? "bg-cz-accent" : "bg-cz-subtle"}`}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `FacilityTrackCard.jsx`** — én facilitet-række (venstre: navn + ladder + effekt + staff; højre: upgrade-knap + tid-som-valuta + drift). Kommerciel får venstre accent-border + sink-tag. Max tier → "Fully upgraded" i stedet for knap.

```jsx
import { useTranslation } from "react-i18next";
import { Card, Button } from "../ui";
import { formatCz } from "../../lib/marketValues";
import { formatNumber } from "../../lib/intl";
import { trackDisplayKey, formatSeasons } from "../../lib/facilityDisplay";
import TierLadder from "./TierLadder";

export default function FacilityTrackCard({ facility, onUpgrade, onOpenStaff, busy }) {
  const { t } = useTranslation("klub");
  const { track, tier, upgradePrice, tierUpkeep, staff, effectiveBonus, seasonsEquivalent, effectLive } = facility;
  const isCommercial = track === "commercial";
  const maxed = upgradePrice == null;
  const nextTier = tier + 1;
  const effectPct = `${(effectiveBonus * 100).toFixed(1)}%`;

  return (
    <Card className={`p-[12px_14px] grid grid-cols-[1fr_auto] gap-[14px] items-center ${isCommercial ? "border-l-2 border-l-cz-warning rounded-l-none" : ""}`}>
      <div>
        <div className="flex items-baseline gap-[10px]">
          <span className="font-display text-[17px] leading-none">{t(`tracks.${track}.name`)}</span>
          <span className="text-[11px] text-cz-accent-t">
            {tier === 0 ? t("facilities.notBuilt") : t("facilities.tier", { tier, max: 5 })}
          </span>
          {isCommercial && (
            <span className="text-[9.5px] uppercase tracking-wide text-cz-warning bg-cz-warning/10 rounded-[3px] px-[6px] py-[2px]">
              {t("commercial.sinkTag")}
            </span>
          )}
        </div>
        <div className="my-[6px]"><TierLadder tier={tier} /></div>
        <div className="text-[11px] text-cz-2">
          {t("effect.label")} <span className="font-data text-cz-1">{effectPct}</span> {t(`tracks.${track}.effect`)}
          <span className="text-cz-3"> · {effectLive ? t("effect.live") : t("effect.target")}</span>
          {" · "}
          {staff
            ? <>Staff <span className="text-cz-1">{staff.name}</span> (T{staff.tier})</>
            : tier === 0
              ? <span className="text-cz-3">{t("staff.locked")}</span>
              : <button type="button" onClick={() => onOpenStaff(track)} className="text-cz-accent-t underline underline-offset-2">{t("staff.none")}</button>}
        </div>
      </div>
      <div className="text-right">
        {maxed ? (
          <span className="text-[12px] text-cz-3">{t("facilities.maxed")}</span>
        ) : (
          <>
            <Button variant="primary" size="sm" loading={busy} onClick={() => onUpgrade(track)}>
              {(tier === 0 ? t("facilities.buildTier", { tier: nextTier }) : t("facilities.upgradeTo", { tier: nextTier }))} · <span className="font-data">{formatNumber(upgradePrice)}</span>
            </Button>
            <div className="text-[10.5px] text-cz-accent-t mt-[5px]">{t("facilities.seasonsProfit", { seasons: formatSeasons(seasonsEquivalent) })}</div>
          </>
        )}
        <div className="text-[10.5px] text-cz-2 mt-[2px]">{t("facilities.upkeep", { amount: formatNumber(tierUpkeep) })}</div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: `StaffPanel.jsx`** — modal/drawer for ét spor: nuværende staff (Release + severance) + kandidat-liste (Hire). Bruger `Modal` fra UI-kit. Loader kandidater via `loadCandidates(role)` on open.

```jsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button } from "../ui";
import { formatNumber } from "../../lib/intl";

export default function StaffPanel({ open, track, facility, onClose, loadCandidates, onHire, onFire }) {
  const { t } = useTranslation("klub");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const staff = facility?.staff;

  useEffect(() => {
    if (!open || !track) return;
    let alive = true;
    setLoading(true); setError(null);
    loadCandidates(track).then((r) => {
      if (!alive) return;
      if (r.ok) setCandidates(r.candidates); else setError(t(`errors.${r.error}`, t("errors.failed")));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, track, loadCandidates, t]);

  const doHire = async (name) => {
    setBusy(true); setError(null);
    const r = await onHire(track, name);
    if (!r.ok) setError(t(`errors.${r.error}`, t("errors.failed")));
    setBusy(false);
  };
  const doFire = async () => {
    setBusy(true); setError(null);
    const r = await onFire(track);
    if (!r.ok) setError(t(`errors.${r.error}`, t("errors.failed")));
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title={`${t("sections.staff")} · ${t(`tracks.${track}.name`)}`}>
      <p className="text-[11px] text-cz-3 mb-3">{t("staff.billNote")} · {t("staff.tierGate")}</p>
      {error && <p className="text-[12px] text-cz-danger mb-3" role="alert">{error}</p>}
      {staff ? (
        <div className="rounded-cz border border-cz-accent/60 bg-cz-card p-[12px_14px] mb-3 flex justify-between items-center">
          <div>
            <div className="text-[14px] font-medium">{staff.name} <span className="text-[11px] text-cz-2 font-normal">· {t(`roles.${track}`)} · T{staff.tier}</span></div>
            <div className="text-[11px] text-cz-2 mt-[3px]">{t("staff.hired")} · {t("staff.salary", { amount: formatNumber(staff.salary) })}</div>
          </div>
          <div className="text-right">
            <Button variant="secondary" size="sm" loading={busy} onClick={doFire}>{t("staff.release")}</Button>
            <div className="text-[10.5px] text-cz-2 mt-[5px]">{t("staff.severance", { amount: formatNumber(Math.round(staff.salary * 0.5)) })}</div>
          </div>
        </div>
      ) : null}
      <div className="text-[10px] uppercase tracking-[1.4px] text-cz-2 mb-2">{t("staff.candidates")}</div>
      {loading ? (
        <p className="text-[12px] text-cz-3">…</p>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {candidates.map((c) => (
            <div key={c.name} className="rounded-cz border border-cz-border bg-cz-card p-[9px_14px] flex justify-between items-center">
              <div className="text-[13px]">{c.name} <span className="text-[11px] text-cz-2">· {t("staff.candidate", { tier: c.tier, amount: formatNumber(c.salary) })}</span></div>
              <Button variant="secondary" size="sm" loading={busy} onClick={() => doHire(c.name)}>{t("staff.hire")}</Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Verify** — `cd frontend && node --check` på hver ny fil; `npm run build` grøn; `npm run lint` grøn (react-hooks/purity). `node --test` grøn.

- [ ] **Step 5: Commit**

```bash
git branch --show-current && git add frontend/src/components/klub && git commit -m "feat(klub): TierLadder + FacilityTrackCard + StaffPanel komponenter (#1441 A3)"
```

---

### Task 8: `KlubPage` + route + wiring-test

**Files:**
- Create: `frontend/src/pages/KlubPage.jsx`
- Create: `frontend/src/pages/KlubPage.wiring.test.js`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Implementér `KlubPage.jsx`** — orkestrerer hook + komponenter. Header (Bebas "CLUB" + team-kontekst), effekt-note, facilitets-liste (TRACK_ORDER), staff-panel (modal), full-tree-footer. Tom/disabled-state via `EmptyState`.

```jsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, EmptyState, PageLoader } from "../components/ui";
import { formatNumber } from "../lib/intl";
import { useFacilities } from "../lib/useFacilities";
import { TRACK_ORDER } from "../lib/facilityDisplay";
import FacilityTrackCard from "../components/klub/FacilityTrackCard";
import StaffPanel from "../components/klub/StaffPanel";

export default function KlubPage() {
  const { t } = useTranslation("klub");
  const { enabled, facilities, loading, upgrade } = useFacilities();
  const facs = useFacilities();
  const [staffTrack, setStaffTrack] = useState(null);
  const [busyTrack, setBusyTrack] = useState(null);

  if (loading) return <PageLoader />;
  if (!enabled) return <EmptyState title={t("empty.title")} description={t("empty.description")} />;

  const byTrack = Object.fromEntries(facilities.map((f) => [f.track, f]));
  const ordered = TRACK_ORDER.map((tr) => byTrack[tr]).filter(Boolean);
  const staffFacility = staffTrack ? byTrack[staffTrack] : null;

  const doUpgrade = async (track) => { setBusyTrack(track); await facs.upgrade(track); setBusyTrack(null); };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4">
        <div>
          <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
          <p className="text-[12px] text-cz-2 mt-[2px]">{t("page.subtitle")}</p>
        </div>
      </div>

      <div className="flex justify-between items-center mb-2">
        <span className="font-display text-[20px]">{t("sections.facilities")}</span>
        <span className="text-[10px] uppercase tracking-[1.4px] text-cz-2">{t("effect.note")}</span>
      </div>

      <div className="flex flex-col gap-2">
        {ordered.map((f) => (
          <FacilityTrackCard
            key={f.track}
            facility={f}
            busy={busyTrack === f.track}
            onUpgrade={doUpgrade}
            onOpenStaff={setStaffTrack}
          />
        ))}
      </div>

      <StaffPanel
        open={!!staffTrack}
        track={staffTrack}
        facility={staffFacility}
        onClose={() => setStaffTrack(null)}
        loadCandidates={facs.loadCandidates}
        onHire={facs.hire}
        onFire={facs.fire}
      />
    </div>
  );
}
```

> NB: konsolidér `useFacilities()` til ét kald (fjern dobbelt-kaldet `facs` vs. destructuring i step — brug ét: `const facs = useFacilities();` og læs `facs.enabled/facs.facilities/facs.loading`). Rettes i implementeringen.

- [ ] **Step 2: Route i `App.jsx`** — tilføj lazy-import + beskyttet rute (spejl academy):

```jsx
const KlubPage = lazyWithRetry(() => import("./pages/KlubPage"));
// … inde i den beskyttede <Route element={<Layout/>}>:
<Route path="klub" element={<KlubPage />} />
```

- [ ] **Step 3: Wiring-test** (`KlubPage.wiring.test.js`) — spejl `TrainingPage.wiring.test.js`: læs kildefilen som tekst og assertér på nøgle-wiring (så vi fanger regression uden jsdom):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./KlubPage.jsx", import.meta.url), "utf8");

test("KlubPage bruger useFacilities + gater på enabled", () => {
  assert.match(src, /useFacilities\(\)/);
  assert.match(src, /if \(!enabled\)/);
  assert.match(src, /EmptyState/);
});
test("KlubPage rendrer sporene i TRACK_ORDER og staff-panelet", () => {
  assert.match(src, /TRACK_ORDER/);
  assert.match(src, /FacilityTrackCard/);
  assert.match(src, /StaffPanel/);
});
test("KlubPage bruger klub-namespace", () => {
  assert.match(src, /useTranslation\("klub"\)/);
});
```

- [ ] **Step 4: Verify** — `cd frontend && npm run build` grøn; `npm run lint` grøn; `node --test` grøn (inkl. den nye wiring-test).

- [ ] **Step 5: Commit**

```bash
git branch --show-current && git add frontend/src/pages/KlubPage.jsx frontend/src/pages/KlubPage.wiring.test.js frontend/src/App.jsx && git commit -m "feat(klub): KlubPage + route + wiring-test (#1441 A3)"
```

---

### Task 9: Statefuld preview-mock + seed (ejer-gennemklik)

Uden dette er gennemklikket dødt. Mocken er statefuld: køb hæver tier, ansæt fylder slot, fyr tømmer.

**Files:**
- Create: `frontend/src/preview/clubMock.js`
- Modify: `frontend/src/preview/seedData.js` (tilføj `SEED_CLUB`)
- Modify: `frontend/src/preview/installPreviewMock.js` (rout `/api/club/*` gennem clubMock FØR de generiske handlers)

- [ ] **Step 1: `SEED_CLUB` i `seedData.js`** — start-tilstand der matcher mockup'et (D2-hold, blandede tiers):

```js
// #1441 A3 — start-tilstand for Klub-preview (mid-game D2-hold). Muteres af clubMock.
export const SEED_CLUB = {
  facilities: {
    training: { tier: 2, staff: { name: "Sofie Lindqvist", tier: 2 } },
    scouting: { tier: 1, staff: null },
    medical: { tier: 0, staff: null },
    academy: { tier: 3, staff: { name: "Aldo Terranova", tier: 1 } },
    commercial: { tier: 0, staff: null },
  },
};
```

- [ ] **Step 2: `clubMock.js`** — statefuld router der genbruger de RIGTIGE kalibrerede konstanter (mirror fra backend, tydeligt kommenteret + parity-testet i step 4):

```js
// Statefuld preview-mock for /api/club/* (#1441 A3). Muterer en in-memory kopi af
// SEED_CLUB så ejerens gennemklik er ægte (køb hæver tier, ansæt/fyr fylder/tømmer).
// Konstanterne er en 1:1-spejling af backend/lib/facilityConstants.js (parity-test
// i clubMock.parity.test.js sikrer de ikke driver fra hinanden — co-SSOT).
import { SEED_CLUB } from "./seedData.js";

const PRICE = { 1: 12000, 2: 26000, 3: 50000, 4: 100000, 5: 240000 };
const UPKEEP = { 0: 0, 1: 1500, 2: 3500, 3: 8000, 4: 15000, 5: 30000 };
const SALARY = { 1: 100, 2: 250, 3: 600, 4: 1300, 5: 2600 };
const BASE_EFFECT = {
  training: { 0: 0, 1: 0.03, 2: 0.045, 3: 0.074, 4: 0.11, 5: 0.165 },
  scouting: { 0: 0, 1: 0.015, 2: 0.032, 3: 0.07, 4: 0.145, 5: 0.30 },
  medical: { 0: 0, 1: 0.06, 2: 0.09, 3: 0.148, 4: 0.22, 5: 0.33 },
  academy: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 },
  commercial: { 0: 0, 1: 0.0006, 2: 0.0013, 3: 0.0027, 4: 0.0057, 5: 0.012 },
};
const TRACKS = ["training", "scouting", "medical", "academy", "commercial"];
const PRIZE_PROXY = { 1: 160000, 2: 70000, 3: 25000, 4: 25000 };
const NAME_POOL = ["Marc Vandenbroucke", "Henrik Sørensen", "Luca Bertolini", "Íñigo Sarasola", "Tomas Nyholm", "Ruben De Waele"];
const DIVISION = 2; // TEST_TEAM.division

// Deep-clone seed én gang pr. session (module-scope state).
const state = JSON.parse(JSON.stringify(SEED_CLUB));

function util(staffTier) { return staffTier == null ? 0.5 : 0.5 + 0.1 * staffTier; }

function facilitiesPayload() {
  return {
    facilities: TRACKS.map((track) => {
      const f = state.facilities[track];
      const upgradePrice = f.tier >= 5 ? null : PRICE[f.tier + 1];
      const staffTier = f.staff?.tier ?? null;
      return {
        track, tier: f.tier, upgradePrice, tierUpkeep: UPKEEP[f.tier],
        staff: f.staff ? { name: f.staff.name, tier: f.staff.tier, salary: SALARY[f.staff.tier] } : null,
        effectiveBonus: (BASE_EFFECT[track][f.tier] || 0) * util(staffTier),
        seasonsEquivalent: upgradePrice == null ? null : Math.round((upgradePrice / PRIZE_PROXY[DIVISION]) * 100) / 100,
        effectLive: false,
      };
    }),
  };
}

function candidatesFor(role) {
  const facTier = Math.max(1, state.facilities[role]?.tier || 0);
  return NAME_POOL.slice(0, 3).map((name, i) => {
    const tier = 1 + (i % facTier);
    return { name, role, tier, salary: SALARY[tier] };
  });
}

// Router: (method, pathname, search, body) → { status, body }.
export function clubMockRoute(method, pathname, search, body) {
  if (pathname.endsWith("/api/club/facilities") && method === "GET") return { status: 200, body: facilitiesPayload() };
  if (pathname.endsWith("/api/club/facilities/upgrade") && method === "POST") {
    const track = body?.track;
    const f = state.facilities[track];
    if (!f) return { status: 400, body: { error: "invalid_track" } };
    if (f.tier >= 5) return { status: 400, body: { error: "max_tier" } };
    f.tier += 1;
    return { status: 200, body: { ok: true, track, tier: f.tier, price: PRICE[f.tier] } };
  }
  if (pathname.endsWith("/api/club/staff/candidates") && method === "GET") {
    const role = new URLSearchParams(search).get("role");
    if (!TRACKS.includes(role)) return { status: 400, body: { error: "invalid_role" } };
    return { status: 200, body: { role, facilityTier: state.facilities[role].tier, candidates: candidatesFor(role) } };
  }
  if (pathname.endsWith("/api/club/staff/hire") && method === "POST") {
    const { role, candidateName } = body || {};
    const f = state.facilities[role];
    if (!f) return { status: 400, body: { error: "invalid_role" } };
    if (f.staff) return { status: 409, body: { error: "role_occupied" } };
    const cand = candidatesFor(role).find((c) => c.name === candidateName);
    if (!cand) return { status: 400, body: { error: "invalid_candidate" } };
    if (cand.tier > f.tier) return { status: 400, body: { error: "staff_tier_exceeds_facility" } };
    f.staff = { name: cand.name, tier: cand.tier };
    return { status: 200, body: { ok: true, staff: { ...cand, salary: SALARY[cand.tier] } } };
  }
  if (pathname.endsWith("/api/club/staff/fire") && method === "POST") {
    const { role } = body || {};
    const f = state.facilities[role];
    if (!f?.staff) return { status: 404, body: { error: "no_active_staff" } };
    const severance = Math.round(SALARY[f.staff.tier] * 0.5);
    f.staff = null;
    return { status: 200, body: { ok: true, severance } };
  }
  return null; // ikke en club-route
}
```

- [ ] **Step 2b: Parity-test** `frontend/src/preview/clubMock.parity.test.js` — importér backend-konstanterne og assertér lighed (co-SSOT-guard; node kan importere på tværs af grænsen i test):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { FACILITY_TIER_PRICE, FACILITY_TIER_UPKEEP, STAFF_SALARY_BY_TIER, FACILITY_BASE_EFFECT } from "../../../backend/lib/facilityConstants.js";
import { __constants } from "./clubMock.js"; // eksportér et __constants-objekt til testen

test("clubMock-konstanter matcher backend (co-SSOT)", () => {
  assert.deepEqual(__constants.PRICE, { ...FACILITY_TIER_PRICE });
  assert.deepEqual(__constants.UPKEEP, { ...FACILITY_TIER_UPKEEP });
  assert.deepEqual(__constants.SALARY, { ...STAFF_SALARY_BY_TIER });
  for (const track of Object.keys(FACILITY_BASE_EFFECT)) {
    assert.deepEqual(__constants.BASE_EFFECT[track], { ...FACILITY_BASE_EFFECT[track] });
  }
});
```

I `clubMock.js`, tilføj til sidst: `export const __constants = { PRICE, UPKEEP, SALARY, BASE_EFFECT };`.

- [ ] **Step 3: Wire i `installPreviewMock.js`** — indsæt FØR den generiske `/api/`-blok (linje ~80), og parse body for POST:

```js
import { clubMockRoute } from "./clubMock.js";
// … inde i window.fetch, efter REST-blokken:
if (/\/api\/club\//.test(url)) {
  const u = new URL(url, window.location.origin);
  let body = null;
  if (method !== "GET" && init && init.body) { try { body = JSON.parse(init.body); } catch { body = null; } }
  const res = clubMockRoute(method, u.pathname, u.search, body);
  if (res) return jsonResponse(res.body, res.status);
}
```

- [ ] **Step 4: Verify** — `cd frontend && node --test src/preview/clubMock.parity.test.js` → PASS (fanger drift mod backend). `npm run build` grøn.

- [ ] **Step 5: Commit**

```bash
git branch --show-current && git add frontend/src/preview/clubMock.js frontend/src/preview/clubMock.parity.test.js frontend/src/preview/seedData.js frontend/src/preview/installPreviewMock.js && git commit -m "feat(klub): statefuld preview-mock for /api/club/* (ejer-gennemklik) (#1441 A3)"
```

---

### Task 10: Docs — FEATURE_STATUS + staged patch/help-draft

**Files:**
- Modify: `docs/FEATURE_STATUS.md`
- Create: `docs/superpowers/drafts/2026-07-05-facilities-flip-announce.md` (patch note + help, klar til at anvende ved flip)

- [ ] **Step 1: FEATURE_STATUS.md** — under "Beta or feature-flagged":

```markdown
- **Club (Facilities & Staff) — #1441 Slice A:** Klub-flade (5 facilitets-spor × 5 tiers + staff-panel) bygget (A3-UI, PR #____). Gated bag `FACILITIES_ENABLED` (backend-konstant, `false`) → nav + side skjult indtil ejer-flip. Effekter ikke wired endnu (pure sink); training-effekt + util-udvidelse i pre-flip engine-slice (Plan B).
```

- [ ] **Step 2: Staged flip-announce draft** — skriv den EKSAKTE patch-note-entry + help-nøgler, klar til at indsætte ved flip (IKKE live nu):

```markdown
# Flip-announce draft — FACILITIES_ENABLED (anvendes ved ejer-flip, Plan B)

## Patch note (indsæt øverst i frontend/src/data/patchNotes.js — bump til næste version, fx 6.64)
{
  "version": "6.64", "date": "<flip-dato>", "label": "Beta",
  "changes": [{
    "category": "new", "audience": "player", "topic": "Club",
    "en": { "title": "Build your club: facilities and staff",
      "body": "Spend your surplus on five facility tracks — training, scouting, medical, academy, and commercial — each with five tiers, and hire a chief for every track. Prices are shown in CZ$ and in seasons of profit, so you can see the real cost. Facilities absorb your winnings and unlock effects as each engine comes online, starting with training." },
    "da": { "title": "Byg din klub: faciliteter og staff",
      "body": "Brug dit overskud på fem facilitets-spor — træning, scouting, medicinsk, akademi og kommerciel — hver med fem tiers, og ansæt en chef for hvert spor. Priser vises i CZ$ og i sæsoners overskud, så du kan se den reelle pris. Faciliteter opsuger din gevinst og låser effekter op efterhånden som hver motor lander, med træning først." },
    "refs": [1441]
  }]
}

## Help (indsæt i public/locales/{en,da}/help.json under sections — ny "club"-sektion)
EN: sections.club = { "label": "Club", "whatClub": { "title": "What is the Club?", "text": "The Club is where you invest your surplus in facilities and staff. There are five facility tracks, each with five tiers. Each tier costs a one-off price (shown in CZ$ and in seasons of profit) plus a small per-season upkeep. Every track also has a chief you can hire — the facility sets the ceiling, the chief sets how much of it you use, so both matter. The commercial track is a pure long-term investment toward merchandise and never pays for itself directly." } }
DA: sections.club = { "label": "Klub", "whatClub": { "title": "Hvad er Klubben?", "text": "Klubben er hvor du investerer dit overskud i faciliteter og staff. Der er fem facilitets-spor, hver med fem tiers. Hvert tier koster en engangspris (vist i CZ$ og i sæsoners overskud) plus en lille drift pr. sæson. Hvert spor har også en chef du kan ansætte — faciliteten sætter loftet, chefen sætter hvor meget af det du udnytter, så begge betyder noget. Det kommerationelle spor er en ren langsigtet investering mod merchandise og betaler sig aldrig direkte tilbage." } }
```

- [ ] **Step 3: Commit**

```bash
git branch --show-current && git add docs/FEATURE_STATUS.md docs/superpowers/drafts/2026-07-05-facilities-flip-announce.md && git commit -m "docs(klub): FEATURE_STATUS + staged flip-announce draft (#1441 A3)"
```

---

### Task 11: Fuld verifikation + preview-gennemklik + PR

- [ ] **Step 1: Lokal verifikation** — `pwsh -File scripts/verify-local.ps1` (backend + frontend tests + build) → exit 0. `cd frontend && npm run lint` → grøn.

- [ ] **Step 2: Playwright core-smoke** — `cd frontend && npx playwright test core-smoke.spec.js` (alle 3 projekter — Klub tilføjer ikke visuelle snapshots til de eksisterende ruter, men verificér ingen regression). Hvis nav-item lækker ind i eksisterende snapshots (det bør det ikke — flag=false i test-build), opdatér ALLE 3 projekter og brug `[patch-notes-snapshot-ok]` kun hvis relevant.

- [ ] **Step 3: Preview-gennemklik** — start dev-server med `VITE_PREVIEW_MOCK=1` (så clubMock + enabled aktiveres). Klik igennem: åbn /klub, opgradér et spor (tier hæver + saldo-kontekst), åbn staff-panel, ansæt en kandidat (slot fyldes), fyr (slot tømmes), verificér tom-state når disabled. Tag screenshots til PR + til ejer.

- [ ] **Step 4: Push + PR** — `git push -u origin feat/1441-facilities-staff-a3`. PR-body fra PULL_REQUEST_TEMPLATE med Brugerverifikation-sektion + eksplicit "hvorfor ingen patch note nu" (feature flag-gated false; patch note staged til flip). Normal merge (ingen migration). `Refs #1441`.

- [ ] **Step 5: Vis ejer previewet** — attach RIGTIGE screenshots fra gennemklikket (ikke Playwright-mock) + link til preview-deploy, så ejeren kan teste FØR merge (ejer-krav 25/6).

---

## Self-review (mod spec §2.7 + ejer-beslutninger)

- **§2.7 faciliteter-oversigt (5 spor, tiers, priser CZ$ + "≈ X sæsoners overskud"):** Task 2 (seasonsEquivalent) + Task 7 (FacilityTrackCard) + Task 8 (KlubPage). ✅
- **§2.7 staff-panel (kandidater/ansæt/fyr):** Task 5 (hook) + Task 7 (StaffPanel). ✅
- **§2.7 editorial anti-slop (Bebas + cz-data, ingen rounded-2xl/glow/emoji):** Task 7/8 bruger font-display/font-data/cz-tokens/rounded-cz. ✅
- **§2.7 EN først, DA under:** Task 6. ✅
- **§2.7 preview seed-data til ejer-gennemklik:** Task 9 (statefuld mock). ✅
- **Q2 kommerciel = ærligt sink:** Task 6 (sinkTag/sinkNote) + Task 7 (accent-border + tag). ✅
- **Q3 effekt ærlig (live vs. target):** Task 2 (effectLive) + Task 6 (effect.live/target/note) + Task 7. ✅
- **Flag-gating uden dobbelt-flag:** Task 4/5 (gater på API 403). Flip = ejer-only, uden for Plan A. ✅
- **Patch/help forberedt til flip (ikke live nu):** Task 10 (staged draft). ✅
- **Q1 util-udvidelse + Q3 training-effekt-wiring:** IKKE i Plan A (data-drevet UI uændret) → Plan B (pre-flip engine-slice). Noteret i header.

**Placeholder-scan:** ingen TODO/TBD i kode-steps. **Type-konsistens:** `facility`-objektets felter (track/tier/upgradePrice/tierUpkeep/staff/effectiveBonus/seasonsEquivalent/effectLive) er identiske i Task 2 (backend), Task 7/8 (frontend) og Task 9 (mock). Hook-metoder (upgrade/loadCandidates/hire/fire) matcher mellem Task 5 og Task 7/8.

**Kendt oprydning ved implementering:** KlubPage step 1 kalder `useFacilities()` to gange (destructuring + `facs`) — konsolidér til ét `const facs = useFacilities();` og læs alle felter derfra.
