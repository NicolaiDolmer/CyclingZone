// Race Engine v3 (#2224), slice S6 (#2355) — why-rapport + story-tags.
// Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md §10
//   + docs/superpowers/specs/2026-07-11-narrative-systems-design.md §"System A".
//
// Problemet dette lukker: raceSimulator.js beregner en fuld score-dekomposition
// {terrain, noise, form, fatigue, team, breakaway, finale, work_cost, dayform,
// jour_sans, peak, incident} pr. rytter pr. etape (persisteres i dag KUN i
// race_simulation_rider_scores, admin-only RLS) — men spilleren kan aldrig se
// HVORFOR et resultat blev som det blev. Dette modul oversætter komponenterne
// til AFLEDTE, narrativt meningsfulde momenter (IKKE de rå tal) klar til
// persistering i race_stage_moments (spillervendt RLS).
//
// Fog-gate (#1791): output herfra må ALDRIG indeholde en skjult mekanik-konstant
// (vægte, sandsynligheder, rå komponent-værdier). Kun rangeringer, tælletal,
// allerede-offentlige gaps (sekunder vist i resultat-tabellen) og "fyrede/ikke-
// fyrede"-boolske afledninger. Se hver moment/tags kommentar for hvilket
// offentligt bevis der udløser den.
//
// Determinisme: ren funktion, ingen rng/Date/DB — samme input giver ALTID samme
// output. Momenterne er selv en afledning af allerede-seedede komponenter
// (raceSimulator.js), så "samme seed → samme tags" er automatisk opfyldt uden
// yderligere seeding her.
//
// To brug-mønstre af SAMME output (genbrug substratet — matcher #2355's krav):
//   1) "Beats" — etape-fortællingens byggesten (fx sprint_win, gc_takeover).
//   2) "Story-tags" — per-rytter badges, moment_key med 'tag_'-præfiks (fx
//      tag_jour_sans, tag_helper_sacrifice) — rider_ids har præcis ÉT element.
//
// Tærskler nedenfor er START-KANDIDATER (samme forbehold som narrativ-specens
// egne Tier 1-tærskler, §A2: "kalibreres mod en harness-kørsel FØR ship").
// Audit 15/7 (issue #2355-kommentar) pegede på et MINIMALT why-signal frem for
// det fulde bånd-lag — denne fil implementerer netop det minimale, kvalitative
// lag (ingen tal, ingen bånd-oversættelse af rå komponenter).

const SPRINT_GAP_S = 3;
const CLOSE_GAP_S = 10;
const FAVORITE_OFF_DAY_RANK = 15;
const HELPER_SHIFT_CAPTAIN_RANK = 5;
const HELPER_SHIFT_HELPER_MIN_COUNT = 2;
const HELPER_SHIFT_HELPER_OUTSIDE_RANK = 25;
const HELPER_SACRIFICE_TAG_RANK = 30;
const FORM_PEAK_THRESHOLD = 75;
const CRASH_RUINED_FAVORITE_TERRAIN_RANK = 5;
const CAPTAIN_ROLES = new Set(["captain", "sprint_captain"]);
const HELPER_ROLES = new Set(["helper", "hunter"]);

// Story-tag-nøgler — per-rytter badges (rider_ids har præcis ÉT element).
// Eksporteret så frontend kan skelne "tag"-momenter fra "beat"-momenter uden
// selv at kende hele vokabularet (samme mønster som DnfSection's kind-filter).
export const STORY_TAG_KEYS = Object.freeze([
  "tag_jour_sans",
  "tag_peak_day",
  "tag_perfect_peak",
  "tag_helper_sacrifice",
  "tag_outsider_win",
  "tag_favorite_collapse",
  "tag_crash_ruined",
]);

export function isStoryTagKey(momentKey) {
  return typeof momentKey === "string" && momentKey.startsWith("tag_");
}

function significanceFor(key, boost = 0) {
  const base = {
    sprint_win: 50, close_win: 50, solo_win: 55,
    breakaway_survived: 55, breakaway_caught: 35,
    team_day: 45, gc_takeover: 70, final_gc: 80,
    helper_shift: 60, favorite_off_day: 65, form_peak: 40,
    incident_time_loss: 40, incident_abandon: 55,
  }[key] ?? 30; // story-tags (tag_*) falder igennem til 30 — flavour, ikke overskrift
  return Math.max(0, Math.min(100, base + boost));
}

function push(list, { key, params, riderIds = [], teamIds = [], boost = 0 }) {
  list.push({
    moment_key: key,
    params,
    significance: significanceFor(key, boost),
    rider_ids: riderIds.filter(Boolean),
    team_ids: teamIds.filter(Boolean),
  });
}

// Terræn-rangering for feltet DENNE etape — "favoritten" er ren afledning af
// den samme terrain-komponent motoren allerede bruger til at vælge udbryder-
// kandidater (raceSimulator.js selectBreakawayBonuses) — offentligt bevisbart
// via at rytteren rent faktisk topper terrain i denne beregning, ikke en ny
// skjult konstant.
function terrainRanking(ranked) {
  return [...ranked]
    .filter((r) => Number.isFinite(r?.components?.terrain))
    .sort((a, b) => b.components.terrain - a.components.terrain || String(a.rider_id).localeCompare(String(b.rider_id)));
}

// Hvorfor endte en favorit uden for top-15? Går komponenterne igennem i FAST
// prioriteret rækkefølge (jour sans > uheld > hjælper-arbejde > uforklaret) —
// kun ÉN årsag rapporteres, den mest sandsynlige domiant forklaring, aldrig et
// tal. "uforklaret" er en ærlig, gyldig konklusion (ærlig-degraderings-reglen).
function dominantReason({ rider, incidentByRider, roleByRider }) {
  const c = rider.components || {};
  if (Number(c.jour_sans) !== 0 && Number.isFinite(c.jour_sans)) return "jour_sans";
  if (incidentByRider?.has(rider.rider_id)) return "incident";
  const role = roleByRider?.get(rider.rider_id);
  if (HELPER_ROLES.has(role) && Number(c.work_cost) < 0) return "helper_work";
  return "unexplained";
}

/**
 * Udled etape-momenter + story-tags fra ÉN allerede-simuleret etapes data.
 * Ren funktion — ingen DB/fs/rng. Kaldes fra raceRunner.js lige efter
 * simulateStage() (komponenterne er stadig i memory), samme mønster som S4's
 * rollIncidents-kald.
 *
 * @param {object} args
 * @param {number} args.stageNumber
 * @param {boolean} [args.isFinal=false]
 * @param {boolean} [args.isStageRace=false]
 * @param {Array<{rider_id, team_id, rank, stageGap, components}>} args.ranked  fra simulateStage
 * @param {Map<string,string>} [args.roleByRider]  rider_id → race_role (denne etapes resolved rolle)
 * @param {Map<string,number>} [args.formByRider]  rider_id → form-snapshot (0-100)
 * @param {Map<string,{in_breakaway:boolean, breakaway_caught:boolean}>} [args.breakawayStatus]
 * @param {Array<{rider_id, kind, outcome, time_loss_seconds}>} [args.incidentsForStage]
 * @param {Array<{rider_id, rank}>|null} [args.gc]  GC EFTER denne etape (kun etapeløb)
 * @param {string|null} [args.previousGcLeaderId]  GC-leder FØR denne etape (null på etape 1)
 * @returns {Array<{moment_key, params, significance, rider_ids, team_ids}>}
 */
export function extractStageMoments({
  stageNumber,
  isFinal = false,
  isStageRace = false,
  ranked = [],
  roleByRider = new Map(),
  formByRider = new Map(),
  breakawayStatus = new Map(),
  incidentsForStage = [],
  gc = null,
  previousGcLeaderId = null,
} = {}) {
  const moments = [];
  if (!ranked.length) return moments;

  const byRank = [...ranked].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const winner = byRank[0];
  const second = byRank[1];
  const incidentByRider = new Map((incidentsForStage || []).map((inc) => [inc.rider_id, inc]));

  // ── Tier 0: finish-orden, udbrud, hold, GC-skifte ────────────────────────
  if (winner) {
    const gap2 = second?.stageGap ?? null;
    if (gap2 != null) {
      const key = gap2 < SPRINT_GAP_S ? "sprint_win" : gap2 < CLOSE_GAP_S ? "close_win" : "solo_win";
      push(moments, { key, params: { riderId: winner.rider_id, gapSeconds: gap2 }, riderIds: [winner.rider_id], teamIds: [winner.team_id] });
    } else {
      push(moments, { key: "solo_win", params: { riderId: winner.rider_id, gapSeconds: null }, riderIds: [winner.rider_id], teamIds: [winner.team_id] });
    }

    const winnerBw = breakawayStatus.get(winner.rider_id);
    if (winnerBw?.in_breakaway && !winnerBw.breakaway_caught) {
      const breakawayCount = [...breakawayStatus.values()].filter((b) => b.in_breakaway).length;
      push(moments, { key: "breakaway_survived", params: { riderId: winner.rider_id, count: breakawayCount }, riderIds: [winner.rider_id] });
    } else if ([...breakawayStatus.values()].some((b) => b.breakaway_caught)) {
      const caughtCount = [...breakawayStatus.values()].filter((b) => b.breakaway_caught).length;
      push(moments, { key: "breakaway_caught", params: { count: caughtCount } });
    }
  }

  const top10 = byRank.slice(0, 10);
  const teamCounts = new Map();
  for (const r of top10) {
    if (r.team_id == null) continue;
    teamCounts.set(r.team_id, (teamCounts.get(r.team_id) || 0) + 1);
  }
  let bestTeam = null;
  for (const [teamId, count] of teamCounts) {
    if (count >= 2 && (!bestTeam || count > bestTeam.count)) bestTeam = { teamId, count };
  }
  if (bestTeam) {
    push(moments, { key: "team_day", params: { teamId: bestTeam.teamId, count: bestTeam.count }, teamIds: [bestTeam.teamId] });
  }

  if (isStageRace && gc?.length) {
    const newLeaderId = gc[0].rider_id;
    if (previousGcLeaderId && newLeaderId !== previousGcLeaderId) {
      push(moments, {
        key: "gc_takeover",
        params: { riderId: newLeaderId, previousLeaderId: previousGcLeaderId },
        riderIds: [newLeaderId, previousGcLeaderId],
        boost: 10,
      });
    }
    if (isFinal) {
      const top3 = gc.slice(0, 3);
      push(moments, {
        key: "final_gc",
        params: { riderIds: top3.map((g) => g.rider_id) },
        riderIds: top3.map((g) => g.rider_id),
        boost: 10,
      });
    }
  }

  // ── Tier 1: komponent-afledte momenter ───────────────────────────────────
  const terrainRanked = terrainRanking(ranked);
  const favorite = terrainRanked[0];

  if (favorite && favorite.rank > FAVORITE_OFF_DAY_RANK) {
    const reason = dominantReason({ rider: favorite, incidentByRider, roleByRider });
    push(moments, {
      key: "favorite_off_day",
      params: { riderId: favorite.rider_id, rank: favorite.rank, reason },
      riderIds: [favorite.rider_id],
      boost: reason !== "unexplained" ? 10 : 0,
    });
    if (reason === "jour_sans") {
      push(moments, { key: "tag_favorite_collapse", params: { riderId: favorite.rider_id, rank: favorite.rank }, riderIds: [favorite.rider_id] });
    }
  }

  if (winner && terrainRanked[0] && terrainRanked[0].rider_id !== winner.rider_id) {
    push(moments, { key: "tag_outsider_win", params: { riderId: winner.rider_id }, riderIds: [winner.rider_id] });
  }

  if (winner) {
    const winnerForm = formByRider.get(winner.rider_id);
    if (Number.isFinite(winnerForm) && winnerForm >= FORM_PEAK_THRESHOLD) {
      push(moments, { key: "form_peak", params: { riderId: winner.rider_id }, riderIds: [winner.rider_id] });
    }
  }

  // Hjælper-ofring: kaptajn i top-5 med ≥2 hjælpere fra SAMME hold uden for top-25,
  // og kaptajnens team-komponent viser hun/han faktisk modtog hjælp (>0, dvs.
  // hjælper-arbejdet lykkedes — ikke bare tilstede). Offentligt bevisbart via
  // rollerne (allerede synlige i StageRoleMatrix) + finish-positionerne.
  const byTeam = new Map();
  for (const r of ranked) {
    if (r.team_id == null) continue;
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push(r);
  }
  for (const [teamId, teamRiders] of byTeam) {
    const captain = teamRiders.find((r) => CAPTAIN_ROLES.has(roleByRider.get(r.rider_id)) && r.rank <= HELPER_SHIFT_CAPTAIN_RANK);
    if (!captain || !(Number(captain.components?.team) > 0)) continue;
    const helpers = teamRiders.filter((r) => HELPER_ROLES.has(roleByRider.get(r.rider_id)) && r.rank > HELPER_SHIFT_HELPER_OUTSIDE_RANK);
    if (helpers.length < HELPER_SHIFT_HELPER_MIN_COUNT) continue;
    push(moments, {
      key: "helper_shift",
      params: { captainId: captain.rider_id, helperIds: helpers.map((h) => h.rider_id), teamId },
      riderIds: [captain.rider_id, ...helpers.map((h) => h.rider_id)],
      teamIds: [teamId],
    });
    for (const h of helpers.filter((h) => h.rank > HELPER_SACRIFICE_TAG_RANK)) {
      push(moments, { key: "tag_helper_sacrifice", params: { riderId: h.rider_id, captainId: captain.rider_id, rank: h.rank }, riderIds: [h.rider_id], teamIds: [teamId] });
    }
  }

  // ── Story-tags uden Tier1-beat-modstykke ─────────────────────────────────
  for (const r of ranked) {
    const c = r.components || {};
    if (Number(c.jour_sans) !== 0 && Number.isFinite(c.jour_sans)) {
      push(moments, { key: "tag_jour_sans", params: { riderId: r.rider_id }, riderIds: [r.rider_id] });
    }
    if (Number(c.peak) > 0) {
      const key = r.rank === 1 ? "tag_perfect_peak" : "tag_peak_day";
      push(moments, { key, params: { riderId: r.rider_id }, riderIds: [r.rider_id] });
    }
  }

  // Uheld ramte en top-5-terrain-favorit → "ødelagt af styrt/mekanisk defekt",
  // ikke bare en generisk incident-linje (den fulde liste findes allerede i
  // race_incidents/DnfSection — dette er den NARRATIVE forklaring for hvorfor
  // en forventet topplacering udeblev).
  const favoritePool = new Set(terrainRanked.slice(0, CRASH_RUINED_FAVORITE_TERRAIN_RANK).map((r) => r.rider_id));
  for (const inc of incidentsForStage || []) {
    if (favoritePool.has(inc.rider_id)) {
      push(moments, { key: "tag_crash_ruined", params: { riderId: inc.rider_id, kind: inc.kind, outcome: inc.outcome }, riderIds: [inc.rider_id] });
    }
    if (inc.outcome === "abandon") {
      push(moments, { key: "incident_abandon", params: { riderId: inc.rider_id, kind: inc.kind }, riderIds: [inc.rider_id] });
    } else {
      push(moments, { key: "incident_time_loss", params: { riderId: inc.rider_id, kind: inc.kind, secondsLost: inc.time_loss_seconds ?? null }, riderIds: [inc.rider_id] });
    }
  }

  return moments;
}
