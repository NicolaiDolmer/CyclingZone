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
//
// #5537 (S9, spec 2026-09-15 C3): kun SENIORløb giver omdømme (v1). Efter A2
// (#5517) afvikles U23-/juniorløb gennem samme finalisering, og motoren har ingen
// trup-dimension — en ungdomssejr ville give samme omdømme som en seniorsejr i
// samme løbsklasse. Samme dom som afspilningen (reputationReplay.js), så backfill
// og live ikke kan blive uenige. Kaldstederne i raceRunner sender i dag race-
// objekter UDEN `squad` (adminSimulateRace/stageScheduler projicerer ikke
// kolonnen), så krogen slår truppen op selv — ét enkelt-række-opslag, og kun når
// flaget skriver og der er rækker at afspille, så "flag off = ingen ekstra
// DB-adgang" holder. I dag er hvert løb 'senior', så adfærden er bit-identisk.

import { eventsFromResultRows } from "./reputationEngine.js";
import { persistReputationEvents, refreshRiderReputations } from "./reputationPersist.js";
import { readReputationStage, isReputationWriteEnabled, REPUTATION_STAGE } from "./reputationFlag.js";
import { isMissingSquadColumnError } from "./racePoolCatalog.js";
import { isSeniorSquadRow, SQUAD_COLUMN } from "./squads.js";
import { captureException } from "./sentry.js";

/**
 * Er løbet et SENIORløb? Bærer race-objektet `squad` (også `null`), afgør feltet
 * alene. Mangler det, slås truppen op i `races`:
 *   - 42703 (kolonnen findes ikke endnu, auto-migrate-vinduet) → senior: uden
 *     kolonnen kan intet ungdomsløb findes. Samme dom som withSeniorSquadScope.
 *   - enhver anden fejl, eller et løb der ikke findes → kast. Krogen er best-effort
 *     (runReputationDetectionSafe fanger og rapporterer), og et gæt her ville
 *     kunne give et ungdomsløb omdømme. Vi fejler lukket: intet omdømme for
 *     netop denne finalisering, og afspilningen (reputationReplay) kan indhente det.
 *
 * @param {object} supabase
 * @param {{id:string, squad?:string|null}} race
 * @returns {Promise<boolean>}
 */
export async function isSeniorRaceForReputation(supabase, race) {
  if (race?.[SQUAD_COLUMN] !== undefined) return isSeniorSquadRow(race);
  const { data, error } = await supabase
    .from("races").select(SQUAD_COLUMN).eq("id", race.id).maybeSingle();
  if (error) {
    if (isMissingSquadColumnError(error)) return true;
    throw new Error(`races.squad lookup failed for race ${race.id}: ${error.message}`);
  }
  if (!data) throw new Error(`race ${race.id} not found for squad lookup`);
  return isSeniorSquadRow(data);
}

/**
 * @param {object} args
 * @param {object} args.supabase
 * @param {{id, season_id, race_type, race_class, stages}} args.race
 * @param {Array<object>} args.resultRows  DENNE finaliserings resultatrækker
 * @param {Array<number>} args.stageNumbers  etaper finaliseringen dækker
 * @param {number|null} args.seasonNumber    seasons.number for den aktive sæson
 * @param {string} [args.stage]  forud-læst flag-stadie (test/backfill)
 * @returns {Promise<{stage:string, events:number, inserted:number, deduped:number, ridersUpdated:number,
 *                    skipped?:"youth_race"}>}
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

  // #5537: v1 senior-only. Efter flag- og tom-tjekket, så et slukket flag eller en
  // tom etape aldrig betaler for opslaget.
  if (!(await isSeniorRaceForReputation(supabase, race))) return { ...stats, skipped: "youth_race" };

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
