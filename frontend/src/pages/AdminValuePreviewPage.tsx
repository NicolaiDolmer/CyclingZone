// #5686 · Ejerens værdi-forhåndsvisning: hele populationens rytterværdi FØR og
// EFTER en valgt værdimodel, set i admin FØR modellen går live.
//
// Siden er GATEN for værdikørslen (#5443/#5497): ejeren ser tallene her og
// siger "kør" herfra, ikke fra en CSV. Selve kørslen sker stadig via runbooken
// (docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md). Siden skriver INTET:
// endpointet (GET /api/admin/value-preview) er read-only, og der findes ingen
// POST.
//
// Tallene regnes server-side af produktionens egen recomputeRiderValue
// (backend/lib/adminValuePreview.js) og caches 5 min. Filtre, sortering og
// totaler sker i browseren (adminValuePreviewShape.ts), så de er øjeblikkelige.
//
// T2 wide data (cap 1600px) + OVERBLIK FØRST, FANER UD: første fane er
// populationens totaler, fordeling og løn-kontrol; rytter- og holdtabellerne
// bor i hver sin fane. Trin-planen (kørselsdag + uge 1-4) vises kun når den
// valgte model faktisk ændrer sig pr. trin (serveren afgør det).
//
// EJER-ONLY: endpointet er requireOwner. En 403 behandles som "ikke adgang" og
// sender videre til dashboardet, præcis som på værdi-overgangs-siden.
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type ComponentType, type ReactNode,
} from "react";
import { Navigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
// Relative imports bærer en endelse (.ts/.tsx som .js, .jsx som .jsx), jf.
// TradeListPage.tsx.
import { supabase } from "../lib/supabase.js";
import { apiFetch } from "../lib/apiFetch.js";
import { formatNumber, formatLocalTime } from "../lib/intl.js";
import RiderLink from "../components/RiderLink.jsx";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../components/admin/shared/useAdminAuth.js";
import {
  Button as ButtonBase, DataTable as DataTableBase, EmptyState as EmptyStateBase, ErrorState as ErrorStateBase,
  FilterBar as FilterBarBase, PageHeader as PageHeaderBase, PageLoader, Section as SectionBase,
  SectionAction as SectionActionBase, SectionHeader as SectionHeaderBase, SectionStack as SectionStackBase,
  Select as SelectBase, Segmented as SegmentedBase, SkeletonLines, Tabs as TabsBase, TabList as TabListBase,
  Tab as TabBase, TabPanel as TabPanelBase, AlertTriangleIcon, CheckIcon, FilterIcon, RefreshIcon,
} from "../components/ui/index.js";
import {
  AGE_BANDS,
  DEFAULT_FILTERS,
  ROW_PAGE_SIZE,
  buildRows,
  filterOptions,
  filterRows,
  sortRows,
  stepLabelKey,
  summarize,
  teamTotals,
  type AgeBand,
  type PreviewFilters,
  type PreviewRow,
  type RowSortKey,
  type Scope,
  type SortDir,
  type TeamRow,
  type TeamSortKey,
  type ValuePreviewPayload,
} from "./adminValuePreviewShape.js";

const API = import.meta.env.VITE_API_URL;

// ── Typer for de .jsx-primitiver siden bruger ──────────────────────────────
// Uden dem udleder TS props af default-VÆRDIERNE (`actions = null` bliver til
// `null`), og lovlige kald afvises. Kontrakten er læst direkte af filerne i
// components/ui, samme greb som TradeListPage.tsx.
interface Column<T> {
  key: string;
  header: string;
  sticky?: boolean;
  numeric?: boolean;
  fold?: boolean;
  sortKey?: string;
  mobileLabel?: string;
  foldValue?: (row: T) => string;
  subline?: (row: T) => ReactNode;
  render: (row: T) => ReactNode;
}
interface DataTableProps<T> {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowProps?: ((row: T) => Record<string, unknown>) | null;
  sort?: string;
  sortDir?: SortDir;
  onSort?: (key: string) => void;
  count?: ReactNode;
  dense?: boolean;
  empty?: ReactNode;
  mobileDefaults?: string[] | null;
}
interface FilterBarSelect {
  key: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  ariaLabel: string;
  options: { value: string; label: string }[];
}
interface FilterBarProps {
  search?: { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void; placeholder: string; ariaLabel?: string } | null;
  filters?: FilterBarSelect[];
  trailing?: ReactNode;
  meta?: ReactNode;
  moreLabel?: string;
  className?: string;
  children?: ReactNode;
}
interface PageHeaderProps { title: string; subtitle?: string; actions?: ReactNode }
interface SelectProps {
  size?: "sm" | "md";
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
}
interface SegmentedProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}
interface StateProps { title: string; description?: string; action?: ReactNode; icon?: ReactNode }
interface TabsProps { value: string; onChange: (next: string) => void; className?: string; children?: ReactNode }
interface TabListProps { label: string; className?: string; children?: ReactNode }
interface TabProps { value: string; children?: ReactNode }
interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  onClick?: () => void;
  disabled?: boolean;
  iconLeft?: ReactNode;
  children?: ReactNode;
}
interface BoxProps { className?: string; children?: ReactNode; "data-testid"?: string; "aria-busy"?: boolean }
interface SectionHeaderProps { title: ReactNode; action?: ReactNode; meta?: ReactNode }
interface SectionActionProps { onClick?: () => void; children?: ReactNode }

function typedTable<T>() {
  return DataTableBase as unknown as ComponentType<DataTableProps<T>>;
}
const RiderTable = typedTable<PreviewRow>();
const TeamTable = typedTable<TeamRow>();
const FilterBar = FilterBarBase as unknown as ComponentType<FilterBarProps>;
const PageHeader = PageHeaderBase as unknown as ComponentType<PageHeaderProps>;
const Select = SelectBase as unknown as ComponentType<SelectProps>;
const Segmented = SegmentedBase as unknown as ComponentType<SegmentedProps>;
const EmptyState = EmptyStateBase as unknown as ComponentType<StateProps>;
const ErrorState = ErrorStateBase as unknown as ComponentType<StateProps>;
const Tabs = TabsBase as unknown as ComponentType<TabsProps>;
const TabList = TabListBase as unknown as ComponentType<TabListProps>;
const Tab = TabBase as unknown as ComponentType<TabProps>;
const TabPanel = TabPanelBase as unknown as ComponentType<TabProps>;
const Button = ButtonBase as unknown as ComponentType<ButtonProps>;
const Section = SectionBase as unknown as ComponentType<BoxProps>;
const SectionStack = SectionStackBase as unknown as ComponentType<BoxProps>;
const SectionHeader = SectionHeaderBase as unknown as ComponentType<SectionHeaderProps>;
const SectionAction = SectionActionBase as unknown as ComponentType<SectionActionProps>;

const TABS = ["overview", "riders", "teams"] as const;
type TabKey = (typeof TABS)[number];
const HARDEST_HIT_COUNT = 8;
const AGE_KEY: Record<Exclude<AgeBand, "all">, string> = {
  u22: "u22", "22-25": "a22_25", "26-29": "a26_29", "30+": "a30",
};

// ── Formatering ────────────────────────────────────────────────────────────
const fmtKr = (n: number | null | undefined) => (n == null ? "-" : formatNumber(Math.round(n)));
const fmtSignedKr = (n: number | null | undefined) =>
  n == null ? "-" : `${n > 0 ? "+" : ""}${formatNumber(Math.round(n))}`;
const fmtPct = (p: number | null | undefined) => {
  if (p == null) return "-";
  const r = Math.round(p * 10) / 10;
  return `${r > 0 ? "+" : ""}${formatNumber(r, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
};
const toneClass = (n: number | null | undefined) =>
  n == null || n === 0 ? "text-cz-2" : n < 0 ? "text-cz-danger" : "text-cz-success";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-3xs uppercase tracking-[.1em] text-cz-3">{label}</p>
      <p className={`mt-1 font-data text-lg font-semibold tabular-nums ${tone ?? "text-cz-1"}`}>{value}</p>
    </div>
  );
}

export default function AdminValuePreviewPage() {
  const { t, ready } = useTranslation("admin");
  const { getAuth } = useAdminAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [adminStatus, setAdminStatus] = useState<"checking" | "admin" | "not_admin">("checking");
  const [data, setData] = useState<ValuePreviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<PreviewFilters>(DEFAULT_FILTERS);
  const [riderSort, setRiderSort] = useState<{ key: RowSortKey; dir: SortDir }>({ key: "deltaPct", dir: "asc" });
  const [teamSort, setTeamSort] = useState<{ key: TeamSortKey; dir: SortDir }>({ key: "deltaPct", dir: "asc" });
  const [limit, setLimit] = useState(ROW_PAGE_SIZE);

  // Model, trin og fane bor i URL'en, så et link viser præcis det ejeren så.
  const rawTab = searchParams.get("tab");
  const tab: TabKey = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as TabKey) : "overview";
  const toParam = searchParams.get("to") ?? "";
  const stepParam = Number(searchParams.get("step") ?? "0");
  const step = Number.isInteger(stepParam) && stepParam >= 0 && stepParam <= 4 ? stepParam : 0;

  // ALLE nøgler der skifter sammen, skal i ÉT setSearchParams-kald: routerens
  // funktions-opdatering får den renderede URL, ikke en ventende, så to kald i
  // træk ville lade det andet overskrive det første.
  const setParams = useCallback((changes: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value); else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const setParam = useCallback((key: string, value: string | null) => setParams({ [key]: value }), [setParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).maybeSingle();
      if (!cancelled) setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
    return () => { cancelled = true; };
  }, []);

  // Et model- eller trin-skift starter et nyt kald mens det forrige kan være i
  // luften. Kun det nyeste svar må skrive state.
  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const isLatest = () => requestSeq.current === seq;
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuth();
      const qs = new URLSearchParams();
      if (toParam) qs.set("to", toParam);
      if (step) qs.set("step", String(step));
      const query = qs.toString();
      const url = `${API}/api/admin/value-preview` + (query ? `?${query}` : "");
      const res = await apiFetch(url, { headers });
      if (!isLatest()) return;
      if (res.status === 403) { setAdminStatus("not_admin"); return; }
      const json = await readAdminJson(res);
      if (!isLatest()) return;
      if (!res.ok) { setError(adminErrorMessage(json, res)); return; }
      setData(json as ValuePreviewPayload);
    } catch (err) {
      if (isLatest()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [getAuth, toParam, step]);

  useEffect(() => {
    if (adminStatus === "admin") load();
  }, [adminStatus, load]);

  // Nye filtre eller ny sortering starter tabellen forfra øverst.
  useEffect(() => { setLimit(ROW_PAGE_SIZE); }, [filters, riderSort, data]);

  const allRows = useMemo(() => buildRows(data), [data]);
  const filtered = useMemo(() => filterRows(allRows, filters), [allRows, filters]);
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const options = useMemo(() => filterOptions(allRows, filters.scope), [allRows, filters.scope]);
  const sortedRiders = useMemo(
    () => sortRows(filtered, riderSort.key, riderSort.dir),
    [filtered, riderSort],
  );
  const teams = useMemo(() => teamTotals(filtered), [filtered]);
  const sortedTeams = useMemo(() => sortRows(teams, teamSort.key, teamSort.dir), [teams, teamSort]);
  const hardestHit = useMemo(
    () => sortRows(teams.filter((tm) => tm.deltaPct != null), "deltaPct", "asc").slice(0, HARDEST_HIT_COUNT),
    [teams],
  );

  const setFilter = useCallback(<K extends keyof PreviewFilters>(key: K, value: PreviewFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const toggleSort = <K extends string>(current: { key: K; dir: SortDir }, key: K): { key: K; dir: SortDir } =>
    current.key === key
      ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "name" ? "asc" : "desc" };

  // Ready-gate: admin-namespacet lazy-loades (INLINE_EXEMPT), så uden den ville
  // siden blinke med rå nøgler.
  if (!ready) return <PageLoader minHeight="40vh" />;
  if (adminStatus === "checking") return <PageLoader label={t("valuePreview.loading")} minHeight="40vh" />;
  if (adminStatus === "not_admin") return <Navigate to="/dashboard" replace />;

  const modelIds = data?.modelIds ?? [];
  const activeTo = data?.to ?? toParam;
  const stepLabel = (s: number) => t(stepLabelKey(s), { n: String(s) });

  const header = (
    <PageHeader
      title={t("valuePreview.title")}
      subtitle={t("valuePreview.subtitle")}
      actions={
        <>
          {data && (
            <Select
              size="sm"
              value={activeTo}
              onChange={(e) => setParams({ to: e.target.value, step: null })}
              aria-label={t("valuePreview.modelSelect")}
            >
              {modelIds.map((id) => (
                <option key={id} value={id}>{t("valuePreview.modelOption", { from: data.from, to: id })}</option>
              ))}
            </Select>
          )}
          <Button variant="primary" size="sm" onClick={load} disabled={loading} iconLeft={<RefreshIcon size={14} aria-hidden="true" />}>
            {t("valuePreview.reload")}
          </Button>
        </>
      }
    />
  );

  if (error && !data) {
    return (
      <div className="mx-auto max-w-[1600px]">
        {header}
        <ErrorState
          title={t("valuePreview.error.title")}
          description={error === "Owner only" || error === "Admin only" ? error : t("valuePreview.error.description")}
          action={<Button variant="secondary" size="sm" onClick={load}>{t("valuePreview.error.retry")}</Button>}
        />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-[1600px]">
        {header}
        <Section><SkeletonLines lines={6} /></Section>
      </div>
    );
  }

  const ageLabel = (band: Exclude<AgeBand, "all">) => t(`valuePreview.filters.age.${AGE_KEY[band]}`);
  const typeLabel = (type: string | null) => (type ? t(`riderTypes:types.${type}`, { defaultValue: type }) : "-");
  const computedTime = data.computedAt ? formatLocalTime(data.computedAt) : "-";
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const empty = (
    <EmptyState
      icon={<FilterIcon size={26} aria-hidden="true" />}
      title={t("valuePreview.empty.title")}
      description={t("valuePreview.empty.description")}
      action={<Button variant="secondary" size="sm" onClick={clearFilters}>{t("valuePreview.empty.action")}</Button>}
    />
  );

  const deltaCols = <T extends { deltaKr: number; deltaPct: number | null }>(): Column<T>[] => [
    {
      key: "deltaKr", header: t("valuePreview.columns.deltaKr"), numeric: true, sortKey: "deltaKr",
      render: (r) => <span className={toneClass(r.deltaKr)}>{fmtSignedKr(r.deltaKr)}</span>,
      foldValue: (r) => fmtSignedKr(r.deltaKr),
    },
    {
      key: "deltaPct", header: t("valuePreview.columns.deltaPct"), numeric: true, sortKey: "deltaPct",
      render: (r) => <span className={toneClass(r.deltaPct)}>{fmtPct(r.deltaPct)}</span>,
      foldValue: (r) => fmtPct(r.deltaPct),
    },
  ];

  const riderColumns: Column<PreviewRow>[] = [
    {
      key: "name", header: t("valuePreview.columns.rider"), sticky: true, sortKey: "name",
      render: (r) => <RiderLink id={r.id} tab={undefined} className="text-cz-1 hover:text-cz-accent-t">{r.name}</RiderLink>,
      subline: (r) => [
        r.teamName ?? t("valuePreview.noTeam"),
        r.isAcademy ? t("valuePreview.academy") : null,
        r.age != null ? t("valuePreview.ageShort", { n: String(r.age) }) : null,
      ].filter(Boolean).join(" · "),
    },
    { key: "type", header: t("valuePreview.columns.type"), fold: true, render: (r) => typeLabel(r.type), foldValue: (r) => typeLabel(r.type) },
    { key: "before", header: t("valuePreview.columns.before"), numeric: true, sortKey: "before", render: (r) => fmtKr(r.before) },
    { key: "after", header: t("valuePreview.columns.after"), numeric: true, sortKey: "after", render: (r) => fmtKr(r.after) },
    ...deltaCols<PreviewRow>(),
  ];

  const openTeam = (teamId: string) => {
    setFilters((f) => ({ ...f, teamId }));
    setParam("tab", "riders");
  };

  const teamColumns: Column<TeamRow>[] = [
    {
      key: "name", header: t("valuePreview.columns.team"), sticky: true, sortKey: "name",
      render: (r) => (
        <button type="button" className="text-left text-cz-1 hover:text-cz-accent-t" onClick={() => openTeam(r.id)}>
          {r.name}
        </button>
      ),
      subline: (r) => (r.division != null ? t("valuePreview.filters.division.one", { n: String(r.division) }) : "-"),
    },
    { key: "n", header: t("valuePreview.columns.riders"), numeric: true, sortKey: "n", render: (r) => formatNumber(r.n) },
    { key: "before", header: t("valuePreview.columns.before"), numeric: true, sortKey: "before", render: (r) => fmtKr(r.before) },
    { key: "after", header: t("valuePreview.columns.after"), numeric: true, sortKey: "after", render: (r) => fmtKr(r.after) },
    ...deltaCols<TeamRow>(),
  ];

  const shownRiders = sortedRiders.slice(0, limit);
  const remaining = sortedRiders.length - shownRiders.length;
  const wageOk = data.wageControl.moved === 0;

  return (
    <div className="mx-auto max-w-[1600px]">
      {header}

      <FilterBar
        className="mb-4"
        search={{
          value: filters.q,
          onChange: (e) => setFilter("q", e.target.value),
          placeholder: t("valuePreview.filters.search"),
        }}
        filters={[
          {
            key: "scope",
            value: filters.scope,
            onChange: (e) => setFilters((f) => ({ ...f, scope: e.target.value as Scope, teamId: "all" })),
            ariaLabel: t("valuePreview.filters.scope.label"),
            options: [
              { value: "managers", label: t("valuePreview.filters.scope.managers") },
              { value: "all", label: t("valuePreview.filters.scope.all") },
            ],
          },
          {
            key: "division",
            value: filters.division,
            onChange: (e) => setFilter("division", e.target.value),
            ariaLabel: t("valuePreview.filters.division.label"),
            options: [
              { value: "all", label: t("valuePreview.filters.division.all") },
              ...options.divisions.map((d) => ({ value: String(d), label: t("valuePreview.filters.division.one", { n: String(d) }) })),
            ],
          },
          {
            key: "type",
            value: filters.type,
            onChange: (e) => setFilter("type", e.target.value),
            ariaLabel: t("valuePreview.filters.type.label"),
            options: [
              { value: "all", label: t("valuePreview.filters.type.all") },
              ...options.types.map((ty) => ({ value: ty, label: typeLabel(ty) })),
            ],
          },
        ]}
        trailing={data.stepSensitive ? (
          <Segmented
            label={t("valuePreview.steps.label")}
            value={String(data.step)}
            onChange={(next) => setParam("step", next === "0" ? null : next)}
            options={data.steps.map((s) => ({ value: String(s), label: stepLabel(s) }))}
          />
        ) : null}
        moreLabel={t("valuePreview.filters.more")}
        meta={t("valuePreview.meta", {
          from: data.from, to: data.to, wage: data.wageModel,
          season: String(data.seasonNumber ?? "-"), time: computedTime,
        })}
      >
        <Select
          size="sm"
          value={filters.teamId}
          onChange={(e) => setFilter("teamId", e.target.value)}
          aria-label={t("valuePreview.filters.team.label")}
        >
          <option value="all">{t("valuePreview.filters.team.all")}</option>
          {options.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
        </Select>
        <Select
          size="sm"
          value={filters.ageBand}
          onChange={(e) => setFilter("ageBand", e.target.value as AgeBand)}
          aria-label={t("valuePreview.filters.age.label")}
        >
          <option value="all">{t("valuePreview.filters.age.all")}</option>
          {AGE_BANDS.filter((b): b is Exclude<AgeBand, "all"> => b !== "all").map((b) => (
            <option key={b} value={b}>{ageLabel(b)}</option>
          ))}
        </Select>
      </FilterBar>

      {error && (
        <p className="mb-4 flex items-center gap-2 text-sm text-cz-danger" role="alert">
          <AlertTriangleIcon size={15} aria-hidden="true" />
          {t("valuePreview.error.stale")}
        </p>
      )}

      <Tabs value={tab} onChange={(next) => setParam("tab", next === "overview" ? null : next)}>
        <TabList label={t("valuePreview.title")} className="mb-4">
          <Tab value="overview">{t("valuePreview.tabs.overview")}</Tab>
          <Tab value="riders">{t("valuePreview.tabs.riders")}</Tab>
          <Tab value="teams">{t("valuePreview.tabs.teams")}</Tab>
        </TabList>

        <TabPanel value="overview">
          <SectionStack aria-busy={loading}>
            <Section data-testid="value-preview-summary">
              <SectionHeader
                title={data.stepSensitive ? `${t("valuePreview.overview.population")} · ${stepLabel(data.step)}` : t("valuePreview.overview.population")}
                meta={t("valuePreview.modelOption", { from: data.from, to: data.to })}
              />
              {data.from === data.to && !data.stepSensitive && (
                <p className="mb-4 text-sm text-cz-2">{t("valuePreview.sameModel")}</p>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Stat label={t("valuePreview.stats.riders")} value={formatNumber(summary.n)} />
                <Stat label={t("valuePreview.stats.before")} value={fmtKr(summary.before)} />
                <Stat label={t("valuePreview.stats.after")} value={fmtKr(summary.after)} />
                <Stat label={t("valuePreview.stats.change")} value={fmtPct(summary.deltaPct)} tone={toneClass(summary.deltaPct)} />
                <Stat label={t("valuePreview.stats.median")} value={fmtPct(summary.medianPct)} tone={toneClass(summary.medianPct)} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-cz-border pt-4 sm:grid-cols-5">
                <Stat label={t("valuePreview.stats.up")} value={formatNumber(summary.up)} />
                <Stat label={t("valuePreview.stats.down")} value={formatNumber(summary.down)} />
                <Stat label={t("valuePreview.stats.same")} value={formatNumber(summary.same)} />
                <Stat label={t("valuePreview.stats.drop25")} value={formatNumber(summary.drop25)} tone={summary.drop25 ? "text-cz-danger" : undefined} />
                <Stat label={t("valuePreview.stats.drop50")} value={formatNumber(summary.drop50)} tone={summary.drop50 ? "text-cz-danger" : undefined} />
              </div>
              <div className="mt-4 space-y-1 border-t border-cz-border pt-4 text-sm">
                <p className={`flex items-center gap-2 ${wageOk ? "text-cz-success" : "text-cz-danger"}`} data-testid="value-preview-wage-control">
                  {wageOk
                    ? <CheckIcon size={15} aria-hidden="true" />
                    : <AlertTriangleIcon size={15} aria-hidden="true" />}
                  {wageOk
                    ? t("valuePreview.wage.ok", { model: data.wageModel })
                    : t("valuePreview.wage.moved", { n: formatNumber(data.wageControl.moved), model: data.wageModel })}
                </p>
                <p className="text-cz-3">
                  {t("valuePreview.drift", { n: formatNumber(data.liveDrift) })}
                  {data.skipped > 0 && ` ${t("valuePreview.skipped", { n: formatNumber(data.skipped) })}`}
                </p>
              </div>
            </Section>

            <Section>
              <SectionHeader
                title={t("valuePreview.overview.hardestHit")}
                action={(
                  <SectionAction onClick={() => setParam("tab", "teams")}>
                    {t("valuePreview.overview.allTeams")}
                  </SectionAction>
                )}
              />
              {hardestHit.length === 0 ? (
                <p className="text-sm text-cz-3">{t("valuePreview.overview.noTeams")}</p>
              ) : (
                <ul>
                  {hardestHit.map((tm) => (
                    <li key={tm.id} className="flex items-center justify-between gap-4 border-t border-cz-border py-[10px] first:border-t-0 first:pt-0">
                      <button type="button" className="min-w-0 truncate text-left text-sm font-medium text-cz-1 hover:text-cz-accent-t" onClick={() => openTeam(tm.id)}>
                        {tm.name}
                      </button>
                      <span className="flex shrink-0 items-baseline gap-4 font-data text-sm tabular-nums">
                        <span className="text-cz-3">{fmtKr(tm.before)}</span>
                        <span className="text-cz-1">{fmtKr(tm.after)}</span>
                        <span className={`w-[72px] text-right ${toneClass(tm.deltaPct)}`}>{fmtPct(tm.deltaPct)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </SectionStack>
        </TabPanel>

        <TabPanel value="riders">
          <RiderTable
            label={t("valuePreview.tabs.riders")}
            columns={riderColumns}
            rows={shownRiders}
            rowKey={(r) => r.id}
            sort={riderSort.key}
            sortDir={riderSort.dir}
            onSort={(key) => setRiderSort((s) => toggleSort(s, key as RowSortKey))}
            count={t("valuePreview.count", { shown: formatNumber(shownRiders.length), total: formatNumber(sortedRiders.length) })}
            mobileDefaults={["after", "deltaKr", "deltaPct"]}
            empty={empty}
            dense
          />
          {remaining > 0 && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + ROW_PAGE_SIZE)}>
                {t("valuePreview.showMore", { n: formatNumber(Math.min(ROW_PAGE_SIZE, remaining)) })}
              </Button>
            </div>
          )}
        </TabPanel>

        <TabPanel value="teams">
          <TeamTable
            label={t("valuePreview.tabs.teams")}
            columns={teamColumns}
            rows={sortedTeams}
            rowKey={(r) => r.id}
            sort={teamSort.key}
            sortDir={teamSort.dir}
            onSort={(key) => setTeamSort((s) => toggleSort(s, key as TeamSortKey))}
            count={t("valuePreview.teamCount", { n: formatNumber(sortedTeams.length) })}
            mobileDefaults={["after", "deltaKr", "deltaPct"]}
            empty={empty}
            dense
          />
        </TabPanel>
      </Tabs>
    </div>
  );
}
