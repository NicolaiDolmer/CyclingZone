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
//
// Kun med XP tændt og dato-kvitteringerne (training_condition_per_date); ellers er svaret
// null, og motoren bruger startdatoen alene (som før). Kun ryttere med en bjælke på mindst ét
// point kan få noget udbetalt, så kun de slås op.
import { fetchAllRows } from "./supabasePagination.js";

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
export async function loadXpFirstDatePayoutRiderIds({
  supabase, developmentXp, developmentXpIgnition, xpFromDate, conditionPerDate, developmentAllowed, tickDate, abilityRows,
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
  return new Set(candidates.filter((id) => !alreadyDeveloped.has(id)));
}
