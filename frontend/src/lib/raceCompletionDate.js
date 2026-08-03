// #3197 — "Seneste"-kortenes dato-meta viste race_pool.date_text: en rå "dd/mm"-
// dato importeret sammen med løbsnavn/etaper fra det real-world kalender-regneark
// (racePoolImport.js), brugt til re-import-dedup + sortering. Den dato har INTET
// årstal og INGEN forbindelse til hvornår løbet faktisk blev afviklet i spillet —
// ejeren flaggede den som uforklarlig ("Disse datoer giver ingen mening", Discord
// #feedback-from-dolmer 31/7). date_text bruges FORTSAT til at sortere "seneste"
// (raceCalendarSort.js) — kun VISNINGEN fjernes her.
//
// Erstatningen er den faktiske afviklingsdato: seneste race_stage_schedule.
// scheduled_at for løbet, projiceret til dansk kalenderdato (samme kilde som
// RaceDetailPage's etape-tider). Bevidst IKKE races.game_day_start/game_day —
// den akse er en IN-GAME-simulerings-tæller i et andet nøgle-rum end kalenderdage
// (flere spil-dage kan falde på samme kalenderdag, jf. backend/lib/seasonDay.js),
// og at blande de to var netop rodårsagen til #3107s dag-0/1-forskydningsbug.
// En rigtig kalenderdato kræver ingen akse-oversættelse og kan ikke drifte.

/**
 * Seneste scheduled_at pr. race_id, som epoch-ms. Ugyldige/manglende
 * tidsstempler springes over; et løb uden nogen gyldig række mangler i mappet
 * (kalderen viser da ingen dato i stedet for en forkert én).
 * @param {Array<{race_id:string, scheduled_at:string}>} scheduleRows
 * @returns {Map<string, number>}
 */
export function latestScheduledMsByRace(scheduleRows) {
  const out = new Map();
  for (const row of scheduleRows || []) {
    const ms = Date.parse(row?.scheduled_at);
    if (!Number.isFinite(ms)) continue;
    const prev = out.get(row.race_id);
    if (prev == null || ms > prev) out.set(row.race_id, ms);
  }
  return out;
}
