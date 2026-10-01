// FatigueForecastModel — ren logik bag "Fatigue tonight: approx. X" (#5933).
// Ingen imports, saa node --test kan koere den uden en browser.

export type ForecastBand = "ok" | "warn" | "risk";
export type ForecastEntry = { fatigue: number; band: ForecastBand | null; raceSlots?: number[] };
export type ForecastResponse = {
  available?: boolean;
  settled?: boolean;
  tickDate?: string;
  riders?: Record<string, ForecastEntry>;
};

// Et svar uden kendt baand maa aldrig vises som "frisk": fald tilbage til den
// forsigtige "traet"-tekst.
export function forecastTone(entry: Pick<ForecastEntry, "band">): ForecastBand {
  return entry.band === "ok" || entry.band === "warn" || entry.band === "risk" ? entry.band : "warn";
}

// Felter dagens loeb har laast for rytteren (regel A), som 0-baserede slots.
export function raceSlotsFor(forecast: ForecastResponse | null, riderId: string | null | undefined): ReadonlySet<number> {
  if (!forecast?.available || forecast.settled || !riderId) return new Set();
  return new Set(forecast.riders?.[riderId]?.raceSlots ?? []);
}
