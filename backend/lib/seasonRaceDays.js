// #804 — seasons.race_days_completed afspejler antallet af afviklede "race days"
// (etaper) i en sæson. Ét race day = én etape: endagsløb tæller 1, etapeløb
// tæller race.stages — samme enhed som seasonRaceSelection.totalRaceDays og
// seasons.race_days_total (default 60).
//
// Strategi: recompute fra sandheden (SUM(stages) over completede løb), IKKE
// delta-increment. Det gør counteren idempotent og selv-helende — re-import af
// samme løb eller flere completed-stier (PCM + Google Sheets-sync) kan ikke få
// den til at drifte. Samme funktion bruges til backfill af eksisterende sæsoner.

// Pure: summér race days for de completede løb i en liste.
// stages defaulter til 1 (matcher races.stages DEFAULT 1 + selectSeasonRaces).
export function sumCompletedRaceDays(races = []) {
  return races.reduce((sum, race) => {
    if (race?.status !== "completed") return sum;
    return sum + (Number(race.stages) || 1);
  }, 0);
}

// I/O: recompute + persist seasons.race_days_completed for én sæson.
// Returnerer den nye værdi. Kaldes efter resultat-import (når et løb sættes
// status='completed') og fra backfill-scripts.
export async function recomputeSeasonRaceDays({ supabase, seasonId }) {
  if (!supabase?.from) throw new Error("supabase client kræves");
  if (!seasonId) throw new Error("seasonId kræves");

  const { data: races, error } = await supabase
    .from("races")
    .select("stages, status")
    .eq("season_id", seasonId);
  if (error) throw new Error(`Kunne ikke hente løb for race-day-recompute: ${error.message}`);

  const raceDaysCompleted = sumCompletedRaceDays(races || []);

  const { error: updateError } = await supabase
    .from("seasons")
    .update({ race_days_completed: raceDaysCompleted })
    .eq("id", seasonId);
  if (updateError) throw new Error(`Kunne ikke opdatere race_days_completed: ${updateError.message}`);

  return raceDaysCompleted;
}
