// #804/#2512 — seasons.race_days_completed/race_days_total afspejler antallet af
// DISTINKTE kalender-løbsdage i sæsonen (distinct races.game_day_start), IKKE
// SUM(stages) over løb.
//
// Enheds-historik (#2512): før denne fix summerede race_days_completed
// SUM(stages) over ALLE completede løb på tværs af ALLE divisioner — med flere
// divisioner der afvikler løb parallelt voksede den ~20+/dag i stedet for ~1/dag
// pr. kalenderdag, mens race_days_total forblev et manuelt admin-tal (default 60)
// sat FØR kalenderen eksisterede. De to tal endte i vidt forskellige enheder
// (prod: 524 vs. 60), hvilket permanent låste getBoardRenegotiationLock
// (boardRequests.js) og trigged boardMidSeason-midpoint kunstigt tidligt.
//
// Valgt enhed (besluttet #2512): ÉT race day = én distinkt game_day_start-værdi
// på races-tabellen for sæsonen. race_days_completed = distinkte game_day_start
// blandt completede løb; race_days_total = distinkte game_day_start blandt ALLE
// løb i sæsonens kalender (~27-28 i prod sæson 1, ikke det tidligere 60-gæt).
//
// Strategi: recompute BEGGE felter fra sandheden (kalenderen), IKKE
// delta-increment. Det gør counteren idempotent og selv-helende — re-import af
// samme løb eller flere completed-stier (PCM + Google Sheets-sync) kan ikke få
// den til at drifte, og race_days_total retter sig selv hvis kalenderen ændres
// efter sæsonstart. Samme funktion bruges til backfill af eksisterende sæsoner.

// Pure: tæl distinkte kalender-løbsdage (game_day_start) i en liste af løb.
// completedOnly=true tæller kun løb med status='completed'. Løb uden et
// game_day_start (endnu ikke planlagt/bundet til kalenderen) tælles ikke —
// de bidrager først når de får en dag tildelt.
export function countDistinctRaceDays(races = [], { completedOnly = false } = {}) {
  const days = new Set();
  for (const race of races || []) {
    if (completedOnly && race?.status !== "completed") continue;
    const day = race?.game_day_start;
    if (day === null || day === undefined || !Number.isFinite(Number(day))) continue;
    days.add(Number(day));
  }
  return days.size;
}

// I/O: recompute + persist seasons.race_days_completed OG race_days_total for
// én sæson. Returnerer den nye race_days_completed-værdi (uændret kontrakt for
// eksisterende kaldere i pcmResultsImport.js/raceRunner.js, der bruger
// returværdien som et skalar-tal). Kaldes efter resultat-import (når et løb
// sættes status='completed') og fra backfill-scripts.
export async function recomputeSeasonRaceDays({ supabase, seasonId }) {
  if (!supabase?.from) throw new Error("supabase client kræves");
  if (!seasonId) throw new Error("seasonId kræves");

  const { data: races, error } = await supabase
    .from("races")
    .select("game_day_start, status")
    .eq("season_id", seasonId);
  if (error) throw new Error(`Kunne ikke hente løb for race-day-recompute: ${error.message}`);

  const raceDaysCompleted = countDistinctRaceDays(races || [], { completedOnly: true });
  const raceDaysTotal = countDistinctRaceDays(races || [], { completedOnly: false });

  const { error: updateError } = await supabase
    .from("seasons")
    .update({ race_days_completed: raceDaysCompleted, race_days_total: raceDaysTotal })
    .eq("id", seasonId);
  if (updateError) throw new Error(`Kunne ikke opdatere race_days_completed/race_days_total: ${updateError.message}`);

  return raceDaysCompleted;
}
