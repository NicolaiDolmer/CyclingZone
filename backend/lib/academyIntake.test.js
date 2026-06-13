import test from "node:test";
import assert from "node:assert/strict";

import { getTeamAcademyCount, runAcademyIntake } from "./academyIntake.js";

// ─── Mock-supabase helpers ────────────────────────────────────────────────────

/**
 * Minimalt mock-supabase der understøtter de queries academyIntake bruger.
 *
 * @param {object} opts
 * @param {object|null} opts.activeSeason  - { id, number, start_date } or null
 * @param {string[]}    opts.academyIntakeTeamIds - team_ids allerede i academy_intake for den sæson
 * @param {object[]}    opts.existingRiders       - { firstname, lastname }[]
 * @param {number}      opts.teamAcademyCount     - hvad count-query returnerer
 */
function makeIntakeSupabase({
  activeSeason = { id: "season-1", number: 1, start_date: "2026-06-20" },
  academyIntakeTeamIds = [],
  existingRiders = [],
  teamAcademyCount = 0,
} = {}) {
  const riderInserts = [];
  const academyIntakeInserts = [];

  const supabase = {
    from(table) {
      if (table === "seasons") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() {
            return Promise.resolve({ data: activeSeason, error: null });
          },
        };
        return api;
      }

      if (table === "academy_intake") {
        const api = {
          select() { return api; },
          eq() { return api; },
          // fetchAllRows bruger .range()
          range() {
            return Promise.resolve({
              data: academyIntakeTeamIds.map((team_id) => ({ team_id })),
              error: null,
            });
          },
          insert(rows) {
            const inserted = Array.isArray(rows) ? rows : [rows];
            academyIntakeInserts.push(...inserted);
            return Promise.resolve({ error: null });
          },
        };
        return api;
      }

      if (table === "riders") {
        // Understøtter: count/head query (getTeamAcademyCount) + select+order (fetchAllRows) + insert
        return {
          select(_cols, opts) {
            if (opts?.count === "exact" && opts?.head === true) {
              // getTeamAcademyCount
              const countApi = {
                eq() { return countApi; },
                then(res) {
                  return Promise.resolve({ count: teamAcademyCount, error: null }).then(res);
                },
              };
              return countApi;
            }
            // fetchAllRows (existingNames)
            const readApi = {
              order() { return readApi; },
              range() {
                return Promise.resolve({ data: existingRiders, error: null });
              },
            };
            return readApi;
          },
          insert(rows) {
            const inserted = Array.isArray(rows) ? rows : [rows];
            riderInserts.push(...inserted);
            // .select('id') returnerer de indsatte rækker med fake id'er
            return {
              select() {
                return Promise.resolve({
                  data: inserted.map((r, i) => ({ ...r, id: `new-rider-${i}` })),
                  error: null,
                });
              },
            };
          },
        };
      }

      return {};
    },
    _riderInserts: riderInserts,
    _academyIntakeInserts: academyIntakeInserts,
  };

  return supabase;
}

// To manager-hold til brug i tests
const TWO_MANAGER_TEAMS = [
  { id: "team-A", season_1_identity_basis: { dominant_nationality: "NOR" } },
  { id: "team-B", season_1_identity_basis: null },
];

// ─── getTeamAcademyCount ──────────────────────────────────────────────────────

test("getTeamAcademyCount returnerer count fra riders-tabel", async () => {
  const supabase = makeIntakeSupabase({ teamAcademyCount: 3 });
  const count = await getTeamAcademyCount(supabase, "team-A");
  assert.equal(count, 3);
});

// ─── runAcademyIntake (dryRun) ────────────────────────────────────────────────

test("runAcademyIntake (dryRun): ingen writes, tæller teams+candidates", async () => {
  const supabase = makeIntakeSupabase({
    activeSeason: { id: "season-1", number: 1, start_date: "2026-06-20" },
    academyIntakeTeamIds: [],
    existingRiders: [{ firstname: "Lars", lastname: "Hansen" }],
  });

  const res = await runAcademyIntake(supabase, {
    dryRun: true,
    seed: 2026,
    getManagerTeams: async () => TWO_MANAGER_TEAMS,
  });

  assert.equal(res.dryRun, true);
  assert.equal(res.teams, 2, "begge hold behandles");
  assert.ok(res.candidates >= 2 * 3, `candidates=${res.candidates} < min 6`);

  // Ingen writes
  assert.equal(supabase._riderInserts.length, 0, "dryRun: ingen rider-inserts");
  assert.equal(supabase._academyIntakeInserts.length, 0, "dryRun: ingen academy_intake-inserts");
});

// ─── runAcademyIntake (apply) ─────────────────────────────────────────────────

test("runAcademyIntake (apply): indsætter ryttere (pcm_id null, is_academy false) + academy_intake-rækker (status offered)", async () => {
  const supabase = makeIntakeSupabase({
    activeSeason: { id: "season-1", number: 1, start_date: "2026-06-20" },
    academyIntakeTeamIds: [],
    existingRiders: [],
  });

  const res = await runAcademyIntake(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => TWO_MANAGER_TEAMS,
  });

  assert.equal(res.dryRun, false);
  assert.equal(res.teams, 2);
  assert.ok(res.candidates >= 6, `candidates=${res.candidates} < 6`);

  // Rider-inserts: pcm_id null, is_academy false
  assert.ok(supabase._riderInserts.length >= 6, "for få rider-inserts");
  for (const r of supabase._riderInserts) {
    assert.equal(r.pcm_id, null, "pcm_id skal være null");
    assert.equal(r.is_academy, false, "is_academy skal være false ved insert");
    assert.ok(r.firstname, "firstname påkrævet");
    assert.ok(r.lastname, "lastname påkrævet");
  }

  // academy_intake-inserts: status offered, season_id sat
  assert.equal(supabase._academyIntakeInserts.length, res.candidates, "en intake-række pr. kandidat");
  for (const row of supabase._academyIntakeInserts) {
    assert.equal(row.status, "offered");
    assert.equal(row.season_id, "season-1");
    assert.ok(row.team_id === "team-A" || row.team_id === "team-B", `ukendt team_id: ${row.team_id}`);
    assert.ok(row.rider_id, "rider_id påkrævet");
    assert.ok(typeof row.is_serious === "boolean", "is_serious skal være boolean");
  }
});

// ─── Idempotens ───────────────────────────────────────────────────────────────

test("runAcademyIntake (apply): hold allerede i academy_intake springes over (idempotent)", async () => {
  // team-A er allerede seedet — kun team-B behandles
  const supabase = makeIntakeSupabase({
    activeSeason: { id: "season-1", number: 1, start_date: "2026-06-20" },
    academyIntakeTeamIds: ["team-A"],
    existingRiders: [],
  });

  const res = await runAcademyIntake(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => TWO_MANAGER_TEAMS,
  });

  assert.equal(res.teams, 1, "kun 1 hold (team-B) skal behandles");

  // Ingen inserts for team-A
  const intakeForA = supabase._academyIntakeInserts.filter((r) => r.team_id === "team-A");
  assert.equal(intakeForA.length, 0, "team-A allerede seedet — ingen nye inserts");

  // team-B inserts eksisterer
  const intakeForB = supabase._academyIntakeInserts.filter((r) => r.team_id === "team-B");
  assert.ok(intakeForB.length >= 3, `for få inserts for team-B: ${intakeForB.length}`);
});

// ─── Ingen aktiv sæson ────────────────────────────────────────────────────────

test("runAcademyIntake (dryRun): ingen aktiv sæson returnerer note uden kast", async () => {
  const supabase = makeIntakeSupabase({ activeSeason: null });

  const res = await runAcademyIntake(supabase, {
    dryRun: true,
    seed: 2026,
    getManagerTeams: async () => TWO_MANAGER_TEAMS,
  });

  assert.equal(res.dryRun, true);
  assert.ok(res.note, "note-felt skal eksistere");
  assert.ok(res.note.includes("no active season"), `uventet note: ${res.note}`);
});

test("runAcademyIntake (apply): ingen aktiv sæson kaster fejl", async () => {
  const supabase = makeIntakeSupabase({ activeSeason: null });

  await assert.rejects(
    () => runAcademyIntake(supabase, {
      dryRun: false,
      seed: 2026,
      getManagerTeams: async () => TWO_MANAGER_TEAMS,
    }),
    /no active season/i,
  );
});
