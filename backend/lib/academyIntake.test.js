import test from "node:test";
import assert from "node:assert/strict";

import { getTeamAcademyCount, runAcademyIntake, signAcademyCandidate, rejectAcademyCandidate } from "./academyIntake.js";

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
        // Understøtter: count/head query (getTeamAcademyCount) + select+order
        // (fetchAllRows) + select+in (deriveForRiderIds) + insert + update.
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
            // select+in (deriveForRiderIds henter de nyindsatte ryttere): returnér
            // de tidligere insertede payloads tilbage med deres id'er.
            const readApi = {
              _inIds: null,
              in(_col, ids) { readApi._inIds = ids; return readApi; },
              order() { return readApi; },
              range() {
                if (readApi._inIds) {
                  const byId = new Map(riderInserts.map((r) => [r._mockId, r]));
                  const rows = readApi._inIds
                    .map((id) => byId.get(id))
                    .filter(Boolean)
                    .map((r) => ({ ...r, id: r._mockId }));
                  return Promise.resolve({ data: rows, error: null });
                }
                // fetchAllRows (existingNames)
                return Promise.resolve({ data: existingRiders, error: null });
              },
            };
            return readApi;
          },
          insert(rows) {
            const inserted = Array.isArray(rows) ? rows : [rows];
            // Tildel stabile mock-id'er så derive-stien kan slå dem op igen.
            const withIds = inserted.map((r, i) => {
              const _mockId = `new-rider-${riderInserts.length + i}`;
              return { ...r, _mockId };
            });
            riderInserts.push(...withIds);
            // .select('id') returnerer de indsatte rækker med fake id'er
            return {
              select() {
                return Promise.resolve({
                  data: withIds.map((r) => ({ id: r._mockId })),
                  error: null,
                });
              },
            };
          },
          update(_patch) {
            const upApi = {
              eq() { return upApi; },
              then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
            };
            return upApi;
          },
        };
      }

      if (table === "rider_physiology_profiles" || table === "rider_derived_abilities") {
        const api = {
          upsert() { return Promise.resolve({ error: null }); },
        };
        return api;
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

// ─── Afled-pipeline ved intake (#1478 bug #2/#3/#4) ───────────────────────────

test("runAcademyIntake (apply): kører afled-pipeline for ALLE nyindsatte akademi-ryttere", async () => {
  const supabase = makeIntakeSupabase({
    activeSeason: { id: "season-1", number: 1, start_date: "2026-06-20" },
    academyIntakeTeamIds: [],
    existingRiders: [],
  });

  const deriveCalls = [];
  const res = await runAcademyIntake(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => TWO_MANAGER_TEAMS,
    deriveRiders: async (_sb, ids, opts) => {
      deriveCalls.push({ ids, opts });
      return { riders: ids.length };
    },
  });

  // Præcis ét derive-kald med alle nyindsatte rider-id'er (physiology + abilities
  // + type + base_value). Uden dette mangler akademiryttere abilities (springes i
  // træning), type og base_value.
  assert.equal(deriveCalls.length, 1, "afled-pipeline skal køres præcis én gang");
  assert.equal(deriveCalls[0].opts.dryRun, false, "afled skal køre i apply-mode");
  assert.equal(
    deriveCalls[0].ids.length,
    res.candidates,
    "afled skal dække alle nyindsatte ryttere",
  );
  // id'erne svarer til de mock-id'er insert returnerer
  for (const id of deriveCalls[0].ids) {
    assert.ok(typeof id === "string" && id.startsWith("new-rider-"), `uventet id: ${id}`);
  }
});

test("runAcademyIntake (dryRun): afled-pipeline kører IKKE (ingen writes i preview)", async () => {
  const supabase = makeIntakeSupabase({
    activeSeason: { id: "season-1", number: 1, start_date: "2026-06-20" },
    academyIntakeTeamIds: [],
    existingRiders: [],
  });

  let derived = false;
  await runAcademyIntake(supabase, {
    dryRun: true,
    seed: 2026,
    getManagerTeams: async () => TWO_MANAGER_TEAMS,
    deriveRiders: async () => { derived = true; },
  });

  assert.equal(derived, false, "dryRun: ingen afled-writes");
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

// ─── signAcademyCandidate ─────────────────────────────────────────────────────

/**
 * Mock-supabase til sign/reject-tests.
 * Understøtter: academy_intake (select+update), riders (select+update), rpc (balance), notifications, teams.
 */
function makeSignRejectSupabase({
  intakeStatus = "offered",
  intakeExists = true,
  teamAcademyCount = 0,
  riderBaseValue = 100000,
  notifyError = null,
} = {}) {
  const riderUpdates = [];
  const intakeUpdates = [];
  const rpcCalls = [];
  const notificationInserts = [];

  const supabase = {
    from(table) {
      if (table === "academy_intake") {
        let whereEqs = {};
        const api = {
          select() { return api; },
          eq(col, val) { whereEqs[col] = val; return api; },
          update(data) {
            intakeUpdates.push(data);
            const upApi = {
              eq() { return upApi; },
              then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
            };
            return upApi;
          },
          maybeSingle() {
            if (!intakeExists) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({
              data: { id: "intake-row-1", status: intakeStatus },
              error: null,
            });
          },
        };
        return api;
      }

      if (table === "riders") {
        return {
          // #1558: getTeamAcademyCount-stien bruges ikke længere af
          // signAcademyCandidate (cap-check er flyttet ind i RPC'en); kun
          // rider-lookup (market_value etc.) tilbage.
          select() {
            const readApi = {
              eq() { return readApi; },
              maybeSingle() {
                return Promise.resolve({
                  data: { id: "rider-X", firstname: "Sander", lastname: "Akademi", market_value: riderBaseValue, base_value: riderBaseValue, prize_earnings_bonus: 0 },
                  error: null,
                });
              },
            };
            return readApi;
          },
        };
      }

      if (table === "notifications") {
        const insertApi = {
          select() { return insertApi; },
          eq() { return insertApi; },
          gte() { return insertApi; },
          order() { return insertApi; },
          is() { return insertApi; },
          limit() {
            return Promise.resolve({ data: [], error: null });
          },
          insert(row) {
            notificationInserts.push(row);
            return Promise.resolve({ error: notifyError });
          },
        };
        return insertApi;
      }

      if (table === "teams") {
        const teamsApi = {
          select() { return teamsApi; },
          eq() { return teamsApi; },
          single() {
            return Promise.resolve({ data: { user_id: "user-1" }, error: null });
          },
        };
        return teamsApi;
      }

      return {};
    },
    // #1558: cap-check + rider-update + signing-fee-debit sker nu atomisk i
    // finalize_academy_acquisition. Mocken replikerer plpgsql-semantikken og
    // syntetiserer en rider-update i _riderUpdates så de eksisterende
    // placerings-assertions stadig holder.
    rpc(_name, _args) {
      rpcCalls.push({ _name, _args });
      assert.equal(_name, "finalize_academy_acquisition");
      const price = Number(_args.p_price);
      if (teamAcademyCount >= 8) {
        return Promise.resolve({ data: { ok: false, code: "academy_full" }, error: null });
      }
      if (price > 0 && 500000 < price) {
        return Promise.resolve({ data: { ok: false, code: "insufficient_balance" }, error: null });
      }
      riderUpdates.push({
        team_id: _args.p_team_id,
        is_academy: true,
        salary: Number(_args.p_salary),
        contract_length: _args.p_contract_length,
        contract_end_season: _args.p_contract_end_season,
        acquired_at: _args.p_acquired_at,
        pending_team_id: null,
      });
      return Promise.resolve({ data: { ok: true, balance: 500000 - price, academy_count: teamAcademyCount + 1 }, error: null });
    },
    _riderUpdates: riderUpdates,
    _intakeUpdates: intakeUpdates,
    _rpcCalls: rpcCalls,
    _notificationInserts: notificationInserts,
  };

  return supabase;
}

test("signAcademyCandidate: opdaterer rytter med is_academy=true, team_id, salary, contract_length=3, contract_end_season=seasonNumber+2", async () => {
  const supabase = makeSignRejectSupabase({ riderBaseValue: 100000, teamAcademyCount: 0 });
  const result = await signAcademyCandidate(supabase, { teamId: "team-A", riderId: "rider-X", seasonNumber: 1 });

  assert.equal(result.riderId, "rider-X");
  assert.ok(result.salary > 0, "salary > 0");
  assert.ok(result.fee > 0, "fee > 0");
  assert.equal(result.contractEndSeason, 3, "contractEndSeason = 1 + 3 - 1 = 3");

  // Rider update: is_academy=true, team_id, salary, contract_length=3, contract_end_season
  assert.equal(supabase._riderUpdates.length, 1, "præcis én rider-update");
  const upd = supabase._riderUpdates[0];
  assert.equal(upd.is_academy, true, "is_academy=true");
  assert.equal(upd.team_id, "team-A");
  assert.equal(upd.contract_length, 3);
  assert.equal(upd.contract_end_season, 3);
  assert.ok(typeof upd.salary === "number" && upd.salary >= 1, "salary er tal >= 1");

  // #1558: cap + rider-update + finance-debit via den atomære RPC.
  assert.equal(supabase._rpcCalls.length, 1, "præcis ét RPC-kald");
  const rpcCall = supabase._rpcCalls[0];
  assert.equal(rpcCall._name, "finalize_academy_acquisition");
  assert.equal(rpcCall._args.p_team_id, "team-A");
  assert.equal(rpcCall._args.p_rider_id, "rider-X");
  assert.ok(rpcCall._args.p_price > 0, "p_price er signing-fee > 0 (debit)");
  assert.ok(rpcCall._args.p_finance_payload.amount < 0, "payload.amount er negativ (debit)");
  assert.equal(rpcCall._args.p_finance_payload.type, "academy_signing");
  // #1558: stabil idempotency_key pr. rytter lukker racen mod youth_auction_winner.
  assert.equal(rpcCall._args.p_finance_payload.idempotency_key, "academy_signing:rider-X");
  // #1483: struktureret metadata med rytternavn så Historik-fanen viser navnet
  // i stedet for den rå UUID.
  assert.deepEqual(rpcCall._args.p_finance_payload.metadata, {
    code: "tx.academySigning",
    params: { riderName: "Sander Akademi" },
  });
  assert.equal(
    rpcCall._args.p_finance_payload.description,
    "Akademi-signing af Sander Akademi",
  );

  // Intake opdateret → signed
  assert.equal(supabase._intakeUpdates.length, 1, "præcis én intake-update");
  assert.equal(supabase._intakeUpdates[0].status, "signed");
  assert.ok(supabase._intakeUpdates[0].resolved_at, "resolved_at sat");
});

test("signAcademyCandidate: kaster 'academy_full' når cap er opfyldt (8 ryttere), ingen rider-update, ingen RPC-debit", async () => {
  const supabase = makeSignRejectSupabase({ teamAcademyCount: 8 });

  await assert.rejects(
    () => signAcademyCandidate(supabase, { teamId: "team-A", riderId: "rider-X", seasonNumber: 1 }),
    /academy_full/,
    "skal kaste academy_full",
  );

  // #1558: cap håndhæves nu inde i RPC'en — den kaldes, men returnerer
  // academy_full uden at optage rytteren eller debitere.
  assert.equal(supabase._riderUpdates.length, 0, "ingen rider-update (optagelse) ved cap-fejl");
  assert.equal(supabase._rpcCalls.length, 1, "RPC kaldes som gate, men afviser med academy_full");
  assert.equal(supabase._rpcCalls[0]._args.p_finance_payload.idempotency_key, "academy_signing:rider-X");
  assert.equal(supabase._intakeUpdates.length, 0, "ingen intake-update ved cap-fejl");
});

test("signAcademyCandidate: kaster 'not_offered' når ingen offered-række eksisterer", async () => {
  const supabase = makeSignRejectSupabase({ intakeExists: false });

  await assert.rejects(
    () => signAcademyCandidate(supabase, { teamId: "team-A", riderId: "rider-X", seasonNumber: 1 }),
    /not_offered/,
  );

  assert.equal(supabase._riderUpdates.length, 0, "ingen rider-update");
  assert.equal(supabase._rpcCalls.length, 0, "ingen RPC-kald");
});

test("signAcademyCandidate: kaster 'not_offered' når intake-status er 'signed' (ikke offered)", async () => {
  const supabase = makeSignRejectSupabase({ intakeStatus: "signed", intakeExists: true });

  await assert.rejects(
    () => signAcademyCandidate(supabase, { teamId: "team-A", riderId: "rider-X", seasonNumber: 1 }),
    /not_offered/,
  );
});

// ─── rejectAcademyCandidate ───────────────────────────────────────────────────

test("rejectAcademyCandidate: opdaterer intake → rejected + lister ungdomsauktion, ingen rytter-ejerskabsændring", async () => {
  const supabase = makeSignRejectSupabase({ intakeExists: true, intakeStatus: "offered" });
  const listed = [];
  const result = await rejectAcademyCandidate(supabase, {
    teamId: "team-A",
    riderId: "rider-X",
    listYouthAuction: async (_sb, riderId) => { listed.push(riderId); return { id: "youth-auction-9" }; },
  });

  assert.equal(result.riderId, "rider-X");
  assert.equal(result.status, "rejected");
  assert.equal(result.auctionId, "youth-auction-9", "ungdomsauktionens id returneres");

  // Intake opdateret → rejected
  assert.equal(supabase._intakeUpdates.length, 1, "præcis én intake-update");
  assert.equal(supabase._intakeUpdates[0].status, "rejected");
  assert.ok(supabase._intakeUpdates[0].resolved_at, "resolved_at sat");

  // Fase B: ungdomsauktion oprettet for den afviste rytter
  assert.deepEqual(listed, ["rider-X"], "listYouthAuction kaldt med riderId");

  // Ingen rider-ejerskabsændring (auktionen ændrer ikke team_id endnu)
  assert.equal(supabase._riderUpdates.length, 0, "ingen rider-update ved reject");
  assert.equal(supabase._rpcCalls.length, 0, "ingen finance-kald ved reject");
});

// Default-wiring (uden DI): bekræfter at den faktiske dynamiske import-bro til
// youthMarket.listRejectedAsYouthAuction kører end-to-end og opretter en auktion.
function makeDefaultRejectSupabase() {
  const auctionInserts = [];
  const intakeUpdates = [];
  const supabase = {
    from(table) {
      if (table === "academy_intake") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: { id: "intake-1", status: "offered" }, error: null }); },
          update(data) { intakeUpdates.push(data); return { eq() { return Promise.resolve({ error: null }); } }; },
        };
        return api;
      }
      if (table === "riders") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() {
            return Promise.resolve({
              data: { id: "rider-X", firstname: "A", lastname: "B", base_value: 100000, market_value: 100000, prize_earnings_bonus: 0, team_id: null },
              error: null,
            });
          },
        };
        return api;
      }
      if (table === "auction_timing_config") {
        // null → resolveAuctionConfig falder tilbage til DEFAULT_AUCTION_CONFIG
        return { select() { return { eq() { return { single() { return Promise.resolve({ data: null, error: null }); } }; } }; } };
      }
      if (table === "auctions") {
        return {
          insert(row) {
            auctionInserts.push(row);
            return { select() { return { single() { return Promise.resolve({ data: { id: "youth-auction-default", ...row }, error: null }); } }; } };
          },
        };
      }
      return {};
    },
    _auctionInserts: auctionInserts,
    _intakeUpdates: intakeUpdates,
  };
  return supabase;
}

test("rejectAcademyCandidate: default-wiring opretter reelt en ungdomsauktion (dynamisk import-bro)", async () => {
  const supabase = makeDefaultRejectSupabase();
  const result = await rejectAcademyCandidate(supabase, { teamId: "team-A", riderId: "rider-X" });

  assert.equal(result.status, "rejected");
  assert.equal(result.auctionId, "youth-auction-default");
  assert.equal(supabase._auctionInserts.length, 1, "ungdomsauktion oprettet via default-stien");
  assert.equal(supabase._auctionInserts[0].is_youth, true);
  assert.equal(supabase._auctionInserts[0].seller_team_id, null);
});

test("rejectAcademyCandidate: lister IKKE ungdomsauktion når kandidaten ikke er offered", async () => {
  const supabase = makeSignRejectSupabase({ intakeExists: true, intakeStatus: "signed" });
  let called = false;
  await assert.rejects(
    () => rejectAcademyCandidate(supabase, {
      teamId: "team-A",
      riderId: "rider-X",
      listYouthAuction: async () => { called = true; return { id: "x" }; },
    }),
    /not_offered/,
  );
  assert.equal(called, false, "ingen auktion oprettet ved ugyldig reject");
});

test("rejectAcademyCandidate: kaster 'not_offered' når ingen offered-række eksisterer", async () => {
  const supabase = makeSignRejectSupabase({ intakeExists: false });

  await assert.rejects(
    () => rejectAcademyCandidate(supabase, { teamId: "team-A", riderId: "rider-X" }),
    /not_offered/,
  );

  assert.equal(supabase._intakeUpdates.length, 0, "ingen intake-update ved fejl");
});
