// #8580 · Klienten bag dagsvælgeren: GET /api/training/programs/forecast/week (#8591).
// Kontakten training_week_forecast afgøres på serveren; svarer den available:false, er
// ugen null, og I dag-fanen er præcis som før (ingen dagsvælger).
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/supabase";
import { apiFetch } from "../../../lib/apiFetch.ts";
import { weekUsable, type WeekResponse } from "./dayPickerModel.ts";

export function useTrainingWeek({ enabled }: { enabled: boolean }) {
  const [week, setWeek] = useState<WeekResponse | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) { setWeek(null); return; }
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch("/api/training/programs/forecast/week", { headers }, { source: "training-week" });
    if (!res.ok) return; // apiFetch: ok:false ogsaa ved netvaerksfejl; ugen er en tilfoejelse, aldrig en spaerring
    const data = res.data as WeekResponse | null;
    setWeek(weekUsable(data) ? data : null);
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  return { week, reload };
}
