// #3134 — new-account gates (fair-play epic #3131, track C).
//
// Three independent, config-gated guards against day-one account abuse
// (evidence: #2815 — two real teams maxed the debt ceiling within 7-10 minutes
// of signup; #2776 — a throwaway account funnelled ~1.97M CZ$ out within a day
// of creation, seeded by an instant loan + a snipe-bid on an auction that
// started before the account existed):
//
//   1. Loan gate      — no manager-initiated loan until the team has run N
//                        race days OR is X days old (experience gate, not a
//                        pure time gate — active new players unlock faster).
//   2. Transfer/swap
//      cooldown       — outgoing payments at/above a threshold are blocked
//                        during the team's first X hours.
//   3. Auction entry
//      gate           — a team created AFTER an auction started can't bid on
//                        THAT auction (the exact #2776 pattern).
//
// All thresholds live in app_config (database/2026-08-03-new-account-gates.sql).
// 0 (or a missing row) = that condition is disabled; 0 on ALL of a gate's
// keys = the whole gate is off. Ships DEFAULT OFF for every track — including
// track 3, despite the originating issue proposing default-on: a prod dry-run
// (see PR #3134) found 422 historical bids by 53 real teams would have been
// blocked, overwhelmingly ordinary "brand-new player bids on an
// already-running auction within minutes of signup" onboarding, not the
// #2776 funnel pattern. Flagged to the owner; ships gated and ready to flip.
//
// Fail-open on infra errors: a broken config read must never block a loan,
// transfer, or bid that would otherwise be allowed — same philosophy as the
// other runtime flags in this codebase (see featureStage.js).

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const NEW_ACCOUNT_GATE_CONFIG_KEYS = {
  LOAN_MIN_RACE_DAYS: "loan_gate_min_race_days",
  LOAN_MIN_ACCOUNT_AGE_DAYS: "loan_gate_min_account_age_days",
  TRANSFER_COOLDOWN_HOURS: "transfer_cooldown_hours",
  TRANSFER_COOLDOWN_AMOUNT_CZK: "transfer_cooldown_amount_czk",
  AUCTION_ENTRY_GATE_ENABLED: "auction_entry_gate_enabled",
};

function toNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

const DISABLED_CONFIG = Object.freeze({
  loanMinRaceDays: 0,
  loanMinAccountAgeDays: 0,
  transferCooldownHours: 0,
  transferCooldownAmountCzk: 0,
  auctionEntryGateEnabled: false,
});

// I/O: batch-read all 5 keys in one round trip. Fail-open — any error (missing
// table in a test double, network hiccup, malformed rows) resolves to the
// all-disabled config rather than throwing, so a telemetry-style outage can
// never block a loan/transfer/bid that would otherwise succeed.
export async function readNewAccountGateConfig(supabase) {
  try {
    const keys = Object.values(NEW_ACCOUNT_GATE_CONFIG_KEYS);
    const { data, error } = await supabase.from("app_config").select("key, value").in("key", keys);
    if (error) return { ...DISABLED_CONFIG };
    const byKey = new Map((data || []).map((row) => [row.key, row.value]));
    return {
      loanMinRaceDays: toNonNegativeInt(byKey.get(NEW_ACCOUNT_GATE_CONFIG_KEYS.LOAN_MIN_RACE_DAYS), 0),
      loanMinAccountAgeDays: toNonNegativeInt(byKey.get(NEW_ACCOUNT_GATE_CONFIG_KEYS.LOAN_MIN_ACCOUNT_AGE_DAYS), 0),
      transferCooldownHours: toNonNegativeInt(byKey.get(NEW_ACCOUNT_GATE_CONFIG_KEYS.TRANSFER_COOLDOWN_HOURS), 0),
      transferCooldownAmountCzk: toNonNegativeInt(byKey.get(NEW_ACCOUNT_GATE_CONFIG_KEYS.TRANSFER_COOLDOWN_AMOUNT_CZK), 0),
      auctionEntryGateEnabled: byKey.get(NEW_ACCOUNT_GATE_CONFIG_KEYS.AUCTION_ENTRY_GATE_ENABLED) === true,
    };
  } catch {
    return { ...DISABLED_CONFIG };
  }
}

export function accountAgeDays(createdAt, now = new Date()) {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, (now.getTime() - created) / MS_PER_DAY);
}

export function accountAgeHours(createdAt, now = new Date()) {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, (now.getTime() - created) / MS_PER_HOUR);
}

// Pure: evaluate the loan gate for one team.
//
// OR-semantics per condition: a condition only counts if its threshold is > 0.
// Both thresholds 0 → gate off (`allowed: true` immediately). Exactly one > 0
// → only that condition gates. Both > 0 → unlocked by whichever is reached
// first (experience-gate intent — an active player shouldn't wait out a
// calendar timer if they've already raced enough).
export function evaluateLoanGate({ minRaceDays, minAccountAgeDays, raceDaysRun = 0, teamCreatedAt, now = new Date() }) {
  const raceDaysEnabled = minRaceDays > 0;
  const ageEnabled = minAccountAgeDays > 0;
  if (!raceDaysEnabled && !ageEnabled) {
    return { allowed: true };
  }

  const ageDays = accountAgeDays(teamCreatedAt, now);
  const passRaceDays = raceDaysEnabled && raceDaysRun >= minRaceDays;
  const passAge = ageEnabled && ageDays >= minAccountAgeDays;
  if (passRaceDays || passAge) return { allowed: true };

  const reason = raceDaysEnabled && ageEnabled ? "either" : raceDaysEnabled ? "raceDaysOnly" : "accountAgeOnly";
  return {
    allowed: false,
    reason,
    minRaceDays: raceDaysEnabled ? minRaceDays : null,
    minAccountAgeDays: ageEnabled ? minAccountAgeDays : null,
    raceDaysRun,
    accountAgeDays: Math.floor(ageDays * 10) / 10,
  };
}

// Pure: evaluate the outgoing transfer/swap cooldown for the PAYING team.
// Both cooldownHours and cooldownAmount must be > 0 for the gate to be
// active at all (0 on either = disabled, per the "0/0 = off" contract).
export function evaluateTransferCooldown({ cooldownHours, cooldownAmount, amount, payingTeamCreatedAt, now = new Date() }) {
  if (!(cooldownHours > 0) || !(cooldownAmount > 0)) return { allowed: true };
  if (!(amount >= cooldownAmount)) return { allowed: true };

  const ageHours = accountAgeHours(payingTeamCreatedAt, now);
  if (ageHours >= cooldownHours) return { allowed: true };

  const unlocksInHours = Math.max(0, cooldownHours - ageHours);
  return {
    allowed: false,
    cooldownHours,
    cooldownAmount,
    unlocksInHours: Math.ceil(unlocksInHours * 10) / 10,
  };
}

// Pure: evaluate the auction entry gate — blocked only when the team's
// account was created strictly AFTER the auction itself was created.
export function evaluateAuctionEntryGate({ enabled, teamCreatedAt, auctionCreatedAt }) {
  if (!enabled) return { allowed: true };
  if (!teamCreatedAt || !auctionCreatedAt) return { allowed: true };

  const teamCreated = new Date(teamCreatedAt).getTime();
  const auctionCreated = new Date(auctionCreatedAt).getTime();
  if (!Number.isFinite(teamCreated) || !Number.isFinite(auctionCreated)) return { allowed: true };

  if (teamCreated > auctionCreated) return { allowed: false };
  return { allowed: true };
}

// I/O: distinct COMPLETED race days a team has actually run — race_entries
// joined to races, counting distinct game_day_start (same unit as
// seasonRaceDays.countDistinctRaceDays, but scoped to one team's own
// experience rather than a whole season's calendar).
export async function getTeamRaceDaysRun(supabase, teamId) {
  const { data: entries, error } = await supabase
    .from("race_entries")
    .select("race_id")
    .eq("team_id", teamId);
  if (error) throw error;

  const raceIds = [...new Set((entries || []).map((e) => e.race_id).filter(Boolean))];
  if (raceIds.length === 0) return 0;

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("game_day_start, status")
    .in("id", raceIds)
    .eq("status", "completed");
  if (racesError) throw racesError;

  const days = new Set();
  for (const race of races || []) {
    const day = race?.game_day_start;
    if (day === null || day === undefined || !Number.isFinite(Number(day))) continue;
    days.add(Number(day));
  }
  return days.size;
}
