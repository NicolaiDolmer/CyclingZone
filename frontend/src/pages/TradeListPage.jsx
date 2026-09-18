// #5257 — "All trades": ÉN samlet, offentlig liste over alle rytterskifter i
// spillet, nyeste øverst, med "report for review" pr. række.
//
// Ejer-spørgsmålet bag issuet (15/9): *"Er der ikke en liste et sted samlet over
// alle holdskifte?"* Nej — handelshistorik fandtes kun pr. hold
// (TeamTransferHistoryTab). Det her er den globale udgave.
//
// Hvorfor en fane og ikke en ny side: fold-disciplinen i
// docs/design/PAGE_TEMPLATES.md — "overblik først + faner ud". Listen bor som en
// mode-fane på Marked (TransfersPage), som allerede ER T2 wide data (cap 1600px)
// og ejer sidehoved, container og toast. Denne fil er derfor fane-KROPPEN: den
// har bevidst intet eget PageHeader og ingen egen container-bredde.
//
// Data: GET /api/transfers/feed (backend/lib/tradeListFeed.js). Kun offentlige
// felter — nøjagtig det GET /api/teams/:id/transfer-history allerede viser for
// et vilkårligt hold. Rapport-knappen genbruger #4346's flow uændret
// (lib/tradeReport.ts + ReportTradeDialog + POST /api/transfers/:type/:id/report):
// ingen ny tabel, ingen ny dialog.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/apiFetch.ts";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import ReportTradeDialog from "../components/ReportTradeDialog.js";
import { formatNumber, formatDate } from "../lib/intl";
import { parseTransferEventId } from "../lib/tradeReport.js";
import { RULES_NUMBERS } from "../lib/rulesNumbers.js";
import {
  Button, Card, DataTable, EmptyState, ErrorState, FilterBar, PageLoader,
  ChevronRightIcon, ExchangeIcon, EyeIcon, InboxIcon,
} from "../components/ui/index.js";

const PAGE_SIZE = 25;
// Skal matche TRADE_FEED_MAX_OFFSET i backend/lib/tradeListFeed.js — serveren
// afviser dybere sider, så knappen skjules i stedet for at fejle.
const MAX_OFFSET = 900;

// Samme faste tier-liste som RiderRankingsPage/ResultaterPage (#3507), så alle
// divisions-vælgere i appen viser identiske tiers.
const ALL_DIVISIONS = Array.from(
  { length: RULES_NUMBERS.maxDivision - RULES_NUMBERS.minDivision + 1 },
  (_, i) => RULES_NUMBERS.minDivision + i,
);

const TYPE_LABEL_KEY = { auction: "type.auction", transfer: "type.transfer", swap: "type.swap" };

// Ukendt type (en fremtidig kilde backend'en tilføjer før frontend'en kender
// den) vises som sin rå nøgle i stedet for at blive slugt af en tom oversættelse.
function typeLabel(t, type) {
  const key = TYPE_LABEL_KEY[type];
  return key ? t(key) : type;
}

// #4346-mønstret uændret: sekundær ikon-knap i rækken, aldrig en gold primary,
// aldrig et rødt advarselsflag. Tone (#3139): det her er "til gennemsyn", ikke
// en anklage — derfor et neutralt øje-ikon og en label der lever i aria/title.
function ReportCell({ event, onReport }) {
  const { t } = useTranslation("transfers");
  if (!event.reportable) return <span className="text-cz-3">—</span>;
  return (
    <button
      type="button"
      onClick={() => onReport(event)}
      aria-label={t("tradeList.reportAria")}
      title={t("history.reportAction")}
      className="inline-flex h-6 w-6 items-center justify-center rounded-cz text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1"
    >
      <EyeIcon size={14} aria-hidden="true" />
    </button>
  );
}

function TeamName({ team, fallback }) {
  const { t } = useTranslation("transfers");
  if (!team?.id) return <span className="text-cz-3">{fallback ?? "—"}</span>;
  return (
    <TeamLink id={team.id} className="text-cz-1 hover:text-cz-accent-t">
      {team.name}
      {team.is_ai && <span className="ms-1 text-cz-3 text-3xs">{t("history.aiTag")}</span>}
    </TeamLink>
  );
}

export default function TradeListPage({ myTeamId = null, onBrowseMarket = null }) {
  const { t } = useTranslation("transfers");
  const [typeFilter, setTypeFilter] = useState("all");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);

  const [events, setEvents] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  // "Try again" må ikke hænge på at et filter tilfældigvis ændrer sig — en
  // tæller er den eneste dependency der altid udløser en ny hentning.
  const [reloadToken, setReloadToken] = useState(0);

  // #4448-mønstret: t bruges kun til fejlteksten. Som direkte dependency ville
  // et sprogskifte hente hele feedet forfra.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  // apiFetch (#5089/#5242), ikke et bart fetch: den respekterer Retry-After og
  // har den centrale 401-vej. `limited` er IKKE en fejl — det er "intet nyt
  // endnu", så listen bliver stående i stedet for at blinke en fejlkasse.
  const fetchPage = useCallback(async (offset) => {
    const { data: { session } } = await supabase.auth.getSession();
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (divisionFilter !== "all") params.set("division", divisionFilter);
    if (mineOnly && myTeamId) params.set("team", myTeamId);
    const res = await apiFetch(`/api/transfers/feed?${params}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    if (res.limited) return null;
    if (!res.ok) throw new Error(tRef.current("tradeList.loadError"));
    return res.data;
  }, [typeFilter, divisionFilter, mineOnly, myTeamId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(0)
      .then((payload) => {
        if (cancelled || !payload) return;
        setEvents(payload.events || []);
        setHasMore(Boolean(payload.has_more));
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchPage, reloadToken]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const payload = await fetchPage(events.length);
      if (!payload) return;
      setEvents((cur) => [...cur, ...(payload.events || [])]);
      setHasMore(Boolean(payload.has_more));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function openReportDialog(event) {
    const parsed = parseTransferEventId(event.id);
    if (parsed) setReportTarget(parsed);
  }

  const filtersActive = typeFilter !== "all" || divisionFilter !== "all" || mineOnly;
  function resetFilters() {
    setTypeFilter("all");
    setDivisionFilter("all");
    setMineOnly(false);
  }

  const columns = [
    {
      key: "rider",
      header: t("tradeList.header.rider"),
      sticky: true,
      render: (ev) => {
        if (!ev.rider) return <span className="text-cz-3">—</span>;
        const first = (
          <RiderLink id={ev.rider.id} className="text-cz-1 hover:text-cz-accent-t">
            {ev.rider.firstname} {ev.rider.lastname}
          </RiderLink>
        );
        // Et bytte har to ryttere der går hver sin vej — begge navne står i
        // samme celle, adskilt af byt-ikonet (samme sprog som holdhistorikken).
        if (ev.type === "swap" && ev.rider_swapped) {
          return (
            <span className="inline-flex flex-wrap items-center gap-1">
              {first}
              <ExchangeIcon size={13} className="flex-shrink-0 text-cz-3" aria-hidden="true" />
              <RiderLink id={ev.rider_swapped.id} className="text-cz-1 hover:text-cz-accent-t">
                {ev.rider_swapped.firstname} {ev.rider_swapped.lastname}
              </RiderLink>
            </span>
          );
        }
        return first;
      },
      subline: (ev) => `${typeLabel(t, ev.type)} · ${ev.date ? formatDate(ev.date, "short") : "—"}`,
    },
    {
      key: "type",
      header: t("tradeList.header.type"),
      fold: true,
      foldValue: (ev) => typeLabel(t, ev.type),
      render: (ev) => <span className="text-cz-2">{typeLabel(t, ev.type)}</span>,
    },
    {
      key: "date",
      header: t("tradeList.header.date"),
      fold: true,
      foldValue: (ev) => (ev.date ? formatDate(ev.date, "short") : "—"),
      render: (ev) => <span className="whitespace-nowrap text-cz-2">{ev.date ? formatDate(ev.date, "short") : "—"}</span>,
    },
    {
      // Fra → til i ÉN kolonne, ikke to. På mobil er der kun tre datakolonner
      // (D-047), og "hvem til hvem" er ét spørgsmål, ikke to — delt op ville
      // den halve historie ligge bag "Fuld tabel".
      key: "move",
      header: t("tradeList.header.move"),
      mobileLabel: t("tradeList.header.move"),
      render: (ev) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <TeamName team={ev.from_team} />
          <ChevronRightIcon size={13} className="flex-shrink-0 text-cz-3" aria-hidden="true" />
          <TeamName
            team={ev.to_team}
            fallback={ev.no_sale
              ? t("history.noBids")
              : ev.is_guaranteed_sale ? t("history.aiTeamFallback") : "—"}
          />
        </span>
      ),
    },
    {
      key: "amount",
      header: t("tradeList.header.amount"),
      numeric: true,
      render: (ev) => {
        if (ev.amount == null) {
          return <span className="text-cz-3">{ev.type === "swap" ? t("history.swapZero") : "—"}</span>;
        }
        return <span className="whitespace-nowrap text-cz-1">{formatNumber(ev.amount)} CZ$</span>;
      },
    },
    {
      key: "report",
      header: t("tradeList.header.report"),
      mobileLabel: t("tradeList.header.report"),
      render: (ev) => <ReportCell event={ev} onReport={openReportDialog} />,
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        className="mb-1"
        filters={[
          {
            key: "type",
            value: typeFilter,
            onChange: (e) => setTypeFilter(e.target.value),
            ariaLabel: t("tradeList.filter.typeLabel"),
            options: [
              { value: "all", label: t("tradeList.filter.typeAll") },
              { value: "auction", label: t("type.auction") },
              { value: "transfer", label: t("type.transfer") },
              { value: "swap", label: t("type.swap") },
            ],
          },
          {
            key: "division",
            value: divisionFilter,
            onChange: (e) => setDivisionFilter(e.target.value),
            ariaLabel: t("tradeList.filter.divisionLabel"),
            options: [
              { value: "all", label: t("tradeList.filter.divisionAll") },
              ...ALL_DIVISIONS.map((d) => ({ value: String(d), label: t("tradeList.filter.divisionOption", { n: d }) })),
            ],
          },
        ]}
        checkbox={myTeamId ? {
          id: "trade-list-mine-only",
          checked: mineOnly,
          onChange: (e) => setMineOnly(e.target.checked),
          label: t("tradeList.filter.mineOnly"),
        } : null}
        trailing={filtersActive ? (
          <button type="button" onClick={resetFilters} className="text-xs font-medium text-cz-accent-t hover:underline">
            {t("tradeList.filter.reset")}
          </button>
        ) : null}
        meta={!loading && !error ? t("tradeList.count", { count: events.length }) : null}
      />

      {loading && <PageLoader label={t("tradeList.loadingAria")} minHeight="40vh" />}

      {!loading && error && (
        <Card className="p-5">
          <ErrorState
            title={t("tradeList.errorTitle")}
            description={t("tradeList.errorBody")}
            action={<Button variant="secondary" size="sm" onClick={() => setReloadToken((n) => n + 1)}>{t("tradeList.retry")}</Button>}
          />
        </Card>
      )}

      {!loading && !error && (
        <>
          <DataTable
            label={t("tradeList.tableLabel")}
            columns={columns}
            rows={events}
            rowKey={(ev) => ev.id}
            /* D-047 (#5102): de tre mobil-kolonner er "hvem til hvem", beløbet og
               rækkens handling. Type og dato er foldet ind i navnets underlinje,
               så ingen information forsvinder. */
            mobileDefaults={["move", "amount", "report"]}
            empty={
              <EmptyState
                icon={<InboxIcon size={26} aria-hidden="true" />}
                title={filtersActive ? t("tradeList.emptyFilteredTitle") : t("tradeList.emptyTitle")}
                description={filtersActive ? t("tradeList.emptyFilteredBody") : t("tradeList.emptyBody")}
                action={filtersActive
                  ? <Button variant="secondary" size="sm" onClick={resetFilters}>{t("tradeList.filter.reset")}</Button>
                  : <Button variant="secondary" size="sm" onClick={() => onBrowseMarket?.()}>{t("tradeList.emptyAction")}</Button>}
              />
            }
          />

          {hasMore && events.length < MAX_OFFSET && (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? t("tradeList.loadingMore") : t("tradeList.loadMore")}
              </Button>
            </div>
          )}
          {hasMore && events.length >= MAX_OFFSET && (
            <p className="text-center text-2xs text-cz-3">{t("tradeList.depthCapNote")}</p>
          )}
        </>
      )}

      <ReportTradeDialog
        open={reportTarget != null}
        onClose={() => setReportTarget(null)}
        transferType={reportTarget?.type}
        transferId={reportTarget?.id}
      />
    </div>
  );
}
