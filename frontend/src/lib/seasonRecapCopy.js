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
 * i18n-nøgle-SUFFIX (under en caller-valgt `*.movement.*`-gren, fx
 * `recap.movement.*` i seasonEnd.json eller `seasonWrap.movement.*` i
 * dashboard.json) for en movement-værdi. Returnerer bevidst kun suffixet, ikke
 * en fuld sti: to forskellige overflader (recap-heroen, dashboard-nudgen) har
 * hver deres tekst for samme tre tilstande, og en bare-suffix-funktion kan
 * genbruges af begge uden en namespace-antagelse indbygget i lib'et.
 * @param {"promoted"|"relegated"|"maintained"|null} movement
 * @returns {"promoted"|"relegated"|"maintained"}
 */
export function movementLabelKey(movement) {
  if (movement === "promoted") return "promoted";
  if (movement === "relegated") return "relegated";
  return "maintained";
}

/**
 * i18n-nøgle-SUFFIX (under en caller-valgt `*.goal.*`-gren) for "sæson {N+1}
 * starter nu"-mål-teksten der bygger bro fra sidste sæsons facit til den nye
 * sæson. Prioriterer FAKTISK bevægelse over position: en spiller der lige er
 * rykket op skal høre "ny division, nyt niveau", ikke "du ligger midt i feltet".
 *
 * @param {object} p
 * @param {"promoted"|"relegated"|"maintained"|null} p.movement
 * @param {number} p.division   division HOLDET SPILLER I NÆSTE sæson
 * @param {number} p.minDivision
 * @param {number} p.maxDivision
 * @returns {"promoted"|"relegated"|"heldTop"|"heldBottom"|"heldMid"}
 */
export function nextSeasonGoalKey({ movement, division, minDivision, maxDivision }) {
  if (movement === "promoted") return "promoted";
  if (movement === "relegated") return "relegated";
  if (division === minDivision) return "heldTop";
  if (division === maxDivision) return "heldBottom";
  return "heldMid";
}
