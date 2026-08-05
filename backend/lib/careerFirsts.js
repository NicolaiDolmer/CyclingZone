// Maiden Win Engine (#3398, bølge 1 af verdensklasse-planen #3395) — career-
// firsts-detektion ved race/stage-finalization: rytterens første professionelle
// sejr, første podium, første klassifikationstrøje, plus klub-milepæle (fx 50.
// sejr i klubfarver). Kaldt fra backend/lib/raceRunner.js (simulateRace +
// simulateStageByIndex) — SAMME sted persistIncidents/persistStageMoments
// kaldes, men UAFHÆNGIGT af race_engine_v3_scoring-flaget: detektionen læser
// kun de allerede-eksisterende resultatfelter (result_type/rank/rider_id/
// team_id) alle løb altid har, uanset v3.
//
// Eventmodel-beslutning (se database/2026-08-05-3398-maiden-win-engine.sql for
// den fulde begrundelse): `rider_career_events` med et GENERISK event_type —
// designet så #2490 (rytter-krøniken) kan genbruge SAMME tabel med sine egne
// event_type-værdier, ikke en konkurrerende paralleltabel.
//
// Idempotens (re-finalisering må ALDRIG duplikere): hvert event får en stabil
// `dedupe_key` (fx `rider:<id>:maiden_win`) — eksistens tjekkes FØR insert, og
// tabellens UNIQUE-constraint er sikkerhedsnettet ved samtidighed (insert-fejl
// 23505 behandles som "allerede registreret").
//
// "Prior"-tjek udelukker bevidst KUN denne finaliserings egne stage-numre
// (currentStageNumbers), IKKE hele løbet — et etapeløb finaliseres etape for
// etape (simulateStageByIndex), så en TIDLIGERE etapes ægte sejr i SAMME løb
// skal stadig tælle som "prior" når en SENERE etape i samme løb afvikles.
// Ekskluderes hele race_id (som #2355's moment-persist-mønster ville foreslå),
// ville rytterens egen tidligere etapesejr i samme grand tour usynliggøres, og
// en sen etapesejr ville fejlagtigt også blive registreret som "maiden win".
//
// Best-effort/graceful degradation: ALDRIG en throw der vælter finaliseringen
// (samme regel som persistStageMoments) — enhver fejl fanges pr. kandidat,
// logges + Sentry-captures, resten af kandidaterne fortsætter uanfægtet.
import { ageForSeason } from "./riderSeasonAge.js";
import { notifyTeamOwner } from "./notificationService.js";
import { captureException } from "./sentry.js";

export const CAREER_MILESTONE_TYPE = "career_milestone";

export const CAREER_EVENT_TYPES = Object.freeze({
  MAIDEN_WIN: "maiden_win",
  FIRST_PODIUM: "first_podium",
  FIRST_JERSEY: "first_jersey",
  CLUB_MILESTONE_WIN: "club_milestone_win",
});

const WIN_RESULT_TYPES = ["stage", "gc"];
const JERSEY_RESULT_TYPES = ["points", "mountain", "young"];
// Hver 25. sejr i klubfarver er en fejrbar milepæl (25., 50., 75., ...).
const CLUB_MILESTONE_STEP = 25;
// Bounded fetch til "har rytteren nogensinde tidligere ..."-tjek: en ægte
// debutant matcher kun DENNE afviklings egne række(r) (typisk 1-2); selv en
// dominant rytter i én afviklingsbatch (fx flere etapesejre + GC i samme
// simulateRace-kald for en hel grand tour) rammer sjældent 30. pagination-safe
// via .limit() (scripts/lint-pagination-guard.mjs).
const PRIOR_CHECK_LIMIT = 30;

const SIGNIFICANCE = Object.freeze({
  [CAREER_EVENT_TYPES.MAIDEN_WIN]: 90,
  [CAREER_EVENT_TYPES.FIRST_PODIUM]: 60,
  [CAREER_EVENT_TYPES.FIRST_JERSEY]: 65,
  [CAREER_EVENT_TYPES.CLUB_MILESTONE_WIN]: 70,
});

// ── Pure candidate extraction (ingen I/O) ───────────────────────────────────
// Mirrors raceNarrative.js's extractStageMoments-adskillelse: ren logik der kun
// kigger på DENNE afviklings resultRows, ingen DB, ingen "er dette en FØRSTE
// gang"-vurdering (det kræver historik — se detectCareerFirsts nedenfor).
export function pickCareerFirstCandidates({ resultRows = [] } = {}) {
  const wins = [];
  const podiums = [];
  const jerseys = [];
  const seenWin = new Set();
  const seenPodium = new Set();
  const seenJersey = new Set(); // key = `${riderId}|${resultType}`

  for (const row of resultRows) {
    if (!row?.rider_id || !Number.isFinite(row.rank)) continue;
    const { rider_id: riderId, team_id: teamId = null, rider_name: riderName = null, team_name: teamName = null, result_type: resultType, rank, stage_number: stageNumber = null } = row;

    if (WIN_RESULT_TYPES.includes(resultType) && rank === 1 && !seenWin.has(riderId)) {
      seenWin.add(riderId);
      wins.push({ riderId, teamId, riderName, teamName, resultType, stageNumber });
    }
    if (WIN_RESULT_TYPES.includes(resultType) && rank >= 1 && rank <= 3 && !seenPodium.has(riderId)) {
      seenPodium.add(riderId);
      podiums.push({ riderId, teamId, riderName, teamName, resultType, rank, stageNumber });
    }
    if (JERSEY_RESULT_TYPES.includes(resultType) && rank === 1) {
      const key = `${riderId}|${resultType}`;
      if (!seenJersey.has(key)) {
        seenJersey.add(key);
        jerseys.push({ riderId, teamId, riderName, teamName, resultType, stageNumber });
      }
    }
  }
  return { wins, podiums, jerseys };
}

// ── I/O-helpers ──────────────────────────────────────────────────────────────

async function riderHasPriorResult({ supabase, riderId, raceId, currentStageNumbers, maxRank }) {
  const { data, error } = await supabase
    .from("race_results")
    .select("race_id, stage_number")
    .eq("rider_id", riderId)
    .in("result_type", WIN_RESULT_TYPES)
    .lte("rank", maxRank)
    .limit(PRIOR_CHECK_LIMIT);
  if (error) throw error;
  const stageSet = new Set(currentStageNumbers);
  return (data || []).some((r) => r.race_id !== raceId || !stageSet.has(r.stage_number));
}

async function riderHasPriorJersey({ supabase, riderId, raceId, resultType, currentStageNumbers }) {
  const { data, error } = await supabase
    .from("race_results")
    .select("race_id, stage_number")
    .eq("rider_id", riderId)
    .eq("result_type", resultType)
    .eq("rank", 1)
    .limit(PRIOR_CHECK_LIMIT);
  if (error) throw error;
  const stageSet = new Set(currentStageNumbers);
  return (data || []).some((r) => r.race_id !== raceId || !stageSet.has(r.stage_number));
}

// Dokumenteret forenkling: ekskluderer HELE raceId (ikke kun denne batchs
// stage-numre, modsat de to ovenfor) — en COUNT (til forskel fra et bounded
// eksistens-tjek) bør ikke betale for at hente rækker for at filtrere i JS på
// et hold med hundredvis af sejre. Konsekvens: et etapeløbs klub-milepæl kan
// først detekteres et par etaper SENERE end den kronologisk "sande" etape (en
// tidligere etapes sejr i SAMME løb tælles ikke som "prior" før løbet er
// færdigfinaliseret) — aldrig en duplikat (dedupe_key er selve tærskel-tallet),
// aldrig forkert data, kun en forsinket detektion inden for ét og samme løb.
async function countTeamPriorWins({ supabase, teamId, raceId }) {
  const { count, error } = await supabase
    .from("race_results")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .in("result_type", WIN_RESULT_TYPES)
    .eq("rank", 1)
    .neq("race_id", raceId);
  if (error) throw error;
  return count ?? 0;
}

async function fetchRiderBirthdates({ supabase, riderIds }) {
  if (!riderIds.length) return new Map();
  // pagination-safe: bounded by this finalization's own candidate rider ids
  // (at most a race's start-field size, never near the 1000-row cap).
  const { data, error } = await supabase
    .from("riders")
    .select("id, birthdate")
    .in("id", riderIds)
    .limit(riderIds.length);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.id, r.birthdate ?? null]));
}

async function insertEventIfNew({ supabase, dedupeKey, row }) {
  const { data: existing, error: selErr } = await supabase
    .from("rider_career_events")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .limit(1);
  if (selErr) throw selErr;
  if (existing?.length) return { inserted: false };
  const { error: insErr } = await supabase.from("rider_career_events").insert(row);
  if (insErr) {
    if (insErr.code === "23505") return { inserted: false }; // unique_violation — sikkerhedsnet ved samtidighed
    throw insErr;
  }
  return { inserted: true };
}

// EN-first fallback-copy (#1068: ingen rå dansk i backend) — locale-aware
// rendering sker via titleCode/messageCode (#666-mønsteret, notificationService.js).
function buildNotificationCopy({ eventType, riderName, raceName, params }) {
  const rider = riderName || "Your rider";
  const race = raceName || "";
  switch (eventType) {
    case CAREER_EVENT_TYPES.MAIDEN_WIN:
      return {
        title: "Maiden victory",
        message: race ? `${rider} won their first professional race: ${race}.` : `${rider} won their first professional race.`,
        titleCode: "notif.careerMilestone.maidenWin.title",
        messageCode: "notif.careerMilestone.maidenWin.message",
        messageParams: { rider, race },
      };
    case CAREER_EVENT_TYPES.FIRST_PODIUM:
      return {
        title: "First podium",
        message: race ? `${rider} reached their first career podium: ${race}.` : `${rider} reached their first career podium.`,
        titleCode: "notif.careerMilestone.firstPodium.title",
        messageCode: "notif.careerMilestone.firstPodium.message",
        messageParams: { rider, race },
      };
    case CAREER_EVENT_TYPES.FIRST_JERSEY:
      return {
        title: "First classification jersey",
        message: race ? `${rider} won their first classification jersey: ${race}.` : `${rider} won their first classification jersey.`,
        titleCode: "notif.careerMilestone.firstJersey.title",
        messageCode: "notif.careerMilestone.firstJersey.message",
        messageParams: { rider, race },
      };
    case CAREER_EVENT_TYPES.CLUB_MILESTONE_WIN: {
      const count = params?.milestoneCount ?? null;
      return {
        title: "Club milestone",
        message: count ? `Your club just recorded win number ${count}, thanks to ${rider}.` : `Your club just hit a win milestone, thanks to ${rider}.`,
        titleCode: "notif.careerMilestone.clubMilestoneWin.title",
        messageCode: "notif.careerMilestone.clubMilestoneWin.message",
        messageParams: { rider, count },
      };
    }
    default:
      return { title: "Career milestone", message: rider, titleCode: null, messageCode: null, messageParams: {} };
  }
}

/**
 * Detektér + persistér career-firsts fra ÉN finaliserings resultRows, og send
 * en best-effort notifikation til den (menneskelige) team-owner.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {{id, name}} args.race
 * @param {Array<{rider_id, team_id, rider_name, team_name, result_type, rank, stage_number}>} args.resultRows
 *   DENNE finaliserings resultatrækker (samme rækker som skrives til race_results).
 * @param {Array<number>} args.stageNumbers  etape-numre DENNE finalisering dækker
 *   (spejler persistIncidents/persistStageMoments' stageNumbers-parameter).
 * @param {number|null} [args.seasonNumber]  til alders-udledning (ageForSeason).
 * @param {Function} [args.notify]  injectable (test) — default notifyTeamOwner.
 * @returns {Promise<{candidates:number, detected:number, delivered:number, deduped:number, failed:number}>}
 */
export async function detectCareerFirsts({
  supabase,
  race,
  resultRows,
  stageNumbers = [],
  seasonNumber = null,
  notify = notifyTeamOwner,
  now = new Date(),
}) {
  const stats = { candidates: 0, detected: 0, delivered: 0, deduped: 0, failed: 0 };
  if (!supabase?.from || !race?.id || !resultRows?.length) return stats;

  const currentStageNumbers = stageNumbers.length ? stageNumbers : [...new Set(resultRows.map((r) => r.stage_number))];

  let wins = [];
  let podiums = [];
  let jerseys = [];
  try {
    ({ wins, podiums, jerseys } = pickCareerFirstCandidates({ resultRows }));
  } catch (err) {
    console.error(`  ⚠️  career-firsts candidate extraction failed (race ${race.id}): ${err.message}`);
    captureException(err, { tags: { flow: "race-run", stage: "career-firsts-extract" }, raceId: race.id });
    return stats;
  }
  stats.candidates = wins.length + podiums.length + jerseys.length;
  if (!stats.candidates) return stats;

  const allRiderIds = [...new Set([...wins, ...podiums, ...jerseys].map((c) => c.riderId))];
  let birthdateById = new Map();
  try {
    birthdateById = await fetchRiderBirthdates({ supabase, riderIds: allRiderIds });
  } catch (err) {
    // best-effort: alder er en editorial flourish, ikke kernedata — manglende
    // fødselsdato degraderer til ingen alder vist, blokerer aldrig eventet.
    console.warn(`  ⚠️  career-firsts: rider birthdate lookup failed (race ${race.id}): ${err.message}`);
  }

  const raceName = race.name ?? null;
  // ALLE vindere i DENNE batch (ikke kun dem der reelt fik en NY maiden_win-
  // række) — en gen-finalisering af samme etape ville ellers finde
  // riderHasPriorResult(maxRank:1)=false for den redan-registrerede vinder
  // (deres egen række er netop ekskluderet af currentStageNumbers-scopingen,
  // se riderHasPriorResult), men newlyMaidenRiderIds ville være tom (insertet
  // blev deduplikeret), og podium-loopet ville så fejlagtigt indsætte en NY
  // first_podium-række for en vinder der aldrig havde brug for én. At vinde
  // ER podiet — udelad ALTID podium-behandling for enhver vinder i batchen,
  // uafhængigt af om deres maiden_win-insert lige er sket eller allerede fandtes.
  const winnerRiderIdsThisBatch = new Set(wins.map((w) => w.riderId));

  async function persistAndNotify({ eventType, riderId, teamId, riderName, teamName, resultType, stageNumber, dedupeKey, extraParams = {} }) {
    const age = ageForSeason(birthdateById.get(riderId) ?? null, seasonNumber);
    const params = { raceName, resultType, stageNumber, age, ...extraParams };
    const row = {
      rider_id: riderId,
      team_id: teamId,
      event_type: eventType,
      race_id: race.id,
      season_number: seasonNumber,
      rider_name: riderName,
      team_name: teamName,
      params,
      significance: SIGNIFICANCE[eventType] ?? 50,
      dedupe_key: dedupeKey,
    };
    const { inserted } = await insertEventIfNew({ supabase, dedupeKey, row });
    if (!inserted) return false;
    stats.detected += 1;

    if (teamId) {
      const copy = buildNotificationCopy({ eventType, riderName, raceName, params });
      try {
        const res = await notify({
          supabase,
          teamId,
          type: CAREER_MILESTONE_TYPE,
          title: copy.title,
          message: copy.message,
          relatedId: race.id,
          metadata: {
            raceId: race.id,
            riderId,
            eventType,
            titleCode: copy.titleCode,
            titleParams: {},
            messageCode: copy.messageCode,
            messageParams: copy.messageParams,
          },
          now,
        });
        if (res?.delivered) stats.delivered += 1;
        else if (res?.deduped) stats.deduped += 1;
      } catch (err) {
        stats.failed += 1;
        console.error(`  ⚠️  career-firsts notification failed (${eventType}, rider ${riderId}): ${err.message}`);
        captureException(err, { tags: { flow: "race-run", stage: "career-firsts-notify" }, raceId: race.id, riderId });
      }
    }
    return true;
  }

  for (const w of wins) {
    try {
      const already = await riderHasPriorResult({ supabase, riderId: w.riderId, raceId: race.id, currentStageNumbers, maxRank: 1 });
      if (already) continue;
      await persistAndNotify({
        eventType: CAREER_EVENT_TYPES.MAIDEN_WIN,
        riderId: w.riderId, teamId: w.teamId, riderName: w.riderName, teamName: w.teamName,
        resultType: w.resultType, stageNumber: w.stageNumber,
        dedupeKey: `rider:${w.riderId}:maiden_win`,
      });
    } catch (err) {
      stats.failed += 1;
      console.error(`  ⚠️  career-firsts maiden_win detection failed (rider ${w.riderId}): ${err.message}`);
      captureException(err, { tags: { flow: "race-run", stage: "career-firsts-maiden-win" }, raceId: race.id, riderId: w.riderId });
    }
  }

  for (const p of podiums) {
    // At vinde ER podiet — enhver vinder i DENNE batch udelades altid fra
    // "første podium" (se winnerRiderIdsThisBatch ovenfor for hvorfor dette
    // IKKE kan begrænses til "kun nyligt-indsatte maiden_win"-rytter).
    if (winnerRiderIdsThisBatch.has(p.riderId)) continue;
    try {
      const already = await riderHasPriorResult({ supabase, riderId: p.riderId, raceId: race.id, currentStageNumbers, maxRank: 3 });
      if (already) continue;
      await persistAndNotify({
        eventType: CAREER_EVENT_TYPES.FIRST_PODIUM,
        riderId: p.riderId, teamId: p.teamId, riderName: p.riderName, teamName: p.teamName,
        resultType: p.resultType, stageNumber: p.stageNumber,
        dedupeKey: `rider:${p.riderId}:first_podium`,
        extraParams: { rank: p.rank },
      });
    } catch (err) {
      stats.failed += 1;
      console.error(`  ⚠️  career-firsts first_podium detection failed (rider ${p.riderId}): ${err.message}`);
      captureException(err, { tags: { flow: "race-run", stage: "career-firsts-first-podium" }, raceId: race.id, riderId: p.riderId });
    }
  }

  for (const j of jerseys) {
    try {
      const already = await riderHasPriorJersey({ supabase, riderId: j.riderId, raceId: race.id, resultType: j.resultType, currentStageNumbers });
      if (already) continue;
      await persistAndNotify({
        eventType: CAREER_EVENT_TYPES.FIRST_JERSEY,
        riderId: j.riderId, teamId: j.teamId, riderName: j.riderName, teamName: j.teamName,
        resultType: j.resultType, stageNumber: j.stageNumber,
        dedupeKey: `rider:${j.riderId}:first_jersey:${j.resultType}`,
        extraParams: { classification: j.resultType },
      });
    } catch (err) {
      stats.failed += 1;
      console.error(`  ⚠️  career-firsts first_jersey detection failed (rider ${j.riderId}): ${err.message}`);
      captureException(err, { tags: { flow: "race-run", stage: "career-firsts-first-jersey" }, raceId: race.id, riderId: j.riderId });
    }
  }

  // Klub-milepæle: hver 25. sejr NOGENSINDE i klubfarver (team_id = holdet
  // rytteren kørte for VED sejren). Rækkefølge inden for teamWins følger
  // resultRows' egen rækkefølge (deterministisk, ingen sortering påkrævet —
  // rækkefølgen inden for én batch påvirker kun HVEM af flere samtidige
  // sejre der krediteres milepælen, aldrig OM den detekteres).
  const teamsInOrder = [];
  const teamsSeen = new Set();
  for (const w of wins) {
    if (!w.teamId || teamsSeen.has(w.teamId)) continue;
    teamsSeen.add(w.teamId);
    teamsInOrder.push(w.teamId);
  }
  for (const teamId of teamsInOrder) {
    try {
      let priorCount = await countTeamPriorWins({ supabase, teamId, raceId: race.id });
      const teamWins = wins.filter((w) => w.teamId === teamId);
      for (const w of teamWins) {
        priorCount += 1;
        if (priorCount % CLUB_MILESTONE_STEP !== 0) continue;
        await persistAndNotify({
          eventType: CAREER_EVENT_TYPES.CLUB_MILESTONE_WIN,
          riderId: w.riderId, teamId, riderName: w.riderName, teamName: w.teamName,
          resultType: w.resultType, stageNumber: w.stageNumber,
          dedupeKey: `team:${teamId}:club_milestone_win:${priorCount}`,
          extraParams: { milestoneCount: priorCount },
        });
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`  ⚠️  career-firsts club_milestone_win detection failed (team ${teamId}): ${err.message}`);
      captureException(err, { tags: { flow: "race-run", stage: "career-firsts-club-milestone" }, raceId: race.id, teamId });
    }
  }

  return stats;
}
