// #1233 · Type-styret mål-label-resolver — udtrukket fra BoardPage.jsx så den
// kan unit-testes mod de rigtige locale-filer (node --test).
//
// Backend gemmer danske råtekst-labels i DB (board_profiles.current_goals).
// Type-styrede oversættelser her sikrer at allerede gemte planer vises korrekt
// i BÅDE en og da med konkrete tal (aldrig literal "n"/"N" som placeholder).
//
// Kontrakt: `t` er board-namespace-scoped (fra useTranslation("board")).

import { getCountryDisplay } from "./countryUtils.js";

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
