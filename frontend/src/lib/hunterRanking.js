// frontend/src/lib/hunterRanking.js
// Race Hub S5 (Lag 3): ren helper til jæger-kandidat-rangering. Ingen React.
// Aggression driver udbruds-CHANCEN i motoren (raceSimulator.aggressionScore), så
// de bedste jægere er dem med højest aggression. Egen modul → node --test-bar.

// Rangér jæger-kandidater efter aggression desc (tiebreak: navn alfabetisk). Kun
// ryttere med en beregnet aggression-værdi; max `limit`.
export function rankHunterCandidates(riders = [], limit = 3) {
  return (riders || [])
    .filter((r) => Number.isFinite(r?.aggression))
    .slice()
    .sort((a, b) => b.aggression - a.aggression || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}
