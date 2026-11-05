// backend/lib/raceTimeline.js
// Event-loggen — etape-tidslinjen som førsteklasses artefakt (#2410), S1.
// Spec: docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md
//   §2 (kontrakt), §2.2 (event-taksonomi v1), §2.3 (konsistensregler, HÅRDE),
//   §4 valg 2 (syntese-dybde, ejer-besluttet 17/8), §5 (prototype-gate — bestået).
//
// REN funktion — ingen DB/fs/rng udenom de dedikerede seeded streams nedenfor.
// Samme (seed, input) → samme tidslinje, byte for byte (konsistensregel 4).
//
// Kaldes fra raceRunner.js i SAMME build-trin som moments/passages (data er i
// memory allerede — buildRaceResults/buildStageRowsAccumulated), bag flag
// `race_stage_timeline` (raceEngineFlag.js). Flag-off rører denne fil ALDRIG.
//
// Forankring (§1 i specen): motoren er en single-shot scorer — der findes ingen
// intra-etape-simulation. ALT "undervejs" her er derfor SYNTETISK udfyldning
// (valg 2, revideret 17/8): kontrakten bygges NU, en ægte intra-etape-motor kan
// SENERE emittere samme kontrakt nativt uden at UI'et ændrer sig. Syntesen er
// bevidst midlertidig — ikke en påstand om "sådan foregik etapen faktisk".
//
// Fog-gaten (#1791, HÅRDT KRAV, konsistensregel 5): INGEN rå komponenter, vægte
// eller sandsynligheder i event-params — kun rangeringer, tælletal, allerede-
// offentlige gaps (persisterede stageGaps) og km-mærker. Se raceTimeline.test.js'
// fog-gate-testen, der låser param-nøgle-sættet mod simulateStage's components-nøgler.
//
// De 6 ejer-godkendte renderer-forbedringer (17/8, bygget ind fra start):
//   1. Kuratér kollaps — max MAX_CURATED_FIELD_EVENTS jour_sans-events, resten
//      aggregeres til ét `field_fading`-event med count.
//   2. Terræn-formet gap-kurve — knækker på climbs' crest_km; slutpunkt ALTID
//      bundet af konsistensregel 2 (caught→0 ved catchKm; survived→persisteret
//      slutgab).
//   3. Profilbevidst uheld-km — flat/rolling mod sidste kvartal; mountain
//      spredt/nedkørsler; cobbles ved sektorer. Seeded, deterministisk.
//   4. Feltets tilstand — `peloton_splits` afledt af stageGapModel's bunch-
//      tærskel over de PERSISTEREDE stageGaps.
//   5. Virtuel førertrøje — `virtual_leader` når udbryderens kurve-forspring
//      overstiger hans GC-deficit (previousGc, genbrugt fra raceRunner).
//   6. Leadout-optakt — `leadout` ~3 km før mål på flat/bunch_sprint-finaler,
//      hold med sprint_captain (rolle genbrugt fra raceRunner, ingen nye DB-kald).

import { makeRng } from "./fictionalRiderGenerator.js";
import { stableSeed, stageGapModel, finiteDistanceKm } from "./raceSimulator.js";
import { computeCatchKm } from "./racePassages.js";
import { riderGroupsBefore } from "./raceStory.js"; // #6350
import { separationFraction } from "./engine/v4/exactPlace.ts"; // #6350
import { RACE_V4_TUNING } from "./engine/v4/tuning.ts"; // #6350

export const TIMELINE_VERSION = 1;

/**
 * Artefakt-versionen for en etape skrevet af LØBSMOTOR V4 (#4879/#3855).
 *
 * Hvorfor et nyt nummer og ikke bare 1: version 1 er SYNTETISK. v3's
 * buildStageTimeline nedenfor opfinder km-mærker (rng-afledte
 * udbruds-/uheldspositioner) ud fra et færdigt resultat, fordi v3 ikke ved
 * hvor på ruten noget skete. v4 kører hvert rutesegment igennem og udsender
 * events dér hvor de faktisk sker. Samme tabel, samme {km, type, params}-form,
 * samme aftagere — men to forskellige troværdighedsniveauer, og
 * migrationens egen kommentar (database/2026-08-17-2410-race-stage-
 * timelines.sql) siger at aftagere SKAL kunne se forskellige versioner for
 * forskellige etaper i samme løb. Det er præcis dét der sker under et flip.
 */
export const TIMELINE_VERSION_V4 = 2;

// Samme 200-km-fallback som racePassages/computeCatchKm bruger for etaper uden
// distance_km (legacy/PCM-data) — ÉN konsistent "effektiv distance" for hele
// generatoren, så km-mærker forbliver bounded og indbyrdes konsistente selv når
// den rå distance_km mangler.
const FALLBACK_DISTANCE_KM = 200;

// Syntese-parametre — START-KANDIDATER (samme forbehold som raceNarrative.js's
// Tier 1-tærskler: kalibreres senere mod en harness-kørsel hvis filmen viser sig
// systematisk misvisende, jf. spec §5 prototype-gate).
const BREAKAWAY_FORMED_WINDOW = [0.03, 0.15]; // andel af effektiv distance
const GAP_PEAK_RANGE = [60, 240];             // sekunder — kurvens toppunkt
const FINALE_WINDOW_KM = 3;                   // "~3 km før mål" (leadout/finale-anker)
// Spejler raceNarrative.js's SPRINT_GAP_S/CLOSE_GAP_S (samme offentlige gap-i-
// sekunder-tærskler til sprint/close/solo-klassificering). Holdt som egne
// konstanter (ikke importeret) — de to filer klassificerer af SAMME grund, men
// koblingen ville tvinge raceNarrative.js's narrative-tuning til også at flytte
// tidslinjens finish/sprint_decided-grænser, hvilket er en anden bekymring.
const SPRINT_GAP_S = 3;
const CLOSE_GAP_S = 10;
const MAX_CURATED_FIELD_EVENTS = 3; // forbedring 1: kuratér-kollaps-loft
const FLAT_PROFILES = new Set(["flat"]);
const MOUNTAIN_PROFILES = new Set(["mountain", "high_mountain"]);
const FLAT_INCIDENT_PROFILES = new Set(["flat", "rolling"]);
// #4373: tidskørsler har intet felt at spurte i, splitte eller angribe fra —
// rytterne (itt) eller holdene (ttt) kører hver for sig mod uret. Samme kort som
// raceNarrative.js's TIME_TRIAL_WIN_KEY (holdt som egen konstant af samme grund
// som SPRINT_GAP_S/CLOSE_GAP_S duplikeres: de to filer klassificerer af samme
// grund, men skal kunne tunes hver for sig).
const TIME_TRIAL_WIN_KEY = Object.freeze({ itt: "itt_win", ttt: "ttt_win" });

function rngFor(seed, name) {
  return makeRng(stableSeed(`${seed}:${name}`));
}

function clampKm(km, distance) {
  return Math.max(0, Math.min(distance, km));
}

function pushEvent(list, km, type, params) {
  // Kalderen (emit-wrapperen i buildStageTimeline) har allerede clampet km til
  // [0, distance] — her rundes blot til 2 decimaler for et stabilt, kompakt
  // JSONB-artefakt (konsistensregel 4: km ∈ [0, distance_km]).
  list.push({ km: Math.round(Math.max(0, km) * 100) / 100, type, params });
}

// Effektiv distance til syntese (aldrig null/NaN) — FALLBACK_DISTANCE_KM når
// etapen mangler distance_km, samme konvention som racePassages.computeCatchKm.
function effectiveDistance(stageProfile) {
  const d = finiteDistanceKm(stageProfile);
  return d != null && d > 0 ? d : FALLBACK_DISTANCE_KM;
}

// Deterministisk km for ét uheld — profilbevidst (forbedring 3). Dedikeret
// per-rytter-strøm (`${seed}:incident:${riderId}`) → uafhængig af andre rytteres
// uheld/rækkefølge, samme mønster som raceDayForm.js's per-rytter-hashede streams.
function incidentKm({ stageProfile, riderId, seed, distance }) {
  const rng = rngFor(seed, `incident:${riderId}`);
  const profileType = stageProfile?.profile_type;

  if (FLAT_INCIDENT_PROFILES.has(profileType)) {
    // Positionskamp: styrt/mekaniske uheld vægtes mod sidste kvartal.
    return distance * (0.75 + rng() * 0.25);
  }

  if (MOUNTAIN_PROFILES.has(profileType)) {
    const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
    if (climbs.length) {
      const climb = climbs[Math.floor(rng() * climbs.length)];
      const crest = Number(climb?.crest_km);
      if (Number.isFinite(crest)) {
        // Gerne nedkørsler: km EFTER crest_km, op til næste segment/distance.
        const upper = Math.min(distance, crest + Math.max(2, distance * 0.1));
        return crest + rng() * Math.max(0.1, upper - crest);
      }
    }
    return rng() * distance; // ingen climb-data → spredt over hele etapen
  }

  if (profileType === "cobbles") {
    const sectors = Array.isArray(stageProfile.sectors) ? stageProfile.sectors : [];
    if (sectors.length) {
      const sector = sectors[Math.floor(rng() * sectors.length)];
      const start = Number(sector?.start_km) || 0;
      const len = Number(sector?.length_km) || 0;
      return start + rng() * Math.max(0.1, len || 1);
    }
    return rng() * distance; // ingen sektor-data → spredt
  }

  // hilly/classic/itt/ttt/ukendt: generel spredning over hele etapen.
  return rng() * distance;
}

/**
 * Byg ÉN etapes deterministiske event-tidslinje. Ren funktion — ingen DB/fs.
 *
 * @param {object} args
 * @param {Array<{rider_id, team_id, rank, stageGap, race_role?}>} args.ranked
 *   fra simulateStage — SAMME rangering/gaps som race_results. `race_role` er
 *   valgfri (raceRunner genbruger sin allerede-byggede roleByRider til leadout-
 *   eventet, forbedring 6 — ingen nye DB-kald, ingen ny signatur-parameter).
 * @param {object} args.stageProfile  profile_type, finale_type, distance_km,
 *   climbs, sprints, sectors — SAMME objekt raceSimulator/racePassages læser.
 * @param {Array<{moment_key, params, significance, rider_ids}>} [args.moments]
 *   extractStageMoments-output for DENNE etape. Tom når v3=false (dormant) —
 *   tidslinjen degraderer da til stage_start/breakaway/gap/passages/finish.
 * @param {Array<{rider_id, kind, outcome, time_loss_seconds}>} [args.incidents]
 *   rollIncidents-output for DENNE etape. Tom når v3=false.
 * @param {Array<{kind, index, name, km, category, results}>} [args.passages]
 *   computePassages(...).passages for DENNE etape (kom/sprint-waypoints).
 * @param {Map<string,{in_breakaway:boolean, breakaway_caught:boolean}>} [args.breakawayStatus]
 *   deriveBreakawayStatus(ranked).
 * @param {Array<{rider_id, rank, time}>|null} [args.gc]  GC EFTER denne etape
 *   (kun etapeløb, samme form som raceClassifications.rankByCumTimeAsc).
 * @param {Array<{rider_id, rank, time}>|null} [args.previousGc]  GC FØR denne
 *   etape — genbrugt fra raceRunner's priorStageRows-akkumulering (S5:
 *   virtual_leader). null på etape 1 / endagsløb.
 * @param {number} args.seed  samme stage-seed som simulateStage/computePassages
 *   (stableSeed(raceSeedInput(...))) — ALLE syntetiske km/kurve-værdier afledes
 *   af dedikerede `${seed}:<navn>`-strømme heraf.
 * @param {boolean} [args.isStageRace=false]
 * @returns {{ timeline_version: number, events: Array<{km:number, type:string, params:object}> }}
 */
export function buildStageTimeline({
  ranked = [],
  stageProfile = {},
  moments = [],
  incidents = [],
  passages = [],
  breakawayStatus = new Map(),
  gc = null,
  previousGc = null,
  seed,
  isStageRace = false,
} = {}) {
  const events = [];
  if (!ranked.length) return { timeline_version: TIMELINE_VERSION, events };

  const distance = effectiveDistance(stageProfile);
  // #4373: ét sted der afgør om DENNE etape er en tidskørsel — læses af
  // favorite_crack, peloton_splits og finale-klassificeringen nedenfor.
  const timeTrialWinKey = TIME_TRIAL_WIN_KEY[stageProfile.profile_type] ?? null;
  // Alle km-mærker clampes HER til [0, distance] FØR de rundes/pushes — én
  // fælles grænse (konsistensregel 4), uanset hvilken syntese-gren der producerede dem.
  const emit = (km, type, params) => pushEvent(events, clampKm(km, distance), type, params);
  const rankedByRank = [...ranked].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const winner = rankedByRank[0];
  const second = rankedByRank[1] ?? null;
  const rankById = new Map(ranked.map((r) => [r.rider_id, r.rank]));

  // ── stage_start ────────────────────────────────────────────────────────
  emit(0, "stage_start", {
    field_count: ranked.length,
    profile_type: stageProfile.profile_type ?? null,
    distance_km: stageProfile.distance_km ?? null,
  });

  // ── Udbrud: formed/gap_update-kurve/caught|survived (forbedring 2) ───────
  const breakawayIds = [];
  for (const [riderId, st] of breakawayStatus) {
    if (st?.in_breakaway) breakawayIds.push(riderId);
  }

  // Finale-anker genbrugt af favorite_crack/field_fading/finale_attack: sidste
  // climbs crest_km hvis kendt, ellers et vindue før mål.
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const lastClimb = climbs.length ? climbs[climbs.length - 1] : null;
  const lastClimbCrestKm = lastClimb != null ? Number(lastClimb.crest_km) : NaN;
  const finaleKm = Number.isFinite(lastClimbCrestKm)
    ? lastClimbCrestKm
    : Math.max(0, distance - FINALE_WINDOW_KM);

  if (breakawayIds.length && winner) {
    const winnerBw = breakawayStatus.get(winner.rider_id);
    const breakawaySurvived = !!(winnerBw?.in_breakaway && !winnerBw.breakaway_caught);

    // Persisteret slut-gab (offentligt): bedst-placerede IKKE-escapee's stageGap.
    const bestNonEscapee = rankedByRank.find((r) => !breakawayStatus.get(r.rider_id)?.in_breakaway);
    const finalGapSeconds = bestNonEscapee ? bestNonEscapee.stageGap : 0;

    const catchKm = clampKm(computeCatchKm({ stageProfile, seed }), distance);
    const kmFormedRatio = BREAKAWAY_FORMED_WINDOW[0]
      + (BREAKAWAY_FORMED_WINDOW[1] - BREAKAWAY_FORMED_WINDOW[0]) * rngFor(seed, "breakaway_formed_km")();
    const kmFormed = clampKm(distance * kmFormedRatio, distance);
    const endKm = breakawaySurvived ? distance : Math.max(kmFormed, catchKm);
    const finalValue = breakawaySurvived ? finalGapSeconds : 0;

    emit(kmFormed, "breakaway_formed", { rider_ids: breakawayIds.slice(0, 3) });

    const peakGapSeconds = GAP_PEAK_RANGE[0]
      + (GAP_PEAK_RANGE[1] - GAP_PEAK_RANGE[0]) * rngFor(seed, "gap_peak")();

    // Kurvepunkter knækker på climbs' crest_km inden for (kmFormed, endKm).
    const breakpoints = climbs
      .map((c) => Number(c?.crest_km))
      .filter((km) => Number.isFinite(km) && km > kmFormed && km < endKm)
      .sort((a, b) => a - b);

    const span = endKm - kmFormed || 1;
    const curvePoints = [{ km: kmFormed, gap: 0 }];
    for (const km of breakpoints) {
      const t = Math.max(0, Math.min(1, (km - kmFormed) / span));
      // Toppunkt omkring t≈0.7 (forspringet vokser på rolige stræk); vægtes
      // mod slutværdien med t² (falder markant på de SIDSTE climbs — t tæt på 1).
      const bump = peakGapSeconds * Math.max(0, 1 - Math.abs(2 * t - 0.7));
      const gapVal = Math.max(0, Math.round(bump * (1 - t * t) + finalValue * t * t));
      curvePoints.push({ km, gap: gapVal });
    }
    curvePoints.push({ km: endKm, gap: Math.max(0, Math.round(finalValue)) });

    for (const p of curvePoints) {
      emit(p.km, "gap_update", { gap_seconds: p.gap });
    }

    if (breakawaySurvived) {
      const survivedIds = breakawayIds.filter((id) => !breakawayStatus.get(id)?.breakaway_caught);
      emit(endKm, "breakaway_survived", {
        rider_ids: survivedIds,
        final_gap: Math.max(0, Math.round(finalValue)),
      });
    } else {
      emit(endKm, "breakaway_caught", { rider_ids: breakawayIds });
    }

    // ── virtual_leader (forbedring 5) ───────────────────────────────────
    if (isStageRace && previousGc?.length && breakawayIds.length) {
      const prevTimeById = new Map(previousGc.map((g) => [g.rider_id, g.time]));
      const prevLeader = previousGc[0];
      const leaderPrevTime = prevLeader ? prevTimeById.get(prevLeader.rider_id) : null;
      // Stærkeste escapee = først i breakawayIds (Map-iteration følger ranked's
      // rank-orden, se deriveBreakawayStatus — ingen ny sortering nødvendig).
      const leadEscapeeId = breakawayIds[0];
      const escapeePrevTime = prevTimeById.get(leadEscapeeId);
      if (
        leadEscapeeId !== prevLeader?.rider_id
        && Number.isFinite(leaderPrevTime)
        && Number.isFinite(escapeePrevTime)
      ) {
        const deficitSeconds = escapeePrevTime - leaderPrevTime;
        if (deficitSeconds > 0) {
          const overtakePoint = curvePoints.find((p) => p.gap > deficitSeconds);
          if (overtakePoint) {
            emit(overtakePoint.km, "virtual_leader", {
              rider_id: leadEscapeeId,
              overtaken_leader_id: prevLeader.rider_id,
            });
          }
        }
      }
    }
  }

  // ── kom_passage / intermediate_sprint (fra allerede-persisteret passage-lag) ──
  for (const wp of passages) {
    if (wp.kind === "kom") {
      emit(wp.km, "kom_passage", {
        name: wp.name,
        category: wp.category ?? null,
        top: (wp.results || []).map((r) => ({ rider_id: r.rider_id, points: r.points })),
      });
    } else if (wp.kind === "sprint") {
      emit(wp.km, "intermediate_sprint", {
        name: wp.name,
        top: (wp.results || []).map((r) => ({ rider_id: r.rider_id, points: r.points, bonus_seconds: r.bonus_seconds })),
      });
    }
    // wp.kind === "finish" udelades bevidst her — `finish`-eventet bygges
    // nedenfor direkte fra `ranked` (virker også når passages er tom, dvs.
    // etaper uden rutedata/endagsløb).
  }

  // ── incidents (forbedring 3: profilbevidst km) ───────────────────────────
  for (const inc of incidents) {
    const km = incidentKm({ stageProfile, riderId: inc.rider_id, seed, distance });
    emit(km, "incident", {
      rider_id: inc.rider_id,
      kind: inc.kind,
      outcome: inc.outcome,
      time_loss_seconds: inc.time_loss_seconds ?? null,
    });
  }

  // ── favorite_crack + field_fading (forbedring 1: kuratér-kollaps) ────────
  const seenRiders = new Set();
  const jourSansCandidates = [];
  for (const m of moments) {
    if (m.moment_key === "favorite_off_day" && m.params?.riderId && !seenRiders.has(m.params.riderId)) {
      seenRiders.add(m.params.riderId);
      jourSansCandidates.push({ riderId: m.params.riderId, reason: m.params.reason ?? "unexplained", significance: m.significance ?? 0 });
    }
  }
  for (const m of moments) {
    if (m.moment_key === "tag_jour_sans" && m.params?.riderId && !seenRiders.has(m.params.riderId)) {
      seenRiders.add(m.params.riderId);
      jourSansCandidates.push({ riderId: m.params.riderId, reason: "jour_sans", significance: m.significance ?? 0 });
    }
  }
  jourSansCandidates.sort((a, b) =>
    (b.significance - a.significance) || ((rankById.get(a.riderId) ?? 9999) - (rankById.get(b.riderId) ?? 9999))
  );
  const keptCandidates = jourSansCandidates.slice(0, MAX_CURATED_FIELD_EVENTS);
  const collapsedCount = jourSansCandidates.length - keptCandidates.length;
  for (const c of keptCandidates) {
    // #4373: "mister kontakten til front" er feltsprog. På en tidskørsel er der
    // ingen front at miste kontakten til — rytteren taber tid mod uret. Disciplin
    // threades med som param, så tekst-laget kan vælge den rigtige formulering
    // uden selv at kende etapeprofilen (describeEvent ser kun ÉT event ad gangen).
    emit(finaleKm, "favorite_crack", {
      rider_id: c.riderId,
      reason: c.reason,
      ...(timeTrialWinKey ? { discipline: "time_trial" } : {}),
    });
  }
  if (collapsedCount > 0) {
    emit(finaleKm, "field_fading", { count: collapsedCount });
  }

  // ── finale-klassificering (sprint/close/solo) — direkte fra ranked, IKKE
  // fra moments, så finish/sprint_decided/finale_attack/leadout altid emitterer
  // selv når v3=false (moments/incidents tomme). ──────────────────────────
  // #4373: itt/ttt får deres EGEN win_type og hverken sprint_decided,
  // finale_attack eller leadout — ingen af de tre findes i en tidskørsel.
  const gap2 = second ? second.stageGap : null;
  let winType = timeTrialWinKey ?? "solo_win";
  if (!timeTrialWinKey && gap2 != null) {
    winType = gap2 < SPRINT_GAP_S ? "sprint_win" : gap2 < CLOSE_GAP_S ? "close_win" : "solo_win";
  }

  if (timeTrialWinKey) {
    // Ingen finale-begivenhed: tidskørslens historie er tiderne selv (finish-
    // eventet nedenfor bærer win_type + top-10 med gaps).
  } else if (winType === "sprint_win" && winner && second) {
    emit(distance, "sprint_decided", {
      rider_ids: [winner.rider_id, second.rider_id],
      photo_finish: gap2 < 1,
    });
    // ── leadout (forbedring 6) ─────────────────────────────────────────
    const isBunchSprintFinale = FLAT_PROFILES.has(stageProfile.profile_type) || stageProfile.finale_type === "bunch_sprint";
    if (isBunchSprintFinale) {
      const seenTeams = new Set();
      const sprintCaptainTeamIds = [];
      for (const r of ranked) {
        if (r.race_role === "sprint_captain" && r.team_id != null && !seenTeams.has(r.team_id)) {
          seenTeams.add(r.team_id);
          sprintCaptainTeamIds.push(r.team_id);
        }
      }
      if (sprintCaptainTeamIds.length) {
        emit(Math.max(0, distance - FINALE_WINDOW_KM), "leadout", { team_ids: sprintCaptainTeamIds });
      }
    }
  } else if (winner) {
    emit(finaleKm, "finale_attack", { rider_id: winner.rider_id });
  }

  // ── peloton_splits (forbedring 4: stageGapModel's bunch-tærskel) ────────
  const { bunch, spread } = stageGapModel(stageProfile);
  const clusterThresholdSeconds = Math.max(0, bunch * spread);
  const sortedByGap = [...ranked].sort((a, b) => (a.stageGap - b.stageGap) || ((a.rank ?? 9999) - (b.rank ?? 9999)));
  const clusters = [];
  for (const r of sortedByGap) {
    const last = clusters[clusters.length - 1];
    if (last && (r.stageGap - last.lastGap) <= clusterThresholdSeconds) {
      last.riders.push(r.rider_id);
      last.lastGap = r.stageGap;
    } else {
      clusters.push({ riders: [r.rider_id], lastGap: r.stageGap });
    }
  }
  // "Feltet splitter reelt" = mindst to klynger, og mindst én klynge UD OVER den
  // første er en ægte gruppe (≥2 ryttere) — ellers er det bare spredte enkelt-
  // ryttere (fx en jævnt spredt bjergetape), ikke en synlig feltsprængning.
  // #4373: et felt der splitter forudsætter et felt. På itt/ttt er "grupper" bare
  // ryttere med tilfældigt ens sluttid — aldrig en feltsprængning.
  const hasRealSecondaryGroup = clusters.slice(1).some((c) => c.riders.length >= 2);
  if (!timeTrialWinKey && clusters.length >= 2 && hasRealSecondaryGroup) {
    emit(distance, "peloton_splits", { groups: clusters.map((c) => c.riders.length) });
  }

  // ── finish ────────────────────────────────────────────────────────────
  emit(distance, "finish", {
    top: rankedByRank.slice(0, 10).map((r) => ({ rider_id: r.rider_id, rank: r.rank, gap: r.stageGap })),
    win_type: winType,
  });

  // ── gc_change (kun etapeløb, direkte GC-sammenligning — ikke afhængig af v3) ──
  if (isStageRace && gc?.length && previousGc?.length) {
    const newLeaderId = gc[0].rider_id;
    const prevLeaderId = previousGc[0].rider_id;
    if (newLeaderId !== prevLeaderId) {
      emit(distance, "gc_change", { new_leader_id: newLeaderId, previous_leader_id: prevLeaderId });
    }
  }

  // Konsistensregel 4: sorteret på km. Array#sort er stabil (Node ≥ 12/V8
  // TimSort) → indbyrdes rækkefølge for events med samme km er deterministisk
  // (insertion-orden ovenfor), ikke tilfældig.
  events.sort((a, b) => a.km - b.km);

  return { timeline_version: TIMELINE_VERSION, events };
}

/**
 * #4879 (løbsmotor v4): etapens tidslinje når v4 kørte etapen.
 *
 * v4's egen `StageOutput.timeline` ER hændelsesrækken — den er udsendt undervejs
 * af de koblede mekanikker (udbrud, splits, uheld, finale, tidsgrænse), ikke
 * bagudsyntetiseret som version 1. Denne funktion opfinder derfor INTET; den
 * lægger kun de to lag på som bor UDEN for motoren og som fladen allerede
 * forventer:
 *
 *   1. `kom_passage`/`intermediate_sprint` fra passage-laget (#2770,
 *      racePassages.js). v4 læser ikke rutens vejpunkter (auditten 5/9:
 *      "bjerg- og spurtpassager udsendes ikke af v4"), så uden dem mistede
 *      løbsfilmens scrubber sine stignings-markører på hver v4-etape.
 *   2. `gc_change` — en sammenligning af to klassementer, ikke en
 *      motorhændelse. Præcis samme udledning som version 1 laver.
 *
 * Rækkefølgen: motorens events først (allerede km-sorterede af index.ts),
 * derefter de to lag, og en stabil sortering på km til sidst. Stabiliteten
 * betyder at et passage-event og et motor-event på samme km altid lander i
 * samme indbyrdes orden — determinismen holder hele vejen ud i JSONB'en.
 *
 * @param {{events: Array<{km, type, params}>}} engineTimeline  v4's StageOutput.timeline
 * @param {object} stageProfile
 * @param {Array} [passages]  computePassages(...).passages (samme form som version 1 læser)
 * @param {Array|null} [gc]  klassementet EFTER denne etape
 * @param {Array|null} [previousGc]  klassementet FØR denne etape
 * @param {boolean} [isStageRace]
 * @returns {{timeline_version: number, events: Array<{km, type, params}>}}
 */
export function buildStageTimelineV4({
  engineTimeline = null,
  stageProfile = {},
  passages = [],
  gc = null,
  previousGc = null,
  isStageRace = false,
} = {}) {
  const engineEvents = Array.isArray(engineTimeline?.events) ? engineTimeline.events : [];
  if (!engineEvents.length) return { timeline_version: TIMELINE_VERSION_V4, events: [] };

  const distance = effectiveDistance(stageProfile);
  const events = engineEvents.map((e) => ({
    km: Math.round(Math.max(0, Math.min(distance, Number(e.km) || 0)) * 100) / 100,
    type: e.type,
    params: e.params ?? {},
  }));
  const emit = (km, type, params) => pushEvent(events, clampKm(km, distance), type, params);

  // #2770/#2413 (ejer 6/9): siden M9 blev koblet ind i v4 udsender MOTOREN selv
  // sine passage-events. Lægger vi dem på igen her, står hver bjergtop og hver
  // indlagt spurt to gange i løbsfilmen. Derfor: er der allerede passage-events
  // i motorens egen række, er de kilden, og dette lag holder sig væk.
  // Bagudkompatibelt — en v4-kørsel UDEN M9 (eller en gammel, persisteret
  // motor-tidslinje) har ingen sådanne events og får laget på som før.
  const engineEmitsPassages = events.some((e) => e.type === "kom_passage" || e.type === "intermediate_sprint");

  for (const wp of engineEmitsPassages ? [] : passages) {
    if (wp.kind === "kom") {
      emit(wp.km, "kom_passage", {
        name: wp.name,
        category: wp.category ?? null,
        top: (wp.results || []).map((r) => ({ rider_id: r.rider_id, points: r.points })),
      });
    } else if (wp.kind === "sprint") {
      emit(wp.km, "intermediate_sprint", {
        name: wp.name,
        top: (wp.results || []).map((r) => ({ rider_id: r.rider_id, points: r.points, bonus_seconds: r.bonus_seconds })),
      });
    }
    // wp.kind === "finish" udelades — motoren udsender sit eget finish-event.
  }

  if (isStageRace && gc?.length && previousGc?.length) {
    const newLeaderId = gc[0].rider_id;
    const prevLeaderId = previousGc[0].rider_id;
    if (newLeaderId !== prevLeaderId) {
      emit(distance, "gc_change", { new_leader_id: newLeaderId, previous_leader_id: prevLeaderId });
    }
  }

  events.sort((a, b) => a.km - b.km);
  return { timeline_version: TIMELINE_VERSION_V4, events: withEventPlaces(events) };
}

// ── #6350: hændelsernes sted, læst af selve tidslinjen ───────────────────────
// Motoren stempler hvert segment for sig (engine/v4/exactPlace.ts). Det der
// kræver hele etapen eller flere hændelser på én gang, sker her, som en ren
// funktion af loggen: den kører når en ny etape gemmes, og når en gemt etape
// læses (GET /timeline), så allerede kørte etaper også fortæller rigtigt uden at
// loggen røres. `km` (rækkefølgen) flyttes aldrig; kun `params.exact_km`, og
// `params.exact_time` fjernes hvor tiden ikke længere hører til stedet, så
// siden falder tilbage på førerens tid på stedet. Idempotent.

const KM_EPSILON = 0.01;
const FORMATION_TYPES = new Set(["peloton_splits", "breakaway_dropped", "finale_attack"]);
const CONTACT_TYPES = new Set(["breakaway_caught", "group_merged"]);
const GROUP_CHANGE_TYPES = new Set(["breakaway_formed", ...FORMATION_TYPES, ...CONTACT_TYPES]);
const BOOKKEEPING_ATTACK_KINDS = new Set(["stage_decided", "placement_gap", "gap_survived"]);

const round2 = (n) => Math.round(n * 100) / 100;
const finiteOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const exactKmOf = (event) => finiteOrNull(event.params?.exact_km);
const riderIdsOf = (event) => {
  const list = Array.isArray(event.params?.rider_ids) ? event.params.rider_ids.filter((id) => typeof id === "string") : [];
  return list.length > 0 ? list : typeof event.params?.rider_id === "string" ? [event.params.rider_id] : [];
};

function movePlace(event, km, time = null) {
  event.params.exact_km = km;
  if (time === null) delete event.params.exact_time;
  else event.params.exact_time = time;
}

/** Tjekpunktet før km: det sidste sted motoren meldte gruppernes huller. */
function checkpointBeforeKm(km, events) {
  return events.reduce((best, e) => (e.type === "gap_update" && e.km < km && e.km > best ? e.km : best), 0);
}

/** Hvor segmentet bag et tjekpunkt startede, aflæst af de splits motoren kunne placere; null uden dem. */
function segmentStartKm(km, splitsAtKm, events, visible) {
  const anchor = checkpointBeforeKm(km, events);
  const starts = [];
  for (const split of splitsAtKm) {
    // Kun motorens egne steder måler segmentet. Dem vi selv har flyttet, har mistet tiden.
    if (finiteOrNull(split.params?.exact_time) === null) continue;
    const at = exactKmOf(split);
    const fraction = separationFraction(0, finiteOrNull(split.params?.gap_seconds) ?? NaN, visible);
    if (at === null || at >= km || fraction === null || fraction >= 1) continue;
    const start = (at - fraction * km) / (1 - fraction);
    if (start >= anchor - KM_EPSILON && start < km) starts.push(start);
  }
  if (starts.length === 0) return null;
  return starts.sort((a, b) => a - b)[Math.floor(starts.length / 2)];
}

/** Fandtes gruppen før segmentet? En gruppe dannet i segmentet har ingen linje ved dets start. */
function groupExistedBefore(groupId, km, events) {
  return groupId === "peloton-0" || events.some((e) => e.km < km && (e.params?.group_id === groupId || e.params?.into_group_id === groupId));
}

/**
 * Hændelserne der flytter en rytter ind i eller ud af en anden gruppe end splittets
 * egen. Motoren skriver altid rider_ids på en sammenlægning (segmentLoop.ts), så
 * gruppens egen kontakt navngiver også splittets ryttere, ofte i en kæde af grupper
 * på samme tjekpunkt. Den er ikke et skift: de kører stadig i linjen fra splittet.
 */
function groupChangesOutside(split, events) {
  const line = new Set([split.params?.group_id]);
  const ownContact = (e) => CONTACT_TYPES.has(e.type) && e.km === split.km && line.has(e.params?.group_id);
  for (const e of events) if (ownContact(e) && typeof e.params?.into_group_id === "string") line.add(e.params.into_group_id);
  return events.filter((e) => e !== split && GROUP_CHANGE_TYPES.has(e.type) && !BOOKKEEPING_ATTACK_KINDS.has(e.params?.kind)
    && e.params?.group_id !== split.params?.group_id && !ownContact(e));
}

/**
 * Splittets ryttere der kørte i kildegruppen på det udledte sted og blev der til
 * tjekpunktet. De andre (fx hentet fra udbruddet inde i segmentet) kom først med
 * senere og hører ikke til stedet.
 */
function ridersInSourceAt(split, place, events) {
  const groupOf = riderGroupsBefore(events, place);
  const changes = groupChangesOutside(split, events);
  const changedGroupAfter = (id) => changes.some((e) => {
    const at = exactKmOf(e) ?? e.km;
    return at >= place && at < split.km && riderIdsOf(e).includes(id);
  });
  return riderIdsOf(split).filter((id) => groupOf(id) === split.params?.source_group_id && !changedGroupAfter(id));
}

/** Det seneste sted før tjekpunktet hvor en af hændelsens ryttere skiftede gruppe. */
function ridersFreeKm(event, events) {
  const riders = new Set(riderIdsOf(event));
  return groupChangesOutside(event, events).reduce((free, e) => {
    const at = exactKmOf(e) ?? e.km;
    return at < event.km && at > free && riderIdsOf(e).some((id) => riders.has(id)) ? at : free;
  }, -Infinity);
}

/**
 * Et split motoren ikke kunne placere (ældre etaper: gruppen slugte ryttere inde
 * i segmentet, se exactPlace.ts) står på tjekpunktet, på en bjergankomst altså på
 * stregen. Gruppens hul er kendt, og to linjer glider lineært fra hinanden over
 * segmentet, så stedet er det samme som motoren selv regner. Kun med bevis: et
 * split motoren har placeret i samme segment, en kildegruppe der fandtes ved
 * segmentets start, og ryttere der kørte i den på stedet. Ellers er tjekpunktet
 * stadig det ærlige svar.
 *
 * Et split har ét sted, men stedet gælder pr. rytter: de der ikke kørte i
 * kildegruppen dér, kommer i en halvdel af splittet med samme gruppe
 * (`joined_late`), der står på tjekpunktet indtil placeLateRiders har set på den.
 * Svaret er split -> den halvdel, som kalderen sætter ind lige efter splittet.
 */
function placeCheckpointSplits(events) {
  const visible = RACE_V4_TUNING.groups.mergeThresholdSeconds;
  const lateHalves = new Map();
  const byKm = new Map();
  for (const event of events) {
    if (event.type !== "peloton_splits") continue;
    if (!byKm.has(event.km)) byKm.set(event.km, []);
    byKm.get(event.km).push(event);
  }
  for (const [km, splits] of byKm) {
    const stuck = splits.filter((split) => exactKmOf(split) === km && !split.params.joined_late);
    if (stuck.length === 0) continue;
    const start = segmentStartKm(km, splits, events, visible);
    if (start === null) continue;
    // #7734: en sen halvdel fra et tidligere tjekpunkt kører allerede i sin gruppe her.
    const soFar = events.flatMap((event) => (lateHalves.has(event) ? [event, lateHalves.get(event)] : [event]));
    for (const split of stuck) {
      const fraction = separationFraction(0, finiteOrNull(split.params?.gap_seconds) ?? NaN, visible);
      if (fraction === null || !groupExistedBefore(split.params?.source_group_id, km, events)) continue;
      const place = round2(start + fraction * (km - start));
      const atPlace = ridersInSourceAt(split, place, soFar);
      if (atPlace.length === 0) continue;
      const late = riderIdsOf(split).filter((id) => !atPlace.includes(id));
      if (late.length > 0) {
        lateHalves.set(split, { ...split, params: { ...split.params, rider_ids: late, joined_late: true } });
        split.params.rider_ids = atPlace;
      }
      movePlace(split, place);
    }
  }
  return lateHalves;
}

/**
 * En gruppe dannet og hentet i samme segment har intet hul ved segmentets slut at
 * måle på, så dens dannelse faldt på tjekpunktet, efter sin egen indhentning. Den
 * må stå før kontakten: sammen med de angreb den hørte til, ellers på kontakten.
 */
function placeFormationsBeforeContact(events) {
  const contactOf = new Map();
  const keyOf = (event) => `${event.km}|${event.params?.group_id}`;
  for (const event of events) {
    const at = exactKmOf(event);
    if (!CONTACT_TYPES.has(event.type) || typeof event.params?.group_id !== "string" || at === null) continue;
    contactOf.set(keyOf(event), Math.min(contactOf.get(keyOf(event)) ?? Infinity, at));
  }
  for (const event of events) {
    if (!FORMATION_TYPES.has(event.type) || BOOKKEEPING_ATTACK_KINDS.has(event.params?.kind)) continue;
    const contact = contactOf.get(keyOf(event));
    const at = exactKmOf(event);
    if (contact === undefined || at === null || at <= contact + KM_EPSILON) continue;
    // En sen halvdel hører aldrig til søster-splittenes sted: den står på kontakten,
    // det sidste sted gruppen findes. Ingen står i gruppen før han var fri af den forrige.
    const siblings = event.params?.joined_late ? []
      : events.filter((e) => e.type === event.type && e.km === event.km && (exactKmOf(e) ?? Infinity) <= contact).map(exactKmOf);
    const place = Math.max(siblings.length > 0 ? Math.max(...siblings) : contact, ridersFreeKm(event, events));
    movePlace(event, place);
    if (place <= contact) continue;
    // Gruppen kan ikke være væk før den sidste rytter nåede den.
    for (const e of events) if (CONTACT_TYPES.has(e.type) && keyOf(e) === keyOf(event) && (exactKmOf(e) ?? Infinity) < place) movePlace(e, place);
    contactOf.set(keyOf(event), place);
  }
  // "Egne ryttere foran" meldes ved segmentets start, også om en gruppe der først
  // dannes inde i segmentet: meldingen står hvor gruppen blev dannet.
  const formedAt = new Map();
  for (const event of events) {
    if (!FORMATION_TYPES.has(event.type) || BOOKKEEPING_ATTACK_KINDS.has(event.params?.kind) || formedAt.has(event.params?.group_id)) continue;
    formedAt.set(event.params?.group_id, event);
  }
  for (const event of events) {
    if (event.type !== "own_riders_ahead") continue;
    const formation = formedAt.get(event.params?.group_id);
    const at = exactKmOf(event);
    if (formation && at !== null && (exactKmOf(formation) ?? -Infinity) > at) movePlace(event, exactKmOf(formation), finiteOrNull(formation.params?.exact_time));
  }
}

/**
 * #7734: ryttere der først kom til kildegruppen inde i segmentet (fx hentet fra
 * udbruddet), kan ikke være sat på søster-splittenes sted, men de står heller ikke
 * på tjekpunktet: de kørte i kildegruppen fra kontakten, og tjekpunktet siger hvor
 * meget de tabte efter den. Stedet er det samme som motoren selv regner, bare målt
 * fra kontakten. Kun med bevis: kontakten ligger i segmentet, og alle rytterne kørte
 * i kildegruppen lige efter den. Ellers er tjekpunktet stadig det ærlige svar.
 *
 * En sen halvdel kører ikke i gruppens linje fra stedet (gruppen er længere tilbage),
 * så den får `own_line`: sin egen linje fra kildegruppen til gruppen på tjekpunktet
 * (raceStory.js). Ellers hopper rytterne bare et andet sted end på stregen. Et helt
 * split af sene ryttere er selv linjen.
 */
function placeLateRiders(events) {
  const visible = RACE_V4_TUNING.groups.mergeThresholdSeconds;
  for (const split of events) {
    if (split.type !== "peloton_splits" || exactKmOf(split) !== split.km) continue;
    const free = ridersFreeKm(split, events);
    if (free < checkpointBeforeKm(split.km, events)) continue;
    const fraction = separationFraction(0, finiteOrNull(split.params?.gap_seconds) ?? NaN, visible);
    if (fraction === null) continue;
    const place = round2(free + fraction * (split.km - free));
    const groupOf = riderGroupsBefore(events, free + KM_EPSILON);
    if (place >= split.km || !riderIdsOf(split).every((id) => groupOf(id) === split.params?.source_group_id)) continue;
    movePlace(split, place);
    if (split.params.joined_late) split.params.own_line = true;
  }
}

/**
 * Følgerne af at blive sat står hvor han blev sat, ikke hvor motoren opdagede det:
 * planens "sat"/"hentet" afgøres først ved næste segmentgrænse (stagePlanEngine.ts),
 * og "gik kold" stemples ved segmentets slut. `km` bliver stående, for det er dér
 * opgaven skifter; `exact_km` er det sted filmen og opsummeringen fortæller.
 */
function placeRiderConsequences(events) {
  const splitAt = new Map(); // `${km}|${rytter}` -> split
  for (const event of events) {
    if (event.type !== "peloton_splits") continue;
    for (const id of riderIdsOf(event)) splitAt.set(`${event.km}|${id}`, event);
  }
  const joined = new Map(); // rytter -> { km, time, source }
  const caught = new Map(); // rytter -> { km, time }
  for (const event of events) {
    const p = event.params ?? {};
    const place = { km: exactKmOf(event) ?? event.km, time: finiteOrNull(p.exact_time) };
    if (event.type === "peloton_splits") {
      for (const id of riderIdsOf(event)) joined.set(id, { ...place, source: p.source_group_id ?? null });
    } else if (event.type === "incident" && p.outcome === "time_loss") {
      for (const id of riderIdsOf(event)) joined.set(id, { km: place.km, time: null, source: null });
    } else if (event.type === "group_merged") {
      // Tilbage i gruppen han blev sat fra, eller indhentet efter et uheld: det der
      // skete, forklarer ikke et senere "sat".
      for (const id of riderIdsOf(event)) {
        const from = joined.get(id);
        if (from && (from.source === null || from.source === p.into_group_id)) joined.delete(id);
      }
    } else if (event.type === "breakaway_caught") {
      for (const id of riderIdsOf(event)) caught.set(id, place);
    } else if (event.type === "stage_plan_leg") {
      const from = p.reason === "dropped" ? joined.get(p.rider_id) : p.reason === "caught" ? caught.get(p.rider_id) : undefined;
      if (from && from.km < place.km - KM_EPSILON) movePlace(event, from.km, from.time);
    } else if ((event.type === "all_out_cracked" || event.type === "breakaway_dropped") && exactKmOf(event) === event.km) {
      // Flere ryttere kan stå i hver sin halvdel: hændelsen står ved den sidste af dem.
      const splits = riderIdsOf(event).map((id) => splitAt.get(`${event.km}|${id}`));
      if (splits.length === 0 || !splits.every((split) => split && exactKmOf(split) !== null && exactKmOf(split) < event.km)) continue;
      const last = splits.reduce((a, b) => (exactKmOf(b) > exactKmOf(a) ? b : a));
      movePlace(event, exactKmOf(last), finiteOrNull(last.params?.exact_time));
    }
  }
}

/**
 * #6350: tidslinjen med hver hændelse på det sted den skete. Input muteres aldrig.
 * Et split kan komme tilbage som to hændelser (placeCheckpointSplits).
 * En log uden `exact_km` (version 1 og ældre v4-revisioner) kommer uændret tilbage.
 */
export function withEventPlaces(events) {
  if (!Array.isArray(events) || !events.some((event) => event && exactKmOf(event) !== null)) return events;
  const copied = events.map((event) => (event?.params ? { ...event, params: { ...event.params } } : event));
  const lateHalves = placeCheckpointSplits(copied.filter((event) => event?.params));
  const placed = copied.flatMap((event) => (lateHalves.has(event) ? [event, lateHalves.get(event)] : [event]));
  const known = placed.filter((event) => event?.params);
  placeFormationsBeforeContact(known);
  placeLateRiders(known);
  placeRiderConsequences(known);
  return placed;
}
