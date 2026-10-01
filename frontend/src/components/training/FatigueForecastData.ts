// useFatigueForecast — klienten bag "Fatigue tonight: approx. X" (#5933).
//
// Serveren regner (GET /api/training/programs/forecast, aftenopgoerelsens egne
// funktioner, invariant I5); her hentes kun svaret. `reload` kaldes efter hver
// felt-rettelse, saa tallet foelger planen live, foer dagen bekraeftes.
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";

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

export function useFatigueForecast({ enabled }: { enabled: boolean }) {
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) { setForecast(null); return; }
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch("/api/training/programs/forecast", { headers }, { source: "training-forecast" });
    if (!res.ok) return;
    const data = (res.data ?? {}) as ForecastResponse;
    setForecast(data.available === true ? data : null);
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  const entryFor = useCallback(
    (riderId: string | null | undefined): ForecastEntry | null => (riderId ? forecast?.riders?.[riderId] ?? null : null),
    [forecast],
  );

  return { forecast, settled: forecast?.settled === true, entryFor, reload };
}
