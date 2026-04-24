import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL;

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = new Date() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "Lige nu";
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  if (d < 7) return `${d}d siden`;
  return new Date(dateStr).toLocaleDateString("da-DK");
}

function Countdown({ end, status }) {
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText("Afsluttet"); return; }
      setUrgent(diff < 600000);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setText(`${h}t ${m}m`);
      else if (m > 0) setText(`${m}m ${s}s`);
      else setText(`${s}s`);
    }
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [end]);
  return (
    <span className={`font-mono text-xs font-bold tabular-nums whitespace-nowrap
      ${status === "extended" ? "text-orange-700" : urgent ? "text-red-700" : "text-slate-500"}`}>
      {text}
    </span>
  );
}

const OFFER_STATUS = {
  pending:               { label: "Afventer svar",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  countered:             { label: "Modbud modtaget",  cls: "bg-orange-50 text-orange-700 border-orange-200" },
  awaiting_confirmation: { label: "Bekræft handel",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
  accepted:              { label: "Accepteret",        cls: "bg-green-50 text-green-700 border-green-200" },
  rejected:              { label: "Afvist",            cls: "bg-red-50 text-red-700 border-red-200" },
  withdrawn:             { label: "Trukket tilbage",   cls: "bg-slate-100 text-slate-400 border-slate-200" },
};

const LOAN_STATUS = {
  pending:   { label: "Afventer",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
  active:    { label: "Aktiv",      cls: "bg-green-50 text-green-700 border-green-200" },
  completed: { label: "Afsluttet", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  rejected:  { label: "Afvist",    cls: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Annulleret", cls: "bg-slate-100 text-slate-400 border-slate-200" },
  buyout:    { label: "Købt ud",    cls: "bg-purple-50 text-purple-700 border-purple-200" },
};

function SectionHeader({ title, count }) {
  return (
    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
      {count > 0 && <span className="text-xs font-mono text-slate-400">{count}</span>}
    </div>
  );
}

function EmptyState({ icon, title, sub }) {
  return (
    <div className="text-center py-14">
      <p className="text-4xl mb-3 text-slate-300">{icon}</p>
      <p className="text-slate-400 font-medium">{title}</p>
      {sub && <p className="text-sm mt-1 text-slate-300">{sub}</p>}
    </div>
  );
}

// Compact row used throughout all tabs
function Row({ badge, badgeCls, rider, riderId, detail, amount, time, children, onClick }) {
  const navigate = useNavigate();
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
      onClick={onClick}>
      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase whitespace-nowrap flex-shrink-0 ${badgeCls}`}>
        {badge}
      </span>
      <div className="flex-1 min-w-0">
        {riderId ? (
          <button
            className="text-sm font-medium text-slate-900 hover:text-amber-700 transition-colors text-left truncate max-w-full block"
            onClick={e => { e.stopPropagation(); navigate(`/riders/${riderId}`); }}>
            {rider}
          </button>
        ) : (
          <p className="text-sm font-medium text-slate-900 truncate">{rider}</p>
        )}
        {detail && <p className="text-xs text-slate-400 truncate">{detail}</p>}
      </div>
      {children}
      {amount != null && (
        <span className="text-amber-700 font-mono text-sm font-bold whitespace-nowrap flex-shrink-0">
          {amount.toLocaleString("da-DK")} CZ$
        </span>
      )}
      {time && <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">{time}</span>}
      <span className="text-slate-300 text-sm flex-shrink-0">→</span>
    </div>
  );
}

export default function ActivityPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("action");
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);

  const [activeAuctions, setActiveAuctions]     = useState([]);
  const [completedAuctions, setCompletedAuctions] = useState([]);
  const [sentOffers, setSentOffers]             = useState([]);
  const [receivedOffers, setReceivedOffers]     = useState([]);
  const [lendingLoans, setLendingLoans]         = useState([]);
  const [borrowingLoans, setBorrowingLoans]     = useState([]);
  const [historicalLoans, setHistoricalLoans]   = useState([]);
  const [watchlist, setWatchlist]               = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (!team) { setLoading(false); return; }
    setMyTeamId(team.id);

    const { data: { session } } = await supabase.auth.getSession();
    const headers = { Authorization: `Bearer ${session.access_token}` };

    const [activeRes, completedRes, offersData, loansData, watchlistRes, histLoansRes] = await Promise.all([
      supabase.from("auctions")
        .select(`id, current_price, calculated_end, status, seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, uci_points),
          seller:seller_team_id(name), current_bidder:current_bidder_id(name)`)
        .in("status", ["active", "extended"])
        .or(`seller_team_id.eq.${team.id},current_bidder_id.eq.${team.id}`)
        .order("calculated_end"),

      supabase.from("auctions")
        .select(`id, current_price, actual_end, status, seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, uci_points),
          seller:seller_team_id(name), winner:current_bidder_id(name)`)
        .eq("status", "completed")
        .or(`seller_team_id.eq.${team.id},current_bidder_id.eq.${team.id}`)
        .order("actual_end", { ascending: false })
        .limit(30),

      fetch(`${API}/api/transfers/my-offers`, { headers })
        .then(r => r.json()).catch(() => ({ sent: [], received: [] })),

      fetch(`${API}/api/loans`, { headers })
        .then(r => r.json()).catch(() => ({ lending: [], borrowing: [] })),

      supabase.from("rider_watchlist")
        .select(`id, created_at, rider:rider_id(id, firstname, lastname, uci_points, team:team_id(name))`)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),

      supabase.from("loan_agreements")
        .select(`id, loan_fee, start_season, end_season, status, updated_at,
          rider:rider_id(id, firstname, lastname, uci_points),
          from_team:from_team_id(id, name), to_team:to_team_id(id, name)`)
        .in("status", ["rejected", "cancelled", "completed", "buyout"])
        .or(`from_team_id.eq.${team.id},to_team_id.eq.${team.id}`)
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);

    setActiveAuctions(activeRes.data || []);
    setCompletedAuctions(completedRes.data || []);
    setSentOffers(offersData.sent || []);
    setReceivedOffers(offersData.received || []);
    setLendingLoans(loansData.lending || []);
    setBorrowingLoans(loansData.borrowing || []);
    setWatchlist(watchlistRes.data || []);
    setHistoricalLoans(histLoansRes.data || []);
    setLoading(false);
  }

  // "Kræver handling" — items that require the user's action
  const actionTransfers = [
    ...receivedOffers.filter(o => o.status === "pending"),
    ...sentOffers.filter(o => o.status === "countered"),
    ...receivedOffers.filter(o => o.status === "awaiting_confirmation" && !o.seller_confirmed),
    ...sentOffers.filter(o => o.status === "awaiting_confirmation" && !o.buyer_confirmed),
  ];
  const actionLoans = lendingLoans.filter(l => l.status === "pending");
  const urgentAuctions = activeAuctions.filter(a => {
    const diff = new Date(a.calculated_end) - new Date();
    return diff > 0 && diff < 3600000;
  });
  const actionCount = actionTransfers.length + actionLoans.length;

  // Transfers tab — split active vs history
  const activeReceivedOffers = receivedOffers.filter(o => ["pending", "countered", "awaiting_confirmation"].includes(o.status));
  const activeSentOffers     = sentOffers.filter(o => ["pending", "countered", "awaiting_confirmation"].includes(o.status));
  const histReceivedOffers   = receivedOffers.filter(o => ["accepted", "rejected"].includes(o.status));
  const histSentOffers       = sentOffers.filter(o => ["accepted", "rejected"].includes(o.status));

  // Watchlist — mark riders currently in an auction (not mine)
  const auctionRiderIds = new Set(
    activeAuctions
      .filter(a => a.seller_team_id !== myTeamId)
      .map(a => a.rider?.id).filter(Boolean)
  );

  const TABS = [
    { key: "action",    label: "Kræver handling", count: actionCount },
    { key: "auctions",  label: "Auktioner",       count: activeAuctions.length },
    { key: "transfers", label: "Transfers",        count: activeReceivedOffers.length + activeSentOffers.length },
    { key: "loans",     label: "Lån",              count: lendingLoans.length + borrowingLoans.length },
    { key: "watchlist", label: "Ønskeliste",       count: watchlist.length },
    { key: "history",   label: "Historik",         count: 0 },
  ];

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Min Aktivitet</h1>
        <p className="text-slate-400 text-sm">Dine markedshandlinger samlet ét sted</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 overflow-x-auto pb-px">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all border flex-shrink-0
              ${tab === t.key
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "text-slate-500 hover:text-slate-900 bg-white border-slate-200"}`}>
            {t.label}
            {t.count > 0 && (
              <span className={`text-xs font-mono rounded-full px-1.5 min-w-[18px] text-center leading-5
                ${tab === t.key
                  ? (t.key === "action" ? "bg-amber-700 text-white" : "bg-amber-200 text-amber-800")
                  : "bg-slate-100 text-slate-500"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── KRÆVER HANDLING ── */}
      {tab === "action" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {actionCount === 0 && urgentAuctions.length === 0 ? (
            <EmptyState icon="✓" title="Intet der kræver handling" sub="Du er opdateret på alle tilbud og aftaler" />
          ) : (
            <>
              {actionTransfers.length > 0 && (
                <>
                  <SectionHeader title="Tilbud der kræver svar" count={actionTransfers.length} />
                  {actionTransfers.map(o => {
                    const isSent = sentOffers.some(s => s.id === o.id);
                    const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                    const counterpart = isSent ? o.seller?.name : o.buyer?.name;
                    return (
                      <Row key={o.id}
                        badge={cfg.label} badgeCls={cfg.cls}
                        rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                        riderId={o.rider?.id}
                        detail={isSent ? `Til: ${counterpart}` : `Fra: ${counterpart}`}
                        amount={o.counter_amount ?? o.offer_amount}
                        time={timeAgo(o.updated_at)}
                        onClick={() => navigate("/transfers")} />
                    );
                  })}
                </>
              )}

              {actionLoans.length > 0 && (
                <>
                  <SectionHeader title="Lejeforslag der afventer dit svar" count={actionLoans.length} />
                  {actionLoans.map(l => (
                    <Row key={l.id}
                      badge="Lejeforslag" badgeCls="bg-purple-50 text-purple-700 border-purple-200"
                      rider={`${l.rider?.firstname} ${l.rider?.lastname}`}
                      riderId={l.rider?.id}
                      detail={`Fra: ${l.to_team?.name} · Sæson ${l.start_season}–${l.end_season}`}
                      amount={l.loan_fee || null}
                      time={timeAgo(l.updated_at)}
                      onClick={() => navigate("/transfers")} />
                  ))}
                </>
              )}

              {urgentAuctions.length > 0 && (
                <>
                  <SectionHeader title="Auktioner der slutter inden for 1 time" count={urgentAuctions.length} />
                  {urgentAuctions.map(a => {
                    const isSelling = a.seller_team_id === myTeamId;
                    const isWinning = a.current_bidder_id === myTeamId;
                    return (
                      <Row key={a.id}
                        badge={isSelling ? "Sælger" : isWinning ? "Vinder" : "Byder"}
                        badgeCls={isSelling ? "bg-blue-50 text-blue-700 border-blue-200"
                          : isWinning ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"}
                        rider={`${a.rider?.firstname} ${a.rider?.lastname}`}
                        riderId={a.rider?.id}
                        detail={isSelling
                          ? (a.current_bidder ? `Højeste byder: ${a.current_bidder.name}` : "Ingen bud endnu")
                          : `Sælger: ${a.seller?.name}`}
                        amount={a.current_price}
                        time={null}
                        onClick={() => navigate("/auctions")}>
                        <Countdown end={a.calculated_end} status={a.status} />
                      </Row>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── AUKTIONER ── */}
      {tab === "auctions" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {activeAuctions.length === 0 ? (
            <EmptyState icon="⚡" title="Ingen aktive auktioner" sub="Du byder ikke på nogen auktioner og sælger intet" />
          ) : (
            <>
              <SectionHeader title="Aktive auktioner" count={activeAuctions.length} />
              {activeAuctions.map(a => {
                const isSelling = a.seller_team_id === myTeamId;
                const isWinning = a.current_bidder_id === myTeamId;
                return (
                  <Row key={a.id}
                    badge={isSelling ? "Sælger" : isWinning ? "Vinder" : "Byder"}
                    badgeCls={isSelling ? "bg-blue-50 text-blue-700 border-blue-200"
                      : isWinning ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"}
                    rider={`${a.rider?.firstname} ${a.rider?.lastname}`}
                    riderId={a.rider?.id}
                    detail={isSelling
                      ? (a.current_bidder ? `Højeste byder: ${a.current_bidder.name}` : "Ingen bud endnu")
                      : `Sælger: ${a.seller?.name}`}
                    amount={a.current_price}
                    time={null}
                    onClick={() => navigate("/auctions")}>
                    <Countdown end={a.calculated_end} status={a.status} />
                  </Row>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── TRANSFERS ── */}
      {tab === "transfers" && (
        <div className="space-y-4">
          {activeReceivedOffers.length + activeSentOffers.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl">
              <EmptyState icon="↔" title="Ingen aktive transfers" sub="Tilbud du sender eller modtager vises her" />
            </div>
          )}

          {activeReceivedOffers.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <SectionHeader title="Modtaget tilbud" count={activeReceivedOffers.length} />
              {activeReceivedOffers.map(o => {
                const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                return (
                  <Row key={o.id}
                    badge={cfg.label} badgeCls={cfg.cls}
                    rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                    riderId={o.rider?.id}
                    detail={`Fra: ${o.buyer?.name}`}
                    amount={o.counter_amount ?? o.offer_amount}
                    time={timeAgo(o.updated_at)}
                    onClick={() => navigate("/transfers")} />
                );
              })}
            </div>
          )}

          {activeSentOffers.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <SectionHeader title="Sendt tilbud" count={activeSentOffers.length} />
              {activeSentOffers.map(o => {
                const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                return (
                  <Row key={o.id}
                    badge={cfg.label} badgeCls={cfg.cls}
                    rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                    riderId={o.rider?.id}
                    detail={`Til: ${o.seller?.name}`}
                    amount={o.counter_amount ?? o.offer_amount}
                    time={timeAgo(o.updated_at)}
                    onClick={() => navigate("/transfers")} />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── LÅN ── */}
      {tab === "loans" && (
        <div className="space-y-4">
          {lendingLoans.length + borrowingLoans.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl">
              <EmptyState icon="⇄" title="Ingen aktive lejeaftaler" sub="Lejeaftaler du indgår vises her" />
            </div>
          ) : (
            <>
              {lendingLoans.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <SectionHeader title="Jeg udlåner" count={lendingLoans.length} />
                  {lendingLoans.map(l => {
                    const cfg = LOAN_STATUS[l.status] || LOAN_STATUS.active;
                    return (
                      <Row key={l.id}
                        badge={cfg.label} badgeCls={cfg.cls}
                        rider={`${l.rider?.firstname} ${l.rider?.lastname}`}
                        riderId={l.rider?.id}
                        detail={`Til: ${l.to_team?.name} · Sæson ${l.start_season}–${l.end_season}`}
                        amount={l.loan_fee || null}
                        time={timeAgo(l.updated_at)}
                        onClick={() => navigate("/transfers")} />
                    );
                  })}
                </div>
              )}

              {borrowingLoans.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <SectionHeader title="Jeg låner" count={borrowingLoans.length} />
                  {borrowingLoans.map(l => {
                    const cfg = LOAN_STATUS[l.status] || LOAN_STATUS.active;
                    return (
                      <Row key={l.id}
                        badge={cfg.label} badgeCls={cfg.cls}
                        rider={`${l.rider?.firstname} ${l.rider?.lastname}`}
                        riderId={l.rider?.id}
                        detail={`Fra: ${l.from_team?.name} · Sæson ${l.start_season}–${l.end_season}`}
                        amount={l.loan_fee || null}
                        time={timeAgo(l.updated_at)}
                        onClick={() => navigate("/transfers")} />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ØNSKELISTE ── */}
      {tab === "watchlist" && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => navigate("/watchlist")}
              className="text-sm text-amber-700 hover:text-amber-900 font-medium transition-colors">
              Gå til fuld Ønskeliste →
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {watchlist.length === 0 ? (
              <EmptyState icon="⭐" title="Din ønskeliste er tom"
                sub="Tilføj ryttere fra rytterdatabasen ved at klikke ⭐" />
            ) : (
              watchlist.map(entry => {
                const r = entry.rider;
                const inAuction = auctionRiderIds.has(r?.id);
                return (
                  <div key={entry.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <button onClick={() => navigate(`/riders/${r?.id}`)}
                        className="text-sm font-medium text-slate-900 hover:text-amber-700 transition-colors text-left block truncate">
                        {r?.firstname} {r?.lastname}
                      </button>
                      <p className="text-xs text-slate-400 truncate">{r?.team?.name || "Fri agent"}</p>
                    </div>
                    {inAuction && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap flex-shrink-0">
                        I auktion
                      </span>
                    )}
                    <span className="text-amber-700 font-mono text-sm font-bold whitespace-nowrap flex-shrink-0">
                      {r?.uci_points?.toLocaleString("da-DK")} UCI
                    </span>
                    <button onClick={() => navigate(`/riders/${r?.id}`)}
                      className="text-slate-300 hover:text-amber-700 text-sm transition-colors flex-shrink-0">
                      →
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── HISTORIK ── */}
      {tab === "history" && (
        <div className="space-y-4">
          {completedAuctions.length + histSentOffers.length + histReceivedOffers.length + historicalLoans.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl">
              <EmptyState icon="◎" title="Ingen historik endnu" sub="Afsluttede handler vises her" />
            </div>
          ) : (
            <>
              {completedAuctions.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <SectionHeader title="Auktioner" count={completedAuctions.length} />
                  {completedAuctions.map(a => {
                    const iWon  = a.current_bidder_id === myTeamId;
                    const iSold = a.seller_team_id === myTeamId;
                    const noSale = !a.current_bidder_id;
                    const badge = iWon ? "Købt" : iSold && !noSale ? "Solgt" : iSold && noSale ? "Ingen bud" : "Tabt";
                    const badgeCls = iWon
                      ? "bg-green-50 text-green-700 border-green-200"
                      : iSold && !noSale ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-slate-100 text-slate-400 border-slate-200";
                    return (
                      <Row key={a.id}
                        badge={badge} badgeCls={badgeCls}
                        rider={`${a.rider?.firstname} ${a.rider?.lastname}`}
                        riderId={a.rider?.id}
                        detail={iWon ? `Fra: ${a.seller?.name}` : iSold && !noSale ? `Til: ${a.winner?.name}` : ""}
                        amount={noSale ? null : a.current_price}
                        time={timeAgo(a.actual_end)}
                        onClick={() => a.rider?.id && navigate(`/riders/${a.rider.id}`)} />
                    );
                  })}
                </div>
              )}

              {(histReceivedOffers.length + histSentOffers.length) > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <SectionHeader title="Transfers" count={histReceivedOffers.length + histSentOffers.length} />
                  {[
                    ...histReceivedOffers.map(o => ({ ...o, _dir: "received" })),
                    ...histSentOffers.map(o => ({ ...o, _dir: "sent" })),
                  ]
                    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
                    .map(o => {
                      const cfg = OFFER_STATUS[o.status] || OFFER_STATUS.pending;
                      const isSent = o._dir === "sent";
                      return (
                        <Row key={`${o._dir}-${o.id}`}
                          badge={cfg.label} badgeCls={cfg.cls}
                          rider={`${o.rider?.firstname} ${o.rider?.lastname}`}
                          riderId={o.rider?.id}
                          detail={isSent ? `Til: ${o.seller?.name}` : `Fra: ${o.buyer?.name}`}
                          amount={o.offer_amount}
                          time={timeAgo(o.updated_at)}
                          onClick={() => o.rider?.id && navigate(`/riders/${o.rider.id}`)} />
                      );
                    })}
                </div>
              )}

              {historicalLoans.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <SectionHeader title="Lån" count={historicalLoans.length} />
                  {historicalLoans.map(l => {
                    const cfg = LOAN_STATUS[l.status] || LOAN_STATUS.completed;
                    const isLender = l.from_team?.id === myTeamId;
                    return (
                      <Row key={l.id}
                        badge={cfg.label} badgeCls={cfg.cls}
                        rider={`${l.rider?.firstname} ${l.rider?.lastname}`}
                        riderId={l.rider?.id}
                        detail={isLender
                          ? `Udlånt til: ${l.to_team?.name} · Sæson ${l.start_season}–${l.end_season}`
                          : `Lånt fra: ${l.from_team?.name} · Sæson ${l.start_season}–${l.end_season}`}
                        amount={l.loan_fee || null}
                        time={timeAgo(l.updated_at)}
                        onClick={() => l.rider?.id && navigate(`/riders/${l.rider.id}`)} />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
