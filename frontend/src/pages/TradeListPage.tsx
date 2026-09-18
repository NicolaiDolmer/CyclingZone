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
import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type ComponentType, type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
// Alle relative imports bærer en endelse (.coderabbit.yaml-reglen for
// frontend/**: extensionless imports består Vite, men fejler i Node's
// ESM-loader som CI bruger, #803). .ts/.tsx-moduler importeres som .js
// (TypeScripts egen konvention), .jsx-komponenter som .jsx.
import { supabase } from "../lib/supabase.js";
import { apiFetch } from "../lib/apiFetch.js";
import RiderLink from "../components/RiderLink.jsx";
import TeamLink from "../components/TeamLink.jsx";
import ReportTradeDialog from "../components/ReportTradeDialog.js";
import { formatNumber, formatDate } from "../lib/intl.js";
import { parseTransferEventId } from "../lib/tradeReport.js";
import { RULES_NUMBERS } from "../lib/rulesNumbers.js";
import {
  Button, Card, DataTable as DataTableBase, EmptyState, ErrorState as ErrorStateBase,
  FilterBar as FilterBarBase, PageLoader,
  ExchangeIcon, EyeIcon, InboxIcon,
} from "../components/ui/index.js";

// Hard rule 31: nye frontend-filer skrives i .ts/.tsx, så de får strict-dækning
// fra dag ét. Formen herunder er backendens svar fra GET /api/transfers/feed
// (backend/lib/tradeListFeed.js, mapAuction/mapTransfer/mapSwap) — kun de
// offentlige felter, præcis som holdets transferhistorik allerede viser dem.
type TFunc = ReturnType<typeof useTranslation>["t"];

interface TeamRef {
  id: string;
  name: string | null;
  is_ai: boolean;
  division: number | null;
}

interface RiderRef {
  id: string;
  firstname: string | null;
  lastname: string | null;
}

// `type` er bevidst en bred streng og ikke en union: backend kan tilføje en
// kilde før frontend kender den, og `typeLabel` viser da den rå nøgle i stedet
// for at falde igennem på en tom oversættelse.
interface TradeEvent {
  id: string;
  type: string;
  date: string | null;
  season_number: number | null;
  rider: RiderRef | null;
  rider_swapped: RiderRef | null;
  from_team: TeamRef | null;
  to_team: TeamRef | null;
  amount: number | null;
  is_guaranteed_sale: boolean;
  reportable: boolean;
}

interface TradeFeedPayload {
  events: TradeEvent[];
  limit: number;
  offset: number;
  has_more: boolean;
}

// DataTable er (endnu) en .jsx-komponent uden egne typer. Kolonne-formen
// skrives derfor eksplicit her, så en omdøbt nøgle eller en glemt `render`
// fanges af compileren i stedet for af en tom kolonne i UI'et.
interface TradeColumn {
  key: string;
  header: string;
  sticky?: boolean;
  fold?: boolean;
  numeric?: boolean;
  mobileLabel?: string;
  foldValue?: (ev: TradeEvent) => string;
  render: (ev: TradeEvent) => ReactNode;
}

// Primitiverne i components/ui er stadig .jsx (hard rule 31 gælder kun NYE
// filer, så de konverteres ikke her). Uden typer udleder TS deres props af
// default-VÆRDIERNE: `trailing = null` bliver til `null | undefined` og
// `filters = []` til `never[]`, så helt lovlige kald afvises. De tre denne side
// bruger får derfor deres faktiske kontrakt skrevet ned her, læst direkte af
// FilterBar.jsx, DataTable.jsx og ErrorState.jsx.
interface FilterBarSelect {
  key: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  ariaLabel: string;
  options: { value: string; label: string }[];
}

interface FilterBarProps {
  className?: string;
  filters?: FilterBarSelect[];
  checkbox?: {
    id: string;
    checked: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    label: string;
  } | null;
  trailing?: ReactNode;
  meta?: ReactNode;
}

interface DataTableProps {
  label: string;
  columns: TradeColumn[];
  rows: TradeEvent[];
  rowKey: (ev: TradeEvent) => string;
  mobileDefaults?: string[] | null;
  empty?: ReactNode;
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
}

const FilterBar = FilterBarBase as unknown as ComponentType<FilterBarProps>;
const DataTable = DataTableBase as unknown as ComponentType<DataTableProps>;
const ErrorState = ErrorStateBase as unknown as ComponentType<ErrorStateProps>;

// Fejl fra et afvist løfte er `unknown` under strict. Beskeden vi viser er
// altid vores egen (tradeList.loadError), så en ukendt kastet værdi må ikke
// kunne blive til "[object Object]" i en fejlkasse.
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

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

const TYPE_LABEL_KEY: Record<string, string | undefined> = {
  auction: "type.auction", transfer: "type.transfer", swap: "type.swap",
};

// Ukendt type (en fremtidig kilde backend'en tilføjer før frontend'en kender
// den) vises som sin rå nøgle i stedet for at blive slugt af en tom oversættelse.
function typeLabel(t: TFunc, type: string): string {
  const key = TYPE_LABEL_KEY[type];
  return key ? t(key) : type;
}

// #4346-mønstret uændret: sekundær ikon-knap i rækken, aldrig en gold primary,
// aldrig et rødt advarselsflag. Tone (#3139): det her er "til gennemsyn", ikke
// en anklage — derfor et neutralt øje-ikon og en label der lever i aria/title.
function ReportCell({ event, onReport }: { event: TradeEvent; onReport: (event: TradeEvent) => void }) {
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

function TeamName({ team, fallback }: { team: TeamRef | null; fallback?: string | null }) {
  const { t } = useTranslation("transfers");
  if (!team?.id) return <span className="text-cz-3">{fallback ?? "—"}</span>;
  return (
    // `tab={undefined}` er ikke pynt: TeamLink.jsx destrukturerer `tab` uden
    // default, så TS ser den som påkrævet (samme greb som
    // ReportTradeDialog.tsx bruger på Modal).
    <TeamLink id={team.id} tab={undefined} className="text-cz-1 hover:text-cz-accent-t">
      {team.name}
      {team.is_ai && <span className="ms-1 text-cz-3 text-3xs">{t("history.aiTag")}</span>}
    </TeamLink>
  );
}

interface TradeListPageProps {
  myTeamId?: string | null;
  onBrowseMarket?: (() => void) | null;
}

export default function TradeListPage({ myTeamId = null, onBrowseMarket = null }: TradeListPageProps) {
  const { t } = useTranslation("transfers");
  const [typeFilter, setTypeFilter] = useState("all");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);

  const [events, setEvents] = useState<TradeEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ type: string; id: string } | null>(null);
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
  const fetchPage = useCallback(async (offset: number): Promise<TradeFeedPayload | null> => {
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
    // apiFetch giver `unknown` — formen er backendens kontrakt, som
    // tradeListFeed.test.js holder fast på serversiden.
    return res.data as TradeFeedPayload;
  }, [typeFilter, divisionFilter, mineOnly, myTeamId]);

  // `fetchPage`s identitet ER filter-generationen (useCallback'en over
  // filtrene). Et "Vis flere"-svar der lander EFTER et filterskifte hører til
  // den gamle liste og må ikke hægtes på den nye. Uden denne vagt kunne en
  // langsom side 2 fra "alle typer" lande oven på en frisk, filtreret side 1.
  const fetchPageRef = useRef(fetchPage);
  useEffect(() => { fetchPageRef.current = fetchPage; }, [fetchPage]);

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
      .catch((e: unknown) => { if (!cancelled) setError(errorMessage(e, tRef.current("tradeList.loadError"))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchPage, reloadToken]);

  async function loadMore() {
    const requestFetch = fetchPage;
    setLoadingMore(true);
    try {
      const payload = await requestFetch(events.length);
      // Filtrene skiftede undervejs: svaret hører til den forrige liste.
      if (fetchPageRef.current !== requestFetch) return;
      if (!payload) return;
      // Dedupe på id: en handel der lander MENS man bladrer skubber alting én
      // plads ned, så næste side kan gentage den sidste række fra forrige side.
      // Uden dette får React to rækker med samme key, og spilleren ser handlen
      // to gange.
      setEvents((cur) => {
        const seen = new Set(cur.map((ev) => ev.id));
        return [...cur, ...(payload.events || []).filter((ev) => !seen.has(ev.id))];
      });
      setHasMore(Boolean(payload.has_more));
    } catch (e) {
      // Samme vagt som ovenfor: en fejl fra det gamle filter må ikke overskrive
      // den nye listes tilstand.
      if (fetchPageRef.current === requestFetch) setError(errorMessage(e, t("tradeList.loadError")));
    } finally {
      setLoadingMore(false);
    }
  }

  function openReportDialog(event: TradeEvent) {
    const parsed = parseTransferEventId(event.id);
    if (parsed) setReportTarget(parsed);
  }

  const filtersActive = typeFilter !== "all" || divisionFilter !== "all" || mineOnly;
  function resetFilters() {
    setTypeFilter("all");
    setDivisionFilter("all");
    setMineOnly(false);
  }

  const columns: TradeColumn[] = [
    {
      key: "rider",
      header: t("tradeList.header.rider"),
      sticky: true,
      render: (ev) => {
        if (!ev.rider) return <span className="text-cz-3">—</span>;
        const first = (
          <RiderLink id={ev.rider.id} tab={undefined} className="text-cz-1 hover:text-cz-accent-t">
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
              <RiderLink id={ev.rider_swapped.id} tab={undefined} className="text-cz-1 hover:text-cz-accent-t">
                {ev.rider_swapped.firstname} {ev.rider_swapped.lastname}
              </RiderLink>
            </span>
          );
        }
        return first;
      },
      // Ingen egen `subline`: type og dato er `fold: true`-kolonner, og
      // DataTable folder dem SELV ind i navnets underlinje på mobil. En
      // håndrullet subline oveni ville vise dem to gange på desktop.
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
      // Fra-holdet folder ind i navnets underlinje på mobil. Første forsøg
      // havde "fra → til" i ÉN kolonne; to holdnavne i samme celle sprængte
      // 375px-bredden (vandret scroll, D-047-brud, set på mobil-screenshot).
      // Til-holdet er det vigtigste af de to i en liste over hvem der SKIFTEDE
      // hold, så det er det der bliver stående på telefonen.
      key: "from",
      header: t("tradeList.header.from"),
      fold: true,
      // Fri-agent-auktion (rytteren kom fra puljen, ikke fra et hold) er den
      // hyppigste auktionsform i prod. En tom streg dér læses som manglende
      // data (#3708's lektie), så den får sit eget ord.
      foldValue: (ev) => ev.from_team?.name ?? (ev.type === "auction" ? t("tradeList.freeAgent") : "—"),
      render: (ev) => (
        <TeamName
          team={ev.from_team}
          fallback={ev.type === "auction" ? t("tradeList.freeAgent") : "—"}
        />
      ),
    },
    {
      key: "to",
      header: t("tradeList.header.to"),
      mobileLabel: t("tradeList.header.to"),
      render: (ev) => (
        // #3708: et garanteret AI-salg sætter ikke current_bidder_id, så der er
        // intet modparts-hold at linke til. Det ER stadig et salg, så "—" ville
        // ligne manglende data.
        <TeamName
          team={ev.to_team}
          fallback={ev.is_guaranteed_sale ? t("history.aiTeamFallback") : "—"}
        />
      ),
    },
    {
      key: "amount",
      header: t("tradeList.header.amount"),
      numeric: true,
      // #4346-mønstret fra holdhistorikken, af præcis samme grund: gennemsyns-
      // knappen deler celle med beløbet i stedet for at få sin egen kolonne. En
      // egen kolonne kostede ~89px og skubbede tabellen forbi 375px på mobil
      // (målt til 372px i en 341px-ramme, D-047-brud). Ingen ny kolonne =
      // uændret tabelbredde.
      render: (ev) => (
        <div className="flex items-center justify-end gap-1.5">
          {ev.amount == null
            ? <span className="text-cz-3">{ev.type === "swap" ? t("history.swapZero") : "—"}</span>
            : <span className="whitespace-nowrap text-cz-1">{formatNumber(ev.amount)} CZ$</span>}
          <ReportCell event={ev} onReport={openReportDialog} />
        </div>
      ),
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
            /* D-047 (#5102): mobil viser navnet + til-holdet + beløbet (med
               gennemsyns-knappen i samme celle). Type, dato og fra-holdet er
               `fold`-kolonner og lander i navnets underlinje, så ingen
               information forsvinder. To byttebare kolonner er alt tabellen har
               — derfor står der to nøgler her, ikke tre. */
            mobileDefaults={["to", "amount"]}
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
