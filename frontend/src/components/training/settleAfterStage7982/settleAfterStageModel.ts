// #7982 (ejer 15/11): loebets session afregnes, naar etapen er afgjort. Skaermdelen.
// Design: docs/superpowers/specs/2026-11-15-7982-afregning-efter-etapen-design.md §4.4-4.5.
//
// Serveren (GET /api/training/programs/forecast) sender kun de nye felter, naar kontakten
// training_settle_race_session er on og datoen har en kvittering: `raceSessionSettle` paa svaret
// og `ranSlots` (felter med kvittering) pr. rytter. Uden dem er alt her praecis dagens logik,
// saa en slukket kontakt giver skaermen bit for bit som i dag.
//
// Ren logik uden imports af React, saa node --test kan koere den.
import { raceSlotsFor, type ForecastResponse } from "../FatigueForecastModel.ts";

type EntryWithRan = { raceSlots?: number[]; ranSlots?: number[] };
type SettleForecast = ForecastResponse & { raceSessionSettle?: { fatigueNow?: boolean } | null };

function entryOf(forecast: SettleForecast | null, riderId: string | null | undefined): EntryWithRan | null {
  if (!riderId) return null;
  return (forecast?.riders?.[riderId] as EntryWithRan | undefined) ?? null;
}

/** Kontakten er on for en aaben dato. En afgjort dato vises som i dag (alt er aftenens). */
export function raceSessionSettleOn(forecast: SettleForecast | null): boolean {
  return !!forecast?.available && !forecast.settled && !!forecast.raceSessionSettle;
}

/** Dagens felter, der er koert (har kvittering), som 0-baserede slots. Tom med kontakten slukket. */
export function ranSlotsFor(forecast: SettleForecast | null, riderId: string | null | undefined): ReadonlySet<number> {
  if (!raceSessionSettleOn(forecast)) return new Set();
  return new Set(entryOf(forecast, riderId)?.ranSlots ?? []);
}

/**
 * Laasen foelger det, der er koert (§4.5): loebets felter (regel A, som i dag) plus de felter, der
 * har kvittering. Alle andre felter paa dagen er aabne, ogsaa dem foer loebet.
 * Slukket = raceSlotsFor, uaendret.
 */
export function todayLockedSlots(forecast: SettleForecast | null, riderId: string | null | undefined): ReadonlySet<number> {
  const race = raceSlotsFor(forecast, riderId);
  const ran = ranSlotsFor(forecast, riderId);
  if (!ran.size) return race;
  return new Set([...race, ...ran]);
}

/** Antal ryttere, hvis loebssession er koert i dag (et loebsfelt med kvittering). */
export function raceSessionsRunCount(forecast: SettleForecast | null): number {
  if (!raceSessionSettleOn(forecast)) return 0;
  let count = 0;
  for (const entry of Object.values(forecast?.riders ?? {}) as EntryWithRan[]) {
    const race = new Set(entry?.raceSlots ?? []);
    if ((entry?.ranSlots ?? []).some((slot) => race.has(slot))) count += 1;
  }
  return count;
}

/**
 * Den ene linje i traeningsvisningen (beslutning 8: ingen indbakke-besked). Traethedens del siges
 * kun, naar tallet lige nu faktisk viser loebet (fatigue_now_7801, som kontakten taendes sammen med).
 */
export function raceSessionNote(forecast: SettleForecast | null): { keys: string[]; n: number } | null {
  const n = raceSessionsRunCount(forecast);
  if (!n) return null;
  const keys = ["settleAfterStage.note"];
  if (forecast?.raceSessionSettle?.fatigueNow === true) keys.push("settleAfterStage.fatigueNow");
  return { keys, n };
}
