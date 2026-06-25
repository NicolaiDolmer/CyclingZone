/**
 * Frontend-only board helpers.
 *
 * Focus labels moved to the `board` i18n namespace under `focus.*` (Refs #484).
 */

export function getPlanDuration(planType) {
  return { "1yr": 1, "3yr": 3, "5yr": 5 }[planType] ?? 1;
}

/**
 * #1451 · Trend-pil fra det seneste løbs-event (in-season, modsat den
 * sæson-slut-baserede getSatisfactionTrend i BoardPage). Returnerer null når
 * ingen events. Glyfferne/farverne matcher getSatisfactionTrend.
 */
export function getEventSatisfactionTrend(events) {
  if (!events?.length) return null;
  const latest = events.reduce((a, b) =>
    (b.created_at ?? "") > (a.created_at ?? "") ? b : a);
  const delta = latest?.satisfaction_delta ?? 0;
  if (delta > 0) return { glyph: "▲", color: "text-cz-success", key: "up", delta };
  if (delta < 0) return { glyph: "▼", color: "text-cz-danger", key: "down", delta };
  return { glyph: "→", color: "text-cz-3", key: "flat", delta: 0 };
}

/**
 * #1830 · Board-wide tilfredshed — ÉN delt kilde for både Dashboard-kortet og
 * Bestyrelse-sidens drivers-panel, så de aldrig kan divergere (fx 65% vs 67%).
 *
 * En manager kan have flere aktive planer (1/3/5-år), hver med sin egen
 * `board.satisfaction`. Den board-brede værdi er gennemsnittet på tværs af de
 * planer der findes, afrundet. Tager `plans`-mappet ({ "1yr", "3yr", "5yr" })
 * fra GET /api/board/status. Returnerer null når ingen plan har et tal (fx
 * sæson-1 baseline-fase), så kaldersiden kan skjule visningen.
 *
 * @param {object} plans  { "1yr"?: planData, "3yr"?: planData, "5yr"?: planData }
 * @returns {number|null} Afrundet gennemsnitlig tilfredshed (0-100), eller null.
 */
export function computeOverallBoardSatisfaction(plans) {
  const sats = Object.values(plans || {})
    .map((p) => p?.board?.satisfaction)
    .filter((s) => typeof s === "number");
  if (!sats.length) return null;
  return Math.round(sats.reduce((a, b) => a + b, 0) / sats.length);
}

export function satisfactionToModifier(satisfaction) {
  if (satisfaction >= 80) return 1.20;
  if (satisfaction >= 60) return 1.10;
  if (satisfaction >= 40) return 1.00;
  if (satisfaction >= 20) return 0.90;
  return 0.80;
}

/**
 * #55 · Afgør om et bestyrelses-mål er opnået.
 *
 * Bestyrelsens egen evaluering (`outlook.goal_evaluations[i]`) er sandheden:
 * backend leverer et autoritativt `met`-flag (fuld sæson-slut-regel,
 * `evaluateGoal` med fuldt mål) der dækker ALLE 14 måltyper — inkl. de 7 nye
 * S-02d-typer (signature_rider, relative_rank, monument_podium, jersey_wins,
 * profitable_transfers, u25_development_delta, domestic_dominance) som den
 * lokale fallback ikke kender og før faldt til `default:false`, hvilket
 * undertalte opnåede mål i header-tælleren + top-3-ikonerne.
 *
 * VIGTIGT: brug `met`, ikke `status`. `status === "ahead"` pro-rater målet
 * midt-i-plan for cumulative/multi-year-typer og ville markere et mål som
 * opnået på "on pace" frem for "fuldt nået" → over-tælling på 3yr/5yr-planer.
 *
 * Fallbacken (kun de 8 legacy-typer) bruges udelukkende når der ingen
 * backend-evaluering er — fx hvis `outlook` mangler fordi boardet endnu ikke
 * er evalueret. For de nye typer kan fallbacken ikke afgøre noget og returnerer
 * `false`, hvilket er det sikre svar uden evaluering.
 *
 * @param {object} goal       Mål-objekt fra board.current_goals.
 * @param {object} [evaluation] outlook.goal_evaluations[i] for samme indeks (med `met`).
 * @param {object} [ctx]       Fallback-kontekst: { cumulativeStats, riders, standing, team, board, activeLoanCount }.
 */
export function isBoardGoalAchieved(goal, evaluation, ctx = {}) {
  if (typeof evaluation?.met === "boolean") return evaluation.met;
  if (!goal) return false;

  const { cumulativeStats, riders = [], standing, team, board, activeLoanCount = 0 } = ctx;
  if (goal.cumulative) {
    if (goal.type === "stage_wins") return (cumulativeStats?.stage_wins || 0) >= goal.target;
    if (goal.type === "gc_wins") return (cumulativeStats?.gc_wins || 0) >= goal.target;
  }
  const sponsorIncome = team?.sponsor_income ?? 0;
  const planStartSponsorIncome = board?.plan_start_sponsor_income ?? sponsorIncome;
  switch (goal.type) {
    case "min_u25_riders":
      return riders.filter(r => r.is_u25).length >= goal.target;
    case "min_national_riders":
      return riders.filter(r => (r.nationality_code || "").toUpperCase() === goal.nationality_code).length >= goal.target;
    case "min_riders":
      return riders.length >= goal.target;
    case "top_n_finish":
      return standing ? (standing.rank_in_division || 99) <= goal.target : false;
    case "stage_wins":
      return standing ? (standing.stage_wins || 0) >= goal.target : false;
    case "gc_wins":
      return standing ? (standing.gc_wins || 0) >= goal.target : false;
    case "no_outstanding_debt":
      return activeLoanCount === 0;
    case "sponsor_growth": {
      if (!planStartSponsorIncome) return false;
      return ((sponsorIncome - planStartSponsorIncome) / planStartSponsorIncome * 100) >= goal.target;
    }
    default:
      return false;
  }
}
