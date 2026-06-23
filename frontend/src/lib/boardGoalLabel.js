// #1233 · Type-styret mål-label-resolver — udtrukket fra BoardPage.jsx så den
// kan unit-testes mod de rigtige locale-filer (node --test).
//
// Backend gemmer danske råtekst-labels i DB (board_profiles.current_goals).
// Type-styrede oversættelser her sikrer at allerede gemte planer vises korrekt
// i BÅDE en og da med konkrete tal (aldrig literal "n"/"N" som placeholder).
//
// Kontrakt: `t` er board-namespace-scoped (fra useTranslation("board")).

import { getCountryDisplay } from "./countryUtils.js";

// #1750 · Type → board.json-nøgle. `base` = enkelt-sæson/ikke-kumulativ,
// `planPeriod` = multi-year/kumulativ-varianten (samme split som backend
// buildGoalLabel). signature_rider/top_n_finish/min_national_riders håndteres
// med deres egen logik ovenfor og er bevidst ikke med her.
const TYPED_GOAL_KEYS = {
  stage_wins: { base: "goal.stageWins", planPeriod: "goal.stageWinsPlanPeriod" },
  gc_wins: { base: "goal.gcWins", planPeriod: "goal.gcWinsPlanPeriod" },
  min_u25_riders: { base: "goal.minU25Riders" },
  min_riders: { base: "goal.minRiders" },
  sponsor_growth: { base: "goal.sponsorGrowth", planPeriod: "goal.sponsorGrowthPlanPeriod" },
  monument_podium: { base: "goal.monumentPodium", planPeriod: "goal.monumentPodiumPlanPeriod" },
  jersey_wins: { base: "goal.jerseyWins", planPeriod: "goal.jerseyWinsPlanPeriod" },
  profitable_transfers: { base: "goal.profitableTransfers" },
  u25_development_delta: { base: "goal.u25DevelopmentDelta" },
  relative_rank: { base: "goal.relativeRank" },
  domestic_dominance: { base: "goal.domesticDominance" },
};

// Spejler backend formatTransferThreshold (boardGoals.js) så transfer-målet
// viser samme kompakte beløb (fx "500K", "1.2M") i begge sprog.
function formatTransferThreshold(target) {
  const value = Number(target || 0);
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${value}`;
}

export function getBoardGoalLabel(t, goal) {
  if (!goal) return "";
  // #815 · "stjerne-rytter (popularity >= 75)" → "højt omdømme". Type-styret så
  // ALLEREDE gemte planer (med den gamle label i DB) også omdøbes i visningen.
  if (goal.type === "signature_rider") {
    return t("goal.signatureRider", { count: goal.target ?? 1 });
  }
  // #1233 · top_n_finish: oversæt type-styret så EN-mode ikke lækker dansk
  // råtekst, og tallet altid interpoleres konkret. DB-labelen afgør om målet
  // er "ved planens afslutning"-varianten (multi-year-planer).
  if (goal.type === "top_n_finish" && goal.target != null) {
    const key = goal.label?.includes("ved planens afslutning")
      ? "goal.topNFinishPlanEnd"
      : "goal.topNFinish";
    return t(key, { target: goal.target });
  }
  // #1750 · Backend genererer alle øvrige mål-labels som DANSK råtekst (kun
  // signature_rider/top_n_finish/min_national_riders havde type-styret EN). På
  // EN lækkede resten dansk. Vi type-resolver dem her mod board.json så EN bliver
  // engelsk + tallet altid interpoleres. Cumulative/multi-year-varianten sniffes
  // fra DB-labelen (samme mønster som top_n_finish), så ALLEREDE gemte planer
  // også vises korrekt. Den kanoniske kilde er backend buildGoalLabel().
  if (goal.type != null && goal.target != null) {
    const isPlanPeriod = goal.cumulative === true
      || goal.label?.includes("over planperioden")
      || goal.label?.includes("ved planens afslutning");
    const typeKey = TYPED_GOAL_KEYS[goal.type];
    if (typeKey) {
      const key = isPlanPeriod && typeKey.planPeriod ? typeKey.planPeriod : typeKey.base;
      const params = { target: goal.target, count: goal.target };
      if (goal.type === "profitable_transfers") {
        params.amount = formatTransferThreshold(goal.target);
      }
      // #1238 · monument_podium med race_scope "classics" dækker hele
      // klassiker-kategorien (inkl. Monuments) — egne keys så copy matcher backend.
      if (goal.type === "monument_podium" && goal.race_scope === "classics") {
        const classicsKey = isPlanPeriod ? "goal.classicsPodiumPlanPeriod" : "goal.classicsPodium";
        const translated = t(classicsKey, { ...params, defaultValue: "" });
        if (translated) return translated;
      }
      const translated = t(key, { ...params, defaultValue: "" });
      if (translated) return translated;
    }
  }
  if (goal.type === "no_outstanding_debt") {
    const translated = t("goal.noOutstandingDebt", { defaultValue: "" });
    if (translated) return translated;
  }
  if (goal.label_key) {
    const translated = t(goal.label_key, { count: goal.target, target: goal.target, defaultValue: "" });
    if (translated) return translated;
  }
  if (goal.type === "min_national_riders" && goal.nationality_code) {
    const country = getCountryDisplay(goal.nationality_code);
    return t("goal.minNationalRiders", { target: goal.target, country: country.name || country.code });
  }
  return goal.label || "";
}
