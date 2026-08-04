// #2752 — hvilken sæson skal /seasons vise som DEFAULT (ingen :seasonId i url'en)?
//
// Bug (issue #2752 AC #3): SeasonEndPage prioriterede altid en `status==="active"`
// sæson over den seneste completed, selv lige EFTER et sæsonskifte hvor den nye
// aktive sæson endnu ikke har kørt et løb — season_standings er tom, og siden
// viser EmptyState i stedet for den lige-afsluttede sæsons resultater. Spilleren
// "falder ind i" næste sæson uden at se sit eget sæsonafslut.
//
// Fix: i et kort vindue EFTER sæsonskiftet (samme vindue som dashboardets
// sæsonstart-guide, SEASON_START_WINDOW_DAYS — #2925) foretrækker vi den seneste
// COMPLETED sæson frem for den (endnu tomme) aktive. Uden for vinduet er den
// aktive sæson fortsat default (spilleren vil typisk se live-stilling midt i en
// sæson, ikke forrige sæsons facit).
//
// Ren funktion — ingen fetch, ingen React — testet isoleret med node --test.

import { daysSinceSeasonStart, SEASON_START_WINDOW_DAYS } from "./seasonStartGuide.js";

/**
 * @param {Array<{id:string, number:number, status:string, start_date?:string}>} seasons
 *   Forventes allerede sorteret NYESTE FØRST (samme rækkefølge som SeasonEndPage's
 *   `.order("number", { ascending: false })`-fetch).
 * @param {Date|number} [now]
 * @returns {{id:string}|null} sæsonen der skal loades, eller null hvis listen er tom.
 */
export function pickDefaultSeason(seasons, now = new Date()) {
  const list = Array.isArray(seasons) ? seasons : [];
  if (list.length === 0) return null;

  const active = list.find((s) => s.status === "active");
  if (!active) return list[0];

  const latestCompleted = list.find((s) => s.status === "completed");
  if (!latestCompleted) return active;

  const days = daysSinceSeasonStart(active.start_date, now);
  // null (manglende/ugyldig start_date) og negativ (datafejl) fejler ÅBENT mod
  // den aktive sæson — samme retning som isSeasonStartWindow's egen no-data-gate,
  // så en datafejl aldrig kan skjule en spillers eneste sæsonside bag et gæt.
  const withinTransitionWindow = days !== null && days >= 0 && days <= SEASON_START_WINDOW_DAYS;

  return withinTransitionWindow ? latestCompleted : active;
}
