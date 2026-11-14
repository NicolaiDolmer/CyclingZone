// #7535 · Handlinger-menuens to nye kald: assistenten over mange loeb (laeser kun) og afmeld over
// mange loeb (alt eller intet). Al I/O er styrede svar (deps), og uret er fast, saa hver regel
// proeves uden database: hvad springes over, hvad bindes paa tvaers af loebene i samme kald, og
// at intet skrives, naar blot ét loeb afvises.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLANNING_BULK_MAX,
  parseRaceIds,
  parseOverrides,
  fillOpenPlaces7535,
  lockedWindowsFor,
  orderForAssistant,
  proposeAssistantSquads7535,
  withdrawRacesBulk7535,
  planningBulkRoute7535,
} from "./planningBulkActions7535.js";
import { selectionSizeForRace } from "./raceAutopick.js";

const NOW = new Date("2026-11-14T10:00:00.000Z");
const TEAM = { id: "team-a", league_division_id: 1 };

function race(id, { day = 1, len = 1, status = "scheduled", pool = 1, cls = "Class1" } = {}) {
  return {
    id,
    name: id,
    race_class: cls,
    status,
    stages: len,
    stages_completed: 0,
    league_division_id: pool,
    season_id: "s5",
    squad: null,
    scheduled_for: `2026-11-${String(14 + day).padStart(2, "0")}T11:00:00.000Z`,
    window: { start: day, end: day + len - 1 },
  };
}

const SIZE = selectionSizeForRace(race("x")).max;
const RIDERS = Array.from({ length: 20 }, (_, i) => `r${String(i + 1).padStart(2, "0")}`);

const overlaps = (a, b) => !!a && !!b && a.start <= b.end && b.start <= a.end;

/** Styrede deps: en lille kalender, holdets gemte entries og en assistent der vaelger i fast raekkefoelge. */
function fakeDeps({ races, entries = {}, withdrawn = [], locked = [], lockedAtWrite = null, trainOnly = [], riders = RIDERS } = {}) {
  const byId = new Map(races.map((r) => [r.id, r]));
  const calls = { pick: [], upsert: [], loadLocked: 0 };
  const dbOthersFor = (raceId) =>
    Object.entries(entries)
      .filter(([id, rows]) => id !== raceId && rows.length && !withdrawn.includes(id))
      .map(([id, rows]) => ({ raceId: id, window: byId.get(id)?.window ?? null, riderIds: rows.map((r) => r.rider_id) }));
  const deps = {
    clock: () => NOW,
    async loadRaces(ids) {
      return new Map(ids.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)]));
    },
    async loadWithdrawnIds() {
      return new Set(withdrawn);
    },
    async loadLockedIds() {
      calls.loadLocked += 1;
      if (calls.loadLocked > 1 && lockedAtWrite) return new Set(lockedAtWrite);
      return new Set(locked);
    },
    async loadTeamEntries(ids) {
      return new Map(ids.filter((id) => entries[id]).map((id) => [id, entries[id]]));
    },
    async loadWindows(ids) {
      return new Map(ids.map((id) => [id, byId.get(id)?.window ?? null]));
    },
    async isTrainOnly(r) {
      return trainOnly.includes(r.id);
    },
    async loadAssistantContext({ race: r }) {
      return {
        stages: [],
        thisWindow: r.window,
        dbOthers: dbOthersFor(r.id),
        strategy: null,
        candidateRiders: riders.map((id) => ({ rider_id: id, abilities: {}, fatigue: 0 })),
      };
    },
    // Assistenten: de foerste ledige ryttere, ikke bundet i et overlappende loeb; den foerste er kaptajn.
    pick({ candidateRiders, race: r, thisWindow, lockedWindows }) {
      calls.pick.push({ raceId: r.id, lockedWindows });
      const busy = new Set(lockedWindows.filter((w) => overlaps(w.window, thisWindow)).flatMap((w) => w.riderIds));
      return candidateRiders
        .filter((c) => !busy.has(c.rider_id))
        .slice(0, SIZE)
        .map((c, i) => ({ rider_id: c.rider_id, race_role: i === 0 ? "captain" : "helper" }));
    },
    async upsertWithdrawals(rows) {
      calls.upsert.push(rows);
    },
  };
  return { deps, calls };
}

// ── Kaldets form ────────────────────────────────────────────────────────────

test("listen af loeb: tom, dublet og over loftet afvises med masse-gemmets egne koder", () => {
  assert.equal(parseRaceIds([]).status, 400);
  assert.equal(parseRaceIds(["a", "a"]).body.error, "selection_duplicate_race");
  const tooMany = parseRaceIds(Array.from({ length: PLANNING_BULK_MAX + 1 }, (_, i) => `r${i}`));
  assert.deepEqual(tooMany.body, { error: "selection_bulk_too_large", max: PLANNING_BULK_MAX });
  assert.deepEqual(parseRaceIds(["a", "b"]), { ok: true, ids: ["a", "b"] });
});

test("kladden i kaldet: kun loeb -> [{ rider_id, race_role }] godtages", () => {
  assert.equal(parseOverrides({ a: [{ rider_id: 5 }] }).ok, false);
  assert.equal(parseOverrides(["a"]).ok, false);
  const ok = parseOverrides({ a: [{ rider_id: "r1", race_role: "captain" }, { rider_id: "r2" }], b: [] });
  assert.deepEqual([...ok.overrides], [["a", [{ rider_id: "r1", race_role: "captain" }, { rider_id: "r2", race_role: null }]], ["b", []]]);
});

// ── De tomme pladser ────────────────────────────────────────────────────────

test("fyld: en tom trup faar assistentens trup uaendret", () => {
  const picks = [{ rider_id: "r1", race_role: "captain" }, { rider_id: "r2", race_role: "helper" }];
  assert.deepEqual(fillOpenPlaces7535({ own: [], picks, sizeMax: 6 }), picks);
});

test("fyld: egne ryttere og roller bliver, nye kommer ind som hjaelpere op til feltet", () => {
  const own = [{ rider_id: "r9", race_role: "captain" }, { rider_id: "r8", race_role: "hunter" }];
  const picks = ["r1", "r9", "r2", "r3", "r4", "r5"].map((id, i) => ({ rider_id: id, race_role: i === 0 ? "captain" : "helper" }));
  const out = fillOpenPlaces7535({ own, picks, sizeMax: 5 });
  assert.deepEqual(out, [
    { rider_id: "r9", race_role: "captain" },
    { rider_id: "r8", race_role: "hunter" },
    { rider_id: "r1", race_role: "helper" },
    { rider_id: "r2", race_role: "helper" },
    { rider_id: "r3", race_role: "helper" },
  ]);
});

test("fyld: mangler truppen en kaptajn, faar assistentens foerste nye rytter rollen", () => {
  const out = fillOpenPlaces7535({ own: [{ rider_id: "r9", race_role: null }], picks: [{ rider_id: "r1", race_role: "captain" }, { rider_id: "r2", race_role: "helper" }], sizeMax: 3 });
  assert.deepEqual(out.map((e) => e.race_role), [null, "captain", "helper"]);
  assert.equal(out.filter((e) => e.race_role === "captain").length, 1);
});

test("binding: kaldets egne loeb og kladden erstatter det gemte, loebet selv er ude", () => {
  const dbOthers = [
    { raceId: "a", window: { start: 1, end: 1 }, riderIds: ["r1"] },
    { raceId: "b", window: { start: 2, end: 2 }, riderIds: ["r2"] },
  ];
  const chained = new Map([["b", { window: { start: 2, end: 2 }, riderIds: [] }], ["c", { window: { start: 3, end: 3 }, riderIds: ["r3"] }]]);
  assert.deepEqual(lockedWindowsFor({ raceId: "a", dbOthers, chained }), [{ raceId: "c", window: { start: 3, end: 3 }, riderIds: ["r3"] }]);
});

test("raekkefoelge: kalenderen afgoer, et tidligt loeb vaelger foerst", () => {
  assert.deepEqual(orderForAssistant([race("late", { day: 5 }), race("early", { day: 1 })]).map((r) => r.id), ["early", "late"]);
});

// ── Assistenten over mange loeb ─────────────────────────────────────────────

test("assistent: hvert omfang giver et forslag pr. loeb med tomme pladser, intet skrives", async () => {
  const races = [race("a", { day: 1 }), race("b", { day: 3 }), race("c", { day: 5 })];
  const { deps, calls } = fakeDeps({ races, entries: { b: [{ rider_id: "r20", race_role: "captain" }] } });
  const out = await proposeAssistantSquads7535({ team: TEAM, body: { race_ids: ["a", "b", "c"] }, now: NOW, deps });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.proposals.map((p) => p.race_id), ["a", "b", "c"]);
  for (const p of out.body.proposals) assert.equal(p.entries.length, SIZE);
  // Egne valg bliver: r20 er stadig kaptajn i b, og assistenten satte kun de tomme pladser ind.
  const b = out.body.proposals.find((p) => p.race_id === "b");
  assert.deepEqual(b.entries[0], { rider_id: "r20", race_role: "captain" });
  assert.equal(b.added, SIZE - 1);
  assert.equal(calls.upsert.length, 0, "forslaget skriver aldrig");
});

test("assistent: et afmeldt loeb faar aldrig en trup, heller ikke med en kladde i kaldet", async () => {
  const races = [race("a"), race("out", { day: 2 })];
  const { deps, calls } = fakeDeps({ races, withdrawn: ["out"] });
  const out = await proposeAssistantSquads7535({ team: TEAM, body: { race_ids: ["a", "out"], overrides: { out: [] } }, now: NOW, deps });
  assert.deepEqual(out.body.proposals.map((p) => p.race_id), ["a"]);
  assert.deepEqual(out.body.skipped, [{ race_id: "out", reason: "selection_withdrawn" }]);
  assert.ok(!calls.pick.some((c) => c.raceId === "out"), "assistenten spoerges slet ikke for det afmeldte loeb");
});

test("assistent: startede, lukkede, fulde, forkert pulje og Train only springes over med grund", async () => {
  const full = Array.from({ length: SIZE }, (_, i) => ({ rider_id: RIDERS[i], race_role: i === 0 ? "captain" : null }));
  const races = [
    race("started", { day: 1 }),
    race("done", { day: 2, status: "completed" }),
    race("pool", { day: 3, pool: 2 }),
    race("youth", { day: 4 }),
    race("full", { day: 5 }),
  ];
  const { deps } = fakeDeps({ races, locked: ["started"], trainOnly: ["youth"], entries: { full } });
  const out = await proposeAssistantSquads7535({ team: TEAM, body: { race_ids: races.map((r) => r.id) }, now: NOW, deps });
  assert.deepEqual(out.body.proposals, []);
  assert.deepEqual(Object.fromEntries(out.body.skipped.map((s) => [s.race_id, s.reason])), {
    started: "selection_race_started",
    done: "selection_race_not_open",
    pool: "selection_wrong_pool",
    youth: "selection_train_only",
    full: "selection_full",
  });
});

test("assistent: to loeb paa samme loebsdage i samme kald faar aldrig samme rytter", async () => {
  const races = [race("tour", { day: 1, len: 4 }), race("gp", { day: 3 }), race("later", { day: 9 })];
  const { deps } = fakeDeps({ races });
  const out = await proposeAssistantSquads7535({ team: TEAM, body: { race_ids: ["gp", "tour", "later"] }, now: NOW, deps });
  const ids = (id) => new Set(out.body.proposals.find((p) => p.race_id === id).entries.map((e) => e.rider_id));
  const tour = ids("tour");
  assert.ok(![...ids("gp")].some((r) => tour.has(r)), "gp deler loebsdage med tour");
  // Et loeb paa andre dage maa gerne bruge de samme ryttere.
  assert.ok([...ids("later")].some((r) => tour.has(r)));
});

test("assistent: et loeb ryddet i kladden binder ingen, et gemt loeb uden for kaldet binder", async () => {
  const saved = Array.from({ length: SIZE }, (_, i) => ({ rider_id: RIDERS[i], race_role: i === 0 ? "captain" : null }));
  const races = [race("busy", { day: 2 }), race("target", { day: 2 })];
  const kept = await proposeAssistantSquads7535({ team: TEAM, body: { race_ids: ["target"] }, now: NOW, deps: fakeDeps({ races, entries: { busy: saved } }).deps });
  const keptIds = kept.body.proposals[0].entries.map((e) => e.rider_id);
  assert.ok(!keptIds.some((id) => saved.some((s) => s.rider_id === id)), "de gemte ryttere er optaget");
  const cleared = await proposeAssistantSquads7535({ team: TEAM, body: { race_ids: ["target"], overrides: { busy: [] } }, now: NOW, deps: fakeDeps({ races, entries: { busy: saved } }).deps });
  assert.equal(cleared.body.proposals[0].entries[0].rider_id, RIDERS[0], "ryddet i kladden: rytterne er frie igen");
});

test("assistent: ukendt loeb afviser hele kaldet", async () => {
  const { deps } = fakeDeps({ races: [race("a")] });
  const out = await proposeAssistantSquads7535({ team: TEAM, body: { race_ids: ["a", "ghost"] }, now: NOW, deps });
  assert.deepEqual(out, { status: 404, body: { error: "race_not_found", race_id: "ghost" } });
});

// ── Afmeld over mange loeb: alt eller intet ─────────────────────────────────

test("afmeld: alle loeb skrives i ét kald", async () => {
  const races = [race("a"), race("b", { day: 2 }), race("c", { day: 3 })];
  const { deps, calls } = fakeDeps({ races });
  const out = await withdrawRacesBulk7535({ team: TEAM, body: { race_ids: ["a", "b", "c"] }, now: NOW, deps });
  assert.equal(out.status, 200);
  assert.equal(out.invalidate, true);
  assert.equal(calls.upsert.length, 1, "én skrivning, ikke én pr. loeb");
  assert.deepEqual(calls.upsert[0], ["a", "b", "c"].map((id) => ({ race_id: id, team_id: TEAM.id })));
});

test("afmeld: ét startet, lukket eller fremmed loeb afviser hele kaldet, og intet skrives", async () => {
  for (const [setup, error, raceId] of [
    [{ locked: ["b"] }, "selection_race_started", "b"],
    [{ status: "b" }, "selection_race_not_open", "b"],
    [{ pool: "b" }, "selection_wrong_pool", "b"],
  ]) {
    const races = [race("a"), race("b", { day: 2, status: setup.status === "b" ? "completed" : "scheduled", pool: setup.pool === "b" ? 2 : 1 })];
    const { deps, calls } = fakeDeps({ races, locked: setup.locked ?? [] });
    const out = await withdrawRacesBulk7535({ team: TEAM, body: { race_ids: ["a", "b"] }, now: NOW, deps });
    assert.deepEqual(out, { status: 409, body: { error, race_id: raceId } });
    assert.equal(calls.upsert.length, 0, `${error}: intet maa vaere skrevet`);
  }
});

test("afmeld: et loeb der starter mellem kontrol og skrivning afviser alt", async () => {
  const { deps, calls } = fakeDeps({ races: [race("a"), race("b", { day: 2 })], lockedAtWrite: ["a"] });
  const out = await withdrawRacesBulk7535({ team: TEAM, body: { race_ids: ["a", "b"] }, now: NOW, deps });
  assert.deepEqual(out, { status: 409, body: { error: "selection_race_started", race_id: "a" } });
  assert.equal(calls.upsert.length, 0);
});

test("afmeld: dry_run kontrollerer uden at skrive", async () => {
  const { deps, calls } = fakeDeps({ races: [race("a")] });
  const out = await withdrawRacesBulk7535({ team: TEAM, body: { race_ids: ["a"], dry_run: true }, now: NOW, deps });
  assert.deepEqual(out, { status: 200, body: { ok: true, checked: 1 } });
  assert.equal(calls.upsert.length, 0);
});

// ── Express-indgangen ───────────────────────────────────────────────────────

function fakeRes() {
  return {
    code: 0,
    payload: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(p) {
      this.payload = p;
      return this;
    },
  };
}

test("indgang: hold kraeves, motorens kontakt skal vaere taendt, fejl bliver en 500 med rapport", async () => {
  const reported = [];
  const invalidated = [];
  const ctx = {
    supabase: {},
    isViewerBetaTester: async () => false,
    captureException: (e) => reported.push(e),
    invalidateNamespace: (n) => invalidated.push(n),
    makeDeps: () => fakeDeps({ races: [race("a")] }).deps,
  };
  const noTeam = fakeRes();
  await planningBulkRoute7535(withdrawRacesBulk7535, { ...ctx, engineEnabled: async () => true })({ body: {} }, noTeam);
  assert.equal(noTeam.code, 400);

  const off = fakeRes();
  await planningBulkRoute7535(withdrawRacesBulk7535, { ...ctx, engineEnabled: async () => false })({ team: TEAM, body: { race_ids: ["a"] } }, off);
  assert.deepEqual([off.code, off.payload], [409, { error: "selection_flag_disabled" }]);

  const ok = fakeRes();
  await planningBulkRoute7535(withdrawRacesBulk7535, { ...ctx, engineEnabled: async () => true })({ team: TEAM, body: { race_ids: ["a"] } }, ok);
  assert.equal(ok.code, 200);
  assert.deepEqual(invalidated, ["races", "calendar"]);

  const boom = fakeRes();
  const failing = async () => {
    throw new Error("db nede");
  };
  await planningBulkRoute7535(failing, { ...ctx, engineEnabled: async () => true })({ team: TEAM, body: {} }, boom);
  assert.equal(boom.code, 500);
  assert.equal(reported.length, 1);
});
