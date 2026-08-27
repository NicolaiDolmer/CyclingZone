// Race Engine light-motor (#1102), slice 2 — raceRunner: broen mellem den rene
// single-stage simulator (raceSimulator.js) og den UÆNDREDE resultat-pipeline
// (raceResultsEngine.applyRaceResults).
//
// Ansvar:
//   1. Hent etape-profiler (race_stage_profiles) + startfelt (race_entries, med
//      per-hold autopick for hold UDEN entries — F1=B-strategi udvidet i #1307;
//      hold med manager-udtagne entries røres ikke).
//   2. Simulér hver etape (seed = stableSeed(raceSeedInput(race.id, stage)) —
//      server-side saltet via raceSeedSalt.js, usaltet når env ikke er sat, #2351).
//   3. Aggregér på tværs af etaper: GC efter kumulativ tid (F3=B), + point/bjerg/
//      ungdom/hold-klassementer. Emission (superset af pcmResultsImport.js — #2081
//      udvidede mellem-etaperne fra rank-1-trøjeholdere til FULDE klassementer;
//      rank 2+ har ingen race_points-rækker → points_earned 0, payout uændret):
//        single        → gc + team
//        mellem-etape  → stage + fulde leader/points_day/mountain_day/young_day
//        slut-etape    → stage + fulde gc/points/mountain/young + team
//      #2072: stage-by-stage-stien (simulateStageByIndex) simulerer KUN dagens
//      etape og AKKUMULERER klassementerne fra de persisterede race_results-
//      etaperækker (buildStageRowsAccumulated) — kørte etaper re-simuleres ALDRIG,
//      så slut-GC kan ikke modsige de publicerede etape-gaps (Vuelta Burgalesa).
//   4. Idempotent delete-then-insert pr. (race_id, stage_number) → applyRaceResults
//      (UÆNDRET) → standings/prize. + recomputeSeasonRaceDays + status=completed
//      + import_log (paritet med PCM-stien, undgår #804-regression).
//   5. persistRun → race_simulation_runs (F4=C: seed + entrant-snapshot pr. run;
//      per-rytter dekomponering returneres in-memory, ikke persisteret).
//
// points_earned/prize_money UDLEDES af (result_type, rank) via den delte
// buildRacePointsLookup — motoren opfinder ALDRIG point. finish_time er display-
// only (gc-RANK driver points); standings/schema er uændret.

import { randomUUID } from "node:crypto";
import {
  applyRaceResults as applyRaceResultsShared,
  buildRacePointsLookup,
  PRIZE_PER_POINT,
} from "./raceResultsEngine.js";
import { recomputeSeasonRaceDays } from "./seasonRaceDays.js";
import { processBoardWeekendFinalization as processBoardWeekendFinalizationShared } from "./boardWeekendFinalization.js";
import { simulateStage, stableSeed, ENGINE_VERSION, ENGINE_VERSION_V3, ABILITY_KEYS, deriveBreakawayStatus } from "./raceSimulator.js";
import { isRaceEngineV3ScoringEnabled, isRaceStageTimelineEnabled } from "./raceEngineFlag.js";
// #2410 (event-log S1): deterministisk etape-tidslinje-generator — REN funktion,
// samme build-trin som moments/passages (data er i memory). Bag flag
// `race_stage_timeline` (raceEngineFlag.js) — se buildRaceResults/
// buildStageRowsAccumulated's `timeline`-parameter nedenfor.
import { buildStageTimeline } from "./raceTimeline.js";
import { raceSeedInput, activeSaltVersion } from "./raceSeedSalt.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { applyRaceFatigue, stageEnteringFatigues, applyGrandTourRestDayFatigue as applyGrandTourRestDayFatigueShared } from "./raceFatigue.js";
import {
  loadStageRoleOverrides,
  resolveStageEntrant,
  effortsSequenceForRider,
  effortByRiderForStage,
  serializeStageRoleOverrides,
} from "./raceStageRoles.js";
import { autopickTeamSelection, selectionSizeForRace, MIN_RACE_ENTRIES } from "./raceAutopick.js";
// S5 (#2224): form-peaks — I/O-loadere (peak-planer + stage-datoer) +
// traeningskvalitet-seam. KUN kaldt når v3=true (flag-off skal forblive bit-
// identisk); peak-inputs går ind på entrants/stages via de samme v3-gates som S3.
import {
  loadPeakPlans,
  loadStageDayOrdinals,
  resolvePeakTrainingQualities,
  serializePeakInputs,
} from "./racePeakPlans.js";
// S4 (#1176): styrt/mekaniske uheld + DNF — abandon-state (cross-invokation) +
// persistens co-locates i raceIncidents.js (ren roll-logik + DB-loader).
import { loadAbandonedRiderIds } from "./raceIncidents.js";
// S6 (#2355): why-rapport + story-tags — ren afledning af de samme komponenter
// (ranked[].components) der allerede persisteres til race_simulation_rider_scores.
import { extractStageMoments } from "./raceNarrative.js";
// #3398 (Maiden Win Engine): career-firsts-detektion (maiden win/første podium/
// første klassifikationstrøje/klub-milepæle) — UAFHÆNGIG af v3-flaget (læser
// kun result_type/rank/rider_id/team_id, som ALLE løb altid skriver).
import { detectCareerFirsts } from "./careerFirsts.js";
import { applyStageResultAtomic } from "./stageResultRpc.js";
import { POOL_TARGET_SIZE } from "./economyConstants.js";
import { loadWithdrawnTeamIds } from "./raceWithdrawal.js";
import { loadClearedTeamIds } from "./raceEntryClears.js";
import { captureException } from "./sentry.js";
import { raceBindingWindow, isRiderDayInvariantViolation } from "./raceBinding.js";
import { freezeEntrantsToStartField, excludeBoundRiders, filterEntriesToRaceDivision, filterTeamsBelowMinimumEntries } from "./raceFieldIntegrity.js";
import { applyRiderEligibilityFilter, filterEligibleEntries, applyInjuredFilter, filterOutInjuredEntries } from "./riderEligibility.js";
import { fetchAllRows } from "./supabasePagination.js";
import { loadEligibleEntries } from "./raceEntriesLoader.js";
import { flushDeferredTransfersForRace } from "./stageRaceTransferDefer.js";
import { refreshRankingMatviewsSafe } from "./refreshRankingMatviews.js";
import { notifyTeamOwner as notifyTeamOwnerShared } from "./notificationService.js";
// #2072: klassements-kernen (ranking, tie-breaks, gap-parsing, akkumulering) er
// udtrukket til raceClassifications.js så helt-løb-stien og stage-by-stage-
// akkumuleringsstien deler PRÆCIS samme semantik.
import {
  classPointsForRank,
  CLIMB_PROFILES,
  formatGap,
  rankByCumTimeAsc,
  rankByCompDesc,
  teamClassification,
  accumulateStageRows,
  filterCompletedEntrants,
} from "./raceClassifications.js";
// Sub-2 (#2770): passage-lag — ren efterbehandling af simulateStage-output
// (mellemsprint/KOM-konkurrencer + bonussekunder). Kaldes med SAMME seed som
// simulateStage; motoren selv læser aldrig rutefelterne (bit-identisk).
import { computePassages } from "./racePassages.js";

// #1995: flush parkerede holdskifter (pending_team_id → team_id) når et etapeløb
// er finaliseret. Idempotent → sikker ved recovery-genkørsel (bevidst UDEN
// finalizationPending-guard). Fejl sluges: løbet ER færdigt — en flush-fejl må
// ikke vælte afviklingen (parkeringen står urørt og kan flushes manuelt/ved retry).
async function flushDeferredTransfersSafe({ supabase, race }) {
  try {
    const notifyTeamOwner = (teamId, type, title, message, relatedId = null, metadata = null) =>
      notifyTeamOwnerShared({ supabase, teamId, type, title, message, relatedId, metadata });
    const { ridersFlushed } = await flushDeferredTransfersForRace(supabase, race, { notifyTeamOwner });
    if (ridersFlushed > 0) {
      console.log(`  🔁 ${ridersFlushed} parkeret holdskifte(r) flushet efter ${race.name || race.id} (#1995)`);
    }
  } catch (err) {
    console.error(`  ⚠️  deferred-transfer flush fejlede for race ${race.id} (#1995, ikke-fatal):`, err.message);
  }
}

// Fælles race_results-række-byggere — definerer rækkens form ét sted (deles af
// buildRaceResults og buildStageRowsAccumulated). points_earned/prize_money
// udledes ALTID af (result_type, rank) via pointsLookup — motoren opfinder aldrig point.
// #1499: in_breakaway/breakaway_caught er DESKRIPTIVE udbruds-etiketter (ren read
// af motorens egne tal — påvirker IKKE rang/point/finish_time). Default false, så
// alle ikke-etape-rækker (gc/points/trøjer/team) bærer dem som false.
function makeResultRowPushers({ race, byId, teamNameByTeam, pointsLookup, resultRows }) {
  const pushIndiv = ({
    result_type, rank, rider_id, stage_number, finish_time = null, in_breakaway = false, breakaway_caught = false,
    // Sub-2 (#2770): passage-lag-aggregater — NULL (default) = legacy/ingen rutedata.
    // Etape-niveau-gate (kald-stedets ansvar): når passage-laget er aktivt for en
    // etape bærer ALLE dens 'stage'-rækker numeriske værdier (0 for ikke-scorere),
    // aldrig null — se buildRaceResults/buildStageRowsAccumulated.
    sprint_points = null, kom_points = null, bonus_seconds = null,
  }) => {
    const e = byId.get(rider_id);
    const pts = pointsLookup[`${result_type}__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number,
      result_type,
      rank,
      rider_id,
      rider_name: e?.rider_name ?? null,
      team_id: e?.team_id ?? null,
      team_name: e?.team_name ?? null,
      finish_time,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      in_breakaway,
      breakaway_caught,
      sprint_points,
      kom_points,
      bonus_seconds,
    });
  };
  const pushTeam = ({ rank, team_id, stage_number, result_type = "team" }) => {
    const pts = pointsLookup[`${result_type}__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number,
      result_type,
      rank,
      rider_id: null,
      rider_name: null,
      team_id,
      team_name: teamNameByTeam.get(team_id) ?? null,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      in_breakaway: false,
      breakaway_caught: false,
    });
  };
  return { pushIndiv, pushTeam };
}

/**
 * REN kerne: simulér et helt løb og byg race_results-kompatible rækker + run-metadata.
 * Ingen DB. Determinisk givet (race.id, stages, entrants).
 *
 * @param {{race, stages, entrants, pointsLookup, v3?:boolean, stageRoleOverrides?:Map}} args
 *   race: { id, race_type }  (race_type 'stage_race' ellers behandlet som endagsløb)
 *   stages: [{ stage_number, profile_type, demand_vector }]  (usorteret ok)
 *   entrants: [{ rider_id, team_id, rider_name?, is_u25?, abilities:{...10}, form?, fatigue?, race_role? }]
 *   pointsLookup: fra buildRacePointsLookup (result_type__rank → point)
 *   v3: Race v3 S1 (#2352, flag `race_engine_v3_scoring`) — default false =
 *     BIT-IDENTISK med i dag (samme engine_version, ingen riderScores på runs).
 *   stageRoleOverrides: S3 (#2034) — Map(stage_number → Map(rider_id → {race_role,
 *     effort})) fra raceStageRoles.loadStageRoleOverrides. KUN anvendt når v3=true
 *     (kald-stedets ansvar at udelade den når v3=false — flag-off skal forblive
 *     bit-identisk). undefined/tom Map = ingen overrides, ren fallback til
 *     entrant.race_role/'normal', bit-identisk med før S3.
 * @returns {{ resultRows, passageRows, runs, finalFatigue, incidents, moments }}
 *   incidents: S4 (#1176) — flad liste af ALLE uheld på tværs af løbets etaper
 *   ({stage_number, rider_id, kind, outcome, time_loss_seconds, injury_days, u}).
 *   ALTID [] når v3=false (dormant, samme mønster som riderScores).
 *   moments: S6 (#2355) — flad liste af ALLE why-rapport-momenter/story-tags på
 *   tværs af løbets etaper ({stage_number, moment_key, params, significance,
 *   rider_ids, team_ids}), extractStageMoments (raceNarrative.js). ALTID [] når
 *   v3=false (samme dormant-mønster).
 *   passageRows: Sub-2 (#2770) — flad liste af race_stage_passages-kompatible
 *   rækker (waypoint_kind/index/name/km, climb_category, rider_id/name, team_id,
 *   passage_rank, points, bonus_seconds) på tværs af løbets etaper. ALTID []
 *   når etapen ikke har rutedata (climbs/sprints/distance_km) — data-gated via
 *   computePassages (racePassages.js), ikke et v3-flag.
 *   timelines: #2410 (event-log S1) — flad liste af race_stage_timelines-
 *   kompatible rækker ({stage_number, timeline_version, events}) på tværs af
 *   løbets etaper. ALTID [] når `timeline`=false (flag `race_stage_timeline`,
 *   kald-stedets ansvar — samme mønster som v3/riderScores). UAFHÆNGIG af v3:
 *   timelinen degraderer gracefully (tyndere artefakt) når v3=false, men
 *   genereres stadig hvis flaget er ON.
 */
export function buildRaceResults({ race, stages = [], entrants = [], pointsLookup = {}, v3 = false, stageRoleOverrides, timeline = false }) {
  if (!race?.id) throw new Error("race.id required");
  if (!stages.length) throw new Error("no stage profiles");
  if (!entrants.length) throw new Error("no entrants");

  const isStageRace = race.race_type === "stage_race";
  const stagesSorted = [...stages].sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));

  const cumTime = new Map();
  const posSum = new Map();   // sum af etapeplaceringer → GC-countback-tiebreaker
  const pointsComp = new Map();
  const komComp = new Map();
  const byId = new Map();
  // S4 (#1176): hvilke etaper hver rytter FAKTISK har en 'stage'-række på (dvs.
  // var i `ranked` — abandons udelades af simulateStage selv) + hvilke etaper er
  // behandlet indtil videre. filterCompletedEntrants (raceClassifications.js)
  // ekskluderer enhver rytter der mangler en etape fra ALLE klassementer —
  // v3=false: alle er altid med på alle etaper → classified === entrants
  // (indhold/orden uændret) → bit-identisk flag-off.
  const stagesByRider = new Map();
  const stageNumbersSoFar = new Set();
  const abandonedSet = new Set();
  const allIncidents = [];
  // S6 (#2355): why-rapport-momenter pr. etape — kun akkumuleret når v3=true
  // (extractStageMoments kaldes nedenfor med samme v3-gate som riderScores).
  // previousGcLeaderId spores på tværs af loop-iterationer til gc_takeover.
  const allMoments = [];
  let previousGcLeaderId = null;
  // #2410 (event-log S1): flad liste af tidslinje-rækker på tværs af etaper +
  // GC-tilstand FØR den etape der behandles (null på etape 1/endagsløb) —
  // UAFHÆNGIGT af v3 (genbruges af buildStageTimeline's virtual_leader-event,
  // som selv kun aktiveres når previousGc rent faktisk findes).
  const allTimelines = [];
  let previousGcFull = null;
  // #1993: holdnavn-snapshot pr. team_id (fra de berigede entrants). Bruges til hold-
  // rækker (pushTeam), der ikke har en enkelt entrant at læse navnet fra.
  const teamNameByTeam = new Map();
  for (const e of entrants) {
    cumTime.set(e.rider_id, 0);
    posSum.set(e.rider_id, 0);
    pointsComp.set(e.rider_id, 0);
    komComp.set(e.rider_id, 0);
    byId.set(e.rider_id, e);
    if (e?.team_id != null && e?.team_name != null && !teamNameByTeam.has(e.team_id)) {
      teamNameByTeam.set(e.team_id, e.team_name);
    }
  }
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  const resultRows = [];
  const runs = [];
  // Sub-2 (#2770): passage-detalje-rækker (race_stage_passages) — én pr. rytter
  // pr. waypoint-passage på tværs af HELE løbet. Tom for løb uden rutedata.
  const passageRows = [];

  const { pushIndiv, pushTeam } = makeResultRowPushers({ race, byId, teamNameByTeam, pointsLookup, resultRows });

  // #1306-fix + #1307: form/fatigue/race_role SKAL med ind i simulatoren — det er
  // præcis condition-berigelsen og rollerne der adskiller prod-stien fra rå abilities.
  // #1021-hybrid (ejer-valgt 2026-06-17): træthed AKKUMULERER mellem etaper — en
  // 21-etapers tour bliver en udmattelseskamp. Hver rytters start-træthed
  // (rider_condition.fatigue, eller 0) + summen af tidligere etapers belastning.
  // Fylder seamen raceSimulator.js:74 beskriver, uden at røre simulateStage-kontrakten.
  const stageProfiles = stagesSorted.map((s) => s.profile_type);
  const stageNumbers = stagesSorted.map((s) => s.stage_number || 1);
  // #3470: GT-hviledage FØR hver etape (game_day-hul) — REN, udledt af stagesSorted's
  // .game_day (attacheret af kaldestedet, se attachStageGameDays). Alt 0 når data
  // mangler/ikke er attacheret → BIT-IDENTISK med før #3470 (stageEnteringFatigues'
  // restDaysBefore no-op'er på alt-0).
  const restDaysBefore = restDaysBeforeEachStage(stagesSorted);
  // S3 (#2034): per-rytter per-etape effort-sekvens til fatigue-akkumuleringen —
  // KUN når v3=true (flag-off skal forblive bit-identisk). effortsSequenceForRider
  // returnerer null når stageRoleOverrides er tom/undefined → stageEnteringFatigues
  // falder tilbage til sit gamle enkelt-effort-flow, uændret adfærd.
  const fatigueSeqById = new Map(
    entrants.map((e) => {
      const efforts = v3 ? effortsSequenceForRider(stageRoleOverrides, e.rider_id, stageNumbers) : null;
      return [e.rider_id, stageEnteringFatigues(e.fatigue, stageProfiles, {
        ...(efforts ? { efforts } : {}),
        restDaysBefore,
        recoveryAbility: e.abilities?.recovery,
      })];
    })
  );

  const simEntrants = entrants.map((e) => ({
    rider_id: e.rider_id,
    team_id: e.team_id,
    abilities: e.abilities,
    ...(e.form != null ? { form: e.form } : {}),
    // fatigue sættes per etape i loopet (akkumulerende); start = etape 0's entering.
    fatigue: fatigueSeqById.get(e.rider_id)[0],
    ...(e.race_role ? { race_role: e.race_role } : {}),
    // S5 (#2224): peak-vinduer (CET-ordinaler) + traeningskvalitet — KUN når v3
    // OG rytteren har mindst ét vindue (flag-off / v3-uden-plan skal give
    // bit-identisk simEntrant-form). Konstant på tværs af etaper (vinduer/tq er
    // pre-race-værdier); simulateStage vælger fasen pr. etape via stage.peakDay.
    ...(v3 && e.peakWindows?.length
      ? { peakWindows: e.peakWindows }
      : {}),
  }));

  // S5 (#2224): deterministisk peak-input-signatur til input_checksum — konstant
  // på tværs af etaper (kun peakDay varierer, tilføjes pr. etape nedenfor). Tom
  // når ingen entrant har et vindue → checksum-payloaden er bagudkompatibel med
  // v3-løb uden peaks (samme mønster som S3's stageRoles-nøgle).
  const peakInputs = v3 ? serializePeakInputs(simEntrants) : [];

  for (let i = 0; i < stagesSorted.length; i++) {
    const stage = stagesSorted[i];
    const stageNumber = stage.stage_number || 1;
    // S3 (#2034): denne etapes race_stage_roles-overrides — KUN opslået/anvendt
    // når v3=true. Resolution kører altid mod det ORIGINALE entrant (entrants[idx],
    // ikke det mutérede simEntrants[idx]) så en etapes override aldrig lækker ind i
    // en senere etape uden sin egen override (hver etape resolves uafhængigt).
    const overridesForStage = v3 ? stageRoleOverrides?.get(stageNumber) : undefined;
    for (let idx = 0; idx < simEntrants.length; idx++) {
      const se = simEntrants[idx];
      // Akkumuleret træthed gående ind til DENNE etape (idx i).
      se.fatigue = fatigueSeqById.get(se.rider_id)[i];
      if (v3) {
        const resolved = resolveStageEntrant(entrants[idx], overridesForStage);
        if (resolved.race_role) se.race_role = resolved.race_role;
        else delete se.race_role;
        se.effort = resolved.effort;
      }
    }
    const isFinal = i === stagesSorted.length - 1;
    const seed = stableSeed(raceSeedInput(race.id, stageNumber));
    // S4 (#1176): abandons fra en TIDLIGERE etape (denne loop-instans' egen
    // abandonedSet — whole-race-stien er ét kald, ingen DB-rundtur nødvendig)
    // udelukkes fra dagens felt, FØR simulateStage kaldes.
    const stageEntrants = abandonedSet.size
      ? simEntrants.filter((se) => !abandonedSet.has(se.rider_id))
      : simEntrants;
    const { ranked, incidents } = simulateStage({ entrants: stageEntrants, stageProfile: stage, seed, v3 });
    for (const inc of incidents) {
      allIncidents.push({ stage_number: stageNumber, ...inc });
      if (inc.outcome === "abandon") abandonedSet.add(inc.rider_id);
    }
    // #1499: deskriptive udbruds-etiketter for denne etapes finish-order (ren read).
    const breakawayStatus = deriveBreakawayStatus(ranked);
    const bwOf = (riderId) => breakawayStatus.get(riderId) || { in_breakaway: false, breakaway_caught: false };

    // Sub-2 (#2770): passage-lag — SAMME seed som simulateStage ovenfor (dedikerede
    // rng-strømme afledt heraf, jf. racePassages.js). stageEntrants = PRÆCIS de
    // entrants der blev sendt ind i simulateStage (abandons allerede udelukket).
    // Data-gated: computePassages returnerer tomt for endagsløb/rutedata-løse etaper.
    const passage = computePassages({ ranked, stageProfile: stage, entrants: stageEntrants, seed, isStageRace });
    const passageActive = passage.passages.length > 0;
    const passageAgg = (riderId) => passage.perRider.get(riderId) || { sprint_points: 0, kom_points: 0, bonus_seconds: 0 };
    for (const wp of passage.passages) {
      for (const res of wp.results) {
        const e = byId.get(res.rider_id);
        passageRows.push({
          race_id: race.id,
          stage_number: stageNumber,
          waypoint_kind: wp.kind,
          waypoint_index: wp.index,
          waypoint_name: wp.name,
          waypoint_km: wp.km,
          climb_category: wp.category ?? null,
          rider_id: res.rider_id,
          rider_name: e?.rider_name ?? null,
          team_id: e?.team_id ?? null,
          passage_rank: res.passage_rank,
          points: res.points,
          bonus_seconds: res.bonus_seconds,
        });
      }
    }

    runs.push({
      stage_number: stageNumber,
      seed,
      salt_version: activeSaltVersion(),
      engine_version: v3 ? ENGINE_VERSION_V3 : ENGINE_VERSION,
      entrant_snapshot: simEntrants.map((e) => e.rider_id).sort(),
      input_checksum: stableSeed(JSON.stringify({
        ids: simEntrants.map((e) => e.rider_id).sort(),
        roles: simEntrants.filter((e) => e.race_role).map((e) => [e.rider_id, e.race_role]).sort(),
        demand: stage.demand_vector,
        profile: stage.profile_type,
        // S3 (#2034): kun tilføjet når v3=true OG der findes overrides for løbet —
        // ellers uændret payload (bagudkompatible checksums, jf. determinisme-
        // guard-testen for flag-off). Flad repræsentation af HELE løbets overrides
        // (ikke kun denne etapes) — whole-race-fatigue-akkumuleringen gør at en
        // tidligere etapes override kan påvirke DENNE etapes entering-fatigue.
        ...(v3 && stageRoleOverrides?.size ? { stageRoles: serializeStageRoleOverrides(stageRoleOverrides) } : {}),
        // S5 (#2224): peak-inputs (vinduer/tq konstant + DENNE etapes peakDay) —
        // KUN når der faktisk findes peaks (bagudkompatibel checksum). peakDay
        // ændrer hvilken fase (peak/payback/none) etapen rammer → skal med for at
        // to identiske inputs giver identisk output (determinisme-garantien).
        ...(v3 && peakInputs.length ? { peaks: peakInputs, peakDay: stage.peakDay ?? null } : {}),
      })),
      // #2352 (Race v3 S1, spec §11.3): komponenter pr. rytter pr. etape — KUN
      // beregnet/vedhæftet når v3 er ON (why-laget/admin-formål). v3=false →
      // ingen riderScores-nøgle → runs-formen er UÆNDRET (determinisme-test-guard).
      ...(v3 ? { riderScores: ranked.map((r) => ({ rider_id: r.rider_id, rank: r.rank, components: r.components })) } : {}),
    });

    stageNumbersSoFar.add(stageNumber);
    for (const r of ranked) {
      // Sub-2 (#2770): når passage-laget er aktivt for DENNE etape, brug de rigtige
      // sprint/kom-aggregater i stedet for den generiske classPointsForRank-
      // heuristik, og træk bonussekunder fra cumTime — spejler PRÆCIS
      // raceClassifications.accumulateStageRows' hasPassageCols-gren (Task 4),
      // så in-memory (whole-race) og persisteret (stage-by-stage) akkumulering
      // stemmer overens. Legacy (ingen rutedata): uændret adfærd (bit-identisk).
      const agg = passageActive ? passageAgg(r.rider_id) : null;
      add(cumTime, r.rider_id, r.stageGap - (agg ? agg.bonus_seconds : 0));
      add(posSum, r.rider_id, r.rank);
      if (agg) {
        add(pointsComp, r.rider_id, agg.sprint_points);
        add(komComp, r.rider_id, agg.kom_points);
      } else {
        add(pointsComp, r.rider_id, classPointsForRank(r.rank));
        if (CLIMB_PROFILES.has(stage.profile_type)) add(komComp, r.rider_id, classPointsForRank(r.rank));
      }
      if (!stagesByRider.has(r.rider_id)) stagesByRider.set(r.rider_id, new Set());
      stagesByRider.get(r.rider_id).add(stageNumber);
    }

    // S4 (#1176): klassements-berettigede ryttere = dem der har fuldført ALLE
    // etaper behandlet indtil videre (samme funktion buildStageRowsAccumulated
    // allerede bruger). v3=false: ingen abandons nogensinde → classified har
    // SAMME indhold/orden som entrants → bit-identisk flag-off.
    const classified = filterCompletedEntrants(entrants, stagesByRider, stageNumbersSoFar);
    const gc = rankByCumTimeAsc(classified, cumTime, posSum);
    const leaderTime = gc.length ? gc[0].time : 0;
    const gcFinish = (entry) => formatGap(entry.time - leaderTime);

    // S6 (#2355): why-rapport-momenter — ren afledning af ranked[].components,
    // samme mønster som incidents ovenfor. KUN v3 (Tier1-momenterne kræver
    // komponenterne, som kun findes når v3=true — Tier0-dele holdes bag samme
    // gate for at holde v1-stien 100% urørt/uændret adfærd).
    // #2410: `stageMoments` hoistet til loop-scope (var i stedet for const inde i
    // if-blokken) — tidslinje-genereringen nedenfor genbruger dem, UAFHÆNGIGT af v3.
    let stageMoments = [];
    if (v3) {
      const roleByRider = new Map(stageEntrants.map((e) => [e.rider_id, e.race_role]));
      const formByRider = new Map(stageEntrants.filter((e) => e.form != null).map((e) => [e.rider_id, e.form]));
      // #3115 gap 1b (D3 DEL 2): dagens resolved effort pr. rytter (S3
      // resolveStageEntrant, samme kilde som se.effort ovenfor) — kun til
      // tag_saved_effort/tag_gave_everything, se raceNarrative.js.
      const effortByRider = new Map(stageEntrants.filter((e) => e.effort != null).map((e) => [e.rider_id, e.effort]));
      stageMoments = extractStageMoments({
        stageNumber, isFinal, isStageRace,
        ranked, roleByRider, formByRider, effortByRider, breakawayStatus,
        incidentsForStage: incidents,
        gc: isStageRace ? gc : null,
        previousGcLeaderId,
      });
      for (const m of stageMoments) allMoments.push({ stage_number: stageNumber, ...m });
      if (isStageRace) previousGcLeaderId = gc[0]?.rider_id ?? previousGcLeaderId;
    }

    // #2410 (event-log S1): tidslinje — SAMME build-trin som moments/passages
    // ovenfor (data er i memory). UAFHÆNGIGT af v3 (degraderer gracefully til et
    // tyndere artefakt når stageMoments/incidents er tomme). `race_role` genbruges
    // fra stageEntrants (roleByRider ovenfor er v3-scoped) — INGEN nye DB-kald.
    if (timeline) {
      const roleByRiderForTimeline = new Map(
        stageEntrants.filter((e) => e.race_role).map((e) => [e.rider_id, e.race_role])
      );
      const rankedForTimeline = ranked.map((r) => ({ ...r, race_role: roleByRiderForTimeline.get(r.rider_id) ?? null }));
      const timelineResult = buildStageTimeline({
        ranked: rankedForTimeline,
        stageProfile: stage,
        moments: stageMoments,
        incidents,
        passages: passage.passages,
        breakawayStatus,
        gc: isStageRace ? gc : null,
        previousGc: isStageRace ? previousGcFull : null,
        seed,
        isStageRace,
      });
      allTimelines.push({ stage_number: stageNumber, timeline_version: timelineResult.timeline_version, events: timelineResult.events });
    }
    previousGcFull = gc;

    if (!isStageRace) {
      // ENDAGSLØB: gc(all) + team. Ingen 'stage' (= dobbelttælling, jf. PCM).
      // gc-finish-order = denne ene etapes finish-order → udbruds-etiketten gælder direkte.
      for (const g of gc) pushIndiv({ result_type: "gc", rank: g.rank, rider_id: g.rider_id, stage_number: 1, finish_time: gcFinish(g), ...bwOf(g.rider_id) });
      for (const t of teamClassification(classified, cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: 1 });
      break;
    }

    // ETAPELØB: stage-resultater hver etape.
    for (const r of ranked) {
      const agg = passageActive ? passageAgg(r.rider_id) : null;
      pushIndiv({
        result_type: "stage", rank: r.rank, rider_id: r.rider_id, stage_number: stageNumber,
        finish_time: formatGap(r.stageGap), ...bwOf(r.rider_id),
        ...(agg ? { sprint_points: agg.sprint_points, kom_points: agg.kom_points, bonus_seconds: agg.bonus_seconds } : {}),
      });
    }

    if (!isFinal) {
      // Mellem-etape (#2081): FULDE løbende klassementer under dag-typerne — rank 1
      // beholder "holder trøjen"-pointet (race_points har KUN rank 1 for dag-typerne);
      // rank 2+ har intet opslag → points_earned 0, også under rederiveSeasonRacePoints.
      // leader-rækker bærer GC-gap (display af løbende samlet stilling).
      const young = rankByCumTimeAsc(classified.filter((e) => e.is_u25), cumTime, posSum);
      const pointsCls = rankByCompDesc(classified, pointsComp);
      const komCls = rankByCompDesc(classified, komComp);
      for (const g of gc) pushIndiv({ result_type: "leader", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
      for (const p of pointsCls) pushIndiv({ result_type: "points_day", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
      for (const k of komCls) pushIndiv({ result_type: "mountain_day", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
      for (const y of young) pushIndiv({ result_type: "young_day", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
      for (const t of teamClassification(classified, cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber, result_type: "team_day" });
    } else {
      // Slut-etape: hele klassementet udbetales.
      const young = rankByCumTimeAsc(classified.filter((e) => e.is_u25), cumTime, posSum);
      const pointsCls = rankByCompDesc(classified, pointsComp);
      const komCls = rankByCompDesc(classified, komComp);
      for (const g of gc) pushIndiv({ result_type: "gc", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
      for (const p of pointsCls) pushIndiv({ result_type: "points", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
      for (const k of komCls) pushIndiv({ result_type: "mountain", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
      for (const y of young) pushIndiv({ result_type: "young", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
      for (const t of teamClassification(classified, cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber });
    }
  }

  // Træthed ved start af sidste etape pr. rytter (peak de reelt kørte på) — in-memory
  // observability + simulér-før-ship-verifikation. Persisteres ikke (intet DB-skema rørt).
  const lastIdx = stagesSorted.length - 1;
  const finalFatigue = Object.fromEntries(
    entrants.map((e) => [e.rider_id, fatigueSeqById.get(e.rider_id)[lastIdx]])
  );

  return { resultRows, passageRows, runs, finalFatigue, incidents: allIncidents, moments: allMoments, timelines: allTimelines };
}

// ── I/O: indlæsning ───────────────────────────────────────────────────────────

// PostgREST .in() encoder id-listen i URL'en — ved relaunch-skala (600-800 UUID'er)
// rammer det 414/proxy-grænser. Batch derfor alle id-opslag i bidder. (#1307-review)
const IN_CHUNK_SIZE = 200;
async function selectInChunks({ supabase, table, columns, inColumn, ids, extra = null }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    let q = supabase.from(table).select(columns).in(inColumn, ids.slice(i, i + IN_CHUNK_SIZE));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

async function loadStageProfiles(supabase, raceId) {
  const { data, error } = await supabase
    .from("race_stage_profiles")
    // Sub-2 (#2770): rutefelter tilføjet — computePassages (racePassages.js) læser
    // dem til passage-lag/bonussekunder. Motoren (raceSimulator.js) læser dem ALDRIG.
    .select("stage_number, profile_type, finale_type, demand_vector, distance_km, elevation_gain_m, climbs, sprints, sectors")
    .eq("race_id", raceId)
    .order("stage_number", { ascending: true });
  if (error) throw new Error(`race_stage_profiles: ${error.message}`);
  return data || [];
}

// #3470: stage_number → game_day for ét løb. game_day er den ROBUSTE kilde til GT-
// hviledags-huller (se raceCalendarLanePacker.js's Option A: hul i game_day, TÆT
// stage_number) — DEN faktiske binding-nøgle, uafhængig af IRL-komprimering
// (scheduled_at kan ikke bruges til det samme: flere game_day-slots deler ofte samme
// kalenderdato, jf. TIER_STAGE_SLOTS). Manglende/legacy schedule-data → tomt Map
// (kalderen degraderer til 0 hviledage, ikke en fejl — samme mønster som
// loadStageDayOrdinals i racePeakPlans.js).
async function loadStageGameDays(supabase, raceId) {
  const { data, error } = await supabase
    .from("race_stage_schedule")
    // pagination-safe: bundet til ÉT race_id — et løb har maks ~21 etaper
    // (GRAND_TOUR_MIN_STAGES-loftet), langt under PostgREST's 1000-rækkers-cap.
    .select("stage_number, game_day")
    .eq("race_id", raceId);
  if (error) throw new Error(`race_stage_schedule (GT hviledags-gab): ${error.message}`);
  const out = new Map();
  for (const row of data || []) if (row.game_day != null) out.set(row.stage_number, row.game_day);
  return out;
}

// #3470: antal GT-hviledage (game_day-hul) FØR hver etape i `stagesSorted` — parallelt
// array (index 0 er altid 0, ingen "før" første etape). REN, ingen DB — `stagesSorted`
// skal allerede bære `.game_day` (attacheret af kaldestedet, samme mønster som
// attachPeakContext's `.peakDay`-mutation). Manglende game_day-data for et par →
// 0 (degraderer til nuværende adfærd). Eksporteret til test (raceRunner.test.js).
export function restDaysBeforeEachStage(stagesSorted) {
  const gaps = new Array(stagesSorted.length).fill(0);
  for (let i = 1; i < stagesSorted.length; i++) {
    const prevGd = stagesSorted[i - 1]?.game_day;
    const curGd = stagesSorted[i]?.game_day;
    if (Number.isFinite(prevGd) && Number.isFinite(curGd)) {
      gaps[i] = Math.max(0, curGd - prevGd - 1);
    }
  }
  return gaps;
}

// #3470: hæft game_day på hver stage (mutation, samme livscyklus som attachPeakContext's
// peakDay) — UAFHÆNGIGT af v3-flaget (fatigue-restitution er ikke en v3-feature).
async function attachStageGameDays({ supabase, race, stages, loadStageGameDaysFn }) {
  const gameDayByStageNumber = await loadStageGameDaysFn(supabase, race.id);
  for (const s of stages) s.game_day = gameDayByStageNumber.get(s.stage_number ?? 1) ?? null;
}

// S5 (#2224): resolvér peak-kontekst for ét løb og hæft den på stages + entrants
// (muterer de friskt-loadede objekter — samme livscyklus som fatigue/role-
// berigelsen). KUN kaldt når v3=true, så flag-off rører ALDRIG disse loadere.
// Loaderne + tq-resolveren er injectable (default = de ægte) så simulateRace/
// simulateStageRace kan testes uden ægte peak-planer. Entrants uden vindue får
// INGEN peak-felter (holder simEntrant-formen bit-identisk med v3-uden-plan).
async function attachPeakContext({ supabase, race, stages, entrants, loadPeakPlansFn, loadStageDayOrdinalsFn, resolveTQsFn }) {
  const stageDayByNumber = await loadStageDayOrdinalsFn({ supabase, raceId: race.id });
  for (const s of stages) s.peakDay = stageDayByNumber.get(s.stage_number ?? 1) ?? null;

  const peakPlansByRider = await loadPeakPlansFn({
    supabase, seasonId: race.season_id, riderIds: entrants.map((e) => e.rider_id),
  });
  // S5-kobling (addendum §2): beregn ÆGTE per-vindue traeningskvalitet fra optakts-
  // signaler (konsistens/fokus-match/sundhed/trætheds-styring) — muterer hvert vindue
  // i peakPlansByRider med .trainingQuality. Batch (ét kald pr. tabel for hele feltet).
  await resolveTQsFn({ supabase, entrants, peakPlansByRider });
  for (const e of entrants) {
    const windows = peakPlansByRider.get(e.rider_id);
    if (windows?.length) e.peakWindows = windows; // vinduerne bærer nu per-vindue tq
  }
}

// Range-pagineret fetch (PostgREST default-cap = 1000 rækker → tavs trunkering; #1839).
const PAGE_SIZE = 1000;
async function fetchAllPaged(query) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}

// #1845: binding-kontekst for runtime auto-fill — dette løbs CET-dag-vindue + hvert holds
// ryttere udtaget i ANDRE løb (med deres vinduer), så excludeBoundRiders kan udelukke en
// rytter der allerede er bundet i et tidsoverlappende løb (inkl. igangværende). Tynd I/O.
async function loadFieldBindingContext({ supabase, race, teamIds }) {
  const empty = { thisWindow: null, otherRacesByTeam: new Map() };
  if (!teamIds?.length) return empty;

  // game_day er OBLIGATORISK i disse to selects: raceBindingWindow (raceBinding.js:56)
  // nøgler på in-game-dagen KUN hvis hver row har et endeligt game_day — ellers falder den
  // tavst tilbage til real-kalenderdag-ordinalen. Efter kalender-rebuilden (2026-06-27,
  // #1945) er mange in-game-dage komprimeret til samme real-eftermiddag, så kalenderdag-
  // nøgling lader ALLE løb overlappe → excludeBoundRiders udelukker hele feltet → tomt
  // startfelt → "No start list". Søster-stien loadTeamBindingContext selecter allerede game_day.
  const { data: thisSched, error: e0 } = await supabase
    .from("race_stage_schedule").select("scheduled_at, game_day").eq("race_id", race.id);
  if (e0) throw new Error(`race_stage_schedule (binding this): ${e0.message}`);
  const thisWindow = raceBindingWindow(thisSched);
  if (!thisWindow) return empty; // dette løb har intet vindue → kan ikke binde

  // Holdenes entries i ANDRE løb (range-pagineret mod 1000-cap'en). #1906: gennem den
  // delte eligibility-loader, så en ghost/udlånt rytter ikke phantom-låser en ægte
  // rytter væk fra det aktuelle løbs felt under runtime auto-fill (excludeBoundRiders).
  const { data: entries, error: e1 } = await loadEligibleEntries({
    supabase, paged: true,
    // #3126: .order() på PK (race_id, rider_id) — .range() uden en deterministisk
    // totalordning kan hoppe rækker mellem sider (samme fejlklasse som #3113).
    baseQuery: () =>
      supabase.from("race_entries").select("race_id, team_id, rider_id").in("team_id", teamIds).neq("race_id", race.id)
        .order("race_id", { ascending: true }).order("rider_id", { ascending: true }),
  });
  if (e1) throw new Error(`race_entries (binding others): ${e1.message}`);
  if (!entries.length) return { thisWindow, otherRacesByTeam: new Map() };

  // Rod A-paritet (#1823/#4283): et holds AFMELDTE løb binder ikke — entries bevares ved
  // afmelding (gen-tilmelding giver samme trup), men de tæller ikke som optaget tid.
  // Søster-stien loadTeamBindingContext filtrerer allerede withdrawn; uden samme filter her
  // phantom-binder et afmeldt etapeløbs entries rytterne, og runtime-autofyldet stiller et
  // unødigt tyndt startfelt i overlappende løb.
  const { data: wRows, error: eWd } = await supabase
    .from("race_withdrawals").select("race_id, team_id").in("team_id", teamIds);
  if (eWd) throw new Error(`race_withdrawals (binding others): ${eWd.message}`);
  const withdrawnKeys = new Set((wRows || []).map((w) => `${w.team_id}|${w.race_id}`));
  const bindingEntries = entries.filter((e) => !withdrawnKeys.has(`${e.team_id}|${e.race_id}`));
  if (!bindingEntries.length) return { thisWindow, otherRacesByTeam: new Map() };

  // #3076 (samme rod-årsag som #3070, tredje lag): binding-nøglen er game_day, som er
  // SÆSON-RELATIV og nulstilles hver sæson (prod: både S1 og S2 spænder 0..~100000).
  // Uden sæson-filter ser excludeBoundRiders en forrige-sæsons entry som en aktiv binding
  // og udelader rytteren fra startfeltet — samme "for tyndt felt"-udfald som kommentaren
  // om game_day ovenfor advarer mod, blot udløst af sæsonskiftet i stedet for manglende
  // backfill. Sæsonen opløses HER frem for at stole på at hver kaldevej har season_id med
  // på race-objektet: loadEntrantsForRace nås fra flere steder (stage-løkken, admin-
  // simulering), og en kalder der glemmer feltet ville ellers slå binding helt fra i
  // tavshed — netop den fejlklasse dette fix findes for.
  let seasonId = race?.season_id ?? null;
  if (!seasonId && race?.id) {
    const { data: raceRow, error: eSeason } = await supabase
      .from("races").select("season_id").eq("id", race.id).maybeSingle();
    if (eSeason) throw new Error(`races season (binding this): ${eSeason.message}`);
    seasonId = raceRow?.season_id ?? null;
  }
  if (!seasonId) {
    throw new Error(`loadFieldBindingContext: could not resolve season_id for race ${race?.id}; binding would cross the season boundary (#3076)`);
  }

  const candidateRaceIds = [...new Set(bindingEntries.map((e) => e.race_id))];
  const seasonRows = [];
  for (let i = 0; i < candidateRaceIds.length; i += 200) {
    const { data, error } = await supabase
      .from("races").select("id, season_id").in("id", candidateRaceIds.slice(i, i + 200));
    if (error) throw new Error(`races season (binding others): ${error.message}`);
    seasonRows.push(...(data || []));
  }
  const seasonByRaceId = new Map(seasonRows.map((r) => [r.id, r.season_id]));
  const otherRaceIds = candidateRaceIds.filter((rid) => seasonByRaceId.get(rid) === seasonId);
  if (!otherRaceIds.length) return { thisWindow, otherRacesByTeam: new Map() };

  const scheds = [];
  for (let i = 0; i < otherRaceIds.length; i += 200) {
    const chunk = otherRaceIds.slice(i, i + 200);
    // #3126: .order() på PK (race_id, stage_number) — se fetchAllScheduleRows i
    // api.js for hvorfor et uordnet .range() genindfører #3113-fejlklassen.
    const { data, error } = await fetchAllPaged(() =>
      supabase.from("race_stage_schedule").select("race_id, scheduled_at, game_day").in("race_id", chunk)
        .order("race_id", { ascending: true }).order("stage_number", { ascending: true })
    );
    if (error) throw new Error(`race_stage_schedule (binding others): ${error.message}`);
    scheds.push(...data);
  }
  const schedByRace = new Map();
  for (const s of scheds) {
    if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []);
    schedByRace.get(s.race_id).push(s);
  }
  const windowByRace = new Map();
  for (const rid of otherRaceIds) windowByRace.set(rid, raceBindingWindow(schedByRace.get(rid)));

  const byTeamRace = new Map(); // teamId → Map(raceId → [rider_id])
  for (const e of bindingEntries) {
    if (!byTeamRace.has(e.team_id)) byTeamRace.set(e.team_id, new Map());
    const m = byTeamRace.get(e.team_id);
    if (!m.has(e.race_id)) m.set(e.race_id, []);
    m.get(e.race_id).push(e.rider_id);
  }
  const otherRacesByTeam = new Map();
  for (const [teamId, raceMap] of byTeamRace) {
    const arr = [];
    for (const [rid, riderIds] of raceMap) {
      const w = windowByRace.get(rid);
      if (w) arr.push({ window: w, riderIds });
    }
    otherRacesByTeam.set(teamId, arr);
  }
  return { thisWindow, otherRacesByTeam };
}

// #1844: rider_ids fra et løbs FØRSTE etape-simulering (race_simulation_runs) = det
// frosne start-felt. Bruges til at låse senere etapers felt. Legacy/single-løb uden
// snapshot → null (ingen frysning). Håndterer både string-array og {rider_id}-objekter.
async function loadStartFieldRiderIds({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_simulation_runs").select("stage_number, entrant_snapshot")
    .eq("race_id", raceId).order("stage_number", { ascending: true }).limit(1);
  if (error) throw new Error(`race_simulation_runs (start field): ${error.message}`);
  const snap = data?.[0]?.entrant_snapshot;
  if (!Array.isArray(snap)) return null;
  return snap.map((x) => (typeof x === "string" ? x : x?.rider_id)).filter(Boolean);
}

// #1307: per-hold autopick. For hvert egnet hold (ikke test/frosset) UDEN entries
// for løbet: assistenten udtager 6-8 bedst egnede + kaptajn (spec 8.1 — "vælger du
// ikke, vælger assistenten fornuftigt; ingen straf for fravær"). Hold MED entries
// (manager-udtagne) røres ikke. Skadede (injured_until >= i dag) udelades (#1306 6.5).
//
// #1688 (forever-relaunch race-scale): to additive felt-garantier oven på #1307:
//   1. PULJE-FILTER — når løbet har en pulje (race.league_division_id), auto-fyldes
//      KUN hold i den pulje. Et løb hører til én pulje (race/standings-gruppe, #1608);
//      hold fra andre puljer hører ikke i feltet. Bærer løbet endnu ingen pulje
//      (pre-per-pool-race-virkelighed — `races` har ingen pulje-kolonne i dag, og
//      parallelle pulje-løb-instanser er bevidst out-of-scope), springes filteret
//      over og hele feltet behandles som én pulje (uændret #1307-adfærd) — men
//      felt-cap'et nedenfor beskytter stadig mod et urealistisk stort startfelt.
//   2. FELT-CAP — feltet cappes til POOL_TARGET_SIZE (24, = pulje-target). Er flere
//      end 24 hold egnede, beholdes de 24 STÆRKESTE målt på aggregeret roster-
//      base_value (markedsværdi-proxy). Det forener race-feltets størrelse med
//      pulje-kapaciteten (#1608: pulje-target = race-feltcap = 24).
export async function fillMissingTeamEntries({ supabase, race, stages, existingEntries, persist = true }) {
  // #2962: ufiltreret teams-select (kun test-konto-filtreret, ellers ALLE hold) —
  // 155 rækker 25/7, samme #2951-klasse (vokser med hver signup). Pagineret via
  // fetchAllRows; stabilt .order("id") som tiebreak.
  let teams;
  try {
    teams = await fetchAllRows(() => (
      supabase
        .from("teams")
        .select("id, is_test_account, is_frozen, league_division_id")
        .or("is_test_account.is.null,is_test_account.eq.false")
        .order("id", { ascending: true })
    ));
  } catch (teamErr) {
    throw new Error(`teams: ${teamErr.message}`, { cause: teamErr });
  }
  // #4295 (ejer-godkendt 27/8): redningen fylder op til GULVET, ikke kun fra nul.
  // Før talte ethvert hold med mindst én entry som "har valgt" og blev sprunget over.
  // Med et fladt gulv på 6 gjorde det den forkerte handling billigst: gemte du nul,
  // udtog assistenten en fuld trup til dig; gemte du tre, stod du med tre og startede
  // ikke. Nu er "har valgt" = har mindst MIN_RACE_ENTRIES ryttere i feltet; ligger
  // holdet under, fylder assistenten forskellen fra holdets frie ryttere.
  // Afmeldte (Fase 0b) og ryddede (#4285/#4200) hold springes fortsat over — begge
  // markeringer er spillerens egen udtalte beslutning om ikke at stille op.
  const riderIdsByTeam = new Map();
  for (const e of existingEntries || []) {
    if (!riderIdsByTeam.has(e.team_id)) riderIdsByTeam.set(e.team_id, new Set());
    riderIdsByTeam.get(e.team_id).add(e.rider_id);
  }
  const entryCountByTeam = new Map([...riderIdsByTeam].map(([teamId, ids]) => [teamId, ids.size]));
  // Hold der allerede er PÅ eller OVER gulvet røres ikke (uændret #1307-adfærd for dem).
  const teamsAtOrAboveFloor = new Set(
    [...entryCountByTeam].filter(([, count]) => count >= MIN_RACE_ENTRIES).map(([teamId]) => teamId)
  );
  // Ryttere der allerede står i feltet må aldrig fyldes ind igen (dublet-entry).
  const alreadyEnteredRiderIds = new Set((existingEntries || []).map((e) => e.rider_id));
  // Fase 0b: hold der har trukket sig fra løbet (frivillig deltagelse) udelades.
  const withdrawnTeams = await loadWithdrawnTeamIds({ supabase, raceId: race.id });
  // #4200 (anden halvdel): hold der eksplicit har RYDDET denne enhed udelades også.
  // #2599 gav sweepen den regel; løbs-tidens autofyld her var den sidste push-sti der
  // stadig fyldte en bekræftet-tom trup ud igen. Ryddet er ikke det samme som "har
  // ikke valgt": markeringen findes netop for at kunne skelne, og #4174's regel
  // ("udtager du ikke, udtager assistenten") gælder kun den sidste gruppe. Markeringen
  // forsvinder af sig selv i samme øjeblik spilleren udtager manuelt eller selv beder
  // om auto-fill, så tilstanden er altid spillerens egen og altid omgørlig.
  const clearedTeams = await loadClearedTeamIds({ supabase, raceId: race.id });

  // #1688 pulje-filter: kun hold i løbets pulje (når løbet har en). NB: DB-eq på
  // league_division_id kunne gøre dette server-side, men selectInChunks-/teams-stien
  // henter alle hold; vi filtrerer i app-koden så logikken er testbar og pulje-
  // semantikken er eksplicit (service_role/bulk bypasser desuden RLS).
  const racePoolId = race?.league_division_id ?? null;
  let eligibleTeams = (teams || []).filter(
    (t) => !t.is_frozen && !teamsAtOrAboveFloor.has(t.id)
      && !withdrawnTeams.has(t.id) && !clearedTeams.has(t.id)
  );
  if (racePoolId != null) {
    eligibleTeams = eligibleTeams.filter((t) => t.league_division_id === racePoolId);
  }
  let missingTeamIds = eligibleTeams.map((t) => t.id);
  if (!missingTeamIds.length) return [];

  const { data: riders, error: riderErr } = await selectInChunks({
    supabase, table: "riders", columns: "id, team_id, base_value",
    // Rod B: delt eligibility-filter (ikke-akademi + ikke-pensioneret). Manglede
    // is_academy → akademiryttere kunne sim-tids-autofyldes (#1742/#1800).
    inColumn: "team_id", ids: missingTeamIds,
    extra: (q) => applyRiderEligibilityFilter(q),
  });
  if (riderErr) throw new Error(`riders: ${riderErr.message}`);

  // #1688 felt-cap: er der flere end POOL_TARGET_SIZE egnede hold, behold de 24
  // stærkeste på aggregeret roster-base_value. Beregnes FØR skade-/abilities-
  // filtrering, så cap'et følger holdets reelle styrke (ikke det tilfældige antal
  // skadede den dag). Deterministisk tie-break på team_id, så samme felt hver gang.
  //
  // #4295: cap'et gælder kun hold der TILFØJES feltet, altså dem uden en eneste entry.
  // Et hold der ligger under gulvet er allerede i feltet med sine egne manuelle picks;
  // at cappe det væk ville betyde at manageren blev skåret ud af sit eget løb, og
  // strength-summen ville desuden være undervurderet for netop dem (deres udtagne
  // ryttere er filtreret ud af `riders` ovenfor).
  const rescueTeamIds = missingTeamIds.filter((id) => (entryCountByTeam.get(id) || 0) > 0);
  let emptyTeamIds = missingTeamIds.filter((id) => !(entryCountByTeam.get(id) || 0));
  if (emptyTeamIds.length > POOL_TARGET_SIZE) {
    const strengthByTeam = new Map(emptyTeamIds.map((id) => [id, 0]));
    for (const r of riders || []) {
      if (strengthByTeam.has(r.team_id)) {
        strengthByTeam.set(r.team_id, strengthByTeam.get(r.team_id) + (r.base_value || 0));
      }
    }
    const keptIds = new Set(
      [...emptyTeamIds]
        .sort((a, b) => {
          const diff = (strengthByTeam.get(b) || 0) - (strengthByTeam.get(a) || 0);
          return diff !== 0 ? diff : (a < b ? -1 : a > b ? 1 : 0);
        })
        .slice(0, POOL_TARGET_SIZE),
    );
    emptyTeamIds = emptyTeamIds.filter((id) => keptIds.has(id));
    missingTeamIds = [...emptyTeamIds, ...rescueTeamIds];
  }
  const keptTeamSet = new Set(missingTeamIds);

  // Spec 6.5 (#1306) / #3896: skadede ryttere (kanonisk isRiderInjured) må ikke
  // auto-fyldes i startfeltet.
  const todayStr = copenhagenDateString();
  const { data: injured, error: injErr } = await applyInjuredFilter(
    supabase.from("rider_condition").select("rider_id"), todayStr
  );
  if (injErr) throw new Error(`rider_condition (injured): ${injErr.message}`);
  const injuredIds = new Set((injured || []).map((r) => r.rider_id));
  // #1688: riders blev hentet for hele pre-cap-sættet — behold kun ryttere på de
  // hold der overlevede felt-cap'et, så cappede hold ikke smutter ind i feltet.
  // #4295: en rytter der ALLEREDE står i feltet (holdets egne manuelle picks) må ikke
  // fyldes ind igen af redningen — det ville give en dublet-entry for samme (race, rider).
  const candidates = (riders || []).filter(
    (r) => !injuredIds.has(r.id) && keptTeamSet.has(r.team_id) && !alreadyEnteredRiderIds.has(r.id)
  );
  if (!candidates.length) return [];

  const candidateIds = candidates.map((r) => r.id);
  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const { data: abilities, error: aErr } = await selectInChunks({
    supabase, table: "rider_derived_abilities", columns: abilityCols,
    inColumn: "rider_id", ids: candidateIds,
  });
  if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
  const abilityByRider = new Map((abilities || []).map((a) => [a.rider_id, a]));

  // Træthed (let dæmpning i autopick) — degraderer til 0 ved fejl, mirror B2.
  let fatigueByRider = new Map();
  const { data: conditions, error: condErr } = await selectInChunks({
    supabase, table: "rider_condition", columns: "rider_id, fatigue",
    inColumn: "rider_id", ids: candidateIds,
  });
  if (!condErr) fatigueByRider = new Map((conditions || []).map((c) => [c.rider_id, c.fatigue]));

  const sizeRule = selectionSizeForRace(race);
  const rows = [];
  const byTeam = new Map();
  for (const r of candidates) {
    const abRow = abilityByRider.get(r.id);
    if (!abRow) continue; // uden abilities kan rytteren ikke scores (defensivt, som entrants)
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push({ rider_id: r.id, abilities: abRow, fatigue: fatigueByRider.get(r.id) });
  }
  // #1845: cross-race binding — runtime auto-fill MÅ ikke vælge en rytter der allerede
  // er bundet i et tidsoverlappende løb (samme CET-dag, inkl. IGANGVÆRENDE løb). Uden
  // dette fyldte fx Tour des Alpes Suisses med den igangværende La Corsas ryttere
  // (142 dobbeltbookinger 25/6). Spejler raceEntryGenerator.assignTeamAcrossRaces.
  const { thisWindow, otherRacesByTeam } = await loadFieldBindingContext({
    supabase, race, teamIds: [...byTeam.keys()],
  });
  for (const [teamId, teamRiders] of byTeam) {
    const available = excludeBoundRiders({
      riders: teamRiders, thisWindow, otherRaces: otherRacesByTeam.get(teamId) || [],
    });
    // #4295: to forskellige jobs bag samme løkke.
    //   0 entries  → uændret #1307-autopick: assistenten udtager en HEL trup (sizeRule)
    //                med kaptajn og spurt-kaptajn, fordi manageren intet har valgt.
    //   1..5 entries → SEN REDNING: fyld præcis op til gulvet (6), ikke op til feltet.
    //                Managerens egne picks og roller står; de tilføjede er hjælpere, så
    //                redningen aldrig sætter en anden kaptajn end den han selv valgte.
    const existingCount = entryCountByTeam.get(teamId) || 0;
    const isRescue = existingCount > 0;
    const rule = isRescue
      ? { min: MIN_RACE_ENTRIES - existingCount, max: MIN_RACE_ENTRIES - existingCount }
      : sizeRule;
    const picks = autopickTeamSelection({ riders: available, stages, sizeRule: rule });
    // Rækker kun hvis holdet FAKTISK når gulvet. Kan det ikke (for få frie ryttere),
    // stiller det ikke op alligevel — og så skal der ikke skrives auto-entries der
    // binder rytterne på løbsdagen for et startfelt de aldrig kommer i.
    if (existingCount + picks.length < MIN_RACE_ENTRIES) continue;
    for (const pick of picks) {
      rows.push({
        race_id: race.id, rider_id: pick.rider_id, team_id: teamId,
        race_role: isRescue ? "helper" : pick.race_role, is_auto_filled: true,
      });
    }
  }

  if (persist && rows.length) {
    const { error: insErr } = await supabase.from("race_entries").insert(rows);
    if (insErr) {
      // #3420: DB-backstoppet (no_rider_double_booking) er den sidste linje hvis
      // loadFieldBindingContext/excludeBoundRiders ovenfor alligevel skulle overse
      // en konflikt ved race-start — det ville afsløre en bug i selve runtime-
      // autofillet, ikke bare en enkelt spillerhandling, så fejlen skal være
      // tydelig i loggen (ikke maskeret som en generisk Postgres-tekst).
      if (isRiderDayInvariantViolation(insErr)) {
        throw new Error(
          `race_entries insert: rider-day invariant (#3420) rejected the race-start autofill for race ${race.id} — ` +
          `the runtime autofill's own binding exclusion missed a double-booking (${insErr.message})`
        );
      }
      throw new Error(`race_entries insert: ${insErr.message}`);
    }
  }
  return rows.map((r) => ({ rider_id: r.rider_id, team_id: r.team_id, race_role: r.race_role }));
}

// U25 afledt SÆSON-korrekt fra birthdate (#109/#2073). Den lagrede riders.is_u25-
// kolonne er statisk (DEFAULT FALSE) og re-deriveres aldrig → 16-18-årige oprettet
// uden flag (akademi/intake/generatorer) forblev false for evigt og manglede i
// ungdomsklassementet. Konventionen matcher fictionalRiderGenerator + import_riders.py:
//   U25 = fødselsår > referenceår - 25  ⇔  (referenceår − fødselsår) < 25.
// referenceåret er SÆSONENS år (seasons.start_date), ikke wall-clock — så gaten er
// sæson-drevet. Manglende birthdate/ugyldigt referenceår → false (kan ikke bekræftes).
export function deriveIsU25FromBirthdate(birthdate, seasonYear) {
  if (!birthdate || !Number.isFinite(seasonYear)) return false;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return false;
  return birthYear > seasonYear - 25;
}

// Sæsonens referenceår = året for seasons.start_date. Additiv/degraderende opslag
// (som condition-/team_name-berigelsen): fejler det, falder vi tilbage til at bruge
// det lagrede is_u25-flag frem for at blokere finalization. race.season_id er
// garanteret af kalderne (runRaceFinalization/finalizeRaceStage kaster uden det).
async function loadSeasonReferenceYear({ supabase, seasonId }) {
  if (!seasonId) return null;
  try {
    // Await query-builderen direkte (thenable) frem for .maybeSingle() — så
    // opslaget virker mod både den ægte klient og de minimale test-mocks, og
    // enhver uventet throw degraderer til null (fallback til lagret is_u25).
    const { data, error } = await supabase
      .from("seasons")
      .select("start_date")
      .eq("id", seasonId);
    if (error) {
      console.error(`season reference-year lookup failed (falling back to stored is_u25): ${error.message}`);
      return null;
    }
    const startDate = Array.isArray(data) ? data[0]?.start_date : data?.start_date;
    if (!startDate) return null;
    const year = new Date(startDate).getFullYear();
    return Number.isFinite(year) ? year : null;
  } catch (e) {
    console.error(`season reference-year lookup threw (falling back to stored is_u25): ${e.message}`);
    return null;
  }
}

// Indlæs startfeltet (race_entries → per-hold autopick for hold UDEN entries) beriget
// med navn, is_u25, abilities + race_role. Hold MED manager-udtagne entries røres ikke.
// persist=false (#1102 dryRun): auto-fill beregnes i hukommelsen — ingen DB-insert.
// stages bruges af autopick til egnethedsscore (suitabilityScore pr. terrain).
export async function loadEntrantsForRace({ supabase, race, stages = [], persist = true, allowAutofill = true }) {
  const { data: existing, error } = await supabase
    .from("race_entries")
    .select("rider_id, team_id, race_role")
    .eq("race_id", race.id);
  if (error) throw new Error(`race_entries: ${error.message}`);

  let existingEntries = existing || [];
  // #1846: drop stale cross-division entries — et hold der har skiftet division (op/nedrykning)
  // efterlod entries i den gamle divisions løb. Kun hold i løbets EGEN division må være i feltet.
  if (race.league_division_id != null && existingEntries.length) {
    const teamIds = [...new Set(existingEntries.map((e) => e.team_id).filter(Boolean))];
    const { data: teamDivs } = await supabase.from("teams").select("id, league_division_id").in("id", teamIds);
    const teamDivisionById = new Map((teamDivs || []).map((t) => [t.id, t.league_division_id]));
    existingEntries = filterEntriesToRaceDivision({ entries: existingEntries, teamDivisionById, raceDivisionId: race.league_division_id });
  }
  // Rod B (#1742/#1800): drop committede ghost-entries — rytter solgt/fyret (off-team),
  // blevet akademi eller pensioneret EFTER udtagelse. Krydses mod rytterens NUVÆRENDE
  // tilstand, så en fremmed/uegnet rytter aldrig kører for et hold han har forladt
  // (forbrugs-punkt-gyldighed; spejler #1846-divisions-filteret ovenfor). Ingen query-
  // eligibility-filter her — vi henter netop akademi/pensioneret-rækkerne for at se dem.
  if (existingEntries.length) {
    const entryRiderIds = [...new Set(existingEntries.map((e) => e.rider_id))];
    const { data: entryRiders, error: erErr } = await selectInChunks({
      supabase, table: "riders", columns: "id, team_id, is_academy, is_retired",
      inColumn: "id", ids: entryRiderIds,
    });
    if (erErr) throw new Error(`riders (eligibility): ${erErr.message}`);
    const ridersById = new Map((entryRiders || []).map((r) => [r.id, r]));
    existingEntries = filterEligibleEntries({ entries: existingEntries, ridersById });
  }
  // #3896: skadede committede entries må hverken starte eller simuleres — motoren
  // ekskluderede tidligere KUN skade fra auto-fyld/auto-pick-kandidatpuljer (#2637/#1306),
  // ALDRIG fra manager-udtagne race_entries. En rytter der blev udtaget rask og siden
  // skadet FØR løbsstart kunne derfor stadig stå i startfeltet og score en etapesejr
  // (Discord-bug 17/8, Cooper Bennett). Kører på HVER etape-build (mirror ghost-filteret
  // ovenfor) — for etape 2+ fryser #1844 feltet alligevel til etape-1-snapshottet, så
  // denne eksklusion reelt kun kan ændre feltet FØR løbet er startet.
  if (existingEntries.length) {
    const entryRiderIds = [...new Set(existingEntries.map((e) => e.rider_id))];
    const { data: conditions, error: condErr } = await selectInChunks({
      supabase, table: "rider_condition", columns: "rider_id, injured_until",
      inColumn: "rider_id", ids: entryRiderIds,
    });
    if (condErr) throw new Error(`rider_condition (injured): ${condErr.message}`);
    const injuredUntilByRider = new Map((conditions || []).map((c) => [c.rider_id, c.injured_until]));
    existingEntries = filterOutInjuredEntries({
      entries: existingEntries, injuredUntilByRider, todayStr: copenhagenDateString(),
    });
  }
  // #1307: autopick for hold UDEN entries. #1844: KUN ved etape 1 (allowAutofill) — et
  // igangværende etapeløb må ikke få nye ryttere fyldt ind mellem etaper (feltet er låst).
  const autopicked = allowAutofill
    ? await fillMissingTeamEntries({ supabase, race, stages, existingEntries, persist })
    : [];
  let entries = [...existingEntries, ...autopicked];
  // #4295 (ejer-beslutning 27/8): GULVET. Et hold skal have mindst 6 ryttere for at
  // stille op. Kører EFTER redningen ovenfor, så et hold der kunne fyldes op til 6 er
  // fyldt op FØR gulvet måles — ellers ville et hold med 3 gemte ryttere ryge ud af et
  // felt assistenten lige havde reddet.
  //
  // Kun ved løbets start (allowAutofill = stageIndex 0, raceRunner.js:2127). Et
  // igangværende etapeløb må ikke miste et hold midtvejs fordi skade-filteret ovenfor
  // har taget en rytter fra en trup der startede med præcis 6: gulvet gælder hvem der
  // STILLER OP, ikke hvem der stadig er i løbet på etape 4.
  if (allowAutofill) {
    const { kept, droppedTeamIds } = filterTeamsBelowMinimumEntries({ entries });
    if (droppedTeamIds.length) {
      console.log(
        `[race ${race.id}] ${droppedTeamIds.length} hold stiller ikke op: under ${MIN_RACE_ENTRIES} udtagne ryttere (#4295)`
      );
    }
    entries = kept;
  }
  if (!entries.length) return [];

  const teamByRider = new Map(entries.map((e) => [e.rider_id, e.team_id]));
  const roleByRider = new Map(entries.map((e) => [e.rider_id, e.race_role]));
  const riderIds = entries.map((e) => e.rider_id);

  const { data: riders, error: rErr } = await selectInChunks({
    supabase, table: "riders", columns: "id, firstname, lastname, is_u25, birthdate",
    inColumn: "id", ids: riderIds,
  });
  if (rErr) throw new Error(`riders: ${rErr.message}`);

  // #109/#2073: U25 afledes sæson-korrekt fra birthdate frem for det stale
  // riders.is_u25-flag. Referenceåret hentes fra sæsonen (additivt/degraderende:
  // fejler opslaget, falder vi tilbage til det lagrede flag pr. rytter nedenfor).
  const seasonRefYear = await loadSeasonReferenceYear({ supabase, seasonId: race.season_id });

  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const { data: abilities, error: aErr } = await selectInChunks({
    supabase, table: "rider_derived_abilities", columns: abilityCols,
    inColumn: "rider_id", ids: riderIds,
  });
  if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
  const abilityByRider = new Map((abilities || []).map((a) => [a.rider_id, a]));

  // Berig entrants med form/træthed fra rider_condition i ét batched opslag (spec #1306 B2).
  // Berigelsen er additiv: fejler opslaget, degraderer vi til neutral (undefined) frem for
  // at blokere race-finalization — modsat skade-eksklusionen i fillMissingTeamEntries, der SKAL fejle hårdt.
  let conditionByRider = new Map();
  const { data: conditions, error: condErr } = await selectInChunks({
    supabase, table: "rider_condition", columns: "rider_id, form, fatigue",
    inColumn: "rider_id", ids: riderIds,
  });
  if (condErr) {
    console.error(`rider_condition-berigelse fejlede (degraderer til neutral): ${condErr.message}`);
  } else {
    conditionByRider = new Map((conditions || []).map((c) => [c.rider_id, c]));
  }

  // #1993: snapshot holdnavnet på løbstidspunktet ind på hver entrant, så
  // buildRaceResults kan skrive et immutabelt team_name på race_results. Navnet
  // hentes fra teams ud fra entry'ens (frosne) team_id — IKKE fra rytterens
  // nuværende hold (team_id-snapshottet i race_entries er #1844-beskyttet).
  const teamIds = [...new Set([...teamByRider.values()].filter(Boolean))];
  let teamNameById = new Map();
  if (teamIds.length) {
    const { data: teamRows, error: teamErr } = await selectInChunks({
      supabase, table: "teams", columns: "id, name",
      inColumn: "id", ids: teamIds,
    });
    if (teamErr) {
      // Additiv berigelse: degradér til null frem for at blokere finalization.
      console.error(`team_name-berigelse fejlede (degraderer til null): ${teamErr.message}`);
    } else {
      teamNameById = new Map((teamRows || []).map((t) => [t.id, t.name]));
    }
  }

  const entrants = [];
  for (const r of riders || []) {
    const ab = abilityByRider.get(r.id);
    if (!ab) continue; // uden abilities kan rytteren ikke scores → udelad (defensivt)
    const teamId = teamByRider.get(r.id) ?? null;
    const entrant = {
      rider_id: r.id,
      team_id: teamId,
      team_name: teamId != null ? (teamNameById.get(teamId) ?? null) : null,
      rider_name: [r.firstname, r.lastname].filter(Boolean).join(" ") || null,
      // #109/#2073: sæson-afledt U25 (referenceår − fødselsår < 25). Kun hvis
      // sæson-referenceåret kunne læses; ellers fald tilbage til det lagrede flag
      // (degraderende — blokerer aldrig finalization).
      is_u25: seasonRefYear != null ? deriveIsU25FromBirthdate(r.birthdate, seasonRefYear) : !!r.is_u25,
      abilities: ab,
    };
    const role = roleByRider.get(r.id);
    if (role) entrant.race_role = role;
    const cond = conditionByRider.get(r.id);
    if (cond !== undefined) {
      entrant.form = cond.form;
      entrant.fatigue = cond.fatigue;
    }
    // Ryttere uden condition-række: form/fatigue sættes IKKE (undefined → neutral i simulatoren).
    entrants.push(entrant);
  }
  return entrants;
}

async function loadRacePoints(supabase, raceClass) {
  if (!raceClass) return [];
  const { data, error } = await supabase
    .from("race_points")
    .select("result_type, rank, points")
    .eq("race_class", raceClass);
  if (error) throw new Error(`race_points: ${error.message}`);
  return data || [];
}

// source: diskriminator til stage-schedulerens daglige cap (FIX 4). 'scheduler' →
// tælles i cap'en; null (admin-fuld-sim / manuel afvikling) → tælles ikke.
//
// #2352 (Race v3 S1, spec §11.3): når runs bærer `riderScores` (kun når v3 var
// ON i buildRaceResults/buildStageRowsAccumulated) genereres run-id'et CLIENT-
// SIDE (randomUUID) i stedet for at læne sig på DB'ens DEFAULT — så vi kan
// linke race_simulation_rider_scores.run_id UDEN en select-roundtrip efter
// insert. v3=false (langt de fleste kald i dag) rører IKKE denne sti — id
// forbliver DB-genereret som altid, adfærd uændret.
async function persistRuns({ supabase, race, runs, source = null }) {
  if (!runs.length) return;
  const hasRiderScores = runs.some((r) => Array.isArray(r.riderScores));
  const rows = runs.map((r) => ({
    ...(hasRiderScores ? { id: randomUUID() } : {}),
    race_id: race.id,
    stage_number: r.stage_number,
    seed: r.seed,
    engine_version: r.engine_version,
    entrant_snapshot: r.entrant_snapshot,
    input_checksum: r.input_checksum,
    source,
    // #2351: salt_version-kolonnen findes først efter migrationen er applied —
    // spread KUN når sat, så insert forbliver kompatibel med prod FØR migrationen
    // (salten aktiveres alligevel først når ejeren sætter env efter migrationen).
    ...(r.salt_version != null ? { salt_version: r.salt_version } : {}),
  }));
  // Idempotent: slet tidligere runs for de samme etaper før insert. §11.3:
  // race_simulation_rider_scores.run_id har ON DELETE CASCADE → gamle
  // rider_scores-rækker ryddes automatisk op sammen med deres run — ingen
  // separat delete af rider_scores nødvendig.
  //
  // #2974: eksplicit error-tjek er PÅKRÆVET — samme fejlklasse som #2898.
  // supabase-js kaster ikke: fejler denne delete tavst, kører insertet nedenfor
  // alligevel og lægger de nye runs OVEN PÅ de gamle. Resultatet er dublerede
  // run-snapshots for samme (race_id, stage_number) — og dermed også dublerede
  // rider_scores, fordi hver dublet-run trækker sit eget sæt med. Abort FØR insert.
  const stageNumbersInRun = [...new Set(rows.map((r) => r.stage_number))];
  const { error: deleteError } = await supabase
    .from("race_simulation_runs")
    .delete()
    .eq("race_id", race.id)
    .in("stage_number", stageNumbersInRun);
  if (deleteError) {
    const err = new Error(
      `race_simulation_runs delete failed for race ${race.id} (stages ${stageNumbersInRun.join(",")}) — ` +
        `aborting BEFORE insert to prevent duplicated run snapshots: ${deleteError.message}`,
    );
    console.error(`  ⚠️  ${err.message}`);
    captureException(err, { tags: { flow: "race-run", stage: "sim-runs-delete" }, raceId: race.id });
    throw err;
  }
  const { error } = await supabase.from("race_simulation_runs").insert(rows);
  if (error) throw new Error(`race_simulation_runs: ${error.message}`);

  if (hasRiderScores) {
    const scoreRows = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (!Array.isArray(run.riderScores)) continue;
      const runId = rows[i].id;
      for (const rs of run.riderScores) {
        scoreRows.push({ run_id: runId, rider_id: rs.rider_id, rank: rs.rank, components: rs.components });
      }
    }
    if (scoreRows.length) {
      const { error: scoreErr } = await supabase.from("race_simulation_rider_scores").insert(scoreRows);
      if (scoreErr) throw new Error(`race_simulation_rider_scores: ${scoreErr.message}`);
    }
  }
}

// Beregn injured_until-dato: dateStr (YYYY-MM-DD) + days → YYYY-MM-DD. Noon UTC
// undgår DST-kanttilfælde ved dato-aritmetik. Duplikeret fra dailyTrainingEngine.js
// (ikke eksporteret derfra) — samme lille helper, samme begrundelse som fnv1a32-
// duplikationen i raceDayForm.js/raceIncidents.js (undgår krydsimport for én linje).
function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// S4 (#1176): persistér race_incidents (idempotent delete-then-insert pr.
// (race_id, stageNumbers i DENNE kørsel) — spejrer persistRuns' mønster) +
// upsert rider_condition.injured_until/injury_cause for abandons. KUN kaldt
// når v3=true OG incidents ikke er tom (kald-stedets ansvar). Upsert-semantikken
// (supabase-js: UPDATE-stien rører KUN de angivne kolonner) betyder form/fatigue
// ALDRIG røres her — spejler raceFatigue.applyRaceFatigue's samme garanti.
async function persistIncidents({ supabase, race, incidents, stageNumbers }) {
  if (!incidents?.length) return;
  const rows = incidents.map((inc) => ({
    race_id: race.id,
    stage_number: inc.stage_number,
    rider_id: inc.rider_id,
    kind: inc.kind,
    outcome: inc.outcome,
    time_loss_seconds: inc.time_loss_seconds,
    injury_days: inc.injury_days,
  }));
  // #2974: samme utjekkede delete-før-insert som #2898. Et tavst fejlet delete
  // efterfølges alligevel af insertet → dublerede hændelser i etape-loggen, og
  // dermed dobbelt-tællende skades-/styrt-visninger. Abort FØR insert.
  const incidentStages = [...new Set(stageNumbers)];
  const { error: deleteError } = await supabase
    .from("race_incidents")
    .delete()
    .eq("race_id", race.id)
    .in("stage_number", incidentStages);
  if (deleteError) {
    const err = new Error(
      `race_incidents delete failed for race ${race.id} (stages ${incidentStages.join(",")}) — ` +
        `aborting BEFORE insert to prevent duplicated incidents: ${deleteError.message}`,
    );
    console.error(`  ⚠️  ${err.message}`);
    captureException(err, { tags: { flow: "race-run", stage: "incidents-delete" }, raceId: race.id });
    throw err;
  }
  const { error } = await supabase.from("race_incidents").insert(rows);
  if (error) throw new Error(`race_incidents: ${error.message}`);

  const abandons = incidents.filter((inc) => inc.outcome === "abandon");
  if (!abandons.length) return;
  const today = copenhagenDateString();
  const injuryRows = abandons.map((inc) => ({
    rider_id: inc.rider_id,
    injured_until: addDaysToDate(today, Number.isFinite(inc.injury_days) ? inc.injury_days : 1),
    injury_cause: "race_crash",
  }));
  const { error: injErr } = await supabase.from("rider_condition").upsert(injuryRows, { onConflict: "rider_id" });
  if (injErr) throw new Error(`rider_condition (incident injury): ${injErr.message}`);
}

// Sub-2 (#2770): persistér race_stage_passages (idempotent delete-then-insert
// pr. (race_id, stageNumbers i DENNE kørsel) — spejrer persistIncidents' mønster
// 1:1. Chunked insert (500/batch) — et stort felt × mange waypoints pr. etape
// kan let overstige typiske enkelt-insert-grænser. Data-gated (ikke v3-gated):
// kaldes for ALLE løb, men no-op'er naturligt når passageRows er tom (løb uden
// rutedata) — samme mønster som persistIncidents/persistStageMoments's tomme-
// liste-guard.
const PASSAGE_INSERT_CHUNK_SIZE = 500;
async function persistPassages({ supabase, race, passageRows, stageNumbers }) {
  if (!passageRows?.length) return;
  // #2974: samme utjekkede delete-før-insert som #2898. Fejler den tavst, lægger
  // chunk-insertet nedenfor de nye passager OVEN PÅ de gamle → dublerede
  // waypoints på etape-profilen. Abort FØR insert.
  const passageStages = [...new Set(stageNumbers)];
  const { error: deleteError } = await supabase
    .from("race_stage_passages")
    .delete()
    .eq("race_id", race.id)
    .in("stage_number", passageStages);
  if (deleteError) {
    const err = new Error(
      `race_stage_passages delete failed for race ${race.id} (stages ${passageStages.join(",")}) — ` +
        `aborting BEFORE insert to prevent duplicated passages: ${deleteError.message}`,
    );
    console.error(`  ⚠️  ${err.message}`);
    captureException(err, { tags: { flow: "race-run", stage: "passages-delete" }, raceId: race.id });
    throw err;
  }
  for (let i = 0; i < passageRows.length; i += PASSAGE_INSERT_CHUNK_SIZE) {
    const chunk = passageRows.slice(i, i + PASSAGE_INSERT_CHUNK_SIZE);
    const { error } = await supabase.from("race_stage_passages").insert(chunk);
    if (error) throw new Error(`race_stage_passages: ${error.message}`);
  }
}

// S6 (#2355): persistér race_stage_moments (idempotent delete-then-insert pr.
// (race_id, stageNumbers i DENNE kørsel) — spejler persistIncidents' mønster.
// KUN kaldt når v3=true OG moments ikke er tom (kald-stedets ansvar, samme som
// persistIncidents).
//
// GRACEFUL DEGRADATION (bevidst forskel fra persistIncidents' hårde throw):
// v3-scoring er ALLEREDE ON i prod (raceEngineFlag.js's note), så denne
// funktion begynder at kalde ind PRÆCIS når PR'en merges — FØR ejeren har nået
// at anvende migrationen manuelt (samme rækkefølge-problem S4 undgik ved at
// migrationen blev anvendt FØR v3 blev flippet). En fejl her må derfor ALDRIG
// vælte etape-afviklingen — log og fortsæt, samme "ærlig degradering"-regel
// som frontend-læsestien (RaceDetailPage's incidents-fetch).
async function persistStageMoments({ supabase, race, moments, stageNumbers }) {
  if (!moments?.length) return;
  try {
    const rows = moments.map((m) => ({
      race_id: race.id,
      stage_number: m.stage_number,
      moment_key: m.moment_key,
      params: m.params ?? {},
      significance: m.significance ?? 0,
      rider_ids: m.rider_ids ?? [],
      team_ids: m.team_ids ?? [],
    }));
    // #2974: tjek delete-fejlen FØR insertet. Funktionen degraderer bevidst
    // gracefully (catch'en nedenfor), men et TAVST fejlet delete er noget andet
    // end en degradering: så kører insertet alligevel og lægger momenterne OVEN
    // PÅ de gamle → dublerede why-momenter i etape-rapporten. Kastes fejlen i
    // stedet, rammer den catch'en og fladen degraderer som dokumenteret — til
    // INGEN nye momenter, ikke dobbelte.
    const { error: deleteError } = await supabase
      .from("race_stage_moments")
      .delete()
      .eq("race_id", race.id)
      .in("stage_number", [...new Set(stageNumbers)]);
    if (deleteError) throw deleteError;
    const { error } = await supabase.from("race_stage_moments").insert(rows);
    if (error) throw error;
  } catch (err) {
    // best-effort: why-rapporten er additiv pynt oven på resultatet — migrationen
    // (2026-07-16-race-v3-s6-why-moments.sql) applies manuelt EFTER merge, så
    // tabellen kan mangle i vinduet. Et fejlet moment-persist må ALDRIG vælte
    // selve løbs-finaliseringen; fladen degraderer til ingen momenter.
    console.warn(`  ⚠️  race_stage_moments persist failed for race ${race.id} (table may not be migrated yet — why-rapport degraderer til ingen momenter): ${err.message}`);
    captureException(err, { tags: { flow: "race-finalization", stage: "persist-stage-moments" }, raceId: race.id });
  }
}

// #2410 (event-log S1): persistér race_stage_timelines (idempotent delete-then-
// insert pr. (race_id, stageNumbers i DENNE kørsel) — spejler persistStageMoments'
// mønster 1:1, INKL. graceful degradation: migrationen (ny tabel, spiller-RLS)
// applies manuelt EFTER merge (#2642-rammer), så tabellen kan mangle i vinduet
// mellem merge og ejerens apply. En fejlet tidslinje-persist må ALDRIG vælte
// selve løbs-finaliseringen — kaldeSTEDETS ansvar (raceRunner.js) er allerede at
// kun kalde denne funktion når `timeline`-flaget er ON og timelines ikke er tom.
async function persistStageTimelines({ supabase, race, timelines, stageNumbers }) {
  if (!timelines?.length) return;
  try {
    const rows = timelines.map((t) => ({
      race_id: race.id,
      stage_number: t.stage_number,
      timeline_version: t.timeline_version ?? 1,
      events: t.events ?? [],
    }));
    // Samme "tjek delete-fejlen FØR insertet"-disciplin som persistStageMoments
    // (#2974): et TAVST fejlet delete efterfulgt af et insert ville dublere
    // tidslinjer for samme (race_id, stage_number) i stedet for at degradere
    // rent til "ingen tidslinje" via catch'en nedenfor.
    const { error: deleteError } = await supabase
      .from("race_stage_timelines")
      .delete()
      .eq("race_id", race.id)
      .in("stage_number", [...new Set(stageNumbers)]);
    if (deleteError) throw deleteError;
    const { error } = await supabase.from("race_stage_timelines").insert(rows);
    if (error) throw error;
  } catch (err) {
    // best-effort: tidslinjen er additiv observation oven på resultatet (spec
    // §2.1) — en fejlet persist må ALDRIG vælte selve løbs-finaliseringen;
    // fladen degraderer til ingen tidslinje (samme regel som race_stage_moments).
    console.warn(`  ⚠️  race_stage_timelines persist failed for race ${race.id} (table may not be migrated yet — tidslinjen degraderer til ingen tidslinje): ${err.message}`);
    captureException(err, { tags: { flow: "race-finalization", stage: "persist-stage-timelines" }, raceId: race.id });
  }
}

// #3398 (Maiden Win Engine): career-firsts-detektion — samme grad af graceful
// degradation som persistStageMoments ovenfor (rider_career_events kan mangle i
// vinduet mellem merge og ejerens manuelle migration-apply, #2642-rammerne).
// detectCareerFirsts fanger allerede fejl PR. kandidat internt og returnerer
// altid et stats-objekt (aldrig en throw) — denne ydre try/catch er et ekstra
// sikkerhedslag mod uventede fejl FØR selve kandidat-loopet (fx en malformed
// resultRows-form), så en career-firsts-fejl under INGEN omstændigheder kan
// vælte selve løbs-finaliseringen.
async function runCareerFirstsDetection({ supabase, race, resultRows, stageNumbers, seasonNumber }) {
  if (!resultRows?.length) return;
  try {
    await detectCareerFirsts({ supabase, race, resultRows, stageNumbers, seasonNumber });
  } catch (err) {
    // best-effort: career-firsts-momenter er additiv pynt oven på resultatet —
    // migrationen (2026-08-05-3398-maiden-win-engine.sql) applies manuelt EFTER
    // merge, så tabellen kan mangle i vinduet. En fejl her må ALDRIG vælte
    // selve løbs-finaliseringen; fladen degraderer til ingen career-first-events.
    console.warn(`  ⚠️  career-firsts detection failed for race ${race.id} (table may not be migrated yet — degraderer til ingen career-first-events): ${err.message}`);
  }
}

// S4 (#1176): race_incidents bærer kun rider_id (samme mønster som
// race_results/persistIncidents ovenfor) — ét let riders-opslag før
// notifyDiscord, så buildRaceSimEmbed's DNF-linje kan vise navne uden selv at
// kende supabase. Fejlfri degradering: et opslags-problem giver rider_name=null
// i stedet for at vælte Discord-notifikationen (som selv er try/catch'et af
// kald-stederne).
async function enrichIncidentsForDiscord({ supabase, incidents }) {
  if (!incidents?.length) return [];
  const riderIds = [...new Set(incidents.map((inc) => inc.rider_id).filter(Boolean))];
  if (!riderIds.length) return incidents;
  const { data: riders } = await supabase.from("riders").select("id, firstname, lastname").in("id", riderIds);
  const nameById = new Map((riders || []).map((r) => [r.id, [r.firstname, r.lastname].filter(Boolean).join(" ") || null]));
  return incidents.map((inc) => ({ ...inc, rider_name: nameById.get(inc.rider_id) ?? null }));
}

/**
 * I/O-orchestrator: afvikl ét løb via motoren og skriv via den UÆNDREDE
 * applyRaceResults. Spejler pcmResultsImport's idempotens + efter-orkestrering.
 * Bør kun kaldes når RACE_ENGINE_V2_ENABLED er ON (se raceEngineFlag.js).
 */
export async function simulateRace({
  supabase,
  race,
  dryRun = false,
  applyRaceResults = applyRaceResultsShared,
  ensureSeasonStandings = async () => {},
  updateStandings = async () => {},
  recomputeRaceDays = recomputeSeasonRaceDays,
  processBoardWeekend = processBoardWeekendFinalizationShared,
  notifyDiscord = null,
  notifyInApp = null,
  applyFatigue = applyRaceFatigue,
  // #3470: injectable, default læser race_stage_schedule.game_day + persisterer via
  // den ægte GT-hviledags-restitution (bit-identisk no-op når ingen game_day-huller).
  loadStageGameDays: loadStageGameDaysFn = loadStageGameDays,
  applyGrandTourRestDayFatigue: applyGrandTourRestDayFatigueFn = applyGrandTourRestDayFatigueShared,
  // #2352 (Race v3 S1): injectable som de øvrige samarbejdspartnere ovenfor —
  // default læser den ægte kill-switch (app_config.race_engine_v3_scoring).
  checkV3Enabled = isRaceEngineV3ScoringEnabled,
  // #2410 (event-log S1): injectable, default læser den ægte kill-switch
  // (app_config.race_stage_timeline). flag-off → buildRaceResults kaldes med
  // timeline=false → INGEN ekstra DB-kald (samme mønster som checkV3Enabled).
  checkTimelineEnabled = isRaceStageTimelineEnabled,
  // S3 (#2034): injectable, default læser race_stage_roles. Kun kaldt når v3=true
  // (se nedenfor) — undgår et unødvendigt DB-kald ved flag-off.
  loadStageRoleOverrides: loadStageRoleOverridesFn = loadStageRoleOverrides,
  // S5 (#2224): injectable peak-loadere + tq-resolver. Kun kaldt når v3=true.
  loadPeakPlans: loadPeakPlansFn = loadPeakPlans,
  loadStageDayOrdinals: loadStageDayOrdinalsFn = loadStageDayOrdinals,
  resolvePeakTrainingQualities: resolveTQsFn = resolvePeakTrainingQualities,
}) {
  if (!supabase?.from) throw new Error("supabase client required");
  if (!race?.id || !race?.season_id) throw new Error("race {id, season_id} required");

  // #1187 · race_days_completed FØR afviklingen — checkpoint-udgangspunkt for
  // board-weekend-wiring nedenfor. Defensiv: manglende række → null (ingen
  // checkpoint-evaluering, satisfaction opdateres stadig).
  const { data: seasonBefore } = await supabase
    .from("seasons")
    .select("id, number, status, race_days_completed, race_days_total")
    .eq("id", race.season_id)
    .maybeSingle();

  const stages = await loadStageProfiles(supabase, race.id);
  // #3470: hæft game_day på hver etape (kun meningsfuldt for etapeløb — endagsløb har
  // trivielt game_day-hul=0 uanset) FØR entrants/results bygges, UAFHÆNGIGT af v3.
  if (race.race_type === "stage_race") {
    await attachStageGameDays({ supabase, race, stages, loadStageGameDaysFn });
  }
  if (!stages.length) throw new Error(`No race_stage_profiles for race ${race.id} — run backfill`);

  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: !dryRun });
  if (!entrants.length) throw new Error(`No start list for race ${race.id}`);

  const racePoints = await loadRacePoints(supabase, race.race_class);
  const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });

  // #2352: kill-switch læst ÉN gang pr. afvikling — hele løbet simuleres med
  // samme v3-tilstand (ingen mid-race-flip).
  const v3 = await checkV3Enabled(supabase);
  // #2410: samme engangs-læsning som v3 ovenfor, UAFHÆNGIGT flag.
  const timelineEnabled = await checkTimelineEnabled(supabase);
  // S3 (#2034): overrides hentes KUN når v3=true — v3=false undgår DB-kaldet helt
  // og buildRaceResults modtager undefined, hvilket garanterer bit-identisk flag-off.
  const stageRoleOverrides = v3 ? await loadStageRoleOverridesFn({ supabase, raceId: race.id }) : undefined;
  // S5 (#2224): peak-kontekst hæftes på stages + entrants KUN når v3=true → flag-off
  // undgår begge DB-kald og buildRaceResults ser ingen peak-felter (bit-identisk).
  if (v3) await attachPeakContext({ supabase, race, stages, entrants, loadPeakPlansFn, loadStageDayOrdinalsFn, resolveTQsFn });

  const { resultRows, passageRows, runs, incidents, moments, timelines } = buildRaceResults({ race, stages, entrants, pointsLookup, v3, stageRoleOverrides, timeline: timelineEnabled });

  // Dry-run-preview (#1102 runtime-wiring): alt loades og beregnes som ved en
  // ægte afvikling, men INTET skrives — admin kan inspicere udfaldet før flip.
  if (dryRun) {
    const stageWinners = resultRows
      .filter((r) => r.result_type === "stage" && r.rank === 1)
      .map((r) => ({ stage: r.stage_number, rider: r.rider_name }));
    const gcPodium = resultRows
      .filter((r) => r.result_type === "gc" && r.rank <= 3)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ rank: r.rank, rider: r.rider_name }));
    return {
      dryRun: true,
      rows: resultRows.length, stages: stages.length, entrants: entrants.length,
      stageWinners, gcPodium,
    };
  }

  // #3022 (afløser #2898's separate delete-tjek her): delete-af-berørte-etaper +
  // insert køres nu ATOMISK i ÉN DB-transaktion via applyRaceResults' interne
  // apply_race_results_batch-RPC-kald (stageNumbers sat → RPC-branch, se
  // raceResultsEngine.js). #2898's pointe (en fejlet delete må IKKE lade et
  // insert køre oven på de gamle rækker) er dermed en Postgres-transaktions-
  // garanti i stedet for en JS-level check-og-abort — strengere: den lukker
  // OGSÅ crash-mellem-de-to-kald-vinduet (#3022 fejlmode B), som #2898 ikke
  // dækkede. Idempotent PR. ETAPE uændret: kun de etaper denne afvikling faktisk
  // dækker slettes, så en gen-afvikling ikke wiper andre etaper.
  const stagesInRun = [...new Set(resultRows.map((r) => r.stage_number))];

  const applied = await applyRaceResults({
    supabase,
    race: { ...race },
    resultRows,
    stageNumbers: stagesInRun,
    ensureSeasonStandings,
    updateStandings,
  });

  // #3193: refresh rangliste-matviews (rider_rankings_mv, team_standings_ext_mv,
  // team_race_points_mv, global_rank_mv) LIGE EFTER season_standings er opdateret
  // — IKKE efter processBoardWeekend/notifyDiscord/notifyInApp nedenfor. Diagnose
  // (execute_sql mod prod 3/8, se PR-beskrivelsen): season_standings.total_points
  // er live (/standings læser den direkte), mens Global Rank læser global_rank_mv
  // (periodisk snapshot). Refresh lå tidligere HELT SIDST i denne funktion, efter
  // board-weekend-beregning + en ekstern Discord-webhook-kald + in-app-notifikation
  // — alt sammen best-effort-arbejde der intet har med selve refresh'en at gøre,
  // men som forlængede vinduet hvor /standings viste friske tal og Global Rank
  // stadig viste løbets FØR-tilstand. Flyttet hertil skærer det vindue ned til
  // selve REFRESH-statements' egen eksekveringstid. Best-effort (resultaterne ER
  // allerede skrevet) — en refresh-fejl må ikke vælte afviklingen.
  await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: captureException });

  await persistRuns({ supabase, race, runs });
  // Sub-2 (#2770): passage-detalje — data-gated (ikke v3-gated), no-op'er selv
  // ved tom liste (legacy-løb uden rutedata). Scopet til DENNE afviklings etaper
  // (stagesInRun), samme mønster som race_results-deleten ovenfor.
  if (passageRows.length) {
    await persistPassages({ supabase, race, passageRows, stageNumbers: stagesInRun });
  }
  // S4 (#1176): KUN når v3 (buildRaceResults returnerer incidents=[] ved v3=false,
  // så dette no-op'er uden DB-kald — persistIncidents selv guard'er på tom liste).
  if (v3 && incidents.length) {
    await persistIncidents({ supabase, race, incidents, stageNumbers: stages.map((s) => s.stage_number || 1) });
  }
  // S6 (#2355): why-rapport-momenter — samme v3+ikke-tom-gate som incidents.
  if (v3 && moments.length) {
    await persistStageMoments({ supabase, race, moments, stageNumbers: stages.map((s) => s.stage_number || 1) });
  }
  // #2410 (event-log S1): tidslinjer — UAFHÆNGIGT af v3 (egen flag-gate:
  // timelineEnabled). persistStageTimelines selv guard'er på tom liste, men
  // tjekket her undgår funktionskaldet helt ved flag-off (INGEN ekstra DB-kald).
  if (timelineEnabled && timelines.length) {
    await persistStageTimelines({ supabase, race, timelines, stageNumbers: stages.map((s) => s.stage_number || 1) });
  }
  // #3398 (Maiden Win Engine): career-firsts — UAFHÆNGIG af v3 (læser kun
  // result_type/rank/rider_id/team_id, som ALLE løb altid skriver til
  // resultRows). Samme stageNumbers-scoping som incidents/moments ovenfor.
  await runCareerFirstsDetection({
    supabase, race, resultRows,
    stageNumbers: stages.map((s) => s.stage_number || 1),
    seasonNumber: seasonBefore?.number ?? null,
  });
  // #2898: race_results er allerede skrevet på dette tidspunkt — recovery-logikken
  // (fx den stage-scheduler-baserede retry-sti #2878) læner sig på at status='completed'
  // er pålideligt sat. Et tavst-fejlet update ville efterlade løbet stående som
  // "ikke afviklet" trods skrevne resultater → et gen-forsøg ville forsøge at
  // afvikle igen oven på allerede skrevne race_results. Tjek + kast.
  const { error: statusError } = await supabase.from("races").update({ status: "completed" }).eq("id", race.id);
  if (statusError) {
    const err = new Error(
      `Failed to mark race ${race.id} as completed after results were persisted — results ARE written, ` +
        `only the status flag failed: ${statusError.message}`,
    );
    console.error(`  ⚠️  ${err.message}`);
    captureException(err, { tags: { flow: "race-run", stage: "race-status-completed" }, raceId: race.id });
    throw err;
  }

  // #1995: løbet er finaliseret → flush parkerede holdskifter for deltagerne.
  await flushDeferredTransfersSafe({ supabase, race });

  // #1306 spec 6.4: løbsdage bygger træthed — én batch pr. simuleret etape, kun ved
  // persist (dry-run returnerer allerede ovenfor). Fejl sluges: træthed er additiv
  // berigelse; et upsert-problem må ikke vælte finalization (mirror B2-beslutningen
  // for condition-berigelse i loadEntrantsForRace).
  const riderIds = entrants.map((e) => e.rider_id);
  const recoveryAbilityByRider = new Map(entrants.map((e) => [e.rider_id, e.abilities?.recovery]));
  // #3470: samme rækkefølge + samme game_day-hul-udledning som fatigueSeqById ovenfor
  // (restDaysBeforeEachStage(stagesSorted)) — persisteringen HER skal matche det
  // simuleringen allerede regnede med, ikke en uafhængig genberegning.
  const persistStagesSorted = [...stages].sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));
  const persistRestDaysBefore = restDaysBeforeEachStage(persistStagesSorted);
  for (let i = 0; i < persistStagesSorted.length; i++) {
    const stage = persistStagesSorted[i];
    // #3470: eksplicit hviledags-restitution FØR denne etapes belastning skrives, hvis
    // der er et game_day-hul til FORRIGE etape (GT-rest-dag). Fejl sluges (samme mønster
    // som applyFatigue nedenfor) — restitutionen er additiv berigelse, ikke kritisk sti.
    if (persistRestDaysBefore[i] > 0) {
      try {
        await applyGrandTourRestDayFatigueFn({
          supabase, riderIds, restDays: persistRestDaysBefore[i], recoveryAbilityByRider,
        });
      } catch (err) {
        console.error(`  ⚠️  GT hviledags-restitution fejlede (etape ${stage.stage_number}, ${persistRestDaysBefore[i]} hviledage): ${err.message}`);
        captureException(err, { tags: { flow: "race-run", stage: "gt-rest-day-fatigue" }, raceId: race.id, stageNumber: stage.stage_number });
      }
    }
    try {
      // S3 (#2034): denne etapes effort pr. rytter (kun når v3=true) ganger
      // dagens fatigue-load — se raceFatigue.applyRaceFatigue's jsdoc.
      const effortByRider = v3 ? effortByRiderForStage(stageRoleOverrides, stage.stage_number || 1) : null;
      await applyFatigue({ supabase, riderIds, profileType: stage.profile_type, effortByRider });
    } catch (err) {
      // #2389 A2: en fejlet fatigue-skrivning lader træthed drive ud af sync — capture.
      console.error(`  ⚠️  race fatigue upsert failed (stage ${stage.stage_number}, ${stage.profile_type}): ${err.message}`);
      captureException(err, { tags: { flow: "race-run", stage: "fatigue-upsert" }, raceId: race.id, stageNumber: stage.stage_number });
    }
  }

  const newRaceDaysCompleted = await recomputeRaceDays({ supabase, seasonId: race.season_id });

  // #1187 · Løbende bestyrelses-tilfredshed efter afviklet løb. Fejl må ikke
  // vælte afviklingen — resultaterne ER allerede skrevet.
  if (seasonBefore?.id) {
    try {
      await processBoardWeekend({
        supabase,
        season: {
          ...seasonBefore,
          race_days_completed: Number.isFinite(Number(newRaceDaysCompleted))
            ? newRaceDaysCompleted
            : seasonBefore.race_days_completed,
        },
        previousRaceDaysCompleted: seasonBefore.race_days_completed ?? null,
        // #3144 · league_division_id med, så weekend-financen kun skriver et
        // race-mærket board_satisfaction_events-row for hold i løbets EGEN
        // pulje (ellers "reagerer" andre divisioners boards på dette løb).
        race: { id: race.id, name: race.name, league_division_id: race.league_division_id ?? null },
      });
    } catch (error) {
      // #2389 A2: fanger fejl FØR processBoardWeekends interne captures (fx
      // forudsætnings-queries) — de nåede aldrig Sentry.
      console.error("  ⚠️  board weekend update failed after race simulation:", error.message);
      captureException(error, { tags: { flow: "race-run", stage: "board-weekend" }, raceId: race.id });
    }
  }

  if (notifyDiscord) {
    try {
      // S4 (#1176): incidents er allerede HELE løbets (buildRaceResults, ingen
      // stage-filtrering her, modsat stage-by-stage-stien nedenfor) — intet
      // ekstra DB-kald nødvendigt ud over navne-opslaget.
      const incidentsForDiscord = v3 ? await enrichIncidentsForDiscord({ supabase, incidents }) : [];
      await notifyDiscord({ race, resultRows, incidents: incidentsForDiscord });
    } catch {
      // best-effort: Discord-fejl må ikke vælte afviklingen; sendWebhook capturer selv
      // persistente 4xx-routing-fejl (#2395), så en tavs slugning her er bevidst.
    }
  }

  // #1952 · In-app resultat-notifikation til hver deltagende menneske-manager.
  // Samme fejl-isolation som Discord: en notif-fejl må ikke vælte afviklingen.
  if (notifyInApp) {
    try {
      await notifyInApp({ race });
    } catch {
      // best-effort: in-app notif-fejl må ikke vælte afviklingen; notificationService
      // capturer internt (#2394), så en tavs slugning her er bevidst (#2395).
    }
  }

  // #3193: matview-refresh flyttet tidligere i funktionen (lige efter
  // applyRaceResults/updateStandings, se kommentaren der) — ingen dublet-kald her.

  return {
    rowsImported: applied.rowsImported,
    rows: resultRows.length,
    stages: stages.length,
    entrants: entrants.length,
    runs: runs.length,
  };
}

// ── #2072: stage-by-stage klassements-akkumulering ────────────────────────────

// Persisterede etaperækker fra tidligere etaper — SSOT for klassementerne.
// Range-pagineret (startfelter på 100-200 ryttere × mange etaper overstiger
// PostgREST's 1000-cap). Defensivt client-side-filter oveni query-filtrene:
// akkumuleringen må KUN se 'stage'-rækker fra FØR dagens etape.
async function loadPriorStageRows({ supabase, raceId, beforeStageNumber }) {
  const { data, error } = await fetchAllPaged(() =>
    supabase
      .from("race_results")
      // Sub-2 (#2770): passage-aggregater med — accumulateStageRows (Task 4)
      // bruger dem (når non-null) i stedet for classPointsForRank-heuristikken.
      .select("stage_number, result_type, rank, rider_id, team_id, finish_time, sprint_points, kom_points, bonus_seconds")
      .eq("race_id", raceId)
      .eq("result_type", "stage")
      .lt("stage_number", beforeStageNumber)
      .order("id", { ascending: true })
  );
  if (error) throw new Error(`race_results (prior stages): ${error.message}`);
  return (data || []).filter(
    (r) => r.result_type === "stage" && (r.stage_number || 1) < beforeStageNumber && r.rider_id
  );
}

/**
 * #2072-kerne (etapeløb, stage-by-stage): simulér PRÆCIS dagens etape og AKKUMULÉR
 * klassementerne (GC/point/bjerg/ungdom/hold) fra de persisterede race_results-
 * etaperækker + dagens resultat. Slut-GC og alle klassementer er dermed ALTID
 * summen af de publicerede etape-gaps — aldrig en frisk re-simulation med dagens
 * felt/form/træthed (rod-årsagen bag Vuelta Burgalesa: etape-resultater og slut-GC
 * kom fra 4-5 forskellige simulationer, og spillerne kunne regne modstriden ud).
 *
 * Træthed: dagens sim kører på rytterens NUVÆRENDE rider_condition.fatigue — den
 * indeholder allerede tidligere etapers belastning (applyRaceFatigue efter hver
 * etape) plus evt. restitution mellem etapedage. stageEnteringFatigues-re-
 * akkumulering oveni ville dobbelt-tælle de kørte etaper (del af #2072).
 *
 * Feltændringer håndteres af data-formen selv: en rytter der forlod feltet
 * (solgt/slettet/udlånt) beholder sine persisterede etaperækker og præmier, men
 * mangler en etape → udgår af klassementerne (filterCompletedEntrants).
 *
 * priorStageRows injiceres af kalderen (I/O adskilt fra beregning — testbar kerne).
 * Ren + deterministisk givet (race.id, stagesSorted, entrants, priorStageRows).
 *
 * @param {boolean} [v3=false]  Race v3 S1 (#2352) — se buildRaceResults' jsdoc.
 * @param {Map} [stageRoleOverrides]  S3 (#2034) — se buildRaceResults' jsdoc. KUN
 *   anvendt når v3=true; her nok med DENNE etapes overrides (ingen fatigue-
 *   akkumulering sker i denne funktion, i modsætning til buildRaceResults).
 * @returns {{ resultRows, passageRows, runs, incidents, moments, timelines }}  alle rækker bærer stage_number = dagens
 *   etape, så apply_stage_result-RPC'ens idempotente delete-then-insert dækker dem.
 *   incidents: S4 (#1176) — dagens rollIncidents-output, stemplet med stage_number.
 *   ALTID [] når v3=false. Abandon-eksklusion af DENNE etapes felt (rytteren styrtede
 *   på en TIDLIGERE etape) er kald-stedets ansvar (simulateStageByIndex filtrerer
 *   `entrants` FØR denne funktion kaldes — se loadAbandonedRiderIds).
 *   moments: S6 (#2355) — dagens extractStageMoments-output, stemplet med
 *   stage_number. ALTID [] når v3=false.
 *   passageRows: Sub-2 (#2770) — dagens race_stage_passages-kompatible rækker,
 *   stemplet med stage_number. ALTID [] når etapen ikke har rutedata (data-gated,
 *   ikke v3-gated — se buildRaceResults' tilsvarende note).
 *   timelines: #2410 (event-log S1) — dagens buildStageTimeline-output som ét
 *   {stage_number, timeline_version, events}-element. ALTID [] når `timeline`=false
 *   (flag `race_stage_timeline`) — UAFHÆNGIGT af v3, se buildRaceResults' note.
 * @param {boolean} [timeline=false]  #2410 — se buildRaceResults' jsdoc.
 */
export function buildStageRowsAccumulated({ race, stagesSorted, stageIndex, entrants = [], pointsLookup = {}, priorStageRows = [], v3 = false, stageRoleOverrides, timeline = false }) {
  if (!race?.id) throw new Error("race.id required");
  if (!stagesSorted?.length) throw new Error("no stage profiles");
  if (!entrants.length) throw new Error("no entrants");
  const thisStage = stagesSorted[stageIndex];
  if (!thisStage) throw new Error(`stageIndex ${stageIndex} out of range`);
  const stageNumber = thisStage.stage_number || stageIndex + 1;
  const isFinal = stageIndex === stagesSorted.length - 1;

  const byId = new Map();
  const teamNameByTeam = new Map();
  for (const e of entrants) {
    byId.set(e.rider_id, e);
    if (e?.team_id != null && e?.team_name != null && !teamNameByTeam.has(e.team_id)) {
      teamNameByTeam.set(e.team_id, e.team_name);
    }
  }

  const resultRows = [];
  // Sub-2 (#2770): passage-detalje-rækker for DENNE etape (race_stage_passages).
  const passageRows = [];
  const { pushIndiv, pushTeam } = makeResultRowPushers({ race, byId, teamNameByTeam, pointsLookup, resultRows });

  // S3 (#2034): denne etapes race_stage_roles-overrides — KUN opslået/anvendt når
  // v3=true (flag-off skal forblive bit-identisk, jf. buildRaceResults' note).
  const overridesForStage = v3 ? stageRoleOverrides?.get(stageNumber) : undefined;
  const simEntrants = entrants.map((e) => {
    const resolved = v3 ? resolveStageEntrant(e, overridesForStage) : null;
    return {
      rider_id: e.rider_id,
      team_id: e.team_id,
      abilities: e.abilities,
      ...(e.form != null ? { form: e.form } : {}),
      fatigue: Math.max(0, Math.min(100, Number(e.fatigue) || 0)),
      ...(v3
        ? (resolved.race_role ? { race_role: resolved.race_role } : {})
        : (e.race_role ? { race_role: e.race_role } : {})),
      ...(v3 ? { effort: resolved.effort } : {}),
      // S5 (#2224): peak-vinduer + tq — se buildRaceResults' tilsvarende note.
      ...(v3 && e.peakWindows?.length
        ? { peakWindows: e.peakWindows }
        : {}),
    };
  });

  // S5 (#2224): peak-input-signatur til checksum (bagudkompatibel når tom).
  const peakInputs = v3 ? serializePeakInputs(simEntrants) : [];

  const seed = stableSeed(raceSeedInput(race.id, stageNumber));
  const { ranked, incidents } = simulateStage({ entrants: simEntrants, stageProfile: thisStage, seed, v3 });
  // S4 (#1176): stemplet med dagens stage_number — additiv, rører ikke resultRows/runs-formen.
  const stampedIncidents = incidents.map((inc) => ({ stage_number: stageNumber, ...inc }));
  // #1499: deskriptive udbruds-etiketter for dagens finish-order (ren read).
  const breakawayStatus = deriveBreakawayStatus(ranked);
  const bwOf = (riderId) => breakawayStatus.get(riderId) || { in_breakaway: false, breakaway_caught: false };

  // Sub-2 (#2770): passage-lag — SAMME seed som simulateStage ovenfor. Denne
  // funktion kaldes KUN for etapeløb (kald-stedets ansvar, se simulateStageByIndex),
  // så isStageRace er altid true her. Data-gated: tomt for etaper uden rutedata.
  const passage = computePassages({ ranked, stageProfile: thisStage, entrants: simEntrants, seed, isStageRace: true });
  const passageActive = passage.passages.length > 0;
  const passageAgg = (riderId) => passage.perRider.get(riderId) || { sprint_points: 0, kom_points: 0, bonus_seconds: 0 };
  for (const wp of passage.passages) {
    for (const res of wp.results) {
      const e = byId.get(res.rider_id);
      passageRows.push({
        race_id: race.id,
        stage_number: stageNumber,
        waypoint_kind: wp.kind,
        waypoint_index: wp.index,
        waypoint_name: wp.name,
        waypoint_km: wp.km,
        climb_category: wp.category ?? null,
        rider_id: res.rider_id,
        rider_name: e?.rider_name ?? null,
        team_id: e?.team_id ?? null,
        passage_rank: res.passage_rank,
        points: res.points,
        bonus_seconds: res.bonus_seconds,
      });
    }
  }

  const runs = [{
    stage_number: stageNumber,
    seed,
    salt_version: activeSaltVersion(),
    engine_version: v3 ? ENGINE_VERSION_V3 : ENGINE_VERSION,
    entrant_snapshot: simEntrants.map((e) => e.rider_id).sort(),
    input_checksum: stableSeed(JSON.stringify({
      ids: simEntrants.map((e) => e.rider_id).sort(),
      roles: simEntrants.filter((e) => e.race_role).map((e) => [e.rider_id, e.race_role]).sort(),
      demand: thisStage.demand_vector,
      profile: thisStage.profile_type,
      // S3 (#2034): se buildRaceResults' tilsvarende note (bagudkompatibel checksum).
      ...(v3 && stageRoleOverrides?.size ? { stageRoles: serializeStageRoleOverrides(stageRoleOverrides) } : {}),
      // S5 (#2224): se buildRaceResults' tilsvarende note (bagudkompatibel checksum).
      ...(v3 && peakInputs.length ? { peaks: peakInputs, peakDay: thisStage.peakDay ?? null } : {}),
    })),
    // #2352 (Race v3 S1, spec §11.3): se buildRaceResults' tilsvarende note.
    ...(v3 ? { riderScores: ranked.map((r) => ({ rider_id: r.rider_id, rank: r.rank, components: r.components })) } : {}),
  }];

  // Dagens etaperækker (samme form som buildRaceResults' stage-emission).
  for (const r of ranked) {
    const agg = passageActive ? passageAgg(r.rider_id) : null;
    pushIndiv({
      result_type: "stage", rank: r.rank, rider_id: r.rider_id, stage_number: stageNumber,
      finish_time: formatGap(r.stageGap), ...bwOf(r.rider_id),
      ...(agg ? { sprint_points: agg.sprint_points, kom_points: agg.kom_points, bonus_seconds: agg.bonus_seconds } : {}),
    });
  }

  // Klassementer akkumuleres fra persisterede + dagens rækker — dagens gap går
  // igennem formatGap FØRST, så klassementet bygger på PRÆCIS de afrundede gaps
  // spillerne ser publiceret. #4197: GC = sum af etape-gaps MINUS bonussekunder —
  // ikke sum af gaps alene. Uden ruter er der ingen passager og dermed ingen
  // bonussekunder, så de to udtryk falder sammen dér; med ruter gør de IKKE.
  // Den forkortelse stod tidligere her og forplantede sig til dry-run-oraklet,
  // som derfor råbte falsk op på 3 af 50 seeds. Sub-2 (#2770):
  // passage-aggregaterne SKAL med her (samme betingelse som pushIndiv ovenfor),
  // ellers ser accumulateStageRows' hasPassageCols-check dem aldrig (Task 4).
  const todayStageRows = ranked.map((r) => {
    const agg = passageActive ? passageAgg(r.rider_id) : null;
    return {
      stage_number: stageNumber,
      result_type: "stage",
      rank: r.rank,
      rider_id: r.rider_id,
      team_id: byId.get(r.rider_id)?.team_id ?? null,
      finish_time: formatGap(r.stageGap),
      ...(agg ? { sprint_points: agg.sprint_points, kom_points: agg.kom_points, bonus_seconds: agg.bonus_seconds } : {}),
    };
  });
  const profileTypeByStage = new Map(stagesSorted.map((s) => [s.stage_number || 1, s.profile_type]));
  const acc = accumulateStageRows({ stageRows: [...priorStageRows, ...todayStageRows], profileTypeByStage });
  const classified = filterCompletedEntrants(entrants, acc.stagesByRider, acc.stageNumbers);
  if (!classified.length && entrants.length) {
    console.error(`  ⚠️  race ${race.id} stage ${stageNumber}: no riders completed all ${acc.stageNumbers.size} ridden stages — classifications omitted`);
  }

  const gc = rankByCumTimeAsc(classified, acc.cumTime, acc.posSum);
  const leaderTime = gc.length ? gc[0].time : 0;
  const gcFinish = (entry) => formatGap(entry.time - leaderTime);

  // S6 (#2355): why-rapport-momenter. previousGcLeaderId = GC-lederen FØR
  // denne etape, udledt af PRIOR-rækkerne alene (samme akkumulerings-funktion
  // som `acc` ovenfor, blot uden dagens rækker) — stageIndex 0 (priorStageRows=[])
  // giver naturligt previousGcLeaderId=null (ingen tidligere leder at skifte fra,
  // gc_takeover udebliver korrekt på etape 1, spejler buildRaceResults' loop-variant).
  // #2410: `previousGcFull` er den FULDE prior-GC (ikke kun leder-id'et) —
  // genbrugt UÆNDRET (ingen nyt DB-kald) af buildStageTimeline's virtual_leader-
  // event (S5), som skal kende ALLE rytteres GC-deficit før dagens etape, ikke
  // kun hvem der førte.
  let previousGcLeaderId = null;
  let previousGcFull = null;
  if (priorStageRows.length) {
    const priorAcc = accumulateStageRows({ stageRows: priorStageRows, profileTypeByStage });
    const priorClassified = filterCompletedEntrants(entrants, priorAcc.stagesByRider, priorAcc.stageNumbers);
    const priorGc = rankByCumTimeAsc(priorClassified, priorAcc.cumTime, priorAcc.posSum);
    previousGcLeaderId = priorGc[0]?.rider_id ?? null;
    previousGcFull = priorGc;
  }
  const roleByRider = new Map(simEntrants.map((e) => [e.rider_id, e.race_role]));
  const formByRider = new Map(simEntrants.filter((e) => e.form != null).map((e) => [e.rider_id, e.form]));
  // #3115 gap 1b (D3 DEL 2): se buildRaceResults' tilsvarende note.
  const effortByRider = new Map(simEntrants.filter((e) => e.effort != null).map((e) => [e.rider_id, e.effort]));
  const stageMoments = v3 ? extractStageMoments({
    stageNumber, isFinal, isStageRace: true,
    ranked, roleByRider, formByRider, effortByRider, breakawayStatus,
    incidentsForStage: stampedIncidents,
    gc, previousGcLeaderId,
  }) : [];
  const moments = stageMoments.map((m) => ({ stage_number: stageNumber, ...m }));

  // #2410 (event-log S1): tidslinje — SAMME build-trin (data er i memory).
  // UAFHÆNGIGT af v3 (degraderer gracefully når stageMoments/incidents er tomme).
  // `roleByRider` ovenfor er allerede UBETINGET beregnet (ikke v3-scoped) —
  // genbruges direkte til leadout-eventet, INGEN nye DB-kald.
  const timelines = timeline ? (() => {
    const rankedForTimeline = ranked.map((r) => ({ ...r, race_role: roleByRider.get(r.rider_id) ?? null }));
    const timelineResult = buildStageTimeline({
      ranked: rankedForTimeline,
      stageProfile: thisStage,
      moments: stageMoments,
      incidents: stampedIncidents,
      passages: passage.passages,
      breakawayStatus,
      gc,
      previousGc: previousGcFull,
      seed,
      isStageRace: true,
    });
    return [{ stage_number: stageNumber, timeline_version: timelineResult.timeline_version, events: timelineResult.events }];
  })() : [];

  const young = rankByCumTimeAsc(classified.filter((e) => e.is_u25), acc.cumTime, acc.posSum);
  const pointsCls = rankByCompDesc(classified, acc.pointsComp);
  const komCls = rankByCompDesc(classified, acc.komComp);

  if (!isFinal) {
    // Mellem-etape (#2081): fulde løbende klassementer under dag-typerne (se
    // buildRaceResults for payout-noten: kun rank 1 har race_points-opslag).
    for (const g of gc) pushIndiv({ result_type: "leader", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
    for (const p of pointsCls) pushIndiv({ result_type: "points_day", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
    for (const k of komCls) pushIndiv({ result_type: "mountain_day", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
    for (const y of young) pushIndiv({ result_type: "young_day", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
    for (const t of teamClassification(classified, acc.cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber, result_type: "team_day" });
  } else {
    // Slut-etape: hele klassementet udbetales — fra AKKUMULERINGEN, ikke en re-sim.
    for (const g of gc) pushIndiv({ result_type: "gc", rank: g.rank, rider_id: g.rider_id, stage_number: stageNumber, finish_time: gcFinish(g) });
    for (const p of pointsCls) pushIndiv({ result_type: "points", rank: p.rank, rider_id: p.rider_id, stage_number: stageNumber });
    for (const k of komCls) pushIndiv({ result_type: "mountain", rank: k.rank, rider_id: k.rider_id, stage_number: stageNumber });
    for (const y of young) pushIndiv({ result_type: "young", rank: y.rank, rider_id: y.rider_id, stage_number: stageNumber });
    for (const t of teamClassification(classified, acc.cumTime)) pushTeam({ rank: t.rank, team_id: t.team_id, stage_number: stageNumber });
  }

  return { resultRows, passageRows, runs, incidents: stampedIncidents, moments, timelines };
}

/**
 * Stage-by-stage afvikling (WS1 Fase 3): afvikl PRÆCIS én etape (0-indekseret
 * stageIndex). #2072: dagens etape simuleres ISOLERET (seed = stableSeed(
 * raceSeedInput(race.id, stageNumber)) — #2351: server-side saltet via
 * raceSeedSalt.js, usaltet når env ikke er sat); klassementerne akkumuleres fra de
 * persisterede etaperækker via buildStageRowsAccumulated. Etape 1..N-1's DB-rækker
 * røres ikke — den idempotente delete-then-insert er afgrænset til denne etape.
 *
 * KORREKTHED:
 *  - applyFatigue kaldes KUN for DENNE etapes profil (ikke 1..N — de kørte i
 *    tidligere invokationer; ellers dobbelt-akkumulering).
 *  - Finalization (status=completed, recomputeRaceDays, processBoardWeekend,
 *    notifyDiscord) fyrer KUN på final-etapen. Mellem-etaper afslører resultater
 *    men finaliserer ikke. Discord-embed på final = HELE løbets race_results
 *    genlæst fra DB (alle etaper, ikke kun final-etapens nybyggede rækker).
 *  - loadEntrantsForRace.persist = (stageIndex === 0) — entries auto-fyldes kun
 *    ved første etape; senere etaper rører ikke startfeltet.
 *
 * @returns {{ stageNumber, isFinalStage, rowsImported, entrants, stages }}
 */
export async function simulateStageByIndex({
  supabase,
  race,
  stageIndex,
  dryRun = false,
  runSource = null,
  // #1598: result-write (counter + race_results delete+insert) går nu via den atomære
  // apply_stage_result-RPC (applyStageResult). ensureSeasonStandings/updateStandings
  // kører EFTER RPC'en committer (standings = idempotent re-derivation, ej desync-følsom).
  ensureSeasonStandings = async () => {},
  updateStandings = async () => {},
  recomputeRaceDays = recomputeSeasonRaceDays,
  processBoardWeekend = processBoardWeekendFinalizationShared,
  notifyDiscord = null,
  notifyInApp = null,
  // #2523: per-etape "din etape er kørt"-notifikation. Kaldt KUN for ikke-final-
  // etaper (se mellem-etape-grenen nedenfor) — final-etapen beholder ALENE
  // notifyInApp's samlede klassements-notifikation (#1952), for at undgå
  // dobbelt-besked på den sidste etape.
  notifyStageInApp = null,
  applyFatigue = applyRaceFatigue,
  applyStageResult = applyStageResultAtomic,
  // #3470: injectable, default læser race_stage_schedule.game_day + persisterer den
  // ægte GT-hviledags-restitution (bit-identisk no-op når intet game_day-hul).
  loadStageGameDays: loadStageGameDaysFn = loadStageGameDays,
  applyGrandTourRestDayFatigue: applyGrandTourRestDayFatigueFn = applyGrandTourRestDayFatigueShared,
  // #2352 (Race v3 S1): injectable, default læser den ægte kill-switch.
  checkV3Enabled = isRaceEngineV3ScoringEnabled,
  // #2410 (event-log S1): injectable, default læser den ægte kill-switch
  // (app_config.race_stage_timeline) — se simulateRace's tilsvarende note.
  checkTimelineEnabled = isRaceStageTimelineEnabled,
  // S3 (#2034): injectable, default læser race_stage_roles. Kun kaldt når v3=true.
  loadStageRoleOverrides: loadStageRoleOverridesFn = loadStageRoleOverrides,
  // S5 (#2224): injectable peak-loadere + tq-resolver. Kun kaldt når v3=true.
  loadPeakPlans: loadPeakPlansFn = loadPeakPlans,
  loadStageDayOrdinals: loadStageDayOrdinalsFn = loadStageDayOrdinals,
  resolvePeakTrainingQualities: resolveTQsFn = resolvePeakTrainingQualities,
}) {
  if (!supabase?.from) throw new Error("supabase client required");
  if (!race?.id || !race?.season_id) throw new Error("race {id, season_id} required");
  if (!Number.isInteger(stageIndex) || stageIndex < 0) throw new Error("stageIndex must be a non-negative integer");

  // Checkpoint FØR afviklingen — board-weekend bruger previous-vs-new race_days.
  const { data: seasonBefore } = await supabase
    .from("seasons")
    .select("id, number, status, race_days_completed, race_days_total")
    .eq("id", race.season_id)
    .maybeSingle();

  const stages = await loadStageProfiles(supabase, race.id);
  if (!stages.length) throw new Error(`No race_stage_profiles for race ${race.id} — run backfill`);
  if (stageIndex > stages.length - 1) {
    throw new Error(`stageIndex ${stageIndex} out of range (race has ${stages.length} stages)`);
  }
  // #3470: hæft game_day på hver etape FØR entrants/results bygges, UAFHÆNGIGT af v3
  // (samme mønster/begrundelse som simulateRace ovenfor).
  if (race.race_type === "stage_race") {
    await attachStageGameDays({ supabase, race, stages, loadStageGameDaysFn });
  }

  const stagesSorted = [...stages].sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));
  const thisStage = stagesSorted[stageIndex];
  const stageNumber = thisStage.stage_number || stageIndex + 1;
  const isFinalStage = stageIndex === stagesSorted.length - 1;
  const totalStages = stagesSorted.length;
  const completedBefore = Number(race.stages_completed) || 0;

  // ── FIX 1 (re-entrant recovery): et løb hvis ALLE etaper er afviklet
  // (stages_completed >= stages) men status ENDNU ikke er 'completed' sidder fast i
  // "finalization pending" (et crash mellem stages_completed-bump og status-flip, eller
  // mellem finalization-trin). Det skal kunne genoptages idempotent → kør KUN finalization
  // (resultater/standings ER allerede skrevet; vi rør dem ikke igen). isFinalStage SKAL
  // gælde her — recovery giver kun mening for final-etapen.
  const finalizationPending = !dryRun
    && isFinalStage
    && completedBefore >= totalStages
    && race.status !== "completed";

  // ── FIX 3 (status-guard, defense-in-depth): et FÆRDIGT løb (status='completed')
  // må ikke gen-afvikles via denne sti — finalization er per definition allerede kørt.
  // Recovery-tilfældet ovenfor er det modsatte (status != completed), så de udelukker hinanden.
  if (!dryRun && race.status === "completed") {
    throw new Error(`Race ${race.id} already simulated (status=completed) — re-simulation blocked`);
  }

  // Entries auto-fyldes KUN ved første etape (persist=false fra etape 2). I recovery
  // springer vi entrants/resultatberegning helt over — intet skal genberegnes.
  const persistEntries = !dryRun && !finalizationPending && stageIndex === 0;

  let entrants = [];
  let resultRows = [];
  let passageRows = [];
  let runs = [];
  let incidents = [];
  let moments = [];
  let timelines = [];
  let applied = { rowsImported: 0 };

  if (!finalizationPending) {
    // #1844: auto-fyld KUN ved etape 1. Senere etaper må ikke tilføje nye ryttere.
    entrants = await loadEntrantsForRace({ supabase, race, stages, persist: persistEntries, allowAutofill: stageIndex === 0 });

    // #2352: kill-switch læst ÉN gang pr. etape-invokation (hver stageIndex-kald
    // er sit eget I/O-kald — flippes flaget mellem to etaper, gælder den NYE
    // værdi fra den næste etape, hvilket er den tilsigtede kill-switch-adfærd).
    // Flyttet OP hertil (S4, #1176): abandon-eksklusionen nedenfor SKAL ske FØR
    // #1844-fysningen, ellers rapporterer freezeEntrantsToStartField en abandon
    // som en "forsvundet" start-felt-rytter (falsk #1847-alarm).
    const v3 = await checkV3Enabled(supabase);
    // #2410: samme engangs-læsning som v3 ovenfor, UAFHÆNGIGT flag.
    const timelineEnabled = await checkTimelineEnabled(supabase);

    // #1844: frys feltet til etape-1-snapshot. Et igangværende etapeløbs felt MÅ ikke
    // ændre sig mellem etaper — en rytter der kom ind midt i løbet (manuelt edit pre-#1838,
    // rytter-tilføjelse, eller anden drift) blev ellers simuleret retroaktivt gennem alle
    // etaper og kunne vinde GC (Boucles Mayennaises). Etape 1 / legacy-løb uden snapshot
    // → loadStartFieldRiderIds=null → ingen frysning.
    if (stageIndex > 0) {
      const startField = await loadStartFieldRiderIds({ supabase, raceId: race.id });
      // S4 (#1176): ryttere der er udgået (styrt/mekanisk DNF) på en TIDLIGERE
      // etape udelukkes FØR frysningen — både fra det aktuelle felt OG fra
      // start-felt-snapshottet, så de aldrig trigger #1844's missing-warning
      // (de er ikke "forsvundet", de er korrekt DNF'et og allerede persisteret
      // som sådan via race_incidents/manglende senere etape-rækker).
      let effectiveStartField = startField;
      if (v3) {
        const abandonedIds = await loadAbandonedRiderIds({ supabase, raceId: race.id });
        if (abandonedIds.size) {
          entrants = entrants.filter((e) => !abandonedIds.has(e.rider_id));
          if (effectiveStartField) {
            effectiveStartField = effectiveStartField.filter((id) => !abandonedIds.has(id));
          }
        }
      }
      const { frozen, added, missing } = freezeEntrantsToStartField(entrants, effectiveStartField);
      if (added.length) {
        console.error(`  ⚠️  race ${race.id} etape ${stageNumber}: ${added.length} mid-race-rytter(e) ekskluderet fra GC (#1844): ${added.slice(0, 5).join(",")}${added.length > 5 ? "…" : ""}`);
      }
      if (missing.length) {
        console.error(`  ⚠️  race ${race.id} etape ${stageNumber}: ${missing.length} start-felt-rytter(e) forsvundet (#1844/#1847): ${missing.slice(0, 5).join(",")}${missing.length > 5 ? "…" : ""}`);
      }
      entrants = frozen;
    }
    // #2103: skeln datakorruption fra tomt felt. Et løb midt i afviklingen
    // (stages_completed > 0) UDEN entries betyder at en anden skriver har bumpet
    // counteren/resultaterne uden om motoren (La Corsa dei Due Mari 30/6: to
    // fantom-etaper med arketype-ryttere, ingen race_entries/sim-runs) — det kan
    // ikke self-heale (autofill er bevidst låst efter etape 1, #1844) og kræver
    // data-reparation: slet fantom-resultater + nulstil stages_completed.
    if (!entrants.length) {
      if (stageIndex > 0) {
        throw new Error(
          `No start list for race ${race.id} at stage ${stageNumber} — `
          + `${completedBefore} stage(s) marked completed but race_entries is empty `
          + `(data integrity: results written outside the engine? Reset the race — see #2103)`
        );
      }
      throw new Error(`No start list for race ${race.id}`);
    }

    const racePoints = await loadRacePoints(supabase, race.race_class);
    const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });

    // S3 (#2034): overrides hentes KUN når v3=true — samme begrundelse som simulateRace.
    // (v3 selv er læst tidligere, FØR #1844-frysningen — se abandon-eksklusionen ovenfor.)
    const stageRoleOverrides = v3 ? await loadStageRoleOverridesFn({ supabase, raceId: race.id }) : undefined;
    // S5 (#2224): peak-kontekst — KUN når v3=true. entrants er nu finaliseret
    // (#1844-frosset for stageIndex>0); stagesSorted deler objekt-refs med stages,
    // så peakDay-mutationen ses i begge grene nedenfor. Bit-identisk ved flag-off.
    if (v3) await attachPeakContext({ supabase, race, stages, entrants, loadPeakPlansFn, loadStageDayOrdinalsFn, resolveTQsFn });

    if (race.race_type === "stage_race") {
      // #2072: simulér KUN dagens etape; klassementer akkumuleres fra de
      // persisterede etaperækker — slut-GC kan aldrig modsige publicerede gaps.
      const priorStageRows = stageIndex > 0
        ? await loadPriorStageRows({ supabase, raceId: race.id, beforeStageNumber: stageNumber })
        : [];
      ({ resultRows, passageRows, runs, incidents, moments, timelines } = buildStageRowsAccumulated({
        race, stagesSorted, stageIndex, entrants, pointsLookup, priorStageRows, v3, stageRoleOverrides,
        timeline: timelineEnabled,
      }));
    } else {
      // Endagsløb (1 etape): buildRaceResults ER allerede én selv-konsistent
      // simulation af præcis denne dag — ingen akkumulering at hente. passageRows
      // er data-gated (Sub-2, #2770): computePassages returnerer altid tomt for
      // isStageRace=false, men filtreres for symmetri/fremtidssikring.
      const { resultRows: allRows, passageRows: allPassageRows, runs: allRuns, incidents: allIncidents, moments: allMoments, timelines: allTimelines } = buildRaceResults({ race, stages, entrants, pointsLookup, v3, stageRoleOverrides, timeline: timelineEnabled });
      resultRows = allRows.filter((r) => r.stage_number === stageNumber);
      passageRows = (allPassageRows || []).filter((p) => p.stage_number === stageNumber);
      runs = allRuns.filter((r) => r.stage_number === stageNumber);
      incidents = (allIncidents || []).filter((inc) => inc.stage_number === stageNumber);
      moments = (allMoments || []).filter((m) => m.stage_number === stageNumber);
      timelines = (allTimelines || []).filter((t) => t.stage_number === stageNumber);
    }

    if (dryRun) {
      const stageWinner = resultRows.find((r) => r.result_type === "stage" && r.rank === 1);
      const gcPodium = resultRows
        .filter((r) => r.result_type === "gc" && r.rank <= 3)
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ rank: r.rank, rider: r.rider_name }));
      return {
        dryRun: true,
        stageNumber, isFinalStage,
        rows: resultRows.length, stages: totalStages, entrants: entrants.length,
        stageWinner: stageWinner ? stageWinner.rider_name : null,
        gcPodium,
      };
    }

    // ── #1598: atomær per-etape-skrivning (counter-bump + race_results delete+insert)
    // i ÉN Postgres-transaktion via apply_stage_result-RPC. Lukker det skarpe crash-
    // vindue #1574 efterlod: et HÅRDT proces-kill mellem counter-bump og result-write
    // på en mellem-etape kunne efterlade stages_completed FORAN tomme race_results.
    // RPC'en committer de tre trin samlet eller ruller ALT tilbage — ingen partial state.
    //
    // FIX 5-lås (uændret prædikat): RPC'en bumper kun stages_completed WHERE
    // stages_completed = stageIndex. To næsten-samtidige runs (dobbelt-klik, eller
    // admin + scheduler) for samme løb beregner begge SAMME stageIndex; kun den FØRSTE
    // vinder. Taberen ser lockWon=false → afbryd FØR standings, så standings/præmier
    // ikke dobbelt-anvendes. status sættes IKKE her (FIX 1: status flippes sidst).
    //
    // resultRows er allerede afgrænset til DENNE etape (linje ~691), og rækkerne har
    // points_earned/prize_money udledt via buildRacePointsLookup — RPC'en persisterer
    // dem 1:1 (samme normaliserede kolonne-mapping som applyRaceResults). Balance-NEUTRAL.
    const { lockWon, rowsImported } = await applyStageResult(supabase, {
      raceId: race.id,
      stageIndex,
      stageNumber,
      totalStages,
      resultRows,
    });
    if (!lockWon) {
      // Konkurrerende run vandt (eller stages_completed er allerede forbi denne etape).
      // RPC'en kørte INGEN side-effekter → sikkert at afbryde uden dobbelt-anvendelse.
      return {
        stageNumber, isFinalStage, skipped: "concurrent_lock_lost",
        rowsImported: 0, rows: 0, entrants: entrants.length, stages: totalStages,
      };
    }
    applied = { rowsImported };

    // Standings-recompute kører EFTER den atomære result-write committer. updateStandings
    // er en fuld re-derivation fra race_results (alle etaper) — inhærent idempotent og
    // self-healing, og var aldrig en del af counter↔results-desync'en. Et crash her
    // efterlader korrekte race_results + counter; en næste afvikling/recompute re-deriverer
    // standings. persistRuns (run-snapshot) er ligeledes additiv enrichment.
    //
    // #2877: FØR denne try/catch væltede en standings-fejl (fx statement timeout
    // under samtidige etape-afviklinger — se economyEngine.js's withSupabaseRetry-
    // kommentar) resten af funktionen, OG fordi stages_completed allerede er bumpet
    // af den atomære apply_stage_result-RPC ovenfor, kører etapen ALDRIG igen (den
    // reelle udløser: FIX 5-låsen forhindrer re-afvikling af samme stageIndex).
    // persistRuns/persistIncidents/persistStageMoments/applyFatigue nedenfor er IKKE
    // self-healende som standings er — de skrives PRÆCIS ÉN gang pr. etape. At lade
    // en standings-fejl vælte dem gjorde berigelsen gidsel for et recompute den intet
    // har med at gøre (19 etaper i 14 løb tabt permanent, målt i prod 25/7). Fanget +
    // Sentry-capturet (synligt, ikke tavst skjult) — standings retter sig selv ved
    // næste etape/recompute; berigelsen nedenfor skrives uanset udfaldet her.
    try {
      await ensureSeasonStandings(race.season_id);
      await updateStandings(race.season_id, race.id);
    } catch (err) {
      console.error(`  ⚠️  standings recompute failed after stage ${stageNumber} (race ${race.id}) — enrichment continues, standings will self-heal on next recompute: ${err.message}`);
      captureException(err, { tags: { flow: "race-run", stage: "standings-recompute" }, raceId: race.id, stageNumber });
    }

    // #3193: samme flytning som fuld-løb-stien ovenfor — refresh rangliste-
    // matviews LIGE EFTER season_standings er opdateret, ikke efter board-
    // weekend/notify-kæden nedenfor (se kommentaren ved den anden call-site for
    // den fulde diagnose). Kun ved final-etapen: mellem-etaper rammer aldrig
    // finalization-blokken nedenfor (early-return et par linjer nede), så uden
    // dette isFinalStage-tjek ville hver mellem-etape trigge en unødig 4x-RPC-
    // refresh — cron-fallback (10 min) dækker allerede mellem-etaper.
    if (isFinalStage) {
      await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: captureException });
    }

    await persistRuns({ supabase, race, runs, source: runSource });
    // Sub-2 (#2770): samme scoping-mønster (denne etape alene) — data-gated,
    // no-op'er ved tom liste (legacy-løb uden rutedata).
    if (passageRows.length) {
      await persistPassages({ supabase, race, passageRows, stageNumbers: [stageNumber] });
    }
    // S4 (#1176): KUN denne etapes incidents — persistIncidents scoper delete-
    // then-insert til [stageNumber] alene, andre etapers race_incidents-rækker
    // røres ikke (samme idempotens-mønster som persistRuns/apply_stage_result).
    if (v3 && incidents.length) {
      await persistIncidents({ supabase, race, incidents, stageNumbers: [stageNumber] });
    }
    // S6 (#2355): samme scoping-mønster (denne etape alene).
    if (v3 && moments.length) {
      await persistStageMoments({ supabase, race, moments, stageNumbers: [stageNumber] });
    }
    // #2410 (event-log S1): samme scoping-mønster (denne etape alene) —
    // UAFHÆNGIGT af v3, egen flag-gate (timelineEnabled).
    if (timelineEnabled && timelines.length) {
      await persistStageTimelines({ supabase, race, timelines, stageNumbers: [stageNumber] });
    }
    // #3398 (Maiden Win Engine): career-firsts — UAFHÆNGIG af v3 (samme
    // begrundelse som simulateRace's call-site). Dækker BÅDE mellem-etaper og
    // final-etapen (denne blok kører før mellem-etapens early-return nedenfor).
    await runCareerFirstsDetection({
      supabase, race, resultRows, stageNumbers: [stageNumber],
      seasonNumber: seasonBefore?.number ?? null,
    });

    // #1306 spec 6.4: træthed bygges af DENNE etapes belastning — PRÆCIS ét kald
    // (ikke 1..N: de tidligere etaper akkumulerede deres last i tidligere invokationer).
    try {
      // S3 (#2034): denne etapes effort pr. rytter (kun når v3=true) — se
      // raceFatigue.applyRaceFatigue's jsdoc.
      const effortByRider = v3 ? effortByRiderForStage(stageRoleOverrides, stageNumber) : null;
      await applyFatigue({ supabase, riderIds: entrants.map((e) => e.rider_id), profileType: thisStage.profile_type, effortByRider });
    } catch (err) {
      // #2389 A2: mirror fuld-sim-grenen ovenfor — capture.
      console.error(`  ⚠️  race fatigue upsert failed (stage ${stageNumber}, ${thisStage.profile_type}): ${err.message}`);
      captureException(err, { tags: { flow: "race-run", stage: "fatigue-upsert" }, raceId: race.id, stageNumber });
    }

    // #3470: eksplicit hviledags-restitution — game_day-hul til NÆSTE etape (GT-rest-dag)
    // tickes HER, umiddelbart efter DENNE etapes egen fatigue-skrivning (post-lock, samme
    // sti som applyFatigue ovenfor) — IKKE ved starten af næste etapes invokation. Det
    // garanterer idempotens: kun den VINDENDE afvikling af DENNE etape (FIX 5-låsen
    // ovenfor) når hertil, så et genforsøg/samtidigt kald af samme stageIndex kan
    // ALDRIG dobbelt-anvende restitutionen. Næste etapes loadEntrantsForRace læser den
    // restituerede rider_condition.fatigue som en frisk DB-læsning — ingen ekstra kode
    // nødvendig i simuleringsstien (samme mekanik buildStageRowsAccumulated's docstring
    // beskriver: "…plus evt. restitution mellem etapedage").
    if (race.race_type === "stage_race" && stageIndex + 1 < stagesSorted.length) {
      const nextGd = stagesSorted[stageIndex + 1]?.game_day;
      const curGd = thisStage.game_day;
      const restDays = Number.isFinite(nextGd) && Number.isFinite(curGd) ? Math.max(0, nextGd - curGd - 1) : 0;
      if (restDays > 0) {
        try {
          const recoveryAbilityByRider = new Map(entrants.map((e) => [e.rider_id, e.abilities?.recovery]));
          await applyGrandTourRestDayFatigueFn({
            supabase, riderIds: entrants.map((e) => e.rider_id), restDays, recoveryAbilityByRider,
          });
        } catch (err) {
          console.error(`  ⚠️  GT hviledags-restitution fejlede (race ${race.id} efter etape ${stageNumber}, ${restDays} hviledage): ${err.message}`);
          captureException(err, { tags: { flow: "race-run", stage: "gt-rest-day-fatigue" }, raceId: race.id, stageNumber });
        }
      }
    }

    // ── Mellem-etape: INGEN finalization. status forbliver scheduled (binær enum). ──
    if (!isFinalStage) {
      // #2523: per-etape "din etape er kørt"-notifikation til deltagende managers.
      // KUN her (ikke i finalization-grenen nedenfor) — final-etapen får i stedet
      // notifyInApp's samlede klassements-notifikation, så en manager aldrig får
      // to beskeder for samme etape. Best-effort (samme mønster som notifyDiscord/
      // notifyInApp): en notif-fejl må ikke vælte afviklingen.
      if (notifyStageInApp) {
        try {
          await notifyStageInApp({ race, stageNumber, totalStages });
        } catch {
          // best-effort: notificationService capturer internt, tavs slugning er bevidst.
        }
      }
      return { stageNumber, isFinalStage, rowsImported: applied.rowsImported, rows: resultRows.length, entrants: entrants.length, stages: totalStages };
    }
  }

  // ── FINALIZATION (final-etape ELLER recovery) ───────────────────────────────
  // FIX 1: kør finalization FØR status='completed'. recomputeSeasonRaceDays er idempotent
  // og processBoardWeekend er sikker at gen-køre; et crash her efterlader status != completed
  // → recovery-stien ovenfor genoptager. status flippes KUN hvis finalization lykkes.
  const newRaceDaysCompleted = await recomputeRaceDays({ supabase, seasonId: race.season_id });

  if (seasonBefore?.id) {
    try {
      await processBoardWeekend({
        supabase,
        season: {
          ...seasonBefore,
          race_days_completed: Number.isFinite(Number(newRaceDaysCompleted))
            ? newRaceDaysCompleted
            : seasonBefore.race_days_completed,
        },
        previousRaceDaysCompleted: seasonBefore.race_days_completed ?? null,
        // #3144 · league_division_id med, så weekend-financen kun skriver et
        // race-mærket board_satisfaction_events-row for hold i løbets EGEN
        // pulje (ellers "reagerer" andre divisioners boards på dette løb).
        race: { id: race.id, name: race.name, league_division_id: race.league_division_id ?? null },
      });
    } catch (error) {
      // #2389 A2: mirror fuld-sim-grenen — capture.
      console.error("  ⚠️  board weekend update failed after stage simulation:", error.message);
      captureException(error, { tags: { flow: "race-run", stage: "board-weekend" }, raceId: race.id });
    }
  }

  if (notifyDiscord) {
    try {
      // Embed = HELE løbets race_results (alle etaper) genlæst fra DB, ikke kun
      // final-etapens nybyggede rækker — så GC-vinder + alle etapevindere vises.
      // #3331: grand tours already exceed 1000 race_results rows in prod — paginate.
      const wholeRaceRows = await fetchAllRows(() => supabase
        .from("race_results")
        .select("result_type, rank, rider_name, stage_number")
        .eq("race_id", race.id)
        .order("id", { ascending: true }));
      // S4 (#1176): stage-by-stage-stiens `incidents`-variabel er scopet til KUN
      // final-etapen (linje ~1483 filtrerer på stageNumber) — for DNF-linjen i
      // hele-løbet-embeddet re-hentes derfor race_incidents for HELE løbet her.
      // Ingen v3-gate nødvendig: `v3` er blok-scopet til `if (!finalizationPending)`
      // ovenfor og findes IKKE i recovery-grenen — men det er også overflødigt,
      // for var flaget OFF da løbet blev afviklet, er der ganske enkelt aldrig
      // skrevet nogen rækker for dette race_id, og forespørgslen returnerer [] helt
      // af sig selv. Samme graceful-degradation-regel som frontendens forespørgsel
      // (RaceDetailPage.jsx): tabellen er endnu ikke migreret i prod ved denne
      // slices merge, en fejl må ALDRIG vælte afviklingen — kun logges + [].
      let incidentsForDiscord = [];
      try {
        const { data: incRows, error: incErr } = await supabase
          .from("race_incidents")
          .select("stage_number, rider_id, kind, outcome")
          .eq("race_id", race.id);
        if (incErr) throw incErr;
        incidentsForDiscord = await enrichIncidentsForDiscord({ supabase, incidents: incRows || [] });
      } catch (err) {
        console.warn(`  ⚠️  race_incidents fetch failed (Discord DNF-linje udelades): ${err.message}`);
      }
      // FIX 1: undgå dobbelt-send ved re-finalization. Et discord_sent-flag i admin_log
      // ville kræve en CHECK-constraint-migration (uden for scope); i stedet er denne
      // notifyDiscord-callback selv idempotent (cron-laget de-duper på løb), OG recovery
      // sker kun efter et crash hvor en embed sjældent allerede nåede ud. Vi sender derfor
      // KUN hvis dette IKKE er en recovery-genkørsel — den normale final-etape sender én gang.
      if (!finalizationPending) {
        await notifyDiscord({ race, resultRows: wholeRaceRows || resultRows, incidents: incidentsForDiscord });
      }
    } catch {
      // best-effort: Discord-fejl må ikke vælte afviklingen; sendWebhook capturer selv
      // persistente 4xx-routing-fejl (#2395), så en tavs slugning her er bevidst.
    }
  }

  // #1952 · In-app resultat-notifikation til hver deltagende menneske-manager,
  // KUN på den faktiske final-etape (samme finalizationPending-guard som Discord:
  // undgå dobbelt-send ved recovery-genkørsel; notifyUser dedup'er desuden 24t).
  if (notifyInApp && !finalizationPending) {
    try {
      await notifyInApp({ race });
    } catch {
      // best-effort: in-app notif-fejl må ikke vælte afviklingen; notificationService
      // capturer internt (#2394), så en tavs slugning her er bevidst (#2395).
    }
  }

  // FIX 1: status='completed' sættes SIDST — efter al finalization er lykkedes. Idempotent
  // (en recovery-genkørsel sætter samme værdi). stages_completed sættes også (recovery-sti
  // hvor låsen ikke kørte; normal-sti har allerede sat den via låsen, så dette er en no-op-værdi).
  // #2974: samme tjek som fuld-sim-stien fik i #2898. Resultaterne ER skrevet på
  // dette tidspunkt; fejler status-flaget tavst, står løbet som "ikke afviklet"
  // trods skrevne race_results — og recovery-genkørslen vil forsøge at afvikle
  // det igen oven på dem. Tjek + kast, så retry-laget kan gribe det.
  const { error: statusError } = await supabase
    .from("races")
    .update({ status: "completed", stages_completed: totalStages })
    .eq("id", race.id);
  if (statusError) {
    const err = new Error(
      `Failed to mark race ${race.id} as completed after stage finalization — results ARE written, ` +
        `only the status flag failed: ${statusError.message}`,
    );
    console.error(`  ⚠️  ${err.message}`);
    captureException(err, { tags: { flow: "race-run", stage: "race-status-completed" }, raceId: race.id });
    throw err;
  }

  // #1995: løbet er finaliseret → flush parkerede holdskifter for deltagerne.
  // Idempotent, så den kører også i recovery-genkørsel (ingen finalizationPending-guard).
  await flushDeferredTransfersSafe({ supabase, race });

  // #3193: normal final-etape-afvikling refresher allerede tidligere i denne
  // funktion (lige efter updateStandings, isFinalStage-gated) — et kald her
  // ville blot gentage det samme (harmløst, men spildt RPC-arbejde). KUN
  // recovery-grenen (finalizationPending=true) sprang det tidlige kald over,
  // fordi hele `if (!finalizationPending)`-blokken (inkl. updateStandings)
  // ikke køres igen på et allerede-skrevet resultat — recovery skal derfor
  // stadig refreshe her, ellers forbliver global_rank_mv stale efter en
  // crash-recovery-genoptagelse indtil næste 10-min cron-tick.
  if (finalizationPending) {
    await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: captureException });
  }

  return {
    stageNumber, isFinalStage,
    rowsImported: applied.rowsImported, rows: resultRows.length,
    entrants: entrants.length, stages: totalStages,
    ...(finalizationPending ? { recovered: true } : {}),
  };
}
