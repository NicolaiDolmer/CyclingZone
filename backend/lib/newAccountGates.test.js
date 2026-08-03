import test from "node:test";
import assert from "node:assert/strict";

import {
  NEW_ACCOUNT_GATE_CONFIG_KEYS,
  accountAgeDays,
  accountAgeHours,
  evaluateAuctionEntryGate,
  evaluateLoanGate,
  evaluateTransferCooldown,
  getTeamRaceDaysRun,
  readNewAccountGateConfig,
} from "./newAccountGates.js";

const NOW = new Date("2026-08-03T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ── accountAgeDays / accountAgeHours ──────────────────────────────────────────

test("accountAgeDays/accountAgeHours: null/invalid createdAt → 0", () => {
  assert.equal(accountAgeDays(null, NOW), 0);
  assert.equal(accountAgeDays("not-a-date", NOW), 0);
  assert.equal(accountAgeHours(undefined, NOW), 0);
});

test("accountAgeDays/accountAgeHours: computes elapsed time, never negative", () => {
  const createdAt = new Date(NOW.getTime() - 2 * DAY).toISOString();
  assert.equal(accountAgeDays(createdAt, NOW), 2);
  assert.equal(accountAgeHours(createdAt, NOW), 48);

  // Future timestamp (clock skew) → clamped to 0, not negative.
  const future = new Date(NOW.getTime() + DAY).toISOString();
  assert.equal(accountAgeDays(future, NOW), 0);
});

// ── evaluateLoanGate ───────────────────────────────────────────────────────────

test("evaluateLoanGate: 0/0 → gate disabled, always allowed", () => {
  const result = evaluateLoanGate({
    minRaceDays: 0,
    minAccountAgeDays: 0,
    raceDaysRun: 0,
    teamCreatedAt: NOW.toISOString(), // brand-new, would fail every real condition
    now: NOW,
  });
  assert.deepEqual(result, { allowed: true });
});

test("evaluateLoanGate: only minRaceDays set — blocks until enough race days, ignores age", () => {
  const veryOld = new Date(NOW.getTime() - 365 * DAY).toISOString();
  const blocked = evaluateLoanGate({
    minRaceDays: 3, minAccountAgeDays: 0, raceDaysRun: 2, teamCreatedAt: veryOld, now: NOW,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "raceDaysOnly");
  assert.equal(blocked.minRaceDays, 3);
  assert.equal(blocked.minAccountAgeDays, null);

  const allowed = evaluateLoanGate({
    minRaceDays: 3, minAccountAgeDays: 0, raceDaysRun: 3, teamCreatedAt: NOW.toISOString(), now: NOW,
  });
  assert.equal(allowed.allowed, true);
});

test("evaluateLoanGate: only minAccountAgeDays set — blocks until old enough, ignores race days", () => {
  const brandNew = NOW.toISOString();
  const blocked = evaluateLoanGate({
    minRaceDays: 0, minAccountAgeDays: 3, raceDaysRun: 50, teamCreatedAt: brandNew, now: NOW,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "accountAgeOnly");
  assert.equal(blocked.minAccountAgeDays, 3);
  assert.equal(blocked.minRaceDays, null);

  const threeDaysOld = new Date(NOW.getTime() - 3 * DAY).toISOString();
  const allowed = evaluateLoanGate({
    minRaceDays: 0, minAccountAgeDays: 3, raceDaysRun: 0, teamCreatedAt: threeDaysOld, now: NOW,
  });
  assert.equal(allowed.allowed, true);
});

test("evaluateLoanGate: both set — OR semantics, unlocked by whichever condition is met first", () => {
  const brandNew = NOW.toISOString();

  // Neither condition met → blocked.
  const blocked = evaluateLoanGate({
    minRaceDays: 3, minAccountAgeDays: 3, raceDaysRun: 0, teamCreatedAt: brandNew, now: NOW,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "either");

  // Race days met, account still brand new → allowed via race days.
  const viaRaceDays = evaluateLoanGate({
    minRaceDays: 3, minAccountAgeDays: 3, raceDaysRun: 3, teamCreatedAt: brandNew, now: NOW,
  });
  assert.equal(viaRaceDays.allowed, true);

  // Account old enough, zero race days → allowed via age.
  const viaAge = evaluateLoanGate({
    minRaceDays: 3, minAccountAgeDays: 3, raceDaysRun: 0, teamCreatedAt: new Date(NOW.getTime() - 3 * DAY).toISOString(), now: NOW,
  });
  assert.equal(viaAge.allowed, true);
});

// ── evaluateTransferCooldown ───────────────────────────────────────────────────

test("evaluateTransferCooldown: cooldownHours=0 or cooldownAmount=0 → disabled", () => {
  assert.equal(evaluateTransferCooldown({
    cooldownHours: 0, cooldownAmount: 100000, amount: 500000, payingTeamCreatedAt: NOW.toISOString(), now: NOW,
  }).allowed, true);
  assert.equal(evaluateTransferCooldown({
    cooldownHours: 24, cooldownAmount: 0, amount: 500000, payingTeamCreatedAt: NOW.toISOString(), now: NOW,
  }).allowed, true);
});

test("evaluateTransferCooldown: amount below threshold is never blocked, even for a brand-new account", () => {
  const result = evaluateTransferCooldown({
    cooldownHours: 24, cooldownAmount: 100000, amount: 99999, payingTeamCreatedAt: NOW.toISOString(), now: NOW,
  });
  assert.equal(result.allowed, true);
});

test("evaluateTransferCooldown: large payment from a brand-new account is blocked, reports hours remaining", () => {
  const result = evaluateTransferCooldown({
    cooldownHours: 24, cooldownAmount: 100000, amount: 650000, payingTeamCreatedAt: NOW.toISOString(), now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.cooldownHours, 24);
  assert.equal(result.cooldownAmount, 100000);
  assert.equal(result.unlocksInHours, 24);
});

test("evaluateTransferCooldown: allowed once the account has aged past cooldownHours", () => {
  const oldEnough = new Date(NOW.getTime() - 25 * HOUR).toISOString();
  const result = evaluateTransferCooldown({
    cooldownHours: 24, cooldownAmount: 100000, amount: 650000, payingTeamCreatedAt: oldEnough, now: NOW,
  });
  assert.equal(result.allowed, true);
});

// ── evaluateAuctionEntryGate ───────────────────────────────────────────────────

test("evaluateAuctionEntryGate: disabled flag → always allowed", () => {
  const result = evaluateAuctionEntryGate({
    enabled: false,
    teamCreatedAt: NOW.toISOString(),
    auctionCreatedAt: new Date(NOW.getTime() - DAY).toISOString(),
  });
  assert.equal(result.allowed, true);
});

test("evaluateAuctionEntryGate: team created AFTER the auction started → blocked", () => {
  const auctionCreatedAt = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(); // 10 min ago
  const teamCreatedAt = NOW.toISOString(); // just now — after the auction started
  const result = evaluateAuctionEntryGate({ enabled: true, teamCreatedAt, auctionCreatedAt });
  assert.equal(result.allowed, false);
});

test("evaluateAuctionEntryGate: team predates the auction → allowed (the normal case)", () => {
  const teamCreatedAt = new Date(NOW.getTime() - 30 * DAY).toISOString();
  const auctionCreatedAt = new Date(NOW.getTime() - HOUR).toISOString();
  const result = evaluateAuctionEntryGate({ enabled: true, teamCreatedAt, auctionCreatedAt });
  assert.equal(result.allowed, true);
});

test("evaluateAuctionEntryGate: missing timestamps fail open (never block on missing data)", () => {
  assert.equal(evaluateAuctionEntryGate({ enabled: true, teamCreatedAt: null, auctionCreatedAt: NOW.toISOString() }).allowed, true);
  assert.equal(evaluateAuctionEntryGate({ enabled: true, teamCreatedAt: NOW.toISOString(), auctionCreatedAt: null }).allowed, true);
});

// ── readNewAccountGateConfig (I/O, fail-open) ─────────────────────────────────

function makeConfigSupabase(rows) {
  return {
    from(table) {
      assert.equal(table, "app_config");
      return {
        select(cols) {
          assert.equal(cols, "key, value");
          return {
            in(col, keys) {
              assert.equal(col, "key");
              assert.equal(keys.length, Object.values(NEW_ACCOUNT_GATE_CONFIG_KEYS).length);
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
  };
}

test("readNewAccountGateConfig: no rows → all-disabled defaults", async () => {
  const config = await readNewAccountGateConfig(makeConfigSupabase([]));
  assert.deepEqual(config, {
    loanMinRaceDays: 0,
    loanMinAccountAgeDays: 0,
    transferCooldownHours: 0,
    transferCooldownAmountCzk: 0,
    auctionEntryGateEnabled: false,
  });
});

test("readNewAccountGateConfig: parses configured rows", async () => {
  const rows = [
    { key: "loan_gate_min_race_days", value: 3 },
    { key: "loan_gate_min_account_age_days", value: 2 },
    { key: "transfer_cooldown_hours", value: 24 },
    { key: "transfer_cooldown_amount_czk", value: 100000 },
    { key: "auction_entry_gate_enabled", value: true },
  ];
  const config = await readNewAccountGateConfig(makeConfigSupabase(rows));
  assert.deepEqual(config, {
    loanMinRaceDays: 3,
    loanMinAccountAgeDays: 2,
    transferCooldownHours: 24,
    transferCooldownAmountCzk: 100000,
    auctionEntryGateEnabled: true,
  });
});

test("readNewAccountGateConfig: negative/garbage values fall back to 0 (never a negative threshold)", async () => {
  const rows = [
    { key: "loan_gate_min_race_days", value: -5 },
    { key: "transfer_cooldown_hours", value: "not-a-number" },
  ];
  const config = await readNewAccountGateConfig(makeConfigSupabase(rows));
  assert.equal(config.loanMinRaceDays, 0);
  assert.equal(config.transferCooldownHours, 0);
});

test("readNewAccountGateConfig: fail-open — a DB error never throws, resolves to all-disabled", async () => {
  const throwingSupabase = {
    from() {
      return { select() { return { in() { return Promise.resolve({ data: null, error: { message: "db down" } }); } }; } };
    },
  };
  const config = await readNewAccountGateConfig(throwingSupabase);
  assert.equal(config.loanMinRaceDays, 0);
  assert.equal(config.auctionEntryGateEnabled, false);
});

test("readNewAccountGateConfig: fail-open — a thrown exception (e.g. unrecognized table in a test double) never propagates", async () => {
  const explodingSupabase = {
    from() { throw new Error("Unexpected table: app_config"); },
  };
  const config = await readNewAccountGateConfig(explodingSupabase);
  assert.deepEqual(config, {
    loanMinRaceDays: 0,
    loanMinAccountAgeDays: 0,
    transferCooldownHours: 0,
    transferCooldownAmountCzk: 0,
    auctionEntryGateEnabled: false,
  });
});

// ── getTeamRaceDaysRun (I/O) ───────────────────────────────────────────────────

function makeRaceDaysSupabase({ entries, races }) {
  return {
    from(table) {
      if (table === "race_entries") {
        return {
          select(cols) {
            assert.equal(cols, "race_id");
            return { eq(col, val) { assert.equal(col, "team_id"); assert.equal(val, "team-1"); return Promise.resolve({ data: entries, error: null }); } };
          },
        };
      }
      if (table === "races") {
        return {
          select(cols) {
            assert.equal(cols, "game_day_start, status");
            return {
              in(col, ids) {
                assert.equal(col, "id");
                return { eq(statusCol, statusVal) {
                  assert.equal(statusCol, "status");
                  assert.equal(statusVal, "completed");
                  const filtered = races.filter((r) => ids.includes(r.id) && r.status === "completed");
                  return Promise.resolve({ data: filtered, error: null });
                } };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("getTeamRaceDaysRun: no race entries → 0", async () => {
  const supabase = makeRaceDaysSupabase({ entries: [], races: [] });
  assert.equal(await getTeamRaceDaysRun(supabase, "team-1"), 0);
});

test("getTeamRaceDaysRun: counts DISTINCT completed game days, ignores scheduled races and dedupes multi-rider entries on the same day", async () => {
  const supabase = makeRaceDaysSupabase({
    entries: [
      { race_id: "race-a" }, { race_id: "race-a2" }, // same day, two entries (e.g. two riders)
      { race_id: "race-b" },
      { race_id: "race-scheduled" },
    ],
    races: [
      { id: "race-a", game_day_start: 1, status: "completed" },
      { id: "race-a2", game_day_start: 1, status: "completed" },
      { id: "race-b", game_day_start: 2, status: "completed" },
      { id: "race-scheduled", game_day_start: 3, status: "scheduled" },
    ],
  });
  assert.equal(await getTeamRaceDaysRun(supabase, "team-1"), 2);
});
