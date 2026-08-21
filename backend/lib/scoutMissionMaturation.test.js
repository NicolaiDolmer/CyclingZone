// #3997 — mission-modning: modenhed = created_at + mission.days×24t (elapsed
// real tid), claim-first pr. assignment (ingen delt hold-dags-mutex). Se
// scoutMissionMaturation.js for den fulde baggrund/motivation.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultLoadCandidates, completeDueMissionAssignments } from "./scoutMissionMaturation.js";
import { missionReadyAt } from "./scoutEngine.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Supabase-mock: chainable query-builders (.eq/.is/.not/.lte/.maybeSingle) OG en
// betinget update-kæde (.eq×N.select()) der spejler den ægte claim-first UPDATE.
function makeMockSupabase({ assignments = [], scoutActions = [], candidates = [], offeredIntake = [], seasons = [] } = {}) {
  const state = {
    assignments: JSON.parse(JSON.stringify(assignments)),
    scoutActions: JSON.parse(JSON.stringify(scoutActions)),
    candidates,
    offeredIntake: JSON.parse(JSON.stringify(offeredIntake)),
    seasons: JSON.parse(JSON.stringify(seasons)),
    inserts: { scout_actions: [] },
    updates: [],
  };

  function selectBuilder(rows, { supportsLte = false } = {}) {
    const filters = [];
    const notNullFilters = [];
    let lteVal = null;
    const matched = () => {
      let out = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
      if (notNullFilters.length) out = out.filter((r) => notNullFilters.every((c) => r[c] != null));
      if (supportsLte && lteVal) out = out.filter((r) => r[lteVal[0]] != null && r[lteVal[0]] <= lteVal[1]);
      return out;
    };
    const b = {
      select() { return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      is(col, val) { filters.push([col, val]); return b; },
      not(col, op, val) { if (op === "is" && val === null) notNullFilters.push(col); return b; },
      lte(col, val) { lteVal = [col, val]; return b; },
      // #4058: resolveSeasonNumber's seasons-opslag bruger .maybeSingle() —
      // ingen match → null (aldrig et gæt), præcis 1 match → den række.
      maybeSingle() {
        const out = matched();
        return Promise.resolve({ data: out[0] ? JSON.parse(JSON.stringify(out[0])) : null, error: null });
      },
      then(resolve) {
        return Promise.resolve({ data: JSON.parse(JSON.stringify(matched())), error: null }).then(resolve);
      },
    };
    return b;
  }

  function updateBuilder(payload) {
    const filters = [];
    let wantSelect = false;
    const b = {
      eq(col, val) { filters.push([col, val]); return b; },
      select() { wantSelect = true; return b; },
      then(resolve) {
        const hit = state.assignments.filter((r) => filters.every(([c, v]) => r[c] === v));
        for (const row of hit) Object.assign(row, payload);
        state.updates.push({ filters: [...filters], payload, count: hit.length });
        return Promise.resolve({ data: wantSelect ? hit.map((r) => ({ id: r.id })) : null, error: null }).then(resolve);
      },
    };
    return b;
  }

  return {
    state,
    from(table) {
      if (table === "scout_assignments") {
        return {
          select: () => selectBuilder(state.assignments, { supportsLte: true }),
          update: (payload) => updateBuilder(payload),
        };
      }
      if (table === "scout_actions") {
        return {
          insert(payload) {
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const row of rows) {
              state.scoutActions.push({ ...row });
              state.inserts.scout_actions.push(row);
            }
            return { then(resolve) { return resolve({ error: null }); } };
          },
        };
      }
      if (table === "riders") {
        return { select: () => selectBuilder(state.candidates), not: () => selectBuilder(state.candidates) };
      }
      if (table === "academy_intake") {
        return { select: () => selectBuilder(state.offeredIntake) };
      }
      if (table === "seasons") {
        return { select: () => selectBuilder(state.seasons) }; // #4058
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const riderRow = (overrides) => ({
  id: "r1", potentiale: 3, birthdate: "2000-01-01", nationality_code: "DK",
  team_id: null, pending_team_id: null, is_retired: false, owner_is_ai: false, team: null, ...overrides,
});

describe("defaultLoadCandidates (#2581, flyttet fra scoutSweep.js #3997)", () => {
  it("ekskluderer ryttere med et uafklaret ('offered') akademi-intake-tilbud", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1" }), riderRow({ id: "r2" })],
      offeredIntake: [{ rider_id: "r1", status: "offered" }],
    });
    const candidates = await defaultLoadCandidates(supabase);
    assert.deepEqual(candidates.map((c) => c.id), ["r2"]);
  });

  it("free_agents (default): ekskluderer ryttere med et team_id sat", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1", team_id: "team-9" }), riderRow({ id: "r2", team_id: null })],
    });
    const candidates = await defaultLoadCandidates(supabase);
    assert.deepEqual(candidates.map((c) => c.id), ["r2"]);
  });

  it("other_teams: inkluderer KUN ryttere MED team_id sat, ownerTeamId = rytterens faktiske hold", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1", team_id: "team-9" }), riderRow({ id: "r2", team_id: null })],
    });
    const candidates = await defaultLoadCandidates(supabase, "other_teams");
    assert.deepEqual(candidates.map((c) => c.id), ["r1"]);
    assert.equal(candidates.find((c) => c.id === "r1").ownerTeamId, "team-9");
  });

  it("mapper primary_type til primaryType (#3657 ryttertype-targeting)", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1", primary_type: "climber" })],
    });
    const candidates = await defaultLoadCandidates(supabase);
    assert.equal(candidates.find((c) => c.id === "r1").primaryType, "climber");
  });

  // #4058: alderen SKAL bruge sæson-alderen (ageForSeason, LAUNCH_REFERENCE_YEAR
  // 2026 + (seasonNumber-1) − birthYear), aldrig wall-clock. jeppeks bug (20/8,
  // sæson 2 aktiv): en rytter født 2003 blev regnet som 23 år (wall-clock,
  // currentYear=2026) og slap gennem U23-filteret (<=23) — reelt er sæson-2-
  // alderen 24 (2027-2003). SQL-bevis i #4058: 64 shortlist-rækker med denne
  // præcise lækage.
  it("#4058: sæson 2 — rytter født 2003 er 24 år (2027-2003), IKKE 23 (wall-clock-bug)", async () => {
    const supabase = makeMockSupabase({ candidates: [riderRow({ id: "r1", birthdate: "2003-06-17" })] });
    const candidates = await defaultLoadCandidates(supabase, "free_agents", 2);
    assert.equal(candidates.find((c) => c.id === "r1").age, 24);
  });

  it("#4058: sæson 3 — samme rytter (født 2003) er 25 år (2028-2003), IKKE 23", async () => {
    const supabase = makeMockSupabase({ candidates: [riderRow({ id: "r1", birthdate: "2003-06-17" })] });
    const candidates = await defaultLoadCandidates(supabase, "free_agents", 3);
    assert.equal(candidates.find((c) => c.id === "r1").age, 25);
  });

  it("#4058: sæson 1 (launch) — født 2003 er 23 år (2026-2003) — matcher wall-clock-tallet KUN i launch-året", async () => {
    const supabase = makeMockSupabase({ candidates: [riderRow({ id: "r1", birthdate: "2003-06-17" })] });
    const candidates = await defaultLoadCandidates(supabase, "free_agents", 1);
    assert.equal(candidates.find((c) => c.id === "r1").age, 23);
  });

  it("#4058: manglende seasonNumber → age null (aldrig et wall-clock-gæt)", async () => {
    const supabase = makeMockSupabase({ candidates: [riderRow({ id: "r1", birthdate: "2003-06-17" })] });
    const candidates = await defaultLoadCandidates(supabase);
    assert.equal(candidates.find((c) => c.id === "r1").age, null);
  });
});

function missionAssignment(overrides = {}) {
  return {
    id: "m1", team_id: "team-1", kind: "mission", status: "active",
    mission_criteria: { scope: "division", value: "div-1" }, season_id: "season-1",
    created_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

const CANDIDATES = Array.from({ length: 10 }, (_, i) => ({
  id: `rider-${i}`, potentiale: 1 + i / 2, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true,
}));

// Letvægts-scout-stub: undgår at binde disse claim-logik-tests til
// scoutAssignmentService.getScoutState's fulde kald-graf (team_staff m.fl.) —
// selve scout-opslaget dækkes i scoutAssignmentService.test.js.
const STUB_GET_SCOUT = async () => ({ overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true });
function complete(opts) {
  return completeDueMissionAssignments({ getScout: STUB_GET_SCOUT, ...opts });
}

describe("completeDueMissionAssignments (#3997)", () => {
  it("modner en due mission: claim + gratis L1-rapport på hele shortlisten + status→completed", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z"); // præcis 24t efter created_at
    const supabase = makeMockSupabase({ assignments: [missionAssignment()], candidates: CANDIDATES });
    const result = await complete({ supabase, now, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(result, { completed: 1 });
    assert.equal(supabase.state.assignments[0].status, "completed");
    const res = supabase.state.assignments[0].result;
    assert.ok(res.shortlist.length >= 3 && res.shortlist.length <= 5);
    assert.equal(supabase.state.inserts.scout_actions.length, res.shortlist.length);
  });

  it("rører IKKE en mission der endnu ikke er due", async () => {
    const now = new Date("2026-08-02T08:59:59.999Z"); // 1 ms FØR 24t
    const supabase = makeMockSupabase({ assignments: [missionAssignment()], candidates: CANDIDATES });
    const result = await complete({ supabase, now, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(result, { completed: 0 });
    assert.equal(supabase.state.assignments[0].status, "active");
    assert.equal(supabase.state.inserts.scout_actions.length, 0);
  });

  // #3997 grænsetilfælde: en mission sendt 21:59 dansk tid (før den gamle
  // kl.22-gate) og en sendt 22:01 (efter) skal modne EFTER PRÆCIS SAMME regel
  // nu — ingen af dem er længere afhængige af klokkeslættet for afsendelse.
  it("grænsetilfælde: mission sendt 21:59 CEST modner ~24t senere, uafhængigt af den gamle kl.22-gate", async () => {
    const sentAt = "2026-07-10T19:59:00.000Z"; // 21:59 CEST (UTC+2)
    const supabase = makeMockSupabase({ assignments: [missionAssignment({ id: "m-2159", created_at: sentAt })], candidates: CANDIDATES });
    const justBefore = new Date(Date.parse(sentAt) + DAY_MS - 1000);
    const justAfter = new Date(Date.parse(sentAt) + DAY_MS + 1000);
    const before = await complete({ supabase, now: justBefore, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(before, { completed: 0 });
    const after = await complete({ supabase, now: justAfter, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(after, { completed: 1 });
  });

  it("grænsetilfælde: mission sendt 22:01 CEST modner ~24t senere (IKKE 46t via den gamle nattesweep)", async () => {
    const sentAt = "2026-07-10T20:01:00.000Z"; // 22:01 CEST
    const supabase = makeMockSupabase({ assignments: [missionAssignment({ id: "m-2201", created_at: sentAt })], candidates: CANDIDATES });
    // Under den GAMLE regel ville denne mission tidligst modne ved NÆSTE dags
    // kl.22-sweep — op til 46 timer efter afsendelse. Under den nye regel er
    // den due 24t efter, uanset klokkeslæt.
    const at25h = new Date(Date.parse(sentAt) + 25 * 60 * 60 * 1000);
    const result = await complete({ supabase, now: at25h, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(result, { completed: 1 });
  });

  it("flerdages: en 2-dages mission modner IKKE efter 24t, men efter 48t", async () => {
    const sentAt = "2026-08-01T09:00:00.000Z";
    const supabase = makeMockSupabase({ assignments: [missionAssignment({ created_at: sentAt })], candidates: CANDIDATES });
    const after24h = new Date(Date.parse(sentAt) + DAY_MS + 1000);
    const notYet = await complete({ supabase, now: after24h, days: 2, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(notYet, { completed: 0 });
    const after48h = new Date(Date.parse(sentAt) + 2 * DAY_MS + 1000);
    const due = await complete({ supabase, now: after48h, days: 2, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(due, { completed: 1 });
  });

  // #3997: DST-skift (Europe/Copenhagen skifter CET→CEST 2026-03-29 02:00 lokal
  // = 01:00 UTC). Modenheden regnes i rene elapsed-millisekunder (missionReadyAt,
  // scoutEngine.js — samme princip som targetReadyAt), IKKE i "kalenderdage", så
  // den er upåvirket af at Danmarks UTC-offset ændrer sig midt i vinduet.
  it("DST-skift (forårs-spring, CET→CEST 2026-03-29): modner præcis 24t efter, ikke 23 eller 25", async () => {
    const sentAt = "2026-03-28T10:00:00.000Z"; // 11:00 CET, dagen FØR skiftet
    const readyAt = missionReadyAt(sentAt, 1);
    assert.equal(readyAt.toISOString(), "2026-03-29T10:00:00.000Z"); // eksakt +86.400.000 ms

    const supabase = makeMockSupabase({ assignments: [missionAssignment({ created_at: sentAt })], candidates: CANDIDATES });
    const justBefore = new Date(readyAt.getTime() - 1000);
    const justAfter = new Date(readyAt.getTime() + 1000);
    const before = await complete({ supabase, now: justBefore, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(before, { completed: 0 });
    const after = await complete({ supabase, now: justAfter, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(after, { completed: 1 });
  });

  it("DST-skift (efterårs-fald, CEST→CET 2026-10-25): modner præcis 24t efter, ikke 23 eller 25", async () => {
    const sentAt = "2026-10-24T10:00:00.000Z";
    const readyAt = missionReadyAt(sentAt, 1);
    assert.equal(readyAt.toISOString(), "2026-10-25T10:00:00.000Z");

    const supabase = makeMockSupabase({ assignments: [missionAssignment({ created_at: sentAt })], candidates: CANDIDATES });
    const justBefore = new Date(readyAt.getTime() - 1000);
    const justAfter = new Date(readyAt.getTime() + 1000);
    const before = await complete({ supabase, now: justBefore, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(before, { completed: 0 });
    const after = await complete({ supabase, now: justAfter, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(after, { completed: 1 });
  });

  // #3997 kerne-fund: FØR blokerede scout_sweep_runs' hold-dags-mutex den ANDEN
  // mission for samme hold samme dag. Nu er claimet PR ASSIGNMENT — begge modner.
  it("to missioner for SAMME hold, begge due samme dag: BEGGE fuldføres (den gamle hold-dags-mutex er væk)", async () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const supabase = makeMockSupabase({
      assignments: [
        missionAssignment({ id: "m-a", created_at: "2026-08-01T08:00:00.000Z" }),
        missionAssignment({ id: "m-b", created_at: "2026-08-01T10:00:00.000Z" }),
      ],
      candidates: CANDIDATES,
    });
    const result = await complete({ supabase, now, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(result, { completed: 2 });
    assert.equal(supabase.state.assignments[0].status, "completed");
    assert.equal(supabase.state.assignments[1].status, "completed");
  });

  it("IDEMPOTENS: to kørsler i træk fuldfører kun én gang (claim-first — 0 rækker ramt anden gang)", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const supabase = makeMockSupabase({ assignments: [missionAssignment()], candidates: CANDIDATES });
    const first = await complete({ supabase, now, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(first, { completed: 1 });
    const insertsAfterFirst = supabase.state.inserts.scout_actions.length;

    const second = await complete({ supabase, now, loadCandidates: async () => CANDIDATES });
    assert.deepEqual(second, { completed: 0 }); // status er nu 'completed' → matcher ikke længere status='active'-selectet
    assert.equal(supabase.state.inserts.scout_actions.length, insertsAfterFirst); // ingen ekstra rapport
  });

  it("mission uden matchende kandidater: stadig completed med tom shortlist, ingen scout_actions", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const supabase = makeMockSupabase({
      assignments: [missionAssignment({ mission_criteria: { scope: "division", value: "no-such-div" } })],
      candidates: [],
    });
    const result = await complete({ supabase, now, loadCandidates: async () => [] });
    assert.deepEqual(result, { completed: 1 });
    assert.deepEqual(supabase.state.assignments[0].result, { shortlist: [], top_rider_id: null });
    assert.equal(supabase.state.inserts.scout_actions.length, 0);
  });

  it("ét hold/mission's fejl stopper ikke en anden mission", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const supabase = makeMockSupabase({
      assignments: [
        missionAssignment({ id: "m-bad", team_id: "team-1" }),
        missionAssignment({ id: "m-good", team_id: "team-2" }),
      ],
      candidates: CANDIDATES,
    });
    let calls = 0;
    const loadCandidates = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return CANDIDATES;
    };
    const result = await complete({ supabase, now, loadCandidates });
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 1);
  });

  it("#2945 notify(): kaldes med den fuldførte assignment + result (shortlist)", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const supabase = makeMockSupabase({ assignments: [missionAssignment()], candidates: CANDIDATES });
    const calls = [];
    const notify = async (args) => { calls.push(args); return { delivered: true }; };
    const result = await complete({ supabase, now, loadCandidates: async () => CANDIDATES, notify });
    assert.deepEqual(result, { completed: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assignment.id, "m1");
    assert.equal(calls[0].assignment.status, "completed");
    assert.ok(calls[0].assignment.result.shortlist.length >= 3);
  });

  it("en fejlende notify isoleres af per-assignment try/catch (kaster ikke videre) — status er allerede sat", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const supabase = makeMockSupabase({ assignments: [missionAssignment()], candidates: CANDIDATES });
    const notify = async () => { throw new Error("boom"); };
    const result = await complete({ supabase, now, loadCandidates: async () => CANDIDATES, notify });
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 1);
    // Claimet (status→completed) SKETE allerede FØR notify kaldes — kun
    // notify-fejlen tælles, rapporten er reelt klar i DB'en.
    assert.equal(supabase.state.assignments[0].status, "completed");
  });

  // #2644 del 2: bruger den ÆGTE defaultLoadCandidates (ikke en injiceret stub)
  // så targetPool-filtreringen (free_agents = team_id IS NULL) faktisk øves —
  // en injiceret loadCandidates-stub ville ignorere targetPool helt.
  it("bagudkompatibel targetPool: mangler på mission_criteria (gammel assignment) → free_agents-default", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const candidates = [
      riderRow({ id: "free-1", team_id: null, team: { league_division_id: "div-1" } }),
      riderRow({ id: "owned-1", team_id: "team-9", team: { league_division_id: "div-1" } }),
    ];
    const supabase = makeMockSupabase({
      assignments: [missionAssignment({ mission_criteria: { scope: "division", value: "div-1" } })], // ingen targetPool
      candidates,
    });
    const result = await complete({ supabase, now }); // ingen loadCandidates-override → default bruges
    assert.deepEqual(result, { completed: 1 });
    assert.deepEqual(supabase.state.assignments[0].result.shortlist, ["free-1"]);
  });
});

// #4058 del 1 — end-to-end: en U23-missions kandidat-alder SKAL følge den
// AKTIVE sæsons nummer (assignment.season_id → seasons.number), ikke wall-clock.
// Bruger den ÆGTE defaultLoadCandidates (ingen loadCandidates-override), samme
// begrundelse som "bagudkompatibel targetPool"-testen ovenfor.
describe("completeDueMissionAssignments — sæson-korrekt U23-alder (#4058)", () => {
  it("sæson 2: 2003-rytter (24 år) EKSKLUDERES af U23, 2004-rytter (23 år) INKLUDERES", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const candidates = [
      riderRow({ id: "too-old-24", birthdate: "2003-06-17" }),
      riderRow({ id: "just-u23-23", birthdate: "2004-06-17" }),
    ];
    const supabase = makeMockSupabase({
      assignments: [missionAssignment({ mission_criteria: { scope: "u23" }, season_id: "season-2" })],
      candidates,
      seasons: [{ id: "season-2", number: 2, status: "active" }],
    });
    const result = await complete({ supabase, now });
    assert.deepEqual(result, { completed: 1 });
    assert.deepEqual(supabase.state.assignments[0].result.shortlist, ["just-u23-23"]);
  });

  it("sæson 3: 2004-rytter (24 år) EKSKLUDERES af U23, 2005-rytter (23 år) INKLUDERES", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const candidates = [
      riderRow({ id: "too-old-24", birthdate: "2004-06-17" }),
      riderRow({ id: "just-u23-23", birthdate: "2005-06-17" }),
    ];
    const supabase = makeMockSupabase({
      assignments: [missionAssignment({ mission_criteria: { scope: "u23" }, season_id: "season-3" })],
      candidates,
      seasons: [{ id: "season-3", number: 3, status: "active" }],
    });
    const result = await complete({ supabase, now });
    assert.deepEqual(result, { completed: 1 });
    assert.deepEqual(supabase.state.assignments[0].result.shortlist, ["just-u23-23"]);
  });

  it("bagudkompatibel: assignment uden season_id falder tilbage til den AKTIVE sæson", async () => {
    const now = new Date("2026-08-02T09:00:00.000Z");
    const candidates = [
      riderRow({ id: "too-old-24", birthdate: "2003-06-17" }),
      riderRow({ id: "just-u23-23", birthdate: "2004-06-17" }),
    ];
    const supabase = makeMockSupabase({
      assignments: [missionAssignment({ mission_criteria: { scope: "u23" }, season_id: null })],
      candidates,
      seasons: [{ id: "season-2", number: 2, status: "active" }],
    });
    const result = await complete({ supabase, now });
    assert.deepEqual(result, { completed: 1 });
    assert.deepEqual(supabase.state.assignments[0].result.shortlist, ["just-u23-23"]);
  });
});
