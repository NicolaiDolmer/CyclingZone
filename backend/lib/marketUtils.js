export const MARKET_SQUAD_LIMITS = {
  1: { min: 20, max: 30 },
  2: { min: 14, max: 20 },
  3: { min: 8, max: 10 },
};

export const MIN_RIDERS_FOR_RACE = 8;

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

export function calculateMarketSalary(price) {
  return Math.max(1, Math.ceil((price || 0) * 0.1));
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

export function getIncomingSquadViolation(teamState, incomingCount = 1) {
  const totalAfter = (teamState?.total_count || 0) + incomingCount;
  const maxRiders = teamState?.squad_limits?.max || getSquadLimits(teamState?.division).max;

  if (totalAfter > maxRiders) {
    return { totalAfter, maxRiders };
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
