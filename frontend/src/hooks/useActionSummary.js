import { useState, useEffect, useCallback, useId } from "react";
import { supabase } from "../lib/supabase";
import { useRealtimeRefetch } from "./useRealtimeRefetch";

const API = import.meta.env.VITE_API_URL;

const EMPTY = {
  transfer_offers: [],
  swap_offers: [],
  counts: { transfer_offers: 0, swap_offers: 0, total: 0 },
};

// Tabeller hvis ændringer kan påvirke "kræver handling"-summen. Modul-konstant
// (stabil reference) så useRealtimeRefetch ikke re-subscriber hver render.
const PENDING_TABLES = ["transfer_offers", "swap_offers"];

/**
 * Kanonisk "kræver handling"-summary for det indloggede team. Komponerer
 * `/api/inbox/pending` — pending transfer-/swap-/lejebeslutninger hvor JEG er den
 * part der mangler at handle. Én kilde til sandhed for alle action-badges
 * (Indbakke "Skal handles", Dashboard "Næste træk", …) så de aldrig divergerer
 * (#271 Slice A). Definitionen ligger i backend (`lib/inboxPending.js`); hooket
 * må ikke gen-implementere den klient-side.
 *
 * Auktioner indgår bevidst IKKE — de er ikke "pending decisions" i FM-forstand
 * (se inboxPending.js). Tids-pres-signaler som "auktion slutter snart" håndteres
 * separat af forbrugeren (fx Dashboard "Næste træk").
 *
 * @returns {{ pending: typeof EMPTY, loading: boolean, loaded: boolean, refetch: () => Promise<void> }}
 */
export function useActionSummary() {
  const [pending, setPending] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // #3521: Layout (nav-badge) mounter dette hook SAMTIDIG med sider der også
  // konsumerer det direkte (DashboardPage, NotificationsPage) — et delt,
  // hardkodet kanalnavn kolliderede da to instanser abonnerede på samme
  // Supabase realtime-topic ("cannot add postgres_changes callbacks ...
  // after subscribe()", Layout crashede via ErrorBoundary). useId() giver
  // hver hook-instans sit eget topic, så flere samtidige mounts er sikre.
  const instanceId = useId();

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPending(EMPTY); return; }
      const res = await fetch(`${API}/api/inbox/pending`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) setPending(await res.json());
    } catch { /* silent — UI viser tom-state */ }
    finally { setLoading(false); setLoaded(true); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  useRealtimeRefetch(`action-summary-live-${instanceId}`, PENDING_TABLES, refetch);

  return { pending, loading, loaded, refetch };
}
