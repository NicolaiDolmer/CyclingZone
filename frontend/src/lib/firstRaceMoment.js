// #3310 comeback-buen: afgør om dashboardet skal vise "Your first race"-varianten.
// Første løb = ingen tidligere løb i historikken OG sæson-totalen tæller højst det
// viste løb (null = RPC ikke anvendt endnu → behandles som muligt-første).
// seen er server-flaget teams.my_result_seen_race_id (#2593 del 2).
export function isFirstRaceMoment(data) {
  const race = data?.race;
  if (!race || race.seen) return false;
  const historyCount = Array.isArray(data.history) ? data.history.length : 0;
  const seasonRaces = data.season_totals?.races;
  return historyCount === 0 && (seasonRaces == null || seasonRaces <= 1);
}
