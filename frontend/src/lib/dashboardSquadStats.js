// Squad-statistik for Dashboard og lignende oversigter.
//
// Bug #250: tidligere blev `riders.length` brugt direkte, hvilket inkluderer
// ryttere på vej UD (team_id=mit, pending_team_id=andet). Det førte til både
// falske squad-warnings (over-cap når pending-out var i færd med at lette
// holdet) og ignorerede over-cap-situationer (når pending-in trak holdet over
// max efter vinduet lukker). `futureRiderCount` bruger reglen som
// squadEnforcement-cron håndhæver: ejede MINUS udgående PLUS indgående PLUS
// aktive lån.
// #838: max ensrettet til ét fælles loft på 30 for alle divisioner. Skal matche
// backend MARKET_SQUAD_LIMITS (marketUtils.js) — frontend kan ikke importere
// backend-bundlen, så værdierne dupes bevidst her.
const MAX_SQUAD_SIZE = 30;

export const DASHBOARD_SQUAD_LIMITS = {
  1: { min: 20, max: MAX_SQUAD_SIZE },
  2: { min: 14, max: MAX_SQUAD_SIZE },
  3: { min: 8, max: MAX_SQUAD_SIZE },
};

export function getSquadLimits(division) {
  return DASHBOARD_SQUAD_LIMITS[division] || DASHBOARD_SQUAD_LIMITS[3];
}

export function computeDashboardSquadStats({
  riders = [],
  pendingIncomingCount = 0,
  activeLoanCount = 0,
  myTeamId,
  division,
}) {
  const ownedNow = riders.length;
  const outgoingCount = riders.filter(
    (r) => r?.pending_team_id && r.pending_team_id !== myTeamId,
  ).length;

  const futureRiderCount =
    ownedNow - outgoingCount + pendingIncomingCount + activeLoanCount;

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
    activeLoanCount,
    futureRiderCount,
    limits,
    warning,
  };
}
