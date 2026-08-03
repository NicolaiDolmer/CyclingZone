// #2752 — rene hjælpefunktioner for sæson-recap-oplevelsen (yearbook-hero +
// dashboard-nudge). Ingen fetch, ingen React: tone/tekst-nøgler herfra bruges af
// SeasonRecapHero.jsx og SeasonWrapNudgeCard.jsx, al selve teksten bor i
// i18n (seasonEnd/dashboard-namespacerne) — samme adskillelse som seasonHonours.js.
//
// `movement` bruger PRÆCIS samme tre værdier som teamPalmares.js's
// buildSeasonHistory ("promoted" | "relegated" | "maintained" | null), så en
// fremtidig rigtig kobling af disse komponenter til season_standings kan sende
// den værdi videre uden en oversættelses-lag.

/**
 * ZonePill-tone for en movement-værdi (samme succes/danger/neutral-vokabular som
 * ui/DataTable.jsx's zonePillClass).
 * @param {"promoted"|"relegated"|"maintained"|null} movement
 * @returns {"success"|"danger"|"neutral"}
 */
export function movementTone(movement) {
  if (movement === "promoted") return "success";
  if (movement === "relegated") return "danger";
  return "neutral";
}

/**
 * i18n-nøgle (under `recap.movement.*`) for en movement-værdi.
 * @param {"promoted"|"relegated"|"maintained"|null} movement
 */
export function movementLabelKey(movement) {
  if (movement === "promoted") return "recap.movement.promoted";
  if (movement === "relegated") return "recap.movement.relegated";
  return "recap.movement.maintained";
}

/**
 * Hvilken "sæson {N+1} starter nu"-mål-tekst (under `recap.goal.*`) der bygger bro
 * fra sidste sæsons facit til den nye sæson. Prioriterer FAKTISK bevægelse over
 * position: en spiller der lige er rykket op skal høre "ny division, nyt niveau",
 * ikke "du ligger midt i feltet".
 *
 * @param {object} p
 * @param {"promoted"|"relegated"|"maintained"|null} p.movement
 * @param {number} p.division   division HOLDET SPILLER I NÆSTE sæson
 * @param {number} p.minDivision
 * @param {number} p.maxDivision
 */
export function nextSeasonGoalKey({ movement, division, minDivision, maxDivision }) {
  if (movement === "promoted") return "recap.goal.promoted";
  if (movement === "relegated") return "recap.goal.relegated";
  if (division === minDivision) return "recap.goal.heldTop";
  if (division === maxDivision) return "recap.goal.heldBottom";
  return "recap.goal.heldMid";
}
