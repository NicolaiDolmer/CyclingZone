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

export const TIMELINE_VERSION = 1;

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
    emit(finaleKm, "favorite_crack", { rider_id: c.riderId, reason: c.reason });
  }
  if (collapsedCount > 0) {
    emit(finaleKm, "field_fading", { count: collapsedCount });
  }

  // ── finale-klassificering (sprint/close/solo) — direkte fra ranked, IKKE
  // fra moments, så finish/sprint_decided/finale_attack/leadout altid emitterer
  // selv når v3=false (moments/incidents tomme). ──────────────────────────
  const gap2 = second ? second.stageGap : null;
  let winType = "solo_win";
  if (gap2 != null) {
    winType = gap2 < SPRINT_GAP_S ? "sprint_win" : gap2 < CLOSE_GAP_S ? "close_win" : "solo_win";
  }

  if (winType === "sprint_win" && winner && second) {
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
  const hasRealSecondaryGroup = clusters.slice(1).some((c) => c.riders.length >= 2);
  if (clusters.length >= 2 && hasRealSecondaryGroup) {
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
