// Squad-statistik for Dashboard og lignende oversigter.
//
// Bug #250: tidligere blev `riders.length` brugt direkte, hvilket inkluderer
// ryttere på vej UD (team_id=mit, pending_team_id=andet). Det førte til både
// falske squad-warnings (over-cap når pending-out var i færd med at lette
// holdet) og ignorerede over-cap-situationer (når pending-in trak holdet over
// max efter vinduet lukker). `futureRiderCount` bruger reglen som
// squadEnforcement-cron håndhæver: ejede MINUS udgående PLUS indgående PLUS
// indgående lån.
// #838: max ensrettet til ét fælles loft på 30 for alle divisioner. Skal matche
// backend MARKET_SQUAD_LIMITS (marketUtils.js) — frontend kan ikke importere
// backend-bundlen, så værdierne dupes bevidst her.
// Roster-floor fjernet 2026-06-05: min=0 → dashboard viser aldrig "under minimum".
const MAX_SQUAD_SIZE = 30;

export const DASHBOARD_SQUAD_LIMITS = {
  1: { min: 0, max: MAX_SQUAD_SIZE },
  2: { min: 0, max: MAX_SQUAD_SIZE },
  3: { min: 0, max: MAX_SQUAD_SIZE },
};

// #1090: SKAL matche backend getTeamMarketState (marketUtils.js) — den
// autoritative kapacitets-beregning som auktions-/transfer-/swap-/lån-
// validering bruger. "window_pending" = lejeaftale accepteret mens vinduet
// var lukket; rytteren ankommer når vinduet åbner (næste sæson), så han
// tæller med i fremtidens trup. "buyout_pending" er BEVIDST udeladt: en
// parkeret buyout sætter rider.pending_team_id = lejer, så rytteren tælles
// allerede via pending-incoming — at tælle lånet også ville dobbelt-tælle.
export const INCOMING_LOAN_STATUSES = ["active", "window_pending"];

export function getSquadLimits(division) {
  return DASHBOARD_SQUAD_LIMITS[division] || DASHBOARD_SQUAD_LIMITS[3];
}

// #1090: hent tælle-input til computeDashboardSquadStats med PRÆCIS samme
// diskriminatorer som backend getTeamMarketState (marketUtils.js):
//   - pending-incoming: pending_team_id = mig. `or(team_id.is.null,...)` i
//     stedet for bare `.neq(team_id, mig)`, fordi SQL's trevalente logik
//     ellers smider ryttere med team_id = NULL (fri agent vundet på auktion
//     mens vinduet var lukket) ud af tællingen.
//   - indgående lån: status IN ("active", "window_pending") — ikke kun
//     "active", ellers er en lejeaftale parkeret til næste vindue usynlig
//     for trupstørrelse-advarslen.
export async function fetchSquadCountInputs(supabase, teamId) {
  const [pendingIncomingRes, loansInRes] = await Promise.all([
    supabase
      .from("riders")
      .select("id", { count: "exact", head: true })
      .eq("pending_team_id", teamId)
      .or(`team_id.is.null,team_id.neq.${teamId}`),
    supabase
      .from("loan_agreements")
      .select("id", { count: "exact", head: true })
      .eq("to_team_id", teamId)
      .in("status", INCOMING_LOAN_STATUSES),
  ]);

  return {
    pendingIncomingCount: pendingIncomingRes.count || 0,
    incomingLoanCount: loansInRes.count || 0,
  };
}

export function computeDashboardSquadStats({
  riders = [],
  pendingIncomingCount = 0,
  incomingLoanCount = 0,
  myTeamId,
  division,
}) {
  const ownedNow = riders.length;
  const outgoingCount = riders.filter(
    (r) => r?.pending_team_id && r.pending_team_id !== myTeamId,
  ).length;

  const futureRiderCount =
    ownedNow - outgoingCount + pendingIncomingCount + incomingLoanCount;

  const limits = getSquadLimits(division);

  // Warning er pure data; strengbygning sker i UI'et (i18n). `count` er antal
  // ryttere brugeren skal købe/sælge for at lande inden for cap.
  let warning = null;
  if (futureRiderCount > limits.max) {
    warning = {
      type: "over",
      count: futureRiderCount - limits.max,
      limit: limits.max,
      division,
      color: "red",
    };
  } else if (futureRiderCount < limits.min) {
    warning = {
      type: "under",
      count: limits.min - futureRiderCount,
      limit: limits.min,
      division,
      color: "orange",
    };
  }

  return {
    ownedNow,
    outgoingCount,
    pendingIncomingCount,
    incomingLoanCount,
    futureRiderCount,
    limits,
    warning,
  };
}
