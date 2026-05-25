import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";
import { statBg } from "../lib/statBg";
import { Flag } from "../components/Flag";
import { getRiderMarketValue } from "../lib/marketValues";
import { formatNumber, formatDate } from "../lib/intl";
import PotentialeStars from "../components/PotentialeStars";
import TeamTransferHistoryTab from "../components/TeamTransferHistoryTab";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
      {children}{active && <span className="ml-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

function RiderActionModal({ rider, onClose, onAction }) {
  const { t } = useTranslation("team");
  const riderValue = getRiderMarketValue(rider);
  const [auctionPrice, setAuctionPrice] = useState(riderValue);
  const [transferPrice, setTransferPrice] = useState(riderValue);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState("auction");
  const guaranteedPrice = Math.floor(riderValue * 0.5);

  async function startAuction() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, starting_price: auctionPrice }),
    });
    const data = await res.json();
    if (res.ok) { setMsg(t("actionModal.auction.successMsg")); setTimeout(() => { onAction(); onClose(); }, 1500); }
    else setMsg(`${t("actionModal.errorPrefix")}${data.error}`);
    setLoading(false);
  }

  async function sellToBank() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, is_guaranteed_sale: true }),
    });
    const data = await res.json();
    if (res.ok) { setMsg(t("actionModal.bank.successMsg", { price: formatNumber(guaranteedPrice) })); setTimeout(() => { onAction(); onClose(); }, 2000); }
    else setMsg(`${t("actionModal.errorPrefix")}${data.error}`);
    setLoading(false);
  }

  async function listTransfer() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, asking_price: transferPrice }),
    });
    const data = await res.json();
    if (res.ok) { setMsg(t("actionModal.transfer.successMsg")); setTimeout(() => { onAction(); onClose(); }, 1500); }
    else setMsg(`${t("actionModal.errorPrefix")}${data.error}`);
    setLoading(false);
  }

  const tabLabels = {
    auction: t("actionModal.tabs.auction"),
    transfer: t("actionModal.tabs.transfer"),
    bank: t("actionModal.tabs.bank"),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-cz-card border border-cz-border rounded-2xl w-full max-w-md">
        <div className="flex items-start justify-between p-5 border-b border-cz-border">
          <div>
            <h2 className="text-cz-1 font-bold text-lg">{rider.firstname} {rider.lastname}</h2>
            <p className="text-cz-accent-t font-mono text-sm mt-0.5">{formatNumber(riderValue)} CZ$</p>
          </div>
          <button onClick={onClose} className="text-cz-3 hover:text-cz-1 text-xl">×</button>
        </div>
        <div className="p-5 border-b border-cz-border">
          {rider.potentiale != null && (
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-cz-border">
              <span className="text-cz-3 text-xs">{t("actionModal.potentialLabel")}</span>
              <PotentialeStars value={rider.potentiale} birthdate={rider.birthdate} showValue />
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {STATS.map((key, i) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-cz-3 text-xs">{STAT_LABELS[i]}</span>
                <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(rider[key] || 0)}`}>
                  {rider[key] || "-"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5">
          <div className="flex gap-2 mb-4 flex-wrap">
            {["auction","transfer","bank"].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${activeTab === tab ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 border-cz-border hover:text-cz-1"}`}>
                {tabLabels[tab]}
              </button>
            ))}
          </div>
          {activeTab === "auction" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.auction.description")}</p>
              <div className="flex gap-2">
                <input type="number" value={auctionPrice} min={riderValue} onChange={e => setAuctionPrice(parseInt(e.target.value))}
                  className="flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={startAuction} disabled={loading}
                  className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {loading ? t("actionModal.loadingShort") : t("actionModal.auction.startButton")}
                </button>
              </div>
            </div>
          )}
          {activeTab === "transfer" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.transfer.description")}</p>
              <div className="flex gap-2">
                <input type="number" value={transferPrice} min={1} onChange={e => setTransferPrice(parseInt(e.target.value))}
                  className="flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={listTransfer} disabled={loading}
                  className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                  {loading ? t("actionModal.loadingShort") : t("actionModal.transfer.listButton")}
                </button>
              </div>
            </div>
          )}
          {activeTab === "bank" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">
                {t("actionModal.bank.description", { price: formatNumber(guaranteedPrice) })}
              </p>
              <button onClick={sellToBank} disabled={loading}
                className="w-full px-4 py-2 bg-cz-info/20 text-cz-info border border-cz-info/30 font-bold rounded-lg text-sm hover:bg-cz-info/30 disabled:opacity-50">
                {loading ? t("actionModal.loadingShort") : t("actionModal.bank.sellButton", { price: formatNumber(guaranteedPrice) })}
              </button>
            </div>
          )}
          {msg && <p className={`text-sm mt-3 ${msg.startsWith("✅") ? "text-cz-success" : "text-cz-danger"}`}>{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function SquadTab({ riders, onSelectRider, windowOpen }) {
  const { t } = useTranslation("team");
  const [showIncoming, setShowIncoming] = useState(true);
  const [showOutgoing, setShowOutgoing] = useState(true);

  // Incoming = riders with pending_team_id = myTeam but team_id != myTeam
  // Outgoing = riders with team_id = myTeam but pending different team
  const incomingRiders = riders.filter(r => r._isIncoming);
  const outgoingRiders = riders.filter(r => r._isOutgoing);

  const displayRidersBase = [
    ...riders.filter(r => !r._isIncoming && !r._isOutgoing),
    ...(showIncoming ? incomingRiders : []),
    ...(showOutgoing ? outgoingRiders : []),
  ];
  const riderFilters = useClientRiderFilters(displayRidersBase);
  const displayRiders = riderFilters.filtered;
  const sort = riderFilters.filters.sort;
  const sortDir = riderFilters.filters.sort_dir;
  function handleSort(key) {
    if (sort === key) riderFilters.onChange("sort_dir", sortDir === "desc" ? "asc" : "desc");
    else { riderFilters.onChange("sort", key); riderFilters.onChange("sort_dir", "desc"); }
  }

  const loanedInRiders  = riders.filter(r => r._isLoanedIn);
  const loanedOutRiders = riders.filter(r => r._isLoanedOut);
  const hasTransfers = incomingRiders.length > 0 || outgoingRiders.length > 0 || loanedInRiders.length > 0 || loanedOutRiders.length > 0;

  return (
    <div>
      {/* FM-style toggle */}
      {hasTransfers && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {incomingRiders.length > 0 && (
            <button onClick={() => setShowIncoming(!showIncoming)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${showIncoming
                  ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                  : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
              <span className="w-2 h-2 rounded-full bg-green-400" />
              {t("squad.incomingTransfers", { count: incomingRiders.length })}
            </button>
          )}
          {outgoingRiders.length > 0 && (
            <button onClick={() => setShowOutgoing(!showOutgoing)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${showOutgoing
                  ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
                  : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
              <span className="w-2 h-2 rounded-full bg-red-400" />
              {t("squad.outgoingTransfers", { count: outgoingRiders.length })}
            </button>
          )}
          {loanedInRiders.length > 0 && (
            <span className="flex items-center gap-2 px-3 py-1.5 text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              {t("squad.loanedIn", { count: loanedInRiders.length })}
            </span>
          )}
          {loanedOutRiders.length > 0 && (
            <span className="flex items-center gap-2 px-3 py-1.5 text-xs bg-cz-warning/10 text-cz-warning border border-cz-warning/20 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              {t("squad.loanedOut", { count: loanedOutRiders.length })}
            </span>
          )}
          {!windowOpen && (
            <span className="px-3 py-1.5 text-xs text-cz-3 bg-cz-subtle border border-cz-border rounded-lg">
              {t("squad.windowClosedHint")}
            </span>
          )}
        </div>
      )}

      {displayRiders.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">🚴</p>
          <p>{t("squad.emptyState")}</p>
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <SortTh sortKey="firstname" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider">{t("squad.headers.rider")}</SortTh>
                  <SortTh sortKey="uci_points" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium">{t("squad.headers.value")}</SortTh>
                  <th className="px-3 py-3 text-right text-cz-3 font-medium">{t("squad.headers.salary")}</th>
                  <SortTh sortKey="potentiale" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium">{t("squad.headers.potential")}</SortTh>
                  {STATS.map((key, i) => (
                    <SortTh key={key} sortKey={key} sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-1.5 py-3 text-center font-medium w-10">{STAT_LABELS[i]}</SortTh>
                  ))}
                  <th className="px-3 py-3 text-center text-cz-3 font-medium">{t("squad.headers.action")}</th>
                </tr>
              </thead>
              <tbody>
                {displayRiders.map(r => (
                  <tr key={r.id}
                    className={`border-b border-cz-border hover:bg-cz-subtle
                      ${r._isIncoming  ? "bg-cz-success-bg0/3"  :
                        r._isOutgoing  ? "bg-cz-danger-bg0/3"    :
                        r._isLoanedIn  ? "bg-purple-500/3" :
                        r._isLoanedOut ? "bg-cz-warning/10" : ""}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r._isIncoming  && <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />}
                        {r._isOutgoing  && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                        {r._isLoanedIn  && <span className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />}
                        {r._isLoanedOut && <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />}
                        {r.nationality_code && <Flag code={r.nationality_code} className="flex-shrink-0" />}
                        <RiderLink id={r.id}
                          className="text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors">
                          {r.firstname} {r.lastname}
                        </RiderLink>
                        {r.is_u25       && <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">{t("squad.tags.u25")}</span>}
                        {r._isIncoming  && <span className="text-[9px] uppercase bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded">{t("squad.tags.incoming")}</span>}
                        {r._isOutgoing  && <span className="text-[9px] uppercase bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded">{t("squad.tags.outgoing")}</span>}
                        {r._isLoanedIn  && (
                          <span className="text-[9px] uppercase bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded"
                            title={t("squad.tooltips.loanedFrom", { team: r._loanInInfo?.from_team?.name, start: r._loanInInfo?.start_season, end: r._loanInInfo?.end_season })}>
                            {t("squad.tags.loanedIn")}
                          </span>
                        )}
                        {r._isLoanedOut && (
                          <span className="text-[9px] uppercase bg-cz-warning/20 text-cz-warning px-1.5 py-0.5 rounded"
                            title={t("squad.tooltips.loanedTo", { team: r._loanOutInfo?.to_team?.name, start: r._loanOutInfo?.start_season, end: r._loanOutInfo?.end_season })}>
                            {t("squad.tags.loanedOut")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-cz-accent-t font-mono text-sm font-bold">
                      {formatNumber(getRiderMarketValue(r))}
                    </td>
                    <td className="px-3 py-2.5 text-right text-cz-2 font-mono text-xs">{r.salary || 0}</td>
                    <td className="px-3 py-2.5">
                      <PotentialeStars value={r.potentiale} birthdate={r.birthdate} />
                    </td>
                    {STATS.map(key => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(r[key] || 0)}`}>
                          {r[key] || "-"}
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-center">
                      {!r._isIncoming && (
                        <button onClick={() => onSelectRider(r)}
                          className="px-3 min-h-[44px] bg-cz-subtle hover:bg-cz-subtle text-cz-2 hover:text-cz-1 rounded text-xs transition-all border border-cz-border whitespace-nowrap">
                          {t("squad.actionButton")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EconomyTab({ team, riders, transactions }) {
  const { t } = useTranslation("team");
  const totalSalary = riders.filter(r => !r._isIncoming).reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = riders.filter(r => !r._isIncoming).reduce((s, r) => s + getRiderMarketValue(r), 0);
  const activeRiderCount = riders.filter(r => !r._isIncoming).length;
  const sponsorIncome = team?.sponsor_income || 100;
  const netPerSeason  = sponsorIncome - totalSalary;
  const typeLabel = (type) => t(`economy.txType.${type}`, { defaultValue: type });
  const typeColor = {
    prize:"text-cz-success", sponsor:"text-cz-info", transfer_in:"text-cz-accent-t",
    transfer_out:"text-cz-danger", salary:"text-cz-warning", interest:"text-cz-danger",
  };
  const breakdown = transactions.reduce((acc, tx) => {
    acc[tx.type] = (acc[tx.type] || 0) + (tx.amount || 0);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t("economy.kpi.balance"), value: t("economy.amount", { value: formatNumber(team?.balance ?? 0) }), color: team?.balance >= 0 ? "text-cz-accent-t" : "text-cz-danger" },
          { label: t("economy.kpi.teamValue"), value: t("economy.amount", { value: formatNumber(totalValue) }), color: "text-cz-1" },
          { label: t("economy.kpi.salaryPerSeason"), value: t("economy.amount", { value: formatNumber(totalSalary) }), color: "text-cz-warning" },
          { label: t("economy.kpi.sponsorPerSeason"), value: t("economy.amount", { value: formatNumber(sponsorIncome) }), color: "text-cz-info" },
        ].map(s => (
          <div key={s.label} className="bg-cz-card border border-cz-border rounded-xl p-4">
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`font-mono font-bold text-sm ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5">
        <h3 className="text-cz-1 font-semibold text-sm mb-4">{t("economy.forecast.title")}</h3>
        <div className="space-y-2">
          {[
            { label: t("economy.forecast.sponsorIncome"), value: t("economy.amountSigned", { sign: "+", value: formatNumber(sponsorIncome) }), color: "text-cz-info" },
            { label: t("economy.forecast.salaries", { count: activeRiderCount }), value: t("economy.amountSigned", { sign: "-", value: formatNumber(totalSalary) }), color: "text-cz-warning" },
          ].map(s => (
            <div key={s.label} className="flex justify-between items-center py-2 border-b border-cz-border">
              <span className="text-cz-2 text-sm">{s.label}</span>
              <span className={`font-mono font-bold ${s.color}`}>{s.value}</span>
            </div>
          ))}
          <div className="flex justify-between items-center py-2 bg-cz-subtle rounded-lg px-3 mt-1">
            <span className={`text-sm font-semibold ${netPerSeason >= 0 ? "text-cz-1" : "text-cz-danger"}`}>
              {t("economy.forecast.net")}
            </span>
            <span className={`font-mono font-bold ${netPerSeason >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
              {t("economy.amountSigned", { sign: netPerSeason >= 0 ? "+" : "", value: formatNumber(netPerSeason) })}
            </span>
          </div>
        </div>
        {netPerSeason < 0 && (
          <div className="mt-3 bg-cz-danger-bg border border-cz-danger/30 rounded-lg px-4 py-2.5">
            <p className="text-cz-danger text-xs">{t("economy.forecast.warning")}</p>
          </div>
        )}
      </div>

      {Object.keys(breakdown).length > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <h3 className="text-cz-1 font-semibold text-sm mb-4">{t("economy.breakdown.title")}</h3>
          <div className="space-y-2">
            {Object.entries(breakdown).sort((a,b) => b[1]-a[1]).map(([type, amount]) => (
              <div key={type} className="flex justify-between items-center py-2 border-b border-cz-border last:border-0">
                <span className="text-cz-2 text-sm">{typeLabel(type)}</span>
                <span className={`font-mono font-bold text-sm ${typeColor[type] || (amount >= 0 ? "text-cz-success" : "text-cz-danger")}`}>
                  {t("economy.amountSigned", { sign: amount >= 0 ? "+" : "", value: formatNumber(amount) })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-cz-border">
          <h3 className="text-cz-1 font-semibold text-sm">{t("economy.history.title")}</h3>
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-10 text-cz-3 text-sm">{t("economy.history.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-cz-border">
              <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("economy.history.headers.date")}</th>
              <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("economy.history.headers.type")}</th>
              <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">{t("economy.history.headers.description")}</th>
              <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">{t("economy.history.headers.amount")}</th>
            </tr></thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id} className="border-b border-cz-border hover:bg-cz-subtle">
                  <td className="px-4 py-2.5 text-cz-3 text-xs">{formatDate(tx.created_at, "short")}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded uppercase
                      ${typeColor[tx.type] ? typeColor[tx.type].replace("text-","bg-").replace("400","500/10") + " " + typeColor[tx.type] : "bg-cz-subtle text-cz-2"}`}>
                      {typeLabel(tx.type)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-cz-2 text-sm hidden sm:table-cell">{tx.description}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold ${tx.amount > 0 ? "text-cz-success" : "text-cz-danger"}`}>
                    {t("economy.amountSigned", { sign: tx.amount > 0 ? "+" : "", value: formatNumber(tx.amount ?? 0) })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function TeamPage() {
  const { t } = useTranslation("team");
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("squad");
  const [selectedRider, setSelectedRider] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("*").eq("user_id", user.id).single();
    if (!myTeam) { setLoading(false); return; }
    setTeam(myTeam);

    const [ridersRes, pendingRes, finRes, windowRes, loansOutRes, loansInRes] = await Promise.all([
      supabase.from("riders")
        .select(`id, firstname, lastname, birthdate, uci_points, salary, prize_earnings_bonus, is_u25, pending_team_id, nationality_code, potentiale, ${STATS.join(", ")}`)
        .eq("team_id", myTeam.id)
        .order("uci_points", { ascending: false }),
      supabase.from("riders")
        .select(`id, firstname, lastname, birthdate, uci_points, salary, prize_earnings_bonus, is_u25, pending_team_id, nationality_code, potentiale, ${STATS.join(", ")}`)
        .eq("pending_team_id", myTeam.id)
        .order("uci_points", { ascending: false }),
      supabase.from("finance_transactions")
        .select("*").eq("team_id", myTeam.id)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("transfer_windows")
        .select("status").order("created_at", { ascending: false }).limit(1).single(),
      // Riders we're lending out
      supabase.from("loan_agreements")
        .select("rider_id, to_team:to_team_id(name), start_season, end_season")
        .eq("from_team_id", myTeam.id).eq("status", "active"),
      // Riders we're borrowing
      supabase.from("loan_agreements")
        .select(`rider:rider_id(id, firstname, lastname, birthdate, uci_points, salary, prize_earnings_bonus, is_u25, nationality_code, potentiale, ${STATS.join(", ")}), from_team:from_team_id(name), start_season, end_season, buy_option_price`)
        .eq("to_team_id", myTeam.id).eq("status", "active"),
    ]);

    const loanedOutIds = new Set((loansOutRes.data || []).map(l => l.rider_id));
    const loanedOutMap = Object.fromEntries((loansOutRes.data || []).map(l => [l.rider_id, l]));

    const currentRiders = (ridersRes.data || []).map(r => ({
      ...r,
      _isOutgoing:  r.pending_team_id && r.pending_team_id !== myTeam.id,
      _isLoanedOut: loanedOutIds.has(r.id),
      _loanOutInfo: loanedOutMap[r.id] || null,
    }));
    const incomingRiders = (pendingRes.data || []).map(r => ({ ...r, _isIncoming: true }));
    const loanedInRiders = (loansInRes.data || []).map(l => ({
      ...l.rider,
      _isLoanedIn:  true,
      _loanInInfo:  { from_team: l.from_team, start_season: l.start_season, end_season: l.end_season, buy_option_price: l.buy_option_price },
    }));

    setRiders([...currentRiders, ...incomingRiders, ...loanedInRiders]);
    setTransactions(finRes.data || []);
    setWindowOpen(windowRes.data?.status === "open");
    setLoading(false);
  }

  const currentRiders = riders.filter(r => !r._isIncoming);
  const totalSalary = currentRiders.reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = currentRiders.reduce((s, r) => s + getRiderMarketValue(r), 0);
  const incomingCount = riders.filter(r => r._isIncoming).length;
  const outgoingCount = riders.filter(r => r._isOutgoing).length;

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  const tabs = [
    { key: "squad", label: t("tabs.squad", { count: currentRiders.length }) },
    { key: "economy", label: t("tabs.economy") },
    { key: "transfers", label: t("tabs.transfers") },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-cz-1">{team?.name || t("page.fallbackTitle")}</h1>
          <span className={`text-xs px-2 py-1 rounded-full border ${
            windowOpen
              ? "bg-cz-success-bg text-cz-success border-cz-success/30"
              : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
            {windowOpen ? t("page.windowOpen") : t("page.windowClosed")}
          </span>
        </div>
        {team?.manager_name && (
          <p className="text-cz-2 text-sm mt-0.5">{t("page.managerLabel", { name: team.manager_name })}</p>
        )}
        <div className="flex gap-4 mt-1 flex-wrap text-sm">
          <span className="text-cz-accent-t font-mono font-bold">{t("page.balance", { value: formatNumber(team?.balance ?? 0) })}</span>
          <span className="text-cz-3">{t("page.division", { n: team?.division })}</span>
          <span className="text-cz-3">{t("page.ridersCount", { count: currentRiders.length })}</span>
          {incomingCount > 0 && <span className="text-cz-success text-xs">{t("page.incomingCount", { count: incomingCount })}</span>}
          {outgoingCount > 0 && <span className="text-cz-danger text-xs">{t("page.outgoingCount", { count: outgoingCount })}</span>}
          <span className="text-cz-3">{t("page.salaryPerSeason", { value: formatNumber(totalSalary) })}</span>
          <span className="text-cz-3">{t("page.teamValue", { value: formatNumber(totalValue) })}</span>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${activeTab === tab.key ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "squad" && (
        <SquadTab riders={riders} onSelectRider={setSelectedRider} windowOpen={windowOpen} />
      )}
      {activeTab === "economy" && (
        <EconomyTab team={team} riders={riders} transactions={transactions} />
      )}
      {activeTab === "transfers" && team?.id && (
        <TeamTransferHistoryTab teamId={team.id} />
      )}

      {selectedRider && (
        <RiderActionModal rider={selectedRider} onClose={() => setSelectedRider(null)} onAction={loadAll} />
      )}
    </div>
  );
}

export default TeamPage;
