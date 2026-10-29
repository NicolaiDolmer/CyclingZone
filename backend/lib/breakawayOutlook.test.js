// #6912 B: motorens udbrudschance. Rene dele + orkestreringen med en falsk motor.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __resetBreakawayOutlookCache,
  chaseReason,
  computeBreakawayOutlook,
  entriesFingerprint,
  getBreakawayOutlookCached,
  isOutlookRelevantForViewer,
  isValidRaceId,
  loadEntriesFingerprint,
  loadNextStageProfileType,
  oddsFraction,
  OUTLOOK_CACHE_TTL_MS,
  OUTLOOK_ERROR,
  OUTLOOK_ERROR_TTL_MS,
  outlookCacheKey,
  outlookSeedString,
  sampleFromStageResult,
  stageAllowsBreakaway,
  summarizeOutlook,
} from "./breakawayOutlook.js";
import { loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { splitEntrants, sortedStages } from "../scripts/dev/lib/tourScorecard.mjs";

// ── oddsFraction ────────────────────────────────────────────────────────────
test("oddsFraction: 0 sejre er 'under 1 af 10', aldrig 'nul'", () => {
  assert.deepEqual(oddsFraction(0, 40), { under: [1, 10] });
});

test("oddsFraction: alle sejre er 'over 9 af 10'", () => {
  assert.deepEqual(oddsFraction(40, 40), { over: [9, 10] });
});

test("oddsFraction: runder til nærmeste enkle brøk", () => {
  assert.deepEqual(oddsFraction(20, 40), { about: [1, 2] });
  assert.deepEqual(oddsFraction(10, 40), { about: [1, 4] });
  assert.deepEqual(oddsFraction(30, 40), { about: [3, 4] });
  assert.deepEqual(oddsFraction(13, 40), { about: [1, 3] });
  assert.deepEqual(oddsFraction(1, 40), { about: [1, 10] });
});

test("oddsFraction: ugyldigt input → null", () => {
  assert.equal(oddsFraction(1, 0), null);
  assert.equal(oddsFraction(5, 4), null);
  assert.equal(oddsFraction(-1, 4), null);
  assert.equal(oddsFraction(1.5, 4), null);
});

// ── chaseReason ─────────────────────────────────────────────────────────────
const s = (caught, chasingTeams) => ({ known: true, breakawayWin: !caught, caught, chasingTeams });

test("chaseReason: hentes sjældent → nobodyChases", () => {
  assert.deepEqual(chaseReason([s(false, 0), s(false, 0), s(true, 3)]), { kind: "nobodyChases" });
});

test("chaseReason: median antal jagende hold i de hentede kørsler", () => {
  assert.deepEqual(chaseReason([s(true, 1), s(true, 2), s(true, 2)]), { kind: "fewChase" });
  assert.deepEqual(chaseReason([s(true, 3), s(true, 4), s(true, 5), s(false, 0)]), { kind: "manyChase" });
  assert.deepEqual(chaseReason([s(true, 0), s(true, 0)]), { kind: "nobodyChases" });
});

// ── sampleFromStageResult ───────────────────────────────────────────────────
test("sampleFromStageResult: vinderens dom + hold der hentede udbruddet", () => {
  const res = {
    ranked: [{ rider_id: "a", breakaway_win: false }],
    v4Output: { timeline: { events: [
      { type: "breakaway_caught", params: { chasing_team_ids: ["t1", "t2"] } },
      { type: "breakaway_caught", params: { chasing_team_ids: ["t2", "t3"] } },
      { type: "finish" },
    ] } },
  };
  assert.deepEqual(sampleFromStageResult(res), { breakawayWin: false, known: true, caught: true, chasingTeams: 3 });
});

test("sampleFromStageResult: uden dom er udfaldet ukendt", () => {
  assert.equal(sampleFromStageResult({ ranked: [{ rider_id: "a" }] }).known, false);
  assert.equal(sampleFromStageResult(null).known, false);
});

// ── summarizeOutlook ────────────────────────────────────────────────────────
test("summarizeOutlook: ét ukendt udfald → ingen chance (motoren står ikke inde for tallet)", () => {
  assert.deepEqual(summarizeOutlook([s(true, 1), { known: false }]), { available: false, reason: "engine_unsure" });
  assert.deepEqual(summarizeOutlook([]), { available: false, reason: "engine_unsure" });
});

test("summarizeOutlook: brøk + årsag", () => {
  const out = summarizeOutlook([s(false, 0), s(true, 4), s(true, 4), s(true, 3)]);
  assert.deepEqual(out, { available: true, runs: 4, odds: { about: [1, 4] }, chase: { kind: "manyChase" } });
});

// ── computeBreakawayOutlook med falsk motor ────────────────────────────────
const RACE = { id: "race-1", stages: 3, stages_completed: 1, status: "running" };

function fakeEngine({ winsFor = () => false } = {}) {
  const calls = [];
  return {
    calls,
    simulateStage(args) {
      calls.push(args);
      const won = winsFor(args.seedString);
      return {
        ranked: [{ rider_id: "w", breakaway_win: won }],
        v4Output: { timeline: { events: won ? [] : [{ type: "breakaway_caught", params: { chasing_team_ids: ["t1"] } }] } },
      };
    },
  };
}

function harness({ engine = fakeEngine(), profileType = "mountain", rulesRevision = "s5_profiles_v3", engineOn = true } = {}) {
  const seen = {};
  const resolveRaceEngineV4 = async () => (engineOn ? { v4Engine: engine, teamOrderRows: [{ team_id: "secret" }] } : { v4Engine: null, teamOrderRows: [] });
  const runDryStage = async ({ stageIndex, resolveV4Engine }) => {
    seen.stageIndex = stageIndex;
    const resolved = await resolveV4Engine({});
    seen.teamOrderRows = resolved.teamOrderRows;
    if (!resolved.v4Engine) return;
    resolved.v4Engine.simulateStage({ stageNumber: stageIndex + 1, stageProfile: { profile_type: profileType }, rulesRevision, seedString: "REAL-SEED", teamOrderRows: resolved.teamOrderRows });
  };
  return { seen, resolveRaceEngineV4, runDryStage, engine };
}

test("computeBreakawayOutlook: næste etape, egne seeds, ingen private ordrer", async () => {
  const h = harness({ engine: fakeEngine({ winsFor: (seed) => seed.endsWith(":0") || seed.endsWith(":1") }) });
  const out = await computeBreakawayOutlook({ race: RACE, runDryStage: h.runDryStage, resolveRaceEngineV4: h.resolveRaceEngineV4, seeds: 8 });
  assert.equal(h.seen.stageIndex, 1);
  assert.deepEqual(h.seen.teamOrderRows, []);
  assert.ok(h.engine.calls.every((c) => c.seedString !== "REAL-SEED"), "løbets rigtige seed bruges aldrig");
  assert.ok(h.engine.calls.every((c) => c.seedString.startsWith("breakaway-outlook:race-1:2:")));
  assert.deepEqual(out, { available: true, runs: 8, odds: { about: [1, 4] }, chase: { kind: "fewChase" }, stageNumber: 2, profileType: "mountain" });
});

test("computeBreakawayOutlook: gates — motor slukket, gammel revision, tidskørsel, færdigt løb", async () => {
  const off = harness({ engineOn: false });
  assert.equal((await computeBreakawayOutlook({ race: RACE, runDryStage: off.runDryStage, resolveRaceEngineV4: off.resolveRaceEngineV4 })).reason, "engine_off");
  const old = harness({ rulesRevision: "s5_profiles_v2" });
  assert.equal((await computeBreakawayOutlook({ race: RACE, runDryStage: old.runDryStage, resolveRaceEngineV4: old.resolveRaceEngineV4 })).reason, "old_rules");
  const itt = harness({ profileType: "itt" });
  assert.equal((await computeBreakawayOutlook({ race: RACE, runDryStage: itt.runDryStage, resolveRaceEngineV4: itt.resolveRaceEngineV4 })).reason, "no_breakaway");
  const done = harness();
  assert.equal((await computeBreakawayOutlook({ race: { ...RACE, stages_completed: 3 }, runDryStage: done.runDryStage, resolveRaceEngineV4: done.resolveRaceEngineV4 })).reason, "race_done");
  assert.equal((await computeBreakawayOutlook({ race: { ...RACE, status: "completed" }, runDryStage: done.runDryStage, resolveRaceEngineV4: done.resolveRaceEngineV4 })).reason, "race_done");
});

test("outlookSeedString: kendt form, adskilt fra løbets seed-navnerum", () => {
  assert.equal(outlookSeedString("r", 2, 5), "breakaway-outlook:r:2:5");
});

// ── cache + single-flight ───────────────────────────────────────────────────
test("getBreakawayOutlookCached: samtidige kald deler én beregning; ny etape = ny nøgle", async () => {
  __resetBreakawayOutlookCache();
  let n = 0;
  const compute = async () => { n += 1; return { available: true, n }; };
  const [a, b] = await Promise.all([
    getBreakawayOutlookCached({ now: () => 0, race: RACE, compute }),
    getBreakawayOutlookCached({ now: () => 0, race: RACE, compute }),
  ]);
  assert.equal(n, 1);
  assert.deepEqual(a, b);
  await getBreakawayOutlookCached({ now: () => 0, race: RACE, compute });
  assert.equal(n, 1, "inden for TTL genbruges svaret");
  await getBreakawayOutlookCached({ now: () => 0, race: { ...RACE, stages_completed: 2 }, compute });
  assert.equal(n, 2);
  assert.notEqual(outlookCacheKey(RACE), outlookCacheKey({ ...RACE, stages_completed: 2 }));
});

test("getBreakawayOutlookCached: prognoser for forskellige løb kører én ad gangen", async () => {
  __resetBreakawayOutlookCache();
  let running = 0;
  let maxRunning = 0;
  const compute = async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setImmediate(r));
    running -= 1;
    return { available: true };
  };
  await Promise.all(["a", "b", "c"].map((id) => getBreakawayOutlookCached({ now: () => 0, race: { id, stages_completed: 0 }, compute })));
  assert.equal(maxRunning, 1);
});

test("getBreakawayOutlookCached: fuld kø → busy uden cache, næste kald prøver igen", async () => {
  __resetBreakawayOutlookCache();
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = () => gate.then(() => ({ available: true }));
  const first = getBreakawayOutlookCached({ now: () => 0, race: { id: "q1", stages_completed: 0 }, compute: slow, maxQueued: 1 });
  const busy = await getBreakawayOutlookCached({ now: () => 0, race: { id: "q2", stages_completed: 0 }, compute: slow, maxQueued: 1 });
  assert.deepEqual(busy, { available: false, reason: "busy" });
  release();
  await first;
  await new Promise((r) => setImmediate(r));
  const again = await getBreakawayOutlookCached({ now: () => 0, race: { id: "q2", stages_completed: 0 }, compute: async () => ({ available: true, retried: true }), maxQueued: 1 });
  assert.deepEqual(again, { available: true, retried: true });
});

test("getBreakawayOutlookCached: udløbet TTL beregner forfra", async () => {
  __resetBreakawayOutlookCache();
  let t = 0;
  let n = 0;
  const compute = async () => { n += 1; return { n }; };
  await getBreakawayOutlookCached({ race: RACE, compute, now: () => t, ttlMs: 10 });
  t = 11;
  await getBreakawayOutlookCached({ race: RACE, compute, now: () => t, ttlMs: 10 });
  assert.equal(n, 2);
});

test("getBreakawayOutlookCached: fejl huskes i 5 min; kun første kalder får undtagelsen", async () => {
  __resetBreakawayOutlookCache();
  let t = 0;
  let attempts = 0;
  const broken = async () => { attempts += 1; throw new Error("boom"); };
  const [first, joined] = await Promise.allSettled([
    getBreakawayOutlookCached({ now: () => t, race: RACE, compute: broken }),
    getBreakawayOutlookCached({ now: () => t, race: RACE, compute: broken }),
  ]);
  assert.equal(first.status, "rejected", "første kalder rapporterer fejlen");
  assert.deepEqual(joined, { status: "fulfilled", value: OUTLOOK_ERROR }, "samtidig kalder får fejl-svaret, ikke undtagelsen");
  t = OUTLOOK_ERROR_TTL_MS - 1;
  assert.deepEqual(await getBreakawayOutlookCached({ now: () => t, race: RACE, compute: broken }), OUTLOOK_ERROR);
  assert.equal(attempts, 1, "inden for 5 min: ingen ny dry-run");
  t = OUTLOOK_ERROR_TTL_MS + 1;
  let n = 0;
  const ok = await getBreakawayOutlookCached({ now: () => t, race: RACE, compute: async () => { n += 1; return { available: true }; } });
  assert.deepEqual(ok, { available: true });
  assert.equal(n, 1, "efter 5 min prøves igen");
  assert.ok(OUTLOOK_ERROR_TTL_MS < OUTLOOK_CACHE_TTL_MS);
});

test("getBreakawayOutlookCached: ændret startfelt (fingeraftryk) giver ny beregning før etape 1", async () => {
  __resetBreakawayOutlookCache();
  let n = 0;
  const compute = async () => { n += 1; return { available: true, n }; };
  const before = { ...RACE, stages_completed: 0 };
  await getBreakawayOutlookCached({ now: () => 0, race: before, entriesKey: "fp-a", compute });
  await getBreakawayOutlookCached({ now: () => 0, race: before, entriesKey: "fp-a", compute });
  assert.equal(n, 1);
  await getBreakawayOutlookCached({ now: () => 0, race: before, entriesKey: "fp-b", compute });
  assert.equal(n, 2);
  assert.notEqual(outlookCacheKey(before, "fp-a"), outlookCacheKey(before, "fp-b"));
});

// ── entriesFingerprint ──────────────────────────────────────────────────────
test("entriesFingerprint: rækkefølge-uafhængigt; ny rytter, fjernet rytter og ny rolle ændrer aftrykket", () => {
  const rows = [
    { team_id: "A", rider_id: "r1", race_role: "captain" },
    { team_id: "A", rider_id: "r2", race_role: "helper" },
    { team_id: "B", rider_id: "r3", race_role: "hunter" },
  ];
  const base = entriesFingerprint(rows);
  assert.equal(entriesFingerprint([...rows].reverse()), base);
  assert.notEqual(entriesFingerprint([...rows, { team_id: "B", rider_id: "r4", race_role: "helper" }]), base);
  assert.notEqual(entriesFingerprint(rows.slice(1)), base);
  assert.notEqual(entriesFingerprint([{ ...rows[0], rider_id: "r9" }, rows[1], rows[2]]), base, "byttet rytter, samme antal");
  assert.notEqual(entriesFingerprint([{ ...rows[0], race_role: "helper" }, { ...rows[1], race_role: "captain" }, rows[2]]), base, "byttet rolle");
  assert.equal(entriesFingerprint([]), entriesFingerprint(null));
});

test("loadEntriesFingerprint: læser hele startfeltet (pagineret) for løbet", async () => {
  const seen = [];
  const rows = [{ team_id: "A", rider_id: "r1", race_role: "captain" }];
  const db = {
    from(table) {
      const api = {
        select(cols) { seen.push({ table, cols }); return api; },
        eq(col, val) { seen.push({ eq: [col, val] }); return api; },
        order() { return api; },
        range() { return Promise.resolve({ data: rows, error: null }); },
      };
      return api;
    },
  };
  assert.equal(await loadEntriesFingerprint({ supabase: db, raceId: "race-f" }), entriesFingerprint(rows));
  assert.deepEqual(seen[0], { table: "race_entries", cols: "team_id, rider_id, race_role" });
  assert.deepEqual(seen[1], { eq: ["race_id", "race-f"] });
});

test("nl/races.json: jægerboksens etape-etiket bruger 'Etappe' som resten af filen", () => {
  const nl = JSON.parse(readFileSync(new URL("../../frontend/public/locales/nl/races.json", import.meta.url), "utf8"));
  assert.equal(nl.racehub.hunterExplainer.outlook.stage, "Etappe {stage}");
});

// ── rene gates ──────────────────────────────────────────────────────────────
test("isValidRaceId: kun UUID'er", () => {
  assert.equal(isValidRaceId("3f2b1c9a-1234-4abc-9def-0123456789ab"), true);
  assert.equal(isValidRaceId("nope"), false);
  assert.equal(isValidRaceId("3f2b1c9a-1234-4abc-9def-0123456789ab' or 1=1"), false);
  assert.equal(isValidRaceId(undefined), false);
});

test("stageAllowsBreakaway: tidskørsler og manglende profil har intet udbrud", () => {
  for (const p of ["itt", "itt_hilly", "ttt", null, undefined, ""]) assert.equal(stageAllowsBreakaway(p), false, String(p));
  for (const p of ["flat", "hilly", "mountain"]) assert.equal(stageAllowsBreakaway(p), true, p);
});

// ── isOutlookRelevantForViewer med falsk Supabase ──────────────────────────
function relevanceDb({ seasonStatus = "active", entry = null } = {}) {
  const queries = [];
  return {
    queries,
    from(table) {
      queries.push(table);
      const api = {
        select() { return api; }, eq() { return api; }, limit() { return api; },
        maybeSingle() {
          if (table === "seasons") return Promise.resolve({ data: seasonStatus ? { id: "s1", status: seasonStatus } : null, error: null });
          if (table === "race_entries") return Promise.resolve({ data: entry, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
}
const REL_RACE = { id: "race-r", season_id: "s1", stages: 3, stages_completed: 0, status: "scheduled", league_division_id: "div-1", squad: "senior" };
const TEAM_IN = { id: "team-1", league_division_id: "div-1" };
const TEAM_OUT = { id: "team-2", league_division_id: "div-2" };
const NOW = new Date("2026-10-29T12:00:00Z");
const unlocked = async () => false;
const locked = async () => true;
const rel = (supabase, race, team, isLineupLocked = unlocked) => isOutlookRelevantForViewer({ supabase, race, team, now: NOW, isLineupLocked });

test("isOutlookRelevantForViewer: hold i puljen før trup-låsen er relevant uden tilmeldings-opslag", async () => {
  const db = relevanceDb();
  let lockArgs = null;
  assert.equal(await rel(db, REL_RACE, TEAM_IN, async (args) => { lockArgs = args; return false; }), true);
  assert.deepEqual(db.queries, ["seasons"]);
  assert.equal(lockArgs.now, NOW);
  assert.equal(lockArgs.race.id, REL_RACE.id);
});

test("isOutlookRelevantForViewer: hold uden for puljen kun relevant med en tilmelding", async () => {
  assert.equal(await rel(relevanceDb(), REL_RACE, TEAM_OUT), false);
  assert.equal(await rel(relevanceDb({ entry: { rider_id: "x" } }), REL_RACE, TEAM_OUT), true);
});

test("isOutlookRelevantForViewer: låst trup eller startet løb kræver tilmelding, også i puljen", async () => {
  assert.equal(await rel(relevanceDb(), REL_RACE, TEAM_IN, locked), false, "låst før etape 1, ikke tilmeldt");
  assert.equal(await rel(relevanceDb({ entry: { rider_id: "x" } }), REL_RACE, TEAM_IN, locked), true, "låst, men tilmeldt");
  const started = { ...REL_RACE, stages_completed: 1, status: "running" };
  assert.equal(await rel(relevanceDb(), started, TEAM_IN), false);
  assert.equal(await rel(relevanceDb({ entry: { rider_id: "x" } }), started, TEAM_IN), true);
});

test("isOutlookRelevantForViewer: ikke-aktiv sæson, færdigt løb eller intet hold → ikke relevant, færdigt løb uden opslag", async () => {
  assert.equal(await rel(relevanceDb({ seasonStatus: "upcoming" }), REL_RACE, TEAM_IN), false);
  assert.equal(await rel(relevanceDb({ seasonStatus: null }), REL_RACE, TEAM_IN), false);
  const done = relevanceDb();
  assert.equal(await rel(done, { ...REL_RACE, status: "completed" }, TEAM_IN), false);
  assert.equal(await rel(done, { ...REL_RACE, stages_completed: 3 }, TEAM_IN), false);
  assert.deepEqual(done.queries, [], "færdigt løb: ingen DB-opslag");
  const noTeam = relevanceDb();
  assert.equal(await rel(noTeam, REL_RACE, null), false);
  assert.deepEqual(noTeam.queries, []);
});

test("loadNextStageProfileType: næste etapes profil efter stages_completed", async () => {
  const db = {
    from() {
      const api = { select() { return api; }, eq() { return api; }, order() { return api; }, limit() {
        return Promise.resolve({ data: [{ stage_number: 2, profile_type: "itt" }, { stage_number: 1, profile_type: "flat" }], error: null });
      } };
      return api;
    },
  };
  assert.equal(await loadNextStageProfileType({ supabase: db, race: { id: "r", stages_completed: 0 } }), "flat");
  assert.equal(await loadNextStageProfileType({ supabase: db, race: { id: "r", stages_completed: 1 } }), "itt");
  assert.equal(await loadNextStageProfileType({ supabase: db, race: { id: "r", stages_completed: 2 } }), null);
});

// ── Den rigtige v4-motor: udfaldets form (vinderens dom + fangst-events) læses korrekt ──
test("computeBreakawayOutlook: rigtig v4-motor på et anonymiseret felt giver et kendt udfald i hver kørsel", async () => {
  const data = JSON.parse(readFileSync(new URL("../scripts/baselines/giro-field-6088-2026-10-02.json", import.meta.url), "utf8"));
  const profile = sortedStages(data).find((p) => p.profile_type === "mountain");
  const { entrants } = splitEntrants(data);
  const engine = await loadRaceEngineV4();
  const out = await computeBreakawayOutlook({
    race: { id: "outlook-real", stages: 1, stages_completed: 0, status: "scheduled" },
    seeds: 4,
    resolveRaceEngineV4: async () => ({ v4Engine: engine, teamOrderRows: [] }),
    runDryStage: async ({ resolveV4Engine }) => {
      const { v4Engine } = await resolveV4Engine({});
      v4Engine.simulateStage({
        entrants, stageProfile: profile, seedString: "REAL", stageNumber: profile.stage_number,
        teamOrderRows: [], isStageRace: false, raceStages: [profile], squad: null, rulesRevision: "s5_profiles_v3",
      });
    },
  });
  assert.equal(out.available, true, JSON.stringify(out));
  assert.equal(out.runs, 4);
  assert.ok(out.odds && (out.odds.about || out.odds.under || out.odds.over));
  assert.ok(["nobodyChases", "fewChase", "manyChase"].includes(out.chase.kind));
  assert.equal("stageNumber" in out, false, "endagsløb: intet etapenummer");
});
