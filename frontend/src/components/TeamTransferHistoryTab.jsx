import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import RiderLink from "./RiderLink";
import TeamLink from "./TeamLink";
import { formatNumber, formatDate } from "../lib/intl";
import { computeTransferProfit } from "../lib/transferProfit.js";
import { useTableSort } from "../lib/useTableSort.js";
import SortableTh from "./ui/SortableTh.jsx";
import { Card, Select, ExchangeIcon, ArrowDownIcon, ArrowUpIcon } from "./ui";

const TYPE_LABEL_KEY = { auction: "type.auction", transfer: "type.transfer", swap: "type.swap", academy: "type.academy" };

// #2329: begge tabeller i denne fane bruger den kanoniske SortableTh/useTableSort
// (lib/useTableSort.js) i stedet for en lokal hand-rolled header. Historik-tabellen
// havde faktisk sortering, men det forkerte data-sort-*-flag (data-sort-exempt i
// stedet for data-sortable); profit-panelet havde det RIGTIGE flag (data-sortable)
// men INGEN sortering. Guard-hærdning i tableSortIntent.test.js fangede uoverensstemmelsen.
const HISTORY_SORT_DESC_FIRST_KEYS = new Set(["date", "amount"]);
const HISTORY_SORT_ACCESSORS = {
  date: (ev) => (ev.date ? new Date(ev.date).getTime() : null),
  amount: (ev) => (typeof ev.amount === "number" ? ev.amount : null),
};

const PROFIT_SORT_DESC_FIRST_KEYS = new Set(["bought", "sold", "profit"]);
const PROFIT_SORT_ACCESSORS = {
  rider: (tr) => `${tr.rider?.firstname || ""} ${tr.rider?.lastname || ""}`.trim() || null,
  bought: (tr) => (typeof tr.buyAmount === "number" ? tr.buyAmount : null),
  sold: (tr) => (typeof tr.sellAmount === "number" ? tr.sellAmount : null),
  profit: (tr) => (typeof tr.profit === "number" ? tr.profit : null),
};

// #1741: retning skal kunne aflæses på et øjeblik. Tidligere var det kun en
// lille farvet tekst (let at overse, "Køb"/"Salg" forveksles). Nu: pil-ikon +
// tonet pille-baggrund + label. Pil ind (ned) = tilgang/køb, pil ud (op) =
// afgang/salg, byt-ikon = bytte.
function DirectionBadge({ direction, noSale = false }) {
  const { t } = useTranslation("transfers");
  const base = "inline-flex items-center gap-1 rounded-cz px-1.5 py-0.5 text-xs font-medium";
  // #785: auktion uden bud = intet ejerskifte — "Sælg" ville antyde et salg.
  if (noSale) {
    return <span className={`${base} text-cz-3`}>{t("direction.noSale")}</span>;
  }
  if (direction === "in") {
    return (
      <span className={`${base} bg-cz-success-bg text-cz-success`}>
        <ArrowDownIcon size={12} className="flex-shrink-0" />
        {t("direction.in")}
      </span>
    );
  }
  if (direction === "out") {
    return (
      <span className={`${base} bg-cz-danger-bg text-cz-danger`}>
        <ArrowUpIcon size={12} className="flex-shrink-0" />
        {t("direction.out")}
      </span>
    );
  }
  return (
    <span className={`${base} bg-cz-info-bg text-cz-info`}>
      <ExchangeIcon size={12} className="flex-shrink-0" />
      {t("direction.swap")}
    </span>
  );
}

function RiderCell({ event }) {
  const rider = event.rider;
  if (!rider) return <span className="text-cz-3">—</span>;
  const primary = (
    <RiderLink id={rider.id} className="text-cz-1 hover:text-cz-accent-t">
      {rider.firstname} {rider.lastname}
    </RiderLink>
  );
  if (event.type === "swap" && event.rider_swapped) {
    return (
      <span className="inline-flex items-center gap-1 text-cz-2">
        {primary}
        <ExchangeIcon size={14} className="mx-0.5 text-cz-3 flex-shrink-0" />
        <RiderLink id={event.rider_swapped.id} className="text-cz-1 hover:text-cz-accent-t">
          {event.rider_swapped.firstname} {event.rider_swapped.lastname}
        </RiderLink>
      </span>
    );
  }
  return primary;
}

function ProfitAmount({ profit }) {
  const { t } = useTranslation("transfers");
  if (profit == null) {
    return <span className="text-cz-3" title={t("profit.unknownBuyHint")}>—</span>;
  }
  if (profit > 0) return <span className="text-cz-success">+{formatNumber(profit)} CZ$</span>;
  if (profit < 0) return <span className="text-cz-danger">-{formatNumber(Math.abs(profit))} CZ$</span>;
  return <span className="text-cz-2">0 CZ$</span>;
}

function TradeLeg({ amount, date }) {
  const { t } = useTranslation("transfers");
  if (amount == null) {
    return <span className="text-cz-3" title={t("profit.unknownBuyHint")}>{t("profit.unknownBuy")}</span>;
  }
  return (
    <span className="whitespace-nowrap">
      <span className="font-mono text-cz-1">{formatNumber(amount)} CZ$</span>
      {date && <span className="text-cz-3 ms-1.5 text-[10px]">{formatDate(date, "short")}</span>}
    </span>
  );
}

// Transfer-profit pr. rytter (#1107): realiserede køb→salg-par udledt af
// historikken. Altid alle sæsoner — køb og salg kan ligge i hver sin sæson.
function TransferProfitPanel({ trades, totals }) {
  const { t } = useTranslation("transfers");
  // #2329: hook FØR den tidlige return — rows/accessors er stabile selv når
  // trades er tom (sortRows returnerer bare en tom liste).
  const { rows: sortedTrades, sort, sortDir, handleSort } = useTableSort(trades, PROFIT_SORT_ACCESSORS, {
    initialSort: null,
    descFirstKeys: PROFIT_SORT_DESC_FIRST_KEYS,
  });
  if (trades.length === 0) return null;
  const unknownCount = totals.tradeCount - totals.knownTradeCount;
  return (
    <Card className="p-5">
      <div className="mb-1">
        <h2 className="text-cz-1 font-semibold text-sm">{t("profit.title")}</h2>
        <p className="text-cz-3 text-xs mt-0.5">{t("profit.subtitle")}</p>
      </div>
      <div className="overflow-x-auto">
        <table data-sortable className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border">
              <SortableTh sortKey="rider" sort={sort} sortDir={sortDir} onSort={handleSort} className="text-left py-2">{t("profit.header.rider")}</SortableTh>
              <SortableTh sortKey="bought" sort={sort} sortDir={sortDir} onSort={handleSort} className="text-right py-2">{t("profit.header.bought")}</SortableTh>
              <SortableTh sortKey="sold" sort={sort} sortDir={sortDir} onSort={handleSort} className="text-right py-2">{t("profit.header.sold")}</SortableTh>
              <SortableTh sortKey="profit" sort={sort} sortDir={sortDir} onSort={handleSort} className="text-right py-2">{t("profit.header.profit")}</SortableTh>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((tr, i) => (
              <tr key={`${tr.rider.id}:${tr.sellDate}:${i}`} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/40">
                <td className="py-2">
                  <RiderLink id={tr.rider.id} className="text-cz-1 hover:text-cz-accent-t">
                    {tr.rider.firstname} {tr.rider.lastname}
                  </RiderLink>
                </td>
                <td className="py-2 text-right"><TradeLeg amount={tr.buyAmount} date={tr.buyDate} /></td>
                <td className="py-2 text-right"><TradeLeg amount={tr.sellAmount} date={tr.sellDate} /></td>
                <td className="py-2 text-right font-mono whitespace-nowrap"><ProfitAmount profit={tr.profit} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-cz-border">
              <td colSpan={3} className="py-2 text-cz-2 font-medium">{t("profit.total")}</td>
              <td className="py-2 text-right font-mono whitespace-nowrap"><ProfitAmount profit={totals.realizedProfit} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {unknownCount > 0 && (
        <p className="text-cz-3 text-[11px] mt-2">{t("profit.totalExcluded", { count: unknownCount })}</p>
      )}
    </Card>
  );
}

export default function TeamTransferHistoryTab({ teamId }) {
  const { t } = useTranslation("transfers");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seasonFilter, setSeasonFilter] = useState("current");
  const [currentSeason, setCurrentSeason] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const [historyRes, seasonRes] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_URL}/api/teams/${teamId}/transfer-history`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
          supabase.from("seasons").select("number").eq("status", "active").maybeSingle(),
        ]);
        if (!historyRes.ok) throw new Error(t("history.loadError"));
        const data = await historyRes.json();
        if (cancelled) return;
        setEvents(data);
        setCurrentSeason(seasonRes?.data?.number ?? null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [teamId, t]);

  const availableSeasons = useMemo(() => {
    const set = new Set(events.map((e) => e.season_number).filter((n) => n != null));
    return [...set].sort((a, b) => b - a);
  }, [events]);

  // #1107: profit pr. rytter beregnes på ALLE events (ikke sæson-filtreret) —
  // køb og salg kan ligge i hver sin sæson.
  const profit = useMemo(() => computeTransferProfit(events), [events]);

  const seasonFiltered = useMemo(() => {
    let list = events;
    if (seasonFilter === "current" && currentSeason != null) {
      list = list.filter((e) => e.season_number === currentSeason);
    } else if (seasonFilter !== "all" && seasonFilter !== "current") {
      const n = Number(seasonFilter);
      list = list.filter((e) => e.season_number === n);
    }
    return list;
  }, [events, seasonFilter, currentSeason]);

  // #2329: kanonisk sort-state — historik-tabellen HAVDE allerede denne
  // sortering, blot bag et lokalt SortTh + forkert data-sort-*-flag.
  const { rows: filtered, sort: sortKey, sortDir, handleSort } = useTableSort(seasonFiltered, HISTORY_SORT_ACCESSORS, {
    initialSort: "date",
    initialDir: "desc",
    descFirstKeys: HISTORY_SORT_DESC_FIRST_KEYS,
  });

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );
  if (error) return (
    <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-cz p-4">
      <p className="text-cz-danger text-sm">{error}</p>
    </div>
  );

  const noFilteredResults = filtered.length === 0 && events.length > 0;
  const noResults = events.length === 0;

  return (
    <div className="space-y-4">
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-cz-1 font-semibold text-sm">{t("history.title")}</h2>
        <Select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)} size="sm">
          <option value="all">{t("history.seasonFilterAll")}</option>
          {currentSeason != null && (
            <option value="current">{t("history.seasonFilterCurrent", { n: currentSeason })}</option>
          )}
          {availableSeasons.filter((n) => n !== currentSeason).map((n) => (
            <option key={n} value={n}>{t("history.seasonOption", { n })}</option>
          ))}
        </Select>
      </div>

      {noResults && (
        <p className="text-cz-3 text-sm py-4">{t("history.emptyAll")}</p>
      )}

      {noFilteredResults && (
        <p className="text-cz-3 text-sm py-4">{t("history.emptyFiltered")}</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table data-sortable className="w-full text-xs">
            <thead>
              <tr className="border-b border-cz-border">
                <SortableTh sortKey="date" sort={sortKey} sortDir={sortDir} onSort={handleSort} className="text-left py-2">{t("history.header.date")}</SortableTh>
                <th className="text-left py-2 text-cz-3">{t("history.header.type")}</th>
                <th className="text-left py-2 text-cz-3">{t("history.header.direction")}</th>
                <th className="text-left py-2 text-cz-3">{t("history.header.rider")}</th>
                <th className="text-left py-2 text-cz-3">{t("history.header.counterparty")}</th>
                <SortableTh sortKey="amount" sort={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right py-2">{t("history.header.amount")}</SortableTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => (
                <tr key={ev.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/40">
                  <td className="py-2 text-cz-2 whitespace-nowrap">
                    {ev.date ? formatDate(ev.date, "short") : "—"}
                  </td>
                  <td className="py-2 text-cz-2">{TYPE_LABEL_KEY[ev.type] ? t(TYPE_LABEL_KEY[ev.type]) : ev.type}</td>
                  <td className="py-2"><DirectionBadge direction={ev.direction} noSale={ev.no_sale} /></td>
                  <td className="py-2"><RiderCell event={ev} /></td>
                  <td className="py-2">
                    {ev.counterparty?.id ? (
                      <TeamLink id={ev.counterparty.id} className="text-cz-1 hover:text-cz-accent-t">
                        {ev.counterparty.name}
                        {ev.counterparty.is_ai && <span className="ms-1 text-cz-3 text-[10px]">{t("history.aiTag")}</span>}
                      </TeamLink>
                    ) : ev.type === "academy" ? (
                      // #1525: akademi-intake har ingen modpart — kilden er akademiet.
                      <span className="text-cz-2">{t("history.academySource")}</span>
                    ) : (
                      <span className="text-cz-3">{ev.no_sale ? t("history.noBids") : "—"}</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono whitespace-nowrap">
                    {/* Fortegn/farve følger kontobevægelsen (cash_flow), ikke rytter-retningen:
                        salg = +grøn (penge ind), køb = -rød (penge ud) (#984) */}
                    {ev.amount > 0
                      ? <span className={ev.cash_flow === "in" ? "text-cz-success" : ev.cash_flow === "out" ? "text-cz-danger" : "text-cz-2"}>
                          {ev.cash_flow === "in" ? "+" : ev.cash_flow === "out" ? "-" : ""}{formatNumber(ev.amount)} CZ$
                        </span>
                      : <span className="text-cz-3">{ev.type === "swap" ? t("history.swapZero") : "—"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    <TransferProfitPanel trades={profit.trades} totals={profit.totals} />
    </div>
  );
}
