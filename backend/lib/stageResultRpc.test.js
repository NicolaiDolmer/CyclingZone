/**
 * Per-stage atomic result-write (#1598) — RPC-helper-kontrakt + partial-rollback.
 *
 * apply_stage_result-RPC'en (database/2026-06-21-stage-write-atomic-rpc.sql) samler
 * de tre per-etape-skrivninger (stages_completed-lås + race_results delete + insert)
 * i ÉN Postgres-transaktion. Den ægte ROLLBACK-garanti leveres af Postgres og kan kun
 * verificeres mod en rigtig instans (SQL-snippet i migrationens verifikations-blok).
 *
 * Disse tests bruger en mock-RPC der modellerer transaktionens ALT-eller-INTET-kontrakt:
 * en fejl midt i transaktionen efterlader INGEN partial state (counter ikke bumpet,
 * ingen race_results) — præcis den invariant koden SKAL opretholde. Samme mock-strategi
 * som balanceAtomicity.test.js (07c).
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const { applyStageResultAtomic } = await import("./stageResultRpc.js");

/**
 * Mock-RPC der simulerer apply_stage_result-transaktionens semantik:
 *   - state.stagesCompleted = nuværende counter for løbet
 *   - state.results = persisterede race_results (kun denne etapes)
 * Transaktionen kører de 3 trin på en SHADOW-kopi og COMMITTER kun hvis ingen
 * fejl opstod (ALT-eller-INTET). opts.failOn = 'delete' | 'insert' | 'lock'
 * injicerer en fejl i det pågældende trin → ROLLBACK (state uændret).
 */
function createStageRpcMock({ stagesCompleted = 0, failOn = null } = {}) {
  const state = { stagesCompleted, results: [], rpcCalls: 0 };

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "apply_stage_result");
      state.rpcCalls += 1;

      // Shadow-state — kun committet hvis hele "transaktionen" lykkes.
      let shadowCounter = state.stagesCompleted;
      let shadowResults = state.results.slice();

      // Trin 1: optimistisk lås (UPDATE ... WHERE stages_completed = p_stage_index).
      if (shadowCounter !== params.p_stage_index) {
        // Konkurrent vandt — ingen side-effekter, ingen rollback nødvendig.
        return Promise.resolve({
          data: { lock_won: false, rows_imported: 0 },
          error: null,
        });
      }
      if (failOn === "lock") {
        return Promise.resolve({ data: null, error: { code: "XX000", message: "lock boom" } });
      }
      shadowCounter = params.p_stage_number;

      // Trin 2: idempotent delete af etapens race_results.
      if (failOn === "delete") {
        // ROLLBACK: shadow forkastes, state uændret.
        return Promise.resolve({ data: null, error: { code: "XX000", message: "delete boom" } });
      }
      shadowResults = shadowResults.filter((r) => r.stage_number !== params.p_stage_number);

      // Trin 3: insert de nybyggede rækker.
      if (failOn === "insert") {
        // ROLLBACK: shadow forkastes, state uændret.
        return Promise.resolve({ data: null, error: { code: "23514", message: "result_type check" } });
      }
      const rows = params.p_result_rows.map((r) => ({
        race_id: params.p_race_id,
        stage_number: r.stage_number ?? params.p_stage_number,
        result_type: r.result_type,
        rank: r.rank,
      }));
      shadowResults = shadowResults.concat(rows);

      // COMMIT: alle tre trin lykkedes → committeret samlet.
      state.stagesCompleted = shadowCounter;
      state.results = shadowResults;
      return Promise.resolve({
        data: { lock_won: true, rows_imported: rows.length },
        error: null,
      });
    },
  };
}

const ROW = { rider_id: "r1", result_type: "stage", rank: 1, stage_number: 1, points_earned: 50, prize_money: 50000 };

test("happy path: lås vindes → counter bumpes OG race_results skrives (begge committet)", async () => {
  const mock = createStageRpcMock({ stagesCompleted: 0 });
  const r = await applyStageResultAtomic(mock, {
    raceId: "race-1", stageIndex: 0, stageNumber: 1, totalStages: 3, resultRows: [ROW],
  });
  assert.equal(r.lockWon, true);
  assert.equal(r.rowsImported, 1);
  assert.equal(mock.state.stagesCompleted, 1, "counter skal være bumpet til stageNumber");
  assert.equal(mock.state.results.length, 1, "race_results skal være skrevet");
});

test("PARTIAL-ROLLBACK: insert fejler midt i transaktionen → counter IKKE bumpet, INGEN race_results", async () => {
  // Kernen i #1598: hvis ÉN af de 3 skrivninger fejler, ruller ALLE tilbage.
  const mock = createStageRpcMock({ stagesCompleted: 0, failOn: "insert" });
  await assert.rejects(
    () => applyStageResultAtomic(mock, {
      raceId: "race-1", stageIndex: 0, stageNumber: 1, totalStages: 3, resultRows: [ROW],
    }),
    (err) => err.code === "23514",
  );
  // INGEN partial state: counter uændret + ingen results (transaktionen rullet tilbage).
  assert.equal(mock.state.stagesCompleted, 0, "counter må IKKE være bumpet når insert fejler");
  assert.equal(mock.state.results.length, 0, "ingen race_results må overleve en rullet-tilbage transaktion");
});

test("PARTIAL-ROLLBACK: delete fejler efter counter-bump → ALT ruller tilbage (counter ikke foran tomme results)", async () => {
  // Det præcise desync-scenarie: counter ville stå foran tomme race_results.
  // Transaktionen forhindrer det — delete-fejl ruller counter-bumpet tilbage.
  const mock = createStageRpcMock({ stagesCompleted: 0, failOn: "delete" });
  await assert.rejects(
    () => applyStageResultAtomic(mock, {
      raceId: "race-1", stageIndex: 0, stageNumber: 1, totalStages: 3, resultRows: [ROW],
    }),
    (err) => err.code === "XX000",
  );
  assert.equal(mock.state.stagesCompleted, 0, "counter må rulles tilbage når delete fejler");
  assert.equal(mock.state.results.length, 0, "ingen race_results");
});

test("idempotent re-kørsel: samme etape to gange → counter står på stageNumber, kun etapens rækker", async () => {
  // Første kørsel committer; en gen-afvikling af SAMME stageIndex ser counteren
  // allerede bumpet (lock_won=false) → ingen dobbelt-skrivning. (Den ægte idempotente
  // delete-then-insert ved samme stageIndex testes mod prod-instans; her bevises at
  // lås-prædikatet beskytter mod dobbelt-anvendelse.)
  const mock = createStageRpcMock({ stagesCompleted: 0 });
  const first = await applyStageResultAtomic(mock, {
    raceId: "race-1", stageIndex: 0, stageNumber: 1, totalStages: 3, resultRows: [ROW],
  });
  assert.equal(first.lockWon, true);
  const second = await applyStageResultAtomic(mock, {
    raceId: "race-1", stageIndex: 0, stageNumber: 1, totalStages: 3, resultRows: [ROW],
  });
  assert.equal(second.lockWon, false, "gen-afvikling af samme stageIndex skal tabe låsen");
  assert.equal(second.rowsImported, 0);
  assert.equal(mock.state.results.length, 1, "ingen dobbelt-insert af etapens rækker");
});

test("konkurrent taber låsen (stages_completed != stageIndex) → lockWon=false, ingen skriv", async () => {
  const mock = createStageRpcMock({ stagesCompleted: 2 }); // counter allerede forbi
  const r = await applyStageResultAtomic(mock, {
    raceId: "race-1", stageIndex: 0, stageNumber: 1, totalStages: 3, resultRows: [ROW],
  });
  assert.equal(r.lockWon, false);
  assert.equal(r.rowsImported, 0);
  assert.equal(mock.state.stagesCompleted, 2, "counter må ikke røres når låsen tabes");
  assert.equal(mock.state.results.length, 0);
});

test("helper-validering: afviser tomt resultRows / negativt stageIndex / manglende rpc", async () => {
  const ok = createStageRpcMock();
  await assert.rejects(
    () => applyStageResultAtomic(ok, { raceId: "r1", stageIndex: 0, stageNumber: 1, resultRows: [] }),
    /resultRows/,
  );
  await assert.rejects(
    () => applyStageResultAtomic(ok, { raceId: "r1", stageIndex: -1, stageNumber: 1, resultRows: [ROW] }),
    /stageIndex/,
  );
  await assert.rejects(
    () => applyStageResultAtomic({}, { raceId: "r1", stageIndex: 0, stageNumber: 1, resultRows: [ROW] }),
    /rpc/,
  );
});

test("#3022 forward-guard: applyStageResultAtomic afviser en række uden gyldig deltager-identitet FØR rpc() kaldes", async () => {
  const mock = createStageRpcMock({ stagesCompleted: 0 });
  await assert.rejects(
    () => applyStageResultAtomic(mock, {
      raceId: "race-1", stageIndex: 0, stageNumber: 1, totalStages: 3,
      resultRows: [{ result_type: "stage", rank: 1, stage_number: 1, rider_id: null, rider_name: null }],
    }),
    /uden gyldig deltager-identitet/,
  );
  assert.equal(mock.state.rpcCalls, 0, "rpc() må ikke kaldes når batchen afvises af forward-guarden");
});

// ── applyRaceResultsBatchAtomic — fuld-løb/PCM (#3022 fejlmode B) ─────────────────
const { applyRaceResultsBatchAtomic } = await import("./stageResultRpc.js");

/**
 * Mock-RPC der simulerer apply_race_results_batch-transaktionens semantik
 * (database/proposals/2026-08-05-race-results-batch-write-atomic-rpc.sql):
 * delete-af-berørte-etaper + insert i ÉN "transaktion" — opts.failOn = 'insert'
 * injicerer en fejl EFTER delete'et er "kørt" i shadow-state → ROLLBACK (state uændret).
 */
function createBatchRpcMock({ initialRows = [], failOn = null } = {}) {
  const state = { rows: initialRows.slice(), rpcCalls: 0 };
  return {
    state,
    rpc(name, params) {
      assert.equal(name, "apply_race_results_batch");
      state.rpcCalls += 1;

      let shadow = state.rows.slice();
      let deleted = 0;
      const stageNumbers = params.p_stage_numbers;
      if (Array.isArray(stageNumbers) && stageNumbers.length) {
        const before = shadow.length;
        shadow = shadow.filter((r) => !(r.race_id === params.p_race_id && stageNumbers.includes(r.stage_number)));
        deleted = before - shadow.length;
      }

      if (failOn === "insert") {
        // ROLLBACK: shadow forkastes (inkl. det simulerede delete) — state uændret.
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"race_results_entrant_unique\"" } });
      }

      const newRows = params.p_result_rows.map((r) => ({
        race_id: params.p_race_id,
        stage_number: r.stage_number ?? 1,
        result_type: r.result_type,
        rider_id: r.rider_id ?? null,
      }));
      shadow = shadow.concat(newRows);

      state.rows = shadow;
      return Promise.resolve({ data: { rows_deleted: deleted, rows_inserted: newRows.length }, error: null });
    },
  };
}

const BATCH_ROW = { rider_id: "r1", rider_name: "Rider One", result_type: "gc", rank: 1, stage_number: 1 };

test("applyRaceResultsBatchAtomic happy path: delete + insert committet sammen", async () => {
  const mock = createBatchRpcMock({ initialRows: [{ race_id: "race-1", stage_number: 1, result_type: "gc", rider_id: "old" }] });
  const r = await applyRaceResultsBatchAtomic(mock, { raceId: "race-1", stageNumbers: [1], resultRows: [BATCH_ROW] });
  assert.equal(r.rowsDeleted, 1);
  assert.equal(r.rowsInserted, 1);
  assert.equal(mock.state.rows.length, 1);
  assert.equal(mock.state.rows[0].rider_id, "r1");
});

test("applyRaceResultsBatchAtomic PARTIAL-ROLLBACK: insert-fejl (unique_violation) → delete rulles OGSÅ tilbage", async () => {
  const existing = [{ race_id: "race-1", stage_number: 1, result_type: "gc", rider_id: "old" }];
  const mock = createBatchRpcMock({ initialRows: existing, failOn: "insert" });
  await assert.rejects(
    () => applyRaceResultsBatchAtomic(mock, { raceId: "race-1", stageNumbers: [1], resultRows: [BATCH_ROW] }),
    (err) => err.code === "23505",
  );
  assert.deepEqual(mock.state.rows, existing, "løbet må IKKE stå resultatløst — den gamle række skal overleve en rullet-tilbage batch");
});

test("applyRaceResultsBatchAtomic: stageNumbers=null/tom → ren insert, intet delete (approve-results-lignende brug)", async () => {
  const mock = createBatchRpcMock({ initialRows: [] });
  const r = await applyRaceResultsBatchAtomic(mock, { raceId: "race-1", stageNumbers: null, resultRows: [BATCH_ROW] });
  assert.equal(r.rowsDeleted, 0);
  assert.equal(r.rowsInserted, 1);
});

test("applyRaceResultsBatchAtomic: helper-validering afviser tomt resultRows / manglende raceId / manglende rpc", async () => {
  const ok = createBatchRpcMock();
  await assert.rejects(
    () => applyRaceResultsBatchAtomic(ok, { raceId: "race-1", stageNumbers: [1], resultRows: [] }),
    /resultRows/,
  );
  await assert.rejects(
    () => applyRaceResultsBatchAtomic(ok, { raceId: null, stageNumbers: [1], resultRows: [BATCH_ROW] }),
    /raceId/,
  );
  await assert.rejects(
    () => applyRaceResultsBatchAtomic({}, { raceId: "race-1", stageNumbers: [1], resultRows: [BATCH_ROW] }),
    /rpc/,
  );
});

test("#3022 forward-guard: applyRaceResultsBatchAtomic afviser en intern batch-kollision FØR rpc() kaldes", async () => {
  const mock = createBatchRpcMock();
  await assert.rejects(
    () => applyRaceResultsBatchAtomic(mock, {
      raceId: "race-1",
      stageNumbers: [1],
      resultRows: [
        { race_id: "race-1", stage_number: 1, result_type: "gc", rank: 1, rider_id: "r1" },
        { race_id: "race-1", stage_number: 1, result_type: "gc", rank: 2, rider_id: "r1" },
      ],
    }),
    /kollidere med race_results_entrant_unique/,
  );
  assert.equal(mock.state.rpcCalls, 0);
});
