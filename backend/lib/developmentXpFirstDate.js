// #6110 (ejervalg B 19/11): tændingsnattens udbetaling gælder rytterens FØRSTE XP-dato.
//
// Under XP udbetales en gemt bjælke fra dagens model helt på én nat (R10, ejervalg 2 = A),
// undtaget fra datoreglen (+1, +2 for et toptalent på en meget lav evne). Indtil nu var den
// nat kun selve startdatoen (`development_xp_from_date`). En rytter, der var skadet, sad på
// en bunden hviledag eller havde en uafklaret plads den nat, fik intet udviklings-tick, og hans
// gemte fremgang kom derfor ud med datoreglen over mange datoer. Ejeren valgte 19/11, at han
// i stedet får det hele på én nat, når han første gang udvikler sig under XP.
//
// Reglen: på en dato efter startdatoen er udbetalingen tændt for en rytter, der ikke har en
// kvittering (training_rider_ticks) fra en tidligere XP-dato, hvor udviklingen kørte
// (`report.xp_developed === true`). På startdatoen selv gælder den for alle som før.
// Ejervalg 19/11 (forbehold 4, "kun ryttere på managerhold ved tænding"): rytteren skal have
// stået på et managerhold ved startdatoens slutning. Det afgøres af ejerskabet (Fable-dom 19/11,
// fund A): holdet efter rytterens seneste ejerskifte før startdatoens slutning
// (rider_ownership_events), ellers afsenderholdet i det første skifte bagefter, ellers hans
// nuværende hold. Kvitteringens markør (`report.xp_ignition_manager`) tæller også som bevis.
// Så mister en managerrytter i karantæne, på et frosset eller divisionsløst hold eller i en
// trup købt samme dag ikke udbetalingen, fordi kvitteringen mangler. En rytter på et AI-hold,
// i banken, på et testhold eller fri på startdatoen får ingen udbetaling; hans bjælke følger
// datoreglen som alle andres.
//
// Kun med XP tændt og dato-kvitteringerne (training_condition_per_date); ellers er svaret
// null, og motoren bruger startdatoen alene (som før). Kun ryttere med en bjælke på mindst ét
// point kan få noget udbetalt, så kun de slås op.
import { fetchAllRows } from "./supabasePagination.js";
import { trainingDateBounds } from "./trainingDateReadiness.js";
import { isManagerTeamForDevelopment } from "./managerTeamForDevelopment.js";

/** Ryttere med en gemt bjælke på mindst ét point i en evne (kun de kan få noget udbetalt). */
export function xpStoredBarRiderIds(abilityRows) {
  const ids = [];
  for (const row of abilityRows ?? []) {
    const progress = row?.ability_progress;
    if (!progress || typeof progress !== "object") continue;
    if (Object.values(progress).some((bar) => Number(bar) >= 1)) ids.push(row.rider_id);
  }
  return ids;
}

/**
 * Ryttere, hvis gemte fremgang udbetales helt på denne dato, fordi det er deres første
 * XP-dato efter startdatoen. null = reglen gælder ikke her (motoren bruger startdatoen alene).
 * Kaster ved en databasefejl, så tick'et prøves igen i stedet for at udbetale forkert.
 */
/**
 * Holdet, rytteren stod på ved `endIso`, ud fra hans ejerskifter (sorteret efter tid) og hans
 * nuværende hold. null = fri (intet hold).
 */
export function teamAtTime(events, currentTeamId, endIso) {
  const end = new Date(endIso).getTime();
  // Ens tidsstempler: id afgør rækkefølgen, så svaret er stabilt.
  const sorted = [...(events ?? [])].sort((a, b) => (new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
    || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  let before = null;
  let firstAfter = null;
  for (const event of sorted) {
    const at = new Date(event.occurred_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (at < end) before = event;
    else if (!firstAfter) firstAfter = event;
  }
  if (before) return before.to_team_id ?? null;
  if (firstAfter) return firstAfter.from_team_id ?? null;
  return currentTeamId ?? null;
}

export async function loadXpFirstDatePayoutRiderIds({
  supabase, developmentXp, developmentXpIgnition, xpFromDate, conditionPerDate, developmentAllowed, tickDate, abilityRows,
  teamId = null,
}) {
  if (!developmentXp || developmentXpIgnition === true || !conditionPerDate || developmentAllowed === false) return null;
  if (typeof xpFromDate !== "string" || typeof tickDate !== "string" || !(tickDate > xpFromDate)) return null;
  const candidates = xpStoredBarRiderIds(abilityRows);
  if (candidates.length === 0) return new Set();
  const rows = await fetchAllRows(() => supabase.from("training_rider_ticks").select("rider_id")
    .in("rider_id", candidates)
    .gte("tick_date", xpFromDate)
    .lt("tick_date", tickDate)
    .eq("report->>xp_developed", "true")
    .order("rider_id")
    .order("tick_date"));
  const alreadyDeveloped = new Set(rows.map((row) => row.rider_id));
  const pending = candidates.filter((id) => !alreadyDeveloped.has(id));
  if (pending.length === 0) return new Set();
  // Kun ryttere, der stod på et managerhold på startdatoen (én kvittering pr. løbsdag, så få rækker).
  const ignition = await fetchAllRows(() => supabase.from("training_rider_ticks").select("rider_id")
    .in("rider_id", pending)
    .eq("tick_date", xpFromDate)
    .eq("report->>xp_ignition_manager", "true")
    .order("rider_id"));
  const onManagerAtIgnition = new Set(ignition.map((row) => row.rider_id));
  const unmarked = pending.filter((id) => !onManagerAtIgnition.has(id));
  if (unmarked.length > 0) {
    // Ejerskabet ved startdatoens slutning (fund A): også uden kvittering den dato.
    const endIso = trainingDateBounds(xpFromDate).end.toISOString();
    const events = await fetchAllRows(() => supabase.from("rider_ownership_events")
      .select("id, rider_id, from_team_id, to_team_id, occurred_at")
      .in("rider_id", unmarked)
      .order("rider_id")
      .order("occurred_at"));
    const byRider = new Map();
    for (const event of events) byRider.set(event.rider_id, [...(byRider.get(event.rider_id) ?? []), event]);
    // Fable-dom 19/11: ejerskiftet logges ikke på alle veje (starttrup, akademi-indtag og -overførsel,
    // best-effort-logning). En rytter uden ejerskifter skal have stået på holdet før startdatoens
    // slutning (acquired_at, ellers created_at); ellers kom han efter tænding og får ingen udbetaling.
    const withoutEvents = unmarked.filter((id) => !byRider.has(id));
    const riderRows = withoutEvents.length ? await fetchAllRows(() => supabase.from("riders")
      .select("id, created_at, acquired_at")
      .in("id", withoutEvents)
      .order("id")) : [];
    const endMs = new Date(endIso).getTime();
    const arrivedBefore = new Set(riderRows.filter((row) => {
      const at = new Date(row.acquired_at ?? row.created_at ?? Number.NaN).getTime();
      return Number.isFinite(at) && at < endMs;
    }).map((row) => row.id));
    const ignitionTeam = new Map(unmarked.map((id) => [id,
      byRider.has(id) ? teamAtTime(byRider.get(id), teamId, endIso) : (arrivedBefore.has(id) ? teamId : null)]));
    const otherTeamIds = [...new Set([...ignitionTeam.values()].filter((id) => id != null && id !== teamId))];
    const teams = otherTeamIds.length ? await fetchAllRows(() => supabase.from("teams")
      .select("id, user_id, is_ai, is_bank, is_test_account")
      .in("id", otherTeamIds)
      .order("id")) : [];
    const managerTeams = new Set(teams.filter((team) => isManagerTeamForDevelopment(team)).map((team) => team.id));
    // Det nuværende hold er et managerhold (ellers kører reglen ikke: developmentAllowed).
    if (teamId != null) managerTeams.add(teamId);
    for (const id of unmarked) if (managerTeams.has(ignitionTeam.get(id))) onManagerAtIgnition.add(id);
  }
  return new Set(pending.filter((id) => onManagerAtIgnition.has(id)));
}
