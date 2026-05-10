// Squad-statistik for Dashboard og lignende oversigter.
//
// Bug #250: tidligere blev `riders.length` brugt direkte, hvilket inkluderer
// ryttere på vej UD (team_id=mit, pending_team_id=andet). Det førte til både
// falske squad-warnings (over-cap når pending-out var i færd med at lette
// holdet) og ignorerede over-cap-situationer (når pending-in trak holdet over
// max efter vinduet lukker). `futureRiderCount` bruger reglen som
// squadEnforcement-cron håndhæver: ejede MINUS udgående PLUS indgående PLUS
// aktive lån.
export const DASHBOARD_SQUAD_LIMITS = {
  1: { min: 20, max: 30 },
  2: { min: 14, max: 20 },
  3: { min: 8, max: 10 },
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

  let warning = null;
  if (futureRiderCount > limits.max) {
    warning = {
      type: "over",
      msg: `Hold er for stort — max ${limits.max} i Division ${division}. Sælg ${futureRiderCount - limits.max} ryttere.`,
      color: "red",
    };
  } else if (futureRiderCount < limits.min) {
    warning = {
      type: "under",
      msg: `Hold er for lille — min ${limits.min} i Division ${division}. Køb ${limits.min - futureRiderCount} ryttere mere.`,
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
