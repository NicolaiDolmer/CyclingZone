// todayRowModel — ren logik bag telefonens Today-raekke, retning A (#5685/#5630).
//
// Ejer-go 1/10 paa docs/design/mockups-5630-5685-mobile-day-choice-2026-10-01:
// hver raekke viser (1) "Fatigue tonight ~X" fra SAMME prognose som
// Program -> Plan (#5933, serveren regner med aftenopgoerelsens funktioner, I5;
// her vises kun tal + baand, aldrig en formel), (2) saesonens evne-fremgang og
// (3) et segmenteret valg Rest / Recovery / Program med samme semantik som
// desktoppens hurtig-knapper (QUICK_DAY_TYPES i TrainingPage.jsx).
//
// Ingen React/i18n-imports ud over den rene baand-funktion, saa node --test kan
// koere filen uden en browser.

import { forecastTone, type ForecastBand, type ForecastEntry } from "./FatigueForecastModel.ts";

export type QuickChoice = "rest" | "recovery" | "session";

export type RowForecast = { value: number; tone: ForecastBand };

/** "Fatigue tonight ~X": afrundet tal + baandet serveren gav (ukendt baand = "warn"). */
export function rowForecast(entry: ForecastEntry | null | undefined): RowForecast | null {
  if (!entry || typeof entry.fatigue !== "number" || !Number.isFinite(entry.fatigue)) return null;
  return { value: Math.round(entry.fatigue), tone: forecastTone(entry) };
}

/**
 * Hvilket segment er trykket ind. `activeDay` er dagstypen planen giver i dag
 * (dayTypeForProgram), `sessionDay` den dagstype rytterens gemte session hoerer
 * til. Samme regel som desktoppens knapper: "session" er inde naar dagen ER
 * rytterens egen session; hvile og restitution sammenlignes direkte.
 */
export function pressedChoice(
  activeDay: string | null | undefined,
  sessionDay: string | null | undefined,
  hasPlan: boolean,
): QuickChoice | null {
  if (!hasPlan || !activeDay) return null;
  if (activeDay === "rest") return "rest";
  if (activeDay === "recovery") return "recovery";
  if (sessionDay && activeDay === sessionDay) return "session";
  return null;
}

/**
 * Segmentet ud fra dagens EFFEKTIVE felt (programcellen naar den findes, ellers
 * planen), dvs. det tabellens celle viser. "rest"/"recovery" er dagstyper uden
 * session; enhver anden session er rytterens program. `null` = ukendt (fx en
 * etape-rytter), saa kalderen falder tilbage paa planen.
 */
export function pressedChoiceFromSession(session: string | null | undefined): QuickChoice | null {
  if (!session) return null;
  if (session === "rest") return "rest";
  if (session === "recovery" || session === "restitution") return "recovery";
  return "session";
}

/**
 * Beslutning 2: efter Train now (eller naar dagen er afregnet) er dagens valg
 * laast, praecis som det er i dag. `trainedToday` er sidens egen run-gate.
 */
export function rowLocked({ trainedToday }: { trainedToday: boolean }): boolean {
  return trainedToday === true;
}
