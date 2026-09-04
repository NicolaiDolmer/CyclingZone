// #1099 spec §8: krogen der binder omdømme-motoren til løbsafslutningen.
//
// Kaldes fra `raceRunner.js` PRÆCIS de to steder `detectCareerFirsts` kaldes
// (simulateRace + simulateStageByIndex) — samme resultRows, samme
// stageNumbers-scoping, samme best-effort-kontrakt: en fejl her må ALDRIG
// vælte selve finaliseringen.
//
// Egen fil (ikke en wrapper inde i raceRunner som runCareerFirstsDetection):
// "flag off = ingen skrivning" er den vigtigste enkelt-egenskab i hele PR'en,
// og den skal kunne testes uden at instansiere en hel løbsafvikling.
//
// Flag-stadier (reputationFlag.js):
//   off     → returnér FØR motoren overhovedet køres. Ingen hændelser, ingen
//             rytter-opdatering. Adfærden er bit-identisk med før #1099; den
//             eneste tilføjede omkostning er ét app_config-opslag, samme pris
//             som de øvrige flag i finaliseringen (timeline, finalize-state).
//   shadow  → beregn + skriv. Ingen forbruger læser tallet endnu.
//   on      → som shadow; forskellen ligger hos forbrugerne (PR 3+).

import { eventsFromResultRows } from "./reputationEngine.js";
import { persistReputationEvents, refreshRiderReputations } from "./reputationPersist.js";
import { readReputationStage, isReputationWriteEnabled, REPUTATION_STAGE } from "./reputationFlag.js";
import { captureException } from "./sentry.js";

/**
 * @param {object} args
 * @param {object} args.supabase
 * @param {{id, season_id, race_type, race_class, stages}} args.race
 * @param {Array<object>} args.resultRows  DENNE finaliserings resultatrækker
 * @param {Array<number>} args.stageNumbers  etaper finaliseringen dækker
 * @param {number|null} args.seasonNumber    seasons.number for den aktive sæson
 * @param {string} [args.stage]  forud-læst flag-stadie (test/backfill)
 * @returns {Promise<{stage:string, events:number, inserted:number, deduped:number, ridersUpdated:number}>}
 */
export async function runReputationForFinalization({
  supabase,
  race,
  resultRows = [],
  stageNumbers = [],
  seasonNumber = null,
  stage = null,
}) {
  const stats = { stage: REPUTATION_STAGE.OFF, events: 0, inserted: 0, deduped: 0, ridersUpdated: 0 };
  if (!supabase?.from || !race?.id) return stats;

  const resolvedStage = stage ?? await readReputationStage(supabase);
  stats.stage = resolvedStage;
  if (!isReputationWriteEnabled(resolvedStage)) return stats;
  if (!resultRows.length) return stats;

  // Scop til de etaper DENNE finalisering dækker — spejler
  // persistIncidents/persistStageMoments' stageNumbers-kontrakt, så en
  // etape-for-etape-afvikling ikke gen-udleder tidligere etapers hændelser
  // (de er allerede i bogen, og dedupe ville tage dem, men opslaget er spildt).
  const scoped = stageNumbers.length
    ? resultRows.filter((row) => stageNumbers.includes(Number(row?.stage_number ?? 1) || 1))
    : resultRows;
  if (!scoped.length) return stats;

  const events = eventsFromResultRows({ race, resultRows: scoped });
  stats.events = events.length;
  if (!events.length) return stats;

  const { inserted, deduped } = await persistReputationEvents({ supabase, events });
  stats.inserted = inserted;
  stats.deduped = deduped;

  const riderIds = [...new Set(events.map((e) => e.rider_id))];
  const { updated } = await refreshRiderReputations({
    supabase,
    riderIds,
    currentSeasonIndex: seasonNumber,
  });
  stats.ridersUpdated = updated;
  return stats;
}

/**
 * Best-effort-indpakning til kaldstedet i raceRunner: samme graceful
 * degradation som persistStageMoments/runCareerFirstsDetection. Tabellen kan
 * mangle i vinduet mellem merge og CI's migration-apply, og et fejlet
 * omdømme-skriv må under ingen omstændigheder vælte en løbsafslutning.
 */
export async function runReputationDetectionSafe(args) {
  try {
    return await runReputationForFinalization(args);
  } catch (err) {
    // EN-first operator-log (#1068): ingen rå dansk i backend-strenge.
    console.warn(
      `  ⚠️  reputation hook failed for race ${args?.race?.id} (table may not be migrated yet — degrading to no reputation): ${err.message}`,
    );
    captureException(err, { tags: { flow: "race-finalization", stage: "reputation-hook" }, raceId: args?.race?.id });
    return { stage: REPUTATION_STAGE.OFF, events: 0, inserted: 0, deduped: 0, ridersUpdated: 0, failed: true };
  }
}
