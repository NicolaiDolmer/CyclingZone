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
import {
  Card, Button, EmptyState, ErrorState, GavelIcon,
  PageHeader, Section, SkeletonLines, Table, Tr, Th, Td,
} from "../components/ui";
import { useSortState } from "../lib/useTableSort.js";
import { resolveAuctionHistorySort, DEFAULT_AUCTION_HISTORY_SORT } from "../lib/auctionHistorySort.js";

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
  // #2849 bølge 2: terminal, retry-bar fejl-state — samme mønster som
  // AuctionsPage (#1350), så en fejlet historik-fetch viser canonical ErrorState
  // i stedet for at ligne en tom historik.
  const [loadError, setLoadError] = useState(false);
  const [myTeamId, setMyTeamId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | won | sold | lost
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // #246: stats fetched separat så de er korrekte på tværs af pagination —
  // tidligere blev de udregnet fra current page's 30 rækker, hvilket gjorde
  // counters inkonsistente med fane-filteret og misvisende totalt.
  const [stats, setStats] = useState({ wins: 0, sales: 0, spent: 0, earned: 0 });
  // #256: bud-tal pr. auktion — antal bud + antal forskellige hold der bød.
  // Client-side aggregation af auction_bids (public-read RLS) for de auktioner
  // der er synlige på den aktuelle side. Map: auctionId -> { bids, bidders }.
  const [bidStats, setBidStats] = useState({});
  const PER_PAGE = 30;
  // #2293: server-side kolonne-sort. Kun direkte auctions-kolonner er
  // sorterbare (se lib/auctionHistorySort.js); Pris + Tid er numeriske og
  // starter faldende ved første klik ("højeste/nyeste øverst").
  const { sort, sortDir, handleSort } = useSortState({
    initialSort: DEFAULT_AUCTION_HISTORY_SORT.sort,
    initialDir: DEFAULT_AUCTION_HISTORY_SORT.dir,
    descFirstKeys: new Set(["actual_end", "current_price"]),
  });

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) return;
    const { data: t } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (t) setMyTeamId(t.id);
  }

  async function loadAuctions() {
    if (!myTeamId) return;
    setLoading(true);
    setLoadError(false);
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

    // #2293: server-side kolonne-sort via whitelist (resolveAuctionHistorySort);
    // ukendt/manglende sort/dir falder tilbage til actual_end desc.
    // #249: sekundær sortering på beløb (faldende) så auktioner med samme
    // primær-sort-værdi (fx samme sluttidspunkt) vises med højeste bud først.
    const { sort: safeSort, dir: safeDir } = resolveAuctionHistorySort(sort, sortDir);
    query = query.order(safeSort, { ascending: safeDir === "asc" });
    if (safeSort !== "current_price") {
      query = query.order("current_price", { ascending: false });
    }
    query = query.range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

    // #2849 bølge 2: samme fejl-diskriminator som resten af koden ({data,error}
    // i stedet for kastet exception) — supabase returnerer error i stedet for at
    // reject'e, så den skal læses eksplicit for ikke at ligne en tom historik.
    const { data, count, error } = await query;
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    const rows = data || [];
    setAuctions(rows);
    setTotal(count || 0);
    setLoading(false);
    loadBidStats(rows.map(a => a.id));
  }

  // #256: hent bud-rækker for de synlige auktioner og aggregér client-side til
  // antal bud + antal forskellige hold pr. auktion. auction_bids har public-read
  // RLS (SELECT qual=true), så anon/authenticated får rækkerne uden service_role.
  // Kun én ekstra query pr. side (afgrænset af de max 30 synlige auction-ids).
  async function loadBidStats(auctionIds) {
    if (!auctionIds || auctionIds.length === 0) {
      setBidStats({});
      return;
    }
    const { data, error } = await supabase
      .from("auction_bids")
      .select("auction_id, team_id")
      .in("auction_id", auctionIds);
    if (error || !data) {
      setBidStats({});
      return;
    }
    const agg = {};
    for (const bid of data) {
      const entry = agg[bid.auction_id] || (agg[bid.auction_id] = { bids: 0, bidders: new Set() });
      entry.bids += 1;
      if (bid.team_id) entry.bidders.add(bid.team_id);
    }
    const next = {};
    for (const [auctionId, entry] of Object.entries(agg)) {
      next[auctionId] = { bids: entry.bids, bidders: entry.bidders.size };
    }
    setBidStats(next);
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
  useEffect(() => { loadAuctions(); loadStats(); }, [filter, page, sort, sortDir, myTeamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // #246: hold pagination-state synkron med filter — uden dette kunne man stå
  // på side 5 i "Alle" og skifte til "Købt" som kun har 1 side, og lande på
  // tom side 5.
  // #2293: samme reset ved kolonne-sort-skift, ellers kan man stå på side 5 og
  // sortere om, og lande på en side der ikke matcher den nye rækkefølge.
  useEffect(() => { setPage(1); }, [filter, sort, sortDir]);

  const { wins: myWins, sales: mySales, spent: totalSpent, earned: totalEarned } = stats;

  return (
    <div className="max-w-4xl mx-auto">
      {/* #2849 bølge 2: DEN kanoniske sidehoved-recipe (T1). Aktiv/Historik-
          faner bevares uændret i actions-slotten — samme bevidste afvigelse fra
          actions-kontraktens "max 1 select + 1 knap" som AuctionsPage (bølge 1),
          for ikke at opfinde et nyt navigations-mønster i denne bølge. */}
      <PageHeader
        title={t("common:nav.item.auctions")}
        subtitle={t("auctions:history.subtitle")}
        actions={
          <>
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
          </>
        }
      />

      {/* My stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: t("history.statBought"), value: myWins, color: "text-cz-accent-t" },
          { label: t("history.statSold"), value: mySales, color: "text-cz-info" },
          { label: t("history.statSpent"), value: `${formatNumber(totalSpent)} CZ$`, color: "text-cz-danger" },
          { label: t("history.statEarned"), value: `${formatNumber(totalEarned)} CZ$`, color: "text-cz-success" },
        ].map(s => (
          <Card key={s.label} className="p-3 text-center">
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`font-mono font-bold text-sm ${s.color}`}>{s.value}</p>
          </Card>
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
        // #2849 bølge 2: canonical loading-state — chrome (Section) renderer altid,
        // kun body swapper; aldrig en spinner inde i et kort.
        <Section><SkeletonLines lines={6} /></Section>
      ) : loadError ? (
        // #2849 bølge 2: canonical error-state, samme genbrugte kopi som
        // AuctionsPage's loadError (#1350) — retry er altid secondary sm.
        <Section role="alert">
          <ErrorState
            description={t("auctions:loadError.message")}
            action={<Button size="sm" variant="secondary" onClick={loadAuctions}>{t("auctions:loadError.retry")}</Button>}
          />
        </Section>
      ) : auctions.length === 0 ? (
        <EmptyState
          icon={<GavelIcon size={28} aria-hidden="true" />}
          title={
            filter === "won" ? t("history.emptyWon")
              : filter === "sold" ? t("history.emptySold")
              : filter === "lost" ? t("history.emptyLost")
              : t("history.emptyAll")
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table data-sortable>
            <thead>
              <tr>
                <Th className="hidden sm:table-cell">{t("history.colNation")}</Th>
                <Th>{t("table.rider")}</Th>
                <Th className="hidden sm:table-cell">{t("history.colStatus")}</Th>
                <Th className="hidden sm:table-cell">{t("table.seller")}</Th>
                <Th className="hidden sm:table-cell">{t("history.colWinner")}</Th>
                <Th numeric className="hidden md:table-cell">{t("history.colBids")}</Th>
                <Th numeric sortKey="current_price" sort={sort} sortDir={sortDir} onSort={handleSort}>
                  {t("history.colPrice")}
                </Th>
                <Th numeric sortKey="actual_end" sort={sort} sortDir={sortDir} onSort={handleSort}
                  className="hidden md:table-cell">
                  {t("history.colTime")}
                </Th>
              </tr>
            </thead>
            <tbody>
              {auctions.map(a => {
                const iWon = getAuctionLeaderId(a) === myTeamId;
                const iSold = isAuctionSeller(a, myTeamId);
                const noSale = !a.current_bidder_id;
                const iSelf = isSelfPurchase(a, myTeamId);
                const bids = bidStats[a.id];
                return (
                  <Tr key={a.id}
                    className={`cursor-pointer
                      ${iSelf ? "bg-cz-subtle/40" : iWon ? "bg-cz-success-bg0/3" : iSold && !noSale ? "bg-cz-info-bg0/3" : ""}`}
                    onClick={() => a.rider?.id && navigate(`/riders/${a.rider.id}`)}>
                    <Td className="hidden sm:table-cell">
                      <NationCell code={a.rider?.nationality_code} />
                    </Td>
                    <Td>
                      <RiderLink id={a.rider?.id} stopPropagation
                        className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                        {a.rider?.firstname} {a.rider?.lastname}
                      </RiderLink>
                      <p className="text-cz-3 text-xs mt-0.5">{t("history.riderMeta", {
                        value: formatNumber(a.rider?.market_value),
                        salary: a.rider?.salary ? `${formatNumber(a.rider.salary)} CZ$` : t("history.salaryNone"),
                      })}</p>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <div className="flex flex-wrap items-center gap-1">
                        <RiderBadges badges={[
                          ageBadgeKey(a.rider),
                          iSelf ? "self" : iWon && "bought",
                          !iSelf && iSold && !noSale && "sold",
                        ]} />
                      </div>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <TeamLink id={a.seller?.id} stopPropagation className="text-cz-2">{a.seller?.name || "—"}</TeamLink>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      {noSale ? (
                        <span className="text-cz-3 text-xs">{t("history.noBids")}</span>
                      ) : (
                        <TeamLink id={a.winner?.id} stopPropagation className="text-cz-2">{a.winner?.name || "—"}</TeamLink>
                      )}
                    </Td>
                    <Td numeric className="hidden md:table-cell whitespace-nowrap">
                      {bids && bids.bids > 0 ? (
                        <>
                          <span className="text-cz-2">{t("history.bidsCount", { count: bids.bids })}</span>
                          <span className="block text-cz-3 text-xs mt-0.5">{t("history.bidsUniqueBidders", { count: bids.bidders })}</span>
                        </>
                      ) : (
                        <span className="text-cz-3 text-xs">{t("history.noBids")}</span>
                      )}
                    </Td>
                    <Td numeric>
                      {noSale ? (
                        <span className="text-cz-3 text-xs">—</span>
                      ) : iSelf ? (
                        // #244: self-purchase = ingen netto-flow (selv→selv).
                        // Vis neutral pris uden +/- prefix og uden danger/success-farve.
                        <span className="font-bold text-cz-2">
                          {formatNumber(a.current_price)} CZ$
                        </span>
                      ) : (
                        <span className={`font-bold
                          ${iWon ? "text-cz-danger" : iSold ? "text-cz-success" : "text-cz-accent-t"}`}>
                          {iWon ? "-" : iSold ? "+" : ""}{formatNumber(a.current_price)} CZ$
                        </span>
                      )}
                    </Td>
                    <Td numeric className="hidden md:table-cell text-cz-3 text-xs">
                      {timeAgo(a.actual_end, t)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>

          {/* Pagination */}
          {total > PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-cz-border">
              <span className="text-cz-3 text-xs">
                {t("history.pageOf", { page, total: Math.ceil(total / PER_PAGE) })}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  ← {t("history.prev")}
                </Button>
                <Button variant="secondary" size="sm" disabled={page * PER_PAGE >= total} onClick={() => setPage(p => p + 1)}>
                  {t("history.next")} →
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
