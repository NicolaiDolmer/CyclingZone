import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import NationCell from "../components/rider/NationCell";
import RiderBadges from "../components/rider/RiderBadges";
import { ageBadgeKey } from "../lib/riderAge";
import { formatNumber, formatDate } from "../lib/intl";

function timeAgo(dateStr, t) {
  if (!dateStr) return "—";
  const diff = new Date() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return t("common:time.justNow");
  if (m < 60) return t("common:time.minutesAgo", { m });
  if (h < 24) return t("common:time.hoursAgo", { h });
  if (d < 7) return t("common:time.daysAgo", { d });
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
  const { t } = useTranslation(["auctions", "common"]);
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
        rider:rider_id(id, firstname, lastname, birthdate, market_value, salary, is_u25, nationality_code, team_id),
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
        <h1 className="text-xl font-bold text-cz-1 mb-3">{t("common:nav.item.auctions")}</h1>
        <div className="flex gap-2">
          <NavLink to="/auctions" end
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                isActive
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t("history.tabActive")}
          </NavLink>
          <NavLink to="/auctions/history"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                isActive
                  ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t("history.tabHistory", { count: total })}
          </NavLink>
        </div>
      </div>

      {/* My stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: t("history.statBought"), value: myWins, color: "text-cz-accent-t" },
          { label: t("history.statSold"), value: mySales, color: "text-cz-info" },
          { label: t("history.statSpent"), value: `${formatNumber(totalSpent)} CZ$`, color: "text-cz-danger" },
          { label: t("history.statEarned"), value: `${formatNumber(totalEarned)} CZ$`, color: "text-cz-success" },
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
          { key: "all", label: t("history.filterAll") },
          { key: "won", label: t("history.filterBought", { count: myWins }) },
          { key: "sold", label: t("history.filterSold", { count: mySales }) },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === tab.key
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tab.label}
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
            {filter === "won" ? t("history.emptyWon")
              : filter === "sold" ? t("history.emptySold")
              : filter === "lost" ? t("history.emptyLost")
              : t("history.emptyAll")}
          </p>
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="px-2 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">{t("history.colNation")}</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("table.rider")}</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">{t("history.colStatus")}</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">{t("table.seller")}</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">{t("history.colWinner")}</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">{t("history.colPrice")}</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase hidden md:table-cell">{t("history.colTime")}</th>
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
                      <RiderLink id={a.rider?.id} stopPropagation
                        className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                        {a.rider?.firstname} {a.rider?.lastname}
                      </RiderLink>
                      <p className="text-cz-3 text-xs mt-0.5">{t("history.riderMeta", {
                        value: formatNumber(a.rider?.market_value),
                        salary: a.rider?.salary ? `${formatNumber(a.rider.salary)} CZ$` : t("history.salaryNone"),
                      })}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex flex-wrap items-center gap-1">
                        <RiderBadges badges={[
                          ageBadgeKey(a.rider),
                          iSelf ? "self" : iWon && "bought",
                          !iSelf && iSold && !noSale && "sold",
                        ]} />
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <TeamLink id={a.seller?.id} stopPropagation className="text-cz-2">{a.seller?.name || "—"}</TeamLink>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {noSale ? (
                        <span className="text-cz-3 text-xs">{t("history.noBids")}</span>
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
                      {timeAgo(a.actual_end, t)}
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
                {t("history.pageOf", { page, total: Math.ceil(total / PER_PAGE) })}
              </span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                    hover:bg-cz-subtle disabled:opacity-30 disabled:cursor-not-allowed">
                  ← {t("history.prev")}
                </button>
                <button disabled={page * PER_PAGE >= total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                    hover:bg-cz-subtle disabled:opacity-30 disabled:cursor-not-allowed">
                  {t("history.next")} →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
