// #1681 — afgør hvilket kommende løb manageren kan udtage hold til.
//
// Holdudtagelse (RaceSelectionPanel) renderes kun for løb med status "scheduled"
// (RaceDetailPage.jsx + backend GET /api/races/:raceId/selection). Denne rene
// logik vælger det tidligste scheduled-løb, så dashboard-CTA'en og nav-genvejen
// kan pege manageren direkte derhen — uden et ekstra backend-deploy. Sorteringen
// genbruger dateTextToDayOfYear (samme rækkefølge som "Kommende løb"-kortet).

import { dateTextToDayOfYear } from "./raceCalendar.js";
import { deriveRaceStatus } from "./raceHubLogic.js";

// Løb manageren kan udtage hold til lige nu = status "scheduled" OG ikke gået i gang.
// Et igangværende etapeløb beholder status "scheduled" men har låst trup (#1825), så
// det er IKKE udtageligt — ellers ville dashboard-CTA'en linke til et "trup låst"-panel.
export function selectableRaces(races) {
  if (!Array.isArray(races)) return [];
  return races.filter((r) => deriveRaceStatus(r?.status, r?.stages_completed, r?.stages) === "scheduled");
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
