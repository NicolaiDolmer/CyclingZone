export const MARKET_SQUAD_LIMITS = {
  1: { min: 20, max: 30 },
  2: { min: 14, max: 20 },
  3: { min: 8, max: 10 },
};

// #267: under et åbent transfervindue må manageren overskride division-cap
// midlertidigt med dette buffer (D1 → 32, D2 → 22, D3 → 12). Når vinduet
// lukker auto-sælger squadEnforcement-cron ned til hard-cap og fakturer
// SQUAD_FINE_AMOUNT + SQUAD_PENALTY_POINTS pr. afvigende rytter — så
// soft-cap koster spilleren bagud, men auktion-vindere bliver ikke
// længere afvist i døren.
export const TRANSFER_WINDOW_SOFT_CAP_BUFFER = 2;

export const MIN_RIDERS_FOR_RACE = 8;
export const RIDER_VALUE_FACTOR = 4000;
export const MIN_RIDER_UCI_POINTS = 5;

const DEFAULT_DIVISION = 3;

export function ensureNoError(error) {
  if (error) {
    throw new Error(error.message);
  }
}

export async function expectSingle(query) {
  const { data, error } = await query.single();
  ensureNoError(error);
  return data;
}

export async function expectMaybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  ensureNoError(error);
  return data;
}

export async function expectCount(query) {
  const { count, error } = await query;
  ensureNoError(error);
  return count || 0;
}

export async function expectMutation(query) {
  const { error } = await query;
  ensureNoError(error);
}

export function getSquadLimits(division = DEFAULT_DIVISION) {
  return MARKET_SQUAD_LIMITS[division] || MARKET_SQUAD_LIMITS[DEFAULT_DIVISION];
}

export function calculateRiderBaseValue(rider = {}) {
  return Math.max(MIN_RIDER_UCI_POINTS, Number(rider.uci_points) || 0) * RIDER_VALUE_FACTOR;
}

export function calculateRiderMarketValue(rider = {}) {
  return calculateRiderBaseValue(rider) + (Number(rider.prize_earnings_bonus) || 0);
}

export async function getTransferWindowOpen(supabase) {
  const latestWindow = await expectMaybeSingle(
    supabase
      .from("transfer_windows")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(1)
  );

  return latestWindow?.status === "open";
}

export async function getTeamMarketState(supabase, teamId) {
  const team = await expectSingle(
    supabase
      .from("teams")
      .select("id, name, balance, division, user_id")
      .eq("id", teamId)
  );

  const [riderCount, pendingCount, activeLoanCount] = await Promise.all([
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
    ),
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("pending_team_id", teamId)
    ),
    expectCount(
      supabase
        .from("loan_agreements")
        .select("id", { count: "exact", head: true })
        .eq("to_team_id", teamId)
        .eq("status", "active")
    ),
  ]);

  const squadLimits = getSquadLimits(team.division);

  return {
    ...team,
    rider_count: riderCount,
    pending_count: pendingCount,
    active_loan_count: activeLoanCount,
    total_count: riderCount + pendingCount + activeLoanCount,
    squad_limits: squadLimits,
  };
}

// #267: softCapBuffer = ekstra ryttere over hard-cap'en der tillades MIDT i et
// åbent transfervindue. Defaulter til 0 (= hard-cap) for bagudkompat på
// callsites der ikke kender vindue-state. Brug TRANSFER_WINDOW_SOFT_CAP_BUFFER
// (2) når windowOpen er bekræftet — squadEnforcement-cron straffer
// over-cap-ryttere ved vindue-luk.
export function getIncomingSquadViolation(
  teamState,
  { incomingCount = 1, softCapBuffer = 0 } = {}
) {
  const totalAfter = (teamState?.total_count || 0) + incomingCount;
  const maxRiders = teamState?.squad_limits?.max || getSquadLimits(teamState?.division).max;
  const buffer = Number(softCapBuffer) || 0;
  const effectiveCap = maxRiders + buffer;

  if (totalAfter > effectiveCap) {
    return { totalAfter, maxRiders, effectiveCap, softCapBuffer: buffer };
  }

  return null;
}

export function getOutgoingSquadViolation(teamState, outgoingCount = 1) {
  const totalAfter = (teamState?.total_count || 0) - outgoingCount;
  const minRiders = teamState?.squad_limits?.min || getSquadLimits(teamState?.division).min;

  if (totalAfter < minRiders) {
    return { totalAfter, minRiders };
  }

  return null;
}
