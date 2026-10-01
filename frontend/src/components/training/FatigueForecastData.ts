// useFatigueForecast — klienten bag "Fatigue tonight: approx. X" (#5933).
//
// Serveren regner (GET /api/training/programs/forecast, aftenopgoerelsens egne
// funktioner, invariant I5); her hentes kun svaret. Siden kalder `reload` naar
// planen eller dagsvalget aendrer sig, saa tallet foelger felterne live, foer
// dagen bekraeftes.
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import type { ForecastEntry, ForecastResponse } from "./FatigueForecastModel.ts";

export { forecastTone, raceSlotsFor } from "./FatigueForecastModel.ts";
export type { ForecastBand, ForecastEntry, ForecastResponse } from "./FatigueForecastModel.ts";

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
