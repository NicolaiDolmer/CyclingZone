// #6739 (ejer-beslutning A 24/10, N = 4): mangler et hold ryttere ved løbsstart, FORDI
// ryttere kører et andet løb på startdagen (overlap, fx sidste etape af et andet
// etapeløb), starter holdet med de frie ryttere, mindst 4. Minimum 6 gælder uændret
// alle andre dage og af alle andre grunde.
// Filter-aware mock som raceRunnerInjuryStartFloor.test.js. Startdagen er løbsdag 10;
// "busy" ryttere står i et andet løb samme dag (binding), "spentSel" er udtagne ryttere
// der allerede har kørt et andet løb samme løbsdag (find_spent_race_days).

import test from "node:test";
import assert from "node:assert/strict";
import { loadEntrantsForRace } from "./raceRunner.js";

function makeFilterAwareSupabase(canned = {}) {
  function from(table) {
    const preds = [];
    const b = {
      select() { return b; },
      order() { return b; },
      or() { return b; },
      is() { return b; },
      limit() { return b; },
      gte(col, val) { preds.push((r) => r[col] != null && r[col] >= val); return b; },
      eq(col, val) { preds.push((r) => r[col] === val); return b; },
      neq(col, val) { preds.push((r) => r[col] !== val); return b; },
      in(col, vals) { preds.push((r) => vals.includes(r[col])); return b; },
      insert() { return Promise.resolve({ error: null }); },
      maybeSingle() {
        const rows = (canned[table] || []).filter((r) => preds.every((p) => p(r)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() { return b.maybeSingle(); },
      range(a, z) {
        const rows = (canned[table] || []).filter((r) => preds.every((p) => p(r)));
        return Promise.resolve({ data: rows.slice(a, z + 1), error: null });
      },
      then(resolve, reject) {
        const rows = (canned[table] || []).filter((r) => preds.every((p) => p(r)));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  const rpc = (name, args) => Promise.resolve(name === "find_spent_race_days"
    ? { data: (args.p_rider_ids || []).filter((id) => (canned.spent || []).includes(id)).map((rider_id) => ({ rider_id, race_id: "race-other", game_day: canned.spentDay ?? 10 })), error: null }
    : { error: null });
  return { from, rpc };
}

const ABIL = { sprint: 60, climbing: 60, time_trial: 60, one_day: 60, gc: 60, hills: 60, cobbles: 60, aggression: 60 };
// AGENTS 16: fast dag injiceres i loadEntrantsForRace (today); skaden løber til 30/10.
const TODAY = "2026-10-28";
const INJURED_UNTIL = "2026-10-30";
const RACE = { id: "race-a", season_id: "s1", race_type: "stage_race", stages: 3 };
const STAGES = [{ stage_number: 1, profile_type: "hilly", demand_vector: { hilly: 1 } }];
// Etapeløbet kører løbsdag 10-12; det andet løb ligger på `otherDay` (default startdagen).
const SCHEDULE = [10, 11, 12].map((game_day, i) => ({ race_id: RACE.id, stage_number: i + 1, game_day, scheduled_at: `2026-10-${28 + i}T15:00:00Z` }));

// Hold: { entered, injured, spentSel, free, busy, ai }. Rækkefølge pr. hold:
// udtagne (de første `injured` skadede, de næste `spentSel` brugt), så frie, så busy.
function canned(teams, { otherDay = 10, spentDay = 10 } = {}) {
  const out = {
    race_entries: [], riders: [], rider_derived_abilities: [], rider_condition: [], teams: [], race_withdrawals: [],
    race_stage_schedule: [...SCHEDULE, { race_id: "race-other", stage_number: 5, game_day: otherDay, scheduled_at: "2026-10-28T12:00:00Z" }],
    races: [{ id: RACE.id, season_id: "s1" }, { id: "race-other", season_id: "s1" }],
  };
  const spent = [];
  for (const [teamId, { entered = 0, injured = 0, spentSel = 0, free = 0, busy = 0, ai = false }] of Object.entries(teams)) {
    out.teams.push({ id: teamId, name: teamId, is_test_account: false, is_frozen: false, is_ai: ai, user_id: ai ? null : `u-${teamId}` });
    for (let i = 0; i < entered + free + busy; i++) {
      const id = `${teamId}-r${i}`;
      out.riders.push({ id, team_id: teamId, squad: "senior", is_academy: false, is_retired: false, firstname: "R", lastname: id, is_u25: false, base_value: 1 });
      out.rider_derived_abilities.push({ rider_id: id, ...ABIL });
      if (i < entered) out.race_entries.push({ race_id: RACE.id, rider_id: id, team_id: teamId, race_role: "helper" });
      if (i < injured) out.rider_condition.push({ rider_id: id, injured_until: INJURED_UNTIL });
      if (i >= injured && i < injured + spentSel) spent.push(id);
      if (i >= entered + free) out.race_entries.push({ race_id: "race-other", rider_id: id, team_id: teamId, race_role: "helper" });
    }
  }
  return { ...out, spent, spentDay };
}

async function startField(teams, opts = {}) {
  const dropped = [];
  const entrants = await loadEntrantsForRace({
    supabase: makeFilterAwareSupabase(canned(teams, opts)), race: opts.race ?? RACE, stages: STAGES,
    allowAutofill: true, persist: false, onTeamsDropped: (ids) => dropped.push(...ids), today: TODAY,
  });
  const countByTeam = {};
  for (const e of entrants) countByTeam[e.team_id] = (countByTeam[e.team_id] ?? 0) + 1;
  return { countByTeam, entrants, dropped };
}

test("overlap-dag: 4 frie, resten kører et andet løb samme dag -> starter med 4", async () => {
  const { countByTeam } = await startField({ A: { entered: 4, busy: 8 } });
  assert.equal(countByTeam.A, 4);
});

test("overlap-dag: 5 frie -> starter med 5", async () => {
  const { countByTeam } = await startField({ A: { entered: 5, busy: 7 } });
  assert.equal(countByTeam.A, 5);
});

test("overlap-dag: 3 frie -> starter ikke (under 4)", async () => {
  const { countByTeam } = await startField({ A: { entered: 3, busy: 9 } });
  assert.equal(countByTeam.A, undefined);
});

test("ikke-overlap-dag: 5 frie og ingen i andre løb -> starter ikke (gulvet 6 uændret)", async () => {
  const { countByTeam } = await startField({ A: { entered: 5 } });
  assert.equal(countByTeam.A, undefined);
});

test("endagsløb: reglen gælder kun etapeløb -> 4 frie på en overlap-dag starter ikke", async () => {
  const { countByTeam } = await startField({ A: { entered: 4, busy: 8 } }, { race: { id: RACE.id, season_id: "s1", race_type: "single", stages: 1 } });
  assert.equal(countByTeam.A, undefined);
});

test("binding senere i etapeløbet er ikke overlap: 5 udtaget, resten i et løb på dag 11 -> starter ikke", async () => {
  const { countByTeam } = await startField({ A: { entered: 5, busy: 7 } }, { otherDay: 11 });
  assert.equal(countByTeam.A, undefined);
});

test("overlap-dag: assistenten fylder de frie ind (2 udtaget + 2 frie) -> starter med 4", async () => {
  const { countByTeam } = await startField({ A: { entered: 2, free: 2, busy: 8 } });
  assert.equal(countByTeam.A, 4);
});

test("overlap-dag: frie nok til 6 -> assistenten fylder op til 6 som før", async () => {
  const { countByTeam } = await startField({ A: { entered: 4, free: 3, busy: 5 } });
  assert.equal(countByTeam.A, 6);
});

test("udtagne der allerede har kørt et andet løb samme løbsdag (6 udtaget, 2 brugt) -> starter med 4", async () => {
  const { countByTeam, entrants } = await startField({ A: { entered: 6, spentSel: 2 } });
  assert.equal(countByTeam.A, 4);
  assert.ok(!entrants.some((e) => e.rider_id === "A-r0" || e.rider_id === "A-r1"), "de brugte ryttere starter ikke");
});

test("spent på en senere dag i etapeløbets vindue er ikke startdagens overlap (Codex P2) -> starter ikke", async () => {
  const { countByTeam } = await startField({ A: { entered: 6, spentSel: 2 } }, { spentDay: 11 });
  assert.equal(countByTeam.A, undefined);
});

test("AI-hold uden udtagelse: 4 frie, resten i et andet løb samme dag -> assistenten stiller 4", async () => {
  const { countByTeam } = await startField({ AI: { free: 4, busy: 8, ai: true } });
  assert.equal(countByTeam.AI, 4);
});

test("skade + overlap: 6 udtaget, 1 skadet, 1 brugt -> starter med 4", async () => {
  const { countByTeam } = await startField({ A: { entered: 6, injured: 1, spentSel: 1 } });
  assert.equal(countByTeam.A, 4);
});

test("skade + overlap: 5 udtaget, 1 skadet, 1 i andet løb samme dag -> starter med 4", async () => {
  const { countByTeam } = await startField({ A: { entered: 5, injured: 1, busy: 1 } });
  assert.equal(countByTeam.A, 4);
});

test("skade + overlap: 6 udtaget, 2 skadede, 1 brugt -> 3 tilbage, starter ikke", async () => {
  const { countByTeam } = await startField({ A: { entered: 6, injured: 2, spentSel: 1 } });
  assert.equal(countByTeam.A, undefined);
});

test("flere hold: kun overlap-holdet undtages; de andre følger gulvet", async () => {
  const { countByTeam, dropped } = await startField({
    O: { entered: 4, busy: 8 },
    L: { entered: 4 },
    F: { entered: 6 },
  });
  assert.equal(countByTeam.O, 4);
  assert.equal(countByTeam.L, undefined);
  assert.equal(countByTeam.F, 6);
  assert.deepEqual(dropped, [], "persist=false sender ingen besked");
});
