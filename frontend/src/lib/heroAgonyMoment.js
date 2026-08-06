// Hero & Agony (#3397, epic #3395 bølge 1, plan-doc forslag 4) — ét personligt
// moment-kort pr. hold pr. etape, valgt fra ALLEREDE PERSISTEREDE rækker:
// race_stage_moments (backend/lib/raceNarrative.js, S6/#2355) + race_results
// (per-rytter felter: rank, in_breakaway, breakaway_caught). Ren, deterministisk
// klient-side udvælgelse — INGEN nye engine-writes, ingen ny fortolkning af
// spilmekanik, ingen rng/Date (samme determinisme-invariant som raceReport.js).
//
// Arkitektur-valg (dokumenteret i PR-body): udvælgelsen sker HELT client-side
// over data DashboardPage/hooket allerede henter (3 bounded queries, se
// hooks/useHeroAgonyMoment.js) — intet nyt backend-endpoint. race_stage_moments
// for ÉN etape er en lille rækkemængde (ikke pagineringsbehov), og
// race_results for ÉN (race_id, stage_number) er bevisligt <1000 rækker
// (samme "pagination-safe" begrundelse som backend/lib/notificationService.js's
// defaultFetchStageParticipants — verificeret max 192 rækker repo-bredt,
// #3331-audit 2026-08-05).
//
// ── Drama-score-kriterier (AC: "agony vægtes lige så højt som triumf") ──────
// DRAMA_SCORE nedenfor er en NY, uafhængig vægtning — IKKE genbrug af
// raceNarrative.js's significanceFor() (den er tunet til FELT-brede rubrik-valg,
// ikke til at sammenligne "min egen agoni" mod "min egen triumf"). Eksplicitte
// design-valg:
//   - final_gc (100) — løbets største historie, uanset side (podium er podium).
//   - gc_takeover (90) — SAMME score uanset retning: at min rytter OVERTAGER
//     føringen og at min rytter TABER føringen er samme begivenhed set fra to
//     vinkler, og skal veje lige tungt.
//   - Etapesejr (85) er BEVIDST lig incident_abandon (85): din rytters sejr og
//     din rytters exit fra løbet er samme dramatiske vægtklasse.
//   - tag_helper_sacrifice (72) scorer HØJERE end det neutrale helper_shift
//     (68) — den tabende hjælpers historie ("ofrede sin egen chance") ER den
//     historie AC'en efterspørger, ikke bare en fodnote til kaptajnens dag.
//   - tag_aggression_no_cost (60) modellerer PRÆCIS issuets eget eksempel
//     ("ledte udbruddet ... hentet ... fra stregen") — et nederlag der rent
//     faktisk var gratis, men stadig dramatisk.
//   - breakaway_effort (50) er en SYNTETISERET kandidat (ikke en race_stage_
//     moments-række) — bygget direkte af race_results.in_breakaway/
//     breakaway_caught for MIN rytter, for de tilfælde hvor
//     tag_aggression_no_cost ikke udløses (typematch-tærsklen i
//     raceNarrative.js), så "var i udbruddet, blev hentet" altid har en historie.
//   - plain_result (5) er gulvet: et rent pladsnummer uden nogen historie
//     ("en kedelig 14. plads") — ALTID til stede hvis holdet startede etapen,
//     men kan aldrig vinde over en ægte moment-kandidat.
//
// Ingen af tallene er hentet fra en skjult motor-konstant (fog-gate, #1791) —
// de styrer udelukkende HVILKEN allerede-offentlig sætning der vises, aldrig
// selve spillets udfald.
export const DRAMA_SCORE = Object.freeze({
  final_gc: 100,
  gc_takeover_won: 90,
  gc_takeover_lost: 90,
  sprint_win: 85,
  close_win: 85,
  solo_win: 85,
  breakaway_survived: 85,
  incident_abandon: 85,
  favorite_off_day: 75,
  tag_crash_ruined: 75,
  tag_helper_sacrifice: 72,
  helper_shift: 68,
  tag_aggression_no_cost: 60,
  incident_time_loss: 55,
  team_day: 55,
  breakaway_effort: 50, // syntetiseret — ikke en race_stage_moments-nøgle
  tag_outsider_win: 50,
  tag_jour_sans: 45,
  tag_perfect_peak: 45,
  tag_peak_day: 40,
  tag_gave_everything: 35,
  form_peak: 35,
  tag_saved_effort: 30,
  plain_result: 5, // syntetiseret fallback-gulv
});

// tag_favorite_collapse udelades BEVIDST som egen kandidat: raceNarrative.js
// pusher den KUN sammen med favorite_off_day (samme riderId, samme reason) når
// reason !== "unexplained" — favorite_off_day dækker allerede præcis samme
// begivenhed med MERE information (den faktiske rank), så et separat
// tag_favorite_collapse-kort ville bare fortælle den samme historie to gange.

/**
 * rider_id → { teamId, riderName } for ÉN (race_id, stage_number) — bygget af
 * race_results' 'stage'-rækker (findes altid for enhver starter, i modsætning
 * til gc/points/mountain/team-aggregatrækkerne). rider_name er den
 * DENORMALISEREDE kolonne race_results allerede bærer — intet riders-join
 * nødvendigt (samme minimal-snit-begrundelse som notificationService.js).
 *
 * @param {Array<{rider_id, team_id, rider_name, result_type}>} stageResultRows
 * @returns {Map<string, {teamId: string|null, riderName: string|null}>}
 */
export function buildRosterMap(stageResultRows) {
  const map = new Map();
  for (const row of stageResultRows || []) {
    if ((row.result_type ?? "stage") !== "stage" || !row.rider_id) continue;
    map.set(row.rider_id, { teamId: row.team_id ?? null, riderName: row.rider_name ?? null });
  }
  return map;
}

function push(list, kind, tone, { riderId = null, riderName = null, teamId = null, teamName = null, params = {} } = {}) {
  const dramaScore = DRAMA_SCORE[kind];
  if (dramaScore == null) return; // ukendt/fremtidig moment_key — degradér ærligt, aldrig kast
  list.push({ kind, tone, dramaScore, riderId, riderName, teamId, teamName, params });
}

/**
 * Byg ALLE kandidater for MIT hold for ÉN etape — moments-baserede + de to
 * race_results-syntetiserede (breakaway_effort, plain_result). Ren funktion,
 * ingen fetch/rng/Date.
 *
 * @param {object} args
 * @param {Array} args.moments  race_stage_moments-rækker for DENNE etape (allerede filtreret til stage_number).
 * @param {Array} args.stageResultRows  race_results-rækker for DENNE (race_id, stage_number), alle result_type.
 * @param {string} args.myTeamId
 * @param {string} [args.myTeamName]  bruges kun til team_day (moments bærer intet team_name).
 * @returns {Array<{kind, tone, dramaScore, riderId, riderName, teamId, teamName, params}>}
 */
export function buildHeroAgonyCandidates({ moments = [], stageResultRows = [], myTeamId, myTeamName = null } = {}) {
  const list = [];
  if (!myTeamId) return list;
  const roster = buildRosterMap(stageResultRows);
  const mine = (riderId) => riderId != null && roster.get(riderId)?.teamId === myTeamId;
  const nameOf = (riderId) => roster.get(riderId)?.riderName ?? null;

  for (const m of moments || []) {
    const p = m.params || {};
    switch (m.moment_key) {
      case "sprint_win":
      case "close_win":
      case "solo_win":
      case "breakaway_survived": {
        const riderId = m.rider_ids?.[0] ?? p.riderId ?? null;
        if (mine(riderId)) {
          push(list, m.moment_key, "triumph", {
            riderId, riderName: nameOf(riderId),
            params: { gapSeconds: p.gapSeconds ?? null, count: p.count ?? null },
          });
        }
        break;
      }
      case "gc_takeover": {
        const newLeaderId = p.riderId ?? null;
        const prevLeaderId = p.previousLeaderId ?? null;
        if (mine(newLeaderId)) {
          push(list, "gc_takeover_won", "triumph", {
            riderId: newLeaderId, riderName: nameOf(newLeaderId),
            params: { previousLeaderName: nameOf(prevLeaderId) },
          });
        } else if (mine(prevLeaderId)) {
          push(list, "gc_takeover_lost", "agony", {
            riderId: prevLeaderId, riderName: nameOf(prevLeaderId),
            params: { newLeaderName: nameOf(newLeaderId) },
          });
        }
        break;
      }
      case "final_gc": {
        const podium = p.riderIds || m.rider_ids || [];
        const idx = podium.findIndex((rid) => mine(rid));
        if (idx !== -1) {
          const riderId = podium[idx];
          push(list, "final_gc", "triumph", {
            riderId, riderName: nameOf(riderId),
            params: { rank: idx + 1 },
          });
        }
        break;
      }
      case "favorite_off_day": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) {
          push(list, "favorite_off_day", "agony", {
            riderId, riderName: nameOf(riderId),
            params: { rank: p.rank ?? null, reason: p.reason ?? "unexplained" },
          });
        }
        break;
      }
      case "helper_shift": {
        if ((m.team_ids || []).includes(myTeamId)) {
          const captainId = p.captainId ?? null;
          push(list, "helper_shift", "triumph", {
            riderId: captainId, riderName: nameOf(captainId), teamId: myTeamId,
            params: { count: p.helperIds?.length ?? 0, captainName: nameOf(captainId) },
          });
        }
        break;
      }
      case "tag_helper_sacrifice": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) {
          push(list, "tag_helper_sacrifice", "agony", {
            riderId, riderName: nameOf(riderId),
            params: { rank: p.rank ?? null, captainName: nameOf(p.captainId) },
          });
        }
        break;
      }
      case "form_peak": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) push(list, "form_peak", "triumph", { riderId, riderName: nameOf(riderId) });
        break;
      }
      case "tag_perfect_peak":
      case "tag_peak_day": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) push(list, m.moment_key, "triumph", { riderId, riderName: nameOf(riderId) });
        break;
      }
      case "tag_jour_sans": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) push(list, "tag_jour_sans", "agony", { riderId, riderName: nameOf(riderId) });
        break;
      }
      case "tag_crash_ruined": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) {
          push(list, "tag_crash_ruined", "agony", {
            riderId, riderName: nameOf(riderId), params: { kind: p.kind ?? null },
          });
        }
        break;
      }
      case "incident_abandon": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) {
          push(list, "incident_abandon", "agony", {
            riderId, riderName: nameOf(riderId), params: { kind: p.kind ?? null },
          });
        }
        break;
      }
      case "incident_time_loss": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) {
          push(list, "incident_time_loss", "agony", {
            riderId, riderName: nameOf(riderId),
            params: { kind: p.kind ?? null, seconds: p.secondsLost ?? null },
          });
        }
        break;
      }
      case "tag_outsider_win": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) push(list, "tag_outsider_win", "triumph", { riderId, riderName: nameOf(riderId) });
        break;
      }
      case "tag_aggression_no_cost": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) push(list, "tag_aggression_no_cost", "agony", { riderId, riderName: nameOf(riderId) });
        break;
      }
      case "tag_saved_effort": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) push(list, "tag_saved_effort", "neutral", { riderId, riderName: nameOf(riderId) });
        break;
      }
      case "tag_gave_everything": {
        const riderId = p.riderId ?? null;
        if (mine(riderId)) push(list, "tag_gave_everything", "triumph", { riderId, riderName: nameOf(riderId) });
        break;
      }
      case "team_day": {
        if ((m.team_ids || []).includes(myTeamId)) {
          push(list, "team_day", "triumph", {
            teamId: myTeamId, teamName: myTeamName,
            params: { count: p.count ?? null },
          });
        }
        break;
      }
      // tag_favorite_collapse: se begrundelse ovenfor (dubleret af favorite_off_day).
      // breakaway_caught (feltbred, ingen rider_ids): dækkes i stedet af
      // breakaway_effort nedenfor, syntetiseret direkte fra race_results.
      default:
        break; // ukendt/fremtidig nøgle — ignorér, aldrig kast
    }
  }

  // ── Syntetiserede kandidater fra race_results (ikke fra moments-tabellen) ──
  let bestRow = null;
  for (const row of stageResultRows || []) {
    if ((row.result_type ?? "stage") !== "stage") continue;
    if (row.team_id !== myTeamId) continue;
    if (!bestRow || (row.rank ?? Infinity) < (bestRow.rank ?? Infinity)) bestRow = row;

    // "Ledte udbruddet, hentet før stregen" — kun hvis tag_aggression_no_cost
    // ikke allerede fortæller PRÆCIS samme rytters historie (typematch-tjekket
    // i raceNarrative.js kan udelade en rytter dette gælder for).
    if (row.in_breakaway && row.breakaway_caught) {
      const alreadyCovered = list.some((c) => c.kind === "tag_aggression_no_cost" && c.riderId === row.rider_id);
      if (!alreadyCovered) {
        push(list, "breakaway_effort", "agony", {
          riderId: row.rider_id, riderName: row.rider_name ?? null,
        });
      }
    }
  }
  // Gulv-kandidat: kun hvis holdet rent faktisk havde en starter denne etape.
  if (bestRow) {
    push(list, "plain_result", "neutral", {
      riderId: bestRow.rider_id, riderName: bestRow.rider_name ?? null,
      params: { rank: bestRow.rank ?? null },
    });
  }

  return list;
}

/**
 * Deterministisk valg af ÉT kort blandt kandidaterne: højeste dramaScore
 * vinder; uafgjort brydes af rider_id (fallback team_id) — samme værdi giver
 * ALTID samme kort, uafhængigt af kandidat-arrayets iterationsrækkefølge.
 *
 * @param {Array} candidates  fra buildHeroAgonyCandidates
 * @returns {object|null}
 */
export function selectHeroAgonyMoment(candidates) {
  if (!candidates?.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (b.dramaScore !== a.dramaScore) return b.dramaScore - a.dramaScore;
    return String(a.riderId ?? a.teamId ?? "").localeCompare(String(b.riderId ?? b.teamId ?? ""));
  });
  return sorted[0];
}

/**
 * Bekvemmeligheds-wrapper: bygger kandidater + vælger ÉT kort i ét kald.
 * @returns {object|null}
 */
export function buildHeroAgonyMoment({ moments, stageResultRows, myTeamId, myTeamName } = {}) {
  const candidates = buildHeroAgonyCandidates({ moments, stageResultRows, myTeamId, myTeamName });
  return selectHeroAgonyMoment(candidates);
}
