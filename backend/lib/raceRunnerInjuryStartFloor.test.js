// #6740 (ejer-beslutning B 16/10): et hold der havde gulvet (6), og kun er under det
// fordi udtagne ryttere blev skadet efter udtagelsen, starter med de raske ryttere det
// har tilbage (mindst 1). Assistenten fylder først op med frie ryttere, også delvist.
// Under 6 af andre grunde (for få udtaget) gælder gulvet uændret.
// Filter-aware mock som raceRunnerWithdrawnEntrants.test.js, her med gte() aktiv, fordi
// skade-kandidatpuljen i fillMissingTeamEntries hentes med .gte("injured_until", dag).

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
      gte(col, val) { preds.push((r) => r[col] != null && r[col] >= val); return b; },
      eq(col, val) { preds.push((r) => r[col] === val); return b; },
      neq(col, val) { preds.push((r) => r[col] !== val); return b; },
      in(col, vals) { preds.push((r) => vals.includes(r[col])); return b; },
      insert() { return Promise.resolve({ error: null }); },
      maybeSingle() {
        const rows = (canned[table] || []).filter((r) => preds.every((p) => p(r)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
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
  // find_spent_race_days: ryttere i canned.spent har allerede brugt løbsdagen.
  const rpc = (name, args) => Promise.resolve(name === "find_spent_race_days"
    ? { data: (args.p_rider_ids || []).filter((id) => (canned.spent || []).includes(id)).map((rider_id) => ({ rider_id, race_id: "other", game_day: 1 })), error: null }
    : { error: null });
  return { from, rpc };
}

const ABIL = { sprint: 60, climbing: 60, time_trial: 60, one_day: 60, gc: 60, hills: 60, cobbles: 60, aggression: 60 };
const INJURED_UNTIL = "2999-01-01";
const RACE = { id: "race-b", season_id: null };
const STAGES = [{ stage_number: 1, profile_type: "hilly", demand_vector: { hilly: 1 } }];

// Hold: { entered, injured, free }. De første `injured` udtagne er skadede.
function canned(teams) {
  const out = { race_entries: [], riders: [], rider_derived_abilities: [], rider_condition: [], teams: [], race_withdrawals: [] };
  for (const [teamId, { entered, injured = 0, free = 0 }] of Object.entries(teams)) {
    out.teams.push({ id: teamId, name: teamId, is_test_account: false, is_frozen: false, is_ai: false, user_id: null });
    for (let i = 0; i < entered + free; i++) {
      const id = `${teamId}-r${i}`;
      out.riders.push({ id, team_id: teamId, squad: "senior", is_academy: false, is_retired: false, firstname: "R", lastname: id, is_u25: false, base_value: 1 });
      out.rider_derived_abilities.push({ rider_id: id, ...ABIL });
      if (i < entered) out.race_entries.push({ race_id: RACE.id, rider_id: id, team_id: teamId, race_role: "helper" });
      if (i < injured) out.rider_condition.push({ rider_id: id, injured_until: INJURED_UNTIL });
    }
  }
  return out;
}

async function startField(teams, { race = RACE, spent = [] } = {}) {
  const dropped = [];
  const entrants = await loadEntrantsForRace({
    supabase: makeFilterAwareSupabase({ ...canned(teams), spent }), race, stages: STAGES,
    allowAutofill: true, persist: false, onTeamsDropped: (ids) => dropped.push(...ids),
  });
  const countByTeam = {};
  for (const e of entrants) countByTeam[e.team_id] = (countByTeam[e.team_id] ?? 0) + 1;
  return { countByTeam, entrants };
}

test("regel B: 6 udtaget, 1 skadet, ingen frie -> starter med 5 (Friis/Léman 16/10)", async () => {
  const { countByTeam, entrants } = await startField({ A: { entered: 6, injured: 1 } });
  assert.equal(countByTeam.A, 5);
  assert.ok(!entrants.some((e) => e.rider_id === "A-r0"), "den skadede rytter starter aldrig");
});

test("regel B: assistenten fylder stadig op til 6 når der er frie ryttere nok", async () => {
  const { countByTeam } = await startField({ C: { entered: 6, injured: 1, free: 2 } });
  assert.equal(countByTeam.C, 6);
});

test("regel B: assistenten fylder delvist når 6 ikke kan nås (2 skadede, 1 fri -> 5)", async () => {
  const { countByTeam } = await startField({ D: { entered: 6, injured: 2, free: 1 } });
  assert.equal(countByTeam.D, 5);
});

test("regel B: alle udtagne skadede og ingen frie -> holdet starter ikke (mindst 1)", async () => {
  const { countByTeam } = await startField({ E: { entered: 6, injured: 6 } });
  assert.equal(countByTeam.E, undefined);
});

test("gulvet uændret: for få udtaget (4, ingen skade, ingen frie) -> starter ikke", async () => {
  const { countByTeam } = await startField({ B: { entered: 4 }, A: { entered: 6, injured: 1 } });
  assert.equal(countByTeam.B, undefined);
  assert.equal(countByTeam.A, 5);
});

test("gulvet uændret: 5 udtaget og 1 skadet (havde aldrig gulvet) -> starter ikke", async () => {
  const { countByTeam } = await startField({ F: { entered: 5, injured: 1 } });
  assert.equal(countByTeam.F, undefined);
});

test("regel B: alle udtagne skadede, 2 frie -> assistenten redder holdet med 2 (redning, ikke tomt hold)", async () => {
  const { countByTeam, entrants } = await startField({ G: { entered: 6, injured: 6, free: 2 } });
  assert.equal(countByTeam.G, 2);
  assert.ok(entrants.every((e) => !["G-r0", "G-r1", "G-r2", "G-r3", "G-r4", "G-r5"].includes(e.rider_id)));
});

test("regel B: en skadet rytter der OGSÅ har brugt løbsdagen tæller ikke som skade (Codex P1)", async () => {
  const race = { ...RACE, season_id: "s1" };
  // 6 udtaget, A-r0 skadet og spent: 5 raske + 0 skadede der tæller = 5 -> gulvet gælder.
  const spentToo = await startField({ A: { entered: 6, injured: 1 } }, { race, spent: ["A-r0"] });
  assert.equal(spentToo.countByTeam.A, undefined);
  // Kontrol: samme hold uden spent starter med 5.
  const injuredOnly = await startField({ A: { entered: 6, injured: 1 } }, { race });
  assert.equal(injuredOnly.countByTeam.A, 5);
});
