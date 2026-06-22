// #1681 — afgør hvilket kommende løb manageren kan udtage hold til.
//
// Holdudtagelse (RaceSelectionPanel) renderes kun for løb med status "scheduled"
// (RaceDetailPage.jsx + backend GET /api/races/:raceId/selection). Denne rene
// logik vælger det tidligste scheduled-løb, så dashboard-CTA'en og nav-genvejen
// kan pege manageren direkte derhen — uden et ekstra backend-deploy. Sorteringen
// genbruger dateTextToDayOfYear (samme rækkefølge som "Kommende løb"-kortet).

import { dateTextToDayOfYear } from "./raceCalendar.js";

// Løb manageren kan udtage hold til lige nu = status "scheduled".
export function selectableRaces(races) {
  if (!Array.isArray(races)) return [];
  return races.filter((r) => r?.status === "scheduled");
}

// Det tidligste scheduled-løb (efter kalenderdato), eller null hvis intet findes.
// Muterer ikke input.
export function pickNextSelectableRace(races) {
  const candidates = selectableRaces(races);
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      dateTextToDayOfYear(a.pool_race?.date_text) -
      dateTextToDayOfYear(b.pool_race?.date_text)
  )[0];
}
