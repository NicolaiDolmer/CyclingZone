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
//
// #4201: sweepen er ogsaa det ENE sted assistant_selection_mode laeses for den
// proaktive sti. Fail-safe (assistantSelectionMode.js) er "proactive" = dagens
// adfaerd, saa en manglende noegle eller DB-fejl aldrig aabner for manager-hold.
// Saeson-transitionen og admin-genvejen kalder generatoren UDEN mode og koerer
// derfor altid proactive — se docs/ASSISTANT_RULES.md §1b.
//
// #5246: hver faktiske koersel (flag ON + aktiv sæson fundet, dvs. `runGeneratorFn`
// rent faktisk kaldes) skriver nu ÉN række i race_entry_generator_runs, OGSÅ ved
// 0 fyld — lukker #5136 §5's "ingen målbar log"-hul (kørselsantal kunne før kun
// udledes indirekte af cron-kadencen). Skrivningen er BEST-EFFORT (samme kontrakt
// som email_sweep_runs, #2853): en fejlet log-skrivning må ALDRIG vælte en sweep
// der ellers gjorde sit arbejde, og en generator-fejl logges (med besked i `error`)
// FØR den kastes videre, så cron.js's trackedTick stadig ser den og alarmerer.
// flag_off/no_active_season skriver intet — det er slet ikke en "kørsel" af
// generatoren, bare et hurtigt no-op-skip.
import { isAutoEntryGeneratorEnabled } from "./autoEntryGeneratorFlag.js";
import { runRaceEntryGenerator } from "./raceEntryGenerator.js";
import { loadSingleActiveSeason } from "./activeSeasonLookup.js";
import { readAssistantSelectionConfig } from "./assistantSelectionMode.js";
import { captureException } from "./sentry.js";

export const RACE_ENTRY_GENERATOR_RUNS_TABLE = "race_entry_generator_runs";

// #5246: best-effort log-skrivning — se filens header. Dobbelt try/catch (samme
// mønster som activeSeasonLookup.js's fler-aktiv-alarm): den ydre beskytter mod at
// captureExceptionFn'ens EGET kald kaster videre og alligevel vælter sweepen.
async function writeRunLog({
  supabase, startedAt, finishedAt, mode, lateFillHours, result, error, captureExceptionFn = captureException,
}) {
  try {
    const row = {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      mode: mode ?? null,
      late_fill_hours: lateFillHours ?? null,
      // result.teams = "hold behandlet i mindst én pulje" (raceEntryGenerator.js'
      // egen definition) — den bedste tilgængelige proxy for "hold fyldt" uden at
      // ændre generatorens returværdi (raceEntryGenerator.js er uden for denne
      // lanes ejerskab, #5246-briefen). result.inserted er de faktisk skrevne
      // race_entries-rækker (entries_written), ikke `generated` (kandidat-picks
      // FØR frozen/fejl-filtrering).
      races_considered: result?.races ?? 0,
      teams_filled: result?.teams ?? 0,
      entries_written: result?.inserted ?? 0,
      error: error ? String(error.message || error) : null,
    };
    const { error: insErr } = await supabase.from(RACE_ENTRY_GENERATOR_RUNS_TABLE).insert(row);
    if (insErr) throw insErr;
  } catch (logErr) {
    try {
      captureExceptionFn(logErr, {
        tags: { cron: "race-entry-generator-sweep", stage: "run_log_write" },
        fingerprint: ["race-entry-generator-sweep", "run-log-write-failed"],
      });
    } catch { /* best-effort: en fejlende alarm må aldrig dræbe kald-stedet */ }
  }
}

export async function runRaceEntryGeneratorSweep({
  supabase,
  isEnabled = isAutoEntryGeneratorEnabled,
  runGeneratorFn = runRaceEntryGenerator,
  readModeFn = readAssistantSelectionConfig,
  captureExceptionFn,
  now = () => new Date(),
} = {}) {
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  // #2743: order+limit+maybeSingle (i stedet for et rent maybeSingle) + separat
  // fler-aktiv-alarm — se activeSeasonLookup.js.
  const season = await loadSingleActiveSeason(supabase, { tag: "race-entry-generator-sweep", captureExceptionFn });
  if (!season) return { ran: false, reason: "no_active_season" };

  const { mode, lateFillHours } = await readModeFn(supabase);
  const startedAt = now();

  let result;
  try {
    result = await runGeneratorFn({
      supabase, seasonId: season.id, dryRun: false, mode, lateFillHours,
    });
  } catch (err) {
    // #5246: log kørslen SOM FEJLET (races/teams/entries = 0, error = beskeden)
    // før fejlen kastes videre — trackedTick (cron.js) skal stadig se + alarmere
    // på den, denne log-skrivning erstatter ikke det signal, den supplerer det.
    await writeRunLog({
      supabase, startedAt, finishedAt: now(), mode, lateFillHours, result: null, error: err, captureExceptionFn,
    });
    throw err;
  }

  await writeRunLog({
    supabase, startedAt, finishedAt: now(), mode, lateFillHours, result, error: null, captureExceptionFn,
  });

  return { ran: true, seasonId: season.id, ...result };
}
