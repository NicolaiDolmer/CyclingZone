import test from "node:test";
import assert from "node:assert/strict";
import {
  loadTeamSeasonEntries, raceIdsMissingWindow, withEntryRaceWindows, writeRegeneratedLineups,
} from "./raceHubAutofill.js";
import { assignTeamAcrossRaces, findCrossUnitMoves } from "./raceEntryGenerator.js";
import { lockedWindowsFromEntries } from "./raceDistribution.js";
import { raceBindingWindow } from "./raceBinding.js";

// ── Fake race_entries-tabel med rider-day-invarianten (#3420) som DB-backstop ──────
// dayByRace: race_id → [game_day]. En rytter må kun stå i ÉT løb pr. game_day, præcis
// som no_rider_double_booking_day (UNIQUE rider_id, season_id, game_day).
function makeFakeSupabase({ entries = [], dayByRace = {}, failInsert = null } = {}) {
  const state = { entries: entries.map((r) => ({ ...r })) };
  const violation = { code: "23505", message: 'duplicate key value violates unique constraint "no_rider_double_booking_day"' };
  const sharesDay = (a, b) => (dayByRace[a] || []).some((d) => (dayByRace[b] || []).includes(d));

  function write(rows, { ignoreDuplicates = false } = {}) {
    if (failInsert && failInsert(rows)) return { error: { code: "XX000", message: "injected failure" } };
    const next = state.entries.map((r) => ({ ...r }));
    for (const row of rows) {
      if (next.some((r) => r.race_id === row.race_id && r.rider_id === row.rider_id)) {
        if (ignoreDuplicates) continue;
        return { error: { code: "23505", message: 'duplicate key value violates unique constraint "race_entries_pkey"' } };
      }
      if (next.some((r) => r.rider_id === row.rider_id && r.race_id !== row.race_id && sharesDay(r.race_id, row.race_id))) {
        return { error: violation }; // hele statementet afvises
      }
      next.push({ ...row });
    }
    state.entries = next;
    return { error: null };
  }

  function deleteBuilder() {
    const filters = [];
    const b = {
      eq(col, v) { filters.push((r) => r[col] === v); return b; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return b; },
      then(resolve, reject) {
        state.entries = state.entries.filter((r) => !filters.every((f) => f(r)));
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return b;
  }

  return {
    state,
    from(table) {
      assert.equal(table, "race_entries");
      return {
        delete: () => deleteBuilder(),
        insert: async (rows) => write(rows),
        upsert: async (rows, opts) => write(rows, opts),
      };
    },
  };
}

const raceIdsOf = (state, riderId) => state.entries.filter((e) => e.rider_id === riderId).map((e) => e.race_id).sort();
const e = (race_id, rider_id, race_role = "helper", is_auto_filled = true) => ({ race_id, rider_id, team_id: "T", race_role, is_auto_filled });
const race = (id, extra = {}) => ({ id, status: "scheduled", stages_completed: 0, ...extra });

// Den gamle løkke i api.js (før #5789): delete-så-insert pr. løb, i target-rækkefølge.
async function naiveWrite({ supabase, target, picksByRace }) {
  for (const r of target) {
    const picks = picksByRace[r.id];
    await supabase.from("race_entries").delete().eq("race_id", r.id).eq("team_id", "T");
    const { error } = await supabase.from("race_entries").insert(
      picks.map((p) => ({ race_id: r.id, rider_id: p.rider_id, team_id: "T", race_role: p.race_role, is_auto_filled: true })),
    );
    if (error) return error;
  }
  return null;
}

// ── findCrossUnitMoves (delt prædikat med entry-generatoren, #5693) ────────────────
test("findCrossUnitMoves: kun ryttere der slettes ét sted OG indsættes et ANDET sted", () => {
  const { deleteRidersByRace, targetRaceByRider } = findCrossUnitMoves([
    { race_id: "A", toDelete: ["x", "keep-out"], toInsert: ["y"] },
    { race_id: "B", toDelete: ["y"], toInsert: ["x", "fresh"] },
  ]);
  assert.deepEqual([...deleteRidersByRace.entries()], [["B", ["y"]], ["A", ["x"]]]);
  assert.equal(targetRaceByRider.get("x"), "B");
  assert.equal(targetRaceByRider.get("y"), "A");
  assert.equal(targetRaceByRider.has("fresh"), false);
  assert.equal(targetRaceByRider.has("keep-out"), false);
});

test("findCrossUnitMoves: slettes og indsættes i SAMME enhed er ikke en flytning", () => {
  const { deleteRidersByRace } = findCrossUnitMoves([{ race_id: "A", toDelete: ["x"], toInsert: ["x"] }]);
  assert.equal(deleteRidersByRace.size, 0);
});

// ── Hul 1: skrive-rækkefølgen (prod-formen, CYCLINGZONE-4P 22/9) ──────────────────
// To seniorløb i holdets pulje samme løbsdag, begge targets. Rytter X står i det SENE
// løb (S2) og assistenten flytter ham til det TIDLIGE (S1), som skrives først.
function sameDayMove() {
  const dayByRace = { S1: [25], S2: [25] };
  const entries = [e("S1", "a", "captain"), e("S1", "b"), e("S2", "x", "captain"), e("S2", "c")];
  const target = [race("S1"), race("S2")];
  const picksByRace = {
    S1: [{ rider_id: "x", race_role: "captain" }, { rider_id: "a", race_role: "helper" }],
    S2: [{ rider_id: "b", race_role: "captain" }, { rider_id: "c", race_role: "helper" }],
  };
  return { dayByRace, entries, target, picksByRace };
}

test("#5789 repro: den gamle løkke rammer no_rider_double_booking_day når en rytter flyttes til et tidligere skrevet løb", async () => {
  const { dayByRace, entries, target, picksByRace } = sameDayMove();
  const supabase = makeFakeSupabase({ entries, dayByRace });
  const err = await naiveWrite({ supabase, target, picksByRace });
  assert.ok(err && /no_rider_double_booking_day/.test(err.message), "fake'en reproducerer Sentry-fejlen");
});

test("#5789: writeRegeneratedLineups slipper den flyttede rytter først og skriver begge løb", async () => {
  const { dayByRace, entries, target, picksByRace } = sameDayMove();
  const supabase = makeFakeSupabase({ entries, dayByRace });
  const res = await writeRegeneratedLineups({ supabase, teamId: "T", target, picksByRace, existingEntries: entries });
  assert.equal(res.regenerated, 2);
  assert.equal(res.released, 2, "x slippes i S2, b slippes i S1");
  assert.deepEqual(raceIdsOf(supabase.state, "x"), ["S1"]);
  assert.deepEqual(raceIdsOf(supabase.state, "b"), ["S2"]);
  for (const rid of ["a", "b", "c", "x"]) assert.equal(raceIdsOf(supabase.state, rid).length, 1, `${rid} står i præcis ét løb`);
  const rows = supabase.state.entries.filter((r) => r.race_id === "S1");
  assert.ok(rows.every((r) => r.is_auto_filled === true && r.auto_filled_source === "manager_auto"));
});

test("#5789: fuld gensidig swap mellem to same-day-løb lykkes", async () => {
  const dayByRace = { S1: [25], S2: [25] };
  const entries = [e("S1", "x", "captain"), e("S2", "y", "captain")];
  const supabase = makeFakeSupabase({ entries, dayByRace });
  const picksByRace = { S1: [{ rider_id: "y", race_role: "captain" }], S2: [{ rider_id: "x", race_role: "captain" }] };
  const res = await writeRegeneratedLineups({ supabase, teamId: "T", target: [race("S1"), race("S2")], picksByRace, existingEntries: entries });
  assert.equal(res.regenerated, 2);
  assert.deepEqual(raceIdsOf(supabase.state, "x"), ["S2"]);
  assert.deepEqual(raceIdsOf(supabase.state, "y"), ["S1"]);
});

test("#5789: fejler mål-løbets insert, genskabes den sluppede rytter i sit urørte kilde-løb", async () => {
  const { dayByRace, entries, target, picksByRace } = sameDayMove();
  const supabase = makeFakeSupabase({
    entries, dayByRace, failInsert: (rows) => rows.some((r) => r.race_id === "S1"),
  });
  await assert.rejects(
    writeRegeneratedLineups({ supabase, teamId: "T", target, picksByRace, existingEntries: entries }),
    /race_entries insert \(S1\): injected failure/,
  );
  // S1 blev slettet og fejlede (eksisterende adfærd: fejlen er synlig + retry-bar).
  // S2 nåede aldrig at blive skrevet om → x står der igen med sin gamle rolle.
  const x = supabase.state.entries.find((r) => r.rider_id === "x");
  assert.equal(x?.race_id, "S2", "x forsvandt ikke fra begge løb");
  assert.equal(x.race_role, "captain");
  assert.deepEqual(supabase.state.entries.filter((r) => r.race_id === "S2").map((r) => r.rider_id).sort(), ["c", "x"]);
});

test("#5789: en ÆGTE konflikt med et ikke-regenereret løb giver stadig den navngivne selection_rider_bound", async () => {
  const dayByRace = { S1: [25], OTHER: [25] };
  const entries = [e("OTHER", "x", "captain", false)];
  const supabase = makeFakeSupabase({ entries, dayByRace });
  await assert.rejects(
    writeRegeneratedLineups({
      supabase, teamId: "T", target: [race("S1")],
      picksByRace: { S1: [{ rider_id: "x", race_role: "captain" }] }, existingEntries: entries,
    }),
    (err) => err.code === "selection_rider_bound",
  );
});

test("#5789: frosne løb og løb uden picks røres ikke", async () => {
  const entries = [e("F", "x", "captain"), e("EMPTY", "y", "captain")];
  const supabase = makeFakeSupabase({ entries, dayByRace: { F: [1], EMPTY: [2] } });
  const res = await writeRegeneratedLineups({
    supabase, teamId: "T",
    target: [race("F", { stages_completed: 1 }), race("EMPTY")],
    picksByRace: { F: [{ rider_id: "z", race_role: "captain" }], EMPTY: [] },
    existingEntries: entries,
  });
  assert.equal(res.regenerated, 0);
  assert.deepEqual(supabase.state.entries.map((r) => r.rider_id).sort(), ["x", "y"]);
});

// ── Hul 2: låsning på tværs af trupper (S4: U23-/juniorløb) ─────────────────────────
const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const flat = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
const riders = Array.from({ length: 8 }, (_, i) => ({ rider_id: `r${i}`, abilities: ab(80 - i * 3), fatigue: 0 }));

test("#5789 repro: en entry i et U23-løb samme løbsdag låser ikke rytteren når kun seniorløb har vinduer", () => {
  // r0 (holdets bedste) står allerede i et U23-løb på løbsdag 25.
  const entries = [e("U23", "r0")];
  const seniorWindows = new Map([["SEN", raceBindingWindow([{ race_id: "SEN", game_day: 25 }])]]);
  const locks = lockedWindowsFromEntries({ entries, windowByRace: seniorWindows, excludeRaceIds: new Set(["SEN"]) });
  const picks = assignTeamAcrossRaces({
    riders, lockedWindows: locks,
    races: [{ race_id: "SEN", window: seniorWindows.get("SEN"), stages: [flat], sizeRule: { min: 6, max: 6 } }],
  });
  assert.ok(picks.SEN.some((p) => p.rider_id === "r0"), "den gamle låsning dobbeltbooker r0");
});

test("#5789: med vinduer for ALLE holdets løb låses rytteren på U23-løbets løbsdag", () => {
  const entries = [e("U23", "r0"), e("JUN", "r1"), e("NOSCHED", "r2")];
  const seniorWindows = new Map([["SEN", raceBindingWindow([{ race_id: "SEN", game_day: 25 }])]]);
  const extra = raceIdsMissingWindow({ entries, windowByRace: seniorWindows });
  assert.deepEqual(extra.sort(), ["JUN", "NOSCHED", "U23"]);
  const windowByRace = withEntryRaceWindows({
    windowByRace: seniorWindows,
    scheduleRows: [
      { race_id: "U23", game_day: 25, scheduled_at: "2026-09-28T10:00:00Z" },
      { race_id: "JUN", game_day: 26, scheduled_at: "2026-09-28T16:00:00Z" },
      { race_id: "SEN", game_day: 99, scheduled_at: "2026-09-28T10:00:00Z" }, // eksisterende nøgle røres ikke
    ],
  });
  assert.deepEqual(windowByRace.get("SEN").days, [25]);
  assert.equal(windowByRace.has("NOSCHED"), false, "løb uden schedule får intet vindue (DB binder det heller ikke)");
  const locks = lockedWindowsFromEntries({ entries, windowByRace, excludeRaceIds: new Set(["SEN"]) });
  const picks = assignTeamAcrossRaces({
    riders, lockedWindows: locks,
    races: [{ race_id: "SEN", window: windowByRace.get("SEN"), stages: [flat], sizeRule: { min: 6, max: 6 } }],
  });
  const ids = picks.SEN.map((p) => p.rider_id);
  assert.ok(!ids.includes("r0"), "r0 er bundet i U23-løbet samme løbsdag");
  assert.ok(ids.includes("r1"), "r1's juniorløb ligger på en anden løbsdag og binder ikke");
  assert.equal(ids.length, 6);
});

// ── loadTeamSeasonEntries: sæson-scopet + pagineret ────────────────────────────────
test("#5789: loadTeamSeasonEntries paginerer forbi 1000 rækker og filtrerer på sæsonen", async () => {
  const all = Array.from({ length: 1001 }, (_, i) => ({
    race_id: `R${String(i).padStart(4, "0")}`, rider_id: "x", is_auto_filled: true, race_role: "helper", races: {},
  }));
  const seen = [];
  const supabase = {
    from(table) {
      assert.equal(table, "race_entries");
      const q = {
        select(cols) { seen.push(["select", cols]); return q; },
        eq(col, v) { seen.push(["eq", col, v]); return q; },
        order() { return q; },
        range(from, to) { return Promise.resolve({ data: all.slice(from, to + 1), error: null }); },
      };
      return q;
    },
  };
  const rows = await loadTeamSeasonEntries({ supabase, teamId: "T", seasonId: "S3" });
  assert.equal(rows.length, 1001);
  assert.equal("races" in rows[0], false, "join-kolonnen strippes");
  assert.ok(seen.some(([k, col, v]) => k === "eq" && col === "races.season_id" && v === "S3"));
  assert.ok(seen.some(([k, col, v]) => k === "eq" && col === "team_id" && v === "T"));
});
