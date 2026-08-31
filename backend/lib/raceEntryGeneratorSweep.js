// backend/lib/raceEntryGeneratorSweep.js
// #2375 rod-årsag: den proaktive entry-generator (raceEntryGenerator.js, #1810) kørte
// hidtil KUN ved sæson-transition (seasonTransition.js) + admin-genvejen (/admin/seasons/
// :id/generate-entries). Løb der oprettes/genskabes MIDT i en aktiv sæson (fx admin
// regenererer en pulje) fik derfor aldrig deltagere automatisk — Division 4-grupperne
// C-G stod med 0-entry-løb 10/7 trods 24-26 hold/~300 ryttere pr. gruppe.
//
// Denne sweep kører generatoren periodisk for den AKTIVE sæson, så et deploy/tick
// straks fylder ethvert hul. Mirror af autoPrizeSweep.js: gated bag runtime-flag
// (fail-safe OFF — er flaget ikke tændt, sker intet) + finder aktiv sæson samme måde.
// Selve generatoren er idempotent (kun is_auto_filled=true rykkes, manuelle entries
// røres aldrig) + binding-bevidst, så gentagne ticks er harmløse.
import { isAutoEntryGeneratorEnabled } from "./autoEntryGeneratorFlag.js";
import { runRaceEntryGenerator } from "./raceEntryGenerator.js";
import { loadSingleActiveSeason } from "./activeSeasonLookup.js";

export async function runRaceEntryGeneratorSweep({
  supabase,
  isEnabled = isAutoEntryGeneratorEnabled,
  runGeneratorFn = runRaceEntryGenerator,
  captureExceptionFn,
} = {}) {
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  // #2743: order+limit+maybeSingle (i stedet for et rent maybeSingle) + separat
  // fler-aktiv-alarm — se activeSeasonLookup.js.
  const season = await loadSingleActiveSeason(supabase, { tag: "race-entry-generator-sweep", captureExceptionFn });
  if (!season) return { ran: false, reason: "no_active_season" };

  const result = await runGeneratorFn({ supabase, seasonId: season.id, dryRun: false });
  return { ran: true, seasonId: season.id, ...result };
}
