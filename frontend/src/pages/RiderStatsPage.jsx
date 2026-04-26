import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getFlagEmoji, getCountryName } from "../lib/countryUtils";

const API = import.meta.env.VITE_API_URL;

const STATS = [
  { key: "stat_fl",  label: "Flad",              icon: "═" },
  { key: "stat_bj",  label: "Bjerg",             icon: "▲" },
  { key: "stat_kb",  label: "Mellembjerg",        icon: "△" },
  { key: "stat_bk",  label: "Bakke",             icon: "∧" },
  { key: "stat_tt",  label: "Enkeltstart",        icon: "⏱" },
  { key: "stat_prl", label: "Prolog",             icon: "◷" },
  { key: "stat_bro", label: "Brosten",            icon: "⬡" },
  { key: "stat_sp",  label: "Sprint",             icon: "⚡" },
  { key: "stat_acc", label: "Acceleration",       icon: "▶" },
  { key: "stat_ned", label: "Nedkørsel",          icon: "↓" },
  { key: "stat_udh", label: "Udholdenhed",        icon: "◎" },
  { key: "stat_mod", label: "Modstandsdygtighed", icon: "◈" },
  { key: "stat_res", label: "Restituering",       icon: "↺" },
  { key: "stat_ftr", label: "Fighter",            icon: "★" },
];

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function StatRow({ label, icon, value }) {
  const pct = Math.round(((value || 0) / 99) * 100);
  const color = value >= 80 ? "#e8c547" : value >= 70 ? "#60a5fa" : value >= 60 ? "rgba(100,99,122,0.7)" : "rgba(148,150,176,0.6)";
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-slate-300 w-4 text-center text-sm">{icon}</span>
      <span className="text-slate-500 text-sm w-36 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-2">
        <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-sm font-bold w-8 text-right flex-shrink-0" style={{ color }}>{value ?? "—"}</span>
    </div>
  );
}

function DirectOfferButton({ rider }) {
  const [show, setShow]       = useState(false);
  const [amount, setAmount]   = useState((rider.uci_points || 0) * 4000);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [windowOpen, setWindowOpen] = useState(true);
  const API = import.meta.env.VITE_API_URL;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${API}/api/transfer-window`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(d => setWindowOpen(d?.open !== false))
        .catch(() => {});
    });
  }, []);

  async function sendOffer() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/transfers/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, offer_amount: amount, message }),
    });
    const data = await res.json();
    if (res.ok) { setResult({ ok: true, msg: "✅ Tilbud sendt!" }); setShow(false); }
    else        { setResult({ ok: false, msg: `❌ ${data.error}` }); }
    setLoading(false);
    setTimeout(() => setResult(null), 4000);
  }
  return (
    <div>
      {result && (
        <div className={`mb-2 px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {result.msg}
        </div>
      )}
      <button onClick={() => windowOpen && setShow(!show)} disabled={!windowOpen}
        className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all border
          ${!windowOpen
            ? "bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed"
            : show
              ? "bg-amber-50 text-amber-700 border-[#e8c547]/25"
              : "bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-100 hover:text-slate-900"}`}>
        {windowOpen ? "↔ Send transfertilbud" : "Transfervindue lukket"}
      </button>
      {show && windowOpen && (
        <div className="mt-3 flex flex-col gap-2">
          <input type="number" value={amount} min={1} onChange={e => setAmount(parseInt(e.target.value) || 0)}
            placeholder="Tilbudsbeløb i CZ$"
            className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:border-amber-400" />
          <input type="text" value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Besked (valgfri)"
            className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-amber-400" />
          <button onClick={sendOffer} disabled={loading || amount <= 0}
            className="w-full py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50 transition-all">
            {loading ? "Sender..." : "Send tilbud"}
          </button>
        </div>
      )}
    </div>
  );
}

function AuctionButton({ rider, isMyRider, onStart }) {
  const riderValue      = Math.max((rider.uci_points || 1) * 4000, 1);
  const [guaranteed, setGuaranteed] = useState(false);
  const [price, setPrice]           = useState(riderValue);
  const [loading, setLoading]       = useState(false);

  const guaranteedPrice = Math.floor(riderValue * 0.5);
  const effectivePrice  = guaranteed ? guaranteedPrice : price;
  const priceError      = !guaranteed && price < riderValue;

  return (
    <div>
      <p className="text-slate-400 text-xs uppercase tracking-widest mb-2">
        {isMyRider ? "Sæt til auktion" : "Start auktion (fri rytter)"}
      </p>
      {isMyRider && (
        <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
          <input type="checkbox" checked={guaranteed} onChange={e => setGuaranteed(e.target.checked)}
            className="rounded accent-amber-600" />
          <span className="text-sm text-slate-700 font-medium">Garanteret salg</span>
          <span className="text-xs text-slate-400">
            (startpris {guaranteedPrice.toLocaleString("da-DK")} CZ$ — 50% af Værdi)
          </span>
        </label>
      )}
      <div className="flex gap-2">
        <input
          type="number"
          value={guaranteed ? guaranteedPrice : price}
          min={guaranteed ? guaranteedPrice : riderValue}
          disabled={guaranteed}
          onChange={e => !guaranteed && setPrice(parseInt(e.target.value) || riderValue)}
          className={`flex-1 bg-slate-100 border rounded-lg px-3 py-2 text-slate-900 text-sm font-mono focus:outline-none
            ${guaranteed
              ? "opacity-50 cursor-not-allowed border-slate-200"
              : priceError
                ? "border-red-300 focus:border-red-400"
                : "border-slate-300 focus:border-amber-400"}`}
        />
        <button
          onClick={async () => { setLoading(true); await onStart(effectivePrice, guaranteed); setLoading(false); }}
          disabled={loading || (!guaranteed && priceError)}
          className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
          {loading ? "..." : "Start auktion"}
        </button>
      </div>
      {priceError && (
        <p className="text-red-500 text-xs mt-1.5">
          Startpris skal mindst matche Værdi ({riderValue.toLocaleString("da-DK")} CZ$)
        </p>
      )}
    </div>
  );
}

export default function RiderStatsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [rider, setRider]                   = useState(null);
  const [onWatchlist, setOnWatchlist]       = useState(false);
  const [watchlistId, setWatchlistId]       = useState(null);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [results, setResults]               = useState([]);
  const [loading, setLoading]               = useState(true);
  const [tab, setTab]                       = useState("stats");
  const [myTeamId, setMyTeamId]             = useState(null);
  const [myTeam, setMyTeam]                 = useState(null);
  const [activeAuction, setActiveAuction]   = useState(null);
  const [auctionError, setAuctionError]     = useState(null);
  const [history, setHistory]               = useState([]);

  useEffect(() => { loadRider(); loadMyTeam(); loadWatchlistStatus(); loadHistory(); }, [id]);

  async function loadWatchlistStatus() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from("rider_watchlist")
      .select("id").eq("user_id", user.id).eq("rider_id", id).single();
    if (data) { setOnWatchlist(true); setWatchlistId(data.id); }
    else      { setOnWatchlist(false); setWatchlistId(null); }
  }

  async function loadWatchlistCount() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${id}/watchlist-count`, { headers: h });
      const data = await res.json();
      setWatchlistCount(data.count || 0);
    } catch (e) {}
  }

  async function toggleWatchlist() {
    const { data: { user } } = await supabase.auth.getUser();
    if (onWatchlist) {
      await supabase.from("rider_watchlist").delete().eq("id", watchlistId);
      setOnWatchlist(false); setWatchlistId(null);
    } else {
      const { data } = await supabase.from("rider_watchlist")
        .insert({ user_id: user.id, rider_id: id }).select("id").single();
      setOnWatchlist(true); setWatchlistId(data?.id);
      // Achievement check
      const h = await authHeaders();
      fetch(`${API}/api/achievements/check`, {
        method: "POST", headers: h,
        body: JSON.stringify({ context: "watchlist_add" }),
      }).catch(() => {});
    }
    loadWatchlistCount();
  }

  async function loadHistory() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${id}/history`, { headers: h });
      if (res.ok) setHistory(await res.json());
    } catch (e) {}
  }

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id, balance, division, name").eq("user_id", user.id).single();
    if (t) { setMyTeamId(t.id); setMyTeam(t); }
  }

  async function loadRider() {
    const [riderRes, resultsRes, auctionRes] = await Promise.all([
      supabase.from("riders").select(`*, team:team_id(id, name)`).eq("id", id).single(),
      supabase.from("race_results")
        .select(`*, race:race_id(name, race_type, start_date)`)
        .eq("rider_id", id).order("imported_at", { ascending: false }).limit(20),
      supabase.from("auctions")
        .select("id, status, calculated_end, current_price, is_guaranteed_sale")
        .eq("rider_id", id).in("status", ["active", "extended"]).maybeSingle(),
    ]);
    setRider(riderRes.data);
    setResults(resultsRes.data || []);
    setActiveAuction(auctionRes.data || null);
    setLoading(false);
    loadWatchlistCount();

    if (riderRes.data?.team_id) {
      const h = await authHeaders();
      fetch(`${API}/api/riders/${id}/view`, { method: "POST", headers: h }).catch(() => {});
    }
  }

  async function startAuction(startPrice, isGuaranteedSale = false) {
    setAuctionError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: id, starting_price: startPrice, is_guaranteed_sale: isGuaranteedSale }),
    });
    if (res.ok) navigate("/auctions");
    else {
      const data = await res.json();
      setAuctionError(data.error || "Noget gik galt");
      setTimeout(() => setAuctionError(null), 5000);
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );

  if (!rider) return <div className="text-slate-400 text-center py-16">Rytter ikke fundet</div>;

  const bestStat = STATS.map(s => ({ ...s, val: rider[s.key] || 0 })).sort((a, b) => b.val - a.val)[0];
  const isMyRider  = rider.team_id === myTeamId;
  const isFreeAgent = !rider.team_id;
  const canAuction  = isFreeAgent || isMyRider;
  const age = rider.birthdate
    ? Math.floor((Date.now() - new Date(rider.birthdate)) / (365.25 * 24 * 3600 * 1000))
    : null;
  const typeLabel = (() => {
    const vals = STATS.map(s => rider[s.key] || 0);
    const max = Math.max(...vals);
    return STATS[vals.indexOf(max)]?.label || "Allround";
  })();

  const bySeason = results.reduce((acc, r) => {
    const yr = r.race?.start_date?.slice(0, 4) || "—";
    if (!acc[yr]) acc[yr] = { wins: 0, top3: 0, totalPrize: 0 };
    if (r.position === 1) acc[yr].wins++;
    if (r.position <= 3) acc[yr].top3++;
    acc[yr].totalPrize += r.prize_money || 0;
    return acc;
  }, {});

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-900 text-sm mb-4 flex items-center gap-1">← Tilbage</button>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{rider.firstname} {rider.lastname}</h1>
              <button onClick={toggleWatchlist} title={onWatchlist ? "Fjern fra ønskeliste" : "Tilføj til ønskeliste"}
                className={`text-2xl transition-all hover:scale-110 ${onWatchlist ? "text-amber-700" : "text-slate-300 hover:text-slate-500"}`}>
                {onWatchlist ? "★" : "☆"}
              </button>
            </div>
            {watchlistCount > 0 && (
              <p className="text-slate-400 text-xs mt-1">👁 {watchlistCount} manager{watchlistCount !== 1 ? "s" : ""} følger denne rytter</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {rider.is_u25 && <span className="text-xs uppercase bg-blue-500/20 text-blue-700 px-2 py-0.5 rounded">U25</span>}
              <span className="text-xs uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">{typeLabel}</span>
              {rider.nationality_code && (
                <span className="text-slate-500 text-sm">
                  {getFlagEmoji(rider.nationality_code)} {getCountryName(rider.nationality_code)}
                </span>
              )}
              {age && <span className="text-slate-400 text-sm">{age} år</span>}
              {rider.height && <span className="text-slate-400 text-sm">{rider.height} cm</span>}
              {rider.weight && <span className="text-slate-400 text-sm">{rider.weight} kg</span>}
            </div>
            <p className="text-slate-500 text-sm mt-2">{rider.team ? `Hold: ${rider.team.name}` : "Fri agent"}</p>
            {activeAuction && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs bg-amber-500/15 text-amber-700 px-2 py-0.5 rounded font-medium">
                  ⚡ Aktiv auktion
                </span>
                <span className="text-xs text-slate-400">
                  Højeste bud: {activeAuction.current_price?.toLocaleString("da-DK")} CZ$
                </span>
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-amber-700 font-mono font-bold text-2xl">{(rider.uci_points * 4000)?.toLocaleString("da-DK")}</p>
            <p className="text-slate-400 text-xs mt-0.5">Værdi</p>
            {bestStat && <p className="text-slate-500 text-xs mt-2">Bedste: <span className="text-amber-700">{bestStat.label} ({rider[bestStat.key]})</span></p>}
          </div>
        </div>
        {auctionError && (
          <div className="mt-3 px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">
            {auctionError}
          </div>
        )}
        <div className="mt-5 pt-5 border-t border-slate-200 flex flex-col gap-3">
          {canAuction && !activeAuction && <AuctionButton rider={rider} isMyRider={isMyRider} onStart={startAuction} />}
          {activeAuction && canAuction && (
            <p className="text-slate-400 text-xs text-center py-1">Rytteren er allerede i en aktiv auktion</p>
          )}
          {rider.team_id && rider.team_id !== myTeamId && <DirectOfferButton rider={rider} />}
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {[{ key: "stats", label: "Evner" }, { key: "season", label: "Sæsonhistorik" }, { key: "results", label: "Løbsresultater" }, { key: "history", label: "Historik" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-amber-50 text-amber-700 border-amber-200" : "text-slate-500 border-slate-200 hover:text-slate-900 hover:border-slate-300"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stats" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          {STATS.map(s => <StatRow key={s.key} label={s.label} icon={s.icon} value={rider[s.key]} />)}
        </div>
      )}

      {tab === "season" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          {Object.keys(bySeason).length === 0 ? (
            <p className="text-slate-300 text-center py-8">Ingen historik endnu</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200">
                <th className="py-2 text-left text-slate-400 text-xs uppercase">År</th>
                <th className="py-2 text-right text-slate-400 text-xs uppercase">Sejre</th>
                <th className="py-2 text-right text-slate-400 text-xs uppercase">Top 3</th>
                <th className="py-2 text-right text-slate-400 text-xs uppercase">Præmier</th>
              </tr></thead>
              <tbody>
                {Object.entries(bySeason).map(([yr, d]) => (
                  <tr key={yr} className="border-b border-slate-100">
                    <td className="py-2 text-slate-500">{yr}</td>
                    <td className="py-2 text-right text-amber-700 font-mono">{d.wins}</td>
                    <td className="py-2 text-right text-slate-500 font-mono">{d.top3}</td>
                    <td className="py-2 text-right text-green-700 font-mono text-xs">+{d.totalPrize.toLocaleString("da-DK")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "results" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {results.length === 0 ? (
            <p className="text-slate-300 text-center py-8">Ingen løbsresultater endnu</p>
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-slate-400 text-[10px] uppercase">Løb</th>
                <th className="px-4 py-3 text-center text-slate-400 text-[10px] uppercase">Type</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase">Plac.</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase">Præmie</th>
              </tr></thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-slate-900 text-sm">{r.race?.name || "—"}</p>
                      <p className="text-slate-400 text-xs">{r.race?.start_date?.slice(0, 4) || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500 text-xs">{r.result_type || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-bold text-sm ${r.position === 1 ? "text-amber-700" : r.position <= 3 ? "text-slate-900" : "text-slate-500"}`}>
                        #{r.position}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 font-mono text-xs">
                      {r.prize_money ? `+${r.prize_money.toLocaleString("da-DK")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {history.length === 0 ? (
            <p className="text-slate-300 text-center py-8">Ingen handelshistorik endnu</p>
          ) : history.map((e, i) => (
            <HistoryEvent key={i} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryEvent({ event }) {
  const date = event.date
    ? new Date(event.date).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

  if (event.type === "auction") {
    const typeLabel = event.is_ai_sale ? "AI-salg" : event.is_guaranteed_sale ? "Garanteret salg" : "Auktion";
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-amber-600 text-lg mt-0.5">🏆</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-amber-700 font-medium">{typeLabel}</span>
            <span className="text-slate-400 text-xs">{date}</span>
          </div>
          <p className="text-slate-700 text-sm mt-0.5">
            <span className="font-medium">{event.buyer?.name || "Ukendt"}</span>
            <span className="text-slate-400"> vandt af </span>
            <span className="font-medium">{event.seller?.name || (event.is_ai_sale ? "AI-hold" : "Ukendt")}</span>
          </p>
          {event.price != null && (
            <p className="text-amber-700 font-mono text-xs mt-0.5">{event.price.toLocaleString("da-DK")} CZ$</p>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "transfer") {
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-blue-500 text-lg mt-0.5">↔</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-blue-700 font-medium">Transfer</span>
            <span className="text-slate-400 text-xs">{date}</span>
          </div>
          <p className="text-slate-700 text-sm mt-0.5">
            <span className="font-medium">{event.buyer?.name || "Ukendt"}</span>
            <span className="text-slate-400"> køber af </span>
            <span className="font-medium">{event.seller?.name || "Ukendt"}</span>
          </p>
          {event.price != null && (
            <p className="text-amber-700 font-mono text-xs mt-0.5">{event.price.toLocaleString("da-DK")} CZ$</p>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "swap") {
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-purple-500 text-lg mt-0.5">⇄</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-purple-700 font-medium">Bytte</span>
            <span className="text-slate-400 text-xs">{date}</span>
          </div>
          <p className="text-slate-700 text-sm mt-0.5">
            <span className="font-medium">{event.proposing_team?.name || "Ukendt"}</span>
            <span className="text-slate-400"> ↔ </span>
            <span className="font-medium">{event.receiving_team?.name || "Ukendt"}</span>
          </p>
          {event.cash_adjustment !== 0 && event.cash_adjustment != null && (
            <p className="text-slate-500 font-mono text-xs mt-0.5">
              Kontantjustering: {event.cash_adjustment > 0 ? "+" : ""}{event.cash_adjustment.toLocaleString("da-DK")} CZ$
            </p>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "loan") {
    const statusColors = {
      active: "text-green-700",
      completed: "text-slate-400",
      buyout: "text-amber-700",
      pending: "text-blue-600",
      cancelled: "text-red-500",
      rejected: "text-red-400",
    };
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-slate-400 text-lg mt-0.5">📋</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-slate-500 font-medium">Lån</span>
            <span className={`text-xs font-medium ${statusColors[event.status] || "text-slate-400"}`}>{event.status}</span>
            <span className="text-slate-400 text-xs">{date}</span>
          </div>
          <p className="text-slate-700 text-sm mt-0.5">
            <span className="font-medium">{event.to_team?.name || "Ukendt"}</span>
            <span className="text-slate-400"> lejer af </span>
            <span className="font-medium">{event.from_team?.name || "Ukendt"}</span>
          </p>
          <p className="text-slate-400 text-xs mt-0.5">
            Sæson {event.start_season}–{event.end_season}
            {event.loan_fee ? ` · ${event.loan_fee.toLocaleString("da-DK")} CZ$ gebyr` : ""}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
