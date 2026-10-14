import I18nReadyGate from "../I18nReadyGate.jsx";
import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Button,
  Tabs,
  TabList,
  Tab,
  Select,
  EmptyState,
  SkeletonLines,
  StatusBadge,
  ChevronRightIcon,
  ChevronLeftIcon,
} from "../ui/index.js";
import { PageHeader, FilterBar, DataTable, ErrorState } from "./ui.ts";
import {
  useLibraryContext,
  resolveLibraryScope,
  useRaceLibrary,
} from "../../hooks/useRaceLibrary.ts";
import { useIsMobileViewport } from "../../hooks/useMediaQuery.ts";
import { useRealtimeRefetch } from "../../hooks/useRealtimeRefetch.js";
import { filterLibrary } from "../../lib/race-library/model.ts";
import { formatNumber } from "../../lib/intl.js";
import { editionDate, editionHref, libraryPoolLabel } from "./navigation.ts";
import type { LibraryScope, RaceEditionSummary } from "../../lib/race-library/types.ts";
const REALTIME_TABLES = ["races"];
export default function RaceLibrary() {
  return (
    <I18nReadyGate ns={["results", "races"]}>
      <RaceLibraryContent />
    </I18nReadyGate>
  );
}
function RaceLibraryContent() {
  const { t, i18n } = useTranslation(["results", "races"]);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mobile = useIsMobileViewport();
  const boot = useLibraryContext();
  const location = useLocation();
  const restored = useRef(false);
  const resolved = useMemo(() => {
    if (!boot.data) return { scope: null, error: null };
    try {
      return { scope: resolveLibraryScope(params, boot.data), error: null };
    } catch (error) {
      return { scope: null, error };
    }
  }, [params, boot.data]);
  const scope: LibraryScope | null = resolved.scope;
  const tab = params.get("library") === "history" ? "history" : "upcoming";
  const query = {
    tab,
    search: params.get("q") ?? "",
    raceType: params.get("raceType") ?? "all",
    raceClass: params.get("raceClass") ?? "all",
  } as const;
  const data = useRaceLibrary(scope, boot.data?.seasons ?? [], boot.data?.pools ?? [], tab);
  useRealtimeRefetch("race-library", REALTIME_TABLES, data.reload);
  const rows = filterLibrary(data.data ?? [], query);
  const seasons = boot.data?.seasons ?? [];
  const pools = boot.data?.pools ?? [];
  const selectedSeason =
    seasons.find((s) => s.id === scope?.seasonId) ??
    seasons.find((s) => s.status === "active") ??
    seasons[0];
  const update = (key: string, value: string) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("tab", "archive");
        if (value === "" || (value === "all" && ["raceType", "raceClass"].includes(key)))
          next.delete(key);
        else next.set(key, value);
        if (key === "division") next.set("pool", "all");
        return next;
      },
      { replace: key === "q" }
    );
  };
  const clear = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        ["q", "raceType", "raceClass"].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true }
    );
  const historyFallback = () => {
    const previous = seasons.find((s) => s.status === "completed");
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("library", tab === "history" ? "upcoming" : "history");
      if (tab === "upcoming" && previous) next.set("season", String(previous.number));
      return next;
    });
  };
  const open = (row: RaceEditionSummary) => {
    const libraryScroll = window.scrollY;
    navigate(editionHref(row, params, "/resultater?" + params.toString()), {
      state: { libraryScroll },
    });
    window.scrollTo(0, 0);
  };
  const classes = [
    ...new Set([
      ...(data.data ?? []).map((r) => r.raceClass).filter((c): c is string => Boolean(c)),
      ...(query.raceClass !== "all" ? [query.raceClass] : []),
    ]),
  ].sort();
  const classLabel = (value: string) =>
    t("classOption." + value, { ns: "races", defaultValue: value });
  const classSelect = {
    key: "class",
    value: query.raceClass,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => update("raceClass", e.target.value),
    ariaLabel: t("library.class"),
    options: [
      { value: "all", label: t("library.allClasses") },
      ...classes.map((c) => ({ value: c, label: classLabel(c) })),
    ],
  };
  const filters = [
    {
      key: "season",
      value: String(selectedSeason?.number ?? ""),
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => update("season", e.target.value),
      ariaLabel: t("library.season"),
      options: seasons.map((s) => ({
        value: String(s.number),
        label: t("library.seasonOption", { number: s.number }),
      })),
    },
    {
      key: "type",
      value: query.raceType,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => update("raceType", e.target.value),
      ariaLabel: t("library.type"),
      options: [
        { value: "all", label: t("library.allTypes") },
        { value: "single", label: t("library.oneDay") },
        { value: "stage_race", label: t("library.stageRace") },
      ],
    },
    ...(!mobile ? [classSelect] : []),
  ];
  const columns = [
    {
      key: "name",
      header: t("library.race"),
      sticky: true,
      render: (r: RaceEditionSummary) => (
        <div className="min-w-0">
          <span className="font-medium text-cz-1">{r.name}</span>
          {r.status === "live" && (
            <span className="ms-2">
              <StatusBadge state="info">{t("library.status.live")}</StatusBadge>
            </span>
          )}
        </div>
      ),
      subline: (r: RaceEditionSummary) =>
        libraryPoolLabel(r.poolId, pools, t, scope?.tier === null),
    },
    {
      key: "date",
      header: t("library.date"),
      render: (r: RaceEditionSummary) => (
        <span className="font-data text-2xs tabular-nums">
          {editionDate(r, i18n.language) || t("library.unknown")}
        </span>
      ),
    },
    {
      key: "metric",
      header: t(tab === "history" ? "library.winner" : "library.distance"),
      numeric: tab !== "history",
      render: (r: RaceEditionSummary) =>
        tab === "history"
          ? (r.winner?.name ?? t("library.notRecorded"))
          : r.distanceKm === null
            ? t("library.unknown")
            : formatNumber(r.distanceKm, { maximumFractionDigits: 0 }) + " km",
    },
    {
      key: "stages",
      header: t("library.stages"),
      numeric: true,
      render: (r: RaceEditionSummary) =>
        r.stages === null ? t("library.unknown") : formatNumber(r.stages),
    },
    {
      key: "open",
      header: t("library.openShort"),
      render: (r: RaceEditionSummary) => (
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11 min-w-11 px-2"
          aria-label={t("library.open", { name: r.name })}
          onClick={() => open(r)}
        >
          <ChevronRightIcon size={16} aria-hidden="true" />
          <span className="hidden sm:inline">{t("library.openShort")}</span>
        </Button>
      ),
    },
  ];
  const busy = boot.loading || Boolean(scope && data.loading);
  useEffect(() => {
    if (busy || restored.current) return;
    restored.current = true;
    const top = location.state?.libraryScroll;
    const frame = requestAnimationFrame(() =>
      window.scrollTo(0, typeof top === "number" && Number.isFinite(top) ? top : 0)
    );
    return () => cancelAnimationFrame(frame);
  }, [busy, location.state]);
  const error = boot.error || resolved.error || data.error;
  const activeFilters =
    query.search !== "" || query.raceType !== "all" || query.raceClass !== "all";
  const empty = busy ? (
    <div className="p-5" role="status" aria-label={t("library.loading")}>
      <SkeletonLines lines={6} />
    </div>
  ) : error ? (
    <ErrorState
      description={t(resolved.error ? "library.scopeError" : "library.error")}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (resolved.error) setParams({ tab: "archive" });
            else {
              boot.reload();
              data.reload();
            }
          }}
        >
          {t("library.retry")}
        </Button>
      }
    />
  ) : (
    <EmptyState
      title={t(
        activeFilters
          ? "library.empty"
          : tab === "history"
            ? "library.noHistory"
            : "library.noProgram"
      )}
      description={t(
        activeFilters
          ? "library.emptyBody"
          : tab === "history"
            ? "library.noHistoryBody"
            : "library.noProgramBody"
      )}
      action={
        <Button variant="secondary" size="sm" onClick={activeFilters ? clear : historyFallback}>
          {t(
            activeFilters
              ? "library.clear"
              : tab === "history"
                ? "library.browseUpcoming"
                : "library.browseHistory"
          )}
        </Button>
      }
    />
  );
  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        to="/resultater"
        className="mb-3 inline-flex items-center gap-1 text-xs text-cz-2 hover:text-cz-1"
      >
        <ChevronLeftIcon size={14} aria-hidden="true" />
        {t("library.back")}
      </Link>
      <PageHeader
        title={t("library.title")}
        subtitle={
          boot.data
            ? t("library.scope", {
                season: t("library.seasonOption", { number: selectedSeason?.number ?? "" }),
                division:
                  scope?.tier == null
                    ? t("library.allDivisions")
                    : t("library.divisionOption", { number: scope.tier }),
                pool:
                  scope?.poolId == null
                    ? t("library.allPools")
                    : t("library.poolOption", {
                        number: (pools.find((p) => p.id === scope.poolId)?.pool_index ?? 0) + 1,
                      }),
              })
            : t("library.subtitle")
        }
        actions={
          tab === "upcoming" ? (
            <Button size="sm" onClick={() => navigate("/planning?tab=selection")}>
              {t("library.planning")}
            </Button>
          ) : null
        }
      />
      <Tabs value={tab} onChange={(value: string) => update("library", value)} className="mb-4">
        <TabList label={t("library.title")}>
          <Tab value="upcoming">{t("library.upcoming")}</Tab>
          <Tab value="history">{t("library.history")}</Tab>
        </TabList>
      </Tabs>
      <FilterBar
        search={{
          value: query.search,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("q", e.target.value),
          placeholder: t("library.search"),
          ariaLabel: t("library.search"),
        }}
        filters={filters}
        moreLabel={t("library.more")}
        meta={t("library.count", { count: rows.length })}
      >
        {mobile && (
          <Select
            size="sm"
            value={query.raceClass}
            aria-label={t("library.class")}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              update("raceClass", e.target.value)
            }
          >
            {classSelect.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
        <Select
          size="sm"
          value={scope?.tier ?? "all"}
          aria-label={t("library.division")}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => update("division", e.target.value)}
        >
          <option value="all">{t("library.allDivisions")}</option>
          {[...new Set(pools.map((p) => p.tier))].sort().map((tier) => (
            <option key={tier} value={tier}>
              {t("library.divisionOption", { number: tier })}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          value={scope?.poolId ?? "all"}
          aria-label={t("library.pool")}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => update("pool", e.target.value)}
        >
          <option value="all">{t("library.allPools")}</option>
          {pools
            .filter((p) => scope?.tier === null || p.tier === scope?.tier)
            .map((pool) => (
              <option key={pool.id} value={pool.id}>
                {libraryPoolLabel(pool.id, pools, t, scope?.tier === null)}
              </option>
            ))}
        </Select>
      </FilterBar>
      <DataTable
        fullTable={params.get("table") === "full"}
        onFullTableChange={(full: boolean) => update("table", full ? "full" : "compact")}
        dense
        columns={columns}
        rows={busy || error ? [] : rows}
        rowKey={(r: RaceEditionSummary) => r.id}
        label={t("library.title")}
        mobileDefaults={["date", "metric", "open"]}
        empty={empty}
      />
    </div>
  );
}
