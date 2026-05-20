import { Outlet } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import AdminTabs from "../../components/admin/shared/AdminTabs";

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function AdminLayout() {
  // Global market-pause banner — vises på ALLE admin tabs så admin ikke
  // utilsigtet udfører handlinger mens markedet er pauset. Tabs der ændrer
  // pause-state (AdminSystemTab) dispatcher "cz:market-pause-changed" så
  // banner refresher uden side-genindlæsning.
  const [marketPause, setMarketPause] = useState({ level: "none", pausedAt: null, reason: null });

  async function loadMarketPause() {
    const { data } = await supabase
      .from("auction_timing_config")
      .select("market_pause_level, market_paused_at, market_paused_reason")
      .eq("id", 1)
      .single();
    setMarketPause({
      level: data?.market_pause_level || "none",
      pausedAt: data?.market_paused_at || null,
      reason: data?.market_paused_reason || null,
    });
  }

  useEffect(() => {
    loadMarketPause();
    function handleChange() { loadMarketPause(); }
    window.addEventListener("cz:market-pause-changed", handleChange);
    return () => window.removeEventListener("cz:market-pause-changed", handleChange);
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-cz-1">Admin Panel</h1>
        <p className="text-cz-3 text-sm">Sæsonstyring, økonomi og system</p>
      </div>
      <AdminTabs />
      {marketPause.level !== "none" && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm border bg-cz-danger-bg text-cz-danger border-cz-danger/30">
          <p className="font-semibold">
            🛑 {marketPause.level === "all" ? "Hele markedet er pauset" : "Auktioner er pauset"}
          </p>
          {marketPause.reason && <p className="text-xs mt-1">Årsag: {marketPause.reason}</p>}
          {marketPause.pausedAt && (
            <p className="text-xs mt-1 text-cz-3">Pauset siden {new Date(marketPause.pausedAt).toLocaleString("da-DK")}</p>
          )}
        </div>
      )}
      <Suspense fallback={<TabFallback />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
