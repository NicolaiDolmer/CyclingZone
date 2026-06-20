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
