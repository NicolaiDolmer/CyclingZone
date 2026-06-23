import test from "node:test";
import assert from "node:assert/strict";

import {
  STARTER_SQUAD,
  STARTER_POOL_STAT_WINDOW,
  allocateStarterSquads,
  distributeTailRiders,
  allocateStarterSquadForTeam,
  buildWeakStarterPool,
  computeAge,
  deriveTeamSeed,
  hashStringToSeed,
  runStarterSquadAllocation,
} from "./starterSquadAllocator.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "./abilityDerivation.js";

// ── In-memory riders+teams-mock til single-team-allokering (#1560/#1563) ───────
// Riders: select(firstname/lastname).order().range() (navne-fetch),
// select(id).eq(team_id).order().range() (rytter-liste), insert(rows).select("id")
// (respekterer team_id fra payload — #1563 insert-med-team_id), update().eq(),
// delete().eq(). Teams: select(starter_squad_allocated_at).eq(id).single() (markør-
// læsning) + update().eq() (markør-skrivning). Ukendte hold auto-vivifies som
// markør-NULL (et nyt hold) så happy-path-tests ikke behøver seede teams.
function createRidersMock({ seedRiders = [], teamMarkers = {} } = {}) {
  const store = new Map();
  for (const r of seedRiders) store.set(r.id, { ...r });
  const teams = new Map(Object.entries(teamMarkers));
  const getTeam = (id) => {
    if (!teams.has(id)) teams.set(id, { starter_squad_allocated_at: null, created_at: "2026-06-01T00:00:00Z" });
    return teams.get(id);
  };
  let nextId = 1;

  const fakeDerive = async (_sb, ids) => {
    // Deterministisk base_value pr. id-rækkefølge → varieret pulje (unge dyrest),
    // så allokatorens youth/dom-split + fairness har noget at arbejde med.
    ids.forEach((id, i) => {
      const row = store.get(id);
      if (row) row.base_value = 100_000 - i * 1000;
    });
  };

  const supabase = {
    from(table) {
      if (table === "teams") {
        let idFilter;
        const tb = {
          select() { return tb; },
          eq(_col, val) { idFilter = val; return tb; },
          single() { return Promise.resolve({ data: { ...getTeam(idFilter) }, error: null }); },
          update(patch) {
            return { eq(_col, val) { Object.assign(getTeam(val), patch); return Promise.resolve({ error: null }); } };
          },
        };
        return tb;
      }
      assert.equal(table, "riders", "single-team-allokering rører kun riders + teams");
      let teamFilter = undefined;
      let inIds = null;
      const builder = {
        select() { return builder; },
        eq(col, val) { if (col === "team_id") teamFilter = val; return builder; },
        in(_c, ids) { inIds = ids; return builder; },
        order() { return builder; },
        range() {
          let rows = [...store.values()];
          if (teamFilter !== undefined) rows = rows.filter((r) => r.team_id === teamFilter);
          if (inIds) rows = rows.filter((r) => inIds.includes(r.id));
          // Stabil rækkefølge (mocken .order("id"))
          rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
        insert(rows) {
          const ids = [];
          for (const row of rows) {
            const id = `r-${nextId++}`;
            // #1563: respektér team_id fra payload (insert-med-team_id, intet orphan-vindue).
            store.set(id, { ...row, id, team_id: row.team_id ?? null });
            ids.push(id);
          }
          return { select() { return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }); } };
        },
        update(patch) {
          return {
            eq(_col, id) {
              const row = store.get(id);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return { eq(_col, id) { store.delete(id); return Promise.resolve({ error: null }); } };
        },
      };
      return builder;
    },
  };

  return { supabase, store, teams, fakeDerive };
}

// Fake-generator: stærke stats (80) som SKAL clampes i buildWeakStarterPool, med
// blandet demografi så youth/dom-split fungerer. Navne varierer pr. seed så
// determinisme-/variations-testen kan skelne to hold.
function makeFakeGenerate() {
  return ({ count, seed }) => ({
    riders: Array.from({ length: count }, (_, i) => ({
      pcm_id: null, firstname: `F${seed}_${i}`, lastname: `L${seed}_${i}`,
      birthdate: i % 2 === 0 ? "2006-01-01" : "1999-01-01",
      potentiale: i % 2 === 0 ? 5 : 3,
      ...Object.fromEntries(STAT_KEYS.map((k) => [k, 80])),
      _meta: { age: i % 2 === 0 ? 20 : 27 },
    })),
    coverage: {}, seed: 0,
  });
}

// Pool med tydelig struktur: nogle stjerner (højeste base_value, ikke unge),
// rigeligt unge (18-21, høj potentiale, mid base_value) + domestiques (lav).
function makePool({ stars = 4, young = 18, dom = 18 } = {}) {
  const pool = [];
  for (let i = 0; i < stars; i++) pool.push({ id: `star-${i}`, age: 27, potentiale: 5, base_value: 5_000_000 - i });
  for (let i = 0; i < young; i++) pool.push({ id: `young-${i}`, age: 20, potentiale: 5, base_value: 800_000 - i * 100 });
  for (let i = 0; i < dom; i++) pool.push({ id: `dom-${i}`, age: 27, potentiale: 3, base_value: 300_000 - i * 100 });
  return pool;
}

test("STARTER_SQUAD: kerne = unge + kerne-domestiques = MIN_RIDERS_FOR_RACE; total = kerne + hale", () => {
  assert.equal(STARTER_SQUAD.YOUTH_PER_TEAM + STARTER_SQUAD.DOMESTIQUE_PER_TEAM, STARTER_SQUAD.CORE_SIZE);
  assert.equal(STARTER_SQUAD.CORE_SIZE, MIN_RIDERS_FOR_RACE, "kernen forbliver løbs-minimummet");
  assert.equal(STARTER_SQUAD.TOTAL_SIZE, STARTER_SQUAD.CORE_SIZE + STARTER_SQUAD.TAIL_SIZE);
  assert.equal(STARTER_SQUAD.TOTAL_SIZE, 12);
});

test("computeAge regner alder ud fra birthdate vs referenceår", () => {
  assert.equal(computeAge("2005-03-01", 2026), 21);
  assert.equal(computeAge("2000-12-31", 2026), 26);
});

test("hver manager får præcis CORE_SIZE ryttere, ingen overlap", () => {
  const teamIds = ["t1", "t2", "t3"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const { assignments, leftToMarket } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  for (const t of teamIds) assert.equal(assignments[t].length, STARTER_SQUAD.CORE_SIZE);
  const assigned = teamIds.flatMap((t) => assignments[t]);
  assert.equal(new Set(assigned).size, assigned.length, "ingen rytter på to hold");
  assert.equal(assigned.length + leftToMarket.length, pool.length);
});

test("stjerner (top base_value) forhåndstildeles ALDRIG — bliver i markedet", () => {
  const teamIds = ["t1", "t2"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const starCount = Math.floor(pool.length * STARTER_SQUAD.STAR_CUTOFF_FRACTION);
  const starIds = [...pool].sort((a, b) => b.base_value - a.base_value).slice(0, starCount).map((r) => r.id);
  const { assignments } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  const assigned = new Set(teamIds.flatMap((t) => assignments[t]));
  for (const id of starIds) assert.ok(!assigned.has(id), `stjerne ${id} må ikke tildeles`);
});

test("komposition: YOUTH_PER_TEAM unge + DOMESTIQUE_PER_TEAM domestiques pr. hold (rigelige pools)", () => {
  const teamIds = ["t1", "t2"];
  const pool = makePool({ stars: 4, young: 20, dom: 20 });
  const { assignments } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  for (const t of teamIds) {
    const ids = assignments[t];
    const young = ids.filter((id) => id.startsWith("young-")).length;
    const dom = ids.filter((id) => id.startsWith("dom-")).length;
    assert.equal(young, STARTER_SQUAD.YOUTH_PER_TEAM, `${t} unge`);
    assert.equal(dom, STARTER_SQUAD.DOMESTIQUE_PER_TEAM, `${t} domestiques`);
  }
});

test("top-up: skæv pool (få unge) giver stadig CORE_SIZE pr. hold", () => {
  const teamIds = ["t1", "t2"];
  const pool = makePool({ stars: 2, young: 2, dom: 40 }); // kun 2 unge til 8 youth-slots
  const { assignments } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  for (const t of teamIds) assert.equal(assignments[t].length, STARTER_SQUAD.CORE_SIZE);
});

test("seeded: samme seed → identisk allokering (dry-run = apply)", () => {
  const teamIds = ["t1", "t2", "t3"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const a = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  const b = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  assert.deepEqual(a.assignments, b.assignments);
});

test("fairness: holdenes samlede base_value-spænd ≤ tolerance", () => {
  const teamIds = ["t1", "t2", "t3"];
  const pool = makePool({ stars: 6, young: 30, dom: 30 });
  const { stats } = allocateStarterSquads(pool, teamIds, { seed: 2026 });
  assert.ok(stats.maxSquadBaseValue - stats.minSquadBaseValue <= stats.fairnessTolerance,
    `spænd ${stats.maxSquadBaseValue - stats.minSquadBaseValue} > tolerance ${stats.fairnessTolerance}`);
});

// ── Race-hub 0c · distributeTailRiders (svag hale, snake-draft) ────────────────

test("distributeTailRiders: hvert hold får perTeam hale-ryttere, balanceret, ingen overlap", () => {
  const teamIds = ["t1", "t2", "t3"];
  const tailPool = Array.from({ length: 30 }, (_, i) => ({ id: `tail-${i}`, base_value: 7000 - i * 10 }));
  const { tailAssignments, leftToMarket } = distributeTailRiders(tailPool, teamIds, 4, { seed: 2026 });
  for (const t of teamIds) assert.equal(tailAssignments[t].length, 4, `${t} hale`);
  const assigned = teamIds.flatMap((t) => tailAssignments[t]);
  assert.equal(new Set(assigned).size, assigned.length, "ingen hale-rytter på to hold");
  assert.equal(assigned.length, 12);
  assert.equal(leftToMarket.length, 30 - 12, "resten falder ud (skal ikke ske ved korrekt pulje-størrelse)");
});

test("distributeTailRiders: deterministisk (samme seed → samme resultat)", () => {
  const teamIds = ["t1", "t2"];
  const tailPool = Array.from({ length: 8 }, (_, i) => ({ id: `tail-${i}`, base_value: 7000 - i }));
  const a = distributeTailRiders(tailPool, teamIds, 4, { seed: 2026 });
  const b = distributeTailRiders(tailPool, teamIds, 4, { seed: 2026 });
  assert.deepEqual(a.tailAssignments, b.tailAssignments);
});

// #1487: svag dedikeret start-pool. Stats clampes ind i [50,57] FØR derivation,
// så afledte styrke-evner lander ~5-21 (dybe domestikker, ingen stjerner).
test("buildWeakStarterPool: alle stats clampet til vinduet, pcm_id null, korrekt antal (#1487)", () => {
  // Fake-generator returnerer stærke ryttere (stats 80) → SKAL clampes ned til hi.
  const fakeGenerate = ({ count }) => ({
    riders: Array.from({ length: count }, (_, i) => ({
      pcm_id: null, firstname: `F${i}`, lastname: `L${i}`,
      birthdate: "2003-01-01", potentiale: 4,
      ...Object.fromEntries(STAT_KEYS.map((k) => [k, 80])),
      _meta: { age: 23 },
    })),
    coverage: {}, seed: 0,
  });
  const pool = buildWeakStarterPool({ count: 40, seed: 2026, referenceYear: 2026, generate: fakeGenerate });
  assert.equal(pool.length, 40);
  for (const r of pool) {
    assert.equal(r.pcm_id, null);
    assert.ok(!("_meta" in r), "_meta må ikke med i insert-payload");
    for (const k of STAT_KEYS) {
      assert.ok(
        r[k] >= STARTER_POOL_STAT_WINDOW.lo && r[k] <= STARTER_POOL_STAT_WINDOW.hi,
        `${k}=${r[k]} udenfor [${STARTER_POOL_STAT_WINDOW.lo},${STARTER_POOL_STAT_WINDOW.hi}]`,
      );
    }
  }
});

// FORWARD-GUARD (#1487): den ÆGTE produktions-kæde (rigtig generator → clamp →
// prod-fallback-derivation, dvs. deriveAbilities med tomt fysiologi-objekt) SKAL
// give svage ryttere. Fanger en fremtidig generator-/kalibrerings-ændring der ved
// et uheld gør start-puljen stærk igen. Tærskel 25 = ejer-målet "ingen over ~25".
test("svag start-pulje: afledte styrke-evner forbliver svage (≤25) (#1487 forward-guard)", () => {
  const STAT_DRIVEN = VISIBLE_ABILITIES.filter((k) => k !== "tactics" && k !== "aggression");
  const pool = buildWeakStarterPool({ count: 200, seed: 2026, referenceYear: 2026 });
  let globalMax = 0;
  for (const r of pool) {
    // Prod-fallback-sti (relaunch/akademi): tomt fysiologi-objekt → ingen kontrast.
    const abilities = deriveAbilities({}, r, { asOfYear: 2026 });
    const maxStat = Math.max(...STAT_DRIVEN.map((k) => abilities[k]));
    globalMax = Math.max(globalMax, maxStat);
  }
  assert.ok(globalMax <= 25, `stærkeste styrke-evne ${globalMax} > 25 — start-puljen er ikke længere svag`);
});

test("starCutoffFraction 0: ingen stjerner ekskluderes — også den dyreste allokeres (#1487)", () => {
  const teamIds = ["t1", "t2"]; // 2×8 = 16 slots
  const pool = [
    { id: "rich", age: 27, potentiale: 3, base_value: 9_000_000 },
    ...Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, age: 27, potentiale: 3, base_value: 1000 + i })),
  ];
  const { assignments, leftToMarket } = allocateStarterSquads(pool, teamIds, { seed: 2026, starCutoffFraction: 0 });
  const assigned = new Set(teamIds.flatMap((t) => assignments[t]));
  assert.ok(assigned.has("rich"), "starCutoffFraction 0 → ingen ekskluderes, heller ikke den dyreste");
  assert.equal(assigned.size, 16);
  assert.equal(leftToMarket.length, 0);
});

test("runStarterSquadAllocation (#1487): generér svag pulje, derive (data-hale), tildel team_id", async () => {
  // 2 hold × CORE_SIZE = 16 startryttere.
  // Fake-generator: stærke stats (80) som SKAL clampes til vinduets hi før insert.
  const fakeGenerate = ({ count }) => ({
    riders: Array.from({ length: count }, (_, i) => ({
      pcm_id: null, firstname: `F${i}`, lastname: `L${i}`,
      birthdate: i % 2 === 0 ? "2006-01-01" : "1999-01-01",
      potentiale: i % 2 === 0 ? 5 : 3,
      ...Object.fromEntries(STAT_KEYS.map((k) => [k, 80])),
      _meta: { age: 20 },
    })),
    coverage: {}, seed: 0,
  });
  const derived = [];
  const fakeDerive = async (_sb, ids) => { derived.push(...ids); };

  const inserted = [];
  const updates = [];
  const supabase = {
    from() {
      let cols = null;
      let inIds = null;
      const api = {
        select(c) { cols = c; return api; },
        is() { return api; },
        eq() { return api; },
        in(_c, ids) { inIds = ids; return api; },
        order() { return api; },
        range() {
          if (cols && cols.includes("firstname")) return Promise.resolve({ data: [], error: null }); // navne-fetch
          if (inIds) {
            return Promise.resolve({
              data: inIds.map((id) => ({ id, birthdate: "2000-01-01", potentiale: 3, base_value: 5000 })),
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
        insert(rows) {
          const start = inserted.length;
          inserted.push(...rows);
          return { select() { return Promise.resolve({ data: rows.map((_, i) => ({ id: `weak-${start + i}` })), error: null }); } };
        },
        update(patch) { return { eq(_c, id) { updates.push({ id, ...patch }); return Promise.resolve({ error: null }); } }; },
      };
      return api;
    },
  };
  const getManagerTeams = async () => [{ id: "t1" }, { id: "t2" }];
  const deps = { generate: fakeGenerate, derive: fakeDerive };

  const dry = await runStarterSquadAllocation(supabase, { dryRun: true, seed: 2026, getManagerTeams, deps });
  assert.equal(dry.teams, 2);
  assert.equal(dry.assigned, 0);
  assert.equal(inserted.length, 0, "dry-run indsætter intet");
  assert.equal(updates.length, 0, "dry-run skriver intet");

  const applied = await runStarterSquadAllocation(supabase, { dryRun: false, seed: 2026, getManagerTeams, deps });
  assert.equal(inserted.length, 2 * STARTER_SQUAD.CORE_SIZE, "16 svage ryttere indsat");
  for (const r of inserted) {
    for (const k of STAT_KEYS) assert.ok(r[k] <= STARTER_POOL_STAT_WINDOW.hi, `${k} ikke clampet`);
  }
  assert.equal(derived.length, 2 * STARTER_SQUAD.CORE_SIZE, "alle nye ryttere derivet (data-hale)");
  assert.equal(applied.assigned, 2 * STARTER_SQUAD.CORE_SIZE);
  // updates rummer nu både team_id-tildelinger (16) og #1563-markør-skrivninger (2).
  const teamIdUpdates = updates.filter((u) => "team_id" in u);
  const markerUpdates = updates.filter((u) => "starter_squad_allocated_at" in u);
  assert.equal(teamIdUpdates.length, 2 * STARTER_SQUAD.CORE_SIZE, "16 team_id-tildelinger");
  assert.ok(teamIdUpdates.every((u) => u.team_id === "t1" || u.team_id === "t2"));
  assert.equal(markerUpdates.length, 2, "#1563: begge hold markeret som start-trup-allokeret");
});

// ── #1560 · allocateStarterSquadForTeam (single-team-bootstrap) ────────────────

test("#1560 hash/seed: deriveTeamSeed er deterministisk + hold-unik", () => {
  assert.equal(hashStringToSeed("abc"), hashStringToSeed("abc"), "samme streng → samme hash");
  assert.notEqual(hashStringToSeed("team-a"), hashStringToSeed("team-b"), "to hold → forskellige hash");
  assert.equal(deriveTeamSeed(2026, "team-a"), deriveTeamSeed(2026, "team-a"), "samme baseSeed+teamId → samme seed");
  assert.notEqual(deriveTeamSeed(2026, "team-a"), deriveTeamSeed(2026, "team-b"), "forskellige hold → forskellige seed");
  assert.ok(Number.isInteger(deriveTeamSeed(2026, "team-a")) && deriveTeamSeed(2026, "team-a") >= 0, "32-bit uint");
});

test("#1560 single-team happy path: præcis CORE_SIZE ryttere med korrekt team_id", async () => {
  const { supabase, store, teams, fakeDerive } = createRidersMock();
  const res = await allocateStarterSquadForTeam(supabase, "new-team-1", {
    seed: 2026, generate: makeFakeGenerate(), derive: fakeDerive,
  });

  assert.equal(res.assigned, STARTER_SQUAD.CORE_SIZE, "8 ryttere tildelt");
  const onTeam = [...store.values()].filter((r) => r.team_id === "new-team-1");
  assert.equal(onTeam.length, STARTER_SQUAD.CORE_SIZE, "8 ryttere har team_id på holdet");
  assert.equal(store.size, STARTER_SQUAD.CORE_SIZE, "kun de 8 nye ryttere blev oprettet");
  assert.ok(teams.get("new-team-1").starter_squad_allocated_at, "markør sat efter allokering (#1563)");
  assert.equal([...store.values()].filter((r) => r.team_id == null).length, 0,
    "ingen orphan-ryttere — insert sætter team_id direkte (#1563)");
  // Alle insertede stats clampet til vinduet (svag pulje).
  for (const r of store.values()) {
    for (const k of STAT_KEYS) {
      assert.ok(r[k] >= STARTER_POOL_STAT_WINDOW.lo && r[k] <= STARTER_POOL_STAT_WINDOW.hi, `${k}=${r[k]} udenfor vindue`);
    }
  }
});

// FORWARD-GUARD (#1560/#1487): den ÆGTE gen-kæde for ÉT hold (8 ryttere) skal give
// svage afledte evner (top ≤25) + trup-styrke i [50,57]. Spejler den eksisterende
// multi-team forward-guard, men for single-team-seedet (deriveTeamSeed).
test("#1560 forward-guard: single-team gen-kæde → top-evne ≤25 + stats i [50,57]", () => {
  const STAT_DRIVEN = VISIBLE_ABILITIES.filter((k) => k !== "tactics" && k !== "aggression");
  const teamSeed = deriveTeamSeed((2026 + 1487) >>> 0, "fwd-guard-team");
  const pool = buildWeakStarterPool({ count: STARTER_SQUAD.CORE_SIZE, seed: teamSeed, referenceYear: 2026 });
  assert.equal(pool.length, STARTER_SQUAD.CORE_SIZE);

  let globalMax = 0;
  for (const r of pool) {
    // Alle clampede stats inde i ejer-vinduet.
    for (const k of STAT_KEYS) {
      assert.ok(r[k] >= STARTER_POOL_STAT_WINDOW.lo && r[k] <= STARTER_POOL_STAT_WINDOW.hi,
        `${k}=${r[k]} udenfor [${STARTER_POOL_STAT_WINDOW.lo},${STARTER_POOL_STAT_WINDOW.hi}]`);
    }
    // Prod-fallback-sti (relaunch/akademi/signup): tomt fysiologi-objekt.
    const abilities = deriveAbilities({}, r, { asOfYear: 2026 });
    globalMax = Math.max(globalMax, ...STAT_DRIVEN.map((k) => abilities[k]));
  }
  assert.ok(globalMax <= 25, `stærkeste styrke-evne ${globalMax} > 25 — single-team-puljen er ikke svag`);
});

test("#1560 determinisme + variation: forskellige hold → forskellige reproducerbare trupper", async () => {
  const generate = makeFakeGenerate();
  // Samme teamId+seed kaldt to gange (fra rene mocks) → identiske inserterede navne.
  const a1 = createRidersMock();
  const a2 = createRidersMock();
  await allocateStarterSquadForTeam(a1.supabase, "team-A", { seed: 2026, generate, derive: a1.fakeDerive });
  await allocateStarterSquadForTeam(a2.supabase, "team-A", { seed: 2026, generate, derive: a2.fakeDerive });
  const names = (store) => [...store.values()].map((r) => `${r.firstname} ${r.lastname}`).sort();
  assert.deepEqual(names(a1.store), names(a2.store), "samme teamId+seed → reproducerbar trup");

  // Forskellige teamId → forskellige trupper (per-hold seed).
  const b = createRidersMock();
  await allocateStarterSquadForTeam(b.supabase, "team-B", { seed: 2026, generate, derive: b.fakeDerive });
  assert.notDeepEqual(names(a1.store), names(b.store), "forskellige hold → forskellige ryttere");
});

test("#1560/#1563 idempotens: kald to gange for samme hold → markør gør andet kald til no-op", async () => {
  const { supabase, store, fakeDerive } = createRidersMock();
  const generate = makeFakeGenerate();
  const first = await allocateStarterSquadForTeam(supabase, "idem-team", { seed: 2026, generate, derive: fakeDerive });
  assert.equal(first.assigned, STARTER_SQUAD.CORE_SIZE);

  const second = await allocateStarterSquadForTeam(supabase, "idem-team", { seed: 2026, generate, derive: fakeDerive });
  assert.equal(second.assigned, 0, "andet kald allokerer intet");
  assert.equal(second.skipped, "already-allocated");
  assert.equal(store.size, STARTER_SQUAD.CORE_SIZE, "stadig kun 8 ryttere — ingen dobbelt-allokering");
  assert.equal([...store.values()].filter((r) => r.team_id === "idem-team").length, STARTER_SQUAD.CORE_SIZE);
});

test("#1563 idempotens: hold med markør sat (fx backfilled relaunch-trup) røres ikke", async () => {
  const { supabase, store, fakeDerive } = createRidersMock({
    seedRiders: [{ id: "existing-1", team_id: "relaunch-team", firstname: "Old", lastname: "Rider" }],
    teamMarkers: { "relaunch-team": { starter_squad_allocated_at: "2026-06-18T00:00:00Z", created_at: "2026-06-18T00:00:00Z" } },
  });
  const res = await allocateStarterSquadForTeam(supabase, "relaunch-team", {
    seed: 2026, generate: makeFakeGenerate(), derive: fakeDerive,
  });
  assert.equal(res.assigned, 0);
  assert.equal(res.skipped, "already-allocated");
  assert.equal(store.size, 1, "ingen nye ryttere oprettet");
});

// ── #1563 · exploit-sikkerhed + self-heal af delvis/fuld bootstrap-fejl ────────

test("#1563 exploit-sikker: markør sat + 0 ryttere (ejer har solgt ned) → INGEN gratis trup", async () => {
  // Et legitimt hold KAN sælge sig under 8 (ingen sælg-guard). Markøren forhindrer
  // at det får en ny gratis start-trup — sandheden er markøren, ikke rytter-antallet.
  const { supabase, store, fakeDerive } = createRidersMock({
    teamMarkers: { "sold-down": { starter_squad_allocated_at: "2026-06-18T00:00:00Z", created_at: "2026-06-18T00:00:00Z" } },
  });
  const res = await allocateStarterSquadForTeam(supabase, "sold-down", {
    seed: 2026, generate: makeFakeGenerate(), derive: fakeDerive,
  });
  assert.equal(res.skipped, "already-allocated");
  assert.equal(res.assigned, 0);
  assert.equal(store.size, 0, "ingen ryttere oprettet til et hold der selv har solgt ned");
});

test("#1563 heal fuld fejl: markør null + 0 ryttere → allokér 8 + sæt markør", async () => {
  const { supabase, store, teams, fakeDerive } = createRidersMock();
  const res = await allocateStarterSquadForTeam(supabase, "stuck-empty", {
    seed: 2026, generate: makeFakeGenerate(), derive: fakeDerive,
  });
  assert.equal(res.assigned, STARTER_SQUAD.CORE_SIZE);
  assert.equal([...store.values()].filter((r) => r.team_id === "stuck-empty").length, STARTER_SQUAD.CORE_SIZE);
  assert.ok(teams.get("stuck-empty").starter_squad_allocated_at, "markør sat efter heal");
});

test("#1563 heal delvis (derive/markør fejlede): markør null + 8 ryttere → re-derive, INGEN nye, markør sat", async () => {
  const seedRiders = Array.from({ length: STARTER_SQUAD.CORE_SIZE }, (_, i) => ({
    id: `pre-${i}`, team_id: "derive-failed", firstname: `F${i}`, lastname: `L${i}`,
  }));
  const { supabase, store, teams, fakeDerive } = createRidersMock({ seedRiders });
  const res = await allocateStarterSquadForTeam(supabase, "derive-failed", {
    seed: 2026, generate: makeFakeGenerate(), derive: fakeDerive,
  });
  assert.equal(res.recovered, "re-derived");
  assert.equal(res.assigned, STARTER_SQUAD.CORE_SIZE);
  assert.equal(store.size, STARTER_SQUAD.CORE_SIZE, "ingen NYE ryttere — de 8 eksisterende re-derives");
  assert.ok(store.get("pre-0").base_value > 0, "fakeDerive kørte (base_value sat)");
  assert.ok(teams.get("derive-failed").starter_squad_allocated_at, "markør sat efter heal");
});

test("#1563 heal delvis-insert: markør null + 3 ryttere → ryd det halve + re-allokér til 8", async () => {
  const seedRiders = Array.from({ length: 3 }, (_, i) => ({
    id: `partial-${i}`, team_id: "partial-team", firstname: `F${i}`, lastname: `L${i}`,
  }));
  const { supabase, store, teams, fakeDerive } = createRidersMock({ seedRiders });
  const res = await allocateStarterSquadForTeam(supabase, "partial-team", {
    seed: 2026, generate: makeFakeGenerate(), derive: fakeDerive,
  });
  assert.equal(res.recovered, "cleaned-partial");
  assert.equal(res.assigned, STARTER_SQUAD.CORE_SIZE);
  assert.equal([...store.values()].filter((r) => r.team_id === "partial-team").length, STARTER_SQUAD.CORE_SIZE);
  assert.equal(store.size, STARTER_SQUAD.CORE_SIZE, "de 3 delvise ryttere ryddet, 8 friske indsat");
  assert.ok(!store.has("partial-0"), "den delvise trup blev ryddet");
  assert.ok(teams.get("partial-team").starter_squad_allocated_at, "markør sat efter heal");
});
