import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import NationCell from "../components/rider/NationCell";
import { formatNumber, formatDate } from "../lib/intl";

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
  return formatDate(dateStr);
}

function isAuctionSeller(auction, teamId) {
  return auction?.seller_team_id === teamId && auction?.rider?.team_id === teamId;
}

// #244: self-purchase = manageren er BÅDE sælger og vinder. Skal vises neutralt
// (ingen +/- prefix, "(selv)"-badge) så det er tydeligt at handlen er en intern
// rytter-tilbagekøb og ikke et reelt nettoflow.
function isSelfPurchase(auction, teamId) {
  if (!auction?.current_bidder_id || !teamId) return false;
  return auction.current_bidder_id === teamId && auction.seller_team_id === teamId;
}

function getAuctionLeaderId(auction) {
  if (auction?.current_bidder_id) return auction.current_bidder_id;
  if (!auction?.is_guaranteed_sale && auction?.seller_team_id && auction?.rider?.team_id !== auction.seller_team_id) {
    return auction.seller_team_id;
  }
  return null;
}

export default function AuctionHistoryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | won | sold | lost
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // #246: stats fetched separat så de er korrekte på tværs af pagination —
  // tidligere blev de udregnet fra current page's 30 rækker, hvilket gjorde
  // counters inkonsistente med fane-filteret og misvisende totalt.
  const [stats, setStats] = useState({ wins: 0, sales: 0, spent: 0, earned: 0 });
  const PER_PAGE = 30;

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (t) setMyTeamId(t.id);
  }

  async function loadAuctions() {
    if (!myTeamId) return;
    setLoading(true);
    let query = supabase
      .from("auctions")
      .select(`id, current_price, actual_end, status, is_guaranteed_sale, seller_team_id, current_bidder_id,
        rider:rider_id(id, firstname, lastname, uci_points, salary, prize_earnings_bonus, is_u25, nationality_code, team_id),
        seller:seller_team_id(id, name),
        winner:current_bidder_id(id, name)`,
        { count: "exact" })
      .eq("status", "completed");

    // #246: filter på server-siden så pagination + count matcher den valgte fane.
    // Tidligere blev filteret applied client-side EFTER pagination, så "Købt" kunne
    // vise 0-1 rytter selvom manageren havde vundet flere — afhængigt af om de
    // tilfældigt lå på den side SQL'en hentede.
    if (filter === "won") {
      query = query.eq("current_bidder_id", myTeamId);
    } else if (filter === "sold") {
      query = query.eq("seller_team_id", myTeamId);
    } else if (filter === "lost") {
      query = query.neq("current_bidder_id", myTeamId).neq("seller_team_id", myTeamId);
    }

    query = query
      .order("actual_end", { ascending: false })
      .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

    const { data, count } = await query;
    setAuctions(data || []);
    setTotal(count || 0);
    setLoading(false);
  }

  // #246: aggregat-stats korrekt på tværs af alle ikke-kun-aktuel-side
  // afsluttede auktioner. Henter prisrækker for vundne + solgte og summerer
  // klient-side (Supabase REST har ikke SUM aggregate uden RPC).
  // #244: self-purchases (sælger=køber) tæller som Win OG Sale i counters
  // (begge dele er sande), men ekskluderes fra Brugt/Tjent — der er intet
  // reelt nettoflow når manageren køber sin egen rytter tilbage.
  async function loadStats() {
    if (!myTeamId) return;
    const [wonRes, soldRes] = await Promise.all([
      supabase
        .from("auctions")
        .select("current_price, seller_team_id", { count: "exact" })
        .eq("status", "completed")
        .eq("current_bidder_id", myTeamId),
      supabase
        .from("auctions")
        .select("current_price, current_bidder_id", { count: "exact" })
        .eq("status", "completed")
        .eq("seller_team_id", myTeamId)
        .not("current_bidder_id", "is", null),
    ]);
    const wins = wonRes.count || 0;
    const sales = soldRes.count || 0;
    const spent = (wonRes.data || [])
      .filter(a => a.seller_team_id !== myTeamId)
      .reduce((s, a) => s + (a.current_price || 0), 0);
    const earned = (soldRes.data || [])
      .filter(a => a.current_bidder_id !== myTeamId)
      .reduce((s, a) => s + (a.current_price || 0), 0);
    setStats({ wins, sales, spent, earned });
  }

  useEffect(() => { loadMyTeam(); }, []);
  useEffect(() => { loadAuctions(); loadStats(); }, [filter, page, myTeamId]);

  // #246: hold pagination-state synkron med filter — uden dette kunne man stå
  // på side 5 i "Alle" og skifte til "Købt" som kun har 1 side, og lande på
  // tom side 5.
  useEffect(() => { setPage(1); }, [filter]);

  const { wins: myWins, sales: mySales, spent: totalSpent, earned: totalEarned } = stats;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1 mb-3">{t("nav.item.auctions")}</h1>
        <div className="flex gap-2">
          <NavLink to="/auctions" end
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                isActive
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            Aktive
          </NavLink>
          <NavLink to="/auctions/history"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                isActive
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            Historik ({total})
          </NavLink>
        </div>
      </div>

      {/* My stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Købt", value: myWins, color: "text-cz-accent-t" },
          { label: "Solgt", value: mySales, color: "text-cz-info" },
          { label: "Brugt", value: `${formatNumber(totalSpent)} CZ$`, color: "text-cz-danger" },
          { label: "Tjent", value: `${formatNumber(totalEarned)} CZ$`, color: "text-cz-success" },
        ].map(s => (
          <div key={s.label} className="bg-cz-card border border-cz-border rounded-xl p-3 text-center">
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`font-mono font-bold text-sm ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: "all", label: "Alle" },
          { key: "won", label: `Købt (${myWins})` },
          { key: "sold", label: `Solgt (${mySales})` },
        ].map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === t.key
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : auctions.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◈</p>
          <p>
            {filter === "won" ? "Du har ikke vundet nogen auktioner endnu"
              : filter === "sold" ? "Du har ikke solgt nogen ryttere endnu"
              : filter === "lost" ? "Ingen tabte auktioner i historikken"
              : "Ingen afsluttede auktioner endnu"}
          </p>
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="px-2 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">Nation</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">Rytter</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">Sælger</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">Vinder</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">Pris</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase hidden md:table-cell">Tidspunkt</th>
              </tr>
            </thead>
            <tbody>
              {auctions.map(a => {
                const iWon = getAuctionLeaderId(a) === myTeamId;
                const iSold = isAuctionSeller(a, myTeamId);
                const noSale = !a.current_bidder_id;
                const iSelf = isSelfPurchase(a, myTeamId);
                return (
                  <tr key={a.id}
                    className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer
                      ${iSelf ? "bg-cz-subtle/40" : iWon ? "bg-cz-success-bg0/3" : iSold && !noSale ? "bg-cz-info-bg0/3" : ""}`}
                    onClick={() => a.rider?.id && navigate(`/riders/${a.rider.id}`)}>
                    <td className="px-2 py-3 hidden sm:table-cell">
                      <NationCell code={a.rider?.nationality_code} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <RiderLink id={a.rider?.id} stopPropagation
                          className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                          {a.rider?.firstname} {a.rider?.lastname}
                        </RiderLink>
                        {a.rider?.is_u25 && (
                          <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">U25</span>
                        )}
                        {iSelf ? (
                          <span className="text-[9px] uppercase bg-cz-subtle text-cz-2 border border-cz-border px-1.5 py-0.5 rounded">Selv</span>
                        ) : (
                          <>
                            {iWon && <span className="text-[9px] uppercase bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded">Købt</span>}
                            {iSold && !noSale && <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">Solgt</span>}
                          </>
                        )}
                      </div>
                      <p className="text-cz-3 text-xs mt-0.5">UCI: {formatNumber(a.rider?.uci_points)} pt — Løn: {a.rider?.salary ? `${formatNumber(a.rider.salary)} CZ$` : "—"}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <TeamLink id={a.seller?.id} stopPropagation className="text-cz-2">{a.seller?.name || "—"}</TeamLink>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {noSale ? (
                        <span className="text-cz-3 text-xs">Ingen bud</span>
                      ) : (
                        <TeamLink id={a.winner?.id} stopPropagation className="text-cz-2">{a.winner?.name || "—"}</TeamLink>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {noSale ? (
                        <span className="text-cz-3 text-xs">—</span>
                      ) : iSelf ? (
                        // #244: self-purchase = ingen netto-flow (selv→selv).
                        // Vis neutral pris uden +/- prefix og uden danger/success-farve.
                        <span className="font-mono font-bold text-cz-2">
                          {formatNumber(a.current_price)} CZ$
                        </span>
                      ) : (
                        <span className={`font-mono font-bold
                          ${iWon ? "text-cz-danger" : iSold ? "text-cz-success" : "text-cz-accent-t"}`}>
                          {iWon ? "-" : iSold ? "+" : ""}{formatNumber(a.current_price)} CZ$
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-cz-3 text-xs hidden md:table-cell">
                      {timeAgo(a.actual_end)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {total > PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-cz-border">
              <span className="text-cz-3 text-xs">
                Side {page} af {Math.ceil(total / PER_PAGE)}
              </span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                    hover:bg-cz-subtle disabled:opacity-30 disabled:cursor-not-allowed">
                  ← Forrige
                </button>
                <button disabled={page * PER_PAGE >= total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                    hover:bg-cz-subtle disabled:opacity-30 disabled:cursor-not-allowed">
                  Næste →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
