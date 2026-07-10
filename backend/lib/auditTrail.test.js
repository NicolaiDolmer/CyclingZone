import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_ACTION_TYPE,
  FINANCE_ACTOR_TYPE,
  FINANCE_RELATED_ENTITY,
  FINANCE_REASON,
} from "./economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// CHECK-constraint listen i database/2026-05-09-audit-log-foundation.sql.
// Hvis denne liste og DB-constraint divergerer fejler INSERT på prod højlydt.
const MIGRATION_ADMIN_ACTION_TYPES = new Set([
  "auction_cancel",
  "transfer_offer_admin_cancel",
  "swap_offer_admin_cancel",
  "loan_agreement_admin_cancel",
  "auction_config_update",
  "market_pause",
  "market_resume",
  "balance_adjustment",
  "user_deleted",
  "role_changed",
  "race_deleted",
  "race_edited",
  "race_results_imported",
  "race_results_approved",
  "beta_reset",
  "prize_force_paid",
  "season_repaired",
  "season_started",
  "season_ended",
  "discord_webhook_added",
  "discord_webhook_removed",
  "manual_override",
  "economy_export",
  "team_data_edited",
  "rider_data_edited",
  "season_transition",
  "race_points_edited",
  "team_frozen",
  "team_unfrozen",
  "race_point_model_edited",
  "race_points_regenerated",
]);

const MIGRATION_ACTOR_TYPES = new Set(["cron", "api", "admin", "system", "migration"]);
const MIGRATION_RELATED_ENTITIES = new Set([
  "auction", "loan", "transfer", "swap", "race", "season", "manual",
]);

test("ADMIN_ACTION_TYPE values matcher CHECK-constraint i migration", () => {
  for (const value of Object.values(ADMIN_ACTION_TYPE)) {
    assert.ok(
      MIGRATION_ADMIN_ACTION_TYPES.has(value),
      `ADMIN_ACTION_TYPE.${value} mangler i migration CHECK constraint — INSERT vil fejle på prod`
    );
  }
});

test("Migration CHECK constraint dækker alle ADMIN_ACTION_TYPE enum-values", () => {
  const enumValues = new Set(Object.values(ADMIN_ACTION_TYPE));
  for (const dbValue of MIGRATION_ADMIN_ACTION_TYPES) {
    assert.ok(
      enumValues.has(dbValue),
      `Migration tillader '${dbValue}' men ingen enum-key matcher — risiko for ad-hoc strings i kode`
    );
  }
});

test("FINANCE_ACTOR_TYPE values matcher CHECK-constraint", () => {
  for (const value of Object.values(FINANCE_ACTOR_TYPE)) {
    assert.ok(
      MIGRATION_ACTOR_TYPES.has(value),
      `FINANCE_ACTOR_TYPE.${value} mangler i CHECK constraint`
    );
  }
});

test("FINANCE_RELATED_ENTITY values matcher CHECK-constraint", () => {
  for (const value of Object.values(FINANCE_RELATED_ENTITY)) {
    assert.ok(
      MIGRATION_RELATED_ENTITIES.has(value),
      `FINANCE_RELATED_ENTITY.${value} mangler i CHECK constraint`
    );
  }
});

test("Ingen dublerede string-values inden for hvert enum (forhindrer typo-fald-igennem)", () => {
  for (const [name, frozen] of Object.entries({
    ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON,
  })) {
    const values = Object.values(frozen);
    const unique = new Set(values);
    assert.equal(
      values.length, unique.size,
      `${name} har duplikerede string-values: ${values.length - unique.size} duplets`
    );
  }
});

test("Alle enum-values er snake_case lowercase strings (DB-konvention)", () => {
  const snakeCase = /^[a-z][a-z0-9_]*$/;
  for (const [enumName, frozen] of Object.entries({
    ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON,
  })) {
    for (const [key, value] of Object.entries(frozen)) {
      assert.match(
        value, snakeCase,
        `${enumName}.${key} = "${value}" overholder ikke snake_case (lowercase, _ separator)`
      );
    }
  }
});

test("Enum-objekter er Object.freeze'd (forhindrer runtime-mutation)", () => {
  for (const [name, frozen] of Object.entries({
    ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON,
  })) {
    assert.ok(Object.isFrozen(frozen), `${name} er ikke frozen — kan muteres ved en fejl`);
  }
});

// ============================================================
// 07d Fase B: per-callsite audit-coverage. Hver write-path skal sende
// korrekte actor_type, source_path, reason_code felter til RPC'en — så
// finance_transactions med NULL actor_type aftager til 0 efter udrulning.
// ============================================================

import { processLoanAgreementSeasonFees, createEmergencyLoan, createLoan, repayLoan } from "./loanEngine.js";
import { paySeasonPrizesToDate } from "./prizePayoutEngine.js";

function makeAuditCaptureClient({ teams = {}, loans = [], extras = {} } = {}) {
  const captures = [];
  const balances = new Map(Object.entries(teams).map(([id, t]) => [id, t.balance ?? 0]));

  const tableHandlers = {
    loan_agreements: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: loans, error: null }),
        }),
      }),
    }),
    teams: () => ({
      select: (cols) => ({
        eq: (_c, value) => ({
          single: () => Promise.resolve({
            data: cols === "division" ? { division: 3 } : (teams[value] || null),
            error: null,
          }),
        }),
      }),
    }),
    loan_config: () => ({
      select: () => ({
        eq: () => Promise.resolve({
          data: [{ loan_type: "emergency", origination_fee_pct: 0.15, interest_rate_pct: 0.15, debt_ceiling: 600000 }],
          error: null,
        }),
      }),
    }),
    loans: () => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "loan-x" }, error: null }) }),
      }),
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
    notifications: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
    user_preferences: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    ...extras,
  };

  return {
    captures,
    balances,
    client: {
      rpc(name, params) {
        assert.equal(name, "increment_balance_with_audit");
        const before = balances.get(params.p_team_id) ?? 0;
        const after = before + params.p_delta;
        balances.set(params.p_team_id, after);
        captures.push({ teamId: params.p_team_id, delta: params.p_delta, payload: params.p_finance_payload });
        return Promise.resolve({ data: after, error: null });
      },
      from(table) {
        const handler = tableHandlers[table];
        if (!handler) throw new Error(`Unexpected table: ${table}`);
        return handler();
      },
    },
  };
}

test("processLoanAgreementSeasonFees populerer audit-fields på begge sider (cron)", async () => {
  const fixture = makeAuditCaptureClient({
    loans: [{
      id: "loan-A",
      from_team_id: "lender",
      to_team_id: "borrower",
      loan_fee: 100,
      start_season: 1,
      end_season: 2,
      status: "active",
      rider: { firstname: "X", lastname: "Y" },
    }],
  });

  await processLoanAgreementSeasonFees("borrower", 2, "season-2", fixture.client);

  assert.equal(fixture.captures.length, 2);
  const [payer, receiver] = fixture.captures;
  assert.equal(payer.payload.actor_type, FINANCE_ACTOR_TYPE.CRON);
  assert.equal(payer.payload.source_path, "loanEngine.processLoanAgreementSeasonFees.payer");
  assert.equal(payer.payload.reason_code, FINANCE_REASON.LOAN_FEE_PAID);
  assert.equal(payer.payload.related_entity_type, FINANCE_RELATED_ENTITY.LOAN);
  assert.equal(payer.payload.related_entity_id, "loan-A");
  assert.equal(payer.payload.idempotency_key, "loan_fee_paid:loan-A:season-2");

  assert.equal(receiver.payload.actor_type, FINANCE_ACTOR_TYPE.CRON);
  assert.equal(receiver.payload.source_path, "loanEngine.processLoanAgreementSeasonFees.receiver");
  assert.equal(receiver.payload.reason_code, FINANCE_REASON.LOAN_FEE_RECEIVED);
  assert.equal(receiver.payload.idempotency_key, "loan_fee_received:loan-A:season-2");
});

function makeLoanEngineCaptureClient({ rpcOverride } = {}) {
  const captures = [];
  const client = {
    rpc(name, params) {
      if (rpcOverride) {
        const override = rpcOverride(name, params);
        if (override) return override;
      }
      if (name === "create_emergency_loan_atomic" || name === "create_loan_atomic") {
        // Simulér "function not exposed" → tvinger JS-fallback i loanEngine.
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function not exposed in mock" } });
      }
      assert.equal(name, "increment_balance_with_audit");
      captures.push(params.p_finance_payload);
      return Promise.resolve({ data: 0, error: null });
    },
    from(table) {
      if (table === "seasons") {
        // 07d Fase B / #240: createLoan/repayLoan slår activeSeason op for season_id-stamping.
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "season-active-mock" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "teams") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { division: 3, user_id: "u1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "loan_config") {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{
                loan_type: "emergency",
                origination_fee_pct: 0.15,
                interest_rate_pct: 0.15,
                seasons: 5,
                debt_ceiling: 600000,
              }, {
                loan_type: "short",
                origination_fee_pct: 0.05,
                interest_rate_pct: 0.10,
                seasons: 2,
                debt_ceiling: 600000,
              }],
              error: null,
            }),
          }),
        };
      }
      if (table === "loans") {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "loan-N" }, error: null }),
            }),
          }),
          // #2301 · to query-shapes rammer "loans": app-guardens
          // `.select("*").eq×3.maybeSingle()` (ingen eksisterende lån i denne fixture)
          // og getTotalDebt's `.select("amount_remaining").eq×2`.
          select: (columns) => {
            if (columns === "*") {
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () => Promise.resolve({ data: null, error: null }),
                    }),
                  }),
                }),
              };
            }
            return { eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
          },
        };
      }
      if (table === "notifications") {
        // notificationService bygger lang chain (.select.eq.eq.eq.gte.order.eq.limit).
        // Brug en thenable-builder der opløser til {data:[], error:null} ved await.
        const makeBuilder = () => {
          const builder = {
            eq: () => builder,
            is: () => builder,
            gte: () => builder,
            order: () => builder,
            limit: () => Promise.resolve({ data: [], error: null }),
            then: (onFulfilled) => Promise.resolve({ data: [], error: null }).then(onFulfilled),
          };
          return builder;
        };
        return {
          insert: () => Promise.resolve({ data: null, error: null }),
          select: () => makeBuilder(),
        };
      }
      if (table === "user_preferences") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { captures, client };
}

test("createEmergencyLoan populerer audit-fields (cron)", async () => {
  const fixture = makeLoanEngineCaptureClient();
  await createEmergencyLoan("team-E", 200, fixture.client, "season-1");

  assert.equal(fixture.captures.length, 1);
  const payload = fixture.captures[0];
  assert.equal(payload.actor_type, FINANCE_ACTOR_TYPE.CRON);
  assert.equal(payload.source_path, "loanEngine.createEmergencyLoan");
  assert.equal(payload.reason_code, FINANCE_REASON.EMERGENCY_LOAN_RECEIVED);
  assert.equal(payload.related_entity_type, FINANCE_RELATED_ENTITY.LOAN);
  assert.equal(payload.related_entity_id, "loan-N");
});

test("createLoan respekterer api auditCtx (actor_id propageres)", async () => {
  const fixture = makeLoanEngineCaptureClient({
    rpcOverride: (name) => {
      if (name === "create_loan_atomic") {
        // PGRST202 = funktion findes ikke → falder tilbage til app-niveau path.
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function does not exist" } });
      }
      return null;
    },
  });

  await createLoan("team-L", "short", 50000, fixture.client, {
    actorType: FINANCE_ACTOR_TYPE.API,
    actorId: "user-xyz",
  });

  assert.equal(fixture.captures.length, 1);
  const payload = fixture.captures[0];
  assert.equal(payload.actor_type, FINANCE_ACTOR_TYPE.API);
  assert.equal(payload.actor_id, "user-xyz");
  assert.equal(payload.source_path, "loanEngine.createLoan");
  assert.equal(payload.reason_code, FINANCE_REASON.LOAN_PRINCIPAL_RECEIVED);
  assert.equal(payload.related_entity_type, FINANCE_RELATED_ENTITY.LOAN);
});

test("repayLoan respekterer api auditCtx", async () => {
  const captures = [];
  const loanRow = {
    id: "loan-R",
    team_id: "team-R",
    amount_remaining: 50000,
    status: "active",
  };
  const client = {
    // #2302: repayLoan flyttede fra 2-trins update+increment_balance_with_audit
    // til ét atomisk repay_loan_atomic RPC-kald.
    rpc(name, params) {
      assert.equal(name, "repay_loan_atomic");
      captures.push(params.p_finance_payload);
      const actualAmount = Math.min(params.p_amount, loanRow.amount_remaining);
      const remaining = loanRow.amount_remaining - actualAmount;
      return Promise.resolve({
        data: { paid: actualAmount, remaining, paid_off: remaining <= 0, balance: 100000 - actualAmount },
        error: null,
      });
    },
    from(table) {
      if (table === "seasons") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "season-active-mock" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "loans") {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: loanRow, error: null }) }),
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === "teams") {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: { balance: 100000 }, error: null }) }),
          }),
        };
      }
      if (table === "auctions") {
        return { select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) };
      }
      if (table === "auction_proxy_bids") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === "notifications") {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === "user_preferences") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  await repayLoan("loan-R", "team-R", 25000, client, {
    actorType: FINANCE_ACTOR_TYPE.API,
    actorId: "user-repay",
  });

  assert.equal(captures.length, 1);
  assert.equal(captures[0].actor_type, FINANCE_ACTOR_TYPE.API);
  assert.equal(captures[0].actor_id, "user-repay");
  assert.equal(captures[0].source_path, "loanEngine.repayLoan");
  assert.equal(captures[0].reason_code, FINANCE_REASON.LOAN_REPAYMENT);
  assert.equal(captures[0].related_entity_type, FINANCE_RELATED_ENTITY.LOAN);
  assert.equal(captures[0].related_entity_id, "loan-R");
});

test("paySeasonPrizesToDate populerer admin auditCtx + idempotency_key", async () => {
  const captures = [];
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      captures.push(params.p_finance_payload);
      return Promise.resolve({ data: 5000, error: null });
    },
    from(table) {
      if (table === "races") {
        return {
          select: () => ({
            eq: (_col1, _val1) => ({
              eq: () => Promise.resolve({
                data: [{ id: "race-1", name: "Race A", prize_paid_at: null, status: "completed" }],
                error: null,
              }),
            }),
          }),
          // #1573: update er nu gatet på prize_paid_at IS NULL + .select() der
          // læser de claimede rækker tilbage. Returnér én ramt række (single tick).
          update: () => ({ eq: () => ({ is: () => ({ select: () => Promise.resolve({ data: [{ id: "race-1" }], error: null }) }) }) }),
        };
      }
      if (table === "race_results") {
        // getSeasonPrizePreview paginerer nu (fetchAllRows → .order().range()).
        const rows = [{ race_id: "race-1", team_id: "team-P", prize_money: 5000 }];
        return {
          select: () => ({
            in: () => ({
              gt: () => ({
                order: () => ({
                  range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "teams") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [{ id: "team-P", name: "P" }], error: null }),
          }),
        };
      }
      if (table === "import_log") {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  await paySeasonPrizesToDate("season-1", "admin-99", supabase);

  assert.equal(captures.length, 1);
  assert.equal(captures[0].actor_type, FINANCE_ACTOR_TYPE.ADMIN);
  assert.equal(captures[0].actor_id, "admin-99");
  assert.equal(captures[0].source_path, "prizePayoutEngine.paySeasonPrizesToDate");
  assert.equal(captures[0].reason_code, FINANCE_REASON.RACE_PRIZE_PAYOUT);
  assert.equal(captures[0].related_entity_type, FINANCE_RELATED_ENTITY.RACE);
  assert.equal(captures[0].related_entity_id, "race-1");
  assert.equal(captures[0].idempotency_key, "race_prize:race-1:team-P");
});

// ============================================================
// 07d Fase B / #240: per-callsite static-source audit. Parser kildekoden
// for ALLE incrementBalanceWithAudit-callsites og håndhæver at payload
// indeholder de obligatoriske audit-felter. Forhindrer at "glemt season_id"
// eller "glemt idempotency_key" bug genopstår — som vi så i 07h hvor
// auctionFinalization.js glemte season_id i payload trods triggeren som
// safety-net. Triggeren er ikke en undskyldning for sjuskede callsites.
// ============================================================

// type + amount håndhæves runtime af incrementBalanceWithAudit selv (balanceRpc.js)
// — her listes kun de audit-trail-felter der skal være selv-dokumenterende per callsite.
const MANDATORY_PAYLOAD_KEYS = [
  "season_id",
  "actor_type",
  "actor_id",
  "source_path",
  "reason_code",
  "related_entity_type",
  "related_entity_id",
];

// Source-paths der ER idempotent og SKAL have idempotency_key. Cron-retries
// må ikke double-pay: hvis ét felt mangler her er der reel race-risiko.
// Wrapper-callsites (creditTeam/debitTeam) bruger dynamic source_path og
// dækkes af "creditTeam/debitTeam idempotent options"-testen længere nede.
const IDEMPOTENT_LITERAL_SOURCE_PATHS = new Set([
  "loanEngine.processLoanAgreementSeasonFees.payer",
  "loanEngine.processLoanAgreementSeasonFees.receiver",
  "prizePayoutEngine.paySeasonPrizesToDate",
  "auctionFinalization.finalizeAuctionRecord.buyer",
  "auctionFinalization.finalizeAuctionRecord.seller",
  "auctionFinalization.finalizeAuctionRecord.guaranteedBankSale",
  // #1558: finalizeYouthAuctionRecord.winner debiterer nu via den atomære
  // finalize_academy_acquisition-RPC (ikke incrementBalanceWithAudit), så den er
  // ikke længere et scannet callsite her. idempotency_key bæres stadig i
  // RPC-payloaden (youth_auction_winner:<auctionId>).
]);

const CALLSITE_FILES = [
  { rel: "../routes/api.js", expectedCalls: 9 },
  { rel: "./transferExecution.js", expectedCalls: 4 },
  { rel: "./squadEnforcement.js", expectedCalls: 3 },
  { rel: "./prizePayoutEngine.js", expectedCalls: 1 },
  // #2302: repayLoan's callsite moved from incrementBalanceWithAudit to the
  // atomic repay_loan_atomic RPC (database/2026-07-10-repay-loan-atomic.sql),
  // so callsites here dropped from 5 to 4 (createLoan, createEmergencyLoan,
  // processLoanAgreementSeasonFees.payer + .receiver).
  { rel: "./loanEngine.js", expectedCalls: 4 },
  { rel: "./economyEngine.js", expectedCalls: 2 },
  // #1558: youth-stiens debit flyttede til finalize_academy_acquisition-RPC'en,
  // så incrementBalanceWithAudit-callsites faldt fra 4 til 3 (senior buyer/seller
  // + guaranteedBankSale).
  { rel: "./auctionFinalization.js", expectedCalls: 3 },
];

function extractIncrementCalls(source) {
  const callRegex = /incrementBalanceWithAudit\s*\(/g;
  const calls = [];
  let match;
  while ((match = callRegex.exec(source)) !== null) {
    const callStart = match.index;
    const payloadKeyIdx = source.indexOf("payload:", callStart);
    if (payloadKeyIdx === -1) continue;
    const openIdx = source.indexOf("{", payloadKeyIdx);
    if (openIdx === -1) continue;
    let depth = 1;
    let i = openIdx + 1;
    let inString = null;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (inString) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inString) inString = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
      i++;
    }
    if (depth !== 0) continue;
    const body = source.slice(openIdx + 1, i - 1);
    const line = source.slice(0, callStart).split("\n").length;
    const sourcePathLiteralMatch = body.match(/source_path:\s*"([^"]+)"/);
    calls.push({
      line,
      body,
      sourcePathLiteral: sourcePathLiteralMatch?.[1] ?? null,
    });
  }
  return calls;
}

const ALL_CALLSITES = CALLSITE_FILES.map(({ rel, expectedCalls }) => {
  const filePath = resolve(__dirname, rel);
  const source = readFileSync(filePath, "utf8");
  const calls = extractIncrementCalls(source);
  return { rel, expectedCalls, calls };
});

for (const { rel, expectedCalls, calls } of ALL_CALLSITES) {
  test(`${rel} har ${expectedCalls} incrementBalanceWithAudit-callsites (drift-detector)`, () => {
    assert.equal(
      calls.length,
      expectedCalls,
      `Forventet ${expectedCalls} callsites men fandt ${calls.length}. Hvis du har tilføjet/fjernet et callsite, opdater CALLSITE_FILES i auditTrail.test.js.`,
    );
  });

  for (const { line, body, sourcePathLiteral } of calls) {
    const label = sourcePathLiteral ?? "<dynamic source_path>";
    test(`${rel}:${line} (${label}) — payload har alle obligatoriske audit-felter`, () => {
      const missing = MANDATORY_PAYLOAD_KEYS.filter(
        (key) => !new RegExp(`\\b${key}\\s*:`).test(body),
      );
      assert.deepEqual(
        missing,
        [],
        `Manglende felter: ${missing.join(", ")}. Triggeren er en safety-net, ikke en undskyldning — alle penge-callsites skal være selv-dokumenterende.`,
      );
    });

    if (sourcePathLiteral && IDEMPOTENT_LITERAL_SOURCE_PATHS.has(sourcePathLiteral)) {
      test(`${rel}:${line} (${label}) — idempotent cron-path skal sætte idempotency_key`, () => {
        assert.match(
          body,
          /\bidempotency_key\s*:/,
          `Cron-paths må ikke kunne double-pay ved retries — sæt idempotency_key i payload`,
        );
      });
    }
  }
}

// creditTeam/debitTeam wrappers (economyEngine.js) bygger payload fra
// options.audit; dynamisk source_path → kan ikke verificeres af parser-test
// ovenfor. Test i stedet alle creditTeam/debitTeam-callsites med
// idempotent: true: de SKAL også sætte audit.idempotencyKey.
test("creditTeam/debitTeam-callsites med idempotent: true sætter audit.idempotencyKey", () => {
  const economySource = readFileSync(resolve(__dirname, "./economyEngine.js"), "utf8");
  const callRegex = /(creditTeam|debitTeam)\s*\(/g;
  let match;
  const callsites = [];
  while ((match = callRegex.exec(economySource)) !== null) {
    const start = match.index;
    // Skip funktion-definitioner
    if (/async function\s+$/.test(economySource.slice(0, start))) continue;
    // Slice frem til matching ");" (top-level close af call)
    let depth = 0;
    let i = economySource.indexOf("(", start);
    if (i === -1) continue;
    depth = 1;
    i++;
    let inString = null;
    while (i < economySource.length && depth > 0) {
      const ch = economySource[i];
      if (inString) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inString) inString = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    const body = economySource.slice(start, i);
    const line = economySource.slice(0, start).split("\n").length;
    callsites.push({ line, body });
  }
  assert.ok(callsites.length >= 4, `Fandt ${callsites.length} creditTeam/debitTeam-callsites; forventer mindst 4`);
  for (const { line, body } of callsites) {
    if (/idempotent:\s*true/.test(body)) {
      assert.match(
        body,
        /idempotencyKey\s*:/,
        `economyEngine.js:${line} — idempotent: true uden idempotencyKey: race-vinduer ved cron-retry`,
      );
    }
  }
});
