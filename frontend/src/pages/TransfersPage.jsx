// TransfersPage.jsx
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function TransfersPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("transfer_listings")
      .select(`id, asking_price, status, created_at,
        rider:rider_id(id, firstname, lastname, uci_points, is_u25),
        seller:seller_team_id(id, name)`)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .then(({ data }) => { setListings(data || []); setLoading(false); });
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Transfermarked</h1>
        <p className="text-white/30 text-sm">{listings.length} ryttere til salg</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <p className="text-4xl mb-3">↔</p>
          <p>Ingen ryttere på transferlisten</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {listings.map(l => (
            <div key={l.id} className="bg-[#0f0f18] border border-white/5 rounded-xl p-4
              flex items-center justify-between hover:border-white/10 transition-all">
              <div>
                <p className="text-white font-medium">
                  {l.rider?.firstname} {l.rider?.lastname}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {l.rider?.is_u25 && (
                    <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400
                      px-1.5 py-0.5 rounded">U25</span>
                  )}
                  <span className="text-white/30 text-xs">{l.seller?.name}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[#e8c547] font-mono font-bold">
                  {l.asking_price?.toLocaleString("da-DK")} pts
                </p>
                <p className="text-white/20 text-xs">UCI: {l.rider?.uci_points}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
