// #8060: henter akademi-regnskabet pr. sæson fra GET /api/academy/pnl (feltet
// `ledger`, kun med når kontakten academy_page_v2_8081 er tændt for vieweren).
// Ren læsning. loading sættes altid tilbage i finally (#1350-klassen).
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../lib/supabase.ts";
import { apiFetch } from "../../lib/apiFetch.ts";
import { parseAcademyLedger } from "./academyLedgerModel.ts";
import type { AcademyLedger } from "./academyLedgerModel.ts";

export type AcademyLedgerState = {
  loading: boolean;
  error: string | null;
  /** null efter indlæsning = kontakten er slukket eller akademiet er lukket. */
  ledger: AcademyLedger | null;
  reload: () => Promise<void>;
};

export function useAcademyLedger(): AcademyLedgerState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<AcademyLedger | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders({ json: false });
      if (!headers) return;
      const res = await apiFetch("/api/academy/pnl", { headers }, { source: "academyLedger" });
      if (res.networkError) {
        setError("network");
        return;
      }
      if (res.status === 409) {
        setLedger(null);
        return;
      }
      if (!res.ok) {
        setError((res.data as { error?: string } | null)?.error ?? "failed");
        return;
      }
      // #8060 review 2: serveren kunne ikke regne regnskabet; fanen viser fejlen med "Proev igen".
      if ((res.data as { ledger_unavailable?: boolean } | null)?.ledger_unavailable === true) {
        setError("ledger_unavailable");
        return;
      }
      setLedger(parseAcademyLedger(res.data));
    } catch {
      setError("network");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { loading, error, ledger, reload };
}
