// #3396 (bølge 1 — "The Final Kilometre"): deterministisk afledning af en 90s
// finale-afspilning af de sidste ~3 km, UDELUKKENDE fra allerede-persisterede
// race_results-rækker (finish_time-gab, in_breakaway/breakaway_caught) +
// race_stage_moments (vind-type). Ren afledning, samme mønster som
// raceRecap.js/raceReport.js — ingen ny sim-mekanik, ingen engine-writes.
//
// Determinisme: outputtet (rækkefølge, ankomst-tidspunkter inde i vinduet,
// badges) er en REN funktion af input-rækkerne — samme rækker giver altid
// samme tidslinje. Selve wall-clock-afspilningen (elapsed ms siden "play")
// styres af komponenten, ikke her.
import { resultEntity } from "./raceResultEntity.js";
import { parseGapSeconds } from "./raceRecap.js";

export { parseGapSeconds };

export const TOTAL_DURATION_MS = 90_000;
// Nedtællingen ("X km — Y sec") løber 0..COUNTDOWN_MS og rammer 0 m/0 sek
// PRÆCIST når vinderen krydser stregen. Resten af budgettet (ARRIVALS_MS)
// er til feltet der klikker ind bagefter + et kort hold på slutbilledet.
export const COUNTDOWN_MS = 80_000;
export const ARRIVALS_MS = TOTAL_DURATION_MS - COUNTDOWN_MS;
export const COUNTDOWN_START_M = 3000;
// "Fotofinish" — samme sproglige tærskel som cykling reelt bruger (afgørelser
// under ét sekund kræver målfoto).
export const PHOTO_FINISH_THRESHOLD_S = 1;
// Kun de første N ryttere animeres enkeltvis (dramaturgisk pointe + performance);
// resten opsummeres i én linje ("+N flere i mål").
export const MAX_ANIMATED_RIDERS = 8;
// Samme 2-tier-tærskel som raceRecap.js's SOLO_THRESHOLD_S — bruges KUN som
// fallback når race_stage_moments ikke findes for etapen (ældre/PCM-løb).
const SOLO_THRESHOLD_S = 10;
const STEP_MIN_MS = 450;
const STEP_MAX_MS = 1800;

const WIN_MOMENT_KEYS = new Set(["sprint_win", "close_win", "solo_win"]);

// Kompressions-funktion: reelt gab (sekunder) mellem to på hinanden følgende
// ryttere → afspilnings-ms mellem deres "klik ind i mål"-øjeblikke. Ukendt gap
// (ældre løb uden finish_time) falder tilbage til en jævn, læsbar takt. Gab
// under fotofinish-tærsklen komprimeres til et næsten samtidigt dobbelt-klik.
function stepForGapDiff(diffSeconds) {
  if (diffSeconds == null) return STEP_MIN_MS * 1.3;
  if (diffSeconds < PHOTO_FINISH_THRESHOLD_S) return STEP_MIN_MS * 0.5;
  return Math.min(STEP_MAX_MS, STEP_MIN_MS + Math.sqrt(diffSeconds) * 260);
}

// Samme udbruds-narrativ som raceRecap.js (survived/caught), her som en
// struktureret beat i stedet for en færdig sætning — komponenten interpolerer.
function breakawayBeatFor(finishers) {
  const inBreak = finishers.filter((r) => r.in_breakaway);
  if (!inBreak.length) return null;
  const first = finishers[0];
  if (first.in_breakaway && !first.breakaway_caught) {
    return { key: "breakawaySurvived", count: inBreak.length };
  }
  if (finishers.some((r) => r.breakaway_caught)) {
    return { key: "breakawayCaught", count: inBreak.length };
  }
  return null;
}

function winTypeFor(finishers, moments, stageNumber) {
  const moment = (moments || []).find(
    (m) => (m.stage_number ?? 1) === stageNumber && WIN_MOMENT_KEYS.has(m.moment_key)
  );
  if (moment) return moment.moment_key;

  // Fallback uden moments (S6-tabellen ikke migreret/tom for ældre løb):
  // samme 2-tier-grænse som raceRecap.js's soloWin/sprintWin.
  const second = finishers[1];
  const gap = second ? parseGapSeconds(second.finish_time) : null;
  if (gap == null) return null;
  return gap >= SOLO_THRESHOLD_S ? "solo_win" : "sprint_win";
}

/**
 * Bygger den deterministiske afspilnings-plan for ét løbs/etapes finale.
 * rows = de "stage"-resultat-rækker (rytter-niveau) for DEN etape/dag der skal
 * dramatiseres — RaceDetailPage sender allerede-hentede race_results uden nyt kald.
 */
export function buildFinalKilometrePlayback({ rows, moments = [], stageNumber = null } = {}) {
  const finishers = (rows || [])
    .filter((r) => resultEntity(r).kind === "rider")
    .slice()
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  if (finishers.length < 2) return { available: false };

  const withGaps = finishers.map((r, i) => ({
    row: r,
    entity: resultEntity(r),
    cumGap: parseGapSeconds(r.finish_time),
    rank: r.rank ?? i + 1,
  }));

  const maxAnimated = Math.min(withGaps.length, MAX_ANIMATED_RIDERS);

  // Trin 1: rå (ukomprimerede) skridt mellem hver ankomst.
  const rawSteps = [];
  for (let i = 1; i < maxAnimated; i++) {
    const diff =
      withGaps[i].cumGap != null && withGaps[i - 1].cumGap != null
        ? Math.max(0, withGaps[i].cumGap - withGaps[i - 1].cumGap)
        : null;
    rawSteps.push(diff);
  }
  const rawStepsMs = rawSteps.map(stepForGapDiff);
  const totalRawMs = rawStepsMs.reduce((a, b) => a + b, 0);
  // Trin 2: skalér proportionalt ned hvis feltet ikke kan nå at klikke ind
  // inden for ARRIVALS_MS — bevarer den RELATIVE rytme frem for at klippe halen.
  const scale = totalRawMs > ARRIVALS_MS && totalRawMs > 0 ? ARRIVALS_MS / totalRawMs : 1;

  const riders = [];
  let atMs = 0;
  for (let i = 0; i < maxAnimated; i++) {
    const cur = withGaps[i];
    if (i > 0) atMs += rawStepsMs[i - 1] * scale;
    const prevGap = i > 0 ? withGaps[i - 1].cumGap : null;
    const photoFinish =
      i > 0 && cur.cumGap != null && prevGap != null && cur.cumGap - prevGap < PHOTO_FINISH_THRESHOLD_S;
    riders.push({
      id: cur.row.id,
      riderId: cur.entity.linkId,
      rank: cur.rank,
      name: cur.entity.name || "—",
      nationality: cur.entity.nationality,
      teamId: cur.row.rider?.team?.id ?? cur.row.team_id ?? null,
      teamName: cur.row.rider?.team?.name ?? cur.row.team_name ?? null,
      gapLabel: cur.row.finish_time || null,
      atMs: Math.round(Math.min(atMs, ARRIVALS_MS)),
      photoFinish,
    });
  }

  const winnerGap = withGaps[1]?.cumGap ?? null;

  return {
    available: true,
    stageNumber,
    totalDurationMs: TOTAL_DURATION_MS,
    countdownMs: COUNTDOWN_MS,
    arrivalsMs: ARRIVALS_MS,
    countdownStartM: COUNTDOWN_START_M,
    winType: winTypeFor(finishers, moments, stageNumber),
    photoFinishWin: winnerGap != null && winnerGap < PHOTO_FINISH_THRESHOLD_S,
    breakawayBeat: breakawayBeatFor(finishers),
    riders,
    overflowCount: withGaps.length - maxAnimated,
    totalFinishers: withGaps.length,
  };
}

// Nedtællings-tal (distance + "sekunder til mål") ved et givent elapsed-ms
// inde i COUNTDOWN-fasen — ren funktion, deles mellem animeret og evt. test.
export function countdownAt(elapsedMs, countdownMs = COUNTDOWN_MS, startM = COUNTDOWN_START_M) {
  const clamped = Math.max(0, Math.min(elapsedMs, countdownMs));
  const frac = countdownMs > 0 ? clamped / countdownMs : 1;
  return {
    distanceM: Math.max(0, Math.round((1 - frac) * startM)),
    secondsToGo: Math.max(0, Math.ceil((1 - frac) * (countdownMs / 1000))),
  };
}
