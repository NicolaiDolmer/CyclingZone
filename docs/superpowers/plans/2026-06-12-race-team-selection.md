# Holdudtagelse + kaptajn/hjælpere + udbrud (#1307) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manager udtagelse af 6-8 ryttere pr. løb med kaptajn/hjælper-roller og udbruds-mekanik oven på light-race-motoren (#1102), med assistent-autopick som fallback — verificeret i `race:gate`-harnesset før ship.

**Architecture:** Roller persisteres som ny `race_role`-kolonne på `race_entries` (skrives via backend service-role; RLS uændret). Motoren (`raceSimulator.js`) udvides INDE i den frosne `simulateStage`-kontrakt: `teamComponent`-seamet aktiveres (hjælperkvalitet × friskhed booster kaptajnen) og en seeded udbruds-bonus tilføjes som ny score-komponent med egen RNG-strøm (forstyrrer ikke eksisterende noise-sekvens). `autoFillEntries` ændres fra "alle ryttere" til per-hold autopick (6-8 + kaptajn). Spiller-UI er et panel på RaceDetailPage, gated af `race_engine_v2_enabled`-flaget via GET-endpointet.

**Tech Stack:** Node.js/Express (backend, `node --test`), Supabase (Postgres + RLS, migration via `.github/workflows/auto-migrate.yml`), React/Vite + react-i18next (frontend), Playwright (E2E).

**Branch:** `feat/1307-race-selection` (fra `origin/main`, frisk worktree).

---

## Bevidste designvalg (ejer-review i PR)

1. **Overlap-reglen udskydes** (spec afsnit 14 "Initial: nej"): løb har ingen tidspunkter i dag og finaliseres sekventielt — ægte overlap kan ikke opstå før "løb spredt over dagen" (fast-follow, spec 8.5). Reglen aktiveres dér. Træthed (#1306) straffer i forvejen at køre alt.
2. **Udbruds-terræner:** spec siger "flad/rolling/medium-bjerg" → `flat`, `rolling`, `mountain` (IKKE `high_mountain`/`itt`). `hilly` er udeladt initialt (puncheur-target er stramt); konstanten er ét sted at udvide.
3. **Roller:** `captain` (obligatorisk), `sprint_captain` (valgfri, beskyttes på flade etaper), `hunter` (valgfri, udbruds-jæger), `helper` (default). Hunter tæller OGSÅ som hjælper i kaptajn-boostet.
4. **Udtagelses-størrelse:** 6-8 for alle klasser; Grand Tours (`TourFrance`, `GiroVuelta`) = præcis 8. Hold med færre raske ryttere end min: autopick stiller alle tilgængelige; manager-save tillader `effectiveMin = min(rule.min, antal raske)`.
5. **#1306-bugfix indgår:** `buildRaceResults` (raceRunner.js:167) stripper i dag `form`/`fatigue` fra entrants, så condition ALDRIG når simulatoren i prod-stien. Fixes her (roller skal samme vej igennem) med regressionstest + postmortem-notat.

## Tunbare konstanter (kalibreres i Task 9, startværdier her)

| Konstant | Start | Betydning |
|---|---|---|
| `TEAM_RACE_WEIGHT` | 0.010 | Max kaptajn-boost ved helperSupport=1.0 (~1,5 % af typisk terrain 0.65) |
| `HELPER_FATIGUE_DAMPING` | 0.5 | Hjælper med træthed 100 bidrager 50 % |
| `BREAKAWAY_PROFILES` | flat 0.10 · rolling 0.12 · mountain 0.16 | Max udbruds-bonus pr. profil |
| `BREAKAWAY_TOP_EXCLUDED` | 0.4 | Top-40 % (terrain-score) kan ikke eskapere (hunter undtaget) |
| `HUNTER_WEIGHT_MULTIPLIER` | 3 | Jægerens vægt i escapee-udvælgelsen |
| Gate-bånd udbrudssejre | flat 1-10 % · rolling 2-12 % · mountain 5-25 % | Andel etaper vundet af en escapee |

---

### Task 1: DB-migration — `race_role` på `race_entries`

**Files:**
- Create: `database/2026-06-12-race-entries-roles.sql`

- [ ] **Step 1: Skriv migrationen**

```sql
-- #1307: Holdudtagelse + kaptajn/hjælpere + udbruds-jæger.
-- race_role pr. startfelt-række. Skrives KUN via backend (service_role) — RLS
-- uændret (read=authenticated, write=admin/service_role, jf. slice2-migrationen).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.

ALTER TABLE public.race_entries
  ADD COLUMN IF NOT EXISTS race_role TEXT NOT NULL DEFAULT 'helper'
    CHECK (race_role IN ('captain', 'sprint_captain', 'hunter', 'helper'));

-- Max én af hver leder-rolle pr. (løb, hold).
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_captain
  ON public.race_entries(race_id, team_id) WHERE race_role = 'captain';
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_sprint_captain
  ON public.race_entries(race_id, team_id) WHERE race_role = 'sprint_captain';
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_hunter
  ON public.race_entries(race_id, team_id) WHERE race_role = 'hunter';

COMMENT ON COLUMN public.race_entries.race_role IS
  '#1307: captain/sprint_captain/hunter/helper. Default helper. Manager-udtagelse sætter roller; autopick sætter captain (+ evt. sprint_captain).';
```

- [ ] **Step 2: Commit**

```bash
git add database/2026-06-12-race-entries-roles.sql
git commit -m "feat(db): race_role pa race_entries (captain/sprint_captain/hunter/helper) - Refs #1307"
```

---

### Task 2: Engine — aggression + udbruds-bonus i `simulateStage`

**Files:**
- Modify: `backend/lib/raceSimulator.js`
- Test: `backend/lib/raceBreakaway.test.js` (ny)

`simulateStage`s SIGNATUR er frossen — alt sker inde i funktionen. Udbruddet bruger en DEDIKERET rng (XOR-scrambled seed, samme mønster som condition-rng i dry-run-scriptet) så den eksisterende noise-sekvens er uændret når ingen profil er udbruds-egnet.

- [ ] **Step 1: Skriv failing tests**

```javascript
// backend/lib/raceBreakaway.test.js
// #1307: udbruds-mekanik — seeded, kun egnede profiler, 1-3 escapees, hunter-vægt.
import test from "node:test";
import assert from "node:assert/strict";
import { simulateStage, aggressionScore, BREAKAWAY_PROFILES } from "./raceSimulator.js";

const ab = (over = {}) => ({
  climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
  cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50,
  ...over,
});
const demand = { sprint: 0.8, endurance: 0.2, randomness: 0.5 };
const makeEntrants = (n) =>
  Array.from({ length: n }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    team_id: `t${i % 4}`,
    // Spredning: r000 stærkest, r0NN svagest → bund-kandidater findes.
    abilities: ab({ sprint: 90 - i * 2, tactics: 40 + (i % 30) }),
  }));

test("aggressionScore vægter tactics/endurance/acceleration", () => {
  const high = aggressionScore(ab({ tactics: 99, endurance: 99, acceleration: 99 }));
  const low = aggressionScore(ab({ tactics: 1, endurance: 1, acceleration: 1 }));
  assert.ok(high > low);
  assert.ok(high <= 99 && low >= 0);
});

test("udbrud: kun på egnede profiler", () => {
  const entrants = makeEntrants(30);
  const itt = simulateStage({ entrants, stageProfile: { profile_type: "itt", demand_vector: demand }, seed: 7 });
  assert.ok(itt.ranked.every((r) => (r.components.breakaway ?? 0) === 0), "itt må ikke have udbrud");
  const flat = simulateStage({ entrants, stageProfile: { profile_type: "flat", demand_vector: demand }, seed: 7 });
  const escapees = flat.ranked.filter((r) => r.components.breakaway > 0);
  assert.ok(escapees.length >= 1 && escapees.length <= 3, `1-3 escapees, fik ${escapees.length}`);
});

test("udbrud: deterministisk — samme seed giver samme escapees og bonus", () => {
  const entrants = makeEntrants(30);
  const profile = { profile_type: "rolling", demand_vector: demand };
  const a = simulateStage({ entrants, stageProfile: profile, seed: 42 });
  const b = simulateStage({ entrants: [...entrants].reverse(), stageProfile: profile, seed: 42 });
  assert.deepEqual(
    a.ranked.map((r) => [r.rider_id, r.components.breakaway]),
    b.ranked.map((r) => [r.rider_id, r.components.breakaway]),
  );
});

test("udbrud: escapees kommer fra den lavere-rangerede del (uden hunter)", () => {
  const entrants = makeEntrants(40);
  const profile = { profile_type: "flat", demand_vector: demand };
  // Terrain-rang: r000 er stærkest. Escapee må ikke være blandt top-40 %.
  for (let seed = 1; seed <= 20; seed++) {
    const { ranked } = simulateStage({ entrants, stageProfile: profile, seed });
    for (const r of ranked.filter((x) => x.components.breakaway > 0)) {
      const idx = Number(r.rider_id.slice(1));
      assert.ok(idx >= Math.floor(40 * 0.4), `escapee ${r.rider_id} er i den beskyttede top`);
    }
  }
});

test("hunter: markant forhøjet escapee-chance", () => {
  const base = makeEntrants(30);
  let hunterPicked = 0, samePicked = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const withHunter = base.map((e) => e.rider_id === "r015" ? { ...e, race_role: "hunter" } : e);
    const a = simulateStage({ entrants: withHunter, stageProfile: { profile_type: "flat", demand_vector: demand }, seed });
    if (a.ranked.find((r) => r.rider_id === "r015").components.breakaway > 0) hunterPicked++;
    const b = simulateStage({ entrants: base, stageProfile: { profile_type: "flat", demand_vector: demand }, seed });
    if (b.ranked.find((r) => r.rider_id === "r015").components.breakaway > 0) samePicked++;
  }
  assert.ok(hunterPicked > samePicked * 1.5, `hunter ${hunterPicked} vs uden ${samePicked}`);
});

test("BREAKAWAY_PROFILES indeholder præcis flat/rolling/mountain", () => {
  assert.deepEqual(Object.keys(BREAKAWAY_PROFILES).sort(), ["flat", "mountain", "rolling"]);
});
```

- [ ] **Step 2: Kør testene — verificér de fejler**

Run: `node --test lib/raceBreakaway.test.js` (fra `backend/`)
Expected: FAIL — `aggressionScore` is not exported / `components.breakaway` undefined.

- [ ] **Step 3: Implementér i raceSimulator.js**

Tilføj efter `teamComponent`-seam-blokken (linje ~90), og opdatér header-kommentarens score-model til `terrain + noise + form − fatigue + team + breakaway`:

```javascript
// ── Udbrud (#1307, spec 8.3) ──────────────────────────────────────────────────
// På udbruds-egnede profiler får 1-3 lavere-rangerede ryttere (aggression-vægtet,
// seeded) en chance-bonus. Dedikeret rng (XOR-scrambled seed) → noise-sekvensen
// er UÆNDRET. Hunter-rollen: altid kandidat + HUNTER_WEIGHT_MULTIPLIER i vægt.
// Bonus = maxBonus · u² (u uniform) → de fleste udbrud hentes, enkelte holder hjem.
export const BREAKAWAY_PROFILES = Object.freeze({ flat: 0.10, rolling: 0.12, mountain: 0.16 });
export const BREAKAWAY_TOP_EXCLUDED = 0.4;       // top-40 % (terrain) kan ikke eskapere
export const BREAKAWAY_MAX_RIDERS = 3;
export const HUNTER_WEIGHT_MULTIPLIER = 3;

// Aggression = lyst/evne til at køre i udbrud, udledt af eksisterende abilities
// (ingen ny stat i v1): taktik vejer tungest, dernæst motor og punch-acceleration.
export function aggressionScore(abilities) {
  const a = (k) => Number(abilities?.[k]) || 0;
  return 0.5 * a("tactics") + 0.3 * a("endurance") + 0.2 * a("acceleration");
}

// → Map(rider_id → bonus) for de udvalgte escapees (tom Map hvis profil uegnet).
function selectBreakawayBonuses({ ordered, terrainById, profileType, seed }) {
  const bonuses = new Map();
  const maxBonus = BREAKAWAY_PROFILES[profileType];
  if (!maxBonus || ordered.length < 4) return bonuses;

  const rng = makeRng((seed ^ 0xb4ea0ff5) >>> 0);

  // Terræn-rang: stærkeste først. Kandidater = under top-cuttet, plus hunters (altid).
  const byTerrain = [...ordered].sort((a, b) =>
    (terrainById.get(b.rider_id) - terrainById.get(a.rider_id)) ||
    String(a.rider_id).localeCompare(String(b.rider_id))
  );
  const cut = Math.floor(byTerrain.length * BREAKAWAY_TOP_EXCLUDED);
  const candidates = byTerrain.filter((e, i) => i >= cut || e.race_role === "hunter");
  if (!candidates.length) return bonuses;

  const count = Math.min(1 + Math.floor(rng() * BREAKAWAY_MAX_RIDERS), candidates.length);

  // Vægtet udvælgelse uden tilbagelægning (deterministisk over rider_id-stabil liste).
  const pool = candidates.map((e) => ({
    e,
    w: Math.max(1, aggressionScore(e.abilities)) * (e.race_role === "hunter" ? HUNTER_WEIGHT_MULTIPLIER : 1),
  }));
  for (let k = 0; k < count && pool.length; k++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let draw = rng() * total;
    let idx = 0;
    while (idx < pool.length - 1 && (draw -= pool[idx].w) > 0) idx++;
    const [picked] = pool.splice(idx, 1);
    const u = rng();
    bonuses.set(picked.e.rider_id, maxBonus * u * u);
  }
  return bonuses;
}
```

Omstrukturér `simulateStage`-kernen (linje ~144-162) — terrain prækomputeres, udbrud udvælges FØR noise-loopet, og `breakaway` indgår i score + components:

```javascript
  const ordered = [...entrants].sort((a, b) =>
    String(a.rider_id).localeCompare(String(b.rider_id))
  );
  const rng = makeRng(seed >>> 0);

  const terrainById = new Map(
    ordered.map((e) => [e.rider_id, terrainScore(e.abilities, demand)])
  );
  const breakawayById = selectBreakawayBonuses({ ordered, terrainById, profileType, seed });

  const scored = ordered.map((e) => {
    const terrain = terrainById.get(e.rider_id);
    const noise = noiseSd > 0 ? gaussian(rng, 0, noiseSd) : 0;
    const form = formComponent(e, stageProfile, rng);
    const fatigue = fatigueComponent(e, stageProfile);
    const team = teamComponent(e, stageProfile);
    const breakaway = breakawayById.get(e.rider_id) || 0;
    const finalScore = terrain + noise + form - fatigue + team + breakaway;
    return {
      rider_id: e.rider_id,
      team_id: e.team_id ?? null,
      finalScore,
      components: { terrain, noise, form, fatigue, team, breakaway },
    };
  });
```

- [ ] **Step 4: Kør testene — verificér de passerer**

Run: `node --test lib/raceBreakaway.test.js`
Expected: PASS (alle 6). Kør også `node --test lib/raceSimulator.test.js` — hvis eksisterende tests asserter components-shape, opdatér dem til at inkludere `breakaway: 0` (legitim adfærdsudvidelse).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceSimulator.js backend/lib/raceBreakaway.test.js
git commit -m "feat(engine): seeded udbruds-bonus + aggression + hunter-vaegt i simulateStage - Refs #1307"
```

---

### Task 3: Engine — `buildTeamContext` + aktivt `teamComponent`

**Files:**
- Modify: `backend/lib/raceSimulator.js`
- Test: `backend/lib/raceTeamRoles.test.js` (ny)

- [ ] **Step 1: Skriv failing tests**

```javascript
// backend/lib/raceTeamRoles.test.js
// #1307: teamComponent-seam aktiveret — hjælperkvalitet × friskhed booster kaptajnen.
import test from "node:test";
import assert from "node:assert/strict";
import { simulateStage, buildTeamContext, TEAM_RACE_WEIGHT } from "./raceSimulator.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const demand = { climbing: 0.7, endurance: 0.3, randomness: 0 }; // randomness 0 → ingen noise
const profile = { profile_type: "itt", demand_vector: demand };  // itt → ingen udbrud

function team(prefix, roles, quality = 70, fatigue) {
  return roles.map((role, i) => ({
    rider_id: `${prefix}${i}`,
    team_id: prefix,
    race_role: role,
    abilities: ab(quality),
    ...(fatigue != null ? { fatigue } : {}),
  }));
}

test("kaptajn får boost af friske, gode hjælpere; hjælpere er neutrale", () => {
  const entrants = team("a", ["captain", "helper", "helper"]);
  const { ranked } = simulateStage({ entrants, stageProfile: profile, seed: 1 });
  const captain = ranked.find((r) => r.rider_id === "a0");
  const helper = ranked.find((r) => r.rider_id === "a1");
  assert.ok(captain.components.team > 0, "kaptajn skal have positivt team-bidrag");
  assert.ok(captain.components.team <= TEAM_RACE_WEIGHT + 1e-9, "bounded af TEAM_RACE_WEIGHT");
  assert.equal(helper.components.team, 0);
});

test("trætte hjælpere giver mindre boost end friske (acceptance: træthed indgår)", () => {
  const fresh = simulateStage({ entrants: team("a", ["captain", "helper", "helper"], 70, 0), stageProfile: profile, seed: 1 });
  const tired = simulateStage({ entrants: team("a", ["captain", "helper", "helper"], 70, 100), stageProfile: profile, seed: 1 });
  const fb = fresh.ranked.find((r) => r.rider_id === "a0").components.team;
  const tb = tired.ranked.find((r) => r.rider_id === "a0").components.team;
  assert.ok(fb > tb, `frisk ${fb} skal være > træt ${tb}`);
  assert.ok(tb > 0, "selv trætte hjælpere bidrager noget");
});

test("sprint_captain beskyttes på flade etaper, captain på øvrige", () => {
  const entrants = team("a", ["captain", "sprint_captain", "helper", "helper"]);
  const flatP = { profile_type: "flat", demand_vector: demand };
  const flat = simulateStage({ entrants, stageProfile: flatP, seed: 99 });
  assert.ok(flat.ranked.find((r) => r.rider_id === "a1").components.team > 0, "sprint_captain boostes på flat");
  assert.equal(flat.ranked.find((r) => r.rider_id === "a0").components.team, 0, "captain er hjælper-neutral på flat når sprint_captain findes");
  const mtn = simulateStage({ entrants, stageProfile: profile, seed: 99 });
  assert.ok(mtn.ranked.find((r) => r.rider_id === "a0").components.team > 0, "captain boostes ellers");
});

test("hunter tæller som hjælper i boostet; hold uden roller er fuldt neutrale", () => {
  const withHunter = team("a", ["captain", "hunter"]);
  const r1 = simulateStage({ entrants: withHunter, stageProfile: profile, seed: 5 });
  assert.ok(r1.ranked.find((r) => r.rider_id === "a0").components.team > 0);
  const noRoles = team("b", [undefined, undefined, undefined]);
  const r2 = simulateStage({ entrants: noRoles, stageProfile: profile, seed: 5 });
  assert.ok(r2.ranked.every((r) => r.components.team === 0));
});

test("buildTeamContext: helperSupport ∈ [0,1], hold uden kaptajn udelades", () => {
  const entrants = [...team("a", ["captain", "helper"]), ...team("b", ["helper", "helper"])];
  const terrainById = new Map(entrants.map((e) => [e.rider_id, 0.65]));
  const ctx = buildTeamContext({ entrants, terrainById, stageProfile: profile });
  assert.ok(ctx.has("a") && !ctx.has("b"));
  const a = ctx.get("a");
  assert.ok(a.helperSupport >= 0 && a.helperSupport <= 1);
});
```

- [ ] **Step 2: Kør testene — verificér de fejler**

Run: `node --test lib/raceTeamRoles.test.js`
Expected: FAIL — `buildTeamContext` not exported / `components.team === 0` overalt.

- [ ] **Step 3: Implementér**

Erstat `teamComponent`-stubben og tilføj `buildTeamContext` + konstanter:

```javascript
// ── Hold-seam aktiveret (#1307, spec 8.2) ─────────────────────────────────────
// Hjælperkvalitet (terrain-score) × friskhed (1 − træthed-dæmpning) booster den
// beskyttede leder: sprint_captain på flade etaper (fallback captain), ellers
// captain. Hjælpere/hunters er score-neutrale (ingen straf i v1 — kalibrérbart).
export const TEAM_RACE_WEIGHT = 0.010;       // max boost ved helperSupport = 1.0
export const HELPER_FATIGUE_DAMPING = 0.5;   // træthed 100 → hjælper bidrager 50 %
const SPRINT_PROFILES = new Set(["flat"]);

export function buildTeamContext({ entrants, terrainById, stageProfile }) {
  const byTeam = new Map();
  for (const e of entrants) {
    if (!e.team_id || !e.race_role) continue;
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, { captainId: null, sprintCaptainId: null, helpers: [] });
    const t = byTeam.get(e.team_id);
    if (e.race_role === "captain") t.captainId = e.rider_id;
    else if (e.race_role === "sprint_captain") t.sprintCaptainId = e.rider_id;
    else t.helpers.push(e); // helper + hunter arbejder begge for lederen
  }
  const ctx = new Map();
  for (const [teamId, t] of byTeam) {
    if (!t.captainId && !t.sprintCaptainId) continue;
    let support = 0;
    if (t.helpers.length) {
      let sum = 0;
      for (const h of t.helpers) {
        const quality = clamp(terrainById.get(h.rider_id) || 0, 0, 1);
        const raw = Number(h.fatigue);
        const freshness = 1 - (Number.isFinite(raw) ? clamp(raw, 0, 100) / 100 : 0) * HELPER_FATIGUE_DAMPING;
        sum += quality * freshness;
      }
      support = clamp(sum / t.helpers.length, 0, 1);
    }
    ctx.set(teamId, { ...t, helperSupport: support });
  }
  return ctx;
}

function teamComponent(entrant, stageProfile, teamContext) {
  if (!teamContext || !entrant?.team_id) return 0;
  const t = teamContext.get(entrant.team_id);
  if (!t) return 0;
  const isSprintStage = SPRINT_PROFILES.has(stageProfile?.profile_type);
  const protectedId = isSprintStage ? (t.sprintCaptainId ?? t.captainId) : t.captainId;
  if (!protectedId || entrant.rider_id !== protectedId) return 0;
  return TEAM_RACE_WEIGHT * t.helperSupport;
}
```

I `simulateStage`: byg context efter `terrainById` og send den med:

```javascript
  const teamCtx = buildTeamContext({ entrants: ordered, terrainById, stageProfile });
```
og i map-loopet: `const team = teamComponent(e, stageProfile, teamCtx);`

- [ ] **Step 4: Kør alle simulator-tests**

Run: `node --test lib/raceTeamRoles.test.js lib/raceBreakaway.test.js lib/raceSimulator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceSimulator.js backend/lib/raceTeamRoles.test.js
git commit -m "feat(engine): teamComponent aktiveret - hjaelpere booster kaptajn, traethed daemper - Refs #1307"
```

---

### Task 4: Runner — condition/rolle-passthrough i `buildRaceResults` (fixer #1306-bug)

**Files:**
- Modify: `backend/lib/raceRunner.js:167`
- Test: `backend/lib/raceRunnerPassthrough.test.js` (ny)

**Bug:** `simEntrants = entrants.map((e) => ({ rider_id, team_id, abilities }))` stripper `form`/`fatigue` (fra #1306-berigelsen) — condition har i dag NUL effekt i prod-stien. Roller skal samme vej, så fixen hører hjemme her.

- [ ] **Step 1: Skriv failing test**

```javascript
// backend/lib/raceRunnerPassthrough.test.js
// #1306-regression + #1307: form/fatigue/race_role skal nå simulateStage gennem buildRaceResults.
import test from "node:test";
import assert from "node:assert/strict";
import { buildRaceResults } from "./raceRunner.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
// itt + randomness 0 → deterministisk, ingen udbrud: kun terrain + form/fatigue/team.
const stages = [{ stage_number: 1, profile_type: "itt", demand_vector: { time_trial: 1, randomness: 0 } }];

test("form/fatigue påvirker resultatet gennem buildRaceResults (#1306-bugfix)", () => {
  // To identiske ryttere: a har topform, b er smadret → a SKAL slå b.
  const entrants = [
    { rider_id: "a", team_id: "t1", abilities: ab(50), form: 100, fatigue: 0 },
    { rider_id: "b", team_id: "t2", abilities: ab(50), form: 0, fatigue: 100 },
  ];
  const { resultRows } = buildRaceResults({ race: { id: "x", race_type: "single" }, stages, entrants, pointsLookup: {} });
  const gc = resultRows.filter((r) => r.result_type === "gc").sort((r, s) => r.rank - s.rank);
  assert.equal(gc[0].rider_id, "a", "topform skal slå bundform ved ens abilities");
});

test("race_role når simulatoren: kaptajn med hjælpere slår rolle-løs tvilling", () => {
  const entrants = [
    { rider_id: "cap", team_id: "t1", abilities: ab(50), race_role: "captain" },
    { rider_id: "h1", team_id: "t1", abilities: ab(50), race_role: "helper" },
    { rider_id: "solo", team_id: "t2", abilities: ab(50) },
  ];
  const { resultRows } = buildRaceResults({ race: { id: "y", race_type: "single" }, stages, entrants, pointsLookup: {} });
  const gc = resultRows.filter((r) => r.result_type === "gc").sort((r, s) => r.rank - s.rank);
  assert.equal(gc[0].rider_id, "cap", "kaptajn-boost skal afgøre ved ellers ens score");
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `node --test lib/raceRunnerPassthrough.test.js`
Expected: FAIL på begge (tie brydes af rider_id i dag → "a" vinder muligvis test 1 ved et held; test 2 fejler sikkert — verificér mindst én rød).

- [ ] **Step 3: Fix linje 167 i raceRunner.js**

```javascript
  // #1306-fix + #1307: form/fatigue/race_role SKAL med ind i simulatoren — det er
  // præcis condition-berigelsen og rollerne der adskiller prod-stien fra rå abilities.
  const simEntrants = entrants.map((e) => ({
    rider_id: e.rider_id,
    team_id: e.team_id,
    abilities: e.abilities,
    ...(e.form != null ? { form: e.form } : {}),
    ...(e.fatigue != null ? { fatigue: e.fatigue } : {}),
    ...(e.race_role ? { race_role: e.race_role } : {}),
  }));
```

Og udvid `input_checksum`-payloaden (linje ~181) så roller indgår i repro-audit:

```javascript
      input_checksum: stableSeed(JSON.stringify({
        ids: simEntrants.map((e) => e.rider_id).sort(),
        roles: simEntrants.filter((e) => e.race_role).map((e) => [e.rider_id, e.race_role]).sort(),
        demand: stage.demand_vector,
        profile: stage.profile_type,
      })),
```

- [ ] **Step 4: Kør tests + skriv postmortem-notat**

Run: `node --test lib/raceRunnerPassthrough.test.js` → PASS.
Create: `.claude/learnings/2026-06-12-1306-condition-stripped-in-buildraceresults.md` — kort notat: berigelsen i `loadEntrantsForRace` blev strippet af `simEntrants`-mapningen ét lag længere inde; harnesset fangede det ikke fordi terræn-testene kalder `simulateStage` direkte. Guard fremover: passthrough-regressionstesten + gate-GT kører nu condition gennem `buildRaceResults`.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/raceRunnerPassthrough.test.js .claude/learnings/2026-06-12-1306-condition-stripped-in-buildraceresults.md
git commit -m "fix(engine): form/fatigue/race_role passthrough i buildRaceResults (#1306-regression) - Refs #1307"
```

---

### Task 5: Autopick — `backend/lib/raceAutopick.js`

**Files:**
- Create: `backend/lib/raceAutopick.js`
- Test: `backend/lib/raceAutopick.test.js`

- [ ] **Step 1: Skriv failing tests**

```javascript
// backend/lib/raceAutopick.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";

const ab = (over = {}) => ({
  climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
  cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50,
  ...over,
});
const flatStage = { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
const mtnStage = { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, endurance: 0.1, randomness: 0.4 } };
const riders = (n, f = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ rider_id: `r${String(i).padStart(2, "0")}`, abilities: ab(f(i)), fatigue: 0 }));

test("selectionSizeForRace: GT = 8/8, øvrige 6-8", () => {
  assert.deepEqual(selectionSizeForRace({ race_class: "TourFrance" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "GiroVuelta" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "ProSeries" }), { min: 6, max: 8 });
  assert.deepEqual(selectionSizeForRace({}), { min: 6, max: 8 });
});

test("autopick: vælger max-antal bedst egnede + kaptajn = mest egnede", () => {
  // r00 har klart bedst klatring → mest egnet til mountain-løbet.
  const pool = riders(15, (i) => ({ climbing: 90 - i * 3 }));
  const picks = autopickTeamSelection({ riders: pool, stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  assert.equal(picks.length, 8);
  const captain = picks.find((p) => p.race_role === "captain");
  assert.equal(captain.rider_id, "r00");
  assert.equal(picks.filter((p) => p.race_role === "captain").length, 1);
});

test("autopick: sprint_captain sættes når løbet har flade etaper og topsprinteren ikke er kaptajn", () => {
  const pool = riders(12, (i) => (i === 5 ? { sprint: 95 } : { climbing: 80 - i * 2 }));
  const picks = autopickTeamSelection({ riders: pool, stages: [flatStage, mtnStage], sizeRule: { min: 6, max: 8 } });
  const sprintCap = picks.find((p) => p.race_role === "sprint_captain");
  assert.ok(sprintCap, "sprint_captain skal sættes");
  assert.equal(sprintCap.rider_id, "r05");
});

test("autopick: lille trup → stiller alle; tom trup → tom liste; træthed nedprioriterer", () => {
  const small = autopickTeamSelection({ riders: riders(4), stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.equal(small.length, 4);
  assert.ok(small.some((p) => p.race_role === "captain"));
  assert.deepEqual(autopickTeamSelection({ riders: [], stages: [flatStage], sizeRule: { min: 6, max: 8 } }), []);

  const tired = riders(10, (i) => ({ sprint: 70 }));
  tired[0].fatigue = 100; // ellers identisk med resten → skal fravælges først
  const picks = autopickTeamSelection({ riders: tired, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(!picks.some((p) => p.rider_id === "r00"), "udmattet rytter fravælges når ens alternativer findes");
});

test("autopick: deterministisk uafhængigt af input-rækkefølge", () => {
  const pool = riders(20, (i) => ({ climbing: (i * 7) % 40 + 40 }));
  const a = autopickTeamSelection({ riders: pool, stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  const b = autopickTeamSelection({ riders: [...pool].reverse(), stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Kør — verificér FAIL** (`node --test lib/raceAutopick.test.js`, modul findes ikke)

- [ ] **Step 3: Implementér**

```javascript
// backend/lib/raceAutopick.js
// #1307: assistent-autopick — fornuftigt 6-8-rytter-hold + kaptajn når manageren
// ikke selv har udtaget. Ren funktion (ingen DB); raceRunner kalder med beriget data.
// Egnethed = gennemsnitlig terrain-score over løbets etapeprofiler, let dæmpet af
// træthed (assistenten skåner smadrede ryttere). Deterministisk (stabil tiebreak).

import { terrainScore } from "./raceSimulator.js";

// Spec 8.1: 6-8 pr. løb, kategori-afhængigt. Grand Tours kører fulde hold på 8.
export const SELECTION_SIZE = Object.freeze({
  default: Object.freeze({ min: 6, max: 8 }),
  TourFrance: Object.freeze({ min: 8, max: 8 }),
  GiroVuelta: Object.freeze({ min: 8, max: 8 }),
});

export function selectionSizeForRace(race) {
  return SELECTION_SIZE[race?.race_class] || SELECTION_SIZE.default;
}

const AUTOPICK_FATIGUE_DAMPING = 0.3; // træthed 100 → egnethed × 0.7

export function suitabilityScore(abilities, stages) {
  if (!stages?.length) return 0;
  let sum = 0;
  for (const s of stages) sum += terrainScore(abilities, s.demand_vector || {});
  return sum / stages.length;
}

/**
 * @param {{riders:Array<{rider_id:string, abilities:object, fatigue?:number}>, stages:Array, sizeRule:{min:number,max:number}}} args
 * @returns {Array<{rider_id:string, race_role:string}>} tom hvis ingen ryttere.
 */
export function autopickTeamSelection({ riders = [], stages = [], sizeRule }) {
  const rule = sizeRule || SELECTION_SIZE.default;
  const scored = riders
    .filter((r) => r?.rider_id && r.abilities)
    .map((r) => {
      const raw = Number(r.fatigue);
      const freshness = 1 - (Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) / 100 : 0) * AUTOPICK_FATIGUE_DAMPING;
      return { rider_id: r.rider_id, abilities: r.abilities, score: suitabilityScore(r.abilities, stages) * freshness };
    })
    .sort((a, b) => b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id)));

  const picked = scored.slice(0, Math.min(rule.max, scored.length));
  if (!picked.length) return [];

  const captainId = picked[0].rider_id;

  // Sprint-kaptajn: kun hvis løbet har flade etaper og feltets bedste sprinter
  // ikke allerede ER kaptajnen (assistenten holder det simpelt).
  let sprintCaptainId = null;
  if (stages.some((s) => s.profile_type === "flat") && picked.length > 1) {
    const bestSprint = [...picked].sort((a, b) =>
      (Number(b.abilities?.sprint) || 0) - (Number(a.abilities?.sprint) || 0) ||
      String(a.rider_id).localeCompare(String(b.rider_id))
    )[0];
    if (bestSprint.rider_id !== captainId) sprintCaptainId = bestSprint.rider_id;
  }

  return picked.map((p) => ({
    rider_id: p.rider_id,
    race_role: p.rider_id === captainId ? "captain"
      : p.rider_id === sprintCaptainId ? "sprint_captain"
      : "helper",
  }));
}
```

- [ ] **Step 4: Kør — PASS** (`node --test lib/raceAutopick.test.js`)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceAutopick.js backend/lib/raceAutopick.test.js
git commit -m "feat(engine): assistent-autopick - 6-8 bedst egnede + kaptajn/sprintkaptajn - Refs #1307"
```

---

### Task 6: Runner — per-hold autopick i `autoFillEntries` + roller i `loadEntrantsForRace`

**Files:**
- Modify: `backend/lib/raceRunner.js` (autoFillEntries ~linje 253, loadEntrantsForRace ~linje 289, simulateRace ~linje 412)
- Test: `backend/lib/raceRunnerAutofill.test.js` (ny)

Adfærdsskifte (kun V2-stien — flag OFF rører intet): auto-fill går fra "ALLE ryttere når entries er tomt" til "for hvert egnet hold UDEN entries: autopick 6-8 + kaptajn". Hold MED entries (manager-udtagne) røres ikke. `loadEntrantsForRace` får `stages` som parameter (suitability kræver profiler) og læser `race_role` med.

- [ ] **Step 1: Skriv failing tests** — mock-supabase efter mønstret i `raceFatigue.test.js` (thenable builder, `__calls`-log). Test-scenarier:

```javascript
// backend/lib/raceRunnerAutofill.test.js
// #1307: per-hold autopick. Mock-builder følger raceFatigue.test.js-mønstret.
import test from "node:test";
import assert from "node:assert/strict";
import { loadEntrantsForRace } from "./raceRunner.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});

// Minimal thenable query-builder: state = { tabel → rækker }; understøtter de
// kald loadEntrantsForRace/autoFillEntries laver (select/eq/in/or/gte + insert).
function makeSupabase(state) {
  const calls = [];
  function builder(table) {
    const q = { table, filters: [], _insert: null };
    const api = {
      select() { return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      or() { return api; },
      gte(col, val) { q.filters.push(["gte", col, val]); return api; },
      order() { return api; },
      insert(rows) { q._insert = rows; calls.push({ table, insert: rows }); state[table] = [...(state[table] || []), ...rows]; return Promise.resolve({ error: null }); },
      then(resolve) {
        let rows = [...(state[table] || [])];
        for (const [op, col, val] of q.filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === val);
          if (op === "in") rows = rows.filter((r) => val.includes(r[col]));
          if (op === "gte") rows = rows.filter((r) => r[col] != null && r[col] >= val);
        }
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from: (t) => builder(t), __calls: calls };
}

const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } }];
const race = { id: "race1", race_type: "single", season_id: "s1" };

function baseState() {
  const state = {
    teams: [
      { id: "t1", is_test_account: false, is_frozen: false },
      { id: "t2", is_test_account: false, is_frozen: false },
    ],
    riders: [],
    race_entries: [],
    rider_condition: [],
    rider_derived_abilities: [],
  };
  // 10 ryttere pr. hold med abilities.
  for (const t of ["t1", "t2"]) {
    for (let i = 0; i < 10; i++) {
      const id = `${t}-r${i}`;
      state.riders.push({ id, team_id: t, firstname: "A", lastname: id, is_u25: false, is_retired: false });
      state.rider_derived_abilities.push({ rider_id: id, ...ab(80 - i * 3) });
    }
  }
  return state;
}

test("hold uden entries autopickes (max 8, kaptajn sat, is_auto_filled=true)", async () => {
  const state = baseState();
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  assert.equal(entrants.length, 16, "2 hold × 8 autopicked");
  const inserted = supabase.__calls.filter((c) => c.table === "race_entries").flatMap((c) => c.insert);
  assert.ok(inserted.every((r) => r.is_auto_filled === true));
  for (const t of ["t1", "t2"]) {
    assert.equal(inserted.filter((r) => r.team_id === t && r.race_role === "captain").length, 1);
  }
});

test("hold MED manager-entries røres ikke; kun det manglende hold fyldes", async () => {
  const state = baseState();
  state.race_entries = [
    { race_id: "race1", rider_id: "t1-r9", team_id: "t1", race_role: "captain", is_auto_filled: false },
    ...[0, 1, 2, 3, 4].map((i) => ({ race_id: "race1", rider_id: `t1-r${i}`, team_id: "t1", race_role: "helper", is_auto_filled: false })),
  ];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  const t1 = entrants.filter((e) => e.team_id === "t1");
  assert.equal(t1.length, 6, "managerens 6 beholdes uændret");
  assert.equal(t1.find((e) => e.rider_id === "t1-r9").race_role, "captain", "race_role læses med ind i entrants");
  assert.equal(entrants.filter((e) => e.team_id === "t2").length, 8, "t2 autopickes");
});

test("skadede ryttere udelades af autopick; persist=false skriver intet", async () => {
  const state = baseState();
  state.rider_condition = [{ rider_id: "t1-r0", injured_until: "2099-01-01" }];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  assert.ok(!entrants.some((e) => e.rider_id === "t1-r0"), "skadet topscorer udeladt");
  assert.equal(supabase.__calls.filter((c) => c.table === "race_entries").length, 0, "dry-run: ingen insert");
});
```

- [ ] **Step 2: Kør — verificér FAIL** (autoFillEntries indsætter i dag ALLE 20 ryttere, ingen race_role).

- [ ] **Step 3: Implementér i raceRunner.js**

Importér øverst: `import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";`

Erstat `autoFillEntries` med per-hold-version (behold injured-eksklusionens hårde fejl-semantik):

```javascript
// #1307: per-hold autopick. For hvert egnet hold (ikke test/frosset) UDEN entries
// for løbet: assistenten udtager 6-8 bedst egnede + kaptajn (spec 8.1 — "vælger du
// ikke, vælger assistenten fornuftigt; ingen straf for fravær"). Hold MED entries
// (manager-udtagne) røres ikke. Skadede (injured_until >= i dag) udelades (#1306 6.5).
async function fillMissingTeamEntries({ supabase, race, stages, existingEntries, persist = true }) {
  const { data: teams, error: teamErr } = await supabase
    .from("teams")
    .select("id, is_test_account, is_frozen")
    .or("is_test_account.is.null,is_test_account.eq.false");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  const teamsWithEntries = new Set((existingEntries || []).map((e) => e.team_id));
  const missingTeamIds = (teams || [])
    .filter((t) => !t.is_frozen && !teamsWithEntries.has(t.id))
    .map((t) => t.id);
  if (!missingTeamIds.length) return [];

  const { data: riders, error: riderErr } = await supabase
    .from("riders")
    .select("id, team_id")
    .in("team_id", missingTeamIds)
    .or("is_retired.is.null,is_retired.eq.false");
  if (riderErr) throw new Error(`riders: ${riderErr.message}`);

  const todayStr = copenhagenDateString();
  const { data: injured, error: injErr } = await supabase
    .from("rider_condition")
    .select("rider_id")
    .gte("injured_until", todayStr);
  if (injErr) throw new Error(`rider_condition (injured): ${injErr.message}`);
  const injuredIds = new Set((injured || []).map((r) => r.rider_id));
  const candidates = (riders || []).filter((r) => !injuredIds.has(r.id));
  if (!candidates.length) return [];

  const candidateIds = candidates.map((r) => r.id);
  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const { data: abilities, error: aErr } = await supabase
    .from("rider_derived_abilities")
    .select(abilityCols)
    .in("rider_id", candidateIds);
  if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
  const abilityByRider = new Map((abilities || []).map((a) => [a.rider_id, a]));

  // Træthed (let dæmpning i autopick) — degraderer til 0 ved fejl, mirror B2.
  let fatigueByRider = new Map();
  const { data: conditions, error: condErr } = await supabase
    .from("rider_condition")
    .select("rider_id, fatigue")
    .in("rider_id", candidateIds);
  if (!condErr) fatigueByRider = new Map((conditions || []).map((c) => [c.rider_id, c.fatigue]));

  const sizeRule = selectionSizeForRace(race);
  const rows = [];
  const byTeam = new Map();
  for (const r of candidates) {
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    const ab = abilityByRider.get(r.id);
    if (!ab) continue; // uden abilities kan rytteren ikke scores (defensivt, som entrants)
    byTeam.get(r.team_id).push({ rider_id: r.id, abilities: ab, fatigue: fatigueByRider.get(r.id) });
  }
  for (const [teamId, teamRiders] of byTeam) {
    for (const pick of autopickTeamSelection({ riders: teamRiders, stages, sizeRule })) {
      rows.push({ race_id: race.id, rider_id: pick.rider_id, team_id: teamId, race_role: pick.race_role, is_auto_filled: true });
    }
  }

  if (persist && rows.length) {
    const { error: insErr } = await supabase.from("race_entries").insert(rows);
    if (insErr) throw new Error(`race_entries insert: ${insErr.message}`);
  }
  return rows.map((r) => ({ rider_id: r.rider_id, team_id: r.team_id, race_role: r.race_role }));
}
```

Opdatér `loadEntrantsForRace`: signatur `{ supabase, race, stages = [], persist = true }`; select med rolle: `.select("rider_id, team_id, race_role")`; kald `fillMissingTeamEntries({ supabase, race, stages, existingEntries: entries, persist })` ALTID (ikke kun ved tomt) og konkatener resultatet; byg `roleByRider = new Map(entries.map((e) => [e.rider_id, e.race_role]))` og sæt `entrant.race_role = roleByRider.get(r.id)` (kun når sat og ≠ "helper"-default er OK at medtage altid). I `simulateRace` (linje ~412): `loadEntrantsForRace({ supabase, race, stages, persist: !dryRun })` — flyt kaldet EFTER `loadStageProfiles`. Fjern den gamle `autoFillEntries`.

NB: tjek `adminSimulateRace.js` og evt. andre call-sites af `loadEntrantsForRace`/`autoFillEntries` (`grep -rn "loadEntrantsForRace\|autoFillEntries" backend/`) og opdatér til den nye signatur.

- [ ] **Step 4: Kør hele backend-suiten** — `node --test` (fra `backend/`) → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceRunner.js backend/lib/raceRunnerAutofill.test.js backend/lib/adminSimulateRace.js
git commit -m "feat(engine): per-hold autopick erstatter alle-ryttere-autofill; race_role laeses ind - Refs #1307"
```

---

### Task 7: Service — `backend/lib/raceSelection.js` (validér + gem + kontekst)

**Files:**
- Create: `backend/lib/raceSelection.js`
- Test: `backend/lib/raceSelection.test.js`

- [ ] **Step 1: Skriv failing tests**

```javascript
// backend/lib/raceSelection.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection } from "./raceSelection.js";

const base = {
  riderIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  captainId: "r1",
  sprintCaptainId: null,
  hunterId: null,
  teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]),
  injuredRiderIds: new Set(),
  sizeRule: { min: 6, max: 8 },
  availableCount: 9,
};

test("gyldig udtagelse passerer", () => {
  assert.deepEqual(validateSelection(base), { ok: true, errors: [] });
});

test("størrelse håndhæves (for få / for mange / effectiveMin ved lille trup)", () => {
  assert.ok(validateSelection({ ...base, riderIds: ["r1", "r2"] }).errors.includes("selection_wrong_size"));
  assert.ok(validateSelection({ ...base, riderIds: ["r1","r2","r3","r4","r5","r6","r7","r8","r9"] }).errors.includes("selection_wrong_size"));
  // Kun 5 raske på holdet → 5 er nok (effectiveMin).
  const small = validateSelection({
    ...base,
    riderIds: ["r1", "r2", "r3", "r4", "r5"],
    teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5"]),
    availableCount: 5,
  });
  assert.equal(small.ok, true);
});

test("kaptajn kræves, skal være udtaget, roller skal være distinkte", () => {
  assert.ok(validateSelection({ ...base, captainId: null }).errors.includes("selection_captain_required"));
  assert.ok(validateSelection({ ...base, captainId: "r9" }).errors.includes("selection_captain_not_selected"));
  assert.ok(validateSelection({ ...base, sprintCaptainId: "r1" }).errors.includes("selection_role_overlap"));
  assert.ok(validateSelection({ ...base, hunterId: "r1" }).errors.includes("selection_role_overlap"));
});

test("fremmede, skadede og duplikerede ryttere afvises", () => {
  assert.ok(validateSelection({ ...base, riderIds: [...base.riderIds.slice(0, 5), "alien"] }).errors.includes("selection_rider_not_on_team"));
  assert.ok(validateSelection({ ...base, injuredRiderIds: new Set(["r2"]) }).errors.includes("selection_rider_injured"));
  assert.ok(validateSelection({ ...base, riderIds: ["r1", "r1", "r2", "r3", "r4", "r5"] }).errors.includes("selection_duplicate_rider"));
});
```

- [ ] **Step 2: Kør — FAIL** (modul findes ikke).

- [ ] **Step 3: Implementér**

```javascript
// backend/lib/raceSelection.js
// #1307: manager-udtagelse — ren validering + DB-operationer (kaldes fra api.js).
// Fejl returneres som snake_case-koder (frontend oversætter; mønster fra training-ruterne).

import { selectionSizeForRace, suitabilityScore } from "./raceAutopick.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { copenhagenDateString } from "./copenhagenTime.js";

export function validateSelection({
  riderIds = [], captainId = null, sprintCaptainId = null, hunterId = null,
  teamRiderIds, injuredRiderIds, sizeRule, availableCount,
}) {
  const errors = [];
  const unique = new Set(riderIds);
  if (unique.size !== riderIds.length) errors.push("selection_duplicate_rider");

  // Lille-trup-lempelse: min sænkes til antal tilgængelige (autopick-paritet).
  const effectiveMin = Math.min(sizeRule.min, Number.isFinite(availableCount) ? availableCount : sizeRule.min);
  if (riderIds.length < effectiveMin || riderIds.length > sizeRule.max) errors.push("selection_wrong_size");

  for (const id of riderIds) {
    if (!teamRiderIds.has(id)) { errors.push("selection_rider_not_on_team"); break; }
  }
  for (const id of riderIds) {
    if (injuredRiderIds.has(id)) { errors.push("selection_rider_injured"); break; }
  }

  if (!captainId) errors.push("selection_captain_required");
  else if (!unique.has(captainId)) errors.push("selection_captain_not_selected");

  for (const roleId of [sprintCaptainId, hunterId]) {
    if (roleId && !unique.has(roleId)) errors.push("selection_role_not_selected");
  }
  const roleIds = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roleIds).size !== roleIds.length) errors.push("selection_role_overlap");

  return { ok: errors.length === 0, errors };
}

function roleFor(riderId, { captainId, sprintCaptainId, hunterId }) {
  if (riderId === captainId) return "captain";
  if (riderId === sprintCaptainId) return "sprint_captain";
  if (riderId === hunterId) return "hunter";
  return "helper";
}

// Gem udtagelsen: slet holdets eksisterende entries for løbet, indsæt de nye.
// PK (race_id, rider_id) gør gen-kørsel ufarlig (delete-then-insert).
export async function saveSelection({ supabase, race, teamId, riderIds, captainId, sprintCaptainId = null, hunterId = null }) {
  const { error: delErr } = await supabase
    .from("race_entries").delete().eq("race_id", race.id).eq("team_id", teamId);
  if (delErr) throw new Error(`race_entries delete: ${delErr.message}`);

  const rows = riderIds.map((rider_id) => ({
    race_id: race.id, rider_id, team_id: teamId,
    race_role: roleFor(rider_id, { captainId, sprintCaptainId, hunterId }),
    is_auto_filled: false,
  }));
  const { error: insErr } = await supabase.from("race_entries").insert(rows);
  if (insErr) throw new Error(`race_entries insert: ${insErr.message}`);
  return rows;
}

// Kontekst til GET-endpointet: holdets ryttere (raske/skadede markeret, suitability
// pr. løbets profiler), nuværende udtagelse, størrelses-regel.
export async function getSelectionContext({ supabase, race, teamId }) {
  const [ridersRes, profilesRes, entriesRes] = await Promise.all([
    supabase.from("riders").select("id, firstname, lastname")
      .eq("team_id", teamId).or("is_retired.is.null,is_retired.eq.false"),
    supabase.from("race_stage_profiles").select("stage_number, profile_type, demand_vector")
      .eq("race_id", race.id).order("stage_number", { ascending: true }),
    supabase.from("race_entries").select("rider_id, race_role, is_auto_filled")
      .eq("race_id", race.id).eq("team_id", teamId),
  ]);
  for (const [name, res] of [["riders", ridersRes], ["race_stage_profiles", profilesRes], ["race_entries", entriesRes]]) {
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
  }
  const riders = ridersRes.data || [];
  const stages = profilesRes.data || [];
  const riderIds = riders.map((r) => r.id);

  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const [abilitiesRes, conditionRes] = await Promise.all([
    supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", riderIds),
    supabase.from("rider_condition").select("rider_id, form, fatigue, injured_until").in("rider_id", riderIds),
  ]);
  const abilityByRider = new Map((abilitiesRes.data || []).map((a) => [a.rider_id, a]));
  const conditionByRider = new Map((conditionRes.data || []).map((c) => [c.rider_id, c]));
  const todayStr = copenhagenDateString();

  const riderRows = riders.map((r) => {
    const cond = conditionByRider.get(r.id);
    const ab = abilityByRider.get(r.id);
    return {
      id: r.id,
      name: [r.firstname, r.lastname].filter(Boolean).join(" "),
      suitability: ab ? Math.round(suitabilityScore(ab, stages) * 100) : null,
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
      injured: !!(cond?.injured_until && cond.injured_until >= todayStr),
    };
  });

  const entries = entriesRes.data || [];
  const selection = entries.length
    ? {
        rider_ids: entries.map((e) => e.rider_id),
        captain_id: entries.find((e) => e.race_role === "captain")?.rider_id ?? null,
        sprint_captain_id: entries.find((e) => e.race_role === "sprint_captain")?.rider_id ?? null,
        hunter_id: entries.find((e) => e.race_role === "hunter")?.rider_id ?? null,
        is_auto_filled: entries.every((e) => e.is_auto_filled),
      }
    : null;

  return {
    size: selectionSizeForRace(race),
    riders: riderRows,
    selection,
    availableCount: riderRows.filter((r) => !r.injured).length,
  };
}
```

- [ ] **Step 4: Kør — PASS** (`node --test lib/raceSelection.test.js`)

- [ ] **Step 5: Commit**

```bash
git add backend/lib/raceSelection.js backend/lib/raceSelection.test.js
git commit -m "feat(api): raceSelection-service - validering, gem, kontekst - Refs #1307"
```

---

### Task 8: API — `GET`/`PUT /api/races/:raceId/selection`

**Files:**
- Modify: `backend/routes/api.js` (placér ved de øvrige race-ruter; følg `POST /training/run-today`-mønstret linje ~1140)

- [ ] **Step 1: Tilføj imports øverst i api.js** (ved de øvrige lib-imports):

```javascript
import { validateSelection, saveSelection, getSelectionContext } from "../lib/raceSelection.js";
import { isRaceEngineV2Enabled } from "../lib/raceEngineFlag.js";
```
(NB: `isRaceEngineV2Enabled` kan allerede være importeret — tjek først.)

- [ ] **Step 2: Tilføj ruterne**

```javascript
// ═══ #1307: HOLDUDTAGELSE ════════════════════════════════════════════════════

// GET /api/races/:raceId/selection — kontekst for managerens egen udtagelse.
// enabled=false (flag OFF) → UI skjuler panelet; resten af payload udelades.
router.get("/races/:raceId/selection", requireAuth, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const enabled = await isRaceEngineV2Enabled(supabase);
    const { data: race, error } = await supabase
      .from("races")
      .select("id, name, race_type, race_class, stages, status, season_id")
      .eq("id", req.params.raceId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!race) return res.status(404).json({ error: "race_not_found" });
    if (!enabled) return res.json({ enabled: false, race: { id: race.id, status: race.status } });

    const ctx = await getSelectionContext({ supabase, race, teamId: req.team.id });
    res.json({ enabled: true, race, ...ctx });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/races/:raceId/selection — gem managerens udtagelse (6-8 + roller).
router.put("/races/:raceId/selection", requireAuth, marketWriteLimiter, async (req, res) => {
  if (!req.team) return res.status(400).json({ error: "No team found" });
  try {
    const enabled = await isRaceEngineV2Enabled(supabase);
    if (!enabled) return res.status(409).json({ error: "selection_flag_disabled" });

    const { data: race, error } = await supabase
      .from("races")
      .select("id, race_type, race_class, status")
      .eq("id", req.params.raceId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!race) return res.status(404).json({ error: "race_not_found" });
    if (race.status !== "scheduled") return res.status(409).json({ error: "selection_race_not_open" });

    const { rider_ids: riderIds = [], captain_id: captainId = null, sprint_captain_id: sprintCaptainId = null, hunter_id: hunterId = null } = req.body || {};

    const ctx = await getSelectionContext({ supabase, race, teamId: req.team.id });
    const result = validateSelection({
      riderIds, captainId, sprintCaptainId, hunterId,
      teamRiderIds: new Set(ctx.riders.map((r) => r.id)),
      injuredRiderIds: new Set(ctx.riders.filter((r) => r.injured).map((r) => r.id)),
      sizeRule: ctx.size,
      availableCount: ctx.availableCount,
    });
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    await saveSelection({ supabase, race, teamId: req.team.id, riderIds, captainId, sprintCaptainId, hunterId });
    res.json({ ok: true });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Syntaks-tjek + fuld backend-suite**

Run: `node --check routes/api.js && node --test` (fra `backend/`)
Expected: clean + PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/api.js
git commit -m "feat(api): GET/PUT /races/:raceId/selection - flag-gated holdudtagelse - Refs #1307"
```

---

### Task 9: Harness — udbruds-bånd + `--roles`-mode + KALIBRERING

**Files:**
- Modify: `backend/scripts/simulateSeasonDryRun.js`, `backend/package.json`

- [ ] **Step 1: Tilføj `--roles`-mode + metrics i dry-run-scriptet**

Efter `CONDITION_MODE` (linje ~53): `const ROLES_MODE = !!arg("roles", false);`

Tilføj hjælpere (ved de øvrige hjælpere, ~linje 100) — genbrug GT'ens snake-mønster:

```javascript
// #1307 --roles: snake-draft felt-samplen i hold à 8, kaptajn = bedste overall,
// hunter = højeste aggression blandt ikke-kaptajner på hvert ANDET hold (seeded valg
// unødvendigt — deterministisk regel). Returnerer entrants med race_role + team_id.
import { aggressionScore } from "../lib/raceSimulator.js"; // (tilføj i import-blokken øverst)

function assignRoles(sample) {
  const TEAM = 8;
  const sorted = [...sample].sort((a, b) => b.overall - a.overall || String(a.id).localeCompare(String(b.id)));
  const nTeams = Math.ceil(sorted.length / TEAM);
  const teams = new Map();
  sorted.forEach((r, i) => {
    const round = Math.floor(i / nTeams), pos = i % nTeams;
    const teamIdx = round % 2 === 0 ? pos : nTeams - 1 - pos;
    if (!teams.has(teamIdx)) teams.set(teamIdx, []);
    teams.get(teamIdx).push(r);
  });
  const roleById = new Map();
  for (const [teamIdx, members] of teams) {
    const captain = members[0]; // stærkeste = kaptajn
    roleById.set(captain.id, "captain");
    if (teamIdx % 2 === 0 && members.length > 1) {
      const hunter = [...members.slice(1)].sort((a, b) =>
        aggressionScore(b.abilities) - aggressionScore(a.abilities) || String(a.id).localeCompare(String(b.id)))[0];
      roleById.set(hunter.id, "hunter");
    }
    for (const m of members) if (!roleById.has(m.id)) roleById.set(m.id, "helper");
  }
  return { roleById, teamIdxById: new Map(sorted.map((r) => { for (const [ti, ms] of teams) if (ms.includes(r)) return [r.id, ti]; })) };
}
```

(Implementér `teamIdxById` som en simpel løkke i stedet for one-lineren hvis den er ulæselig — pointen er: rider_id → `t${teamIdx}`.)

I terræn-løkken (linje ~186-203): byg entrants med roller når `ROLES_MODE`, og kør i roles-mode OGSÅ en neutral tvillinge-sim på samme seed til kaptajn-delta:

```javascript
    let breakawayWins = 0, captainWinsRoles = 0, captainWinsNeutral = 0;
    let hunterEscapes = 0, hunterCount = 0, helperEscapes = 0, helperCount = 0;
    // ... inde i race-løkken:
    const roles = ROLES_MODE ? assignRoles(sample) : null;
    const entrants = sample.map((r) => ({
      rider_id: r.id,
      team_id: roles ? `t${roles.teamIdxById.get(r.id)}` : r.id,
      abilities: r.abilities,
      ...(roles ? { race_role: roles.roleById.get(r.id) } : {}),
      ...(CONDITION_MODE && r.form != null ? { form: r.form } : {}),
      ...(CONDITION_MODE && r.fatigue != null ? { fatigue: r.fatigue } : {}),
    }));
    const { ranked } = simulateStage({ entrants, stageProfile: { profile_type: terrain, demand_vector: demand }, seed: stableSeed(`${terrain}:${i}`) });
    if ((ranked[0].components.breakaway ?? 0) > 0) breakawayWins++;
    if (roles) {
      if (roles.roleById.get(ranked[0].rider_id) === "captain") captainWinsRoles++;
      for (const r of ranked) {
        const role = roles.roleById.get(r.rider_id);
        const escaped = (r.components.breakaway ?? 0) > 0;
        if (role === "hunter") { hunterCount++; if (escaped) hunterEscapes++; }
        if (role === "helper") { helperCount++; if (escaped) helperEscapes++; }
      }
      // Neutral tvilling (samme sample/seed, ingen roller) → kaptajn-delta.
      const neutral = simulateStage({
        entrants: sample.map((r) => ({ rider_id: r.id, team_id: r.id, abilities: r.abilities })),
        stageProfile: { profile_type: terrain, demand_vector: demand },
        seed: stableSeed(`${terrain}:${i}`),
      });
      if (roles.roleById.get(neutral.ranked[0].rider_id) === "captain") captainWinsNeutral++;
    }
```

Gem på `terrainResults`-objektet: `breakawayWinShare: breakawayWins / RACES, captainWinsRoles, captainWinsNeutral, hunterEscapeRate: hunterCount ? hunterEscapes / hunterCount : 0, helperEscapeRate: helperCount ? helperEscapes / helperCount : 0`.

- [ ] **Step 2: Tilføj gate-bånd + håndhævelse** (efter scorecard-sektionen, før sektion D):

```javascript
// ── #1307: udbruds-bånd (håndhæves med --enforce-targets) ─────────────────────
const BREAKAWAY_TARGETS = {
  flat:     { min: 0.01, max: 0.10 },
  rolling:  { min: 0.02, max: 0.12 },
  mountain: { min: 0.05, max: 0.25 },
};
const breakawayFailures = [];
console.log("\n   udbruds-bånd (#1307 — andel etaper vundet af escapee):");
for (const [terrain, band] of Object.entries(BREAKAWAY_TARGETS)) {
  const tr = terrainResults.find((x) => x.terrain === terrain);
  const share = tr.breakawayWinShare ?? 0;
  const pass = share >= band.min && share <= band.max;
  console.log(`   ${padE(terrain, 14)} ${Math.round(share * 100)}% (bånd ${Math.round(band.min * 100)}-${Math.round(band.max * 100)}%) ${pass ? "✓" : "✗"}`);
  if (!pass) breakawayFailures.push(terrain);
}
if (breakawayFailures.length && ENFORCE_TARGETS) process.exitCode = 1;

if (ROLES_MODE) {
  const cwRoles = terrainResults.reduce((s, tr) => s + (tr.captainWinsRoles || 0), 0);
  const cwNeutral = terrainResults.reduce((s, tr) => s + (tr.captainWinsNeutral || 0), 0);
  const eligible = Object.keys(BREAKAWAY_TARGETS);
  const hunterRate = eligible.reduce((s, t) => s + (terrainResults.find((x) => x.terrain === t)?.hunterEscapeRate || 0), 0) / eligible.length;
  const helperRate = eligible.reduce((s, t) => s + (terrainResults.find((x) => x.terrain === t)?.helperEscapeRate || 0), 0) / eligible.length;
  console.log(`\n   roller (#1307): kaptajn-sejre ${cwRoles} (med hjælpere) vs ${cwNeutral} (neutral tvilling) → delta ${cwRoles - cwNeutral}`);
  console.log(`   hunter-escapee-rate ${(hunterRate * 100).toFixed(1)}% vs helper ${(helperRate * 100).toFixed(1)}% → ratio ${helperRate ? (hunterRate / helperRate).toFixed(1) : "∞"}`);
  if (ENFORCE_TARGETS) {
    if (!(cwRoles >= cwNeutral)) { console.log("   ✗ kaptajn-boost giver ikke flere kaptajn-sejre"); process.exitCode = 1; }
    if (!(hunterRate > helperRate * 1.5)) { console.log("   ✗ hunter-rollen løfter ikke escapee-chancen ≥1.5×"); process.exitCode = 1; }
  }
}
```

GT-sektionen (linje ~261): i `ROLES_MODE`, tilføj roller til `gtEntrants` (kaptajn = bedste overall pr. hold — bemærk gtRiders er sorteret; brug samme regel: pr. team_id, medlem med højeste overall = captain, hunter på hvert andet hold, rest helper).

- [ ] **Step 3: npm-script + KØR GATEN**

I `backend/package.json` scripts:
```json
"race:gate:roles": "node scripts/simulateSeasonDryRun.js --enforce-targets --no-html --seed=2026 --roles",
```

Run (fra `backend/`):
```
npm run race:gate
npm run race:gate:condition
npm run race:gate:roles
```
Expected: exit 0 på alle tre. **KALIBRERING:** hvis bånd/targets fejler, justér i denne rækkefølge (commit hver justering med begrundelse): (1) `BREAKAWAY_PROFILES`-magnituder, (2) `BREAKAWAY_TOP_EXCLUDED`, (3) `TEAM_RACE_WEIGHT`. De 7 eksisterende targets + strukturelle oracles SKAL forblive grønne — udbruddet må ikke koste flat-sprinter-båndet (NB: en escapee kan selv være sprinter-born, så born-as-targets tåler udbrud). Verificér derefter robusthed på 2 ekstra seeds (mønster fra kalibrerings-loggen): `node scripts/simulateSeasonDryRun.js --enforce-targets --no-html --seed=7 --roles` og `--seed=42 --roles`. Dokumentér resultatet i scriptets kalibrerings-log-kommentar (linje ~72) med dato 2026-06-12.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/simulateSeasonDryRun.js backend/package.json
git commit -m "feat(gate): udbruds-baand + --roles-mode (kaptajn-delta, hunter-ratio) i race-gaten - Refs #1307"
```

---

### Task 10: Frontend — `raceSelectionLogic.js` (ren logik, TDD)

**Files:**
- Create: `frontend/src/lib/raceSelectionLogic.js`
- Test: `frontend/src/lib/raceSelectionLogic.test.js`

- [ ] **Step 1: Skriv failing tests**

```javascript
// frontend/src/lib/raceSelectionLogic.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { toggleRider, validateSelectionClient } from "./raceSelectionLogic.js";

test("toggleRider: tilføjer/fjerner og respekterer max + rydder roller for fjernet rytter", () => {
  const s0 = { riderIds: [], captainId: null, sprintCaptainId: null, hunterId: null };
  const s1 = toggleRider(s0, "a", 8);
  assert.deepEqual(s1.riderIds, ["a"]);
  const s2 = toggleRider({ ...s1, captainId: "a" }, "a", 8);
  assert.deepEqual(s2.riderIds, []);
  assert.equal(s2.captainId, null, "rolle ryddes når rytteren fravælges");
  const full = { riderIds: ["a", "b", "c", "d", "e", "f", "g", "h"], captainId: "a", sprintCaptainId: null, hunterId: null };
  assert.equal(toggleRider(full, "i", 8), full, "max nået → uændret state");
});

test("validateSelectionClient: spejl af backend-koderne", () => {
  const ok = validateSelectionClient({ riderIds: ["a", "b", "c", "d", "e", "f"], captainId: "a", sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 });
  assert.deepEqual(ok, []);
  assert.ok(validateSelectionClient({ riderIds: ["a"], captainId: "a", sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 }).includes("selection_wrong_size"));
  assert.ok(validateSelectionClient({ riderIds: ["a", "b", "c", "d", "e", "f"], captainId: null, sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 }).includes("selection_captain_required"));
  assert.ok(validateSelectionClient({ riderIds: ["a", "b", "c", "d", "e", "f"], captainId: "a", sprintCaptainId: "a", hunterId: null, size: { min: 6, max: 8 }, availableCount: 10 }).includes("selection_role_overlap"));
});
```

- [ ] **Step 2: Kør — FAIL** (`node --test src/lib/raceSelectionLogic.test.js` fra `frontend/`)

- [ ] **Step 3: Implementér**

```javascript
// frontend/src/lib/raceSelectionLogic.js
// #1307: ren udtagelses-state-logik (testbar uden React). Spejler backendens
// valideringskoder så fejl kan vises FØR kaldet.

export function toggleRider(state, riderId, max) {
  const has = state.riderIds.includes(riderId);
  if (!has && state.riderIds.length >= max) return state;
  const riderIds = has ? state.riderIds.filter((id) => id !== riderId) : [...state.riderIds, riderId];
  return {
    riderIds,
    captainId: has && state.captainId === riderId ? null : state.captainId,
    sprintCaptainId: has && state.sprintCaptainId === riderId ? null : state.sprintCaptainId,
    hunterId: has && state.hunterId === riderId ? null : state.hunterId,
  };
}

export function validateSelectionClient({ riderIds, captainId, sprintCaptainId, hunterId, size, availableCount }) {
  const errors = [];
  const effectiveMin = Math.min(size.min, availableCount ?? size.min);
  if (riderIds.length < effectiveMin || riderIds.length > size.max) errors.push("selection_wrong_size");
  if (!captainId) errors.push("selection_captain_required");
  const roles = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roles).size !== roles.length) errors.push("selection_role_overlap");
  return errors;
}
```

- [ ] **Step 4: Kør — PASS. Commit**

```bash
git add frontend/src/lib/raceSelectionLogic.js frontend/src/lib/raceSelectionLogic.test.js
git commit -m "feat(frontend): raceSelectionLogic - udtagelses-state + klientvalidering - Refs #1307"
```

---

### Task 11: Frontend — `RaceSelectionPanel` + wiring + i18n (EN først, DA sekundært)

**Files:**
- Create: `frontend/src/components/race/RaceSelectionPanel.jsx`
- Modify: `frontend/src/pages/RaceDetailPage.jsx` (render panelet når `race.status === "scheduled"`)
- Modify: `frontend/public/locales/en/races.json` + `frontend/public/locales/da/races.json`

- [ ] **Step 1: i18n-nøgler** — tilføj i BEGGE filer under en ny top-level `selection`-blok. EN:

```json
"selection": {
  "title": "Team selection",
  "subtitle": "Pick {min}-{max} riders for this race. If you don't pick, your assistant fields a sensible team — no penalty.",
  "count": "{count}/{max} selected",
  "captain": "Captain",
  "sprintCaptain": "Sprint captain (optional)",
  "hunter": "Breakaway hunter (optional)",
  "noRole": "None",
  "suitability": "Suitability",
  "form": "Form",
  "fatigue": "Fatigue",
  "injured": "Injured",
  "autoPicked": "Assistant's pick — adjust and save to take control.",
  "save": "Save selection",
  "saving": "Saving…",
  "saved": "Selection saved.",
  "errors": {
    "selection_wrong_size": "Pick between {min} and {max} riders.",
    "selection_captain_required": "Pick a captain among your selected riders.",
    "selection_captain_not_selected": "Your captain must be one of the selected riders.",
    "selection_role_not_selected": "Role riders must be part of the selection.",
    "selection_role_overlap": "Captain, sprint captain and hunter must be different riders.",
    "selection_rider_injured": "Injured riders can't be selected.",
    "selection_rider_not_on_team": "You can only select your own riders.",
    "selection_duplicate_rider": "Each rider can only be selected once.",
    "selection_race_not_open": "Selection is closed for this race.",
    "selection_flag_disabled": "Team selection isn't active yet.",
    "generic": "Couldn't save the selection. Try again."
  }
}
```

DA (samme nøgler): "Holdudtagelse" · "Udtag {min}-{max} ryttere til løbet. Vælger du ikke, stiller assistenten et fornuftigt hold — ingen straf." · "{count}/{max} udtaget" · "Kaptajn" · "Spurt-kaptajn (valgfri)" · "Udbruds-jæger (valgfri)" · "Ingen" · "Egnethed" · "Form" · "Træthed" · "Skadet" · "Assistentens valg — justér og gem for selv at tage styringen." · "Gem udtagelse" · "Gemmer…" · "Udtagelsen er gemt." · errors: "Udtag mellem {min} og {max} ryttere." · "Vælg en kaptajn blandt de udtagne." · "Kaptajnen skal være blandt de udtagne ryttere." · "Rolle-ryttere skal være en del af udtagelsen." · "Kaptajn, spurt-kaptajn og jæger skal være forskellige ryttere." · "Skadede ryttere kan ikke udtages." · "Du kan kun udtage dine egne ryttere." · "Hver rytter kan kun udtages én gang." · "Udtagelsen er lukket for dette løb." · "Holdudtagelse er ikke aktiv endnu." · "Udtagelsen kunne ikke gemmes. Prøv igen."

NB: ingen em-dash i player-facing copy (tone-guard) — brug almindelig tankestreg-fri formulering hvis guard klager; ICU-pluraler unødvendige her.

- [ ] **Step 2: Komponenten**

```jsx
// frontend/src/components/race/RaceSelectionPanel.jsx
// #1307: manager-udtagelse 6-8 ryttere + kaptajn/spurt-kaptajn/jæger.
// Self-hiding: render null når flag er OFF, løbet ikke er scheduled, eller data mangler.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { toggleRider, validateSelectionClient } from "../../lib/raceSelectionLogic.js";

const API = import.meta.env.VITE_API_URL;

export default function RaceSelectionPanel({ raceId }) {
  const { t } = useTranslation("races");
  const [data, setData] = useState(null);
  const [sel, setSel] = useState({ riderIds: [], captainId: null, sprintCaptainId: null, hunterId: null });
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [errorKey, setErrorKey] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${API}/api/races/${raceId}/selection`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok || !alive) return;
      const body = await res.json();
      if (!alive) return;
      setData(body);
      if (body.selection) {
        setSel({
          riderIds: body.selection.rider_ids,
          captainId: body.selection.captain_id,
          sprintCaptainId: body.selection.sprint_captain_id,
          hunterId: body.selection.hunter_id,
        });
      }
    })();
    return () => { alive = false; };
  }, [raceId]);

  if (!data?.enabled || data.race?.status !== "scheduled") return null;

  const { size, riders, availableCount } = data;
  const clientErrors = validateSelectionClient({ ...sel, size, availableCount });

  async function save() {
    setStatus("saving"); setErrorKey(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/races/${raceId}/selection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        rider_ids: sel.riderIds, captain_id: sel.captainId,
        sprint_captain_id: sel.sprintCaptainId, hunter_id: sel.hunterId,
      }),
    });
    if (res.ok) { setStatus("saved"); return; }
    const body = await res.json().catch(() => ({}));
    setErrorKey(body.error || "generic");
    setStatus("error");
  }

  const roleSelect = (labelKey, field) => (
    <label className="block text-sm">
      <span className="text-cz-3">{t(`selection.${labelKey}`)}</span>
      <select
        className="block mt-1 bg-cz-bg-2 border border-cz-line rounded px-2 py-1"
        value={sel[field] ?? ""}
        onChange={(e) => { setSel({ ...sel, [field]: e.target.value || null }); setStatus("idle"); }}
      >
        <option value="">{t("selection.noRole")}</option>
        {sel.riderIds.map((id) => (
          <option key={id} value={id}>{riders.find((r) => r.id === id)?.name ?? id}</option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="rounded-lg border border-cz-line bg-cz-bg-1 p-4 mb-6" data-testid="race-selection-panel">
      <h2 className="text-lg font-semibold">{t("selection.title")}</h2>
      <p className="text-sm text-cz-3 mb-1">{t("selection.subtitle", { min: size.min, max: size.max })}</p>
      {data.selection?.is_auto_filled && <p className="text-sm text-cz-accent-t">{t("selection.autoPicked")}</p>}
      <p className="text-sm font-medium my-2">{t("selection.count", { count: sel.riderIds.length, max: size.max })}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cz-3">
            <th></th><th>{t("selection.suitability")}</th><th>{t("selection.form")}</th><th>{t("selection.fatigue")}</th>
          </tr>
        </thead>
        <tbody>
          {riders.map((r) => (
            <tr key={r.id} className={r.injured ? "opacity-50" : ""}>
              <td>
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    disabled={r.injured}
                    checked={sel.riderIds.includes(r.id)}
                    onChange={() => { setSel(toggleRider(sel, r.id, size.max)); setStatus("idle"); }}
                  />
                  <span>{r.name}</span>
                  {r.injured && <span className="text-xs text-red-400">{t("selection.injured")}</span>}
                </label>
              </td>
              <td>{r.suitability ?? "–"}</td>
              <td>{r.form ?? "–"}</td>
              <td>{r.fatigue ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-4 mt-3">
        {roleSelect("captain", "captainId")}
        {roleSelect("sprintCaptain", "sprintCaptainId")}
        {roleSelect("hunter", "hunterId")}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          className="px-3 py-1.5 rounded bg-cz-accent text-cz-bg-0 font-medium disabled:opacity-50"
          disabled={clientErrors.length > 0 || status === "saving"}
          onClick={save}
        >
          {status === "saving" ? t("selection.saving") : t("selection.save")}
        </button>
        {status === "saved" && <span className="text-sm text-green-400">{t("selection.saved")}</span>}
        {status === "error" && <span className="text-sm text-red-400">{t(`selection.errors.${errorKey}`, t("selection.errors.generic"), { min: size.min, max: size.max })}</span>}
        {clientErrors.length > 0 && sel.riderIds.length > 0 && (
          <span className="text-sm text-cz-3">{t(`selection.errors.${clientErrors[0]}`, { min: size.min, max: size.max })}</span>
        )}
      </div>
    </section>
  );
}
```

**Tilpas til kodebasens faktiske mønstre** (Tailwind-klassenavne `cz-*`, fetch-mønster, fil-endelser i imports — Vite tilgiver extensionless, Nodes ESM-loader gør IKKE: brug `.js`/`.jsx` eksplicit i relative imports, jf. #803).

- [ ] **Step 3: Wiring i RaceDetailPage.jsx** — importér og render panelet øverst i sidens hovedindhold når løbet er hentet:

```jsx
import RaceSelectionPanel from "../components/race/RaceSelectionPanel.jsx";
// ... i render, over resultat-sektionerne:
{race?.status === "scheduled" && <RaceSelectionPanel raceId={race.id} />}
```

Tjek at scheduled-løb overhovedet kan åbnes via RaceDetailPage (kalender-tab'en på RacesPage linker til detalje); hvis scheduled-løb i dag viser en tom side, er panelet netop indholdet.

- [ ] **Step 4: Verificér lokalt**

Run (fra `frontend/`): `node --test` og `npm run build`
Run (fra repo-rod): `node scripts/i18n-check-leaks.mjs`
Expected: PASS / build OK / ingen nye leaks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/race/RaceSelectionPanel.jsx frontend/src/pages/RaceDetailPage.jsx frontend/public/locales/en/races.json frontend/public/locales/da/races.json
git commit -m "feat(frontend): holdudtagelses-panel pa lobsdetaljen (EN/DA) - Refs #1307"
```

---

### Task 12: E2E — `race-selection.spec.js`

**Files:**
- Create: `frontend/tests/e2e/race-selection.spec.js` (følg mønstret i `race-detail.spec.js` + `fixtures.js`)

- [ ] **Step 1: Skriv spec** — mock `GET /api/races/:id/selection` (enabled, 9 ryttere, size 6-8) og `PUT` (200 `{ok:true}`) via `page.route`; supabase-mocks fra `installNetworkMocks` + et scheduled race i races-fixturen:

```javascript
// frontend/tests/e2e/race-selection.spec.js
// #1307: holdudtagelses-panelet — vælg 6, sæt kaptajn, gem.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-00000000r307";
const riders = Array.from({ length: 9 }, (_, i) => ({
  id: `sel-r${i}`, name: `Rider ${i}`, suitability: 70 - i, form: 55, fatigue: 10, injured: i === 8,
}));

test("manager kan udtage hold og gemme", async ({ page }) => {
  await installNetworkMocks(page);
  // Selection-API-mocks:
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        race: { id: RACE_ID, name: "E2E Classic", race_type: "single", race_class: "ProSeries", stages: 1, status: "scheduled" },
        size: { min: 6, max: 8 },
        selection: null,
        riders,
        availableCount: 8,
      }),
    });
  });
  await login(page);
  await page.goto(`/races/${RACE_ID}`);
  await stabilizePage(page);

  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();

  for (let i = 0; i < 6; i++) await panel.getByRole("checkbox").nth(i).check();
  await expect(panel.getByText("6/8")).toBeVisible();

  // Skadet rytter er disabled:
  await expect(panel.getByRole("checkbox").nth(8)).toBeDisabled();

  await panel.getByRole("combobox").first().selectOption("sel-r0"); // kaptajn
  const save = panel.getByRole("button", { name: /save selection|gem udtagelse/i });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByText(/selection saved|udtagelsen er gemt/i)).toBeVisible();
});
```

NB: `race-detail`-siden henter selve løbet via supabase — udvid fixturens races-mock med det scheduled race (id `RACE_ID`) så siden renderer. Kig i `race-detail.spec.js` for hvordan races + race_results mockes, og genbrug.

- [ ] **Step 2: Kør ALLE 3 Playwright-projekter**

Run (fra `frontend/`): `npx playwright test race-selection.spec.js` og derefter `npx playwright test core-smoke.spec.js` (uden `--project`-flag — desktop + mobile-chromium + mobile-webkit).
Expected: PASS; core-smoke uændret (panelet rører ikke core-siderne — ingen snapshot-refresh nødvendig; hvis diff alligevel opstår: `npx playwright test core-smoke --update-snapshots` og commit PNG'erne).

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/e2e/race-selection.spec.js frontend/tests/e2e/fixtures.js
git commit -m "test(e2e): holdudtagelses-flow - vaelg 6, kaptajn, gem - Refs #1307"
```

---

### Task 13: help.json (EN+DA) + Patch notes 5.30

**Files:**
- Modify: `frontend/public/locales/en/help.json` + `frontend/public/locales/da/help.json`
- Modify: `frontend/src/pages/PatchNotesPage.jsx`

- [ ] **Step 1: Help-indhold** — find races-/løbs-sektionen i `help.json` (`sections.*`); findes ingen, tilføj ny sektion `raceSelection` (tjek om `HelpPage.jsx` har en eksplicit sektionsliste der skal udvides). EN-indhold:

```json
"raceSelection": {
  "label": "Team selection",
  "what": {
    "title": "Picking your race squad",
    "text": "Before each race you pick 6-8 riders (Grand Tours use full squads of 8). Open the race page and use the Team selection panel. If you don't pick, your assistant fields a sensible team automatically, so you never miss a race."
  },
  "roles": {
    "title": "Captain, sprint captain and breakaway hunter",
    "text": "Your captain is protected by the team: strong, fresh helpers boost the captain's chances. On flat stages your sprint captain (if set) gets the protection instead. A breakaway hunter gets a much higher chance of making the day's breakaway."
  },
  "breakaway": {
    "title": "Breakaways",
    "text": "On flat, rolling and medium mountain stages a small breakaway of lower-ranked riders gets a chance to stay away. Most get caught, but sometimes the break makes it. Aggressive riders and designated hunters join breaks more often."
  },
  "fatigue": {
    "title": "Fatigue matters",
    "text": "Tired helpers support their captain less, and racing builds fatigue. Rotating your squad between races keeps your stars fresh for the days that matter."
  }
}
```

DA: samme struktur ("Holdudtagelse" · "Udtagelse af løbstruppen" · "Kaptajn, spurt-kaptajn og udbruds-jæger" · "Udbrud" · "Træthed betyder noget" med tilsvarende oversat brødtekst). Husk: EN først, DA sekundært; ingen opfundne mekanikker — beskriv kun det byggede.

- [ ] **Step 2: Patch notes** — ny top-entry i `PATCHES` i `PatchNotesPage.jsx` (følg eksisterende format; CI version-checker):

```javascript
{
  version: "5.30",
  date: "2026-06-12",
  label: "Beta",
  changes: [
    {
      category: "New · Race tactics",
      items: [
        "EN · Team selection: pick 6-8 riders per race with a captain, optional sprint captain and breakaway hunter. Your assistant picks automatically if you don't. Goes live with the season relaunch on 20 June.",
        "DA · Holdudtagelse: udtag 6-8 ryttere pr. løb med kaptajn, valgfri spurt-kaptajn og udbruds-jæger. Assistenten vælger automatisk hvis du ikke gør. Aktiveres ved sæson-relaunchet 20. juni.",
        "EN · Breakaways: on flat, rolling and medium mountain stages a breakaway can now stay away and win. Refs #1307",
        "DA · Udbrud: på flade, kuperede og mellembjergs-etaper kan et udbrud nu holde hjem og vinde. Refs #1307",
      ],
    },
  ],
},
```

- [ ] **Step 3: Kør i18n-guards + build** (`node scripts/i18n-check-leaks.mjs` fra rod; `npm run build` fra `frontend/`) → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/locales/en/help.json frontend/public/locales/da/help.json frontend/src/pages/PatchNotesPage.jsx
git commit -m "docs(help): holdudtagelse + udbrud i hjaelp (EN/DA) + patch notes 5.30 - Refs #1307"
```

---

### Task 14: Fuld verifikation + PR

- [ ] **Step 1: Fuld lokal pre-flight** (fra repo-rod):

```
pwsh -File scripts/verify-local.ps1
```
Expected: backend-tests + frontend-tests + frontend-build alle grønne.

```
cd backend && npm run race:gate && npm run race:gate:condition && npm run race:gate:roles
cd ../frontend && npx playwright test core-smoke.spec.js && npx playwright test race-selection.spec.js
```
Expected: exit 0 hele vejen.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/1307-race-selection
```

PR-body SKAL indeholde (jf. PR user-verification check):

```markdown
## Hvad
Holdudtagelse 6-8 ryttere + kaptajn/hjælpere + udbruds-mekanik (light) oven på #1102-motoren. Autopick-fallback. Flag-gated af `race_engine_v2_enabled` (OFF til 20/6).

Refs #1307

## Bevidste designvalg til ejer-review
- Overlap-reglen (samme rytter i to samtidige løb) udskudt til "løb spredt over dagen" (fast-follow) — løb finaliseres sekventielt i dag, ægte overlap kan ikke opstå.
- Udbruds-bånd i gaten: flat 1-10 % · rolling 2-12 % · mountain 5-25 % — juster gerne.
- GT'er (TourFrance/GiroVuelta) kræver fulde hold på 8; øvrige 6-8.

## #1306-bugfix indbygget
`buildRaceResults` strippede form/fatigue fra entrants — condition nåede ALDRIG simulatoren i prod-stien. Fixet med regressionstest + postmortem-notat.

## Brugerverifikation
- [x] `npm run race:gate` + `race:gate:condition` + `race:gate:roles` grønne (seed 2026, robusthed verificeret på seed 7+42)
- [x] Backend + frontend `node --test` grønne lokalt
- [x] Playwright: core-smoke (alle 3 projekter) + race-selection grønne lokalt
- [x] i18n-leak-guard ren; EN+DA komplette for alle nye nøgler
- [ ] Ejer: flag-flip + udtagelse i prod verificeres ved 20/6-relaunch (#1103-checklisten)
```

- [ ] **Step 3: Efter merge** — verificér migrationen er auto-applied (auto-migrate.yml-run grøn; spot-tjek `race_role`-kolonnen i prod-DB via Supabase MCP), og tilføj `#1307: flag-flip aktiverer udtagelse + udbrud` til #1103-orchestrator-checklisten med en issue-kommentar.

---

## Self-review (udført ved plan-skrivning)

**Spec-dækning (issue #1307 + spec 8.1-8.3):** 6-8 udtagelse ✓ (Task 5-8, 11) · kategori-afhængig ✓ (SELECTION_SIZE) · én udtagelse ved etapeløbs start ✓ (selection pr. race, ikke pr. etape) · autopick-fallback ✓ (Task 5-6) · kaptajn + evt. én pr. mål GC/spurt ✓ (captain + sprint_captain) · teamComponent med hjælperkvalitet + -træthed ✓ (Task 3) · udbruds-bonus flad/rolling/medium-bjerg, 1-3 lavere-rangerede, aggression-vægtet, seeded ✓ (Task 2) · jæger-rolle ✓ (hunter, 3× vægt) · race:gate-scorecard udvidet + verificeret mod population ✓ (Task 9) · autopick altid gyldigt hold ✓ (Task 5 edge-tests) · træthed i hjælper-boost ✓ (Task 3 test 2) · UI EN-først/DA ✓ (Task 11) · help.json + patch notes ✓ (Task 13). Multi-løb-overlap: bevidst udskudt (designvalg 1, ejer-review i PR).

**Kendte tilpasningspunkter for executors:** api.js/RaceDetailPage/fixtures.js er store filer — koden her viser præcis hvad der skal ind, men placering/klassenavne følger filens eksisterende mønstre. Eksisterende `raceSimulator.test.js`-asserts på components-shape kan kræve `breakaway: 0`-opdatering (legitim).
